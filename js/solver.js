"use strict";
/* ---------- OPTIMIZER ---------- */
// Mined resources enter the solver as independent resources whose free supplies equal the
// user's corresponding mined incomes. Rocks remain informational rather than budgeted.
const VESP="Vespium";
// One correctness threshold for reconstructing project rates and executable LP plan entries.
const LP_ASSIGN_EPS=1e-9;
// A project-plan phase may credit an intermediate's leftover stock as free supply instead of
// crafting it (issue #73). Left uncapped, that credit scales with the phase's own throughput
// multiplier (z) exactly like an indefinitely-sustained production rate would, so a chronic (if
// small) shortfall between an item's real supply (Forgie + crafting) and its consumption gets
// entirely papered over by draining 100% of on-hand stock, with zero lines ever assigned to
// replenish it (issue #80). Reserving a margin forces the LP to keep some real production whenever
// stock alone can't be trusted to cover the gap, rather than banking on exhausting it to the unit.
const STOCK_SAFETY_FRAC=0.9;
// Line-assignment stability (issue #87 item 5). The makespan LP is rebuilt from scratch each solve
// with no memory of the previous assignment, and LP optima are frequently near-tied at the margin —
// so a small, unrelated edit can flip which physical line lands on which (item,level) for negligible
// benefit ("Line #N switched recipe"). HYST_FRAC is the hysteresis band: after the free solve we try
// a re-solve that pins each physical line to the jobs it ran last time, and keep that stable plan
// unless the free solve beats it by more than this fraction of throughput. _lineStability caches the
// prior per-line job sets, keyed by phase + line/item signature; it lives for the page session only
// (a reload starts from the canonical free solution), which is enough to kill mid-edit churn.
const HYST_FRAC=0.05;
// Cache shape: { [phaseKey+lineSig+itemSig]: { [physicalLineOrig]: ["item@lvl", ...] } }. Plain
// arrays (not Sets) so it survives the JSON/structured-clone round-trip to the solve worker — the
// worker is re-created per solve (true cancellation), so the main thread owns this cache and seeds
// the worker with it each solve, then copies the worker's updated copy back out (see results.js).
let _lineStability={};
function resetLineStability(){_lineStability={};}
function getLineStability(){return _lineStability;}
function setLineStability(o){_lineStability=(o&&typeof o==="object")?o:{};}
function relevantChain(targets){
  // A raw can now be a target itself (issue #78); only products have a recipe chain to expand,
  // so seed the product set from product targets and add any raw target straight into relR.
  const relP=new Set(targets.filter(t=>PRODUCTS.includes(t)));
  let changed=true;
  while(changed){changed=false;
    [...relP].forEach(P=>RECIPE[P].inputs.forEach(k=>{
      if(PRODUCTS.includes(k)&&!relP.has(k)){relP.add(k);changed=true;}
    }));
  }
  const relR=new Set(targets.filter(t=>RAWS.includes(t)));
  relP.forEach(P=>RECIPE[P].inputs.forEach(k=>{if(RAWS.includes(k))relR.add(k);}));
  return {prods:[...relP],raws:[...relR]};
}
function activeMinedResources(products){
  return [...new Set(products.map(p=>MINED_CRAFTS[p]&&MINED_CRAFTS[p].resource)
    .filter(r=>r&&minedBudgetHr(r)>0))];
}

function craftTime(item,L){return (num(S.baseTime&&S.baseTime[item])||1)*Math.pow(1.5,Math.log2(L));}
// Bits/hr consumed by crafts whose Bits are assumed PRE-PRODUCED (Frames, Wire). These products
// keep Bits out of the recipe graph, so this is a display-only read of the plan — it never feeds
// the line solver and never earns a dedicated Bits crafting line. Returns Bits/hr per such product.
function preprodBitsBreakdown(plan){
  const by={};
  (plan||[]).forEach(p=>{const j=p.job;
    if(j&&j.kind==="craft"&&PREPROD_BITS[j.res]){const L=j.lvl,ct=craftTime(j.res,L),sp=effSpeed(p.sp,ct);
      if(ct>0)by[j.res]=(by[j.res]||0)+(PREPROD_BITS[j.res]*Math.pow(3,Math.log2(L))/ct)*sp*3600;}});
  return by;
}
function preprodBitsHr(plan){return Object.values(preprodBitsBreakdown(plan)).reduce((a,b)=>a+b,0);}
// Bits that Frames/Wire crafts burn OUTSIDE the recipe graph (PREPROD_BITS): they never appear as a
// recipe input and never earn a crafting line, so every place that reasons about Bits demand has to
// fold them back in by hand. `vec` is always a NET (post-inventory) vector — the units actually being
// crafted — which is the basis projNetVec/projAvailVec/consumeInv all share. Centralised because the
// formula was copy-pasted, and consumeInv had quietly been missed.
function preprodBitsOf(vec){return PREPROD_BITS.Frames*((vec&&vec.Frames)||0)+PREPROD_BITS.Wire*((vec&&vec.Wire)||0);}
// "8 per frame, 2 per wire" — per-unit note for the pre-produce readout, for the products present.
const PREPROD_BITS_UNIT={Frames:"frame",Wire:"wire"};
function preprodBitsNote(who){return who.map(n=>`${PREPROD_BITS[n]} per ${PREPROD_BITS_UNIT[n]||n.toLowerCase()}`).join(", ");}
function buildJobs(maxVal,resIndex,relRaws,relProds,targets,w){
  const allowed=LEVELS.filter(L=>L<=maxVal);
  const jobs=[{label:"Idle",kind:"idle",res:null,lvl:null,prod:[],cons:[],h:0}];
  relRaws.forEach(Rw=>{
    const ti=targets.indexOf(Rw);
    if(ti>=0){
      // Raw selected as an OUTPUT target (issue #78): offer every compression level, the way
      // products do, so the search can pick the floored-output-maximizing level (effective speed
      // is capped at the cycle time) and trade lines against the other targets — not just the
      // single fastest-rate feeder job.
      allowed.forEach(L=>{
        const t=craftTime(Rw,L);if(!(t>0))return;
        const rate=L/t;
        jobs.push({label:"Produce "+Rw,kind:"produce",res:Rw,lvl:L,ct:t,
          prod:[[resIndex[Rw],rate]],cons:[],h:rate/w[ti]});
      });
    }else{
      // Raw needed only as a feeder input: one fastest-rate produce job is enough.
      let best=null;
      allowed.forEach(L=>{
        const t=craftTime(Rw,L);if(!(t>0))return;
        const rate=L/t;
        if(!best||rate>best.rate)best={rate,L,t};
      });
      if(best)jobs.push({label:"Produce "+Rw,kind:"produce",res:Rw,lvl:best.L,ct:best.t,
        prod:[[resIndex[Rw],best.rate]],cons:[],h:0});
    }
  });
  relProds.forEach(P=>{
    const ins=RECIPE[P].inputs;
    allowed.forEach(L=>{
      const tt=craftTime(P,L);if(!(tt>0))return;
      let ok=true;const cons=[];
      ins.forEach(k=>{const c=S.prodCost[P][k][L];if(c==null||isNaN(c)||c<0){ok=false;}else cons.push([resIndex[k],c/tt]);});
      const mined=MINED_CRAFTS[P];
      if(mined){
        const r=mined.resource;
        if(resIndex[r]==null)return;
        const c=minedCost(P,L)[r];
        if(c==null||isNaN(c)||c<0)ok=false;else cons.push([resIndex[r],c/tt]);
      }
      if(!ok)return;
      const rate=L/tt;const ti=targets.indexOf(P);
      // ct = craft-cycle seconds at 1x speed; the line's effective speed is capped at ct (1s floor)
      jobs.push({label:"Craft "+P,kind:"craft",res:P,lvl:L,ct:tt,
        prod:[[resIndex[P],rate]],cons,h:ti>=0?rate/w[ti]:0});
    });
  });
  jobs.sort((a,b)=>b.h-a.h);
  return jobs;
}

function lineRows(){return S.lines.map((ln,i)=>({__i:i,max:ln.max,spx:ln.spx,turbo:ln.turbo}));}
const sortedLines=()=>lineRows().map(ln=>({orig:ln.__i,max:ln.max,sp:lineSpeed(ln),dp:dupeMult()})).sort((a,b)=>a.max-b.max||a.sp-b.sp||a.dp-b.dp);
const forgieHr=r=>num(S.forgie&&S.forgie[r])||0;

