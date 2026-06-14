"use strict";
/* ---------- OPTIMIZER ---------- */
function relevantChain(targets){
  const relP=new Set(targets);
  let changed=true;
  while(changed){changed=false;
    [...relP].forEach(P=>RECIPE[P].inputs.forEach(k=>{
      if(PRODUCTS.includes(k)&&!relP.has(k)){relP.add(k);changed=true;}
    }));
  }
  const relR=new Set();
  relP.forEach(P=>RECIPE[P].inputs.forEach(k=>{if(RAWS.includes(k))relR.add(k);}));
  return {prods:[...relP],raws:[...relR]};
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
  relRaws.forEach(R=>{
    let best=null;
    allowed.forEach(L=>{
      const t=craftTime(R,L);if(!(t>0))return;
      const rate=L/t;
      if(!best||rate>best.rate)best={rate,L,t};
    });
    if(best)jobs.push({label:"Produce "+R,kind:"produce",res:R,lvl:best.L,ct:best.t,
      prod:[[resIndex[R],best.rate]],cons:[],h:0});
  });
  relProds.forEach(P=>{
    if(P===GEL)return;   // Gel is supplied only by reserved lines, never freely crafted
    const ins=RECIPE[P].inputs;
    allowed.forEach(L=>{
      const tt=craftTime(P,L);if(!(tt>0))return;
      let ok=true;const cons=[];
      ins.forEach(k=>{const c=S.prodCost[P][k][L];if(c==null||isNaN(c)||c<0){ok=false;}else cons.push([resIndex[k],c/tt]);});
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

// _LINES / _SUPPLY let the Gel-reservation wrapper solve over a SUBSET of lines with extra free supply.
let _LINES=null, _SUPPLY=null;
function lineRows(){return S.lines.map((ln,i)=>({__i:i,max:ln.max,spx:ln.spx,turbo:ln.turbo}));}
const sortedLines=()=>(_LINES||lineRows()).map(ln=>({orig:ln.__i,max:ln.max,sp:lineSpeed(ln),dp:dupeMult()})).sort((a,b)=>a.max-b.max||a.sp-b.sp||a.dp-b.dp);
const forgieHr=r=>(num(S.forgie&&S.forgie[r])||0)+((_SUPPLY&&_SUPPLY[r])||0);

// Core solver: weighted max-min throughput for a set of product targets over their input
// chain. Priority weights set the desired output RATIO. Each line has a duplication chance
// (output ×(1+dup), input cost unchanged) and a margin tolerance allows a small paper
// shortfall ("may-work" plans). Anytime: multi-start + iterated local search seed a near-
// optimal feasible plan, then a wall-clock-bounded branch-and-bound proves/refines it.
// Finally, a tie-break pass minimises total input shortfall among plans tied on the
// objective, so a deficit the targets can't use (free to close from surplus feeders) gets
// closed instead of left on the margin as a phantom "may-work" plan.
function solveCore(targets,w,relProds,relRaws,timeBudget){
  const resources=[...relRaws,...relProds];
  const resIndex={};resources.forEach((r,i)=>resIndex[r]=i);
  const R=resources.length;
  const tIdx=targets.map(t=>resIndex[t]);
  const tol=Math.max(0,Math.min(50,num(S.margin)||0))/100;
  // Lil' Forgie: free passive supply (per second) of each resource, added to the produced side.
  const baseArr=Float64Array.from(resources.map(r=>forgieHr(r)/3600));

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
  const bp=lineJobs.map((js,i)=>targets.map(t=>{let m=0;js.forEach(j=>{if(j.kind==="craft"&&j.res===t)m=Math.max(m,j.prod[0][1]);});return m*sorted[i].sp*sorted[i].dp;}));
  const SP=targets.map((t,ti)=>{const a=new Array(N+1).fill(0);for(let i=N-1;i>=0;i--)a[i]=a[i+1]+bp[i][ti];return a;});
  // feasibility prune: max extra production of each resource available from lines i..N-1.
  // If current produced + this suffix still can't cover current consumed, the branch is dead.
  const maxProd=Array.from({length:R},()=>new Float64Array(N+1));
  for(let r=0;r<R;r++)for(let i=N-1;i>=0;i--){let m=0;lineJobs[i].forEach(j=>{for(const[rr,a]of j.prod)if(rr===r)m=Math.max(m,a*sorted[i].sp*sorted[i].dp);});maxProd[r][i]=maxProd[r][i+1]+m;}

  const produced=new Float64Array(R), consumed=new Float64Array(R);
  const choice=new Array(N).fill(0);
  let best={score:0,choice:new Array(N).fill(0),produced:new Float64Array(R),consumed:new Float64Array(R)};
  const EPS=1e-9;

  let nodes=0;let capped=false;const tStart=performance.now();

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
  const feasibleNow=()=>{for(let r=0;r<R;r++)if(produced[r]<consumed[r]*(1-tol)-1e-7)return false;return true;};
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
    if(((++nodes)&8191)===0&&performance.now()-tStart>timeBudget)capped=true;
    if(capped)return;
    if(i===N){
      for(let r=0;r<R;r++)if(produced[r]<consumed[r]*(1-tol)-1e-7)return;
      let sc=Infinity;
      for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]];sc=Math.min(sc,net/w[k]);}
      if(sc>best.score+EPS){best={score:sc,choice:choice.slice(),produced:produced.slice(),consumed:consumed.slice()};}
      return;
    }
    // feasibility prune: any resource whose current shortfall can't be covered by remaining lines kills this branch
    for(let r=0;r<R;r++)if(produced[r]+maxProd[r][i]<consumed[r]*(1-tol)-1e-7)return;
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
  // multi-start local search from each target, then iterated local search to close the gap
  let inc=null;
  targets.map(t=>resIndex[t]).forEach(res=>{const ch=new Array(N);for(let i=0;i<N;i++){const bj=bestJobFor(i,res);ch[i]=bj>=0?bj:idleIdx(i);}const sc=localOpt(ch);if(sc!=null&&(!inc||sc>inc.sc))inc={sc,ch:ch.slice()};});
  if(inc&&N>0){
    const ilsT=Math.min(timeBudget*0.5,120);
    for(let it=0;it<8000;it++){
      if((it&31)===0&&performance.now()-tStart>ilsT)break;
      const ch=inc.ch.slice();const k=1+((rnd()*2)|0);
      for(let m=0;m<=k;m++){const li=(rnd()*N)|0,js=lineJobs[li];ch[li]=(rnd()*js.length)|0;}
      const sc=localOpt(ch);if(sc!=null&&sc>inc.sc+EPS)inc={sc,ch:ch.slice()};
    }
    evalChoice(inc.ch);best={score:scoreNow(),choice:inc.ch.slice(),produced:produced.slice(),consumed:consumed.slice()};
  }
  produced.set(baseArr);consumed.fill(0);
  dfs(0,0);
  // balance any free deficit out of the now-optimal plan (keeps the objective, trims the margin use)
  if(best.score>EPS&&N>0){
    const ch=minDeficitAtScore(best.choice.slice(),best.score);
    evalChoice(ch);best={score:scoreNow(),choice:ch.slice(),produced:produced.slice(),consumed:consumed.slice()};
  }
  let usesMargin=false;for(let r=0;r<R;r++)if(best.produced[r]<best.consumed[r]-1e-6)usesMargin=true;
  const forgie={};resources.forEach((r,i)=>forgie[r]=baseArr[i]*3600);
  return {best,sorted,lineJobs,resources,resIndex,R,N,tIdx,tol,capped,usesMargin,issues,forgie,feasible:best.score>1e-9,ms:performance.now()-tStart};
}

// Build the per-line plan + resource balance (per hour) from a core solve.
function planFrom(sr){
  const {best,sorted,lineJobs,resources,resIndex,feasible,forgie}=sr;
  const plan=new Array(sorted.length);
  sorted.forEach((s,i)=>{const idle=lineJobs[i].find(j=>j.kind==="idle")||lineJobs[i][0];
    plan[s.orig]={line:s.orig+1,max:s.max,spx:s.sp,dup:(s.dp-1)*100,sp:s.sp,dp:s.dp,job:feasible?lineJobs[i][best.choice[i]]:idle};});
  // best.produced already includes Forgie's supply; split it back out for display
  const balance=resources.map(r=>{const i=resIndex[r];const f=(forgie&&forgie[r])||0;
    const total=feasible?best.produced[i]*3600:0;
    return {res:r,prod:Math.max(0,total-f),forgie:feasible?f:0,cons:feasible?best.consumed[i]*3600:0};});
  return {plan,balance};
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
  const itemsBudget=timeBudget||600, credBudget=timeBudget||650;
  const mode=S.mode==="credits"?"credits":"items";
  if(mode==="items"){
    const targets=PRODUCTS.filter(p=>S.targets[p].on);
    if(targets.length===0)return {empty:true,mode};
    const w=targets.map(p=>S.targets[p].w);
    const rc=relevantChain(targets);
    const t0=performance.now();
    const sr=solveCore(targets,w,rc.prods,rc.raws,itemsBudget);
    const {plan,balance}=planFrom(sr);
    const out={};targets.forEach((t,k)=>{out[t]=sr.feasible?(sr.best.produced[sr.tIdx[k]]-sr.best.consumed[sr.tIdx[k]])*3600:0;});
    const objective=sr.feasible?Math.min(...targets.map((t,k)=>(out[t]||0)/w[k])):0;
    return {empty:false,mode,issues:sr.issues,plan,balance,out,resIndex:sr.resIndex,targets,objective,tol:sr.tol,usesMargin:sr.usesMargin,feasible:sr.feasible,capped:sr.capped,ms:performance.now()-t0};
  }
  // credits: the optimum is always mono-product — dedicate the whole factory to ONE item.
  // So just compute each priced item's max output/hr × its price and take the winner.
  const t0=performance.now();
  const pricedP=PRODUCTS.filter(p=>(num(S.sellPrice&&S.sellPrice[p])||0)>0);
  const pricedR=RAWS.filter(r=>(num(S.sellPrice&&S.sellPrice[r])||0)>0);
  const issues=[];let capped=false,usesMargin=false;
  if(pricedP.length+pricedR.length===0)issues.push("No sell prices entered. Open the “Sell prices” button and add at least one.");
  // When Gel lines are reserved (free Gel supply active), only items whose chain consumes Gel
  // can possibly do better than the no-reservation pass — every other item is strictly best at
  // full line-count, already evaluated in the k=0 sweep. Skipping them here turns the
  // credits×reservation sweep from (priced items × subsets) into (Gel-chain items × subsets).
  const gelReserved=!!(_SUPPLY&&(num(_SUPPLY[GEL])||0)>1e-9);
  const evalP=gelReserved?pricedP.filter(p=>chainNeedsGel(p)):pricedP;
  const evalR=gelReserved?[]:pricedR;
  const budgetEach=Math.max(25,Math.floor(credBudget/Math.max(1,evalP.length)));
  const cand=[];
  evalP.forEach(P=>{
    const price=num(S.sellPrice[P])||0;
    const ins=RECIPE[P].inputs;
    const hasCost=LEVELS.some(L=>ins.every(k=>S.prodCost[P][k][L]!=null&&!isNaN(S.prodCost[P][k][L])));
    if(!hasCost){issues.push("No material cost entered for "+P+" — can't price it.");cand.push({item:P,kind:"product",out:0,price,credits:0,plan:null,balance:null,resIndex:{},feasible:false});return;}
    const rc=relevantChain([P]);
    const sr=solveCore([P],[1],rc.prods,rc.raws,budgetEach);
    if(sr.capped)capped=true;if(sr.usesMargin)usesMargin=true;
    const {plan,balance}=planFrom(sr);
    const out=sr.feasible?(sr.best.produced[sr.resIndex[P]]-sr.best.consumed[sr.resIndex[P]])*3600:0;
    cand.push({item:P,kind:"product",out,price,credits:out*price,plan,balance,resIndex:sr.resIndex,feasible:sr.feasible});
  });
  evalR.forEach(Rw=>{const s=solveRaw(Rw);const price=num(S.sellPrice[Rw])||0;cand.push({item:Rw,kind:"raw",out:s.out,price,credits:s.out*price,plan:s.plan,balance:s.balance,resIndex:s.resIndex,feasible:s.feasible});});
  cand.sort((a,b)=>b.credits-a.credits);
  const top=cand[0];
  const feasible=!!top&&top.credits>1e-9;
  return {empty:false,mode,issues,ranking:cand,bestItem:feasible?top.item:null,credits:feasible?top.credits:0,objective:feasible?top.credits:0,
    plan:feasible?top.plan:idlePlan(),balance:feasible?top.balance:[],resIndex:feasible?top.resIndex:{},
    tol:Math.max(0,Math.min(50,num(S.margin)||0))/100,usesMargin,feasible,capped,ms:performance.now()-t0};
}

/* ---------- Gel reservation wrapper ----------
   Gel comes only from reserved lines (free mined ore). When the user reserves N lines at
   compression C, try every way to pick N of the lines, run them on Gel@C (each line's own
   speed/dupe), feed that Gel to the rest as free supply, optimise the remaining lines for the
   targets, and keep the line-choice with the best objective. */
function combos(n,k){const out=[];const pick=(start,acc)=>{if(acc.length===k){out.push(acc.slice());return;}for(let i=start;i<n;i++){acc.push(i);pick(i+1,acc);acc.pop();}};pick(0,[]);return out;}
// a line can't compress above its own max cap, so clamp Gel's compression to it
const gelCompFor=(row,C)=>Math.min(C,row.max||C);
// Gel output / vespium burn for a whole line running Gel @L (≤ the line's own cap), full time.
function gelOutHr(row,L){const sp=lineSpeed(row),dp=dupeMult(),ct=craftTime(GEL,L);return ct>0?(L/ct)*effSpeed(sp,ct)*dp*3600:0;}
function gelVespHr(row,L){const sp=lineSpeed(row),ct=craftTime(GEL,L);return ct>0?gelOreCost(L).vesp*(effSpeed(sp,ct)/ct)*3600:0;}
// Per-line gel rate at the line's max compression — used only to rank reservation candidates.
function gelRatePerHr(row,C){return gelOutHr(row,gelCompFor(row,C));}
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
function gelVespBudgetHr(){return Math.max(0,num(S.gelVesp)||0)*60;}
function projectDemand(){
  const gross={};ALLITEMS.forEach(it=>gross[it]=0);
  const perProject=[];
  (S.projects||[]).forEach(p=>{
    if(!p.on)return;
    const lv=p.levels||[];
    const from=Math.max(1,Math.floor(num(p.from)||1));
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
    perProject.push({name:p.name||"Project",catId:p.catId||"",prio:(p.prio!=null?p.prio:null),from:start+1,to,levels:lv.length,sub});
  });
  const inv=it=>num(S.inventory&&S.inventory[it])||0;
  const net={};ALLITEMS.forEach(it=>{net[it]=Math.max(0,gross[it]-inv(it));});
  // Frames & Wire each consume Bits that aren't in the recipe graph — fold them into Bits demand
  const ppBits=PREPROD_BITS.Frames*(net.Frames||0)+PREPROD_BITS.Wire*(net.Wire||0);
  if(ppBits>0)net.Bits=Math.max(0,(gross.Bits||0)+ppBits-inv("Bits"));
  return {gross,net,perProject};
}
// Does crafting this item require Gel anywhere in its chain? (Gel is only made on reserved lines.)
function chainNeedsGel(item,seen){
  if(item===GEL)return true;
  seen=seen||new Set();if(seen.has(item))return false;seen.add(item);
  const r=RECIPE[item];if(!r)return false;
  return (r.inputs||[]).some(k=>chainNeedsGel(k,seen));
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
// Build & solve the makespan LP: each line splits its time-fraction across (item,level) jobs so that
// net production meets the demand ratio. z = throughput multiplier (1/hr); makespan = 1/z.
function projectSchedule(net,targets){
  const lns=sortedLines();   // respects any Gel-reserved subset via _LINES
  const prodT=targets.filter(it=>PRODUCTS.includes(it));
  const rawT=targets.filter(it=>RAWS.includes(it));
  const rc=relevantChain(prodT);
  // Gel IS included as a constrained resource: it gets no production variable (only reserved
  // lines make it, supplied via forgieHr), but its consumption (by Wire) and any direct Gel
  // demand are capped at that supply — so the plan can't over-consume gel it can't produce.
  const items=[...new Set([...rc.raws,...rawT,...rc.prods,...prodT])];
  const itemIdx={};items.forEach((it,i)=>itemIdx[it]=i);
  // jobs: one variable per (line,item,level<=cap). Letting the LP pick the level finds the true
  // makespan-optimal compression (leans high for raw speed, eases off when materials bottleneck).
  const vars=[];
  lns.forEach((ln,li)=>{
    items.forEach(it=>{
      LEVELS.filter(L=>L<=ln.max).forEach(L=>{
        if(RAWS.includes(it)){const t=craftTime(it,L);if(!(t>0))return;const es=effSpeed(ln.sp,t);vars.push({li,item:it,lvl:L,rate:(L/t)*es*ln.dp*3600,cons:[]});}
        else if(PRODUCTS.includes(it)&&it!==GEL){const ins=RECIPE[it].inputs;const tt=craftTime(it,L);if(!(tt>0))return;
          if(!ins.every(k=>S.prodCost[it][k][L]!=null&&!isNaN(S.prodCost[it][k][L])))return;
          const es=effSpeed(ln.sp,tt);vars.push({li,item:it,lvl:L,rate:(L/tt)*es*ln.dp*3600,cons:ins.map(k=>({item:k,perHr:(S.prodCost[it][k][L]/tt)*es*3600}))});}
      });
    });
  });
  const nY=vars.length,zCol=nY,n=nY+1;
  const D0=Math.max(1,...targets.map(it=>net[it]||0));   // normalize demand to keep LP coeffs sane
  const A=[],b=[];
  lns.forEach((ln,li)=>{const row=new Array(n).fill(0);vars.forEach((v,vi)=>{if(v.li===li)row[vi]=1;});A.push(row);b.push(1);});
  items.forEach(it=>{
    const row=new Array(n).fill(0);
    vars.forEach((v,vi)=>{if(v.item===it)row[vi]-=v.rate;v.cons.forEach(c=>{if(c.item===it)row[vi]+=c.perHr;});});
    row[zCol]=(net[it]||0)/D0;
    A.push(row);b.push(forgieHr(it));
  });
  const c=new Array(n).fill(0);c[zCol]=1;
  const sol=lpMaximize(c,A,b);
  const y=sol.x||new Float64Array(n);
  const rate={};items.forEach(it=>rate[it]=forgieHr(it));
  vars.forEach((v,vi)=>{const yi=y[vi]||0;if(yi<=1e-9)return;rate[v.item]+=v.rate*yi;v.cons.forEach(c=>{rate[c.item]=(rate[c.item]||0)-c.perHr*yi;});});
  const plan=lns.map(ln=>({line:ln.orig+1,max:ln.max,sp:ln.sp,dp:ln.dp,entries:[]}));
  const planByLi=lns.map((_,i)=>i);
  vars.forEach((v,vi)=>{const yi=y[vi]||0;if(yi<=1e-4)return;plan[v.li].entries.push({item:v.item,lvl:v.lvl,frac:yi,outHr:v.rate*yi,cons:v.cons.map(c=>({item:c.item,hr:c.perHr*yi}))});});
  plan.forEach(p=>p.entries.sort((a,b)=>b.frac-a.frac));
  plan.sort((a,b)=>a.line-b.line);
  return {rate,plan,items,z:(y[zCol]||0)/D0};
}
// Solve one batch of demand (a single project, or all of them combined) into a pipelined phase.
function solvePhaseFor(net,name){
  const demandItems=ALLITEMS.filter(it=>net[it]>1e-9);
  const gelAvail=forgieHr(GEL)>1e-9;
  const unsat=gelAvail?[]:demandItems.filter(it=>chainNeedsGel(it));
  const targets=demandItems.filter(it=>unsat.indexOf(it)<0);
  if(targets.length===0)
    return {name,plan:[],balance:[],demandItems,net,rate:{},eta:0,bottleneck:null,infeasItems:[],unsat,items:[],z:0,feasible:false};
  const sch=projectSchedule(net,targets);
  const rate={};targets.forEach(it=>rate[it]=Math.max(0,sch.rate[it]||0));
  let eta=0,bottleneck=null;const infeasItems=[];
  targets.forEach(it=>{if(rate[it]<=1e-9)infeasItems.push(it);else{const t=net[it]/rate[it];if(t>eta){eta=t;bottleneck=it;}}});
  const feasible=infeasItems.length===0&&sch.z>1e-15;
  const prodHr={},consHr={};sch.items.forEach(it=>{prodHr[it]=0;consHr[it]=0;});
  sch.plan.forEach(p=>p.entries.forEach(e=>{prodHr[e.item]=(prodHr[e.item]||0)+e.outHr;e.cons.forEach(c=>{consHr[c.item]=(consHr[c.item]||0)+c.hr;});}));
  const balance=sch.items.map(it=>({res:it,prod:prodHr[it]||0,forgie:forgieHr(it),cons:consHr[it]||0}));
  return {name,plan:sch.plan,balance,demandItems,net,rate,eta,bottleneck,infeasItems,unsat,items:sch.items,z:sch.z,feasible};
}
// net demand for a project's level-sum `sub`, against an inventory map (folds in Frame bits).
function projNetVec(sub,invMap){
  const net={};ALLITEMS.forEach(it=>net[it]=Math.max(0,(sub[it]||0)-(invMap[it]||0)));
  const ppBits=PREPROD_BITS.Frames*(net.Frames||0)+PREPROD_BITS.Wire*(net.Wire||0);
  if(ppBits>0)net.Bits=Math.max(0,(sub.Bits||0)+ppBits-(invMap.Bits||0));
  return net;
}
// Run `fn` with the best N lines reserved for Gel (supplied as free input to the rest).
// Build the project phases (combined or sequenced) using the current _LINES/_SUPPLY pool.
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
  const preds=perProject.map((p,i)=>{
    const set={};
    UNLOCK_MATERIALS.forEach(m=>{const u=unlockerOf[m];if(u!=null&&u!==i&&(p.sub[m]||0)>0)set[u]=1;});
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
function buildProjectPhases(seq,net,perProject){
  const layer=unlockLayers(perProject);
  const maxL=perProject.length?Math.max.apply(null,layer):0;
  const invStart=()=>{const o={};ALLITEMS.forEach(it=>o[it]=num(S.inventory&&S.inventory[it])||0);return o;};
  if(!seq){
    if(maxL===0){   // nothing gated — original single combined phase (no regression)
      const ph=solvePhaseFor(net,perProject.length>1?"All projects":perProject[0].name);
      ph.demandSub={};ALLITEMS.forEach(it=>ph.demandSub[it]=perProject.reduce((s,p)=>s+(p.sub[it]||0),0));
      ph.doneAt=ph.eta;return [ph];
    }
    // unlocks force ordered "waves": combine within a layer, sequence the layers, carrying
    // crafted surplus forward as inventory so later waves only make what's still missing.
    const invRun=invStart();let cum=0;const phases=[];
    for(let L=0;L<=maxL;L++){
      const members=perProject.filter((_,i)=>layer[i]===L);
      if(!members.length)continue;
      const sumSub={};ALLITEMS.forEach(it=>sumSub[it]=members.reduce((s,p)=>s+(p.sub[it]||0),0));
      const ph=solvePhaseFor(projNetVec(sumSub,invRun),members.map(m=>m.name).join(" + "));
      ph.members=members.map(m=>m.name);ph.demandSub=sumSub;ph.wave=phases.length+1;
      ALLITEMS.forEach(it=>{invRun[it]=Math.max(0,(invRun[it]||0)-sumSub[it]);});
      cum+=ph.eta;ph.doneAt=cum;phases.push(ph);
    }
    return phases;
  }
  // sequenced: one project per phase, ordered by (unlock layer, manual priority, cheapest makespan)
  const invInit=invStart();
  const cost=perProject.map(p=>{const ph=solvePhaseFor(projNetVec(p.sub,invInit),p.name);return ph.feasible?ph.eta:Infinity;});
  const order=perProject.map((p,i)=>({p,i})).sort((a,b)=>{
    if(layer[a.i]!==layer[b.i])return layer[a.i]-layer[b.i];   // unlock precedence (hard)
    const pa=a.p.prio,pb=b.p.prio;
    if(pa!=null&&pb!=null){if(pa!==pb)return pa-pb;}            // manual order, lower first
    else if(pa!=null)return -1;
    else if(pb!=null)return 1;
    return cost[a.i]-cost[b.i];                                // else cheapest makespan
  });
  const invRun=invStart();let cum=0;const phases=[];
  order.forEach(({p})=>{
    const ph=solvePhaseFor(projNetVec(p.sub,invRun),p.name);
    ph.prio=(p.prio!=null?p.prio:null);ph.demandSub=p.sub;
    ALLITEMS.forEach(it=>{invRun[it]=Math.max(0,(invRun[it]||0)-(p.sub[it]||0));});
    cum+=ph.eta;ph.doneAt=cum;phases.push(ph);
  });
  return phases;
}
// Prefer the reservation that leaves the fewest demanded items unmade, then finishes fastest.
function betterProjCand(a,b){if(a.badN!==b.badN)return a.badN<b.badN;return a.eta<b.eta;}
function addGelLinesToPlan(plan,perLine){
  plan=plan.slice();
  perLine.forEach(pl=>{const row=S.lines[pl.__i],sp=lineSpeed(row),dp=dupeMult();
    plan.push({line:pl.__i+1,max:pl.max,sp,dp,reserved:true,vespHr:pl.vespHr,
      entries:[{item:GEL,lvl:pl.L,frac:pl.frac,outHr:pl.gelHr,cons:[]}]});});
  return plan.sort((a,b)=>a.line-b.line);
}
// Top of project mode: builds one combined phase, or a sequence of per-project phases
// (forced-"do first" projects ahead, then cheapest-makespan first), with inventory carried across.
function optimizeProjectTop(){
  const {gross,net,perProject}=projectDemand();
  const t0=performance.now();
  if(perProject.length===0)return {empty:true,mode:"project",plan:[],phases:[],gross,net,perProject};
  const seq=S.projectSeq!==false&&perProject.length>1;
  const M=S.lines.length;
  const vespHr=gelVespBudgetHr();   // vespium income (per hour) — the Gel budget; 0 → no Gel
  const ranked=lineRows().map(r=>({r,g:gelRatePerHr(r,r.max)})).sort((a,b)=>b.g-a.g);
  // Offer the top-k best-Gel lines to Gel (k=0..M); gelLoadout picks which to actually run within
  // the vespium budget. Keep whichever k makes the most of what was asked for and finishes soonest.
  const Nmax=vespHr>0?M:0;
  let best=null;
  for(let k=0;k<=Nmax;k++){
    const pool=ranked.slice(0,k).map(o=>o.r);
    const lo=k>0?gelLoadout(pool,vespHr):{gelHr:0,vespHr:0,perLine:[]};
    if(lo.perLine.length){const set=new Set(lo.perLine.map(p=>p.__i));_LINES=lineRows().filter(r=>!set.has(r.__i));_SUPPLY={[GEL]:lo.gelHr};}
    let phases=buildProjectPhases(seq,net,perProject);
    _LINES=null;_SUPPLY=null;
    if(lo.perLine.length)phases=phases.map(ph=>Object.assign({},ph,{plan:addGelLinesToPlan(ph.plan,lo.perLine)}));
    const eta=phases.reduce((s,ph)=>s+ph.eta,0);
    const badN=new Set([].concat(...phases.map(ph=>(ph.unsat||[]).concat(ph.infeasItems||[])))).size;
    const cand={phases,loadout:lo,eta,badN};
    if(!best||betterProjCand(cand,best))best=cand;
  }
  const {phases,loadout}=best;
  const waved=!seq&&phases.length>1;   // all-at-once split into unlock-ordered waves
  const eta=phases.reduce((s,ph)=>s+ph.eta,0);
  const feasible=phases.length>0&&phases.every(ph=>ph.feasible);
  const unsat=[...new Set([].concat(...phases.map(ph=>ph.unsat||[])))];
  const infeasItems=[...new Set([].concat(...phases.map(ph=>ph.infeasItems||[])))];
  const main=phases[0]||{plan:[],balance:[],rate:{},demandItems:[],bottleneck:null};
  return {empty:false,mode:"project",sequenced:seq,waved,phases,perProject,gross,net,
    plan:main.plan,balance:main.balance,
    demandItems:(seq||waved)?ALLITEMS.filter(it=>net[it]>1e-9):main.demandItems,
    rate:main.rate,bottleneck:main.bottleneck,eta,unsat,infeasItems,feasible,
    gelReserved:loadout.perLine.length?{lines:loadout.perLine.length,outHr:loadout.gelHr,vespHr:loadout.vespHr,perLine:loadout.perLine}:null,
    objective:feasible&&eta>0?1/eta:0,ms:performance.now()-t0};
}


function optimize(){
  if(S.mode==="project")return optimizeProjectTop();
  const M=S.lines.length;
  const vespHr=gelVespBudgetHr();   // vespium income (per hour) — the Gel budget; 0 → no Gel
  if(vespHr<=0||M===0)return optimizeInner();
  // items mode with no Gel-consuming target gains nothing from reserving Gel — skip the whole sweep.
  // (credits can still want Gel for a priced Gel-chain item even with no explicit target.)
  if(S.mode==="items"&&!PRODUCTS.filter(p=>S.targets[p].on).some(p=>chainNeedsGel(p)))return optimizeInner();
  const rows=lineRows();
  // Offer different pools of lines to Gel; gelLoadout decides which to actually run (and at what
  // compression) within the vespium budget, so only the lines it uses get reserved — the rest stay
  // available for targets. Full subset sweep stays exact for typical factories; for very large line
  // counts, offer the "top-k best-Gel lines" instead to keep the sweep bounded.
  let subs;
  if(M<=8){subs=[];for(let k=0;k<=M;k++)subs.push(...combos(M,k));}
  else{const ranked=rows.map((_,i)=>i).sort((a,b)=>gelRatePerHr(rows[b],rows[b].max)-gelRatePerHr(rows[a],rows[a].max));
    subs=[];for(let k=0;k<=M;k++)subs.push(ranked.slice(0,k));}
  // Many offered pools collapse to the same reserved-line set — dedup first, then split the time
  // budget across the distinct sets actually solved (not the raw pool count).
  const seen=new Set();const cands=[];let haveEmpty=false;
  subs.forEach(idx=>{
    const lo=gelLoadout(idx.map(i=>rows[i]),vespHr);
    const used=lo.perLine.filter(p=>p.gelHr>1e-9).map(p=>p.__i).sort((a,b)=>a-b);
    if(used.length){const key=used.join(",");if(seen.has(key))return;seen.add(key);}
    else{if(haveEmpty)return;haveEmpty=true;}
    cands.push({used,lo});
  });
  const innerBudget=Math.max(20,Math.floor((S.mode==="items"?350:800)/Math.max(1,cands.length)));
  const t0=performance.now();
  let best=null,emptyInner=false,baseRes=null;
  cands.forEach(({used,lo})=>{
    const set=new Set(used);
    _LINES=rows.filter(r=>!set.has(r.__i));_SUPPLY={[GEL]:lo.gelHr};
    const res=optimizeInner(innerBudget);
    _LINES=null;_SUPPLY=null;
    if(res.empty){emptyInner=true;return;}
    if(used.length===0)baseRes=res;   // no-reservation pass: the full-pool ranking for every item
    if(!best||(res.objective||0)>best.res.objective+1e-12)best={res,loadout:lo,vespHr};
  });
  if(!best)return emptyInner?{empty:true,mode:S.mode}:optimizeInner();
  // Credits skips non-Gel items inside reserved subsets, so a reserved winner carries only the
  // Gel-chain candidates. Splice the full-pool ranking/issues back in so the head-to-head table
  // and warnings stay complete; the winner (a Gel-chain item that out-scored every full-pool
  // item) and its plan are unchanged.
  if(S.mode==="credits"&&baseRes&&best.res!==baseRes&&best.res.ranking){
    const have=new Set(best.res.ranking.map(c=>c.item));
    const ranking=best.res.ranking.concat((baseRes.ranking||[]).filter(c=>!have.has(c.item))).sort((a,b)=>b.credits-a.credits);
    const mergedIssues=[...new Set([...(best.res.issues||[]),...(baseRes.issues||[])])];
    best={...best,res:{...best.res,ranking,issues:mergedIssues}};
  }
  return assembleGel(best,performance.now()-t0);
}
// Merge the reserved Gel lines into the inner plan + balance for display.
function assembleGel(best,ms){
  const {res,loadout}=best;
  const plan=res.plan.slice();
  loadout.perLine.forEach(pl=>{const row=S.lines[pl.__i],sp=lineSpeed(row),dp=dupeMult(),L=pl.L,ct=craftTime(GEL,L);
    plan[pl.__i]={line:pl.__i+1,max:pl.max,spx:sp,dup:dupeChance(),sp,dp,reserved:true,gelHr:pl.gelHr,vespHr:pl.vespHr,frac:pl.frac,
      job:{kind:"craft",res:GEL,lvl:L,ct,prod:[[0,ct>0?L/ct:0]],cons:[]}};});
  plan.sort((a,b)=>a.line-b.line);
  // re-attribute Gel supply in the balance: it's produced by the reserved lines, not Lil' Forgie
  const fGel=num(S.forgie&&S.forgie[GEL])||0;
  const balance=(res.balance||[]).map(b=>b.res===GEL?{...b,prod:loadout.gelHr,forgie:fGel}:b);
  if(res.balance&&!res.balance.some(b=>b.res===GEL)&&loadout.gelHr>0)
    balance.push({res:GEL,prod:loadout.gelHr,forgie:fGel,cons:0});
  return {...res,plan,balance,gelReserved:{lines:loadout.perLine.length,outHr:loadout.gelHr,vespHr:loadout.vespHr,perLine:loadout.perLine},ms};
}

