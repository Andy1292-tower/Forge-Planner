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
function cloneLineStability(value){
  if(Array.isArray(value))return value.map(cloneLineStability);
  if(!value||typeof value!=="object")return value;
  const out={};Object.keys(value).forEach(key=>{Object.defineProperty(out,key,{value:cloneLineStability(value[key]),enumerable:true,writable:true,configurable:true});});return out;
}
function makeLineStabilityUpdate(key,plan){
  if(typeof key!=="string"||!key)return null;
  const record={};(plan||[]).forEach(line=>{const jobs=[];(line.entries||[]).forEach(entry=>{
    const job=entry.item+"@"+entry.lvl;if(jobs.indexOf(job)<0)jobs.push(job);
  });record[line.line-1]=jobs;});
  return {key,record};
}
function lineStabilityWithUpdates(cache,updates){
  const next=cloneLineStability(cache&&typeof cache==="object"?cache:{});
  (updates||[]).forEach(update=>{if(update&&typeof update.key==="string"&&update.key)next[update.key]=cloneLineStability(update.record||{});});
  const keys=Object.keys(next);while(keys.length>256)delete next[keys.shift()];
  return next;
}
function commitLineStabilityUpdates(updates,base){
  const next=lineStabilityWithUpdates(base===undefined?_lineStability:base,updates);setLineStability(next);return next;
}
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

// One solve control owns one absolute deadline. Credits shares the same instance across every
// candidate, so starting a new candidate can never restart the user's clock. The optional hooks are
// direct-source test seams: they are never persisted or posted through the Worker protocol.
function makeSolveControl(timeBudget,options){
  const opts=options||{},clock=typeof opts.now==="function"?opts.now:()=>performance.now();
  const observer=typeof opts.onCheckpoint==="function"?opts.onCheckpoint:null;
  const budget=Math.max(0,Number(timeBudget)||0),workLimit=Number.isFinite(opts.workLimit)?Math.max(0,Math.floor(opts.workLimit)):Infinity;
  let lastNow=Number(clock());if(!Number.isFinite(lastNow))lastNow=0;
  const startedAt=lastNow,deadline=startedAt+budget;
  let work=0,stopped=false,deadlineReached=false,reason=null;
  const emit=event=>{if(observer)observer(event);};
  const readNow=()=>{let value=Number(clock());if(!Number.isFinite(value))value=lastNow;if(value<lastNow)value=lastNow;lastNow=value;return value;};
  const checkpoint=(label,cost)=>{
    if(stopped)return false;
    const units=Math.max(1,Math.floor(Number(cost)||1));
    if(work+units>workLimit){stopped=true;deadlineReached=true;reason="work";emit({type:"stopped",label,reason,work,elapsed:lastNow-startedAt});return false;}
    work+=units;
    const now=readNow();
    if(now>=deadline){stopped=true;deadlineReached=true;reason="deadline";emit({type:"stopped",label,reason,work,elapsed:now-startedAt});return false;}
    emit({type:"checkpoint",label,work,elapsed:now-startedAt});return true;
  };
  const event=(type,data)=>emit(Object.assign({type,work,elapsed:lastNow-startedAt},data||{}));
  const refreshDeadline=()=>{
    if(deadlineReached)return true;
    const now=readNow();
    if(now>=deadline){stopped=true;deadlineReached=true;reason="deadline";emit({type:"stopped",label:"result-finalize",reason,work,elapsed:now-startedAt});}
    return deadlineReached;
  };
  return {__forgeSolveControl:true,startedAt,deadline,checkpoint,event,readNow,
    elapsed:()=>Math.max(0,lastNow-startedAt),work:()=>work,
    isStopped:()=>stopped,deadlineReached:refreshDeadline,reason:()=>reason};
}