// Core solver: weighted max-min throughput for a set of product targets over their input
// chain. Priority weights set the desired output RATIO. Each line has a duplication chance
// (output ×(1+dup), input cost unchanged) and a margin tolerance allows a small paper
// shortfall ("may-work" plans). Anytime: multi-start + iterated local search seed a near-
// optimal feasible plan, then a wall-clock-bounded branch-and-bound proves/refines it.
// Finally, a tie-break pass minimises total input shortfall among plans tied on the
// objective, so a deficit the targets can't use (free to close from surplus feeders) gets
// closed instead of left on the margin as a phantom "may-work" plan.
function solveCore(targets,w,relProds,relRaws,timeBudget){
  // Each mined resource joins only when its craft is in the chain and it has a positive budget.
  // Its produced>=consumed balance then enforces that resource's burn independently.
  const mined=activeMinedResources(relProds);
  const resources=[...relRaws,...relProds,...mined];
  const resIndex={};resources.forEach((r,i)=>resIndex[r]=i);
  const R=resources.length;
  const tIdx=targets.map(t=>resIndex[t]);
  const tol=Math.max(0,Math.min(50,num(S.margin)||0))/100;
  // Active feasibility tolerance for the current search pass. The margin solve runs two passes
  // (strict tol=0, then the user's margin) so its result is monotone in margin — see the staged
  // search at the bottom of solveCore (issue #60).
  let curTol=tol;
  // Exogenous supply (per second) of each resource, added to the produced side. Craftable
  // materials use Lil' Forgie; mined resources use their own independent income budgets.
  const baseArr=Float64Array.from(resources.map(r=>
    isMinedResource(r)?minedBudgetHr(r)/3600:forgieHr(r)/3600));

  // data-availability check (cost only — time is computed from compression)
  const issues=[];
  relProds.forEach(P=>{
    const ins=RECIPE[P].inputs;
    const any=LEVELS.some(L=>ins.every(k=>S.prodCost[P][k][L]!=null&&!isNaN(S.prodCost[P][k][L])));
    if(!any)issues.push("No material cost entered for "+P+".");
  });

  // jobs per distinct max; per-line speed factor sp and dup factor dp
  const jobsByMax={};
  const sorted=sortedLines();
  sorted.forEach(s=>{if(!jobsByMax[s.max])jobsByMax[s.max]=buildJobs(s.max,resIndex,relRaws,relProds,targets,w);});
  const lineJobs=sorted.map(s=>jobsByMax[s.max]);
  const N=sorted.length;
  // effective speed per (line, job): a craft can't run under 1s real time, so speed is capped at the craft's cycle seconds (ct)
  const spEff=lineJobs.map((js,i)=>{const sp=sorted[i].sp;return js.map(j=>(j.ct>0&&sp>j.ct)?j.ct:sp);});
  const sameAsPrev=sorted.map((s,i)=>i>0&&s.max===sorted[i-1].max&&s.sp===sorted[i-1].sp&&s.dp===sorted[i-1].dp);
  // items bound: best (speed+dup scaled) production rate of each target reachable per line
  const bp=lineJobs.map((js,i)=>targets.map(t=>{let m=0;js.forEach(j=>{if((j.kind==="craft"||j.kind==="produce")&&j.res===t)m=Math.max(m,j.prod[0][1]);});return m*sorted[i].sp*sorted[i].dp;}));
  const SP=targets.map((t,ti)=>{const a=new Array(N+1).fill(0);for(let i=N-1;i>=0;i--)a[i]=a[i+1]+bp[i][ti];return a;});
  // feasibility prune: max extra production of each resource available from lines i..N-1.
  // If current produced + this suffix still can't cover current consumed, the branch is dead.
  const maxProd=Array.from({length:R},()=>new Float64Array(N+1));
  for(let r=0;r<R;r++)for(let i=N-1;i>=0;i--){let m=0;lineJobs[i].forEach(j=>{for(const[rr,a]of j.prod)if(rr===r)m=Math.max(m,a*sorted[i].sp*sorted[i].dp);});maxProd[r][i]=maxProd[r][i+1]+m;}

  const produced=new Float64Array(R), consumed=new Float64Array(R);
  const choice=new Array(N).fill(0);
  let best={score:0,choice:new Array(N).fill(0),produced:new Float64Array(R),consumed:new Float64Array(R)};
  const EPS=1e-9;

  let nodes=0;let capped=false;const tStart=performance.now();let tLastGain=tStart;
  // The budget is a ceiling, not a target: stop once the incumbent has gone this long without
  // improving, so a converged solve takes the same wall-time whether the budget is 1s or 15s
  // (the user's complaint). The window is fixed, not budget-scaled — it only needs to exceed the
  // largest gap between real improvements. Multi-target search has wider gaps (~0.6s seen) than a
  // single-target solve (each credits item), which converges almost immediately. Capped by the
  // budget so a tiny budget can still cut it short.
  const convergeWindow=Math.min(timeBudget,targets.length>1?1000:300);

  // Constructive feasible incumbent. The DFS prunes nothing until it owns a feasible
  // plan with positive score, and stumbling onto one by raw search is what made high
  // line-counts hang. So we build one cheaply: start every capable line on the chosen
  // resource, then repeatedly switch the line that most reduces the total input
  // shortfall until the plan balances. Seeds `best`, so the DFS prunes from the start.
  function evalChoice(ch){
    produced.set(baseArr);consumed.fill(0);
    for(let i=0;i<N;i++){const job=lineJobs[i][ch[i]],sp=spEff[i][ch[i]],dp=sorted[i].dp;for(const[r,a]of job.prod)produced[r]+=a*sp*dp;for(const[r,a]of job.cons)consumed[r]+=a*sp;}
  }
  const totalDeficit=()=>{let D=0;for(let r=0;r<R;r++){const d=consumed[r]-produced[r];if(d>0)D+=d;}return D;};
  const idleIdx=i=>{const k=lineJobs[i].findIndex(j=>j.kind==="idle");return k<0?0:k;};
  function bestJobFor(i,res){let bj=-1,bg=0;lineJobs[i].forEach((job,k)=>{for(const[r,a]of job.prod)if(r===res){const g=a*sorted[i].sp*sorted[i].dp;if(g>bg){bg=g;bj=k;}}});return bj;}
  const needFrac=r=>isMinedResource(resources[r])?1:(1-curTol);
  const feasibleNow=()=>{for(let r=0;r<R;r++)if(produced[r]<consumed[r]*needFrac(r)-1e-7)return false;return true;};
  const scoreNow=()=>{let sc=Infinity;for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]];sc=Math.min(sc,net/w[k]);}return sc;};
  // repair input shortfall down to a feasible plan: each step makes the single line-switch
  // (toward producing ANY short resource) that cuts total shortfall most. Returns feasibility.
  // Drive total input shortfall to zero. Each step makes the single line-switch (to ANY job
  // — produce an input, OR drop a craft to a cheaper/lower level) that cuts the shortfall most.
  function repair(ch){
    for(let guard=0;guard<6*N+40;guard++){
      evalChoice(ch);const D=totalDeficit();if(D<=1e-7)break;
      let bI=-1,bJ=-1,bRed=1e-12;
      for(let i=0;i<N;i++){const old=ch[i],js=lineJobs[i];
        for(let k=0;k<js.length;k++){if(k===old)continue;ch[i]=k;evalChoice(ch);const red=D-totalDeficit();if(red>bRed){bRed=red;bI=i;bJ=k;}}
        ch[i]=old;evalChoice(ch);}
      if(bI<0)break;ch[bI]=bJ;
    }
    evalChoice(ch);return feasibleNow();
  }
  // hill-climb the objective with single-line best-improvement moves, staying feasible
  function climb(ch){
    let cur=scoreNow();
    for(let pass=0;pass<N+3;pass++){
      let improved=false;
      for(let i=0;i<N;i++){const old=ch[i];let bk=old,bs=cur;
        const js=lineJobs[i];for(let k=0;k<js.length;k++){if(k===old)continue;ch[i]=k;evalChoice(ch);if(feasibleNow()){const s=scoreNow();if(s>bs+EPS){bs=s;bk=k;}}}
        ch[i]=bk;if(bk!==old){cur=bs;improved=true;}else evalChoice(ch);
      }
      if(!improved)break;
    }
    return cur;
  }
  // full local optimisation from a starting choice; returns its score or null if infeasible
  function localOpt(ch){if(!repair(ch))return null;const sc=climb(ch);evalChoice(ch);return feasibleNow()?sc:null;}
  // Tie-break: among plans that match the optimal objective, prefer the one with the least
  // total input shortfall. The objective only counts net TARGET output, so a deficit the
  // targets can't consume (e.g. a feeder running on the 1.5% margin while its raw sits in
  // surplus) costs the score nothing and the search has no reason to close it. Holding the
  // score fixed, hill-climb single-line switches that cut total deficit — typically bumping a
  // short feeder's compression, paid for from the surplus raw — so a free gap is balanced out
  // rather than reported as a phantom "may-work" plan.
  function minDeficitAtScore(ch,targetScore){
    evalChoice(ch);let curD=totalDeficit();
    for(let pass=0;pass<N+3&&curD>1e-7;pass++){
      let improved=false;
      for(let i=0;i<N;i++){const old=ch[i],js=lineJobs[i];let bk=old,bD=curD;
        for(let k=0;k<js.length;k++){if(k===old)continue;ch[i]=k;evalChoice(ch);
          if(feasibleNow()&&scoreNow()>=targetScore-EPS){const d=totalDeficit();if(d<bD-1e-9){bD=d;bk=k;}}}
        ch[i]=bk;evalChoice(ch);if(bk!==old){curD=bD;improved=true;}}
      if(!improved)break;
    }
    return ch;
  }
  let _rng=0x2545f491>>>0;const rnd=()=>{_rng^=_rng<<13;_rng^=_rng>>>17;_rng^=_rng<<5;_rng>>>=0;return _rng/4294967296;};

  function dfs(i,prevIdx){
    if(((++nodes)&8191)===0){const _n=performance.now();if(_n-tStart>timeBudget||_n-tLastGain>convergeWindow)capped=true;}
    if(capped)return;
    if(i===N){
      for(let r=0;r<R;r++)if(produced[r]<consumed[r]*needFrac(r)-1e-7)return;
      let sc=Infinity;
      for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]];sc=Math.min(sc,net/w[k]);}
      if(sc>best.score+EPS){best={score:sc,choice:choice.slice(),produced:produced.slice(),consumed:consumed.slice()};tLastGain=performance.now();}
      return;
    }
    // feasibility prune: any resource whose current shortfall can't be covered by remaining lines kills this branch
    for(let r=0;r<R;r++)if(produced[r]+maxProd[r][i]<consumed[r]*needFrac(r)-1e-7)return;
    // max-min upper bound: best achievable min-over-targets if remaining lines max-produce each target
    let ub=Infinity;
    for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]]+SP[k][i];ub=Math.min(ub,net/w[k]);}
    if(ub<=best.score+EPS)return;
    const js=lineJobs[i];const dp=sorted[i].dp,spE=spEff[i];
    const start=sameAsPrev[i]?prevIdx:0;
    for(let j=start;j<js.length;j++){
      if(capped)return;
      const job=js[j],sp=spE[j];
      for(const[r,a]of job.prod)produced[r]+=a*sp*dp;
      for(const[r,a]of job.cons)consumed[r]+=a*sp;
      choice[i]=j;
      dfs(i+1,j);
      for(const[r,a]of job.prod)produced[r]-=a*sp*dp;
      for(const[r,a]of job.cons)consumed[r]-=a*sp;
    }
  }
  // LP relaxation: let each line split its time fractionally across its jobs and maximize the
  // min target ratio z. It yields (a) an upper bound on the integer optimum and (b) a rounded
  // incumbent for the discrete search to refine. This is what lets the search FIND feasible plans
  // when Gel (a vespium-bounded intermediate) is in the chain — the pure combinatorial DFS can
  // miss them at scale, which the old line-reservation sweep used to paper over by decomposing.
  function lpRelax(){
    const offs=[];let nv=0;
    for(let i=0;i<N;i++){offs.push(nv);nv+=lineJobs[i].length;}
    const zc=nv,n=nv+1,A=[],b=[];
    for(let i=0;i<N;i++){const row=new Float64Array(n);for(let j=0;j<lineJobs[i].length;j++)row[offs[i]+j]=1;A.push(row);b.push(1);}
    const tw={};targets.forEach((t,k)=>tw[tIdx[k]]=w[k]);
    for(let r=0;r<R;r++){
      const row=new Float64Array(n);
      for(let i=0;i<N;i++)for(let j=0;j<lineJobs[i].length;j++){const job=lineJobs[i][j],sp=spEff[i][j],dp=sorted[i].dp;let net=0;
        for(const[rr,a]of job.prod)if(rr===r)net+=a*sp*dp;
        for(const[rr,a]of job.cons)if(rr===r)net-=a*sp;
        if(net)row[offs[i]+j]=-net;}
      if(tw[r]!==undefined)row[zc]=tw[r];
      A.push(row);b.push(baseArr[r]);
    }
    const c=new Float64Array(n);c[zc]=1;
    const sol=lpMaximize(c,A,b);
    if(!sol.x)return null;
    const choice=new Array(N),frac=[];
    for(let i=0;i<N;i++){let bj=0,bf=-1;const fr=new Array(lineJobs[i].length);
      for(let j=0;j<lineJobs[i].length;j++){const f=sol.x[offs[i]+j]||0;fr[j]=f>0?f:0;if(f>bf){bf=f;bj=j;}}
      choice[i]=bj;frac.push(fr);}
    return {z:sol.x[zc]||0,choice,frac};
  }
  // multi-start local search: diversified roundings of the LP relaxation + one seed per target,
  // then iterated local search. Pure argmax rounding flattens lines the LP split between Gel and a
  // target and loses a lot, so we also draw several randomized roundings weighted by the LP fractions.
  const lp=N>0?lpRelax():null;
  // Two-pass margin search for monotonicity (issue #60). A plan feasible with NO margin is feasible
  // at ANY margin with the same objective, so we solve strict (tol=0) first, then seed the relaxed
  // pass with that strict optimum — the margin result can only match or beat the no-margin result,
  // never fall below it. With no margin there's a single pass (identical to before). Both passes
  // share the wall-clock budget (tStart is global); each gets a fresh convergence window and
  // incumbent so an easy factory still has time left to exploit the margin.
  const stages=tol>0?[0,tol]:[tol];
  let carry=null;
  for(let si=0;si<stages.length;si++){
  curTol=stages[si];capped=false;tLastGain=performance.now();
  let inc=null;
  const trySeed=ch=>{const c=ch.slice();const sc=localOpt(c);if(sc!=null&&(!inc||sc>inc.sc)){inc={sc,ch:c.slice()};tLastGain=performance.now();}};
  if(carry)trySeed(carry);   // strict optimum seeds the relaxed pass -> never drops below no-margin
  // The seed set is fixed (budget-independent) on purpose: the ilsT/DFS caps are measured from the
  // solve start, so seeds just consume part of the budget rather than extending it — and a fixed set
  // keeps the search trajectory monotonic in budget (more time never yields a worse plan).
  if(lp&&lp.z>EPS){
    trySeed(lp.choice);
    for(let t=0;t<16;t++){const ch=new Array(N);
      for(let i=0;i<N;i++){const fr=lp.frac[i];let s=0;for(let j=0;j<fr.length;j++)s+=fr[j];
        let x=rnd()*(s>1e-12?s:1),pick=lp.choice[i];
        for(let j=0;j<fr.length;j++){x-=fr[j];if(x<=0){pick=j;break;}}
        ch[i]=pick;}
      trySeed(ch);}
  }
  // Reservation-style seeds: dedicate the k best Gel-efficiency lines to Gel (levels from the same
  // budget greedy the modal preview uses), and let localOpt fill the rest. This hands the unified
  // search the starting points the old per-k decomposition explored — so it's never worse on a
  // Gel chain — at the cost of M+1 cheap local optimisations, not nested solves.
  const gelBudgetHr=minedBudgetHr(VESP);
  if(resIndex[VESP]!=null&&gelBudgetHr>0){
    const o2s={};sorted.forEach((s,i)=>o2s[s.orig]=i);
    const ranked=lineRows().sort((a,b)=>gelOutHr(b,b.max)-gelOutHr(a,a.max));
    for(let k=1;k<=ranked.length;k++){
      const lo=gelLoadout(ranked.slice(0,k),gelBudgetHr);
      if(!lo.perLine.length)continue;
      const ch=new Array(N);for(let i=0;i<N;i++)ch[i]=idleIdx(i);
      lo.perLine.forEach(pl=>{const i=o2s[pl.__i];if(i==null)return;
        const j=lineJobs[i].findIndex(jb=>jb.kind==="craft"&&jb.res===GEL&&jb.lvl===pl.L);if(j>=0)ch[i]=j;});
      trySeed(ch);
    }
  }
  // Role-based seeds (single target): the LP reveals which feeder items the chain needs, but the
  // local search can't decide WHICH line takes each feeder role — putting the bottleneck feeder on
  // the fastest line briefly lowers the target, so no single improving move finds it. Enumerate the
  // line->role assignments (rest = target at an efficient level) and localOpt each. Bounded by a
  // fixed count, so it stays deterministic (monotonic in budget) and within the seed budget; full
  // coverage for up to ~8 lines / 3 feeders, a deterministic prefix beyond that.
  if(lp&&targets.length===1){
    const tgt=tIdx[0],tgtRes=resources[tgt];
    const arg=[];for(let i=0;i<N;i++){let bj=0,bf=-1;const fr=lp.frac[i];for(let j=0;j<fr.length;j++)if(fr[j]>bf){bf=fr[j];bj=j;}arg.push(lineJobs[i][bj]);}
    const feeders=[...new Set(arg.filter(j=>j&&j.kind!=="idle"&&j.res!==tgtRes).map(j=>j.res))];
    const roleJob=(li,res)=>{let bj=-1,bl=-1;const js=lineJobs[li];for(let k=0;k<js.length;k++){const j=js[k];if((j.kind==="craft"||j.kind==="produce")&&j.res===res&&j.lvl>bl){bl=j.lvl;bj=k;}}return bj;};
    const tgtSeed=i=>{const js=lineJobs[i];for(let k=0;k<js.length;k++)if(js[k].kind==="craft"&&js[k].res===tgtRes&&js[k].lvl<=8)return k;const b=bestJobFor(i,tgt);return b>=0?b:idleIdx(i);};
    if(feeders.length&&feeders.length<=4){
      let tried=0;const cap=350;
      const rec=(fi,used)=>{
        if(tried>=cap)return;
        if(fi===feeders.length){const ch=new Array(N);for(let i=0;i<N;i++)ch[i]=tgtSeed(i);
          for(let k=0;k<feeders.length;k++){const bj=roleJob(used[k],feeders[k]);if(bj>=0)ch[used[k]]=bj;}
          trySeed(ch);tried++;return;}
        for(let i=N-1;i>=0&&tried<cap;i--){if(used.indexOf(i)>=0)continue;rec(fi+1,used.concat(i));}  // fastest-first
      };
      rec(0,[]);
    }
  }
  targets.map(t=>resIndex[t]).forEach(res=>{const ch=new Array(N);for(let i=0;i<N;i++){const bj=bestJobFor(i,res);ch[i]=bj>=0?bj:idleIdx(i);}const sc=localOpt(ch);if(sc!=null&&(!inc||sc>inc.sc)){inc={sc,ch:ch.slice()};tLastGain=performance.now();}});
  if(inc&&N>0){
    // ILS gets the bulk of the budget so accuracy scales with the user's max-time setting: at high
    // line counts the exact DFS caps out without beating the heuristic, so perturbing the incumbent
    // is the productive use of extra time. A stagnation cutoff stops once perturbation stops paying
    // off, so an easy factory — or a generous budget on a simple one — doesn't burn time it can't use.
    // ILS uses an iteration-based stagnation cutoff (not wall-clock): stopping at a fixed iteration
    // is budget-independent, which keeps the result monotonic in budget. The single-target case
    // (each credits item) converges in a handful of iterations, so it gets a much smaller limit.
    const ilsT=timeBudget*0.8,stagLimit=targets.length>1?8000:1200;let stag=0;
    for(let it=0;it<2000000;it++){
      if(performance.now()-tStart>ilsT||stag>stagLimit)break;
      const ch=inc.ch.slice();const k=1+((rnd()*2)|0);
      for(let m=0;m<=k;m++){const li=(rnd()*N)|0,js=lineJobs[li];ch[li]=(rnd()*js.length)|0;}
      const sc=localOpt(ch);if(sc!=null&&sc>inc.sc+EPS){inc={sc,ch:ch.slice()};stag=0;tLastGain=performance.now();}else stag++;
    }
    evalChoice(inc.ch);best={score:scoreNow(),choice:inc.ch.slice(),produced:produced.slice(),consumed:consumed.slice()};
  }
  produced.set(baseArr);consumed.fill(0);
  // LP z bounds the integer optimum; if the incumbent already reaches it, the search is done.
  if(!(lp&&best.score>=lp.z-1e-6*Math.max(1,lp.z)))dfs(0,0);
  // balance any free deficit out of the now-optimal plan (keeps the objective, trims the margin use)
  if(best.score>EPS&&N>0){
    const ch=minDeficitAtScore(best.choice.slice(),best.score);
    evalChoice(ch);best={score:scoreNow(),choice:ch.slice(),produced:produced.slice(),consumed:consumed.slice()};
  }
  carry=best.choice.slice();   // hand this pass's optimum to the next (relaxed) pass as a floor
  }
  let usesMargin=false;for(let r=0;r<R;r++)if(best.produced[r]<best.consumed[r]-1e-6)usesMargin=true;
  const forgie={};resources.forEach((r,i)=>forgie[r]=baseArr[i]*3600);
  return {best,sorted,lineJobs,resources,resIndex,R,N,tIdx,tol,capped,usesMargin,issues,forgie,feasible:best.score>1e-9,ms:performance.now()-tStart};
}

function minedUsageFromItemPlan(plan){
  const by={};
  (plan||[]).forEach(p=>{const j=p&&p.job,cfg=j&&j.kind==="craft"&&MINED_CRAFTS[j.res];
    if(!cfg)return;
    const es=effSpeed(p.sp,j.ct);
    const outHr=j.prod[0][1]*es*p.dp*3600,craftsHr=j.ct>0?(es/j.ct)*3600:0;
    Object.entries(minedCost(j.res,j.lvl)).forEach(([resource,cost])=>{
      const inputHr=cost*craftsHr,key=j.res+"\u0000"+resource;
      if(!by[key])by[key]={item:j.res,resource,lines:0,outHr:0,inputHr:0,perLine:[]};
      const use=by[key];use.lines++;use.outHr+=outHr;use.inputHr+=inputHr;
      use.perLine.push({line:p.line,lvl:j.lvl,outHr,inputHr});
    });
  });
  return Object.values(by);
}

// Build the per-line plan + resource balance (per hour) from a core solve.
function planFrom(sr){
  const {best,sorted,lineJobs,resources,resIndex,feasible,forgie}=sr;
  const plan=new Array(sorted.length);
  sorted.forEach((s,i)=>{const idle=lineJobs[i].find(j=>j.kind==="idle")||lineJobs[i][0];
    const job=feasible?lineJobs[i][best.choice[i]]:idle;
    const row={line:s.orig+1,max:s.max,spx:s.sp,dup:(s.dp-1)*100,sp:s.sp,dp:s.dp,job};
    if(job&&job.kind==="craft"&&job.res===GEL)row.reserved=true;
    plan[s.orig]=row;});
  const minedUsage=minedUsageFromItemPlan(plan);
  const gelUse=minedUsage.find(u=>u.item===GEL&&u.resource===VESP);
  if(gelUse)gelUse.perLine.forEach(use=>{const row=plan[use.line-1];if(row){row.gelHr=use.outHr;row.vespHr=use.inputHr;}});
  // best.produced already includes Forgie's supply; split it back out for display. Mined budgets
  // are surfaced through minedUsage, so keep all of them out of the craftable balance table.
  const balance=resources.filter(r=>!MINED_RESOURCES.includes(r)).map(r=>{const i=resIndex[r];const f=(forgie&&forgie[r])||0;
    const total=feasible?best.produced[i]*3600:0;
    return {res:r,prod:Math.max(0,total-f),forgie:feasible?f:0,cons:feasible?best.consumed[i]*3600:0};});
  const gelReserved=gelUse?{lines:gelUse.lines,outHr:gelUse.outHr,vespHr:gelUse.inputHr}:null;
  return {plan,balance,minedUsage,gelReserved};
}
function idlePlan(){
  const plan=[];
  sortedLines().forEach(s=>{plan[s.orig]={line:s.orig+1,max:s.max,spx:s.sp,dup:(s.dp-1)*100,sp:s.sp,dp:s.dp,job:{kind:"idle",res:null,lvl:null,prod:[],cons:[]}};});
  return plan;
}
// Dedicate every line to producing one raw material (raws have no inputs).
function solveRaw(Rw){
  let total=0;const plan=[];const resIndex={[Rw]:0};
  sortedLines().forEach(s=>{
    const allowed=LEVELS.filter(L=>L<=s.max);let bst=null;
    // pick the level that maximises floored output (effective speed capped at the cycle time)
    allowed.forEach(L=>{const t=craftTime(Rw,L);if(t>0){const out=(L/t)*(s.sp>t?t:s.sp);if(!bst||out>bst.out)bst={rate:L/t,L,t,out};}});
    const job=bst?{kind:"produce",res:Rw,lvl:bst.L,ct:bst.t,prod:[[0,bst.rate]],cons:[]}:{kind:"idle",res:null,lvl:null,prod:[],cons:[]};
    if(bst)total+=bst.out*s.dp;
    plan[s.orig]={line:s.orig+1,max:s.max,spx:s.sp,dup:(s.dp-1)*100,sp:s.sp,dp:s.dp,job};
  });
  const fHr=forgieHr(Rw);   // Lil' Forgie (+ any reserved) free supply of this raw
  const lineOut=total*3600, out=lineOut+fHr;
  return {item:Rw,kind:"raw",out,plan,balance:[{res:Rw,prod:lineOut,forgie:fHr,cons:0}],resIndex,capped:false,feasible:out>1e-9};
}