// Core solver: weighted max-min throughput for a set of product targets over their input
// chain. Priority weights set the desired output RATIO. Each line has a duplication chance
// (output ×(1+dup), input cost unchanged) and a margin tolerance allows a small paper
// shortfall ("may-work" plans). Anytime: multi-start + iterated local search seed a near-
// optimal feasible plan, then a wall-clock-bounded branch-and-bound proves/refines it.
// Finally, a tie-break pass minimises total input shortfall among plans tied on the
// objective, so a deficit the targets can't use (free to close from surplus feeders) gets
// closed instead of left on the margin as a phantom "may-work" plan.
function solveCore(targets,w,relProds,relRaws,timeBudget,options){
  const opts=options||{},control=opts.control&&opts.control.__forgeSolveControl?opts.control:makeSolveControl(timeBudget,opts);
  const solveStarted=control.readNow();
  const localWorkStart=control.work(),localWorkLimit=Number.isFinite(opts.localWorkLimit)?Math.max(0,Math.floor(opts.localWorkLimit)):Infinity;
  let interrupted=false,localLimitReached=false;
  const keepGoing=label=>{
    if(control.work()-localWorkStart>=localWorkLimit){
      interrupted=true;localLimitReached=true;control.event("local-work-limit",{label});return false;
    }
    if(control.checkpoint(label))return true;interrupted=true;return false;
  };
  // Each mined resource joins only when its craft is in the chain and it has a positive budget.
  // Its produced>=consumed balance then enforces that resource's burn independently.
  const mined=activeMinedResources(relProds);
  const resources=[...relRaws,...relProds,...mined];
  const resIndex={};resources.forEach((r,i)=>resIndex[r]=i);
  const R=resources.length;
  const tIdx=targets.map(t=>resIndex[t]);
  const tol=opts.tolOverride!=null
    ?Math.max(0,Math.min(0.5,Number(opts.tolOverride)||0))
    :boundedPersistedField("margin",S.margin,0,0,20)/100;
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
  const requestedCeiling=Number(opts.maxCompression),hasCeiling=Number.isFinite(requestedCeiling)&&requestedCeiling>0;
  const jobMax=sorted.map(line=>hasCeiling?Math.min(line.max,requestedCeiling):line.max);
  jobMax.forEach(max=>{if(!jobsByMax[max])jobsByMax[max]=buildJobs(max,resIndex,relRaws,relProds,targets,w);});
  const lineJobs=jobMax.map(max=>jobsByMax[max]);
  const N=sorted.length;
  // effective speed per (line, job): a craft can't run under 1s real time, so speed is capped at the craft's cycle seconds (ct)
  const spEff=lineJobs.map((js,i)=>{const sp=sorted[i].sp;return js.map(j=>(j.ct>0&&sp>j.ct)?j.ct:sp);});
  const sameAsPrev=sorted.map((s,i)=>i>0&&jobMax[i]===jobMax[i-1]&&s.sp===sorted[i-1].sp&&s.dp===sorted[i-1].dp);
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

  let nodes=0;let capped=false;const tStart=solveStarted;let tLastGain=tStart;
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
      if(!keepGoing("repair-pass"))return null;
      evalChoice(ch);const D=totalDeficit();if(D<=1e-7)break;
      let bI=-1,bJ=-1,bRed=1e-12;
      for(let i=0;i<N;i++){const old=ch[i],js=lineJobs[i];
        for(let k=0;k<js.length;k++){if(k===old)continue;
          if(!keepGoing("repair-job")){ch[i]=old;evalChoice(ch);return null;}
          ch[i]=k;evalChoice(ch);const red=D-totalDeficit();if(red>bRed){bRed=red;bI=i;bJ=k;}}
        ch[i]=old;evalChoice(ch);}
      if(bI<0)break;ch[bI]=bJ;
    }
    evalChoice(ch);return feasibleNow();
  }
  // hill-climb the objective with single-line best-improvement moves, staying feasible
  function climb(ch){
    let cur=scoreNow();
    for(let pass=0;pass<N+3;pass++){
      if(!keepGoing("climb-pass"))return null;
      let improved=false;
      for(let i=0;i<N;i++){const old=ch[i];let bk=old,bs=cur;
        const js=lineJobs[i];for(let k=0;k<js.length;k++){if(k===old)continue;
          if(!keepGoing("climb-job")){ch[i]=old;evalChoice(ch);return null;}
          ch[i]=k;evalChoice(ch);if(feasibleNow()){const s=scoreNow();if(s>bs+EPS){bs=s;bk=k;}}}
        ch[i]=bk;if(bk!==old){cur=bs;improved=true;}else evalChoice(ch);
      }
      if(!improved)break;
    }
    return cur;
  }
  // full local optimisation from a starting choice; returns its score or null if infeasible
  function localOpt(ch){const repaired=repair(ch);if(repaired!==true)return null;const sc=climb(ch);if(sc==null)return null;evalChoice(ch);return feasibleNow()?sc:null;}
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
      if(!keepGoing("deficit-pass"))return null;
      let improved=false;
      for(let i=0;i<N;i++){const old=ch[i],js=lineJobs[i];let bk=old,bD=curD;
        for(let k=0;k<js.length;k++){if(k===old)continue;
          if(!keepGoing("deficit-job")){ch[i]=old;evalChoice(ch);return null;}
          ch[i]=k;evalChoice(ch);
          if(feasibleNow()&&scoreNow()>=targetScore-EPS){const d=totalDeficit();if(d<bD-1e-9){bD=d;bk=k;}}}
        ch[i]=bk;evalChoice(ch);if(bk!==old){curD=bD;improved=true;}}
      if(!improved)break;
    }
    return ch;
  }
  let _rng=0x2545f491>>>0;const rnd=()=>{_rng^=_rng<<13;_rng^=_rng>>>17;_rng^=_rng<<5;_rng>>>=0;return _rng/4294967296;};
  function finishCoreResult(){
    // Distinguish a failed in-work checkpoint from the deadline first being observed while the
    // completed result is serialized. The latter remains valid, but is capped and stops later work.
    const workInterrupted=control.isStopped();
    const deadlineReached=control.deadlineReached();if(deadlineReached)capped=true;
    let usesMargin=false;for(let r=0;r<R;r++)if(best.produced[r]<best.consumed[r]-1e-6)usesMargin=true;
    const forgie={};resources.forEach((r,i)=>forgie[r]=baseArr[i]*3600);
    return {best,sorted,lineJobs,resources,resIndex,R,N,tIdx,tol,capped,usesMargin,issues,forgie,
      feasible:best.score>1e-9,interrupted:workInterrupted,localLimitReached,ms:Math.max(0,control.elapsed()-(solveStarted-control.startedAt))};
  }
  function targetChoice(res){const ch=new Array(N);for(let i=0;i<N;i++){const bj=bestJobFor(i,res);ch[i]=bj>=0?bj:idleIdx(i);}return ch;}
  function choiceFromPlan(plan){
    if(!Array.isArray(plan))return null;
    const byLine={};plan.forEach(row=>{if(row&&row.line!=null)byLine[row.line-1]=row.job;});
    const ch=new Array(N);
    for(let i=0;i<N;i++){
      const job=byLine[sorted[i].orig];let pick=idleIdx(i);
      if(job&&job.kind!=="idle"){
        const found=lineJobs[i].findIndex(candidate=>candidate.kind===job.kind&&candidate.res===job.res&&candidate.lvl===job.lvl);
        if(found>=0)pick=found;
      }
      ch[i]=pick;
    }
    return ch;
  }

  // The Credits comparison first gives every priced product the same finite constructive baseline:
  // a zero-output idle lower bound plus one target-dedicated seed (and one bounded Gel loadout seed
  // for Gel), under a deterministic per-product work cap. It deliberately skips LP, randomized
  // seeds, ILS and DFS. Reaching the local cap keeps the valid idle/best-completed lower bound;
  // only the shared absolute deadline discards the partial candidate and leaves later rows unevaluated.
  if(opts.baselineOnly){
    curTol=tol;capped=true;
    if(!keepGoing("baseline-product-start"))return finishCoreResult();
    const idleChoice=new Array(N);for(let i=0;i<N;i++)idleChoice[i]=idleIdx(i);
    evalChoice(idleChoice);const idleScore=feasibleNow()?scoreNow():0;
    best={score:idleScore,choice:idleChoice.slice(),produced:produced.slice(),consumed:consumed.slice()};
    let baselineInc={sc:idleScore,ch:idleChoice.slice()};
    const baselineSeed=ch=>{const sc=localOpt(ch);if(sc!=null&&!interrupted&&(!baselineInc||sc>baselineInc.sc))baselineInc={sc,ch:ch.slice()};};
    if(targets.length===1&&targets[0]===GEL&&resIndex[VESP]!=null&&minedBudgetHr(VESP)>0){
      const byOrig={};sorted.forEach((line,index)=>byOrig[line.orig]=index);
      const loadout=gelSeedLoadout(lineRows(),minedBudgetHr(VESP),{checkpoint:keepGoing});
      if(loadout.interrupted)interrupted=true;
      else{const gelChoice=new Array(N);for(let i=0;i<N;i++)gelChoice[i]=idleIdx(i);
        loadout.perLine.forEach(row=>{const i=byOrig[row.__i];if(i==null)return;
          const job=lineJobs[i].findIndex(candidate=>candidate.kind==="craft"&&candidate.res===GEL&&candidate.lvl===row.L);if(job>=0)gelChoice[i]=job;});
        baselineSeed(gelChoice);}
    }
    if(!interrupted)baselineSeed(targetChoice(tIdx[0]));
    if(baselineInc&&!interrupted){
      const ch=baselineInc.ch;evalChoice(ch);best={score:scoreNow(),choice:ch.slice(),produced:produced.slice(),consumed:consumed.slice()};
      if(best.score>EPS&&N>0){const balanced=minDeficitAtScore(best.choice.slice(),best.score);
        if(balanced&&!interrupted){evalChoice(balanced);best={score:scoreNow(),choice:balanced.slice(),produced:produced.slice(),consumed:consumed.slice()};}}
    }
    if(!interrupted)keepGoing("baseline-product-complete");
    return finishCoreResult();
  }

  function dfs(i,prevIdx){
    nodes++;
    if(!keepGoing("dfs-node")){capped=true;return;}
    const _n=control.readNow();if(_n-tLastGain>convergeWindow)capped=true;
    if(capped)return;
    if(i===N){
      for(let r=0;r<R;r++)if(produced[r]<consumed[r]*needFrac(r)-1e-7)return;
      let sc=Infinity;
      for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]];sc=Math.min(sc,net/w[k]);}
      if(sc>best.score+EPS){best={score:sc,choice:choice.slice(),produced:produced.slice(),consumed:consumed.slice()};tLastGain=control.readNow();}
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
    for(let i=0;i<N;i++){if(!keepGoing("lp-offset"))return {interrupted:true};offs.push(nv);nv+=lineJobs[i].length;}
    const zc=nv,n=nv+1,A=[],b=[];
    for(let i=0;i<N;i++){if(!keepGoing("lp-line-row"))return {interrupted:true};const row=new Float64Array(n);for(let j=0;j<lineJobs[i].length;j++)row[offs[i]+j]=1;A.push(row);b.push(1);}
    const tw={};targets.forEach((t,k)=>tw[tIdx[k]]=w[k]);
    for(let r=0;r<R;r++){
      if(!keepGoing("lp-resource-row"))return {interrupted:true};
      const row=new Float64Array(n);
      for(let i=0;i<N;i++)for(let j=0;j<lineJobs[i].length;j++){
        if(!keepGoing("lp-job-coefficient"))return {interrupted:true};
        const job=lineJobs[i][j],sp=spEff[i][j],dp=sorted[i].dp;let net=0;
        for(const[rr,a]of job.prod)if(rr===r)net+=a*sp*dp;
        for(const[rr,a]of job.cons)if(rr===r)net-=a*sp;
        if(net)row[offs[i]+j]=-net;}
      if(tw[r]!==undefined)row[zc]=tw[r];
      A.push(row);b.push(baseArr[r]);
    }
    const c=new Float64Array(n);c[zc]=1;
    const sol=lpMaximize(c,A,b,control);
    if(!sol.x)return null;
    const choice=new Array(N),frac=[];
    for(let i=0;i<N;i++){let bj=0,bf=-1;const fr=new Array(lineJobs[i].length);
      for(let j=0;j<lineJobs[i].length;j++){const f=sol.x[offs[i]+j]||0;fr[j]=f>0?f:0;if(f>bf){bf=f;bj=j;}}
      choice[i]=bj;frac.push(fr);}
    return {z:sol.x[zc]||0,choice,frac,complete:sol.complete!==false,interrupted:!!sol.interrupted};
  }
  // multi-start local search: diversified roundings of the LP relaxation + one seed per target,
  // then iterated local search. Pure argmax rounding flattens lines the LP split between Gel and a
  // target and loses a lot, so we also draw several randomized roundings weighted by the LP fractions.
  const lp=N>0?lpRelax():null;
  if(interrupted){capped=true;return finishCoreResult();}
  // Two-pass margin search for monotonicity (issue #60). A plan feasible with NO margin is feasible
  // at ANY margin with the same objective, so we solve strict (tol=0) first, then seed the relaxed
  // pass with that strict optimum — the margin result can only match or beat the no-margin result,
  // never fall below it. With no margin there's a single pass (identical to before). Both passes
  // share the wall-clock budget (tStart is global); each gets a fresh convergence window and
  // incumbent so an easy factory still has time left to exploit the margin.
  const stages=tol>0?[0,tol]:[tol];
  let carry=choiceFromPlan(opts.initialPlan),finalExhaustive=false;
  for(let si=0;si<stages.length;si++){
  if(!keepGoing("margin-stage"))break;
  curTol=stages[si];capped=false;tLastGain=control.readNow();
  let inc=null;
  const trySeed=ch=>{if(!ch||interrupted||!keepGoing("seed-start"))return false;const c=ch.slice();const sc=localOpt(c);
    if(sc!=null&&!interrupted&&(!inc||sc>inc.sc)){inc={sc,ch:c.slice()};tLastGain=control.readNow();}return !interrupted;};
  if(carry)trySeed(carry);   // strict optimum seeds the relaxed pass -> never drops below no-margin
  // The seed set is fixed (budget-independent) on purpose: the ilsT/DFS caps are measured from the
  // solve start, so seeds just consume part of the budget rather than extending it — and a fixed set
  // keeps the search trajectory monotonic in budget (more time never yields a worse plan).
  if(!interrupted&&lp&&lp.z>EPS){
    trySeed(lp.choice);
    for(let t=0;t<16&&!interrupted;t++){if(!keepGoing("lp-random-seed"))break;const ch=new Array(N);
      for(let i=0;i<N&&!interrupted;i++){if(!keepGoing("lp-random-line"))break;const fr=lp.frac[i];let s=0;for(let j=0;j<fr.length;j++)s+=fr[j];
        let x=rnd()*(s>1e-12?s:1),pick=lp.choice[i];
        for(let j=0;j<fr.length;j++){x-=fr[j];if(x<=0){pick=j;break;}}
        ch[i]=pick;}
      trySeed(ch);}
  }
  // Reservation-style seeds: dedicate the k best Gel-efficiency lines to Gel with a bounded
  // heuristic, and let localOpt fill the rest. This helper is seed-only: unlike the exact modal
  // capacity calculation, it makes no maximum claim and stays cheap across prefixes/candidates.
  const gelBudgetHr=minedBudgetHr(VESP);
  if(!interrupted&&resIndex[VESP]!=null&&gelBudgetHr>0){
    const o2s={};sorted.forEach((s,i)=>o2s[s.orig]=i);
    const ranked=lineRows().sort((a,b)=>gelOutHr(b,b.max)-gelOutHr(a,a.max));
    for(let k=1;k<=ranked.length;k++){
      if(!keepGoing("gel-prefix"))break;
      const lo=gelSeedLoadout(ranked.slice(0,k),gelBudgetHr,control);
      if(lo.interrupted){interrupted=true;break;}
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
  if(!interrupted&&lp&&targets.length===1){
    const tgt=tIdx[0],tgtRes=resources[tgt];
    const arg=[];for(let i=0;i<N;i++){let bj=0,bf=-1;const fr=lp.frac[i];for(let j=0;j<fr.length;j++)if(fr[j]>bf){bf=fr[j];bj=j;}arg.push(lineJobs[i][bj]);}
    const feeders=[...new Set(arg.filter(j=>j&&j.kind!=="idle"&&j.res!==tgtRes).map(j=>j.res))];
    const roleJob=(li,res)=>{let bj=-1,bl=-1;const js=lineJobs[li];for(let k=0;k<js.length;k++){const j=js[k];if((j.kind==="craft"||j.kind==="produce")&&j.res===res&&j.lvl>bl){bl=j.lvl;bj=k;}}return bj;};
    const tgtSeed=i=>{const js=lineJobs[i];for(let k=0;k<js.length;k++)if(js[k].kind==="craft"&&js[k].res===tgtRes&&js[k].lvl<=8)return k;const b=bestJobFor(i,tgt);return b>=0?b:idleIdx(i);};
    if(feeders.length&&feeders.length<=4){
      let tried=0;const cap=350;
      const rec=(fi,used)=>{
        if(tried>=cap||interrupted)return;
        if(!keepGoing("role-enumeration"))return;
        if(fi===feeders.length){const ch=new Array(N);for(let i=0;i<N;i++)ch[i]=tgtSeed(i);
          for(let k=0;k<feeders.length;k++){const bj=roleJob(used[k],feeders[k]);if(bj>=0)ch[used[k]]=bj;}
          trySeed(ch);tried++;return;}
        for(let i=N-1;i>=0&&tried<cap;i--){if(used.indexOf(i)>=0)continue;rec(fi+1,used.concat(i));}  // fastest-first
      };
      rec(0,[]);
    }
  }
  const targetResources=targets.map(t=>resIndex[t]);
  for(let ti=0;ti<targetResources.length&&!interrupted;ti++){
    if(!keepGoing("target-seed"))break;
    const ch=targetChoice(targetResources[ti]),sc=localOpt(ch);
    if(sc!=null&&!interrupted&&(!inc||sc>inc.sc)){inc={sc,ch:ch.slice()};tLastGain=control.readNow();}
  }
  if(inc&&N>0){
    // ILS gets the bulk of the budget so accuracy scales with the user's max-time setting: at high
    // line counts the exact DFS caps out without beating the heuristic, so perturbing the incumbent
    // is the productive use of extra time. A stagnation cutoff stops once perturbation stops paying
    // off, so an easy factory — or a generous budget on a simple one — doesn't burn time it can't use.
    // ILS uses an iteration-based stagnation cutoff (not wall-clock): stopping at a fixed iteration
    // is budget-independent, which keeps the result monotonic in budget. The single-target case
    // (each credits item) converges in a handful of iterations, so it gets a much smaller limit.
    const stagLimit=targets.length>1?8000:1200;let stag=0;
    for(let it=0;it<2000000&&!interrupted;it++){
      if(stag>stagLimit||!keepGoing("ils-iteration"))break;
      const ch=inc.ch.slice();const k=1+((rnd()*2)|0);
      for(let m=0;m<=k;m++){if(!keepGoing("ils-perturb"))break;const li=(rnd()*N)|0,js=lineJobs[li];ch[li]=(rnd()*js.length)|0;}
      if(interrupted)break;
      const sc=localOpt(ch);if(sc!=null&&!interrupted&&sc>inc.sc+EPS){inc={sc,ch:ch.slice()};stag=0;tLastGain=control.readNow();}else if(!interrupted)stag++;
    }
    evalChoice(inc.ch);best={score:scoreNow(),choice:inc.ch.slice(),produced:produced.slice(),consumed:consumed.slice()};
  }
  if(interrupted){capped=true;break;}
  produced.set(baseArr);consumed.fill(0);
  // LP z bounds the integer optimum; if the incumbent already reaches it, the search is done.
  let stageExhaustive=!!(lp&&lp.complete&&curTol===0&&best.score>=lp.z-1e-6*Math.max(1,lp.z));
  if(!stageExhaustive){dfs(0,0);stageExhaustive=!capped&&!interrupted;}
  // balance any free deficit out of the now-optimal plan (keeps the objective, trims the margin use)
  if(!interrupted&&best.score>EPS&&N>0){
    const ch=minDeficitAtScore(best.choice.slice(),best.score);
    if(ch&&!interrupted){evalChoice(ch);best={score:scoreNow(),choice:ch.slice(),produced:produced.slice(),consumed:consumed.slice()};}
  }
  if(si===stages.length-1)finalExhaustive=stageExhaustive&&!interrupted;
  carry=best.choice.slice();   // hand this pass's optimum to the next (relaxed) pass as a floor
  }
  capped=!finalExhaustive;
  return finishCoreResult();
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
function creditsRefinementIsNondecreasing(prior,refined){return !!prior&&!!refined&&refined.credits>=prior.credits;}
// Dedicate every line to producing one raw material (raws have no inputs).
function solveRaw(Rw,control){
  let total=0;const plan=[];const resIndex={[Rw]:0};
  const lines=sortedLines();
  for(let si=0;si<lines.length;si++){const s=lines[si];
    if(control&&!control.checkpoint("raw-line"))return {item:Rw,kind:"raw",out:0,plan:null,balance:null,resIndex,capped:false,feasible:false,interrupted:true};
    const allowed=LEVELS.filter(L=>L<=s.max);let bst=null;
    // pick the level that maximises floored output (effective speed capped at the cycle time)
    for(let li=0;li<allowed.length;li++){if(control&&!control.checkpoint("raw-level"))return {item:Rw,kind:"raw",out:0,plan:null,balance:null,resIndex,capped:false,feasible:false,interrupted:true};
      const L=allowed[li],t=craftTime(Rw,L);if(t>0){const out=(L/t)*(s.sp>t?t:s.sp);if(!bst||out>bst.out)bst={rate:L/t,L,t,out};}}
    const job=bst?{kind:"produce",res:Rw,lvl:bst.L,ct:bst.t,prod:[[0,bst.rate]],cons:[]}:{kind:"idle",res:null,lvl:null,prod:[],cons:[]};
    if(bst)total+=bst.out*s.dp;
    plan[s.orig]={line:s.orig+1,max:s.max,spx:s.sp,dup:(s.dp-1)*100,sp:s.sp,dp:s.dp,job};
  }
  const fHr=forgieHr(Rw);   // Lil' Forgie (+ any reserved) free supply of this raw
  const lineOut=total*3600, out=lineOut+fHr;
  return {item:Rw,kind:"raw",out,plan,balance:[{res:Rw,prod:lineOut,forgie:fHr,cons:0}],resIndex,capped:false,feasible:out>1e-9,interrupted:false};
}

function optimizeInner(timeBudget,testOptions){
  // Budgets are an anytime CAP, not a fixed wait: solveCore returns the moment its branch-and-
  // bound completes, so an easy plan finishes in tens of ms and never hits this. The cap only
  // bounds the worst case for a genuinely hard factory — and it must leave a slow phone enough
  // room, since it does far less search per ms than a desktop. The old 250ms let mobile cap out
  // on a suboptimal, device-dependent plan (issue #34: a profile that proves out in ~250ms on
  // desktop capped at a worse plan on a phone). 600ms ~doubles a slow device's search while
  // keeping the worst-case freeze well under half a second (and it's one-shot, post-debounce).
  // User-set max solve time (ms); the budget is an anytime cap, so easy factories still finish early.
  // Runs off the main thread (Web Worker), so a larger default doesn't freeze the UI.
  const userBudget=boundedPersistedField("solveBudget",S.solveBudget,2000,200,60000,true);
  const itemsBudget=timeBudget||userBudget, credBudget=timeBudget||userBudget;
  const mode=S.mode==="credits"?"credits":"items";
  if(mode==="items"){
    const targets=[...PRODUCTS,...RAWS].filter(it=>S.targets[it]&&S.targets[it].on);
    if(targets.length===0)return {empty:true,mode};
    const w=targets.map(it=>S.targets[it].w);
    const rc=relevantChain(targets);
    const itemControl=makeSolveControl(itemsBudget,testOptions),t0=itemControl.readNow();
    const sr=solveCore(targets,w,rc.prods,rc.raws,itemsBudget,{control:itemControl});
    const {plan,balance,minedUsage,gelReserved}=planFrom(sr);
    const out={};targets.forEach((t,k)=>{out[t]=sr.feasible?(sr.best.produced[sr.tIdx[k]]-sr.best.consumed[sr.tIdx[k]])*3600:0;});
    const objective=sr.feasible?Math.min(...targets.map((t,k)=>(out[t]||0)/w[k])):0;
    return {empty:false,mode,issues:sr.issues,plan,balance,minedUsage,gelReserved,out,resIndex:sr.resIndex,targets,objective,tol:sr.tol,usesMargin:sr.usesMargin,feasible:sr.feasible,capped:sr.capped,ms:Math.max(0,itemControl.readNow()-t0)};
  }
  // Credits is intentionally a dedicated-item comparison: each priced item gets a whole-factory
  // plan, then those plans are ranked. It is not a theorem that a mixed-sales factory is inferior.
  // One shared control covers the complete comparison. Every item gets a finite deterministic
  // baseline in catalog order before any product receives deeper refinement.
  const control=makeSolveControl(credBudget,testOptions),t0=control.readNow();
  const priced=ALLITEMS.filter(item=>(num(S.sellPrice&&S.sellPrice[item])||0)>0);
  const baselineWorkLimit=Math.max(4000,(S.lines||[]).length*2000);
  const issues=[],cand=[];
  const addIssues=found=>(found||[]).forEach(issue=>{if(!issues.includes(issue))issues.push(issue);});
  if(!priced.length)issues.push("No sell prices entered. Open the “Sell prices” button and add at least one.");
  const unevaluated=item=>({item,kind:RAWS.includes(item)?"raw":"product",out:0,price:num(S.sellPrice[item])||0,credits:0,
    plan:null,balance:null,minedUsage:[],gelReserved:null,resIndex:{},feasible:false,usesMargin:false,capped:false,evaluated:false,ms:0});
  const fromCore=(item,sr,ms,cappedOverride)=>{
    const built=planFrom(sr),out=sr.feasible?(sr.best.produced[sr.resIndex[item]]-sr.best.consumed[sr.resIndex[item]])*3600:0;
    const price=num(S.sellPrice[item])||0;
    return {item,kind:"product",out,price,credits:out*price,plan:built.plan,balance:built.balance,minedUsage:built.minedUsage,
      gelReserved:built.gelReserved,resIndex:sr.resIndex,feasible:sr.feasible,usesMargin:!!sr.usesMargin,
      capped:cappedOverride==null?!!sr.capped:!!cappedOverride,evaluated:true,ms};
  };
  let baselineBroken=false;
  for(let pi=0;pi<priced.length;pi++){
    const item=priced[pi],price=num(S.sellPrice[item])||0;
    if(baselineBroken||control.isStopped()||!control.checkpoint("credits-baseline-candidate")){
      baselineBroken=true;cand.push(unevaluated(item));continue;
    }
    control.event("baseline-start",{item});const start=control.readNow();let candidate=null;
    if(RAWS.includes(item)){
      const raw=solveRaw(item,control);
      if(!raw.interrupted&&control.checkpoint("credits-baseline-complete"))candidate={item,kind:"raw",out:raw.out,price,credits:raw.out*price,
        plan:raw.plan,balance:raw.balance,minedUsage:[],gelReserved:null,resIndex:raw.resIndex,feasible:raw.feasible,
        usesMargin:false,capped:false,evaluated:true,ms:Math.max(0,control.readNow()-start)};
    }else{
      const ins=RECIPE[item].inputs;
      const hasCost=LEVELS.some(L=>ins.every(k=>S.prodCost[item][k][L]!=null&&!isNaN(S.prodCost[item][k][L])));
      if(!hasCost){
        issues.push("No material cost entered for "+item+" — only passive output can be priced.");
        if(control.checkpoint("credits-baseline-complete")){const out=forgieHr(item),resIndex={[item]:0};candidate={item,kind:"product",out,price,credits:out*price,
          plan:idlePlan(),balance:[{res:item,prod:0,forgie:out,cons:0}],minedUsage:[],gelReserved:null,resIndex,feasible:out>1e-9,
          usesMargin:false,capped:false,evaluated:true,ms:Math.max(0,control.readNow()-start)};}
      }else{
        const rc=relevantChain([item]);
        const sr=solveCore([item],[1],rc.prods,rc.raws,credBudget,{control,baselineOnly:true,localWorkLimit:baselineWorkLimit});
        addIssues(sr.issues);
        if(!sr.interrupted)candidate=fromCore(item,sr,Math.max(0,control.readNow()-start),true);
      }
    }
    if(!candidate){baselineBroken=true;cand.push(unevaluated(item));continue;}
    cand.push(candidate);control.event("baseline-complete",{item});
  }

  // Refine only after the complete baseline pass. A refinement interrupted by the root deadline is
  // discarded; the already-complete baseline remains selectable and later candidates stay intact.
  if(!baselineBroken&&!control.isStopped()){
    for(let pi=0;pi<cand.length;pi++){
      const prior=cand[pi];if(prior.kind!=="product"||!prior.evaluated||!prior.capped)continue;
      if(!control.checkpoint("credits-refinement-candidate"))break;
      control.event("refinement-start",{item:prior.item});const start=control.readNow();
      const rc=relevantChain([prior.item]);
      const sr=solveCore([prior.item],[1],rc.prods,rc.raws,credBudget,{control,initialPlan:prior.plan});
      addIssues(sr.issues);
      const spent=Math.max(0,control.readNow()-start);
      if(sr.interrupted){prior.ms+=spent;break;}
      const refined=fromCore(prior.item,sr,prior.ms+spent,null);
      if(creditsRefinementIsNondecreasing(prior,refined))Object.assign(prior,refined);
      else prior.ms+=spent;
      control.event("refinement-complete",{item:prior.item});
      if(control.isStopped())break;
    }
  }
  const order=new Map(ALLITEMS.map((item,index)=>[item,index]));
  cand.sort((a,b)=>{const evaluated=Number(b.evaluated)-Number(a.evaluated);if(evaluated)return evaluated;
    if(a.credits!==b.credits)return a.credits>b.credits?-1:1;
    return order.get(a.item)-order.get(b.item);});
  const allCandidatesEvaluated=cand.every(candidate=>candidate.evaluated);
  const deadlineReached=control.deadlineReached();
  const searchExhaustive=allCandidatesEvaluated&&cand.every(candidate=>!candidate.capped);
  const top=cand.find(candidate=>candidate.evaluated);
  const feasible=!!top&&top.credits>1e-9;
  return {empty:false,mode,issues,ranking:cand,bestItem:feasible?top.item:null,credits:feasible?top.credits:0,objective:feasible?top.credits:0,
    plan:feasible?top.plan:idlePlan(),balance:feasible?top.balance:[],minedUsage:feasible?top.minedUsage:[],gelReserved:feasible?top.gelReserved:null,resIndex:feasible?top.resIndex:{},
    tol:boundedPersistedField("margin",S.margin,0,0,20)/100,usesMargin:!!(feasible&&top.usesMargin),feasible,capped:!!(feasible&&top.capped),
    allCandidatesEvaluated,deadlineReached,searchExhaustive,ms:Math.max(0,control.elapsed()-(t0-control.startedAt))};
}

/* ---------- Gel loadout ----------
   Gel is a native resource in the solve now (see solveCore / projectSchedule). The player-facing
   capacity helper is exact; repeated solver prefixes use the separately named bounded seed. */
// Gel output / vespium burn for a whole line running Gel @L (≤ the line's own cap), full time.
function gelOutHr(row,L){const sp=lineSpeed(row),dp=dupeMult(),ct=craftTime(GEL,L);return ct>0?(L/ct)*effSpeed(sp,ct)*dp*3600:0;}
function gelVespHr(row,L){const sp=lineSpeed(row),ct=craftTime(GEL,L);return ct>0?gelOreCost(L).vesp*(effSpeed(sp,ct)/ct)*3600:0;}
// Cheap reservation seed for solveCore. It deliberately makes no optimality claim: each candidate
// solve invokes this across ranked-line prefixes (and Credits repeats those solves), so bounded work
// belongs here while exact `gelLoadout` remains reserved for capacity claims.
function gelSeedLoadout(rows,vespBudgetHr,control){
  if(!(vespBudgetHr>0)||!rows.length)return {gelHr:0,vespHr:0,perLine:[]};
  const levelsFor=rows.map(row=>[0,...LEVELS.filter(L=>L<=(row.max||0))]);   // [off, 1×, 2×, …]
  const cur=rows.map(()=>0);   // chosen level index per line (0 = off)
  let spent=0,gel=0;
  for(;;){
    if(control&&!control.checkpoint("gel-seed-step"))return {gelHr:0,vespHr:0,perLine:[],interrupted:true};
    let bI=-1,bIdx=-1,bEff=-1,bDv=0,bDg=0;
    for(let ri=0;ri<rows.length;ri++){const row=rows[ri];
      if(control&&!control.checkpoint("gel-seed-line"))return {gelHr:0,vespHr:0,perLine:[],interrupted:true};
      const lv=levelsFor[ri],ci=cur[ri];
      if(ci+1>=lv.length)continue;   // already at this line's cap
      const Lnow=lv[ci],Lnext=lv[ci+1];
      const dv=gelVespHr(row,Lnext)-(Lnow?gelVespHr(row,Lnow):0);
      const dg=gelOutHr(row,Lnext)-(Lnow?gelOutHr(row,Lnow):0);
      if(dv<=1e-9||dg<=0||spent+dv>vespBudgetHr+1e-6)continue;   // no gain, or doesn't fit the budget
      const eff=dg/dv;
      if(eff>bEff){bEff=eff;bI=ri;bIdx=ci+1;bDv=dv;bDg=dg;}
    }
    if(bI<0)break;
    cur[bI]=bIdx;spent+=bDv;gel+=bDg;
  }
  const perLine=[];
  rows.forEach((row,ri)=>{const L=levelsFor[ri][cur[ri]];if(!L)return;
    perLine.push({__i:row.__i,max:row.max,L,gelHr:gelOutHr(row,L),vespHr:gelVespHr(row,L),frac:1});});
  return {gelHr:gel,vespHr:spent,perLine};
}
// Exact multiple-choice loadout for the discrete full-time model: every physical line contributes
// either off or one eligible compression. Its Pareto frontier discards a raw-dominated state only
// outside a correctness-safe numeric envelope. There is intentionally no clock/frontier cutoff.
//
// Stable objective order: most Gel, then least Vespium, then the lexicographically smallest list of
// active [physical line id, compression] pairs. Final equality uses a tight ULP-scale policy, not a
// gameplay-sized margin; raw maxima/minima anchor each band so the result cannot depend on iteration.
const GEL_LOADOUT_ABS_EPS=Number.EPSILON*8;
const GEL_LOADOUT_REL_EPS=Number.EPSILON*32;
function gelLoadoutTolerance(a,b){return GEL_LOADOUT_ABS_EPS+GEL_LOADOUT_REL_EPS*Math.max(1,Math.abs(a),Math.abs(b));}
function gelLoadoutClose(a,b){return Math.abs(a-b)<=gelLoadoutTolerance(a,b);}
function gelLoadoutChoiceCompare(a,b){
  // Lexicographic active-pair order means lower physical line ID first, then lower compression.
  const aa=a.choices.filter(choice=>choice.L>0),bb=b.choices.filter(choice=>choice.L>0);
  const n=Math.min(aa.length,bb.length);
  for(let i=0;i<n;i++){
    if(aa[i].row.__i!==bb[i].row.__i)return aa[i].row.__i-bb[i].row.__i;
    if(aa[i].L!==bb[i].L)return aa[i].L-bb[i].L;
  }
  return aa.length-bb.length;
}
function gelLoadoutPruneBounds(upperBound,additions){
  const publicMagnitude=Math.max(1,Math.abs(upperBound));
  const nu=Math.max(0,additions)*(Number.EPSILON/2);
  const gamma=nu<1?nu/(1-nu):Infinity;
  // A stored positive sum can round below its exact magnitude, so recover a conservative exact
  // upper bound before applying the error interval. Prefix totals and final totals are each
  // recomputed from scratch: comparing two candidates therefore has four independent sum-error
  // paths. The extra arithmetic pad rounds the interval and its later threshold comparisons away
  // from pruning. It affects only pruning safety, never the documented final equality policy.
  const exactMagnitude=gamma<1?publicMagnitude/(1-gamma):Infinity;
  const comparisonPad=gamma>0?4*Number.EPSILON*exactMagnitude:0;
  const roundDrift=gamma>0?4*gamma*exactMagnitude+comparisonPad:0;
  const finalTie=GEL_LOADOUT_ABS_EPS+GEL_LOADOUT_REL_EPS*publicMagnitude;
  return {publicMagnitude,exactMagnitude,gamma,roundDrift,finalTie,
    decisiveGap:finalTie+roundDrift,
    // Requiring the full drift prevents a stored ordering from reversing after recomputation.
    // This is stricter than allowing a reversal inside a future final tie whose size is unknown.
    orderAdvantage:roundDrift};
}
function gelLoadoutStableSum(values){
  // Positive rates are summed low-to-high. The value multiset—not its physical-ID assignment—now
  // owns candidate feasibility and totals, which makes identical-profile symmetry exact under IEEE.
  return values.filter(value=>value>0).slice().sort((a,b)=>a-b).reduce((sum,value)=>sum+value,0);
}
function gelLoadoutPruneGroup(candidates,gelBounds,vespBounds){
  candidates.sort((a,b)=>a.vespHr-b.vespHr||b.gelHr-a.gelHr||gelLoadoutChoiceCompare(a,b));
  const next=[];let maxOrderSafeGel=-Infinity,maxFarGel=-Infinity,orderIndex=0,farIndex=0;
  candidates.forEach((candidate,index)=>{
    // Stored Vespium order can reverse when stable sums are rebuilt with a common suffix. The
    // ordinary Gel-dominance query therefore sees only predecessors whose cost lead covers that
    // full drift. Equality at this safety margin is sufficient and both query cursors are monotone.
    while(orderIndex<index&&
      candidate.vespHr-candidates[orderIndex].vespHr>=vespBounds.orderAdvantage){
      maxOrderSafeGel=Math.max(maxOrderSafeGel,candidates[orderIndex].gelHr);orderIndex++;
    }
    // The far-cost query still requires a strict crossing of the decisive Vespium interval.
    while(farIndex<index&&candidate.vespHr-candidates[farIndex].vespHr>vespBounds.decisiveGap){
      maxFarGel=Math.max(maxFarGel,candidates[farIndex].gelHr);farIndex++;
    }
    const pruned=maxOrderSafeGel>candidate.gelHr+gelBounds.decisiveGap||
      maxFarGel>=candidate.gelHr+gelBounds.orderAdvantage;
    if(!pruned)next.push(candidate);
  });
  return next;
}
function gelLoadoutPruneCandidates(candidates,gelBounds,vespBounds,signatureOf){
  if(typeof signatureOf!=="function")return gelLoadoutPruneGroup(candidates,gelBounds,vespBounds);
  const groups=new Map();
  candidates.forEach(candidate=>{
    const signature=String(signatureOf(candidate));
    if(!groups.has(signature))groups.set(signature,[]);
    groups.get(signature).push(candidate);
  });
  const next=[];
  [...groups.keys()].sort().forEach(signature=>next.push(...
    gelLoadoutPruneGroup(groups.get(signature),gelBounds,vespBounds)));
  return next;
}
function gelLoadout(rows,vespBudgetHr){
  if(!(vespBudgetHr>0)||!Array.isArray(rows)||!rows.length)return {gelHr:0,vespHr:0,perLine:[]};
  const profileIds=new Map();
  const ordered=rows.map((row,inputIndex)=>({row,inputIndex})).sort((a,b)=>
    (Number(a.row.__i)-Number(b.row.__i))||a.inputIndex-b.inputIndex).map(entry=>{
      const options=[{L:0,gelHr:0,vespHr:0},...LEVELS.filter(L=>L<=(entry.row.max||0)).map(L=>
        ({L,gelHr:gelOutHr(entry.row,L),vespHr:gelVespHr(entry.row,L)}))];
      const profileKey=String(entry.row.max)+"\u0001"+options.map(option=>
        option.L+"\u0002"+option.gelHr+"\u0002"+option.vespHr).join("\u0003");
      if(!profileIds.has(profileKey))profileIds.set(profileKey,profileIds.size);
      const offRank=options.length-1;
      options.forEach((option,index)=>option.rank=option.L?index-1:offRank);
      return {row:entry.row,options,profileId:profileIds.get(profileKey)};
    });
  const gelUpperBound=gelLoadoutStableSum(ordered.map(entry=>
    entry.options.reduce((best,option)=>Math.max(best,option.gelHr),0)));
  const gelPruneBounds=gelLoadoutPruneBounds(gelUpperBound,ordered.length);
  const vespPruneBounds=gelLoadoutPruneBounds(vespBudgetHr,ordered.length);
  const futureProfiles=ordered.map((entry,index)=>[...new Set(ordered.slice(index+1)
    .map(future=>future.profileId))].sort((a,b)=>a-b));
  let frontier=[{gelHr:0,vespHr:0,choices:[],lastRanks:new Array(profileIds.size).fill(-1)}];
  ordered.forEach(({row,options,profileId},lineIndex)=>{
    const candidates=[];
    frontier.forEach(state=>options.forEach(option=>{
      // Identical option profiles are symmetric. Nondecreasing positive-level ranks followed by
      // OFF represent each multiset once: earliest physical IDs stay active and lower compression
      // stays on the lower ID, which is exactly the documented lexicographic assignment.
      const previousRank=state.lastRanks[profileId];
      if(option.rank<previousRank)return;
      const choices=state.choices.concat({row,L:option.L,gelHr:option.gelHr,vespHr:option.vespHr});
      const vespHr=gelLoadoutStableSum(choices.map(choice=>choice.vespHr));
      if(vespHr>vespBudgetHr)return;
      const lastRanks=state.lastRanks.slice();lastRanks[profileId]=option.rank;
      candidates.push({gelHr:gelLoadoutStableSum(choices.map(choice=>choice.gelHr)),vespHr,
        choices,lastRanks});
    }));
    const signatureProfiles=futureProfiles[lineIndex];
    frontier=gelLoadoutPruneCandidates(candidates,gelPruneBounds,vespPruneBounds,state=>
      signatureProfiles.map(profileId=>state.lastRanks[profileId]).join(","));
  });
  const gelMax=frontier.reduce((maximum,state)=>Math.max(maximum,state.gelHr),-Infinity);
  const gelBand=frontier.filter(state=>gelLoadoutClose(state.gelHr,gelMax));
  const vespMin=gelBand.reduce((minimum,state)=>Math.min(minimum,state.vespHr),Infinity);
  const finalBand=gelBand.filter(state=>gelLoadoutClose(state.vespHr,vespMin));
  const best=finalBand.reduce((winner,state)=>
    !winner||gelLoadoutChoiceCompare(state,winner)<0?state:winner,null);
  const perLine=(best?best.choices:[]).filter(choice=>choice.L>0).map(choice=>({
    __i:choice.row.__i,max:choice.row.max,L:choice.L,
    gelHr:gelOutHr(choice.row,choice.L),vespHr:gelVespHr(choice.row,choice.L),frac:1
  }));
  return {gelHr:gelLoadoutStableSum(perLine.map(line=>line.gelHr)),
    vespHr:gelLoadoutStableSum(perLine.map(line=>line.vespHr)),perLine};
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
  const inv={};ALLITEMS.forEach(it=>inv[it]=num(S.inventory&&S.inventory[it])||0);
  const net=projNetVec(gross,inv);
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
function lpMaximize(c,A,b,control){
  const m=A.length,n=c.length,W=n+m+1;
  const T=[];
  for(let i=0;i<m;i++){
    if(control&&!control.checkpoint("lp-tableau-row",Math.max(1,n)))return {x:null,interrupted:true,complete:false};
    const row=new Float64Array(W);for(let j=0;j<n;j++)row[j]=A[i][j];row[n+i]=1;row[W-1]=b[i];T.push(row);
  }
  const obj=new Float64Array(W);for(let j=0;j<n;j++)obj[j]=-c[j];T.push(obj);
  const basis=[];for(let i=0;i<m;i++)basis.push(n+i);
  let complete=false;
  for(let it=0;it<20000;it++){
    // A simplex pivot is atomic: check before mutating its row/tableau so cancellation can never
    // expose a half-pivoted solution. The work charge reflects the dense row update.
    if(control&&!control.checkpoint("lp-pivot",Math.max(1,W*(m+1)))){
      const x=new Float64Array(n);for(let i=0;i<m;i++)if(basis[i]<n)x[basis[i]]=T[i][W-1];
      return {x,interrupted:true,complete:false};
    }
    let piv=-1;for(let j=0;j<n+m;j++){if(T[m][j]<-1e-9){piv=j;break;}}   // entering (Bland)
    if(piv<0){complete=true;break;}
    let leave=-1,best=Infinity;
    for(let i=0;i<m;i++){const a=T[i][piv];if(a>1e-9){const r=T[i][W-1]/a;if(r<best-1e-12||(Math.abs(r-best)<1e-12&&(leave<0||basis[i]<basis[leave]))){best=r;leave=i;}}}
    if(leave<0)return {x:null,unbounded:true,complete:true};
    const prow=T[leave],pv=prow[piv];
    for(let j=0;j<W;j++)prow[j]/=pv;
    for(let i=0;i<=m;i++){if(i===leave)continue;const f=T[i][piv];if(Math.abs(f)>1e-12){const ri=T[i];for(let j=0;j<W;j++)ri[j]-=f*prow[j];}}
    basis[leave]=piv;
  }
  const x=new Float64Array(n);for(let i=0;i<m;i++)if(basis[i]<n)x[basis[i]]=T[i][W-1];
  return {x,complete};
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
// Stability is explicit input/output: opts.readStability may consult the immutable cache snapshot,
// while opts.rememberStability returns a proposed record for the controller to commit only after the
// complete selected Project run succeeds. This low-level LP never mutates either cache.
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
  // a pinned re-solve by more than HYST_FRAC of throughput. Only final visible semantic phases opt in;
  // ordering, fixed-point preliminaries, warm-ups, and hidden comparisons remain free and memoryless.
  let stabilized=false, stabKey=null, zPin=null;   // zPin: pinned-solve throughput (diagnostic / band test)
  const stabilityRequested=!!(opts&&(opts.readStability||opts.rememberStability));
  if(stabilityRequested){
    // Key by phase + physical-line set + demanded-item set (sorted, so it's invariant to speed-driven
    // line reordering). Structural changes — add/remove a line, change a cap or which items are
    // demanded — bust the key and re-solve freely; speed/quantity/price edits keep it and stay stable.
    stabKey=(opts.phaseKey||"")+"||L:"+lns.slice().sort((a,b)=>a.orig-b.orig).map(l=>l.orig+":"+l.max).join(",")+"||I:"+items.slice().sort().join(",");
    const cache=opts.stabilityCache&&typeof opts.stabilityCache==="object"?opts.stabilityCache:{};
    const prior=opts.readStability?cache[stabKey]:null;
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
  const stabilityUpdate=stabKey&&opts.rememberStability?makeLineStabilityUpdate(stabKey,plan):null;
  return {rate,plan,items,z:(y[zCol]||0)/D0,stabilized,zFree:zFree/D0,zPin,stabilityKey:stabKey,stabilityUpdate};
}

/* One-job-per-line Project scheduling. The discrete core already models exactly that assignment;
 * this adapter gives it the Project LP result shape so Task 4's replay remains the authority for
 * inventory, prerequisites, warm-ups, mined-rate limits, and cross-phase carry. */
function staticSchedule(net,targets,control,maxCompression){
  const rc=relevantChain(targets),D0=Math.max(1,...targets.map(item=>net[item]||0));
  const weights=targets.map(item=>Math.max(1e-12,(net[item]||0)/D0));
  const budget=boundedPersistedField("solveBudget",S.solveBudget,2000,200,60000,true);
  const solved=solveCore(targets,weights,rc.prods,rc.raws,budget,{tolOverride:0,control,maxCompression});
  const rate={};
  solved.resources.forEach((resource,index)=>{
    rate[resource]=solved.feasible?(solved.best.produced[index]-solved.best.consumed[index])*3600:0;
  });
  const plan=solved.sorted.map((line,index)=>{
    const row={line:line.orig+1,max:line.max,sp:line.sp,dp:line.dp,entries:[]};
    const job=solved.feasible?solved.lineJobs[index][solved.best.choice[index]]:null;
    if(job&&job.kind!=="idle"&&job.prod.length){
      const speed=effSpeed(line.sp,job.ct);
      row.entries.push({item:job.res,lvl:job.lvl,frac:1,outHr:job.prod[0][1]*speed*line.dp*3600,
        cons:job.cons.map(input=>({item:solved.resources[input[0]],hr:input[1]*speed*3600}))});
    }
    return row;
  }).sort((a,b)=>a.line-b.line);
  return {rate,plan,items:solved.resources,z:solved.feasible?solved.best.score:0,
    stabilized:false,zFree:null,zPin:null,stabilityKey:null,stabilityUpdate:null,
    compressionCeiling:maxCompression!=null&&Number.isFinite(Number(maxCompression))&&Number(maxCompression)>0
      ?Number(maxCompression):null,
    evaluated:!solved.interrupted||!!solved.feasible,capped:!!solved.capped,
    interrupted:!!solved.interrupted,searchExhaustive:!solved.capped&&!solved.interrupted};
}
// Solve one batch of demand (a single project, or all of them combined) into a pipelined phase.
// `avail` (optional) is the stock the LP may draw down in place of producing an item (issue #73).
// `stabilityPolicy` opts a final visible phase into the Tier-2 line-stability pass (issue #87 item 5);
// ordering/cost estimates, preliminary fixed points, warm-ups, and hidden alternatives omit it.
// `phaseKey` is the cache discriminator: a STABLE unique id (project id / member-id set), NOT the
// display name, so two projects sharing a name don't collide on one cache slot. Falls back to name.
function solvePhaseFor(net,name,avail,stabilityPolicy,phaseKey,solveOptions){
  const demandItems=ALLITEMS.filter(it=>net[it]>1e-9);
  const blockedMined={};
  demandItems.forEach(it=>{const blockers=chainMinedBlockers(it);if(blockers.length)blockedMined[it]=blockers;});
  const unsat=Object.keys(blockedMined);   // legacy item-level blocker list
  const targets=demandItems.filter(it=>!blockedMined[it]);
  if(targets.length===0)
    return {name,phaseKey:(phaseKey!=null?phaseKey:name),plan:[],balance:[],minedUsage:[],demandItems,net,rate:{},eta:0,bottleneck:null,infeasItems:[],unsat,blockedMined,atRisk:[],items:[],z:0,partial:false,feasible:demandItems.length===0,stabilized:false,zFree:null,zPin:null,stabilityKey:null,stabilityUpdate:null,evaluated:true,capped:false,interrupted:false,searchExhaustive:true};
  const staticControl=solveOptions&&solveOptions.static===true&&solveOptions.control;
  if(staticControl&&staticControl.isStopped())
    return {name,phaseKey:(phaseKey!=null?phaseKey:name),plan:[],balance:[],minedUsage:[],demandItems,net,rate:{},eta:0,bottleneck:null,infeasItems:[],unsat,blockedMined,atRisk:[],items:[],z:0,partial:false,feasible:false,stabilized:false,zFree:null,zPin:null,stabilityKey:null,stabilityUpdate:null,evaluated:false,capped:true,interrupted:true,searchExhaustive:false};
  let scheduleOptions=null;
  if(stabilityPolicy&&typeof stabilityPolicy==="object")scheduleOptions={...stabilityPolicy,phaseKey:(phaseKey!=null?phaseKey:name)};
  else if(stabilityPolicy===true)scheduleOptions={readStability:true,rememberStability:true,stabilityCache:cloneLineStability(_lineStability),phaseKey:(phaseKey!=null?phaseKey:name)};
  const sch=solveOptions&&solveOptions.static===true
    ?staticSchedule(net,targets,solveOptions.control,solveOptions.maxCompression)
    :projectSchedule(net,targets,avail,scheduleOptions);
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
  return {name,phaseKey:(phaseKey!=null?phaseKey:name),plan:sch.plan,balance,minedUsage,demandItems,net,rate,eta,bottleneck,infeasItems,unsat,blockedMined,atRisk,items:sch.items,z:sch.z,partial:!feasible&&hasThroughput,feasible,stabilized:!!sch.stabilized,zFree:sch.zFree,zPin:sch.zPin,stabilityKey:sch.stabilityKey,stabilityUpdate:sch.stabilityUpdate,
    compressionCeiling:sch.compressionCeiling==null?null:sch.compressionCeiling,
    evaluated:sch.evaluated!==false,capped:!!sch.capped,interrupted:!!sch.interrupted,searchExhaustive:sch.searchExhaustive!==false};
}
// Frames/Wire Bits are an external, pre-produced prerequisite. Reserve them before ordinary direct
// Bits demand; they never become a Project LP target and never earn a synthetic Bits line.
function phasePreProducedDemand(sub,invMap){
  const frames=Math.max(0,(sub.Frames||0)-((invMap&&invMap.Frames)||0));
  const wire=Math.max(0,(sub.Wire||0)-((invMap&&invMap.Wire)||0));
  const bits=PREPROD_BITS.Frames*frames+PREPROD_BITS.Wire*wire;
  return bits>0?{Bits:bits}:{};
}
// Net ordinary demand for a project's level sum after reserving external pre-produced Bits.
function projNetVec(sub,invMap,preProducedDemand){
  const net={};ALLITEMS.forEach(it=>net[it]=Math.max(0,(sub[it]||0)-(invMap[it]||0)));
  const pp=((preProducedDemand||phasePreProducedDemand(sub,invMap)).Bits||0),bitsLeft=Math.max(0,((invMap&&invMap.Bits)||0)-pp);
  net.Bits=Math.max(0,(sub.Bits||0)-bitsLeft);
  return net;
}
// Stock available to DRAW DOWN for each item — the inventory left after covering the item's own
// direct project demand (projNetVec already nets that). For a raw/intermediate that's never a direct
// cost (e.g. Ingots) this is its whole stock; that stock feeds its consumers so they aren't produced
// from scratch (issue #73). External Bits are removed before direct Bits and recipe-feed availability.
function projAvailVec(sub,invMap,preProducedDemand){
  const av={};ALLITEMS.forEach(it=>av[it]=Math.max(0,((invMap&&invMap[it])||0)-(sub[it]||0)));
  const pp=((preProducedDemand||phasePreProducedDemand(sub,invMap)).Bits||0);
  av.Bits=Math.max(0,((invMap&&invMap.Bits)||0)-pp-(sub.Bits||0));
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
  const chains=perProject.map(project=>{
    const direct=ALLITEMS.filter(item=>(project.sub[item]||0)>0);
    if(!direct.length)return new Set();
    const chain=relevantChain(direct);
    return new Set([...direct,...chain.prods,...chain.raws]);
  });
  const preds=perProject.map((p,i)=>{
    const set={};
    UNLOCK_MATERIALS.forEach(m=>{const u=unlockerOf[m];if(u!=null&&u!==i&&chains[i].has(m))set[u]=1;});
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
function solveProjectBuffer(deficit,_inventory,info,runOptions){
  const signature=Object.keys(deficit).sort().map(it=>it+":"+deficit[it].toPrecision(12)).join("|");
  const warm=solvePhaseFor(deficit,"Warm-up: "+Object.keys(deficit).join(" + "),{},false,"warmup:"+(info&&info.depth||0)+":"+signature,
    {static:S.projLineMode==="static",control:runOptions&&runOptions.staticControl});
  warm.kind="warmup";warm.demandSub={};return warm;
}
function plannedPreProducedDemand(ph){
  let bits=0;
  (ph.plan||[]).forEach(line=>(line.entries||[]).forEach(entry=>{
    const perUnit=PREPROD_BITS[entry.item]||0,dup=line.dp>0?line.dp:1,L=Number(entry.lvl)||1;
    if(perUnit>0)bits+=perUnit*(Math.pow(3,Math.log2(L))/L)*(entry.outHr||0)*(ph.eta||0)/dup;
  }));
  const rounded=Math.round(bits);if(Math.abs(bits-rounded)<=1e-8+Number.EPSILON*32*Math.max(1,Math.abs(bits)))bits=rounded;
  return bits>0?{Bits:bits}:{};
}
function staticCompressionFallbackCandidates(physicalMax,observedMaxCompressions){
  const physical=Number(physicalMax)||0,observed=[...new Set((observedMaxCompressions||[])
    .map(Number).filter(level=>Number.isFinite(level)&&level>0&&level<=physical))].sort((a,b)=>b-a);
  const relevantMax=observed.length?observed[0]:physical;
  // Walk strict lower ceilings in descending order below the highest job level implicated in the
  // cycle. That tries 2x before 1x even if a 1x job happened to appear in one candidate, and avoids
  // irrelevant 16k→8k retries when the oscillating assignments only ever reached 4x.
  return LEVELS.filter(level=>level<relevantMax).sort((a,b)=>b-a);
}
function retainReplaySafeFixedPointIncumbent(incumbent,candidate,sub,inv,solvedWith,planned){
  if(!candidate||candidate.feasible!==true||candidate.evaluated===false)return incumbent;
  // This is a pure certification pass: external pre-produced prerequisites are inserted and the
  // exact replay runs, but no warm-up solver is supplied and no search/control budget is touched.
  // A candidate needing more solving is therefore not a usable deadline incumbent.
  const probe=Object.assign({},candidate,{kind:"project",demandSub:Object.assign({},sub),
    preProducedDemand:Object.assign({},planned)});
  const built=buildExecutableProjectSchedule([probe],inv,projectScheduleContext());
  if(!built.validation||built.validation.ok!==true)return incumbent;
  return {phase:candidate,solvedWith:Object.assign({},solvedWith),planned:Object.assign({},planned)};
}
function solveExecutableProjectPhase(sub,name,inv,stabilityPolicy,phaseKey,runOptions){
  const initialPre=phasePreProducedDemand(sub,inv);
  const isStatic=S.projLineMode==="static";
  const bitsKey=demand=>{
    const value=Number((demand&&demand.Bits)||0);
    return Number.isFinite(value)?value.toPrecision(15):String(value);
  };
  const maxPlanCompression=phase=>{
    let maximum=0;
    (phase&&phase.plan||[]).forEach(line=>(line.entries||[]).forEach(entry=>{maximum=Math.max(maximum,Number(entry.lvl)||0);}));
    return maximum;
  };
  const fixedPoint=(policy,startPre,maxCompression)=>{
    let pre=Object.assign({},startPre),ph=null,solvedWith={};
    let incumbent=null;
    const seen=new Set([bitsKey(pre)]),observedMaxCompressions=new Set();
    for(let pass=0;pass<8;pass++){
      const passSolvedWith=Object.assign({},pre);
      const candidate=solvePhaseFor(projNetVec(sub,inv,passSolvedWith),name,projAvailVec(sub,inv,passSolvedWith),policy,phaseKey,
        {static:isStatic,control:runOptions&&runOptions.staticControl,maxCompression});
      if(candidate.evaluated===false){
        if(!incumbent)return {phase:candidate,solvedWith:passSolvedWith,pre,converged:false,
          incumbent:null,observedMaxCompressions:[...observedMaxCompressions]};
        // Refinement ran out of the shared static budget after a complete feasible pass. Keep that
        // pass as a candidate for the exact executable replay instead of replacing it with an empty
        // solve-budget result. The replay remains authoritative: only a schedule it validates can
        // reach the user, and the interruption/cap telemetry stays explicit.
        ph=Object.assign({},incumbent.phase,{evaluated:true,capped:true,interrupted:true,searchExhaustive:false});
        solvedWith=Object.assign({},incumbent.solvedWith);
        pre=Object.assign({},incumbent.planned);
        return {phase:ph,solvedWith,pre,converged:null,incumbent,
          observedMaxCompressions:[...observedMaxCompressions]};
      }
      ph=candidate;
      solvedWith=passSolvedWith;
      const usedCompression=maxPlanCompression(ph);if(usedCompression>0)observedMaxCompressions.add(usedCompression);
      const next=plannedPreProducedDemand(ph),a=solvedWith.Bits||0,b=next.Bits||0;
      if(isStatic)incumbent=retainReplaySafeFixedPointIncumbent(incumbent,ph,sub,inv,solvedWith,next);
      pre=next;
      if(Math.abs(a-b)<=1e-8+Number.EPSILON*32*Math.max(1,Math.abs(a),Math.abs(b)))
        return {phase:ph,solvedWith,pre,converged:true,incumbent,
          observedMaxCompressions:[...observedMaxCompressions]};
      const key=bitsKey(pre);
      if(seen.has(key))return {phase:ph,solvedWith,pre,converged:false,cycled:true,
        incumbent,observedMaxCompressions:[...observedMaxCompressions]};
      seen.add(key);
    }
    return {phase:ph,solvedWith,pre,converged:false,incumbent,
      observedMaxCompressions:[...observedMaxCompressions]};
  };
  let attempt=fixedPoint(null,initialPre,null);
  // A larger configured cap contains every lower-cap assignment, but the pre-produced Bits fixed
  // point can alternate between two individually valid whole-line assignments. Retry the finite,
  // deterministic set of lower ceilings observed in that cycle (then every lower table level).
  // The final replay still certifies execution, and capped/non-exhaustive telemetry makes clear that
  // this bounded recovery did not prove the unrestricted assignment search optimal.
  if(isStatic&&attempt.converged===false&&attempt.phase&&attempt.phase.evaluated!==false&&attempt.phase.interrupted!==true){
    const physicalMax=(S.lines||[]).reduce((maximum,line)=>Math.max(maximum,Number(line.max)||0),0);
    const candidates=staticCompressionFallbackCandidates(physicalMax,attempt.observedMaxCompressions);
    const primaryAttempt=attempt;let bestFallback=null,interruptedFallback=null;
    for(let index=0;index<candidates.length;index++){
      const ceiling=candidates[index],fallback=fixedPoint(null,initialPre,ceiling);
      const certified=(fallback.converged===true||fallback.converged===null)
        ?retainReplaySafeFixedPointIncumbent(null,fallback.phase,sub,inv,fallback.solvedWith,fallback.pre):null;
      if(certified){
        fallback.phase=certified.phase;fallback.solvedWith=certified.solvedWith;fallback.pre=certified.planned;
        const currentEta=Number(fallback.phase.eta),bestEta=bestFallback?Number(bestFallback.phase.eta):Infinity;
        if(!bestFallback||currentEta<bestEta-(1e-9+Number.EPSILON*32*Math.max(1,Math.abs(currentEta),Math.abs(bestEta)))){
          fallback._compressionCeiling=ceiling;bestFallback=fallback;
        }
      }
      if(fallback.converged===null||fallback.phase&&fallback.phase.evaluated===false){interruptedFallback=fallback;break;}
    }
    if(bestFallback){
      bestFallback.phase=Object.assign({},bestFallback.phase,{compressionFallback:true,
        compressionCeiling:bestFallback._compressionCeiling,capped:true,
        interrupted:!!(bestFallback.phase.interrupted||interruptedFallback),searchExhaustive:false});
      delete bestFallback._compressionCeiling;attempt=bestFallback;
    }else if(interruptedFallback&&primaryAttempt.incumbent){
      const retained=primaryAttempt.incumbent;
      attempt={phase:Object.assign({},retained.phase,{evaluated:true,capped:true,interrupted:true,searchExhaustive:false}),
        solvedWith:Object.assign({},retained.solvedWith),pre:Object.assign({},retained.planned),
        converged:null,incumbent:retained,observedMaxCompressions:primaryAttempt.observedMaxCompressions};
    }else if(interruptedFallback)attempt=interruptedFallback;
  }
  // Static phases have no within-phase line switching and never read, propose, or commit the split
  // line-stability cache. Their first fixed-point pass is already the visible semantic solve.
  if(!isStatic&&attempt.converged===true&&stabilityPolicy&&(stabilityPolicy.readStability||stabilityPolicy.rememberStability))
    attempt=fixedPoint(stabilityPolicy,attempt.pre,null);
  const ph=attempt.phase,solvedWith=attempt.solvedWith,pre=attempt.pre,converged=attempt.converged;
  ph.preProducedDemand=Object.assign({},pre);
  ph.preProducedSolveDemand=Object.assign({},solvedWith);
  ph.preProducedConverged=ph.evaluated===false||converged===null?null:converged;
  if(converged===false&&ph.evaluated!==false)ph.preProducedFailure={kind:"pre-produced-convergence",resource:"Bits",time:0,deficit:Math.abs((pre.Bits||0)-(solvedWith.Bits||0)),
    message:"Pre-produced Bits obligation did not converge with the final stabilized Project plan"};
  return ph;
}
function buildProjectPhases(seq,net,perProject,stabilityPolicy,runOptions){
  const layer=unlockLayers(perProject);
  const maxL=perProject.length?Math.max.apply(null,layer):0;
  const invStart=()=>{const o={};ALLITEMS.forEach(it=>o[it]=num(S.inventory&&S.inventory[it])||0);return o;};
  const context=projectScheduleContext(),executionPhases=[];
  let exactInventory=invStart(),scheduleBlocked=null;
  const solveBudgetFailure=()=>({kind:"solve-budget",time:0,deficit:0,
    message:"Set & forget search reached the Project solve limit before this phase received a usable assignment."});
  const executePhase=ph=>{
    if(scheduleBlocked)return;
    if(ph.evaluated===false){scheduleBlocked=solveBudgetFailure();return;}
    if(ph.preProducedConverged===false){scheduleBlocked=ph.preProducedFailure;return;}
    const built=buildExecutableProjectSchedule([ph],exactInventory,context,
      (deficit,inventory,info)=>{const warm=solveProjectBuffer(deficit,inventory,info,runOptions);
        if(warm.evaluated===false&&!scheduleBlocked)scheduleBlocked=solveBudgetFailure();return warm;});
    executionPhases.push(...built.phases);
    if(!scheduleBlocked){if(built.validation.ok)exactInventory=built.validation.finalInventory;
      else scheduleBlocked=built.validation.firstFailure;}
  };
  if(!seq){
    // Single combined phase when nothing is gated, or when the user has turned unlock gating
    // off (projectGate===false) to craft the whole list at once, ignoring unlock waves.
    if(maxL===0||S.projectGate===false){
      const sumSub={};ALLITEMS.forEach(it=>sumSub[it]=perProject.reduce((s,p)=>s+(p.sub[it]||0),0));
      const inv0=invStart();
      const combKey=perProject.length>1?perProject.map(p=>p.id).sort().join("+"):perProject[0].id;
      const ph=solveExecutableProjectPhase(sumSub,perProject.length>1?"All projects":perProject[0].name,inv0,stabilityPolicy,combKey,runOptions);
      ph.semanticIndex=0;ph.demandSub=sumSub;ph.invStart=inv0;
      ph.doneAt=ph.eta;executePhase(ph);return {phases:[ph],executionPhases,finalInventory:exactInventory,scheduleBlocked};
    }
    // unlocks force ordered "waves": combine within a layer, sequence the layers, carrying
    // crafted surplus forward as inventory so later waves only make what's still missing.
    let cum=0;const phases=[];
    for(let L=0;L<=maxL;L++){
      const members=perProject.filter((_,i)=>layer[i]===L);
      if(!members.length)continue;
      const sumSub={};ALLITEMS.forEach(it=>sumSub[it]=members.reduce((s,p)=>s+(p.sub[it]||0),0));
      const inv0=Object.assign({},exactInventory);
      const ph=solveExecutableProjectPhase(sumSub,members.map(m=>m.name).join(" + "),exactInventory,stabilityPolicy,members.map(m=>m.id).sort().join("+"),runOptions);
      ph.semanticIndex=phases.length;ph.members=members.map(m=>m.name);ph.demandSub=sumSub;ph.wave=phases.length+1;ph.invStart=inv0;
      executePhase(ph);
      cum+=ph.eta;ph.doneAt=cum;phases.push(ph);
    }
    return {phases,executionPhases,finalInventory:exactInventory,scheduleBlocked};
  }
  // Sequenced: one project per phase, ordered by unlock layer, manual priority, then an estimated
  // completion time. Static phases do not draw held intermediates into their one-job assignment, so
  // omit that availability from the estimate instead of ranking in a stock world the actual phase
  // will not use. The estimate remains split-mode and cache-neutral; exact static work is budgeted
  // only for the selected executable phases below.
  const invInit=invStart();
  const cost=perProject.map(p=>{const netDemand=projNetVec(p.sub,invInit),avail=S.projLineMode==="static"?{}:projAvailVec(p.sub,invInit);
    const ph=solvePhaseFor(netDemand,p.name,avail);return ph.feasible?ph.eta:Infinity;});
  const order=perProject.map((p,i)=>({p,i})).sort((a,b)=>{
    if(layer[a.i]!==layer[b.i])return layer[a.i]-layer[b.i];   // unlock precedence (hard)
    const pa=a.p.prio,pb=b.p.prio;
    if(pa!=null&&pb!=null){if(pa!==pb)return pa-pb;}            // manual order, lower first
    else if(pa!=null)return -1;
    else if(pb!=null)return 1;
    const ca=cost[a.i],cb=cost[b.i];
    if(!isFinite(ca)&&!isFinite(cb))return 0;
    return ca-cb;                                               // else cheapest makespan
  });
  let cum=0;const phases=[];
  order.forEach(({p})=>{
    const inv0=Object.assign({},exactInventory);
    const ph=solveExecutableProjectPhase(p.sub,p.name,exactInventory,stabilityPolicy,p.id,runOptions);
    ph.semanticIndex=phases.length;ph.prio=(p.prio!=null?p.prio:null);ph.demandSub=p.sub;ph.invStart=inv0;
    executePhase(ph);
    cum+=ph.eta;ph.doneAt=cum;phases.push(ph);
  });
  return {phases,executionPhases,finalInventory:exactInventory,scheduleBlocked};
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
function projectScheduleContext(){
  const deps={},depth={};
  ALLITEMS.forEach(it=>deps[it]=RECIPE[it]?[...RECIPE[it].inputs]:[]);
  const visit=(it,seen)=>{if(depth[it]!=null)return depth[it];if(seen.has(it))return 0;const next=new Set(seen);next.add(it);
    const ds=(deps[it]||[]).filter(x=>ALLITEMS.includes(x));return depth[it]=ds.length?1+Math.max(...ds.map(x=>visit(x,next))):0;};
  ALLITEMS.forEach(it=>visit(it,new Set()));
  const forgieRates={},minedIncomeRates={};
  ALLITEMS.forEach(it=>forgieRates[it]=forgieHr(it));
  MINED_RESOURCES.forEach(r=>minedIncomeRates[r]=minedBudgetHr(r));
  const compressionInputScale={};LEVELS.forEach(L=>compressionInputScale[L]=Math.pow(3,Math.log2(L))/L);
  return {ordinaryResources:[...ALLITEMS],minedResources:[...MINED_RESOURCES],informationalResources:["Rocks"],
    forgieRates,minedIncomeRates,recipeDependencies:deps,recipeDepth:depth,preprodBits:Object.assign({},PREPROD_BITS),
    compressionInputScale,
    assignmentEpsilon:LP_ASSIGN_EPS,stockTolerance:{absolute:1e-8,relative:Number.EPSILON*32}};
}
function finiteNonnegative(value){return Number.isFinite(value)&&value>=0;}
function projectRunExecutable(run){
  return !!(run&&run.feasible===true&&run.lpFeasible===true&&run.partial!==true&&run.scheduleValidation&&
    run.scheduleValidation.ok===true&&!run.scheduleValidation.firstFailure&&finiteNonnegative(run.eta)&&
    finiteNonnegative(run.workEta)&&finiteNonnegative(run.warmupEta));
}
// One complete Project execution path. The same function owns selected and hidden runs so the
// comparison includes sequencing/waves, recursive warm-ups, ordering, carried inventory, replay,
// prerequisites, and finish clocks rather than comparing isolated LP phases.
function solveProjectRun(seq,net,perProject,stabilityPolicy,runOptions){
  const builtPhases=buildProjectPhases(seq,net,perProject,stabilityPolicy,runOptions),phases=builtPhases.phases;
  const waved=!seq&&phases.length>1;   // all-at-once split into unlock-ordered waves
  const single=!seq&&S.projectGate===false&&perProject.length>1;   // gating off — one combined phase
  phases.forEach((ph,i)=>{ph.semanticIndex=i;ph.kind="project";});
  const workEta=phases.reduce((s,ph)=>s+ph.eta,0);
  const lpFeasible=phases.length>0&&phases.every(ph=>ph.feasible);
  const initialInventory={};ALLITEMS.forEach(it=>initialInventory[it]=num(S.inventory&&S.inventory[it])||0);
  const context=projectScheduleContext(),executionPhases=builtPhases.executionPhases;
  const validation=replayProjectSchedule(executionPhases,initialInventory,context);
  if(builtPhases.scheduleBlocked){validation.ok=false;validation.firstFailure=builtPhases.scheduleBlocked;}
  const executable={phases:executionPhases,eta:executionPhases.reduce((sum,p)=>sum+(p.eta||0),0),validation};
  let elapsed=0;executable.phases.forEach(ph=>{elapsed+=ph.eta||0;ph.doneAt=elapsed;if(ph.kind==="project"&&ph.semanticIndex!=null&&phases[ph.semanticIndex])phases[ph.semanticIndex].doneAt=elapsed;});
  const eta=executable.eta;
  const warmupEta=executionPhases.filter(ph=>ph.kind==="warmup").reduce((sum,ph)=>sum+(ph.eta||0),0);
  const feasible=lpFeasible&&executable.validation.ok;
  const unsat=[...new Set([].concat(...phases.map(ph=>ph.unsat||[])))];
  const blockedMined={};phases.forEach(ph=>Object.entries(ph.blockedMined||{}).forEach(([it,resources])=>{
    blockedMined[it]=[...new Set([...(blockedMined[it]||[]),...resources])];
  }));
  const partial=!lpFeasible&&phases.some(ph=>ph.z>1e-15);
  const infeasItems=[...new Set([].concat(...phases.map(ph=>ph.infeasItems||[])))];
  const atRiskItems=[...new Set([].concat(...phases.map(ph=>ph.atRisk||[])))];
  const searchedPhases=executionPhases.filter(ph=>ph.kind!=="prerequisite");
  const allPhasesEvaluated=phases.every(ph=>ph.evaluated!==false)&&searchedPhases.every(ph=>ph.evaluated!==false);
  const capped=phases.some(ph=>ph.capped===true)||searchedPhases.some(ph=>ph.capped===true);
  const searchExhaustive=allPhasesEvaluated&&!capped&&phases.every(ph=>ph.searchExhaustive!==false)&&searchedPhases.every(ph=>ph.searchExhaustive!==false);
  const main=phases[0]||{plan:[],balance:[],rate:{},demandItems:[],bottleneck:null};
  const stabilityUpdates=phases.filter(ph=>ph.feasible&&ph.preProducedConverged!==false&&ph.stabilityUpdate).map(ph=>ph.stabilityUpdate);
  return {empty:false,mode:"project",projLineMode:S.projLineMode==="static"?"static":"split",sequenced:seq,waved,single,
    orderSeqSetting:S.projectSeq!==false,orderGateSetting:S.projectGate!==false,
    phases,executionPhases:executable.phases,perProject,net,
    plan:main.plan,balance:main.balance,
    demandItems:(seq||waved)?ALLITEMS.filter(it=>net[it]>1e-9):main.demandItems,
    rate:main.rate,bottleneck:main.bottleneck,eta,workEta,warmupEta,lpFeasible,scheduleValidation:executable.validation,
    unsat,blockedMined,infeasItems,atRiskItems,partial,feasible,
    minedUsage:main.minedUsage||[],
    gelReserved:gelReservedFromPlan(main.plan),
    objective:feasible&&eta>0?1/eta:0,allPhasesEvaluated,capped,searchExhaustive,_stabilityUpdates:stabilityUpdates};
}
function uniquePhaseKeys(phases){
  const keys=(phases||[]).map(ph=>ph&&ph.phaseKey);return keys.every(key=>typeof key==="string"&&key.length>0)&&new Set(keys).size===keys.length;
}
function etaCompareEpsilon(a,b){return Math.max(1e-9,Number.EPSILON*64*Math.max(1,Math.abs(a||0),Math.abs(b||0)));}
function throughputCompareEpsilon(a,b){return Math.max(LP_ASSIGN_EPS,Number.EPSILON*64*Math.max(1,Math.abs(a||0),Math.abs(b||0)));}
function stabilityComparisonSummary(selected,alternative){
  const selectedExecutable=projectRunExecutable(selected),alternativeExecutable=projectRunExecutable(alternative);
  const selectedPhaseOrder=(selected.phases||[]).map(ph=>ph.phaseKey),alternativePhaseOrder=(alternative.phases||[]).map(ph=>ph.phaseKey);
  const orderChanged=selectedPhaseOrder.length!==alternativePhaseOrder.length||selectedPhaseOrder.some((key,index)=>key!==alternativePhaseOrder[index]);
  const finiteMetric=value=>finiteNonnegative(value)?value:null;
  const selectedTotalEta=finiteMetric(selected.eta),alternativeTotalEta=finiteMetric(alternative.eta);
  const selectedWorkEta=finiteMetric(selected.workEta),alternativeWorkEta=finiteMetric(alternative.workEta);
  const selectedWarmupEta=finiteMetric(selected.warmupEta),alternativeWarmupEta=finiteMetric(alternative.warmupEta);
  const difference=(a,b)=>a!==null&&b!==null?a-b:null;
  const alternativeMinusSelectedTotalEta=difference(alternativeTotalEta,selectedTotalEta);
  const alternativeMinusSelectedWorkEta=difference(alternativeWorkEta,selectedWorkEta);
  const alternativeMinusSelectedWarmupEta=difference(alternativeWarmupEta,selectedWarmupEta);
  const stabilized=(selected.phases||[]).filter(ph=>ph.stabilized===true),alternativeByKey=new Map();
  (alternative.phases||[]).forEach(ph=>{const key=ph.phaseKey,matches=alternativeByKey.get(key)||[];matches.push(ph);alternativeByKey.set(key,matches);});
  let comparable=selectedExecutable&&alternativeExecutable&&stabilized.length>0&&uniquePhaseKeys(selected.phases)&&uniquePhaseKeys(alternative.phases);
  const phases=stabilized.map(selectedPhase=>{
    const matches=alternativeByKey.get(selectedPhase.phaseKey)||[],alternativePhase=matches.length===1?matches[0]:null;
    const selectedThroughput=Number.isFinite(selectedPhase.z)?selectedPhase.z:null;
    const alternativeThroughput=alternativePhase&&Number.isFinite(alternativePhase.z)?alternativePhase.z:null;
    const selectedEta=finiteMetric(selectedPhase.eta),alternativeEta=alternativePhase?finiteMetric(alternativePhase.eta):null;
    if(matches.length!==1||selectedThroughput===null||selectedThroughput<=0||alternativeThroughput===null||alternativeThroughput<=0||
      selectedEta===null||alternativeEta===null||alternativeEta<=0)comparable=false;
    const selectedThroughputLossPct=alternativeThroughput>0&&selectedThroughput!==null
      ?100*(alternativeThroughput-selectedThroughput)/alternativeThroughput:null;
    const selectedEtaPenaltyPct=alternativeEta>0&&selectedEta!==null?100*(selectedEta-alternativeEta)/alternativeEta:null;
    return {phaseKey:selectedPhase.phaseKey,name:selectedPhase.name,selectedThroughput,alternativeThroughput,
      selectedEta,alternativeEta,selectedThroughputLossPct,selectedEtaPenaltyPct};
  });
  const alternativeIsShorter=!!(comparable&&alternativeMinusSelectedTotalEta!==null&&
    alternativeMinusSelectedTotalEta < -etaCompareEpsilon(selectedTotalEta,alternativeTotalEta));
  return {comparable,selectedExecutable,alternativeExecutable,selectedPhaseOrder,alternativePhaseOrder,orderChanged,
    selectedTotalEta,alternativeTotalEta,alternativeMinusSelectedTotalEta,
    selectedWorkEta,alternativeWorkEta,alternativeMinusSelectedWorkEta,
    selectedWarmupEta,alternativeWarmupEta,alternativeMinusSelectedWarmupEta,alternativeIsShorter,phases};
}
// Top of project mode: compute the selected full run and any eligible hidden comparison before
// atomically committing only the successful visible run's proposed stability records.
function optimizeProjectTop(testOptions){
  const {gross,net,perProject}=projectDemand(),t0=performance.now();
  const projectStability=S.projectStability==="reoptimize"?"reoptimize":"prefer-current";
  if(perProject.length===0)return {empty:true,mode:"project",projLineMode:S.projLineMode==="static"?"static":"split",plan:[],phases:[],gross,net,perProject,projectStability,stabilityComparison:null,ms:performance.now()-t0};
  const seq=S.projectSeq!==false&&perProject.length>1,cacheSnapshot=cloneLineStability(_lineStability);
  const staticControl=S.projLineMode==="static"
    ?makeSolveControl(boundedPersistedField("solveBudget",S.solveBudget,2000,200,60000,true),testOptions)
    :null;
  const runOptions={staticControl};
  const selectedPolicy={readStability:projectStability==="prefer-current",rememberStability:true,stabilityCache:cacheSnapshot};
  const selected=solveProjectRun(seq,net,perProject,selectedPolicy,runOptions);selected.gross=gross;
  let stabilityComparison=null;
  if(projectStability==="prefer-current"&&selected.phases.some(ph=>ph.stabilized===true)){
    const alternative=solveProjectRun(seq,net,perProject,{readStability:false,rememberStability:false,stabilityCache:{}},runOptions);
    stabilityComparison=stabilityComparisonSummary(selected,alternative);
  }
  if(projectRunExecutable(selected))commitLineStabilityUpdates(selected._stabilityUpdates,cacheSnapshot);
  delete selected._stabilityUpdates;
  selected.staticDeadlineReached=staticControl?staticControl.deadlineReached():false;
  selected.projectStability=projectStability;selected.stabilityComparison=stabilityComparison;selected.ms=performance.now()-t0;
  return selected;
}


function optimize(testOptions){
  if(S.mode==="project")return optimizeProjectTop(testOptions);
  // Gel is a native resource inside solveCore now (vespium is its budgeted input), so items and
  // credits need no reservation sweep — the solver allocates Gel lines like any other product.
  return optimizeInner(undefined,testOptions);
}