function optimizeInner(timeBudget){
  // Budgets are an anytime CAP, not a fixed wait: solveCore returns the moment its branch-and-
  // bound completes, so an easy plan finishes in tens of ms and never hits this. The cap only
  // bounds the worst case for a genuinely hard factory — and it must leave a slow phone enough
  // room, since it does far less search per ms than a desktop. The old 250ms let mobile cap out
  // on a suboptimal, device-dependent plan (issue #34: a profile that proves out in ~250ms on
  // desktop capped at a worse plan on a phone). 600ms ~doubles a slow device's search while
  // keeping the worst-case freeze well under half a second (and it's one-shot, post-debounce).
  // User-set max solve time (ms); the budget is an anytime cap, so easy factories still finish early.
  // Runs off the main thread (Web Worker), so a larger default doesn't freeze the UI.
  const userBudget=Math.max(200,Math.min(60000,num(S.solveBudget)||2000));
  const itemsBudget=timeBudget||userBudget, credBudget=timeBudget||userBudget;
  const mode=S.mode==="credits"?"credits":"items";
  if(mode==="items"){
    const targets=[...PRODUCTS,...RAWS].filter(it=>S.targets[it]&&S.targets[it].on);
    if(targets.length===0)return {empty:true,mode};
    const w=targets.map(it=>S.targets[it].w);
    const rc=relevantChain(targets);
    const t0=performance.now();
    const sr=solveCore(targets,w,rc.prods,rc.raws,itemsBudget);
    const {plan,balance,minedUsage,gelReserved}=planFrom(sr);
    const out={};targets.forEach((t,k)=>{out[t]=sr.feasible?(sr.best.produced[sr.tIdx[k]]-sr.best.consumed[sr.tIdx[k]])*3600:0;});
    const objective=sr.feasible?Math.min(...targets.map((t,k)=>(out[t]||0)/w[k])):0;
    return {empty:false,mode,issues:sr.issues,plan,balance,minedUsage,gelReserved,out,resIndex:sr.resIndex,targets,objective,tol:sr.tol,usesMargin:sr.usesMargin,feasible:sr.feasible,capped:sr.capped,ms:performance.now()-t0};
  }
  // credits: the optimum is always mono-product — dedicate the whole factory to ONE item.
  // So just compute each priced item's max output/hr × its price and take the winner.
  const t0=performance.now();
  const pricedP=PRODUCTS.filter(p=>(num(S.sellPrice&&S.sellPrice[p])||0)>0);
  const pricedR=RAWS.filter(r=>(num(S.sellPrice&&S.sellPrice[r])||0)>0);
  const issues=[];let capped=false,usesMargin=false;
  if(pricedP.length+pricedR.length===0)issues.push("No sell prices entered. Open the “Sell prices” button and add at least one.");
  const evalP=pricedP,evalR=pricedR;
  const budgetEach=Math.max(25,Math.floor(credBudget/Math.max(1,evalP.length)));
  const cand=[];
  evalP.forEach(P=>{
    const price=num(S.sellPrice[P])||0;
    const ins=RECIPE[P].inputs;
    const hasCost=LEVELS.some(L=>ins.every(k=>S.prodCost[P][k][L]!=null&&!isNaN(S.prodCost[P][k][L])));
    if(!hasCost){issues.push("No material cost entered for "+P+" — can't price it.");cand.push({item:P,kind:"product",out:0,price,credits:0,plan:null,balance:null,minedUsage:[],resIndex:{},feasible:false});return;}
    const rc=relevantChain([P]);
    const sr=solveCore([P],[1],rc.prods,rc.raws,budgetEach);
    if(sr.capped)capped=true;if(sr.usesMargin)usesMargin=true;
    const {plan,balance,minedUsage,gelReserved}=planFrom(sr);
    const out=sr.feasible?(sr.best.produced[sr.resIndex[P]]-sr.best.consumed[sr.resIndex[P]])*3600:0;
    cand.push({item:P,kind:"product",out,price,credits:out*price,plan,balance,minedUsage,gelReserved,resIndex:sr.resIndex,feasible:sr.feasible});
  });
  evalR.forEach(Rw=>{const s=solveRaw(Rw);const price=num(S.sellPrice[Rw])||0;cand.push({item:Rw,kind:"raw",out:s.out,price,credits:s.out*price,plan:s.plan,balance:s.balance,minedUsage:[],resIndex:s.resIndex,feasible:s.feasible});});
  cand.sort((a,b)=>b.credits-a.credits);
  const top=cand[0];
  const feasible=!!top&&top.credits>1e-9;
  return {empty:false,mode,issues,ranking:cand,bestItem:feasible?top.item:null,credits:feasible?top.credits:0,objective:feasible?top.credits:0,
    plan:feasible?top.plan:idlePlan(),balance:feasible?top.balance:[],minedUsage:feasible?top.minedUsage:[],gelReserved:feasible?top.gelReserved:null,resIndex:feasible?top.resIndex:{},
    tol:Math.max(0,Math.min(50,num(S.margin)||0))/100,usesMargin,feasible,capped,ms:performance.now()-t0};
}

/* ---------- Gel loadout ----------
   Gel is a native resource in the solve now (see solveCore / projectSchedule). gelLoadout powers
   both the Gel modal's "max Gel/hr + setup" preview and solveCore's reservation-style seeds. */
// Gel output / vespium burn for a whole line running Gel @L (≤ the line's own cap), full time.
function gelOutHr(row,L){const sp=lineSpeed(row),dp=dupeMult(),ct=craftTime(GEL,L);return ct>0?(L/ct)*effSpeed(sp,ct)*dp*3600:0;}
function gelVespHr(row,L){const sp=lineSpeed(row),ct=craftTime(GEL,L);return ct>0?gelOreCost(L).vesp*(effSpeed(sp,ct)/ct)*3600:0;}
// Maximum Gel/hr obtainable from `rows` within a vespium/hr budget. In-game a crafter runs ONE
// compression FULL-TIME (you can't throttle uptime or blend levels), so each used line is assigned
// a single whole level and the plan must stay under the budget — leftover vespium is simply profit,
// not wasted capacity. Raising compression doubles Gel but triples vespium, so marginal Gel-per-
// vespium falls with level: greedily apply the cheapest-per-Gel single-level step-up that still fits
// the remaining budget until none fit. Returns the total + per-line {__i,max,L,gelHr,vespHr,frac};
// frac is always 1 (full-time) — kept so the plan/balance display code can read it uniformly.
function gelLoadout(rows,vespBudgetHr){
  if(!(vespBudgetHr>0)||!rows.length)return {gelHr:0,vespHr:0,perLine:[]};
  const levelsFor=rows.map(row=>[0,...LEVELS.filter(L=>L<=(row.max||0))]);   // [off, 1×, 2×, …]
  const cur=rows.map(()=>0);   // chosen level index per line (0 = off)
  let spent=0,gel=0;
  for(;;){
    let bI=-1,bIdx=-1,bEff=-1,bDv=0,bDg=0;
    rows.forEach((row,ri)=>{
      const lv=levelsFor[ri],ci=cur[ri];
      if(ci+1>=lv.length)return;   // already at this line's cap
      const Lnow=lv[ci],Lnext=lv[ci+1];
      const dv=gelVespHr(row,Lnext)-(Lnow?gelVespHr(row,Lnow):0);
      const dg=gelOutHr(row,Lnext)-(Lnow?gelOutHr(row,Lnow):0);
      if(dv<=1e-9||dg<=0||spent+dv>vespBudgetHr+1e-6)return;   // no gain, or doesn't fit the budget
      const eff=dg/dv;
      if(eff>bEff){bEff=eff;bI=ri;bIdx=ci+1;bDv=dv;bDg=dg;}
    });
    if(bI<0)break;
    cur[bI]=bIdx;spent+=bDv;gel+=bDg;
  }
  const perLine=[];
  rows.forEach((row,ri)=>{const L=levelsFor[ri][cur[ri]];if(!L)return;
    perLine.push({__i:row.__i,max:row.max,L,gelHr:gelOutHr(row,L),vespHr:gelVespHr(row,L),frac:1});});
  return {gelHr:gel,vespHr:spent,perLine};
}
// Vespium/hr income from the user's vespium/minute figure (0 if unset → Gel off).
function gelVespBudgetHr(){return minedBudgetHr("Vespium");}
function projectDemand(){
  const gross={};ALLITEMS.forEach(it=>gross[it]=0);
  const perProject=[];
  (S.projects||[]).forEach(p=>{
    if(!p.on)return;
    const lv=p.levels||[];
    const from=Math.max(1,Math.min(lv.length,Math.floor(num(p.from)||1)));   // clamp to level count so from>levels isn't read as "complete" (issue #87)
    const to=Math.min(lv.length,Math.max(from,Math.floor(num(p.to)||lv.length)));
    // levels completed in the tracker are skipped — non-destructive progress that
    // raises the effective start level without touching the user's from→to target.
    const done=Math.max(0,Math.min(to-from+1,Math.floor(num(p.done)||0)));
    const start=from-1+done;
    if(start>=to)return;   // project fully checked off — nothing left to craft
    const sub={};ALLITEMS.forEach(it=>sub[it]=0);
    for(let i=start;i<to&&i<lv.length;i++){
      (lv[i].costs||[]).forEach(c=>{const it=c.item,q=num(c.qty)||0;if(ALLITEMS.includes(it)&&q>0){sub[it]+=q;gross[it]+=q;}});
    }
    perProject.push({id:p.id||"",name:p.name||"Project",catId:p.catId||"",prio:(p.prio!=null?p.prio:null),from:start+1,to,levels:lv.length,sub});
  });
  const inv=it=>num(S.inventory&&S.inventory[it])||0;
  const net={};ALLITEMS.forEach(it=>{net[it]=Math.max(0,gross[it]-inv(it));});
  // Frames & Wire each consume Bits that aren't in the recipe graph — fold them into Bits demand
  const ppBits=preprodBitsOf(net);
  if(ppBits>0)net.Bits=Math.max(0,(gross.Bits||0)+ppBits-inv("Bits"));
  return {gross,net,perProject};
}
// Which unavailable mined resources block this item or any product in its recipe chain?
// Passive supply of the item itself bypasses its crafting chain.
function chainMinedBlockers(item,seen){
  if(forgieHr(item)>1e-9)return [];
  seen=seen||new Set();if(seen.has(item))return [];seen.add(item);
  const out=[],cfg=MINED_CRAFTS[item];
  if(cfg&&minedBudgetHr(cfg.resource)<=0)out.push(cfg.resource);
  const rec=RECIPE[item];
  (rec&&rec.inputs||[]).forEach(k=>{
    if(PRODUCTS.includes(k))out.push(...chainMinedBlockers(k,new Set(seen)));
  });
  return [...new Set(out)];
}
// Dense single-phase simplex. Maximize c·x s.t. A x <= b (b>=0), x>=0. Bland's rule (no cycling).
function lpMaximize(c,A,b){
  const m=A.length,n=c.length,W=n+m+1;
  const T=[];
  for(let i=0;i<m;i++){const row=new Float64Array(W);for(let j=0;j<n;j++)row[j]=A[i][j];row[n+i]=1;row[W-1]=b[i];T.push(row);}
  const obj=new Float64Array(W);for(let j=0;j<n;j++)obj[j]=-c[j];T.push(obj);
  const basis=[];for(let i=0;i<m;i++)basis.push(n+i);
  for(let it=0;it<20000;it++){
    let piv=-1;for(let j=0;j<n+m;j++){if(T[m][j]<-1e-9){piv=j;break;}}   // entering (Bland)
    if(piv<0)break;
    let leave=-1,best=Infinity;
    for(let i=0;i<m;i++){const a=T[i][piv];if(a>1e-9){const r=T[i][W-1]/a;if(r<best-1e-12||(Math.abs(r-best)<1e-12&&(leave<0||basis[i]<basis[leave]))){best=r;leave=i;}}}
    if(leave<0)return {x:null,unbounded:true};
    const prow=T[leave],pv=prow[piv];
    for(let j=0;j<W;j++)prow[j]/=pv;
    for(let i=0;i<=m;i++){if(i===leave)continue;const f=T[i][piv];if(Math.abs(f)>1e-12){const ri=T[i];for(let j=0;j<W;j++)ri[j]-=f*prow[j];}}
    basis[leave]=piv;
  }
  const x=new Float64Array(n);for(let i=0;i<m;i++)if(basis[i]<n)x[basis[i]]=T[i][W-1];
  return {x};
}
// Assemble the makespan LP (A x <= b, maximize c·x) from a job-variable list. Split out of
// projectSchedule so the stability pass (issue #87 item 5) can rebuild it over a pinned subset of the
// jobs. Returns the tableau plus the z-column index and total width.
function buildScheduleLP(vars,lns,items,net,avail,D0){
  const nY=vars.length,zCol=nY,n=nY+1;
  const A=[],b=[];
  lns.forEach((ln,li)=>{const row=new Array(n).fill(0);vars.forEach((v,vi)=>{if(v.li===li)row[vi]=1;});A.push(row);b.push(1);});
  items.forEach(it=>{
    const row=new Array(n).fill(0);
    vars.forEach((v,vi)=>{if(v.item===it)row[vi]-=v.rate;v.cons.forEach(c=>{if(c.item===it)row[vi]+=c.perHr;});});
    row[zCol]=((net[it]||0)-(avail&&avail[it]||0)*STOCK_SAFETY_FRAC)/D0;
    A.push(row);b.push(isMinedResource(it)?minedBudgetHr(it):forgieHr(it));
  });
  const c=new Array(n).fill(0);c[zCol]=1;
  return {A,b,c,zCol,n};
}
// Build & solve the makespan LP: each line splits its time-fraction across (item,level) jobs so that
// net production meets the demand ratio. z = throughput multiplier (1/hr); makespan = 1/z.
// `avail` (optional) is per-item stock that may be DRAWN DOWN over the project instead of produced —
// e.g. Ingots held in inventory but never a direct project cost. Modelled as extra supply of
// avail[it]/T units/hr (T=makespan), which linearises to a +avail[it]·z/D0 term on the supply side,
// so a material fully covered by stock earns no crafting line at all (issue #73).
// `opts.stabilize` (with opts.phaseKey) opts this solve into the Tier-2 line-stability pass.
function projectSchedule(net,targets,avail,opts){
  const lns=sortedLines();
  const prodT=targets.filter(it=>PRODUCTS.includes(it));
  const rawT=targets.filter(it=>RAWS.includes(it));
  const rc=relevantChain(prodT);
  // Every mined craft is a normal LP job with its ordinary recipe inputs plus its own mined input.
  // Active mined resources join independently as constrained supplies from the user's incomes.
  const products=[...new Set([...rc.prods,...prodT])];
  const mined=activeMinedResources(products);
  const items=[...new Set([...rc.raws,...rawT,...products,...mined])];
  const itemIdx={};items.forEach((it,i)=>itemIdx[it]=i);
  // jobs: one variable per (line,item,level<=cap). Letting the LP pick the level finds the true
  // makespan-optimal compression (leans high for raw speed, eases off when materials bottleneck).
  const vars=[];
  lns.forEach((ln,li)=>{
    items.forEach(it=>{
      LEVELS.filter(L=>L<=ln.max).forEach(L=>{
        if(RAWS.includes(it)){const t=craftTime(it,L);if(!(t>0))return;const es=effSpeed(ln.sp,t);vars.push({li,item:it,lvl:L,rate:(L/t)*es*ln.dp*3600,cons:[]});}
        else if(PRODUCTS.includes(it)){const ins=RECIPE[it].inputs;const tt=craftTime(it,L);if(!(tt>0))return;
          if(!ins.every(k=>S.prodCost[it][k][L]!=null&&!isNaN(S.prodCost[it][k][L])))return;
          const es=effSpeed(ln.sp,tt),cons=ins.map(k=>({item:k,perHr:(S.prodCost[it][k][L]/tt)*es*3600}));
          const cfg=MINED_CRAFTS[it];
          if(cfg){if(!items.includes(cfg.resource))return;const c=minedCost(it,L)[cfg.resource];if(c==null||isNaN(c)||c<0)return;cons.push({item:cfg.resource,perHr:(c/tt)*es*3600});}
          vars.push({li,item:it,lvl:L,rate:(L/tt)*es*ln.dp*3600,cons});}
      });
    });
  });
  const D0=Math.max(1,...targets.map(it=>net[it]||0));   // normalize demand to keep LP coeffs sane
  // Free (unconstrained) solve — the makespan-optimal assignment, ignoring what ran last time.
  const free=buildScheduleLP(vars,lns,items,net,avail,D0);
  const zCol=free.zCol,n=free.n;
  let y=lpMaximize(free.c,free.A,free.b).x||new Float64Array(n);
  const zFree=y[zCol]||0;
  // Tier-2 hysteresis (issue #87 item 5): keep last solve's per-line jobs unless the free solve beats
  // a pinned re-solve by more than HYST_FRAC of throughput. Only real phase solves opt in
  // (opts.stabilize); the ordering/cost passes stay free so project sequencing reflects true makespans.
  let stabilized=false, stabKey=null, zPin=null;   // zPin: pinned-solve throughput (diagnostic / band test)
  if(opts&&opts.stabilize){
    // Key by phase + physical-line set + demanded-item set (sorted, so it's invariant to speed-driven
    // line reordering). Structural changes — add/remove a line, change a cap or which items are
    // demanded — bust the key and re-solve freely; speed/quantity/price edits keep it and stay stable.
    stabKey=(opts.phaseKey||"")+"||L:"+lns.slice().sort((a,b)=>a.orig-b.orig).map(l=>l.orig+":"+l.max).join(",")+"||I:"+items.slice().sort().join(",");
    const prior=_lineStability[stabKey];
    if(prior&&zFree>1e-15){
      // Restrict each physical line to the (item@lvl) jobs it ran last time (by orig, so speed-driven
      // sort reordering doesn't matter); a line with no prior record stays unpinned. Solve the reduced
      // LP and adopt it only if throughput holds within the band — otherwise the change was worth it.
      const allow=vars.map(v=>{const ps=prior[lns[v.li].orig];return ps?ps.indexOf(v.item+"@"+v.lvl)>=0:true;});
      if(allow.some(a=>!a)){
        const idxMap=[],rvars=[];
        vars.forEach((v,j)=>{if(allow[j]){idxMap.push(j);rvars.push(v);}});
        if(rvars.length){
          const pin=buildScheduleLP(rvars,lns,items,net,avail,D0);
          const y2=lpMaximize(pin.c,pin.A,pin.b).x;
          const z2=y2?(y2[pin.zCol]||0):0;
          zPin=z2/D0;
          if(y2&&z2>1e-15&&z2>=zFree*(1-HYST_FRAC)){
            const yFull=new Float64Array(n);
            for(let k=0;k<rvars.length;k++)yFull[idxMap[k]]=y2[k]||0;
            yFull[zCol]=z2;y=yFull;stabilized=true;
          }
        }
      }
    }
  }
  const rate={};items.forEach(it=>rate[it]=forgieHr(it));
  vars.forEach((v,vi)=>{const yi=y[vi]||0;if(yi<=LP_ASSIGN_EPS)return;rate[v.item]+=v.rate*yi;v.cons.forEach(c=>{rate[c.item]=(rate[c.item]||0)-c.perHr*yi;});});
  const plan=lns.map(ln=>({line:ln.orig+1,max:ln.max,sp:ln.sp,dp:ln.dp,entries:[]}));
  vars.forEach((v,vi)=>{const yi=y[vi]||0;if(yi<=LP_ASSIGN_EPS)return;plan[v.li].entries.push({item:v.item,lvl:v.lvl,frac:yi,outHr:v.rate*yi,cons:v.cons.map(c=>({item:c.item,hr:c.perHr*yi}))});});
  plan.forEach(p=>p.entries.sort((a,b)=>b.frac-a.frac));
  plan.sort((a,b)=>a.line-b.line);
  if(stabKey){   // remember this solve's per-line jobs (keyed by physical orig = plan.line-1) for next time
    const rec={};plan.forEach(p=>{const jobs=[];p.entries.forEach(e=>{const k=e.item+"@"+e.lvl;if(jobs.indexOf(k)<0)jobs.push(k);});rec[p.line-1]=jobs;});
    _lineStability[stabKey]=rec;
    const keys=Object.keys(_lineStability);if(keys.length>256)delete _lineStability[keys[0]];
  }
  return {rate,plan,items,z:(y[zCol]||0)/D0,stabilized,zFree:zFree/D0,zPin};
}
// Solve one batch of demand (a single project, or all of them combined) into a pipelined phase.
// `avail` (optional) is the stock the LP may draw down in place of producing an item (issue #73).
// `stabilize` opts this phase into the Tier-2 line-stability pass (issue #87 item 5) — set for the
// real phase solves whose plan the user sees, left off for the ordering/cost-estimation passes.
// `phaseKey` is the cache discriminator: a STABLE unique id (project id / member-id set), NOT the
// display name, so two projects sharing a name don't collide on one cache slot. Falls back to name.
function solvePhaseFor(net,name,avail,stabilize,phaseKey){
  const demandItems=ALLITEMS.filter(it=>net[it]>1e-9);
  const blockedMined={};
  demandItems.forEach(it=>{const blockers=chainMinedBlockers(it);if(blockers.length)blockedMined[it]=blockers;});
  const unsat=Object.keys(blockedMined);   // legacy item-level blocker list
  const targets=demandItems.filter(it=>!blockedMined[it]);
  // Nothing to craft is SUCCESS, not failure: a project fully covered by inventory — or whose
  // selected levels are all free — used to render a red "(blocked — see notes)" with nothing in the
  // notes, drag the whole plan's feasible flag down, and score cost=Infinity so the FREE project
  // sorted LAST. demandItems empty is the only "nothing to do" case; targets empty with demand still
  // present means everything left is blocked on a missing mined income, which stays infeasible so
  // the "Missing mined income" notice and the phase card's blocked badge tell the truth.
  if(targets.length===0)
    return {name,plan:[],balance:[],minedUsage:[],demandItems,net,rate:{},eta:0,bottleneck:null,infeasItems:[],unsat,blockedMined,atRisk:[],items:[],z:0,partial:false,feasible:demandItems.length===0};
  const sch=projectSchedule(net,targets,avail,stabilize?{stabilize:true,phaseKey:(phaseKey!=null?phaseKey:name)}:null);
  const rate={};targets.forEach(it=>rate[it]=Math.max(0,sch.rate[it]||0));
  let eta=0,bottleneck=null;const infeasItems=[];
  targets.forEach(it=>{if(rate[it]<=1e-9)infeasItems.push(it);else{const t=net[it]/rate[it];if(t>eta){eta=t;bottleneck=it;}}});
  const hasThroughput=sch.z>1e-15;
  const feasible=unsat.length===0&&infeasItems.length===0&&hasThroughput;
  const prodHr={},consHr={};sch.items.forEach(it=>{prodHr[it]=0;consHr[it]=0;});
  sch.plan.forEach(p=>p.entries.forEach(e=>{prodHr[e.item]=(prodHr[e.item]||0)+e.outHr;e.cons.forEach(c=>{consHr[c.item]=(consHr[c.item]||0)+c.hr;});}));
  const minedUsage=minedUsageFromProjectPlan(sch.plan);
  // Mined budgets are not craftable materials; their usage is displayed separately.
  // `stock` is the /hr an item is pulled from inventory (the deficit the LP left the drawdown term to cover);
  // in a project LP a shortfall is only ever legitimate stock drawdown, never a paper margin.
  const balance=sch.items.filter(it=>!MINED_RESOURCES.includes(it)).map(it=>{const prod=prodHr[it]||0,cons=consHr[it]||0,f=forgieHr(it);
    return {res:it,prod,forgie:f,cons,stock:Math.max(0,cons-prod-f)};});
  // Flag items the plan is pressed up against the safety cap on — drawing stock down with ZERO
  // crafters assigned to replenish it, close enough to the STOCK_SAFETY_FRAC ceiling that the LP
  // would draw down MORE if it were allowed to (issue #80: "no Crafters set to Ingots, yet the plan
  // needs them"). A comfortably ample stock (issue #73's case) draws far less than its cap and
  // isn't flagged — only a plan that's genuinely running an item at its structural limit is.
  const atRisk=balance.filter(b=>{
    const av=(avail&&avail[b.res])||0;
    if(av<=1e-6||b.prod>1e-6)return false;
    const used=b.stock*eta;   // total units of this item's stock the phase draws down
    return used>=STOCK_SAFETY_FRAC*av*0.98;
  }).map(b=>b.res);
  return {name,plan:sch.plan,balance,minedUsage,demandItems,net,rate,eta,bottleneck,infeasItems,unsat,blockedMined,atRisk,items:sch.items,z:sch.z,partial:!feasible&&hasThroughput,feasible,stabilized:!!sch.stabilized,zFree:sch.zFree,zPin:sch.zPin};
}
// net demand for a project's level-sum `sub`, against an inventory map (folds in Frame bits).
function projNetVec(sub,invMap){
  const net={};ALLITEMS.forEach(it=>net[it]=Math.max(0,(sub[it]||0)-(invMap[it]||0)));
  const ppBits=preprodBitsOf(net);
  if(ppBits>0)net.Bits=Math.max(0,(sub.Bits||0)+ppBits-(invMap.Bits||0));
  return net;
}
// Stock available to DRAW DOWN for each item — the inventory left after covering the item's own
// direct project demand (projNetVec already nets that). For a raw/intermediate that's never a direct
// cost (e.g. Ingots) this is its whole stock; that stock feeds its consumers so they aren't produced
// from scratch (issue #73). Complements projNetVec: net covers "make less of what I hold", this covers
// "don't make an input I already have". Symmetric Bits fold-in so pre-produced Frame/Wire Bits count.
function projAvailVec(sub,invMap){
  const net=projNetVec(sub,invMap);
  const av={};ALLITEMS.forEach(it=>av[it]=Math.max(0,((invMap&&invMap[it])||0)-(sub[it]||0)));
  const ppBits=preprodBitsOf(net);
  av.Bits=Math.max(0,((invMap&&invMap.Bits)||0)-((sub.Bits||0)+ppBits));
  return av;
}
// Assign each project an "unlock layer": 0 if it depends on no in-list unlock, else
// 1 + the deepest unlock it depends on. Edges (prerequisite → dependent) come from material
// unlocks (a project unlocking material M precedes anything whose costs include M) and from
// explicit PROJECT_PREREQS building unlocks — both only when the prerequisite project is in
// the list. Every edge runs to a strictly higher layer, so ordering by layer is a valid
// topological order (Frame Factory → Gel Refinery → Wire Tower → their consumers).
function unlockLayers(perProject){
  const n=perProject.length;
  const unlockerOf={};   // material -> index of the in-list project that unlocks it
  const idxOfCat={};     // catId -> index
  perProject.forEach((p,i)=>{const m=UNLOCKS[p.catId];if(m)unlockerOf[m]=i;if(p.catId)idxOfCat[p.catId]=i;});
  // A project's dependence on an unlock material is TRANSITIVE: Wire Tower costs no Gel directly, but
  // Wire is crafted from Gel, so it still can't start before the Gel Refinery. Expand each project's
  // direct costs through the recipe graph and test unlock materials against the whole chain, not just
  // the cost list (which left such a project on layer 0, alongside its own prerequisite).
  const chainOf=perProject.map(p=>{
    const direct=ALLITEMS.filter(it=>(p.sub[it]||0)>0);
    if(!direct.length)return new Set();
    const rc=relevantChain(direct);
    return new Set([...direct,...rc.prods,...rc.raws]);
  });
  const preds=perProject.map((p,i)=>{
    const set={};
    UNLOCK_MATERIALS.forEach(m=>{const u=unlockerOf[m];if(u!=null&&u!==i&&chainOf[i].has(m))set[u]=1;});
    (PROJECT_PREREQS[p.catId]||[]).forEach(cat=>{const u=idxOfCat[cat];if(u!=null&&u!==i)set[u]=1;});
    return Object.keys(set).map(Number);
  });
  const layer=new Array(n).fill(-1);
  const calc=(i,stack)=>{
    if(layer[i]>=0)return layer[i];
    if(stack[i])return 0;            // defensive cycle guard
    stack[i]=1;let L=0;
    preds[i].forEach(u=>{const d=calc(u,stack)+1;if(d>L)L=d;});
    stack[i]=0;return layer[i]=L;
  };
  for(let i=0;i<n;i++)calc(i,{});
  return layer;
}
// Carry inventory to the next phase: subtract this phase's direct demand AND the stock it drew down
// on intermediates (ph.balance.stock × makespan), so a later phase can't spend the same units twice.
function consumeInv(invRun,sub,ph){
  const eta=isFinite(ph.eta)?(ph.eta||0):0;
  const draw={};(ph.balance||[]).forEach(b=>{draw[b.res]=(b.stock||0)*eta;});
  // Bits burned pre-produced by this phase's Frames/Wire crafts are invisible to `sub` (not a recipe
  // input, so no cost line lists them) AND to `balance` (never a solver resource for these products).
  // Without this the next phase re-nets against Bits stock this phase already spent, and ph.invStart
  // reports an "on hand" figure the player doesn't have. ph.net is the post-inventory net, the same
  // basis projNetVec folds these Bits in from — minus any item the phase never actually crafted
  // because a mined income is missing (blockedMined): its Bits were never burned.
  const blocked=ph.blockedMined||{};
  const ppNet={Frames:blocked.Frames?0:((ph.net&&ph.net.Frames)||0),
               Wire:blocked.Wire?0:((ph.net&&ph.net.Wire)||0)};
  draw.Bits=(draw.Bits||0)+preprodBitsOf(ppNet);
  ALLITEMS.forEach(it=>{invRun[it]=Math.max(0,(invRun[it]||0)-(sub[it]||0)-(draw[it]||0));});
  // Credit the OVERSHOOT forward. A phase runs until its slowest item is done, so every item that
  // finished earlier keeps producing to the end of the phase: rate×eta units made against net needed.
  // Only "set & forget" overshoots meaningfully — it can't re-task a line that's finished its quota,
  // so a 2000-Glass + 50-Bricks phase hands the next one hundreds of spare Bricks. Throwing those
  // away made the next phase re-craft what the player already has sitting in storage. The splitting
  // LP lands every item on the makespan, so this is ~0 there and split plans are unchanged.
  const sur={};
  ALLITEMS.forEach(it=>{
    const made=((ph.rate&&ph.rate[it])||0)*eta, need=((ph.net&&ph.net[it])||0);
    if(made>need){sur[it]=made-need;invRun[it]=(invRun[it]||0)+sur[it];}});
  // Surplus Frames/Wire aren't free: every one of them burned its pre-produced Bits too, and the
  // draw above only charged the Bits for the DEMANDED units. Crediting the spare Frames without
  // debiting their Bits would hand the next phase Bits stock the player already fed into the
  // crafters — the same class of drift the preprodBitsOf(draw) line exists to kill. (The display-side
  // "Bits to pre-produce" readout already assumes the line runs full-time, so this matches it.)
  const surBits=preprodBitsOf(sur);
  if(surBits>0)invRun.Bits=Math.max(0,(invRun.Bits||0)-surBits);
}
function buildProjectPhases(seq,net,perProject){
  const layer=unlockLayers(perProject);
  const maxL=perProject.length?Math.max.apply(null,layer):0;
  const invStart=()=>{const o={};ALLITEMS.forEach(it=>o[it]=num(S.inventory&&S.inventory[it])||0);return o;};
  if(!seq){
    // Single combined phase when nothing is gated, or when the user has turned unlock gating
    // off (projectGate===false) to craft the whole list at once, ignoring unlock waves.
    if(maxL===0||S.projectGate===false){
      const sumSub={};ALLITEMS.forEach(it=>sumSub[it]=perProject.reduce((s,p)=>s+(p.sub[it]||0),0));
      const inv0=invStart();
      const combKey=perProject.length>1?perProject.map(p=>p.id).sort().join("+"):perProject[0].id;
      const ph=solvePhaseFor(net,perProject.length>1?"All projects":perProject[0].name,projAvailVec(sumSub,inv0),true,combKey);
      ph.demandSub=sumSub;ph.invStart=inv0;   // stock on hand when this phase begins (issue #87 on-hand projection)
      ph.doneAt=ph.eta;return [ph];
    }
    // unlocks force ordered "waves": combine within a layer, sequence the layers, carrying
    // crafted surplus forward as inventory so later waves only make what's still missing.
    const invRun=invStart();let cum=0;const phases=[];
    for(let L=0;L<=maxL;L++){
      const members=perProject.filter((_,i)=>layer[i]===L);
      if(!members.length)continue;
      const sumSub={};ALLITEMS.forEach(it=>sumSub[it]=members.reduce((s,p)=>s+(p.sub[it]||0),0));
      const inv0=Object.assign({},invRun);   // snapshot before consumeInv draws it down for the next wave
      const ph=solvePhaseFor(projNetVec(sumSub,invRun),members.map(m=>m.name).join(" + "),projAvailVec(sumSub,invRun),true,members.map(m=>m.id).sort().join("+"));
      ph.members=members.map(m=>m.name);ph.demandSub=sumSub;ph.wave=phases.length+1;ph.invStart=inv0;
      consumeInv(invRun,sumSub,ph);
      cum+=ph.eta;ph.doneAt=cum;phases.push(ph);
    }
    return phases;
  }
  // sequenced: one project per phase, ordered by (unlock layer, manual priority, cheapest makespan)
  const invInit=invStart();
  const cost=perProject.map(p=>{const ph=solvePhaseFor(projNetVec(p.sub,invInit),p.name,projAvailVec(p.sub,invInit));return ph.feasible?ph.eta:Infinity;});
  const order=perProject.map((p,i)=>({p,i})).sort((a,b)=>{
    if(layer[a.i]!==layer[b.i])return layer[a.i]-layer[b.i];   // unlock precedence (hard)
    const pa=a.p.prio,pb=b.p.prio;
    if(pa!=null&&pb!=null){if(pa!==pb)return pa-pb;}            // manual order, lower first
    else if(pa!=null)return -1;
    else if(pb!=null)return 1;
    // else cheapest makespan. Infeasible/blocked projects cost Infinity and sink to the back of
    // their layer; two of them compare equal rather than Infinity-Infinity = NaN (an inconsistent
    // comparator, which V8's sort is free to turn into an arbitrary order).
    const ca=cost[a.i],cb=cost[b.i];
    if(!isFinite(ca)&&!isFinite(cb))return 0;
    return ca-cb;
  });
  const invRun=invStart();let cum=0;const phases=[];
  order.forEach(({p})=>{
    const inv0=Object.assign({},invRun);   // snapshot before consumeInv draws it down for the next phase
    const ph=solvePhaseFor(projNetVec(p.sub,invRun),p.name,projAvailVec(p.sub,invRun),true,p.id);
    ph.prio=(p.prio!=null?p.prio:null);ph.demandSub=p.sub;ph.invStart=inv0;
    consumeInv(invRun,p.sub,ph);
    cum+=ph.eta;ph.doneAt=cum;phases.push(ph);
  });
  return phases;
}
// Display summary of the Gel a phase's LP chose to forge (which lines, total Gel/hr and vespium
// burn), derived from the solution — Gel is a normal LP output now, not a reserved subset.
function gelReservedFromPlan(plan){
  const perLine=[];let outHr=0,vespHr=0;
  (plan||[]).forEach(p=>(p.entries||[]).forEach(e=>{if(e.item!==GEL)return;
    const ct=craftTime(GEL,e.lvl),v=ct>0?(gelOreCost(e.lvl).vesp/ct)*effSpeed(p.sp,ct)*(e.frac||0)*3600:0;
    outHr+=e.outHr||0;vespHr+=v;
    perLine.push({__i:p.line-1,max:p.max,L:e.lvl,gelHr:e.outHr||0,vespHr:v,frac:e.frac});}));
  return perLine.length?{lines:perLine.length,outHr,vespHr,perLine}:null;
}
function minedUsageFromProjectPlan(plan){
  const by={};
  (plan||[]).forEach(p=>(p.entries||[]).forEach(e=>{const cfg=MINED_CRAFTS[e.item];if(!cfg)return;
    const ct=craftTime(e.item,e.lvl),craftsHr=ct>0?(effSpeed(p.sp,ct)/ct)*(e.frac||0)*3600:0;
    Object.entries(minedCost(e.item,e.lvl)).forEach(([resource,cost])=>{
      const inputHr=cost*craftsHr,key=e.item+"\u0000"+resource;
      if(!by[key])by[key]={item:e.item,resource,lines:0,outHr:0,inputHr:0,perLine:[],_lines:{}};
      const use=by[key];if(!use._lines[p.line]){use._lines[p.line]=1;use.lines++;}
      use.outHr+=e.outHr||0;use.inputHr+=inputHr;
      use.perLine.push({line:p.line,lvl:e.lvl,outHr:e.outHr||0,inputHr,frac:e.frac||0});
    });
  }));
  return Object.values(by).map(use=>{delete use._lines;return use;});
}
// Top of project mode: builds one combined phase, or a sequence of per-project phases
// (forced-"do first" projects ahead, then cheapest-makespan first), with inventory carried across.
function optimizeProjectTop(){
  const {gross,net,perProject}=projectDemand();
  const t0=performance.now();
  if(perProject.length===0)return {empty:true,mode:"project",plan:[],phases:[],gross,net,perProject};
  const seq=S.projectSeq!==false&&perProject.length>1;
  // Gel is forged natively by each phase's LP (vespium budget = a constrained resource), so there's
  // no line-reservation sweep — solve the phases directly.
  const phases=buildProjectPhases(seq,net,perProject);
  const waved=!seq&&phases.length>1;   // all-at-once split into unlock-ordered waves
  const single=!seq&&S.projectGate===false&&perProject.length>1;   // gating off — one combined phase
  const eta=phases.reduce((s,ph)=>s+ph.eta,0);
  const feasible=phases.length>0&&phases.every(ph=>ph.feasible);
  const unsat=[...new Set([].concat(...phases.map(ph=>ph.unsat||[])))];
  const blockedMined={};phases.forEach(ph=>Object.entries(ph.blockedMined||{}).forEach(([it,resources])=>{
    blockedMined[it]=[...new Set([...(blockedMined[it]||[]),...resources])];
  }));
  const partial=!feasible&&phases.some(ph=>ph.z>1e-15);
  const infeasItems=[...new Set([].concat(...phases.map(ph=>ph.infeasItems||[])))];
  const atRiskItems=[...new Set([].concat(...phases.map(ph=>ph.atRisk||[])))];
  const main=phases[0]||{plan:[],balance:[],rate:{},demandItems:[],bottleneck:null};
  // sequenced/waved/single describe the SHAPE of this solve and other renderers depend on that: with
  // one project left there is nothing to sequence, so `seq` is false and every phase-shaped readout
  // is right. The header copy is a different question — it tells the user what their Shopping-list
  // toggles are set to, and "all projects together" is a lie when the toggle says one-at-a-time.
  // Carry the raw settings alongside so results.js can word the header from them (see projOrderMode).
  return {empty:false,mode:"project",sequenced:seq,waved,single,
    orderSeqSetting:S.projectSeq!==false,orderGateSetting:S.projectGate!==false,
    phases,perProject,gross,net,
    plan:main.plan,balance:main.balance,
    demandItems:(seq||waved)?ALLITEMS.filter(it=>net[it]>1e-9):main.demandItems,
    rate:main.rate,bottleneck:main.bottleneck,eta,unsat,blockedMined,infeasItems,atRiskItems,partial,feasible,
    minedUsage:main.minedUsage||[],
    gelReserved:gelReservedFromPlan(main.plan),
    objective:feasible&&eta>0?1/eta:0,ms:performance.now()-t0};
}


function optimize(){
  if(S.mode==="project")return optimizeProjectTop();
  // Gel is a native resource inside solveCore now (vespium is its budgeted input), so items and
  // credits need no reservation sweep — the solver allocates Gel lines like any other product.
  return optimizeInner();
}
