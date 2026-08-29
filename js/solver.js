"use strict";
/* ---------- OPTIMIZER ---------- */
// Mined resources enter the solver as independent resources whose free supplies equal the
// user's corresponding mined incomes. Rocks remain informational rather than budgeted.
const VESP="Vespium";
// One correctness threshold for reconstructing project rates and executable LP plan entries.
const LP_ASSIGN_EPS=1e-9;
/* "More than anything in this problem can use", as a per-second float the search can carry. Kept a
 * factor of 3600 below the float ceiling because every rate here is reported per hour, and an
 * hourly figure of Infinity is exactly the em-dash issue #142 was about. */
const UNBOUNDED_PER_SEC=Number.MAX_VALUE/3600;
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
/* The DFS's dual-priced bound (WS4.3), off by default and measured that way.
 *
 * It is a real bound and it dominates the standing one, but on this game's shape it prunes a tree
 * the search hardly enters: across every bench fixture and every budget the DFS is reached with at
 * most a few hundred nodes left in the clock, because the iterated local search consumes the budget
 * first and the convergence window closes what is left. Pricing those nodes cannot pay for building
 * the prices. It ships behind this switch so the measurement can be repeated rather than argued
 * about, and so a factory shape that does reach the DFS — far fewer job choices per line, or a
 * budget the local search converges well inside — can turn it on without a code change.
 * opts.dfsDualBound overrides it per solve. */
let _dfsDualBound=false;
function getDfsDualBound(){return _dfsDualBound;}
function setDfsDualBound(on){_dfsDualBound=!!on;}
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
    .filter(r=>r&&minedBudgetHr(r).gt(DEC_ZERO)))];
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
        const rate=craftYield(Rw,L)/t;
        jobs.push({label:"Produce "+Rw,kind:"produce",res:Rw,lvl:L,ct:t,
          prod:[[resIndex[Rw],rate]],cons:[],h:rate/w[ti]});
      });
    }else{
      // Raw needed only as a feeder input: one fastest-rate produce job is enough.
      let best=null;
      allowed.forEach(L=>{
        const t=craftTime(Rw,L);if(!(t>0))return;
        const rate=craftYield(Rw,L)/t;
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
      ins.forEach(k=>{const c=recipeRate(S.prodCost[P][k][L],tt);if(c===null){ok=false;}else cons.push([resIndex[k],c]);});
      const mined=MINED_CRAFTS[P];
      if(mined){
        const r=mined.resource;
        if(resIndex[r]==null)return;
        const c=recipeRate(minedCost(P,L)[r],tt);
        if(c===null)ok=false;else cons.push([resIndex[r],c]);
      }
      if(!ok)return;
      const rate=craftYield(P,L)/tt;const ti=targets.indexOf(P);
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
// Lil' Forgie's free supply of a resource, per hour. A quantity, so a Decimal.
const forgieHr=r=>toDec0(S.forgie&&S.forgie[r]);
/* A free supply as the float64 rate the schedulers, the balance table and the flat job arrays all
 * work in. A supply too large for a float is one nothing could exhaust, so it saturates at the
 * largest finite double rather than becoming Infinity — "more than anything here can use" either
 * way, but a number the arithmetic downstream can still carry. */
const supplyRate=value=>{const flat=toDec0(value).toNumber();return Number.isFinite(flat)?flat:Number.MAX_VALUE;};
/* A recipe coefficient is a Decimal; the job tables the search evaluates are Float64Arrays. This is
 * the one conversion between them, and it is allowed to fail. A cost that will not fit a float64 is
 * a craft no factory could ever feed, so that (item, level) is dropped exactly as a missing or
 * negative cost is dropped — an unmakeable job, not a silent Infinity in the tableau. */
function recipeRate(cost,seconds){
  if(!(seconds>0))return null;
  /* A cost that is already a plain number divides in float without ever touching a Decimal. That
   * matters: converting and converting back re-rounds the mantissa, and these rates decide which
   * compression step fits a budget. The fixed mined costs take this path. */
  if(typeof cost==="number"){
    if(!Number.isFinite(cost)||cost<0)return null;
    const rate=cost/seconds;return Number.isFinite(rate)?rate:null;
  }
  const value=toDec(cost);
  if(value===null||value.lt(DEC_ZERO))return null;
  const flat=value.toNumber();
  if(Number.isFinite(flat)){const rate=flat/seconds;return Number.isFinite(rate)?rate:null;}
  // Only a cost no float64 could hold needs the Decimal division.
  const rate=value.div(seconds).toNumber();
  return Number.isFinite(rate)?rate:null;
}
// Whether a recipe has a usable cost for every input at this compression level.
const hasRecipeCost=(item,inputs,L)=>inputs.every(k=>toDec(S.prodCost[item]&&S.prodCost[item][k]&&S.prodCost[item][k][L])!==null);

/* One clock read per this many checkpoints. A search probe is a few hundred nanoseconds of typed-
 * array arithmetic and performance.now() is tens of nanoseconds of it, so sampling the clock on
 * every probe spends a real share of the budget deciding whether the budget is spent. The stride
 * bounds the cost of that decision without loosening any guarantee by more than itself: a deadline
 * — root or local — is observed at most this many probes late, never later, because the deadline
 * test is skipped rather than weakened. That overshoot is counted in probes, not milliseconds, so
 * it does not grow on a slow machine; and result finalization reads the clock unconditionally, so
 * an expiry can be deferred past a few probes but never past the result. */
const CLOCK_SAMPLE_EVERY=16;

// One solve control owns one absolute deadline. Credits shares the same instance across every
// candidate, so starting a new candidate can never restart the user's clock. The optional hooks are
// direct-source test seams: they are never persisted or posted through the Worker protocol.
function makeSolveControl(timeBudget,options){
  const opts=options||{},clock=typeof opts.now==="function"?opts.now:()=>performance.now();
  const observer=typeof opts.onCheckpoint==="function"?opts.onCheckpoint:null;
  const budget=Math.max(0,Number(timeBudget)||0),workLimit=Number.isFinite(opts.workLimit)?Math.max(0,Math.floor(opts.workLimit)):Infinity;
  // A test that prices time per clock READ rather than per checkpoint passes clockSampleEvery:1.
  const sampleEvery=Number.isFinite(opts.clockSampleEvery)?Math.max(1,Math.floor(opts.clockSampleEvery)):CLOCK_SAMPLE_EVERY;
  let lastNow=Number(clock());if(!Number.isFinite(lastNow))lastNow=0;
  const startedAt=lastNow,deadline=startedAt+budget;
  let work=0,stopped=false,deadlineReached=false,reason=null,sampleSkips=0;
  const emit=event=>{if(observer)observer(event);};
  const readNow=()=>{let value=Number(clock());if(!Number.isFinite(value))value=lastNow;if(value<lastNow)value=lastNow;lastNow=value;return value;};
  // True on the first checkpoint and every sampleEvery-th one after it. Shared by both checkpoint
  // entry points so a solve that mixes them still reads the clock at the same average rate.
  const dueForSample=()=>{if(sampleSkips>0){sampleSkips--;return false;}sampleSkips=sampleEvery-1;return true;};
  const reserveWork=(label,cost)=>{
    if(stopped)return false;
    const units=Math.max(1,Math.floor(Number(cost)||1));
    if(work+units>workLimit){stopped=true;deadlineReached=true;reason="work";emit({type:"stopped",label,reason,work,elapsed:lastNow-startedAt});return false;}
    work+=units;return true;
  };
  const stopAtDeadline=(label,now)=>{
    if(now>=deadline){stopped=true;deadlineReached=true;reason="deadline";emit({type:"stopped",label,reason,work,elapsed:now-startedAt});return false;}
    return true;
  };
  // Work is charged first and on every call, so the work limit stays exact; only the clock is
  // amortized. emit still fires per checkpoint, carrying the newest reading the control holds.
  const checkpoint=(label,cost)=>{
    if(!reserveWork(label,cost))return false;
    if(dueForSample()&&!stopAtDeadline(label,readNow()))return false;
    emit({type:"checkpoint",label,work,elapsed:lastNow-startedAt});return true;
  };
  // Charge global work first, then use one clock sample to arbitrate local and root time limits.
  // When the earlier local cutoff and the root deadline are both crossed by that sample, returning
  // the candidate's last safe incumbent takes temporary precedence; finalization observes the same
  // monotonic time and marks the root expired before any further shared work can begin.
  // The stride covers the local cutoff too, or every solve carrying an opts.localDeadline — share
  // calibration, the Credits refinement slices, the static phase slices, the idle-line fill — would
  // keep paying for a clock read per probe.
  const checkpointWithin=(label,cost,localDeadline,onLocalLimit)=>{
    if(!reserveWork(label,cost))return false;
    if(dueForSample()){
      const now=readNow(),local=Number(localDeadline),hasLocal=Number.isFinite(local);
      if(hasLocal&&local<deadline&&now>=local){if(onLocalLimit)onLocalLimit(label,now);return false;}
      if(!stopAtDeadline(label,now))return false;
      if(hasLocal&&now>=local){if(onLocalLimit)onLocalLimit(label,now);return false;}
    }
    emit({type:"checkpoint",label,work,elapsed:lastNow-startedAt});return true;
  };
  const event=(type,data)=>emit(Object.assign({type,work,elapsed:lastNow-startedAt},data||{}));
  const refreshDeadline=()=>{
    if(deadlineReached)return true;
    const now=readNow();
    if(now>=deadline){stopped=true;deadlineReached=true;reason="deadline";emit({type:"stopped",label:"result-finalize",reason,work,elapsed:now-startedAt});}
    return deadlineReached;
  };
  return {__forgeSolveControl:true,startedAt,deadline,checkpoint,checkpointWithin,event,readNow,currentTime:()=>lastNow,
    elapsed:()=>Math.max(0,lastNow-startedAt),work:()=>work,
    isStopped:()=>stopped,deadlineReached:refreshDeadline,reason:()=>reason};
}

// A refinement slice may stop its own solve without stopping the shared Credits comparison.
// The wrapper delegates all accounting to the root control, but reports only a true root stop via
// isStopped(). solveCore can therefore return its last fully evaluated incumbent at a local cutoff,
// while a real shared deadline/work-limit interruption still rolls the in-flight candidate back.
function makeLocalDeadlineControl(root,localDeadline,onLimit){
  let localStopped=false;
  const stopLocal=label=>{
    if(!localStopped){localStopped=true;if(onLimit)onLimit();root.event("local-time-limit",{label,localDeadline});}
    return false;
  };
  const checkpoint=(label,cost)=>{
    if(localStopped)return false;
    if(typeof root.checkpointWithin==="function")return root.checkpointWithin(label,cost,localDeadline,stopLocal);
    if(!root.checkpoint(label,cost))return false;
    return root.currentTime()>=localDeadline?stopLocal(label):true;
  };
  return {__forgeSolveControl:true,startedAt:root.startedAt,deadline:root.deadline,checkpoint,
    event:(type,data)=>root.event(type,data),readNow:()=>root.readNow(),currentTime:()=>root.currentTime(),
    elapsed:()=>root.elapsed(),work:()=>root.work(),isStopped:()=>root.isStopped(),
    deadlineReached:()=>root.deadlineReached(),reason:()=>root.reason()};
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
  const opts=options||{},rootControl=opts.control&&opts.control.__forgeSolveControl?opts.control:makeSolveControl(timeBudget,opts);
  // Opt-in: spend leftover line capacity on surplus of a non-binding target (see finishCoreResult).
  const spendFreeHeadroom=!!opts.spendFreeHeadroom;
  let localLimitReached=false;
  const localDeadline=Number(opts.localDeadline);
  const control=Number.isFinite(localDeadline)
    ?makeLocalDeadlineControl(rootControl,localDeadline,()=>{localLimitReached=true;})
    :rootControl;
  const solveStarted=control.readNow();
  const localWorkStart=control.work(),localWorkLimit=Number.isFinite(opts.localWorkLimit)?Math.max(0,Math.floor(opts.localWorkLimit)):Infinity;
  let interrupted=false;
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
  // Declared here rather than beside the search state below because the feasibility cache reads
  // them, and that cache has to exist before the first setCurTol call.
  const produced=new Float64Array(R), consumed=new Float64Array(R);
  const tol=opts.tolOverride!=null
    ?Math.max(0,Math.min(0.5,Number(opts.tolOverride)||0))
    :boundedPersistedField("margin",S.margin,0,0,20)/100;
  // Active feasibility tolerance for the current search pass. The margin solve runs two passes
  // (strict tol=0, then the user's margin) so its result is monotone in margin — see the staged
  // search at the bottom of solveCore (issue #60).
  let curTol=tol;
  // needFrac per resource, materialized instead of recomputed: it is read once per resource inside
  // three of the hottest loops in the solver (the feasibility test, the DFS leaf test and the DFS
  // suffix prune), and its only inputs are the resource's mined-ness — fixed for the solve — and
  // curTol, which changes exactly three times. Mined rows never get the margin: their budget is a
  // hard burn rate, not a paper shortfall. Written only through setCurTol so the two can never
  // disagree.
  const needFrac=new Float64Array(R),minedRow=resources.map(isMinedResource);
  /* Feasibility, cached per resource. The search asks "is this plan feasible" once per probe and
   * the answer is a scan over every resource, but a probe changes one line, which changes a handful
   * of rows. rowBad holds each row's verdict and infeasCount the number set, so the question itself
   * becomes an integer test and only the rows a move touches are re-decided.
   *
   * Deliberately NOT extended to the total deficit. A deficit maintained the same way accumulates
   * the mined rows' cancellation error — ~1e-3 on a 5.31e12/s budget — into a quantity that repair
   * compares against a 1e-12 improvement threshold, which would turn rounding into a move the
   * search believes in. The feasibility verdict is a comparison, not a sum, so it carries none of
   * that: each row is re-decided from its current values, exactly as the full scan decides it.
   *
   * syncRow is idempotent, so a row reached twice in one move costs a compare and changes nothing. */
  const rowBad=new Uint8Array(R);let infeasCount=0;
  const rowIsBad=r=>produced[r]<consumed[r]*needFrac[r]-1e-7?1:0;
  const syncRow=r=>{const bad=rowIsBad(r);if(bad!==rowBad[r]){rowBad[r]=bad;infeasCount+=bad?1:-1;}};
  const rescanFeasibility=()=>{infeasCount=0;for(let r=0;r<R;r++){const bad=rowIsBad(r);rowBad[r]=bad;if(bad)infeasCount++;}};
  const setCurTol=value=>{
    curTol=value;const relaxed=1-curTol;
    for(let r=0;r<R;r++)needFrac[r]=minedRow[r]?1:relaxed;
    rescanFeasibility();                 // every row's verdict moves when the tolerance does
  };
  setCurTol(tol);
  // Ceiling on the objective from the LP relaxation, in the same per-second units as best.score.
  // Declared here rather than read off `lp` because finishCoreResult runs before `lp` is
  // initialized on the baselineOnly path. Null until lpRelax returns a completed solve.
  //
  // Two of them, because a margin solve optimizes a different problem and the strict relaxation does
  // not bound it: a may-work plan need only cover (1-tol) of what it consumes, which is a wider
  // feasible set and a higher optimum. marginBound comes from the same relaxation rebuilt over
  // needFrac (see lpRelax) and is the only ceiling a margin result may quote.
  let lpBound=null,marginBound=null;
  /* Dual prices for the DFS bound (see buildDualPrices). dualN is 0 whenever the bound is off or has
   * no prices to work with, which is also the node test's own guard. Declared up here because the
   * bound-probe seam below runs before the staged search builds them. */
  const dualEnabled=opts.dfsDualBound!==undefined?!!opts.dfsDualBound:_dfsDualBound;
  let dualN=0,dualIdx=null,dualProdPrice=null,dualConsPrice=null,dualSuffix=null;
  // Exogenous supply (per second) of each resource, added to the produced side. Craftable
  // materials use Lil' Forgie; mined resources use their own independent income budgets.
  // opts.supplyHr replaces both when the caller owns a narrower budget than the whole factory: the
  // look-ahead filler may spend only what a solved phase leaves unused, so it hands in that spare
  // vector instead of the global incomes.
  const supplyOverride=opts.supplyHr&&typeof opts.supplyHr==="object"?opts.supplyHr:null;
  const supplyHr=r=>{
    const value=supplyOverride?toDec(supplyOverride[r]):(isMinedResource(r)?minedBudgetHr(r):forgieHr(r));
    return value!==null&&value.gt(DEC_ZERO)?value:DEC_ZERO;
  };
  // Per second, still a Decimal. A late-game Vespium rig income is 6e100/hr, so this is the one
  // vector in the solve that genuinely needs the range; baseArr below is its float64 projection.
  const supplyPerSec=resources.map(r=>decUnscale(supplyHr(r),3600));

  // data-availability check (cost only — time is computed from compression)
  const issues=[];
  relProds.forEach(P=>{
    const ins=RECIPE[P].inputs;
    const any=LEVELS.some(L=>hasRecipeCost(P,ins,L));
    if(!any)issues.push("No material cost entered for "+P+".");
  });

  // jobs per distinct max; per-line speed factor sp and dup factor dp
  const jobsByMax={};
  // opts.lineSubset restricts the solve to specific physical lines (by original index). The
  // look-ahead filler solves over the lines its phase left idle and must not move the others.
  const lineSubset=Array.isArray(opts.lineSubset)?new Set(opts.lineSubset):null;
  const sorted=lineSubset?sortedLines().filter(line=>lineSubset.has(line.orig)):sortedLines();
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

  /* Every (line, job) pair's production and consumption, flattened into typed arrays and pre-scaled
   * by that line's speed and duplication. The coefficients are the same doubles the per-job loops
   * computed — a*sp*dp and a*sp, in the same association — so nothing downstream shifts by an ulp;
   * what goes away is the megabyte of array-of-array destructuring the search did per evaluation.
   * A pair's entries live at [prodOff[slot], prodOff[slot+1]) for slot = jobBase[i]+k.
   *
   * A cons entry whose resource is outside the chain is dropped rather than folded into row 0: it
   * carries an undefined index, so the loops this replaces charged it to a property hanging off the
   * typed array that no r<R read ever saw. Int32Array would coerce that to 0 and charge the burn to
   * a real resource. */
  const jobBase=new Int32Array(N+1);
  for(let i=0;i<N;i++)jobBase[i+1]=jobBase[i]+lineJobs[i].length;
  const slots=jobBase[N];
  const prodOff=new Int32Array(slots+1),consOff=new Int32Array(slots+1);
  const okIdx=r=>Number.isInteger(r)&&r>=0&&r<R;
  for(let i=0;i<N;i++)for(let k=0;k<lineJobs[i].length;k++){
    const job=lineJobs[i][k],slot=jobBase[i]+k;let np=0,nc=0;
    for(const[r]of job.prod)if(okIdx(r))np++;
    for(const[r]of job.cons)if(okIdx(r))nc++;
    prodOff[slot+1]=np;consOff[slot+1]=nc;
  }
  for(let s=0;s<slots;s++){prodOff[s+1]+=prodOff[s];consOff[s+1]+=consOff[s];}
  const prodR=new Int32Array(prodOff[slots]),prodC=new Float64Array(prodOff[slots]);
  const consR=new Int32Array(consOff[slots]),consC=new Float64Array(consOff[slots]);
  for(let i=0;i<N;i++){
    const dp=sorted[i].dp;
    for(let k=0;k<lineJobs[i].length;k++){
      const job=lineJobs[i][k],sp=spEff[i][k],slot=jobBase[i]+k;
      let p=prodOff[slot],c=consOff[slot];
      for(const[r,a]of job.prod)if(okIdx(r)){prodR[p]=r;prodC[p]=a*sp*dp;p++;}
      for(const[r,a]of job.cons)if(okIdx(r)){consR[c]=r;consC[c]=a*sp;c++;}
    }
  }
  /* ---- free supply, projected into float64 ------------------------------------------------------
   *
   * The search evaluates a plan in Float64Arrays (produced/consumed, seeded from baseArr), and it
   * has to stay that way — it is the hot loop. But a free supply is a Decimal and can be enormous:
   * measured on the reference late-game save, Vespium arrives at 6.0e100/hr against a factory that
   * could burn at most 4.8e23/hr, a factor of 1.24e77. Written into a float64 that is at best
   * meaningless (every production term added to it rounds away) and at worst Infinity.
   *
   * So a supply is capped at the most the factory could physically consume. This is not an
   * approximation: consCeiling is a true upper bound — every line simultaneously running whichever
   * job burns the most of that resource — so a supply above it cannot bind, and neither can the cap.
   * The feasible set is identical, and what the arithmetic gains is every term staying in the same
   * magnitude band as the rates it is compared against.
   *
   * `supplyUnbounded` records which supplies were capped, so the readout can say "not the
   * constraint" instead of printing a number the plan never depended on. */
  const consCeiling=new Float64Array(R);
  for(let i=0;i<N;i++){
    const perLine=new Float64Array(R);
    for(let k=0;k<lineJobs[i].length;k++){
      const slot=jobBase[i]+k;
      for(let c=consOff[slot],e=consOff[slot+1];c<e;c++){
        const r=consR[c];if(consC[c]>perLine[r])perLine[r]=consC[c];
      }
    }
    for(let r=0;r<R;r++)consCeiling[r]+=perLine[r];
  }
  const supplyUnbounded=new Array(R).fill(false);
  const baseArr=new Float64Array(R);
  for(let r=0;r<R;r++){
    const supply=supplyPerSec[r];
    /* The cap applies to MINED resources only, and that restriction is the whole of its soundness.
     * A mined resource is pure input — nothing produces it, and it can never be a target — so a
     * supply above the most every line could burn cannot bind, and neither can the cap standing in
     * for it. An ordinary item's supply is NOT safe to cap: its surplus is the answer. Capping
     * Rods at what the factory consumes would report a Rods target as producing the consumption
     * ceiling rather than the passive supply plus everything the lines make on top of it. */
    const ceiling=isMinedResource(resources[r])?consCeiling[r]:0;
    if(ceiling>0&&supply.gt(ceiling)){baseArr[r]=ceiling;supplyUnbounded[r]=true;continue;}
    const flat=supply.toNumber();
    if(Number.isFinite(flat)&&Number.isFinite(flat*3600)){baseArr[r]=flat;continue;}
    /* Past what a float64 can carry once converted back to an hourly figure. Saturate below the
     * ceiling by the 3600 that conversion multiplies by, so the reported per-hour rate stays finite
     * instead of becoming the Infinity that reads as an em-dash. */
    baseArr[r]=UNBOUNDED_PER_SEC;supplyUnbounded[r]=true;
  }

  /* The reverse of prodR: every slot that produces a resource, grouped by resource and in ascending
   * slot order. repair asks "what could close THIS shortfall" of a handful of short rows rather than
   * pricing every job on every line, and this is the half of that question it cannot read off the
   * plan it holds. Built once — the coefficients change, the incidence never does. */
  const resProdOff=new Int32Array(R+1),resProdSlot=new Int32Array(prodOff[slots]);
  for(let p=0;p<prodOff[slots];p++)resProdOff[prodR[p]+1]++;
  for(let r=0;r<R;r++)resProdOff[r+1]+=resProdOff[r];
  {const cursor=resProdOff.slice(0,R);
    for(let s=0;s<slots;s++)for(let p=prodOff[s],e=prodOff[s+1];p<e;p++)resProdSlot[cursor[prodR[p]]++]=s;}
  /* Delta evaluation. Every probe in the local search changes ONE line's job (the target swap
   * changes two), so re-summing all N lines from baseArr to measure it is the single largest
   * avoidable cost in the solver: the flat arrays above make one line's contribution addressable,
   * and these apply it in place.
   *
   * A reject must cost nothing at all, so revertMove restores SAVED doubles instead of undoing the
   * arithmetic. Re-adding what was subtracted does not in general land back on the same double, so
   * an inverse undo would leave the incumbent every later probe is measured against drifting under
   * the probes that were rejected — the exact bug that is invisible until an objective moves.
   * Every touched slot is saved BEFORE anything is written, and restored in reverse, so a resource
   * a staged pair of moves touches twice still ends on the value it started with.
   *
   * INVARIANT: produced/consumed describe `ch` at every point outside a begin/revert bracket. The
   * accept paths below (climb, repair, target swap, dead-line drop) and the two ILS kicks maintain
   * it explicitly; before this they left the vectors describing whichever candidate was probed
   * last and relied on the next full evalChoice to repair them. */
  let maxProdLen=0,maxConsLen=0;
  for(let s=0;s<slots;s++){
    if(prodOff[s+1]-prodOff[s]>maxProdLen)maxProdLen=prodOff[s+1]-prodOff[s];
    if(consOff[s+1]-consOff[s]>maxConsLen)maxConsLen=consOff[s+1]-consOff[s];
  }
  // Two staged moves (the target swap), each replacing one job with another: four job slots.
  const mvProdR=new Int32Array(4*maxProdLen),mvProdV=new Float64Array(4*maxProdLen),mvProdB=new Uint8Array(4*maxProdLen);
  const mvConsR=new Int32Array(4*maxConsLen),mvConsV=new Float64Array(4*maxConsLen),mvConsB=new Uint8Array(4*maxConsLen);
  let mvProdN=0,mvConsN=0,mvCount=0;
  const beginMove=()=>{mvProdN=0;mvConsN=0;mvCount=infeasCount;};
  const applyMove=(i,oldK,newK)=>{
    const oldSlot=jobBase[i]+oldK,newSlot=jobBase[i]+newK;
    for(let p=prodOff[oldSlot],e=prodOff[oldSlot+1];p<e;p++){const r=prodR[p];mvProdR[mvProdN]=r;mvProdB[mvProdN]=rowBad[r];mvProdV[mvProdN++]=produced[r];}
    for(let p=prodOff[newSlot],e=prodOff[newSlot+1];p<e;p++){const r=prodR[p];mvProdR[mvProdN]=r;mvProdB[mvProdN]=rowBad[r];mvProdV[mvProdN++]=produced[r];}
    for(let c=consOff[oldSlot],e=consOff[oldSlot+1];c<e;c++){const r=consR[c];mvConsR[mvConsN]=r;mvConsB[mvConsN]=rowBad[r];mvConsV[mvConsN++]=consumed[r];}
    for(let c=consOff[newSlot],e=consOff[newSlot+1];c<e;c++){const r=consR[c];mvConsR[mvConsN]=r;mvConsB[mvConsN]=rowBad[r];mvConsV[mvConsN++]=consumed[r];}
    for(let p=prodOff[oldSlot],e=prodOff[oldSlot+1];p<e;p++)produced[prodR[p]]-=prodC[p];
    for(let c=consOff[oldSlot],e=consOff[oldSlot+1];c<e;c++)consumed[consR[c]]-=consC[c];
    for(let p=prodOff[newSlot],e=prodOff[newSlot+1];p<e;p++)produced[prodR[p]]+=prodC[p];
    for(let c=consOff[newSlot],e=consOff[newSlot+1];c<e;c++)consumed[consR[c]]+=consC[c];
    // A row's verdict depends on both sides, so every row either side touched is re-decided.
    for(let p=prodOff[oldSlot],e=prodOff[oldSlot+1];p<e;p++)syncRow(prodR[p]);
    for(let p=prodOff[newSlot],e=prodOff[newSlot+1];p<e;p++)syncRow(prodR[p]);
    for(let c=consOff[oldSlot],e=consOff[oldSlot+1];c<e;c++)syncRow(consR[c]);
    for(let c=consOff[newSlot],e=consOff[newSlot+1];c<e;c++)syncRow(consR[c]);
  };
  // The verdicts are restored from the same saved bytes as the values rather than re-decided: the
  // restored state is the pre-move state exactly, so its cached answer is the pre-move answer.
  const revertMove=()=>{
    for(let s=mvProdN-1;s>=0;s--){produced[mvProdR[s]]=mvProdV[s];rowBad[mvProdR[s]]=mvProdB[s];}
    for(let s=mvConsN-1;s>=0;s--){consumed[mvConsR[s]]=mvConsV[s];rowBad[mvConsR[s]]=mvConsB[s];}
    infeasCount=mvCount;mvProdN=0;mvConsN=0;
  };
  const choice=new Array(N).fill(0);
  let best={score:0,choice:new Array(N).fill(0),produced:new Float64Array(R),consumed:new Float64Array(R)};
  const EPS=1e-9;

  let nodes=0;let capped=false;const tStart=solveStarted;let tLastGain=tStart;
  // The budget is a ceiling, not a target: stop once the incumbent has gone this long without
  // improving, so a converged solve takes the same wall-time whether the budget is 1s or 15s
  // (the user's complaint). The window is fixed, not budget-scaled — it only needs to exceed the
  // largest gap between real improvements. Capped by the budget so a tiny budget can still cut it
  // short. Multi-target search has wider gaps (~0.6s seen) than a single-target solve (each credits
  // item), which converges almost immediately.
  const convergeWindow=Math.min(timeBudget,targets.length>1?1000:300);

  // Constructive feasible incumbent. The DFS prunes nothing until it owns a feasible
  // plan with positive score, and stumbling onto one by raw search is what made high
  // line-counts hang. So we build one cheaply: start every capable line on the chosen
  // resource, then repeatedly switch the line that most reduces the total input
  // shortfall until the plan balances. Seeds `best`, so the DFS prunes from the start.
  function evalChoice(ch){
    produced.set(baseArr);consumed.fill(0);
    for(let i=0;i<N;i++){const slot=jobBase[i]+ch[i];
      for(let p=prodOff[slot],e=prodOff[slot+1];p<e;p++)produced[prodR[p]]+=prodC[p];
      for(let c=consOff[slot],e=consOff[slot+1];c<e;c++)consumed[consR[c]]+=consC[c];}
    rescanFeasibility();
  }
  const totalDeficit=()=>{let D=0;for(let r=0;r<R;r++){const d=consumed[r]-produced[r];if(d>0)D+=d;}return D;};
  const idleIdx=i=>{const k=lineJobs[i].findIndex(j=>j.kind==="idle");return k<0?0:k;};
  function bestJobFor(i,res){let bj=-1,bg=0;lineJobs[i].forEach((job,k)=>{for(const[r,a]of job.prod)if(r===res){const g=a*sorted[i].sp*sorted[i].dp;if(g>bg){bg=g;bj=k;}}});return bj;}
  const feasibleNow=()=>infeasCount===0;
  // Shared weighted floor: the smallest output-to-weight ratio across the targets.
  const scoreNow=()=>{let sc=Infinity;for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]];sc=Math.min(sc,net/w[k]);}return sc;};
  // Chain members the plan has to make but nothing scores — the feeders behind the single target.
  // Only a one-output solve can plateau on them (see the warm start below); with a second output
  // checked the search already has a gradient on it, which is why ticking one on works around it.
  const feederIdx=targets.length===1
    ?relProds.filter(P=>P!==targets[0]).map(P=>resIndex[P]).filter(r=>r!=null)
    :[];
  // Each feeder's surplus is scaled by the most of it the whole factory could make, so no single
  // feeder's raw magnitude dominates the bonus: Gel moves in hundreds per hour where Batteries move
  // in fractions. The bonus then MULTIPLIES the real objective rather than adding to it, which is
  // what keeps the surrogate honest — a plan making no target output scores zero however much feeder
  // it piles up, so the search cannot wander off into producing feeder for its own sake (an additive
  // bonus does exactly that, and lands on a plan with no target line at all). Within that, a plan
  // holding the same target output with more feeder behind it wins, and that is the whole point:
  // it is the plateau step no strictly-improving move on the real objective will take.
  const feederScale=feederIdx.map(r=>maxProd[r][0]>1e-12?maxProd[r][0]:1);
  const FEEDER_WARM_EPS=[0.01,0.05,0.2],SWAP_STAG_LIMIT=1200;
  const feederSurrogate=eps=>()=>{
    const sc=scoreNow();if(!(sc>0))return sc;
    let bonus=0;
    for(let f=0;f<feederIdx.length;f++){const net=produced[feederIdx[f]]-consumed[feederIdx[f]];if(net>0)bonus+=net/feederScale[f];}
    return sc*(1+eps*bonus);
  };
  /* Drive total input shortfall to zero. Each step makes the single line-switch (to ANY job
   * — produce an input, OR drop a craft to a cheaper/lower level) that cuts the shortfall most.
   *
   * Only the moves that could possibly cut it are priced. The shortfall sums max(0, cons-prod) over
   * the rows: a row at or above balance contributes nothing and a move can only leave it there or
   * push it up, and a SHORT row falls only if the incoming job produces it or the outgoing job was
   * burning it. Every other move leaves every row's term where it was or higher, and the sum is the
   * same additions of non-negative terms in the same order — addition is monotone in each argument,
   * so the total is too, and `red` comes out at zero or below. It cannot clear bRed, so skipping it
   * costs the search nothing: the scan still runs line-ascending, job-ascending and still adopts the
   * first move holding the largest reduction, which is the same move on the same plan.
   *
   * Candidates are marked with a pass stamp rather than cleared between passes; the wrap guard keeps
   * a long ILS run from stamping past what an Int32Array can hold and matching nothing. */
  const repairCand=new Int32Array(slots);let repairStamp=0;
  function repair(ch){
    for(let guard=0;guard<6*N+40;guard++){
      if(!keepGoing("repair-pass"))return null;
      evalChoice(ch);const D=totalDeficit();if(D<=1e-7)break;
      if(repairStamp===0x7fffffff){repairCand.fill(0);repairStamp=0;}
      const stamp=++repairStamp;
      for(let r=0;r<R;r++)if(consumed[r]-produced[r]>0)
        for(let q=resProdOff[r],e=resProdOff[r+1];q<e;q++)repairCand[resProdSlot[q]]=stamp;
      let bI=-1,bJ=-1,bRed=1e-12;
      for(let i=0;i<N;i++){const old=ch[i],js=lineJobs[i],base=jobBase[i],slot=base+old;
        // A line already burning a short resource can cut that burn by moving to any other job, so
        // this one is priced whole rather than by what the incoming job makes.
        let wholeLine=false;
        for(let c=consOff[slot],e=consOff[slot+1];c<e;c++)if(consumed[consR[c]]-produced[consR[c]]>0){wholeLine=true;break;}
        for(let k=0;k<js.length;k++){if(k===old)continue;
          if(!wholeLine&&repairCand[base+k]!==stamp)continue;
          if(!keepGoing("repair-job"))return null;
          beginMove();applyMove(i,old,k);const red=D-totalDeficit();revertMove();
          if(red>bRed){bRed=red;bI=i;bJ=k;}}}
      if(bI<0)break;
      const prev=ch[bI];ch[bI]=bJ;beginMove();applyMove(bI,prev,bJ);
    }
    evalChoice(ch);return feasibleNow();
  }
  // hill-climb the objective with single-line best-improvement moves, staying feasible.
  // `score` defaults to the real objective; the feeder-guided warm start below passes a surrogate,
  // which is why the climb is written against a scoring function rather than scoreNow directly.
  function climb(ch,score){
    const value=score||scoreNow;
    let cur=value();
    for(let pass=0;pass<N+3;pass++){
      if(!keepGoing("climb-pass"))return null;
      let improved=false;
      for(let i=0;i<N;i++){const old=ch[i];let bk=old,bs=cur;
        const js=lineJobs[i];for(let k=0;k<js.length;k++){if(k===old)continue;
          if(!keepGoing("climb-job"))return null;
          beginMove();applyMove(i,old,k);
          if(feasibleNow()){const s=value();if(s>bs+EPS){bs=s;bk=k;}}
          revertMove();}
        // The accepted move is re-applied rather than left to the next full evaluation, so `cur`
        // and the vectors describe the same plan: bs was measured on exactly this state.
        if(bk!==old){ch[i]=bk;beginMove();applyMove(i,old,bk);cur=bs;improved=true;}
      }
      if(!improved)break;
    }
    return cur;
  }
  // The nearest job on line `li` to one written for another line. Lines cap at different
  // compressions, so a job cannot be carried across by index: match the craft, then the closest
  // level the destination can actually run (never above what the source asked for, if it has one).
  const jobLike=(li,job)=>{
    if(!job||job.kind==="idle")return idleIdx(li);
    const js=lineJobs[li];let under=-1,underLvl=-1,any=-1,anyLvl=Infinity;
    for(let k=0;k<js.length;k++){
      const j=js[k];if(j.kind!==job.kind||j.res!==job.res)continue;
      if(j.lvl===job.lvl)return k;
      if(j.lvl<job.lvl&&j.lvl>underLvl){underLvl=j.lvl;under=k;}
      if(j.lvl<anyLvl){anyLvl=j.lvl;any=k;}
    }
    return under>=0?under:any;
  };
  // Exchange the jobs of two lines, for the lines carrying a target. Which line a craft sits on is
  // worth as much as which craft runs: a target on a slow line with a fast line feeding it is beaten
  // by the reverse, but getting there means moving both at once. Single-line climbing has to pass
  // through the half-move — drop the only target line, or double up on it and starve its feeder —
  // and both score worse, so it never crosses. Restricted to target-carrying lines, which is where
  // the placement actually decides the objective, and which keeps this O(target lines x N).
  function swapTargets(ch,score){
    const value=score||scoreNow;
    let cur=value();
    for(let round=0;round<N+3;round++){
      let improved=false;
      for(let h=0;h<N;h++){
        const jh=lineJobs[h][ch[h]];
        if(!jh||jh.kind==="idle"||targets.indexOf(jh.res)<0)continue;
        for(let j=0;j<N;j++){
          if(j===h)continue;
          if(!keepGoing("target-swap"))return null;
          const oh=ch[h],oj=ch[j];
          const a=jobLike(h,lineJobs[j][oj]),b=jobLike(j,lineJobs[h][oh]);
          if(a<0||b<0||(a===oh&&b===oj))continue;
          // Two moves staged under one bracket: revert unwinds them in reverse, so a resource both
          // lines touch lands back on the value it held before either was applied.
          beginMove();applyMove(h,oh,a);applyMove(j,oj,b);
          if(feasibleNow()&&value()>cur+EPS){ch[h]=a;ch[j]=b;cur=value();improved=true;break;}
          revertMove();
        }
      }
      if(!improved)break;
    }
    evalChoice(ch);return cur;
  }
  // full local optimisation from a starting choice; returns its score or null if infeasible
  function localOpt(ch,score){const repaired=repair(ch);if(repaired!==true)return null;const sc=climb(ch,score);if(sc==null)return null;evalChoice(ch);return feasibleNow()?sc:null;}
  // localOpt run to a fixed point over both neighbourhoods, single-line moves and swaps alternating:
  // a swap that pays usually opens fresh single-line gains (the level the moved craft should now run
  // at), and those can make another swap pay. Only the second pass below uses it.
  function deepOpt(ch,score){
    let sc=localOpt(ch,score);if(sc==null)return null;
    for(let r=0;r<3;r++){
      const swapped=swapTargets(ch,score);if(swapped==null)return null;
      if(!(swapped>sc+EPS))break;
      sc=climb(ch,score);if(sc==null)return null;
    }
    evalChoice(ch);return feasibleNow()?sc:null;
  }
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
          if(!keepGoing("deficit-job"))return null;
          beginMove();applyMove(i,old,k);
          if(feasibleNow()&&scoreNow()>=targetScore-EPS){const d=totalDeficit();if(d<bD-1e-9){bD=d;bk=k;}}
          revertMove();}
        if(bk!==old){ch[i]=bk;beginMove();applyMove(i,old,bk);curD=bD;improved=true;}}
      if(!improved)break;
    }
    return ch;
  }
  // Idle the line jobs the plan gets nothing from. The objective counts net TARGET output only, so a
  // line producing something no other job consumes and no target asks for scores exactly the same as
  // Idle — no move ever prefers Idle, and a job left over from an intermediate repair step rides all
  // the way into the result ("no crafters set to Ingots, yet the plan makes them"). The test is
  // exact rather than structural: a line is idled only when idling it holds BOTH feasibility and the
  // objective, so a real feeder — or a line carrying a target the plan needs — is never removed.
  // Deliberately uncharged and uninterruptible: it is one evaluation per line, and the plan most
  // likely to be carrying a job it gained nothing from is the one whose clock ran out mid-search —
  // so this has to run on the interrupted path too. finishCoreResult calls it on every exit.
  function dropDeadLines(ch,targetScore){
    let dropped=false;
    // Called on a copy of the incumbent, not on whatever the search evaluated last, so this one
    // establishes the invariant the delta probes below rely on.
    evalChoice(ch);
    for(let i=0;i<N;i++){
      const old=ch[i],idle=idleIdx(i);
      if(old===idle)continue;
      beginMove();applyMove(i,old,idle);
      if(feasibleNow()&&scoreNow()>=targetScore-EPS){ch[i]=idle;dropped=true;continue;}
      revertMove();
    }
    return dropped;
  }
  // Tie-break: among plans that match the optimal objective, prefer the one that makes the most
  // total target output. The objective is a max-min, so only the WEAKEST target's rate counts —
  // once a target sits above that floor every further unit of it is worth exactly zero, and since
  // every acceptance test in the search is a strict improvement, no move ever reaches for it. A
  // line carrying a target the plan already has covered therefore keeps whatever level the search
  // last happened to leave it at, which is how a plan reports 2048x on an 8192x line while every
  // other line runs at its own cap. Holding the score fixed, hill-climb single-line switches that
  // raise the summed weighted output, so free headroom gets spent rather than reported as a
  // smaller craft the user can see is free.
  // Deficit is held at the figure it came in at, not tracked downward: minDeficitAtScore has already
  // balanced this plan, and a bigger craft paid for out of the 1.5% margin would hand back the
  // phantom "may-work" gap it just closed. One line's margin use can move to another, the total
  // cannot grow. One pass, uncharged and uninterruptible for the same reason as dropDeadLines: it
  // is one evaluation per line per job, and the plan most likely to be sitting on unspent headroom
  // is the one whose clock ran out mid-search, so it has to run on the interrupted path too.
  function maxTargetOutputAtScore(ch,targetScore){
    evalChoice(ch);
    const totalOut=()=>{let t=0;for(let k=0;k<targets.length;k++)t+=(produced[tIdx[k]]-consumed[tIdx[k]])/w[k];return t;};
    const curD=totalDeficit();
    let curT=totalOut(),raised=false;
    for(let i=0;i<N;i++){const old=ch[i],js=lineJobs[i];let bk=old,bT=curT;
      for(let k=0;k<js.length;k++){if(k===old)continue;
        beginMove();applyMove(i,old,k);
        if(feasibleNow()&&scoreNow()>=targetScore-EPS&&totalDeficit()<=curD+1e-9){const t=totalOut();if(t>bT+1e-9){bT=t;bk=k;}}
        revertMove();}
      if(bk!==old){ch[i]=bk;beginMove();applyMove(i,old,bk);curT=bT;raised=true;}}
    return raised;
  }
  // Adopt a score-preserving rewrite of the incumbent (balance, dead-line and headroom passes) as the new best.
  const adoptChoice=ch=>{evalChoice(ch);best={score:scoreNow(),choice:ch.slice(),produced:produced.slice(),consumed:consumed.slice()};};
  let _rng=0x2545f491>>>0;const rnd=()=>{_rng^=_rng<<13;_rng^=_rng>>>17;_rng^=_rng<<5;_rng>>>=0;return _rng/4294967296;};
  function finishCoreResult(){
    // Idle whatever this plan turns out not to need, whichever way the search exited.
    if(N>0&&best.score>EPS){
      const trimmed=best.choice.slice();
      if(dropDeadLines(trimmed,best.score))adoptChoice(trimmed);
      // Items plans only, and after the trim rather than before it. Spending the headroom first
      // inflates a target far enough that a line still carrying it reads as droppable, and the trim
      // then idles that line — ending with both less output and an empty crafter. A project plan is
      // opted out because putIdleLinesToWork already owns its spare lines and knows something this
      // pass does not: a project needs a fixed quantity, so surplus past the order is worth nothing
      // while the same line banking the NEXT phase's material is worth real time. Two mechanisms
      // bidding for the same lines would just take that choice away from the one that can see it.
      if(spendFreeHeadroom){
        const filled=best.choice.slice();
        if(maxTargetOutputAtScore(filled,best.score))adoptChoice(filled);
      }
    }
    // Distinguish a failed in-work checkpoint from the deadline first being observed while the
    // completed result is serialized. The latter remains valid, but is capped and stops later work.
    const workInterrupted=control.isStopped();
    const deadlineReached=control.deadlineReached();if(deadlineReached)capped=true;
    let usesMargin=false;for(let r=0;r<R;r++)if(best.produced[r]<best.consumed[r]-1e-6)usesMargin=true;
    /* baseArr, not the raw supply. The balance table derives line production as (total - forgie),
     * where total was accumulated from baseArr — so reporting a larger figure here than the search
     * actually used would drive that subtraction negative and misreport the plan. The two only
     * differ for a supply the consCeiling cap trimmed, and those are the mined resources, which the
     * balance excludes; supplyUnbounded is what says "not the constraint" for those. */
    const forgie={};resources.forEach((r,i)=>forgie[r]=baseArr[i]*3600);
    // Each ceiling bounds its own problem, so which one is reported follows the tolerance the caller
    // ASKED for rather than the pass that happened to run last: a budget that expires before the
    // margin pass leaves a strict incumbent while the optimum the user asked for is still the
    // relaxed one, which sits above the strict ceiling. The margin ceiling covers a strict incumbent
    // too — every strictly feasible plan is feasible at any margin — so quoting it is honest
    // whichever pass the clock stopped in. Null until the relaxation for that tolerance completes.
    const bound=tol===0?lpBound:marginBound;
    return {best,sorted,lineJobs,resources,resIndex,R,N,tIdx,tol,capped,usesMargin,issues,forgie,bound,deadlineReached,
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

  /* Direct-source test seam, in the same family as opts.now / opts.onCheckpoint: never persisted,
   * never posted through the Worker protocol, never set by the app. It hands the delta-evaluation
   * machinery to a checker before the search starts, so test/delta-eval.cjs can assert apply and
   * revert against a full re-evaluation on the solver's own arrays for a real factory — the
   * fixtures where one resource carries 5.31e12/s and another 1e99/min, and where the mismatch
   * this guards against would be a rounding artefact rather than an obvious wrong answer. */
  if(typeof opts.onDeltaProbe==="function"){
    opts.onDeltaProbe({N,R,resources,lineJobs,targets,produced,consumed,idleIdx,
      evalChoice,beginMove,applyMove,revertMove,feasibleNow,totalDeficit,scoreNow,setCurTol,
      // The flat coefficient tables, so the checker can size its tolerance by the magnitude of the
      // terms a row actually sums rather than by the magnitude of what they sum TO. A delta on a row
      // whose terms span twelve orders is accurate to the largest term, not to the result.
      flat:{jobBase,prodOff,prodR,prodC,consOff,consR,consC,baseArr},
      maintainedInfeasibleCount:()=>infeasCount,
      infeasibleCountNow:()=>{let n=0;for(let r=0;r<R;r++)if(produced[r]<consumed[r]*needFrac[r]-1e-7)n++;return n;}});
  }

  /* Same family of seam, for the DFS's two upper bounds. A bound is only ever read at a node the
   * search is standing on, so the only way to check the claim it makes is to put the search on a
   * chosen prefix and ask. prefixBound(ch,i) rebuilds produced/consumed from the first i lines of ch
   * and returns both ceilings for that node; test/solver-bounds.cjs then completes ch and asserts
   * neither ceiling sits below what the completed plan achieves. */
  if(typeof opts.onBoundProbe==="function"){
    buildDualPrices();
    const prefixBound=(ch,i)=>{
      produced.set(baseArr);consumed.fill(0);
      for(let k=0;k<i;k++){const slot=jobBase[k]+ch[k];
        for(let p=prodOff[slot],e=prodOff[slot+1];p<e;p++)produced[prodR[p]]+=prodC[p];
        for(let c=consOff[slot],e=consOff[slot+1];c<e;c++)consumed[consR[c]]+=consC[c];}
      return {suffix:suffixUB(i),dual:dualN>0?dualUB(i):null};
    };
    opts.onBoundProbe({N,R,resources,lineJobs,targets,evalChoice,feasibleNow,scoreNow,setCurTol,
      prefixBound,dualReady:()=>dualN>0,rebuildPrices:buildDualPrices});
  }

  // The Credits comparison first gives every priced product the same finite constructive baseline:
  // a zero-output idle lower bound plus one target-dedicated seed (and one bounded Gel loadout seed
  // for Gel), under a deterministic per-product work cap. It deliberately skips LP, randomized
  // seeds, ILS and DFS. Reaching the local cap keeps the valid idle/best-completed lower bound;
  // only the shared absolute deadline discards the partial candidate and leaves later rows unevaluated.
  if(opts.baselineOnly){
    setCurTol(tol);capped=true;
    if(!keepGoing("baseline-product-start"))return finishCoreResult();
    const idleChoice=new Array(N);for(let i=0;i<N;i++)idleChoice[i]=idleIdx(i);
    evalChoice(idleChoice);const idleScore=feasibleNow()?scoreNow():0;
    best={score:idleScore,choice:idleChoice.slice(),produced:produced.slice(),consumed:consumed.slice()};
    let baselineInc={sc:idleScore,ch:idleChoice.slice()};
    const baselineSeed=ch=>{const sc=localOpt(ch);if(sc!=null&&!interrupted&&(!baselineInc||sc>baselineInc.sc))baselineInc={sc,ch:ch.slice()};};
    if(targets.length===1&&targets[0]===GEL&&resIndex[VESP]!=null&&minedBudgetHr(VESP).gt(DEC_ZERO)){
      const byOrig={};sorted.forEach((line,index)=>byOrig[line.orig]=index);
      const loadout=gelSeedLoadout(lineRows(),supplyRate(minedBudgetHr(VESP)),{checkpoint:keepGoing});
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
        if(balanced&&!interrupted)adoptChoice(balanced);}
    }
    if(!interrupted)keepGoing("baseline-product-complete");
    return finishCoreResult();
  }

  // max-min upper bound: best achievable min-over-targets if remaining lines max-produce each target
  // at zero input cost. Exact, and free — SP is a suffix sum built once — but it charges nothing for
  // the feeders those lines would have to burn, so it stays far above anything reachable.
  function suffixUB(i){
    let ub=Infinity;
    for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]]+SP[k][i];ub=Math.min(ub,net/w[k]);}
    return ub;
  }
  /* Lagrangian bound on the same node, priced so that a line making a target pays for what it eats.
   *
   * Weak duality is the whole argument. Take any prices y>=0 on the relaxation's rows whose target
   * rows' weights sum to at least 1, charge each line the best score any of its jobs earns at those
   * prices (never below zero — a line may idle), and the total over the remaining lines plus the
   * priced value of what the prefix has already banked bounds the LP over every completion of that
   * prefix, hence every integer completion. The prices only have to be FEASIBLE, so the search for
   * them below cannot make the bound wrong, only loose — which is why it is a cheap coordinate
   * search rather than a second simplex.
   *
   * Two price vectors per resource because a target's row does double duty (see lpRelax): lam prices
   * the relaxed balance, and mu the strict objective link that carries z. They collapse into one
   * multiplier on production and one on consumption, so a node costs one dot product over the
   * resources a price actually touches.
   *
   * dualSuffix carries the priced size of the leaf test's own 1e-7 slack. The search will return a
   * plan whose rows are short by up to that much, which the LP would call infeasible; without the
   * allowance the bound would be right about the relaxation and wrong about the search. */
  function buildDualPrices(){
    dualN=0;dualIdx=null;dualProdPrice=null;dualConsPrice=null;dualSuffix=null;
    const T=targets.length;
    if(N===0||T===0||slots===0)return;
    const p=new Float64Array(slots),g=new Float64Array(slots);
    const prodPrice=new Float64Array(R),consPrice=new Float64Array(R);
    const lam=new Float64Array(R),mu=new Float64Array(T);
    const setPrices=()=>{
      for(let r=0;r<R;r++){prodPrice[r]=lam[r];consPrice[r]=lam[r]*needFrac[r];}
      for(let k=0;k<T;k++){prodPrice[tIdx[k]]+=mu[k];consPrice[tIdx[k]]+=mu[k];}
    };
    const fillP=()=>{
      for(let s=0;s<slots;s++){let v=0;
        for(let q=prodOff[s],e=prodOff[s+1];q<e;q++)v+=prodPrice[prodR[q]]*prodC[q];
        for(let q=consOff[s],e=consOff[s+1];q<e;q++)v-=consPrice[consR[q]]*consC[q];
        p[s]=v;}
    };
    // The dual objective, offset by t along the coordinate whose per-slot relaxed net is g. A line's
    // charge is the best its jobs earn, floored at zero because sum_j x_ij <= 1 lets a line sit out.
    const objAt=t=>{
      let sum=0;
      for(let i=0;i<N;i++){let m=0;
        for(let s=jobBase[i],e=jobBase[i+1];s<e;s++){const v=p[s]+t*g[s];if(v>m)m=v;}
        sum+=m;}
      return sum;
    };
    let baseTerm=0;
    const evalD=()=>{setPrices();fillP();baseTerm=0;
      for(let r=0;r<R;r++)baseTerm+=prodPrice[r]*baseArr[r];
      return objAt(0)+baseTerm;};
    /* Start from the trivial feasible prices — all the weight on one target, nothing on any balance
     * row — which is what the standing bound already is, one target at a time. Descending from the
     * best of them can only improve on it. */
    let bestK=0,bestD=Infinity;
    for(let k=0;k<T;k++){
      if(!keepGoing("dual-price-start"))return;
      mu.fill(0);mu[k]=1/w[k];lam.fill(0);
      const d=evalD();
      if(d<bestD){bestD=d;bestK=k;}
    }
    mu.fill(0);mu[bestK]=1/w[bestK];lam.fill(0);
    let cur=evalD();
    for(let pass=0;pass<2;pass++){
      let moved=false;
      for(let r=0;r<R;r++){
        if(!keepGoing("dual-price-coordinate"))return;
        let maxG=0,maxP=0;
        const nf=needFrac[r];
        for(let s=0;s<slots;s++){
          let v=0;
          for(let q=prodOff[s],e=prodOff[s+1];q<e;q++)if(prodR[q]===r)v+=prodC[q];
          for(let q=consOff[s],e=consOff[s+1];q<e;q++)if(consR[q]===r)v-=nf*consC[q];
          g[s]=v;
          const a=v<0?-v:v;if(a>maxG)maxG=a;
          const b=p[s]<0?-p[s]:p[s];if(b>maxP)maxP=b;
        }
        if(!(maxG>0))continue;
        // A price on this row is measured in score per unit of it, so the size of the p values it
        // has to move against, divided by the size of the row's own coefficients, is the scale a
        // step is worth trying at. Geometric from there, both directions, never below zero.
        const scale=(maxP>0?maxP:1)/maxG;
        let step=0,low=cur;
        for(let k=0;k<6;k++){
          const t=scale/(1<<k);
          for(let sign=0;sign<2;sign++){
            const move=sign?-t:t;
            if(lam[r]+move<0)continue;
            const v=objAt(move)+baseTerm+baseArr[r]*move;
            if(v<low-1e-12*Math.max(1,Math.abs(low))){low=v;step=move;}
          }
        }
        if(step!==0){lam[r]+=step;cur=evalD();moved=true;}
      }
      if(!moved)break;
    }
    setPrices();fillP();
    const suffix=new Float64Array(N+1);
    // 1e-7 per row is what the leaf test forgives; priced, that is what the bound has to give back.
    let slack=0;for(let r=0;r<R;r++)slack+=Math.abs(lam[r]);
    suffix[N]=1e-7*slack;
    for(let i=N-1;i>=0;i--){let m=0;
      for(let s=jobBase[i],e=jobBase[i+1];s<e;s++)if(p[s]>m)m=p[s];
      suffix[i]=suffix[i+1]+m;}
    const idx=[];for(let r=0;r<R;r++)if(prodPrice[r]!==0||consPrice[r]!==0)idx.push(r);
    if(!idx.length)return;
    dualIdx=Int32Array.from(idx);dualN=idx.length;dualSuffix=suffix;
    dualProdPrice=new Float64Array(dualN);dualConsPrice=new Float64Array(dualN);
    for(let q=0;q<dualN;q++){dualProdPrice[q]=prodPrice[idx[q]];dualConsPrice[q]=consPrice[idx[q]];}
  }
  function dualUB(i){
    let db=dualSuffix[i];
    for(let q=0;q<dualN;q++){const r=dualIdx[q];db+=dualProdPrice[q]*produced[r]-dualConsPrice[q]*consumed[r];}
    return db;
  }
  function dfs(i,prevIdx){
    nodes++;
    if(!keepGoing("dfs-node")){capped=true;return;}
    // keepGoing above already arbitrated the deadline on this node; the convergence window only
    // needs the reading that produced, not a second syscall per DFS node.
    const _n=control.currentTime();if(_n-tLastGain>convergeWindow)capped=true;
    if(capped)return;
    if(i===N){
      for(let r=0;r<R;r++)if(produced[r]<consumed[r]*needFrac[r]-1e-7)return;
      let sc=Infinity;
      for(let k=0;k<targets.length;k++){const net=produced[tIdx[k]]-consumed[tIdx[k]];sc=Math.min(sc,net/w[k]);}
      if(sc>best.score+EPS){best={score:sc,choice:choice.slice(),produced:produced.slice(),consumed:consumed.slice()};tLastGain=control.readNow();}
      return;
    }
    // feasibility prune: any resource whose current shortfall can't be covered by remaining lines kills this branch
    for(let r=0;r<R;r++)if(produced[r]+maxProd[r][i]<consumed[r]*needFrac[r]-1e-7)return;
    if(suffixUB(i)<=best.score+EPS)return;
    if(dualN>0&&dualUB(i)<=best.score+EPS)return;
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
  /* LP relaxation: let each line split its time fractionally across its jobs and maximize the
   * min target ratio z. It yields (a) an upper bound on the integer optimum and (b) a rounded
   * incumbent for the discrete search to refine. This is what lets the search FIND feasible plans
   * when Gel (a vespium-bounded intermediate) is in the chain — the pure combinatorial DFS can
   * miss them at scale, which the old line-reservation sweep used to paper over by decomposing.
   *
   * `need` is the per-resource fraction of its consumption a plan actually has to cover — the
   * solver's own needFrac. Passing it scales each row's consumption exactly as the feasibility test
   * scales it, so the relaxation becomes a relaxation of the MARGIN problem rather than of the
   * strict one, and a may-work optimum gets a ceiling for the first time. Every integer plan the
   * margin search may return satisfies these rows, so its z bounds that search.
   *
   * Two details the scaling has to respect. Mined rows carry 1 in needFrac and are therefore
   * untouched: a mined budget is a hard burn rate, not a paper shortfall. And a target's row does
   * double duty — it is that resource's balance AND the link that holds z under the plan's net
   * output — so discounting it would let z rise on consumption the plan never has to make good.
   * Each target therefore gets a second, strict row carrying the z coefficient while its relaxed row
   * keeps only the feasibility half.
   *
   * Called with no argument every coefficient is the double it always was (`a*sp*1` is `a*sp`, and
   * no strict row is emitted), so the strict relaxation is unchanged. */
  function lpRelax(need){
    const offs=[];let nv=0;
    for(let i=0;i<N;i++){if(!keepGoing("lp-offset"))return {interrupted:true};offs.push(nv);nv+=lineJobs[i].length;}
    const zc=nv,n=nv+1,A=[],b=[];
    for(let i=0;i<N;i++){if(!keepGoing("lp-line-row"))return {interrupted:true};const row=new Float64Array(n);for(let j=0;j<lineJobs[i].length;j++)row[offs[i]+j]=1;A.push(row);b.push(1);}
    const tw={};targets.forEach((t,k)=>tw[tIdx[k]]=w[k]);
    for(let r=0;r<R;r++){
      if(!keepGoing("lp-resource-row"))return {interrupted:true};
      const nf=need?need[r]:1,tgt=tw[r];
      const row=new Float64Array(n),strict=(nf!==1&&tgt!==undefined)?new Float64Array(n):null;
      for(let i=0;i<N;i++)for(let j=0;j<lineJobs[i].length;j++){
        if(!keepGoing("lp-job-coefficient"))return {interrupted:true};
        const job=lineJobs[i][j],sp=spEff[i][j],dp=sorted[i].dp;let net=0,sn=0;
        for(const[rr,a]of job.prod)if(rr===r){net+=a*sp*dp;if(strict)sn+=a*sp*dp;}
        for(const[rr,a]of job.cons)if(rr===r){net-=a*sp*nf;if(strict)sn-=a*sp;}
        if(net)row[offs[i]+j]=-net;
        if(strict&&sn)strict[offs[i]+j]=-sn;}
      if(strict){strict[zc]=tgt;A.push(strict);b.push(baseArr[r]);}
      else if(tgt!==undefined)row[zc]=tgt;
      A.push(row);b.push(baseArr[r]);
    }
    /* Nothing to project here: this relaxation's RHS is baseArr, which solveCore already capped at
     * what the factory could physically consume, so it is finite float64 by construction. */
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
  // An incomplete simplex leaves z short of a proven ceiling, so only a completed solve is kept.
  if(lp&&lp.complete&&Number.isFinite(lp.z))lpBound=lp.z;
  if(interrupted){capped=true;return finishCoreResult();}
  /* The margin problem's ceiling, from the same relaxation over this solve's needFrac — which still
   * holds the requested tolerance here, since the staged search below has not moved it yet.
   *
   * Solved at the root rather than lazily inside the margin stage because of WHEN a ceiling is worth
   * quoting. The interface raises the gap notice only on a solve the clock cut short, and a solve
   * the clock cut short is exactly the one that never reaches its margin stage: on the reference
   * factory the strict pass consumes the whole budget and the relaxed pass never starts. A ceiling
   * computed inside that pass would therefore exist only on the runs that had no use for it. */
  if(tol>0&&N>0){
    const mlp=lpRelax(needFrac);
    if(mlp&&mlp.complete&&Number.isFinite(mlp.z))marginBound=mlp.z;
    if(interrupted){capped=true;return finishCoreResult();}
  }
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
  setCurTol(stages[si]);capped=false;tLastGain=control.readNow();
  let inc=null;
  /* The generators below independently clamp what they cannot express, and they collide: a line that
   * can run neither the requested feeder (roleJob finds no such craft) nor a compressed target
   * (tgtSeed's lvl<=8 rule) falls back to the same job whichever role the enumeration meant it to
   * take, so whole runs of role assignments — and LP roundings that differ only inside a line's
   * fractional split — arrive as the identical choice vector. localOpt is deterministic in that
   * vector, so a repeat can only re-derive the score it already produced; it cannot move `inc`,
   * which improves on a strict >. Seen vectors are therefore dropped before they are charged.
   *
   * Scoped to the margin stage, not the solve: setCurTol changes which plans are feasible, so the
   * same vector genuinely has to be re-optimised once per stage. */
  const seenSeeds=new Set();
  const trySeed=ch=>{if(!ch||interrupted)return false;
    const key=ch.join(",");if(seenSeeds.has(key))return true;seenSeeds.add(key);
    if(!keepGoing("seed-start"))return false;const c=ch.slice();const sc=localOpt(c);
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
  const gelBudgetHr=supplyRate(minedBudgetHr(VESP));
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
    /* Destroy-and-repair, an alternative to the random kick below — BUILT, MEASURED AND LEFT OFF.
     * opts.lnsCadence is a direct-source test seam in the same family as opts.onDeltaProbe: never
     * persisted, never posted through the Worker protocol, never set by the app. At 0 (production)
     * nothing below runs, no random number is drawn and no work is charged, so the search is the one
     * that was there before.
     *
     * What it does. The kick is blind: it rewrites k random lines and hands the wreck to localOpt,
     * which walks it back one strictly-improving line at a time. That composition reaches only the
     * plans a chain of single-line improvements reaches, and the ones it cannot reach are exactly the
     * coupled ones — a feeder onto a spare line pays nothing until the target moves onto the line the
     * feeder freed, and moving the target first is a loss, so neither half is ever taken. This
     * instead FREEZES all but k lines and searches the freed ones exactly: every joint assignment of
     * those k lines is enumerated against the frozen lines' production and burn, seeded with the
     * incumbent's own score so the enumeration is an improvement search and a subset that cannot beat
     * the plan it came from is refuted at its root. A two-line exchange that is uphill in both halves
     * is one leaf of that enumeration rather than a sequence no improving move takes.
     *
     * Why it is off. Measured over the seven checkpointed bench fixtures at a 20 s budget, k=2, with
     * a ceiling the repairs effectively never reached: ~21,600 repairs produced ONE strictly
     * improving joint assignment (project-seq-7line), and it did not move the reported objective.
     * Seven lines give 21 pairs and the leanest fixture still draws ~85 repairs per pair, so that is
     * not a sampling gap — the plan the ILS converges to is 2-line optimal, and items-7line's 20% gap
     * to the LP ceiling is not reachable by moving two lines at once. Larger k does not rescue it:
     * one complete 3-line enumeration costs ~248,000 probes, 2.5% of the entire 20 s search, and 29
     * of them refuted their subset as well; a 4-line enumeration did not finish inside 5,000,000
     * probes, i.e. one repair costs more than the whole budget. Meanwhile the operator is not free —
     * at one repair every second iteration it takes 50-75% of the search budget, and on project-7line
     * that displacement alone costs 23% of the objective (0.0334 -> 0.0257, its 4000 ms plateau).
     *
     * The move it was built for is not in the corpus either: the feeder second pass below, which
     * exists for exactly this coupled move, is reached 5 times across the whole corpus and improves
     * the incumbent zero of those 5 times. Re-opening this needs a saved factory that exhibits the
     * issue #134 shape, not a bigger k. */
    const lnsCadence=Math.max(0,Math.floor(Number(opts.lnsCadence)||0));
    const LNS_MAX_FREE=4,LNS_WORK_CAP=4000;
    // Each line's largest single-job output of every resource — the enumeration's suffix bound. Taken
    // off the same flat coefficients the probes sum, so the bound is on the same doubles the leaf test
    // compares, and tighter than the DFS's own maxProd, which scales by the uncapped line speed.
    const lnsLineMax=new Float64Array(lnsCadence>0?N*R:0);
    // Which lines are worth freeing. The exchange that pays is between a line the objective reads
    // directly and a line the relaxation wanted to split, so those carry the weight; every other line
    // stays eligible at 1, because the spare line a feeder has to land on is usually neither.
    const lnsSplit=new Uint8Array(lnsCadence>0?N:0);
    if(lnsCadence>0){
      for(let i=0;i<N;i++)for(let s=jobBase[i];s<jobBase[i+1];s++)
        for(let p=prodOff[s],e=prodOff[s+1];p<e;p++){const at=i*R+prodR[p];if(prodC[p]>lnsLineMax[at])lnsLineMax[at]=prodC[p];}
      if(lp&&lp.frac)for(let i=0;i<N;i++){let n=0;const fr=lp.frac[i]||[];for(let j=0;j<fr.length;j++)if(fr[j]>1e-6)n++;if(n>1)lnsSplit[i]=1;}
    }
    const lnsFree=new Int32Array(LNS_MAX_FREE),lnsCur=new Int32Array(LNS_MAX_FREE),lnsPick=new Int32Array(LNS_MAX_FREE);
    const lnsSuf=new Float64Array(lnsCadence>0?(LNS_MAX_FREE+1)*R:0),lnsWeight=new Float64Array(lnsCadence>0?N:0);
    /* Backtracking restores SAVED values, never the arithmetic that produced them: a leaf is compared
     * at 1e-9 against a state reached four moves down, and re-adding what was subtracted does not in
     * general land back on the same double — the state each later branch starts from would drift under
     * the branches that failed. The whole row set is small enough (R is 9 on the reference chain) that
     * saving it wholesale per depth beats tracking which rows a branch touched, and it carries the
     * cached feasibility verdicts back with it for free. */
    const lnsSaveP=new Float64Array(lnsCadence>0?LNS_MAX_FREE*R:0),lnsSaveC=new Float64Array(lnsCadence>0?LNS_MAX_FREE*R:0);
    const lnsSaveB=new Uint8Array(lnsCadence>0?LNS_MAX_FREE*R:0),lnsSaveN=new Int32Array(LNS_MAX_FREE);
    let lnsN=0,lnsBestSc=0,lnsFound=false,lnsWorkAt=0;
    // Enumerate the freed lines against the frozen state. Returns false when the repair is out of work
    // or the whole solve is interrupted — both unwind the same way, and both keep whatever the
    // enumeration had already proved better than the incumbent.
    function lnsDfs(p){
      if(control.work()-lnsWorkAt>=LNS_WORK_CAP)return false;
      if(!keepGoing("lns-node"))return false;
      if(p===lnsN){
        if(infeasCount!==0)return true;
        const sc=scoreNow();
        if(sc>lnsBestSc+EPS){lnsBestSc=sc;lnsFound=true;for(let q=0;q<lnsN;q++)lnsPick[q]=lnsCur[q];}
        return true;
      }
      const off=p*R;
      for(let r=0;r<R;r++)if(produced[r]+lnsSuf[off+r]<consumed[r]*needFrac[r]-1e-7)return true;
      let ub=Infinity;
      for(let k=0;k<targets.length;k++){const t=tIdx[k],v=(produced[t]-consumed[t]+lnsSuf[off+t])/w[k];if(v<ub)ub=v;}
      if(ub<=lnsBestSc+EPS)return true;
      const i=lnsFree[p],js=lineJobs[i],idle=idleIdx(i);
      for(let r=0;r<R;r++){lnsSaveP[off+r]=produced[r];lnsSaveC[off+r]=consumed[r];lnsSaveB[off+r]=rowBad[r];}
      lnsSaveN[p]=infeasCount;
      let live=true;
      for(let j=0;j<js.length&&live;j++){
        // A freed line contributes nothing at entry, so moving it off Idle IS its assignment. The
        // beginMove is only there to keep the shared move buffer from filling down the recursion:
        // the unwind above is this frame's own snapshot, so revertMove is never the right undo here.
        beginMove();applyMove(i,idle,j);lnsCur[p]=j;
        live=lnsDfs(p+1);
        for(let r=0;r<R;r++){produced[r]=lnsSaveP[off+r];consumed[r]=lnsSaveC[off+r];rowBad[r]=lnsSaveB[off+r];}
        infeasCount=lnsSaveN[p];
      }
      return live;
    }
    // Sample 2..4 distinct lines under those weights, ascending so the enumeration walks them in the
    // order the plan is written in.
    const lnsSelect=()=>{
      const want=Math.min(N,2+((rnd()*3)|0));let pool=0;
      for(let i=0;i<N;i++){
        const job=lineJobs[i][inc.ch[i]];
        lnsWeight[i]=1+(lnsSplit[i]?2:0)+(job&&job.kind!=="idle"&&targets.indexOf(job.res)>=0?3:0);
        pool+=lnsWeight[i];
      }
      lnsN=0;
      for(let q=0;q<want;q++){
        let x=rnd()*pool,pick=-1;
        for(let i=0;i<N;i++){if(!(lnsWeight[i]>0))continue;x-=lnsWeight[i];if(x<=0){pick=i;break;}}
        if(pick<0)for(let i=N-1;i>=0;i--)if(lnsWeight[i]>0){pick=i;break;}
        if(pick<0)break;
        pool-=lnsWeight[pick];lnsWeight[pick]=0;
        let at=lnsN++;while(at>0&&lnsFree[at-1]>pick){lnsFree[at]=lnsFree[at-1];at--;}
        lnsFree[at]=pick;
      }
      if(lnsN<2)return false;
      for(let r=0;r<R;r++)lnsSuf[lnsN*R+r]=0;
      for(let p=lnsN-1;p>=0;p--){const at=p*R,next=at+R,line=lnsFree[p]*R;
        for(let r=0;r<R;r++)lnsSuf[at+r]=lnsSuf[next+r]+lnsLineMax[line+r];}
      return true;
    };
    // One destroy-and-repair on the incumbent, writing the freed lines' best joint assignment into
    // `ch`. False when nothing beat the incumbent, including when the bound refuted the subset.
    const lnsRepair=ch=>{
      if(!lnsSelect())return false;
      for(let q=0;q<lnsN;q++)ch[lnsFree[q]]=idleIdx(lnsFree[q]);
      evalChoice(ch);                     // the frozen lines' production and burn, and nothing else
      lnsBestSc=inc.sc;lnsFound=false;lnsWorkAt=control.work();
      lnsDfs(0);
      if(!lnsFound)return false;
      for(let q=0;q<lnsN;q++)ch[lnsFree[q]]=lnsPick[q];
      return true;
    };
    for(let it=0;it<2000000&&!interrupted;it++){
      if(stag>stagLimit||!keepGoing("ils-iteration"))break;
      const ch=inc.ch.slice();
      let cand=null;
      // Both moves hand a candidate to localOpt and both are accepted only on strict improvement, so
      // the stagnation counter counts them alike and the repair's ceiling is a work count rather than
      // a clock — the iteration the search stops at stays the same at every budget.
      if(lnsCadence>0&&it%lnsCadence===lnsCadence-1){
        if(!lnsRepair(ch)){if(!interrupted)stag++;continue;}
        // The enumeration's leaf was feasible and strictly better, so keep it as a candidate in its
        // own right: localOpt below leads with repair(), which drives total input shortfall to zero
        // and will trade objective away to do it.
        evalChoice(ch);
        if(feasibleNow()){const raw=scoreNow();if(raw>inc.sc+EPS)cand={sc:raw,ch:ch.slice()};}
      }else{
        const k=1+((rnd()*2)|0);
        for(let m=0;m<=k;m++){if(!keepGoing("ils-perturb"))break;const li=(rnd()*N)|0,js=lineJobs[li];ch[li]=(rnd()*js.length)|0;}
        // The kick rewrites `ch` wholesale; re-establish the invariant rather than leave the vectors
        // describing the incumbent this kick moved away from.
        evalChoice(ch);
      }
      if(interrupted)break;
      const sc=localOpt(ch);
      if(sc!=null&&!interrupted&&(!cand||sc>cand.sc))cand={sc,ch:ch.slice()};
      if(cand&&!interrupted&&cand.sc>inc.sc+EPS){inc=cand;stag=0;tLastGain=control.readNow();}
      else if(!interrupted)stag++;
    }
    evalChoice(inc.ch);best={score:scoreNow(),choice:inc.ch.slice(),produced:produced.slice(),consumed:consumed.slice()};
  }
  if(interrupted){capped=true;break;}
  // The DFS drives produced/consumed through its own incremental loops and does not touch the
  // feasibility cache — it tests the rows inline. Re-derive the cache from the empty plan it starts
  // and ends on, so the next caller of feasibleNow is not reading a verdict about another plan.
  produced.set(baseArr);consumed.fill(0);rescanFeasibility();
  // LP z bounds this stage's integer optimum; if the incumbent already reaches it, the search is
  // done and neither the DFS nor the second pass can add anything.
  const ceiling=curTol===0?lpBound:marginBound;
  let stageExhaustive=ceiling!=null&&best.score>=ceiling-1e-6*Math.max(1,ceiling);
  if(!stageExhaustive){
    // Priced per stage, because the prices are built over needFrac and the stages do not share it,
    // and only when a DFS is actually going to run. Cleared otherwise so the node test cannot read
    // prices belonging to another tolerance.
    dualN=0;
    if(dualEnabled)buildDualPrices();
    dfs(0,0);stageExhaustive=!capped&&!interrupted;
  }
  // Second pass, on whatever budget the first one left. Everything above is untouched and runs to
  // exactly the same plan it always did; this only ever replaces that plan with one that scores
  // strictly higher on the same objective, so no factory can come out of a release reporting less
  // than it did before. It exists because the search above cannot reach some plans at all, at any
  // budget: the objective counts net TARGET output only, so putting a feeder on a spare line scores
  // the same as leaving it Idle until the target moves onto the line that feeder freed, and moving
  // the target only pays once the feeder is already there. Neither half improves anything alone, so
  // climb() (strict improvement, one line at a time) will not take the first step and a k<=3 random
  // kick will not land both at once. The plan settles with lines idle and the target wherever the
  // constructive seed put it — the reporter's "2 completely empty lines", and a rate below what the
  // same factory reports once a feeder is ticked on as a second output (issue #134). Ticking that
  // feeder on is the workaround they found by hand; this does it internally, hill-climbing a
  // surrogate that pays a little for feeder surplus and then re-optimising under the real objective,
  // with a swap neighbourhood so the exchange survives instead of being unwound one line at a time.
  // Skipped when the first pass already proved its optimum — there is nothing left to find.
  if(!interrupted&&!stageExhaustive&&N>0&&feederIdx.length&&best.score>EPS){
    let cur={sc:best.score,ch:best.choice.slice()};
    for(let e=0;e<FEEDER_WARM_EPS.length&&!interrupted;e++){
      if(!keepGoing("feeder-warm-start"))break;
      const ch=cur.ch.slice();
      if(deepOpt(ch,feederSurrogate(FEEDER_WARM_EPS[e]))==null)continue;
      const sc=deepOpt(ch);
      if(sc!=null&&!interrupted&&sc>cur.sc+EPS)cur={sc,ch:ch.slice()};
    }
    // The warm starts open the plateau; kicking around inside it is what finds the rest. Same shape
    // as the ILS above — same kick, same iteration-based stagnation cutoff so the stopping point
    // stays budget-independent — over the swap neighbourhood rather than single lines alone. A kick
    // shaped like the thing being looked for (move a target, fill a spare line) was tried here and
    // came out behind: it costs half the random kicks and the swap neighbourhood already covers the
    // move it was making by hand.
    let stag=0;
    for(let it=0;it<2000000&&!interrupted;it++){
      if(stag>SWAP_STAG_LIMIT||!keepGoing("swap-ils"))break;
      const ch=cur.ch.slice(),k=1+((rnd()*2)|0);
      for(let m=0;m<=k;m++){if(!keepGoing("swap-ils-perturb"))break;const li=(rnd()*N)|0,js=lineJobs[li];ch[li]=(rnd()*js.length)|0;}
      evalChoice(ch);
      if(interrupted)break;
      const sc=deepOpt(ch);
      if(sc!=null&&!interrupted&&sc>cur.sc+EPS){cur={sc,ch:ch.slice()};stag=0;}else if(!interrupted)stag++;
    }
    if(cur.sc>best.score+EPS)adoptChoice(cur.ch);
  }
  // balance any free deficit out of the now-optimal plan (keeps the objective, trims the margin use)
  if(!interrupted&&best.score>EPS&&N>0){
    const ch=minDeficitAtScore(best.choice.slice(),best.score);
    if(ch&&!interrupted)adoptChoice(ch);
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
// toDec0 rather than a direct .gte: a candidate reaching this contract check may have crossed a
// Worker or cache boundary, which leaves its credits as a plain object or a canonical string.
function creditsRefinementIsNondecreasing(prior,refined){return !!prior&&!!refined&&toDec0(refined.credits).gte(toDec0(prior.credits));}
// Dedicate every line to producing one raw material (raws have no inputs).
function solveRaw(Rw,control){
  let total=0;const plan=[];const resIndex={[Rw]:0};
  const lines=sortedLines();
  for(let si=0;si<lines.length;si++){const s=lines[si];
    if(control&&!control.checkpoint("raw-line"))return {item:Rw,kind:"raw",out:0,plan:null,balance:null,resIndex,capped:false,feasible:false,interrupted:true};
    const allowed=LEVELS.filter(L=>L<=s.max);let bst=null;
    // pick the level that maximises floored output (effective speed capped at the cycle time)
    for(let li=0;li<allowed.length;li++){if(control&&!control.checkpoint("raw-level"))return {item:Rw,kind:"raw",out:0,plan:null,balance:null,resIndex,capped:false,feasible:false,interrupted:true};
      const L=allowed[li],t=craftTime(Rw,L);if(t>0){const rate=craftYield(Rw,L)/t,out=rate*(s.sp>t?t:s.sp);if(!bst||out>bst.out)bst={rate,L,t,out};}}
    const job=bst?{kind:"produce",res:Rw,lvl:bst.L,ct:bst.t,prod:[[0,bst.rate]],cons:[]}:{kind:"idle",res:null,lvl:null,prod:[],cons:[]};
    if(bst)total+=bst.out*s.dp;
    plan[s.orig]={line:s.orig+1,max:s.max,spx:s.sp,dup:(s.dp-1)*100,sp:s.sp,dp:s.dp,job};
  }
  const fHr=supplyRate(forgieHr(Rw));   // Lil' Forgie (+ any reserved) free supply of this raw
  const lineOut=total*3600, out=lineOut+fHr;
  return {item:Rw,kind:"raw",out,plan,balance:[{res:Rw,prod:lineOut,forgie:fHr,cons:0}],resIndex,capped:false,feasible:out>1e-9,interrupted:false};
}

/* ---------- share-of-max calibration ----------
 * A ratio weight is a demand in raw item units, so the same number means wildly different effort
 * per item: on a representative 7-line factory Plates tops out near 7.0m/hr while Gel tops out near
 * 1.6m/hr, and "Plates 9, Gel 3" therefore asks far more of Gel than of Plates. Share mode states
 * each wanted output as a percentage of what that item alone could reach, which puts every slider on
 * the same footing, and converts to a ratio weight of share x that item's own ceiling.
 *
 * The ceiling is itself a solve — one dedicated single-target solve per checked output. Those
 * converge quickly and are insensitive to the budget (each single-target solve stops on the
 * convergence window well inside 500ms), so the pass is affordable.
 *
 * Cached on the factory inputs alone. Shares are deliberately not part of the key: dragging a share
 * slider re-solves the plan but reuses the ceilings, which is the hot path this cache exists for.
 *
 * The cache is Worker-resident and round-trips through the main thread exactly as _lineStability
 * does, through the accessor pair below rather than as a bare global: a pool reuses and rebuilds
 * Workers, and a ceiling computed in one of them is a fact about the factory, not about the Worker
 * that happened to compute it. Without the round trip a rebuilt Worker recalibrates from cold, and
 * scattering the calibration across the pool would throw away every ceiling but one shard's. */
let _soloMaxCache={key:"",values:{}};
const SHARE_CALIBRATION_FRACTION=0.5;   // ceiling on the solve budget calibration may consume
function resetSoloMaxCache(){_soloMaxCache={key:"",values:{}};}
// Emitted in sorted item order rather than in the order the ceilings happened to be computed. This
// object is a wire payload and a merge input: a solve that calibrated in target order and a merge
// that unioned in shard order describe the same cache, and they should serialize to the same bytes.
function getSoloMaxCache(){
  const values={};
  Object.keys(_soloMaxCache.values).sort().forEach(item=>{values[item]=_soloMaxCache.values[item];});
  return {key:_soloMaxCache.key,values};
}
/* Coerced rather than trusted, and dropped entry by entry rather than wholesale. These numbers are
 * divisors and multipliers in the weight conversion below — a NaN or a negative ceiling does not
 * fail there, it produces a NaN weight and a plan solved against nonsense — and the cache arrives
 * from a Worker message that has crossed a structured clone and, on a replay, localStorage. A
 * dropped entry costs one recalibration; a kept bad one costs the plan. */
function setSoloMaxCache(value){
  const key=value&&typeof value.key==="string"?value.key:"";
  const source=value&&value.values&&typeof value.values==="object"?value.values:{};
  const values={};
  if(key)Object.keys(source).forEach(item=>{
    const ceiling=Number(source[item]);
    if(Number.isFinite(ceiling)&&ceiling>=0)values[item]=ceiling;
  });
  _soloMaxCache=key?{key,values}:{key:"",values:{}};
}
// Parameterized on the state it describes rather than reading the global S, so the key can be built
// for a snapshot the caller holds — which is what lets the main thread decide whether a Worker's
// returned ceilings still describe the factory on screen.
function soloMaxKey(state){
  const src=state||{};
  return canonicalShareKey({
    lines:(src.lines||[]).map(line=>[line.max,line.spx,line.turbo]),
    maxTurbo:src.maxTurbo,dupe:src.dupe,margin:src.margin,
    baseTime:src.baseTime||{},prodCost:src.prodCost||{},forgie:src.forgie||{},minedIncome:src.minedIncome||{}
  });
}
function canonicalShareKey(value){
  /* A quantity is a scalar here, exactly as it is to canonicalSolveJson and to the state scan. This
   * walker builds JSON by hand and so never reaches Decimal's toJSON; left alone it descends into
   * the instance and spells one number as {"constructor":undefined,"d":[..],"e":..,"s":..}, which
   * pins the key to decimal.js's internal representation and inflates a real factory's key past
   * three times the length of the values it describes. */
  if(typeof Decimal==="function"&&value instanceof Decimal)return JSON.stringify(value.toString());
  if(Array.isArray(value))return "["+value.map(canonicalShareKey).join(",")+"]";
  if(value&&typeof value==="object"){
    return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonicalShareKey(value[k])).join(",")+"}";
  }
  return JSON.stringify(value);
}
// Output per hour with the whole factory dedicated to this one item. Returns null when the slice
// ran out before a usable figure existed, so the caller can fall back rather than calibrate on noise.
function soloMaxFor(item,control,slice){
  if(RAWS.includes(item)){
    const raw=solveRaw(item,control);
    return raw.interrupted?null:raw.out;
  }
  const rc=relevantChain([item]);
  const options={control};
  if(Number.isFinite(slice))options.localDeadline=control.readNow()+slice;
  const sr=solveCore([item],[1],rc.prods,rc.raws,Math.max(300,slice||0),options);
  if(sr.interrupted)return null;
  return sr.feasible?(sr.best.produced[sr.resIndex[item]]-sr.best.consumed[sr.resIndex[item]])*3600:0;
}
/* ---------- shard descriptors ----------
 * A shard is {index,count}: which slice of one request this solve was handed, and nothing else.
 * Every mode that fans out needs only that, and a mode-specific union would put per-mode validation
 * on a boundary whose whole job is to reject rather than guess.
 *
 * Re-normalized here even though the Worker entry point already validated the wire form, because
 * optimize() is also called directly on the main thread by the synchronous fallback and by tests.
 * Anything unusable reads as "no shard", which is the whole-request solve — a shard descriptor may
 * cost a solve its parallelism, never its correctness. */
function normalizeShard(shard){
  if(!shard||typeof shard!=="object")return null;
  const index=shard.index,count=shard.count;
  if(!Number.isInteger(count)||count<1||!Number.isInteger(index)||index<0||index>=count)return null;
  return count===1?null:{index,count};
}
// Round-robin in the caller's order, which for every mode below is catalog order. Round-robin
// rather than contiguous blocks because the per-item cost is wildly uneven — a raw resource's
// baseline is a closed form and a deep product's is a full chain solve — and adjacent catalog
// entries are the most alike, so contiguous blocks would hand one shard all the expensive ones.
function shardSlice(list,shard){
  const norm=normalizeShard(shard);
  if(!norm)return list.slice();
  return list.filter((entry,at)=>at%norm.count===norm.index);
}
/* Ratio weights for the checked outputs under the active mix mode. Ratio mode passes the sliders
 * straight through. Share mode returns the converted weights plus the ceilings behind them, and
 * names any output whose ceiling is zero — an item nothing in this factory can make, which would
 * otherwise silently drag the whole shared floor to zero with no indication of the culprit. */
function mixWeights(targets,control,budget,shard){
  if(S.targetMode!=="share")return {weights:targets.map(it=>S.targets[it].w),soloMax:null,blocked:[],calibrated:false};
  const key=soloMaxKey(S);
  if(_soloMaxCache.key!==key)_soloMaxCache={key,values:{}};
  const cache=_soloMaxCache.values;
  const absent=targets.filter(it=>cache[it]==null);
  /* Scattered across the pool: the ceilings are one dedicated single-target solve each and share
   * nothing, so shard i computes every count-th one. The slice is sized on this shard's own list, so
   * K shards each spend the same fraction of the budget on a K-th of the work rather than K-thing
   * the time as well. Ceilings this shard did not compute stay absent and fall through to the raw
   * slider below; the merge unions every shard's __solo, so the next solve finds them all warm.
   * `calibrated` therefore reports what THIS shard finished, and the merge ANDs it. */
  const missing=shardSlice(absent,shard);
  const slice=missing.length?Math.max(300,Math.floor(budget*SHARE_CALIBRATION_FRACTION/missing.length)):0;
  let calibrated=missing.length===absent.length;
  for(let i=0;i<missing.length;i++){
    const value=soloMaxFor(missing[i],control,slice);
    if(value==null){calibrated=false;break;}
    cache[missing[i]]=value;
  }
  const soloMax={},blocked=[];
  const weights=targets.map(it=>{
    const ceiling=cache[it];
    if(ceiling==null)return S.targets[it].w;                 // uncalibrated: fall back to the raw slider
    soloMax[it]=ceiling;
    if(!(ceiling>1e-9)){blocked.push(it);return 1e-9;}       // unmakeable; keep the weight positive
    return Math.max(1e-9,(targetShareOf(S.targets[it])/100)*ceiling);
  });
  return {weights,soloMax:calibrated||Object.keys(soloMax).length?soloMax:null,blocked,calibrated};
}

function optimizeInner(timeBudget,testOptions,shard){
  // User-set max solve time (ms). It is an anytime cap, so easy factories still finish early; a
  // larger default gives slower devices and deep Credits chains room to improve. Solves run off the
  // main thread in the generated Worker, so the 10-second default does not freeze the interface.
  const userBudget=boundedPersistedField("solveBudget",S.solveBudget,10000,200,60000,true);
  const itemsBudget=timeBudget||userBudget, credBudget=timeBudget||userBudget;
  const mode=S.mode==="credits"?"credits":"items";
  if(mode==="items"){
    const targets=[...PRODUCTS,...RAWS].filter(it=>S.targets[it]&&S.targets[it].on);
    if(targets.length===0)return {empty:true,mode};
    const itemControl=makeSolveControl(itemsBudget,testOptions),t0=itemControl.readNow();
    // Calibration runs before the plan solve and shares its control, so it is bounded by the same
    // user budget rather than added on top of it.
    const mix=mixWeights(targets,itemControl,itemsBudget,shard);
    const w=mix.weights;
    const rc=relevantChain(targets);
    const sr=solveCore(targets,w,rc.prods,rc.raws,itemsBudget,{control:itemControl,spendFreeHeadroom:true});
    const {plan,balance,minedUsage,gelReserved}=planFrom(sr);
    const out={};targets.forEach((t,k)=>{out[t]=sr.feasible?(sr.best.produced[sr.tIdx[k]]-sr.best.consumed[sr.tIdx[k]])*3600:0;});
    // The objective is the shared weighted floor: the smallest output-to-weight ratio. Reporting it
    // alongside which output owns it, and how far every other output sits above it, is what turns
    // "everything came out low" into "Gel is holding the floor and the rest have room to spare".
    const ratios=targets.map((t,k)=>(out[t]||0)/w[k]);
    const objective=sr.feasible?Math.min(...ratios):0;
    let binding=null,slack=null,shareOfMax=null;
    if(sr.feasible&&objective>0){
      binding=targets[ratios.indexOf(Math.min(...ratios))];
      slack={};targets.forEach((t,k)=>{slack[t]=ratios[k]/objective-1;});
    }
    if(mix.soloMax){
      shareOfMax={};
      targets.forEach(t=>{const ceiling=mix.soloMax[t];if(ceiling>1e-9)shareOfMax[t]=(out[t]||0)/ceiling;});
    }
    // Same per-hour units as `objective`, so the two are directly comparable. Never below the
    // objective it bounds: a rounding-scale overshoot is clamped rather than shown as a negative gap.
    let bound=null;
    if(sr.feasible&&Number.isFinite(sr.bound)){
      const scaled=sr.bound*3600;
      if(Number.isFinite(scaled))bound=Math.max(scaled,objective);
    }
    return {empty:false,mode,issues:sr.issues,plan,balance,minedUsage,gelReserved,out,resIndex:sr.resIndex,targets,objective,bound,
      mixMode:S.targetMode==="share"?"share":"ratio",binding,slack,shareOfMax,soloMax:mix.soloMax,blocked:mix.blocked,
      tol:sr.tol,usesMargin:sr.usesMargin,feasible:sr.feasible,capped:sr.capped,deadlineReached:!!sr.deadlineReached,
      ms:Math.max(0,itemControl.readNow()-t0)};
  }
  // Credits is intentionally a dedicated-item comparison: each priced item gets a whole-factory
  // plan, then those plans are ranked. It is not a theorem that a mixed-sales factory is inferior.
  // One shared control covers the complete comparison. Every item gets a finite deterministic
  // baseline in catalog order before any product receives deeper refinement.
  const control=makeSolveControl(credBudget,testOptions),t0=control.readNow();
  const pricedAll=ALLITEMS.filter(item=>toDec0(S.sellPrice&&S.sellPrice[item]).gt(DEC_ZERO));
  /* Sharded here and nowhere deeper: the candidates share a control and a budget but nothing else —
   * no candidate reads another's plan — so a shard is simply a shorter catalog. Every rule below is
   * stated over `priced` and holds unchanged on a slice of it: the baseline pass is still complete
   * before any refinement, the fair pass still divides the SAME absolute remaining budget among the
   * candidates this shard owns, and the clock is still started once and never restarted. What a
   * shard cannot do is rank against candidates it never saw, which is why the ranking it returns is
   * a fragment and mergeShardResults on the main thread owns the final order. */
  const priced=shardSlice(pricedAll,shard);
  const baselineWorkLimit=Math.max(4000,(S.lines||[]).length*2000);
  const issues=[],cand=[];
  const addIssues=found=>(found||[]).forEach(issue=>{if(!issues.includes(issue))issues.push(issue);});
  // Asked of the whole catalog, not of this shard: an empty slice means the pool out-numbered the
  // priced items, which is not something to tell the reader to go and fix.
  if(!pricedAll.length)issues.push("No sell prices entered. Open “Projects + Prices” → “Sell prices” and add at least one.");
  const unevaluated=item=>({item,kind:RAWS.includes(item)?"raw":"product",out:0,price:toDec0(S.sellPrice[item]),credits:DEC_ZERO,
    plan:null,balance:null,minedUsage:[],gelReserved:null,resIndex:{},feasible:false,usesMargin:false,capped:false,evaluated:false,ms:0});
  const fromCore=(item,sr,ms,cappedOverride)=>{
    const built=planFrom(sr),out=sr.feasible?(sr.best.produced[sr.resIndex[item]]-sr.best.consumed[sr.resIndex[item]])*3600:0;
    const price=toDec0(S.sellPrice[item]);
    return {item,kind:"product",out,price,credits:price.times(out),plan:built.plan,balance:built.balance,minedUsage:built.minedUsage,
      gelReserved:built.gelReserved,resIndex:sr.resIndex,feasible:sr.feasible,usesMargin:!!sr.usesMargin,
      capped:cappedOverride==null?!!sr.capped:!!cappedOverride,evaluated:true,ms};
  };
  let baselineBroken=false;
  for(let pi=0;pi<priced.length;pi++){
    const item=priced[pi],price=toDec0(S.sellPrice[item]);
    if(baselineBroken||control.isStopped()||!control.checkpoint("credits-baseline-candidate")){
      baselineBroken=true;cand.push(unevaluated(item));continue;
    }
    control.event("baseline-start",{item});const start=control.readNow();let candidate=null;
    if(RAWS.includes(item)){
      const raw=solveRaw(item,control);
      if(!raw.interrupted&&control.checkpoint("credits-baseline-complete"))candidate={item,kind:"raw",out:raw.out,price,credits:price.times(raw.out),
        plan:raw.plan,balance:raw.balance,minedUsage:[],gelReserved:null,resIndex:raw.resIndex,feasible:raw.feasible,
        usesMargin:false,capped:false,evaluated:true,ms:Math.max(0,control.readNow()-start)};
    }else{
      const ins=RECIPE[item].inputs;
      const hasCost=LEVELS.some(L=>hasRecipeCost(item,ins,L));
      if(!hasCost){
        issues.push("No material cost entered for "+item+" — only passive output can be priced.");
        if(control.checkpoint("credits-baseline-complete")){const out=supplyRate(forgieHr(item)),resIndex={[item]:0};candidate={item,kind:"product",out,price,credits:price.times(out),
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

  const order=new Map(ALLITEMS.map((item,index)=>[item,index]));
  const refinementOrder=()=>cand.filter(candidate=>candidate.kind==="product"&&candidate.evaluated&&candidate.capped)
    .sort((a,b)=>a.credits.eq(b.credits)?order.get(a.item)-order.get(b.item):(a.credits.gt(b.credits)?-1:1));
  const refineCandidate=(prior,round,localDeadline)=>{
    if(!control.checkpoint("credits-refinement-candidate"))return false;
    control.event("refinement-start",{item:prior.item,round});const start=control.readNow();
    const rc=relevantChain([prior.item]);
    const options={control,initialPlan:prior.plan};
    if(Number.isFinite(localDeadline))options.localDeadline=localDeadline;
    const sr=solveCore([prior.item],[1],rc.prods,rc.raws,credBudget,options);
    addIssues(sr.issues);
    const spent=Math.max(0,control.readNow()-start);
    if(sr.interrupted){prior.ms+=spent;return false;}
    const refined=fromCore(prior.item,sr,prior.ms+spent,null);
    if(creditsRefinementIsNondecreasing(prior,refined))Object.assign(prior,refined);
    else prior.ms+=spent;
    control.event("refinement-complete",{item:prior.item,round});
    return !control.isStopped();
  };
  // Refine only after the complete baseline pass. Every capped product gets a reserved fraction of
  // the wall-clock time that remains before a small finalization guard: available / candidates left.
  // Fast candidates return their unused time to the pool, so the fraction is recomputed each time.
  // A local cutoff keeps that candidate's last safe incumbent and does not poison the shared root.
  // Only after the entire fair pass may an adaptive round spend leftover time in newly demonstrated
  // Credits order. Catalog order breaks exact ties; candidate objects keep identity for future
  // per-item solve reuse without coupling the candidate searches to each other.
  if(!baselineBroken&&!control.isStopped()){
    const bounded=refinementOrder();let boundedComplete=true;
    const finalizationGuard=Math.min(25,Math.max(1,credBudget*0.005));
    const refinementDeadline=control.deadline-finalizationGuard;
    for(let pi=0;pi<bounded.length;pi++){
      const now=control.readNow(),remaining=bounded.length-pi,available=refinementDeadline-now;
      if(available<=0){boundedComplete=false;break;}
      const localDeadline=now+available/remaining;
      if(!refineCandidate(bounded[pi],"bounded",localDeadline)){boundedComplete=false;break;}
    }
    if(boundedComplete&&!control.isStopped()){
      const deep=refinementOrder();
      for(let pi=0;pi<deep.length;pi++){
        if(control.readNow()>=refinementDeadline||!refineCandidate(deep[pi],"deep",refinementDeadline))break;
      }
    }
  }
  cand.sort((a,b)=>{const evaluated=Number(b.evaluated)-Number(a.evaluated);if(evaluated)return evaluated;
    if(!a.credits.eq(b.credits))return a.credits.gt(b.credits)?-1:1;
    return order.get(a.item)-order.get(b.item);});
  const allCandidatesEvaluated=cand.every(candidate=>candidate.evaluated);
  const deadlineReached=control.deadlineReached();
  const searchExhaustive=allCandidatesEvaluated&&cand.every(candidate=>!candidate.capped);
  const top=cand.find(candidate=>candidate.evaluated);
  const feasible=!!top&&top.credits.gt(1e-9);
  return {empty:false,mode,issues,ranking:cand,bestItem:feasible?top.item:null,credits:feasible?top.credits:DEC_ZERO,objective:feasible?top.credits:DEC_ZERO,
    plan:feasible?top.plan:idlePlan(),balance:feasible?top.balance:[],minedUsage:feasible?top.minedUsage:[],gelReserved:feasible?top.gelReserved:null,resIndex:feasible?top.resIndex:{},
    tol:boundedPersistedField("margin",S.margin,0,0,20)/100,usesMargin:!!(feasible&&top.usesMargin),feasible,capped:!!(feasible&&top.capped),
    allCandidatesEvaluated,deadlineReached,searchExhaustive,ms:Math.max(0,control.elapsed()-(t0-control.startedAt))};
}

/* ---------- Gel loadout ----------
   Gel is a native resource in the solve now (see solveCore / projectSchedule). The player-facing
   capacity helper is exact; repeated solver prefixes use the separately named bounded seed. */
// Gel output / vespium burn for a whole line running Gel @L (≤ the line's own cap), full time.
function gelOutHr(row,L){const sp=lineSpeed(row),dp=dupeMult(),ct=craftTime(GEL,L);return ct>0?(craftYield(GEL,L)/ct)*effSpeed(sp,ct)*dp*3600:0;}
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
  const vespUpperBound=gelLoadoutStableSum(ordered.map(entry=>
    entry.options.reduce((best,option)=>Math.max(best,option.vespHr),0)));
  const gelPruneBounds=gelLoadoutPruneBounds(gelUpperBound,ordered.length);
  // Unused income cannot enlarge any candidate sum. Basing numeric pruning on an arbitrarily huge
  // user budget makes its safety interval dwarf every attainable cost and disables dominance.
  const vespPruneBounds=gelLoadoutPruneBounds(Math.min(vespBudgetHr,vespUpperBound),ordered.length);
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
// Aggregate Vespium/hour from every declared source (0 if all are unset → Gel off).
function gelVespBudgetHr(){return minedBudgetHr("Vespium");}
function projectDemand(){
  const gross={};ALLITEMS.forEach(it=>gross[it]=DEC_ZERO);
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
    const sub={};ALLITEMS.forEach(it=>sub[it]=DEC_ZERO);
    for(let i=start;i<to&&i<lv.length;i++){
      (lv[i].costs||[]).forEach(c=>{const it=c.item,q=toDec0(c.qty);if(ALLITEMS.includes(it)&&q.gt(DEC_ZERO)){sub[it]=sub[it].add(q);gross[it]=gross[it].add(q);}});
    }
    perProject.push({id:p.id||"",name:p.name||"Project",catId:p.catId||"",prio:(p.prio!=null?p.prio:null),from:start+1,to,levels:lv.length,sub});
  });
  const inv={};ALLITEMS.forEach(it=>inv[it]=toDec0(S.inventory&&S.inventory[it]));
  const net=projNetVec(gross,inv);
  return {gross,net,perProject};
}
// Which unavailable mined resources block this item or any product in its recipe chain?
// Passive supply of the item itself bypasses its crafting chain.
function chainMinedBlockers(item,seen){
  if(forgieHr(item).gt(1e-9))return [];
  seen=seen||new Set();if(seen.has(item))return [];seen.add(item);
  const out=[],cfg=MINED_CRAFTS[item];
  if(cfg&&!minedBudgetHr(cfg.resource).gt(DEC_ZERO))out.push(cfg.resource);
  const rec=RECIPE[item];
  (rec&&rec.inputs||[]).forEach(k=>{
    if(PRODUCTS.includes(k))out.push(...chainMinedBlockers(k,new Set(seen)));
  });
  return [...new Set(out)];
}
/* Exact-tableau memo for the makespan LP.
 *
 * The key cannot be built from the arguments the tableau's builders were called with. Both builders
 * read the global S on top of their arguments: projectSchedule takes line count, speeds, turbo and
 * duplication from sortedLines(), base craft times from craftTime, and S.prodCost twice per
 * (item,input,level) — once as a validity gate that DROPS the variable, so a key missing it can
 * name two tableaux with different column counts — plus mined costs and which mined resources are
 * active, which decides which ROWS exist; buildScheduleLP takes each row's bound from mined income
 * or passive supply. Keying on (n,m,c,A,b) is exact by construction and stays exact when either
 * builder grows another input. The digest only nominates a candidate; an element-wise compare
 * decides the hit, so a collision costs a comparison rather than a wrong plan.
 *
 * Scoped to one optimize() call (optimizeProjectTop hangs it on runOptions), so the selected run
 * and the hidden prefer-current comparison — which re-derives the same free tableaux — share it,
 * and nothing outlives the run that built it. */
const LP_MEMO_MAX_BYTES=4<<20;
const _lpKeyView=new DataView(new ArrayBuffer(8));
function lpTableauDigest(c,A,b){
  let h=0x811c9dc5;
  const mixByte=byte=>{h=Math.imul(h^(byte&0xff),0x01000193);};
  const mixWord=word=>{mixByte(word);mixByte(word>>>8);mixByte(word>>>16);mixByte(word>>>24);};
  // -0 normalized to 0: === treats them as equal, so the verify below cannot tell them apart and the
  // digest must not either, or one tableau splits into two entries that each miss the other.
  const mixNumber=value=>{_lpKeyView.setFloat64(0,value===0?0:value,true);
    mixWord(_lpKeyView.getUint32(0,true));mixWord(_lpKeyView.getUint32(4,true));};
  mixWord(c.length);mixWord(A.length);
  for(let j=0;j<c.length;j++)mixNumber(c[j]);
  for(let i=0;i<A.length;i++){const row=A[i];mixWord(row.length);
    for(let j=0;j<row.length;j++)mixNumber(row[j]);
    mixNumber(b[i]);}
  return (h>>>0).toString(36);
}
function sameLpTableau(entry,c,A,b){
  if(entry.n!==c.length||entry.m!==A.length)return false;
  for(let j=0;j<entry.n;j++)if(entry.c[j]!==c[j])return false;
  for(let i=0;i<entry.m;i++){
    const row=A[i],kept=entry.A[i];
    if(kept.length!==row.length)return false;
    for(let j=0;j<kept.length;j++)if(kept[j]!==row[j])return false;
    if(entry.b[i]!==b[i])return false;
  }
  return true;
}
function makeLpMemo(){
  const table=new Map();let bytes=0,hits=0,misses=0,entries=0;
  return {
    __forgeLpMemo:true,
    stats:()=>({hits,misses,entries,bytes}),
    lookup(c,A,b){
      const bucket=table.get(lpTableauDigest(c,A,b));
      if(bucket)for(let k=0;k<bucket.length;k++)if(sameLpTableau(bucket[k],c,A,b)){
        hits++;
        // A fresh copy every time. projectSchedule keeps the returned vector and reads it across the
        // whole stability pass and both plan walks; handing out the stored one lets any caller
        // rewrite every later hit.
        const out=bucket[k].out;
        return {x:out.x?new Float64Array(out.x):null,complete:out.complete,unbounded:out.unbounded};
      }
      misses++;return null;
    },
    store(c,A,b,sol){
      const n=c.length,m=A.length;
      let size=8*(n+m+(sol.x?sol.x.length:0));
      for(let i=0;i<m;i++)size+=8*A[i].length;
      // Cap the table rather than evict from it: a run solves a handful of tableaux, and a bounded
      // table with no eviction policy cannot make the memo's contents depend on call order.
      if(bytes+size>LP_MEMO_MAX_BYTES)return;
      const entry={n,m,c:Float64Array.from(c),A:A.map(row=>Float64Array.from(row)),b:Float64Array.from(b),
        out:{x:sol.x?new Float64Array(sol.x):null,complete:!!sol.complete,unbounded:!!sol.unbounded}};
      const digest=lpTableauDigest(c,A,b),bucket=table.get(digest);
      if(bucket)bucket.push(entry);else table.set(digest,[entry]);
      bytes+=size;entries++;
    },
  };
}
const LP_MAX_PIVOTS=20000;
/* Project a Decimal right-hand side into the float64 the tableau is built from.
 *
 * Row equilibration was the obvious move here and it is the wrong one, which is worth recording.
 * Dividing a row by its own largest entry does leave the feasible set untouched, and it does bound
 * every entry to [-1,1] — but every tolerance in lpSimplexSolve is an ABSOLUTE constant (1e-9 to
 * enter, 1e-12 on the ratio test). Scaling a row down moves its coefficients toward those constants
 * rather than away, and on this tableau it pushed the z-column of an ordinary item row from ~1 to
 * ~1e-8, close enough to the entering threshold to cost pivots and, on the project corpus, to leave
 * Bland short of completion. Better conditioning on paper, worse arithmetic in practice.
 *
 * So the RHS is saturated instead of scaled, and only when it has to be. A supply that fits a
 * float64 is passed through exactly, which is what keeps every plan that already solved identical.
 * A supply that does not fit becomes MAX_VALUE — no finite alternative is more permissive, so this
 * can never wrongly restrict the solve, and a supply that large could not have been binding anyway.
 *
 * The magnitude problem this leaves — a supply legitimately dwarfing its own row — is handled where
 * it actually matters, by the consCeiling cap in solveCore, which bounds a free supply by what the
 * factory could physically consume before it ever reaches an array. */
/* A Decimal reduced to a tableau coefficient. Saturates at the largest finite double rather than
 * overflowing to +/-Infinity: an infinite entry poisons the first pivot that touches its row
 * (0 * Infinity is NaN), while a saturated one still says what the quantity meant — larger than
 * anything else in the problem. */
function finiteCoefficient(value){
  const flat=value.toNumber();
  if(Number.isFinite(flat))return flat;
  return value.lt(DEC_ZERO)?-Number.MAX_VALUE:Number.MAX_VALUE;
}
function lpFiniteRhs(b){
  for(let i=0;i<b.length;i++){
    const supply=toDec0(b[i]).toNumber();
    b[i]=Number.isFinite(supply)?supply:Number.MAX_VALUE;
  }
}
/* Certify a finished speculative solve against the caller's UNTOUCHED (c,A,b), which is the only
 * data a bent tableau cannot have bent. x is the primal vertex and y the objective row's slack-
 * column entries — the duals of the <= rows — so primal feasibility, dual feasibility and equal
 * objectives together prove optimality outright, whatever the pivot arithmetic did on the way.
 *
 * Every tolerance is the residual's own summed magnitude, never a constant. A pivot-element
 * magnitude test was measured here first and dropped: over the real corpus the chosen element runs
 * as low as 2.5e-30 of its column on solves whose objective still agrees with Bland's to 1e-16, so
 * no threshold separates a bad pivot from a good one. This checks the answer instead of the
 * arithmetic, and costs about two pivots. */
function lpCertifyOptimal(c,A,b,x,y){
  const m=A.length,n=c.length;
  let primalObj=0,dualObj=0,primalScale=0,dualScale=0;
  for(let j=0;j<n;j++){
    if(!(x[j]>=-1e-12))return false;
    primalObj+=c[j]*x[j];primalScale+=Math.abs(c[j]*x[j]);
  }
  for(let i=0;i<m;i++){
    if(!(y[i]>=-1e-12))return false;
    dualObj+=b[i]*y[i];dualScale+=Math.abs(b[i]*y[i]);
    const row=A[i];let used=0,scale=Math.abs(b[i]);
    for(let j=0;j<n;j++){const term=row[j]*x[j];used+=term;scale+=Math.abs(term);}
    if(!(used<=b[i]+1e-9*Math.max(1,scale)))return false;
  }
  for(let j=0;j<n;j++){
    let covered=0,scale=Math.abs(c[j]);
    for(let i=0;i<m;i++){const term=A[i][j]*y[i];covered+=term;scale+=Math.abs(term);}
    if(!(covered>=c[j]-1e-9*Math.max(1,scale)))return false;
  }
  if(!Number.isFinite(primalObj)||!Number.isFinite(dualObj))return false;
  return Math.abs(primalObj-dualObj)<=1e-9*Math.max(1,primalScale,dualScale);
}
/* Dense single-phase simplex. Maximize c·x s.t. A x <= b (b>=0), x>=0.
 *
 * `dantzig` selects the most-negative-reduced-cost entering column instead of Bland's lowest index.
 * It reaches the same optimum in far fewer pivots and has neither an anti-cycling guarantee nor, on
 * these tableaux, a numerical one: every tolerance below is absolute and unscaled while b spans 1.0
 * to 1e100 (a Vespium rig income), so the ratio tie-break degrades to "first eligible row wins" and
 * the loop can walk itself into a tableau that no longer represents the problem. The rule therefore
 * runs as a speculative attempt under a pivot budget, with abort triggers on a falling objective
 * row, a basic variable that went negative, an exhausted budget, an unboundedness claim, and a
 * finished solve that fails to certify; it reports `aborted` instead of an answer and the caller
 * re-solves the untouched (c,A,b) under Bland. Failure costs one wasted attempt, never a wrong
 * vertex. */
function lpSimplexSolve(c,A,b,control,dantzig){
  const m=A.length,n=c.length,W=n+m+1;
  const T=[];
  for(let i=0;i<m;i++){
    if(control&&!control.checkpoint("lp-tableau-row",Math.max(1,n)))return {x:null,interrupted:true,complete:false};
    const row=new Float64Array(W);for(let j=0;j<n;j++)row[j]=A[i][j];row[n+i]=1;row[W-1]=b[i];T.push(row);
  }
  const obj=new Float64Array(W);for(let j=0;j<n;j++)obj[j]=-c[j];T.push(obj);
  const basis=[];for(let i=0;i<m;i++)basis.push(n+i);
  // The attempt gets a budget proportional to the tableau. Bland keeps the historical hard cap: it
  // is the loop that has to terminate on its own.
  const budget=dantzig?Math.min(LP_MAX_PIVOTS,4*(n+m)+64):LP_MAX_PIVOTS;
  let rhsScale=1;
  if(dantzig)for(let i=0;i<m;i++){const magnitude=Math.abs(b[i]);if(magnitude>rhsScale)rhsScale=magnitude;}
  let objRhs=0,complete=false;
  for(let it=0;it<budget;it++){
    // A simplex pivot is atomic: check before mutating its row/tableau so cancellation can never
    // expose a half-pivoted solution. The work charge reflects the dense row update.
    if(control&&!control.checkpoint("lp-pivot",Math.max(1,W*(m+1)))){
      const x=new Float64Array(n);for(let i=0;i<m;i++)if(basis[i]<n)x[basis[i]]=T[i][W-1];
      return {x,interrupted:true,complete:false};
    }
    let piv=-1;
    // Same entering threshold under both rules, so "no entering column" means the same optimum test.
    if(dantzig){let low=-1e-9;for(let j=0;j<n+m;j++){const rc=T[m][j];if(rc<low){low=rc;piv=j;}}}
    else{for(let j=0;j<n+m;j++){if(T[m][j]<-1e-9){piv=j;break;}}}
    if(piv<0){complete=true;break;}
    let leave=-1,best=Infinity;
    for(let i=0;i<m;i++){const a=T[i][piv];
      if(a>1e-9){const r=T[i][W-1]/a;if(r<best-1e-12||(Math.abs(r-best)<1e-12&&(leave<0||basis[i]<basis[leave]))){best=r;leave=i;}}}
    // Unboundedness is a claim about the feasible region, so only the exact loop is allowed to make
    // it; the attempt hands the question back rather than certify it off a tableau it may have bent.
    if(leave<0)return dantzig?{aborted:true}:{x:null,unbounded:true,complete:true};
    const prow=T[leave],pv=prow[piv];
    for(let j=0;j<W;j++)prow[j]/=pv;
    for(let i=0;i<=m;i++){if(i===leave)continue;const f=T[i][piv];if(Math.abs(f)>1e-12){const ri=T[i];for(let j=0;j<W;j++)ri[j]-=f*prow[j];}}
    basis[leave]=piv;
    if(dantzig){
      // The objective row's RHS is the current objective value, and an entering column with negative
      // reduced cost can only raise it. A fall, or a value that has stopped being a number, is the
      // tableau coming apart rather than the rule being slow.
      const now=T[m][W-1];
      if(!Number.isFinite(now)||now<objRhs-1e-9*Math.max(1,Math.abs(objRhs)))return {aborted:true};
      objRhs=now;
    }
  }
  const x=new Float64Array(n);for(let i=0;i<m;i++)if(basis[i]<n)x[basis[i]]=T[i][W-1];
  if(dantzig){
    if(!complete)return {aborted:true};
    // The ratio test keeps every basic variable non-negative. One that went negative got there by
    // cancellation, and the vertex it names is not a point of the feasible region.
    for(let i=0;i<m;i++)if(T[i][W-1]<-1e-9*rhsScale)return {aborted:true};
    // The certificate is dense arithmetic of a pivot's order, so it is charged like one — a memoized
    // or speculative path that spends work off the books makes the run's own accounting a lie.
    if(control&&!control.checkpoint("lp-pivot",Math.max(1,2*n*(m+1))))return {x,interrupted:true,complete:false};
    const y=new Float64Array(m);for(let i=0;i<m;i++)y[i]=T[m][n+i];
    if(!lpCertifyOptimal(c,A,b,x,y))return {aborted:true};
  }
  return {x,complete};
}
/* Solve one LP. `opts.pivotRule:"dantzig"` runs the speculative attempt first and falls back to the
 * exact loop when it aborts; anything else goes straight to Bland, which is what every call site
 * asks for today.
 *
 * The rule is opt-in rather than the default because BOTH families of caller read the vertex, not
 * just the optimum. These LPs have alternate optima: z is unique, the vertex is not. The makespan LP
 * hands its vertex to the line assignment, the warm-ups it implies and the reported project ETA;
 * the relaxation inside solveCore hands its vertex to the roundings that seed the whole local
 * search, so a different-but-equally-optimal vertex reseeds a bounded anytime search and moves the
 * plan it settles on. test/lp-pivot.cjs measures both halves of that on real captured tableaux: the
 * same optimum to 1e-16 for well under half the pivots, at a vertex Bland does not return. Switching
 * the relaxation over to it moves test/credits-contract.cjs's pinned exact-Wire reproduction by 1%
 * and flips its adversarial deep-winner to a candidate 2.5% worse. Cheaper pivots are not worth a
 * worse plan; making the vertex canonical is what would let this be switched on, and that is a
 * change to the LP rather than to the pivot rule. */
function lpMaximize(c,A,b,control,opts){
  if(opts&&opts.pivotRule==="dantzig"){
    const attempt=lpSimplexSolve(c,A,b,control,true);
    if(!attempt.aborted)return attempt;
  }
  return lpSimplexSolve(c,A,b,control,false);
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
    // Demand net of drawable stock, normalized by D0 (the largest demand) so the z-column sits
    // beside the rate coefficients rather than dwarfing them — the reason D0 exists.
    /* toNumber() can overflow when the stock being drawn down is itself past the float ceiling, and
     * an infinite coefficient turns the first pivot that touches this row into NaN. Saturating keeps
     * the row's meaning — stock this far beyond the demand covers it outright — in a number the
     * tableau can carry. lpFiniteRhs does the same for b; this is the matching guard for A. */
    row[zCol]=finiteCoefficient(toDec0(net[it]).sub(toDec0(avail&&avail[it]).times(STOCK_SAFETY_FRAC)).div(D0));
    A.push(row);b.push(isMinedResource(it)?minedBudgetHr(it):forgieHr(it));
  });
  const c=new Array(n).fill(0);c[zCol]=1;
  lpFiniteRhs(b);
  return {A,b,c,zCol,n};
}
/* One makespan LP solve. The memo is consulted at this level rather than inside lpMaximize so a hit
 * costs no call at all — the repeated near-identical solves this exists to remove are visible as
 * calls, not only as pivots. An interrupted solve is never stored: it reports where the run's clock
 * ran out, not what the tableau evaluates to. */
function solveScheduleLP(part,control,memo){
  if(memo){const hit=memo.lookup(part.c,part.A,part.b);if(hit)return hit;}
  const sol=lpMaximize(part.c,part.A,part.b,control);
  if(memo&&!sol.interrupted)memo.store(part.c,part.A,part.b,sol);
  return sol;
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
  // The run's solve control and its tableau memo ride in beside the stability policy: both are
  // per-run, and threading them as extra positional arguments through solvePhaseFor's five callers
  // would put two more slots on a signature that already has one optional trailing options object.
  const control=(opts&&opts.control)||null,memo=(opts&&opts.lpMemo)||null;
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
        if(RAWS.includes(it)){const t=craftTime(it,L);if(!(t>0))return;const es=effSpeed(ln.sp,t);vars.push({li,item:it,lvl:L,rate:(craftYield(it,L)/t)*es*ln.dp*3600,cons:[]});}
        else if(PRODUCTS.includes(it)){const ins=RECIPE[it].inputs;const tt=craftTime(it,L);if(!(tt>0))return;
          if(!hasRecipeCost(it,ins,L))return;
          const es=effSpeed(ln.sp,tt);
          /* recipeRate returns null for a cost no float64 can hold, and null*es*3600 is 0 — which
           * would schedule the craft as consuming nothing at all. Drop the level instead, exactly as
           * a missing cost is dropped: a craft whose inputs cannot be counted cannot be planned. */
          const perHr=ins.map(k=>recipeRate(S.prodCost[it][k][L],tt));
          if(perHr.some(rate=>rate===null||!Number.isFinite(rate*es*3600)))return;
          const cons=ins.map((k,ki)=>({item:k,perHr:perHr[ki]*es*3600}));
          const cfg=MINED_CRAFTS[it];
          if(cfg){if(!items.includes(cfg.resource))return;const c=minedCost(it,L)[cfg.resource];if(c==null||isNaN(c)||c<0)return;cons.push({item:cfg.resource,perHr:(c/tt)*es*3600});}
          vars.push({li,item:it,lvl:L,rate:(craftYield(it,L)/tt)*es*ln.dp*3600,cons});}
      });
    });
  });
  // Normalize demand to keep the LP coefficients sane. A Decimal, because the demand it is taken
  // from is one; the z-column division above lands back in float64.
  const D0=targets.reduce((peak,it)=>{const q=toDec0(net[it]);return q.gt(peak)?q:peak;},DEC_ONE);
  // Free (unconstrained) solve — the makespan-optimal assignment, ignoring what ran last time.
  const free=buildScheduleLP(vars,lns,items,net,avail,D0);
  const zCol=free.zCol,n=free.n;
  const freeSolution=solveScheduleLP(free,control,memo);
  // A run whose clock ran out inside the simplex holds a half-optimal vertex, not a verdict about
  // the factory. Reporting it as a schedule would publish "can't sustainably produce X" for items
  // the LP simply never got to price, so it reports no assignment and says why, exactly as the
  // Set & forget search does when its own budget stops it.
  if(freeSolution.interrupted)
    return {rate:{},plan:[],items:[],z:0,stabilized:false,zFree:null,zPin:null,stabilityKey:null,stabilityUpdate:null,
      evaluated:false,capped:true,interrupted:true,searchExhaustive:false};
  let y=freeSolution.x||new Float64Array(n);
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
          const pinSolution=solveScheduleLP(pin,control,memo);
          // A pinned solve the clock cut short holds a feasible but unproven vertex. Adopting it
          // would pin the plan to whatever the simplex had reached, so an interrupted pin simply
          // declines to stabilize and the free solve above stands.
          const y2=pinSolution.interrupted?null:pinSolution.x;
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
  // Float, not Decimal: these accumulate production with += below, and a Decimal there would
  // concatenate strings instead of adding. Rates are bounded by the lines, so a float always holds.
  const rate={};items.forEach(it=>rate[it]=supplyRate(forgieHr(it)));
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
function staticSchedule(net,targets,control,maxCompression,localDeadline){
  const rc=relevantChain(targets),D0=Math.max(1,...targets.map(item=>net[item]||0));
  const weights=targets.map(item=>Math.max(1e-12,(net[item]||0)/D0));
  const budget=boundedPersistedField("solveBudget",S.solveBudget,10000,200,60000,true);
  const solved=solveCore(targets,weights,rc.prods,rc.raws,budget,{tolOverride:0,control,maxCompression,localDeadline});
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
  // A search stopped by this phase's own deadline stopped because it ran out of time, exactly as a
  // shared-budget interruption does — it never proved the assignment does not exist. solveCore reports
  // the two separately (only a ROOT stop sets `interrupted`; a local cutoff sets localLimitReached),
  // so the local one has to be folded in here. Left out, an empty result off a spent slice is
  // indistinguishable from an exhaustive search and gets published as "can't sustainably produce".
  const cutShort=!!solved.interrupted||!!solved.localLimitReached;
  return {rate,plan,items:solved.resources,z:solved.feasible?solved.best.score:0,
    stabilized:false,zFree:null,zPin:null,stabilityKey:null,stabilityUpdate:null,
    compressionCeiling:maxCompression!=null&&Number.isFinite(Number(maxCompression))&&Number(maxCompression)>0
      ?Number(maxCompression):null,
    evaluated:!cutShort||!!solved.feasible,capped:!!solved.capped,
    interrupted:cutShort,searchExhaustive:!solved.capped&&!cutShort};
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
  const isStatic=!!(solveOptions&&solveOptions.static===true);
  // Set & forget spends the run control inside the discrete search; Line switching spends the same
  // control inside the schedule LP's pivots. Either way a phase that starts after the run is already
  // stopped returns no assignment rather than opening a search it cannot finish.
  const runControl=(isStatic?solveOptions&&solveOptions.control:solveOptions&&solveOptions.scheduleControl)||null;
  if(runControl&&runControl.isStopped())
    return {name,phaseKey:(phaseKey!=null?phaseKey:name),plan:[],balance:[],minedUsage:[],demandItems,net,rate:{},eta:0,bottleneck:null,infeasItems:[],unsat,blockedMined,atRisk:[],items:[],z:0,partial:false,feasible:false,stabilized:false,zFree:null,zPin:null,stabilityKey:null,stabilityUpdate:null,evaluated:false,capped:true,interrupted:true,searchExhaustive:false};
  let scheduleOptions=null;
  if(stabilityPolicy&&typeof stabilityPolicy==="object")scheduleOptions={...stabilityPolicy,phaseKey:(phaseKey!=null?phaseKey:name)};
  else if(stabilityPolicy===true)scheduleOptions={readStability:true,rememberStability:true,stabilityCache:cloneLineStability(_lineStability),phaseKey:(phaseKey!=null?phaseKey:name)};
  // stabilityRequested reads readStability/rememberStability only, so an options object carrying
  // just these two is inert to the stability pass — including for the ordering estimates and
  // warm-ups, which pass no policy at all and until now reached projectSchedule with no options.
  if(!isStatic&&solveOptions&&(solveOptions.scheduleControl||solveOptions.lpMemo))
    scheduleOptions=Object.assign({},scheduleOptions,{control:solveOptions.scheduleControl||null,lpMemo:solveOptions.lpMemo||null});
  const sch=isStatic
    ?staticSchedule(net,targets,solveOptions.control,solveOptions.maxCompression,solveOptions.localDeadline)
    :projectSchedule(net,targets,avail,scheduleOptions);
  const rate={};targets.forEach(it=>rate[it]=Math.max(0,sch.rate[it]||0));
  // "This factory can't sustainably produce X" is a claim about the LINES, and only a search that
  // actually finished can make it. A search cut short before it owned any assignment leaves every
  // target at zero rate, which looks identical — so it reports no verdict at all and the caller
  // surfaces the budget as the blocker (matching the stopped-before-starting return above).
  const evaluated=sch.evaluated!==false;
  let eta=0,bottleneck=null;const infeasItems=[];
  targets.forEach(it=>{if(rate[it]<=1e-9){if(evaluated)infeasItems.push(it);}else{const t=net[it]/rate[it];if(t>eta){eta=t;bottleneck=it;}}});
  const hasThroughput=sch.z>1e-15;
  const feasible=unsat.length===0&&infeasItems.length===0&&hasThroughput;
  const prodHr={},consHr={};sch.items.forEach(it=>{prodHr[it]=0;consHr[it]=0;});
  sch.plan.forEach(p=>p.entries.forEach(e=>{prodHr[e.item]=(prodHr[e.item]||0)+e.outHr;e.cons.forEach(c=>{consHr[c.item]=(consHr[c.item]||0)+c.hr;});}));
  const minedUsage=minedUsageFromProjectPlan(sch.plan);
  // Mined budgets are not craftable materials; their usage is displayed separately.
  // `stock` is the /hr an item is pulled from inventory (the deficit the LP left the drawdown term to cover);
  // in a project LP a shortfall is only ever legitimate stock drawdown, never a paper margin.
  const balance=sch.items.filter(it=>!MINED_RESOURCES.includes(it)).map(it=>{const prod=prodHr[it]||0,cons=consHr[it]||0,f=supplyRate(forgieHr(it));
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
    evaluated,capped:!!sch.capped,interrupted:!!sch.interrupted,searchExhaustive:sch.searchExhaustive!==false};
}
// Frames/Wire Bits are an external, pre-produced prerequisite. Reserve them before ordinary direct
// Bits demand; they never become a Project LP target and never earn a synthetic Bits line.
function phasePreProducedDemand(sub,invMap){
  const frames=decClampLow(toDec0(sub.Frames).sub(toDec0(invMap&&invMap.Frames)));
  const wire=decClampLow(toDec0(sub.Wire).sub(toDec0(invMap&&invMap.Wire)));
  const bits=frames.times(PREPROD_BITS.Frames).add(wire.times(PREPROD_BITS.Wire));
  return bits.gt(DEC_ZERO)?{Bits:bits}:{};
}
// Net ordinary demand for a project's level sum after reserving external pre-produced Bits.
/* Project demand and stock are quantities, so these vectors are Decimals. The arithmetic here is
   per item — twelve subtractions, not twelve per pivot — so carrying the range costs nothing that
   matters, and a project costing more than a float64 can hold nets out exactly. */
/* Carried stock floors at zero before it becomes demand. A replay accepts a balance that dips below
 * zero while it stays inside stockTol (issue #154 floored that residue on the way INTO the schedule
 * module; it still leaves through `finalInventory`, which the sequenced solver reads directly). Here
 * a debt does not merely fail to help — subtracting it MANUFACTURES demand: a -7.45e-9 Concrete
 * balance made `sub - inv` = +7.45e-9 for a project whose Concrete cost is 0, which cleared the flat
 * 1e-9 floor below, made Concrete a phase target the LP had no net rate left to give, and published
 * "Can't sustainably produce: Concrete" against a factory producing 9,076,608/hr of it. The verdict
 * flipped on one completed project level, because moving the subtraction by one float ULP is all it
 * takes. Floored at the point of use rather than at `finalInventory` on purpose: the Bits carry
 * feeds the pre-produced fixed point, whose own clamp already handles this, and flooring the map
 * wholesale stops that fixed point converging. */
function projNetVec(sub,invMap,preProducedDemand){
  const net={};ALLITEMS.forEach(it=>net[it]=decClampLow(toDec0(sub[it]).sub(decClampLow(toDec0(invMap&&invMap[it])))));
  const pp=toDec0((preProducedDemand||phasePreProducedDemand(sub,invMap)).Bits);
  const bitsLeft=decClampLow(toDec0(invMap&&invMap.Bits).sub(pp));
  net.Bits=decClampLow(toDec0(sub.Bits).sub(bitsLeft));
  return net;
}
// Stock available to DRAW DOWN for each item — the inventory left after covering the item's own
// direct project demand (projNetVec already nets that). For a raw/intermediate that's never a direct
// cost (e.g. Ingots) this is its whole stock; that stock feeds its consumers so they aren't produced
// from scratch (issue #73). External Bits are removed before direct Bits and recipe-feed availability.
function projAvailVec(sub,invMap,preProducedDemand){
  const av={};ALLITEMS.forEach(it=>av[it]=decClampLow(toDec0(invMap&&invMap[it]).sub(toDec0(sub[it]))));
  const pp=toDec0((preProducedDemand||phasePreProducedDemand(sub,invMap)).Bits);
  av.Bits=decClampLow(toDec0(invMap&&invMap.Bits).sub(pp).sub(toDec0(sub.Bits)));
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
/* Which line plan a RUN is solving, which is not always the one the user selected. Line switching
 * runs a second, non-switching candidate when its own plan needs a warm-up (see optimizeProjectTop),
 * and that candidate has to reach every site below without mutating S — the state object is shared
 * with the rest of the app and a solve that edited it would leave the setting changed behind it. */
function runIsStatic(runOptions){
  const override=runOptions&&runOptions.lineMode;
  return override?override==="static":S.projLineMode==="static";
}
function solveProjectBuffer(deficit,_inventory,info,runOptions){
  const signature=Object.keys(deficit).sort().map(it=>it+":"+deficit[it].toPrecision(12)).join("|");
  const warm=solvePhaseFor(deficit,"Warm-up: "+Object.keys(deficit).join(" + "),{},false,"warmup:"+(info&&info.depth||0)+":"+signature,
    {static:runIsStatic(runOptions),control:runOptions&&runOptions.staticControl,
      scheduleControl:runOptions&&runOptions.scheduleControl,lpMemo:runOptions&&runOptions.lpMemo,
      localDeadline:runOptions&&runOptions.staticPhaseDeadline});
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
  const isStatic=runIsStatic(runOptions);
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
        {static:isStatic,control:runOptions&&runOptions.staticControl,maxCompression,
          scheduleControl:runOptions&&runOptions.scheduleControl,lpMemo:runOptions&&runOptions.lpMemo,
          localDeadline:runOptions&&runOptions.staticPhaseDeadline});
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
/* ---------- idle lines in Set & forget: work this phase, then bank the next ----------
 * A solved static phase can leave a line with nothing to do — its demanded items are already
 * covered at the rate the phase is finishing them, so the dead-line pass idles it. A line standing
 * still for the whole phase is never the best a factory can do, so two passes go looking for work
 * for it, in the order that helps most:
 *
 *   1. THIS phase's own remaining demand. Every project material the phase is short of is worth
 *      arriving sooner, and when the search was cut short holding a plan that parked a line, putting
 *      that line back on the item the phase is waiting for makes the phase itself shorter.
 *   2. A LATER project's direct costs. With more projects still queued, cross-phase carry nets
 *      banked stock off their demand, so a line this phase genuinely cannot use banks ahead.
 *
 * "For free" is the whole contract, for both, and it is a claim about the PHASE. A filler may spend
 * only what the phase leaves unused after its own consumption and after the rate each demanded item
 * has to be met at TO LAND BY THE END OF THE PHASE. So no busy line moves, the phase's full demand is
 * still met, and its duration can only fall, never grow. What a filler may spend is the slack an item
 * that was finishing early represents: that item can come out later than it would have, never later
 * than the phase itself, in exchange for a line that was doing nothing at all. Each pass runs inside
 * a bounded allowance (see putIdleLinesToWork for which clock that comes off), and any fill is handed
 * back if the filled phase stops replaying.
 *
 * Frames and Wire are fillable like anything else, and a filler making either re-derives the phase's
 * external pre-produced Bits obligation before it is certified (adoptPhasePreProduced) — so the
 * reservation matches the plan being kept, and a fill that would leave the player owing Bits they do
 * not already hold is dropped rather than quietly billed. Banking is limited to DIRECT costs of a
 * later project: Set & forget deliberately does not let held stock remove a feeder job (projAvailVec
 * is dropped for static), so banking an intermediate would buy nothing.
 */
const LOOKAHEAD_ATTEMPT_WORK=150000;   // ceiling on one attempt, so a hopeless one gives up promptly
const LOOKAHEAD_PHASE_WORK=450000;     // ceiling on a phase's whole fill, however many it attempts
const LOOKAHEAD_PROJECT_ATTEMPTS=3;    // how far down the remaining queue one phase will look
// The own-demand pass is counted separately and allowed more per attempt: it targets ONE material at
// a time, so an attempt carries that material's whole input chain, and a chain as deep as Reinforced
// Concrete's spends the banking allowance before it owns a single assignment. Hopeless targets are
// screened out for free (idleLinesCouldMake), so a larger allowance is spent on targets that can
// actually be reached rather than on proving one that cannot.
const IDLE_WORK_ATTEMPT_WORK=250000;
const IDLE_WORK_PHASE_WORK=600000;
const IDLE_WORK_ROUNDS=4;              // how many times one phase re-solves whatever is still idle
const IDLE_WORK_TARGET_ATTEMPTS=4;     // how many of its own demanded items one round will try
// Ceiling on the wall-clock every fill in a run may spend between them: a quarter of the Project
// solve budget, floored at what one phase's whole work allowance costs on a slow, contended machine
// (measured at ~1s in a background Worker for the ~450k units above, against ~0.1s on an idle one).
//
// The fills cannot share the searches' control. A plan that parked a line is overwhelmingly the plan
// whose search ran out of clock, and a stopped control refuses every checkpoint after it — so the
// pass that exists to rescue a cut-short plan is exactly the pass a cut-short plan can never afford
// to run. Reserving part of the search budget instead was worse: a quality cut on every plan to fund
// a pass most of them never need, and on a starved run the difference between a rougher plan and no
// assignment at all. So the fills own a clock of their own, and a run can overrun the user's budget
// by this much — only ever to put a line back to work, and normally by a fraction of it, because the
// per-phase WORK allowances are what actually stop these searches. Work units, not wall-clock, are
// what keep the plan itself identical from machine to machine; this only bounds the waiting.
const STATIC_FILL_TIME_SHARE=0.25;
const STATIC_FILL_TIME_FLOOR=1200;
// One clock for every fill in a run, started on first use rather than at the top so a long search
// delays the fills instead of cancelling them. Per-phase work allowances, not this, are what divide
// it between phases: work units spend the same on every machine, wall-clock does not.
function idleWorkControl(runOptions){
  const holder=runOptions&&runOptions.idleWork;
  if(!holder||!(holder.budget>0))return null;
  if(!holder.control)holder.control=makeSolveControl(holder.budget,holder.options);
  return holder.control;
}
// Per-hour supply a solved static phase leaves genuinely spare: exogenous income plus what the busy
// lines make, less what they consume and less the rate the phase's own demand has to be met at.
// A feasible phase meets every one of those rates, so each entry is non-negative by construction.
function phaseSpareSupplyHr(ph){
  const spare={};
  ALLITEMS.forEach(it=>spare[it]=supplyRate(forgieHr(it)));
  MINED_RESOURCES.forEach(r=>{if(spare[r]==null)spare[r]=supplyRate(minedBudgetHr(r));});
  (ph.plan||[]).forEach(row=>(row.entries||[]).forEach(entry=>{
    spare[entry.item]=(spare[entry.item]||0)+(entry.outHr||0);
    (entry.cons||[]).forEach(input=>{spare[input.item]=(spare[input.item]||0)-(input.hr||0);});
  }));
  if(ph.eta>0)ALLITEMS.forEach(it=>{spare[it]=(spare[it]||0)-((ph.net&&ph.net[it]||0)/ph.eta);});
  Object.keys(spare).forEach(r=>{if(!(spare[r]>0))spare[r]=0;});
  return spare;
}
// One whole-phase filler entry in the rate shape every scheduler emits, or null when that level has
// no usable craft time or cost data.
function fillerEntry(line,item,lvl){
  const tt=craftTime(item,lvl);if(!(tt>0))return null;
  const es=effSpeed(line.sp,tt),cons=[];
  if(PRODUCTS.includes(item)){
    const ins=RECIPE[item].inputs;
    if(!hasRecipeCost(item,ins,lvl))return null;
    // Same null-is-not-zero rule as the schedule LP above: an uncountable cost is an unmakeable job.
    for(const k of ins){
      const perSec=recipeRate(S.prodCost[item][k][lvl],tt);
      if(perSec===null||!Number.isFinite(perSec*es*3600))return null;
      cons.push({item:k,hr:perSec*es*3600});
    }
    const cfg=MINED_CRAFTS[item];
    if(cfg){const cost=minedCost(item,lvl)[cfg.resource];if(cost==null||isNaN(cost)||cost<0)return null;
      cons.push({item:cfg.resource,hr:(cost/tt)*es*3600});}
  }else if(!RAWS.includes(item))return null;
  return {item,lvl,frac:1,outHr:(craftYield(item,lvl)/tt)*es*line.dp*3600,cons};
}
// Bank what the next project still needs and no more: walk each filler down to the smallest
// compression that still covers what is left, and drop one outright once the others already cover
// its item. Two things keep this honest. A filler's output can be another filler's INPUT (a Bricks
// line feeding a Reinforced Concrete line), so every downgrade and every drop is re-checked against
// the whole set's balance rather than just its own inputs. And what a fill actually banks is its
// NET contribution, so a line's own output is credited only after the fillers that eat it.
function trimFillersToDemand(picks,need,eta,spare){
  const ordered=picks.slice().sort((a,b)=>b.entry.outHr-a.entry.outHr||a.row.line-b.row.line);
  const chosen=ordered.map(pick=>pick.entry);
  const balances=()=>{
    const supply=Object.assign({},spare),demand={};
    chosen.forEach(entry=>{if(!entry)return;
      supply[entry.item]=(supply[entry.item]||0)+entry.outHr;
      entry.cons.forEach(input=>{demand[input.item]=(demand[input.item]||0)+input.hr;});});
    return Object.keys(demand).every(resource=>{const have=supply[resource]||0,want=demand[resource];
      return have>=want-1e-9*Math.max(1,have,want);});
  };
  const bankedExcept=(index,item)=>{
    let value=0;
    chosen.forEach((entry,i)=>{if(!entry||i===index)return;
      if(entry.item===item)value+=entry.outHr;
      entry.cons.forEach(input=>{if(input.item===item)value-=input.hr;});});
    return value*eta;
  };
  ordered.forEach((pick,index)=>{
    const item=pick.entry.item,remaining=(need[item]||0)-bankedExcept(index,item);
    if(!(remaining>1e-9)){
      chosen[index]=null;
      if(balances())return;
      chosen[index]=pick.entry;   // its output is feeding another filler — keep it
      return;
    }
    for(const level of LEVELS.filter(L=>L<pick.entry.lvl)){
      const candidate=fillerEntry(pick.line,item,level);
      if(!candidate||candidate.outHr*eta<remaining)continue;
      chosen[index]=candidate;
      if(balances())break;
      chosen[index]=pick.entry;
    }
  });
  return ordered.map((pick,index)=>chosen[index]?{line:pick.line,row:pick.row,entry:chosen[index]}:null).filter(Boolean);
}
// Rebuild the per-item readouts a filler moved. Mined budgets stay out of the craftable balance.
function refreshPhaseReadouts(ph){
  const seen=new Set(ph.items||[]);
  (ph.plan||[]).forEach(row=>(row.entries||[]).forEach(entry=>{
    seen.add(entry.item);(entry.cons||[]).forEach(input=>seen.add(input.item));}));
  ph.items=[...seen];
  const prodHr={},consHr={};
  (ph.plan||[]).forEach(row=>(row.entries||[]).forEach(entry=>{
    prodHr[entry.item]=(prodHr[entry.item]||0)+(entry.outHr||0);
    (entry.cons||[]).forEach(input=>{consHr[input.item]=(consHr[input.item]||0)+(input.hr||0);});}));
  ph.balance=ph.items.filter(it=>!MINED_RESOURCES.includes(it)).map(it=>{
    const prod=prodHr[it]||0,cons=consHr[it]||0,forgie=supplyRate(forgieHr(it));
    return {res:it,prod,forgie,cons,stock:Math.max(0,cons-prod-forgie)};});
  ph.minedUsage=minedUsageFromProjectPlan(ph.plan);
}
// Solve the lines a phase left idle — those and no others — against one set of targets, spending
// only the supply the phase leaves spare. Returns the whole-phase entries to add, empty when the
// attempt found nothing usable or was cut short.
function idleLineFillPicks(idleRows,targets,weights,spare,control,localWorkLimit,localDeadline){
  const byOrig={};sortedLines().forEach(line=>{byOrig[line.orig]=line;});
  const subset=idleRows.map(row=>row.line-1).filter(orig=>byOrig[orig]!=null);
  if(!subset.length||!targets.length||!(localWorkLimit>0))return [];
  const budget=boundedPersistedField("solveBudget",S.solveBudget,10000,200,60000,true);
  const chain=relevantChain(targets);
  const solved=solveCore(targets,weights,chain.prods,chain.raws,budget,
    {tolOverride:0,control,lineSubset:subset,supplyHr:spare,localWorkLimit,localDeadline});
  if(!solved.feasible||solved.interrupted)return [];
  const picks=[];
  for(let index=0;index<solved.sorted.length;index++){
    const line=solved.sorted[index],job=solved.lineJobs[index][solved.best.choice[index]];
    if(!job||job.kind==="idle"||!job.prod.length)continue;
    const row=idleRows.find(candidate=>candidate.line===line.orig+1);
    const entry=row?fillerEntry(line,job.res,job.lvl):null;
    if(entry)picks.push({line,row,entry});
  }
  return picks;
}
/* Could these lines make this item at all? A structural screen, run before any search is spent on a
 * target, and deliberately far too generous: it takes the least demanding job the idle lines could
 * run for the item — per input, across every line and level, so it may mix levels no single job has
 * — and then lets EVERY idle line devote itself to EVERY one of those inputs at once, on top of the
 * spare supply. No factory can run that assignment, which is exactly the point. A target that fails
 * even this cannot be reached by any assignment of these lines, so nothing is lost by skipping it,
 * and what is gained is the allowance it would have spent.
 *
 * That matters because the hopeless target is the expensive one. A search proves a target reachable
 * the moment it finds one plan, and proves it unreachable only by exhausting the space — so on this
 * factory the Batteries attempt, which cannot succeed while the Gel its line would need is four
 * times what the remaining lines can make, was burning a third of the phase's whole fill allowance
 * before the targets that CAN be helped got a look.
 *
 * Deeper requirements are ignored on purpose (an input's own inputs, two inputs competing for one
 * line): including them would make the bound tighter than the truth and start rejecting targets a
 * real assignment could reach.
 */
function idleLinesCouldMake(item,idleRows,spare){
  const byOrig={};sortedLines().forEach(line=>{byOrig[line.orig]=line;});
  const lines=idleRows.map(row=>byOrig[row.line-1]).filter(Boolean);
  if(!lines.length)return false;
  const cheapestInput={};let producible=false;
  lines.forEach(line=>LEVELS.filter(level=>level<=line.max).forEach(level=>{
    const entry=fillerEntry(line,item,level);
    if(!entry||!(entry.outHr>0))return;
    producible=true;
    entry.cons.forEach(input=>{
      const known=cheapestInput[input.item];
      if(known==null||input.hr<known)cheapestInput[input.item]=input.hr;
    });
  }));
  if(!producible)return false;
  return Object.keys(cheapestInput).every(input=>{
    const need=cheapestInput[input];
    if(!(need>0))return true;
    let available=Math.max(0,Number(spare&&spare[input])||0);
    if(!MINED_RESOURCES.includes(input))lines.forEach(line=>{
      let best=0;
      LEVELS.filter(level=>level<=line.max).forEach(level=>{
        const entry=fillerEntry(line,input,level);
        if(entry&&entry.outHr>best)best=entry.outHr;
      });
      available+=best;
    });
    return available>=need-1e-9*Math.max(1,available,need);
  });
}
/* A filler making Frames or Wire adds to the phase's EXTERNAL pre-produced Bits obligation — the
 * Bits those two burn outside the recipe graph, which the player has to have made before the phase
 * starts. solveExecutableProjectPhase closed that obligation as a fixed point before any fill ran, so
 * a fill changing it has to say so, and the numbers below are what say it.
 *
 * Re-deriving the obligation from the plan as it now stands (the same function the fixed point uses)
 * makes the reservation exact for the plan actually being kept. The replay then decides whether the
 * fill survives: reserving more Bits than the phase starts with is a shortfall it reports, and a fill
 * that would leave the player owing Bits they do not have is not free, so it is dropped. What it
 * cannot do is understate the cost — the reservation is recomputed before the phase is certified,
 * and only a certified phase reaches the plan.
 */
function adoptPhasePreProduced(ph){
  ph.preProducedDemand=Object.assign({},plannedPreProducedDemand(ph));
  return Number(ph.preProducedDemand.Bits)||0;
}
// What a phase's plan nets per hour, item by item: Lil' Forgie's income plus every assigned line's
// output, less every line's inputs. The same quantity solvePhaseFor reads off the scheduler,
// re-derived here because a fill changes the plan after that read.
function phasePlanRatesHr(ph){
  const rate={};ALLITEMS.forEach(item=>{rate[item]=supplyRate(forgieHr(item));});
  (ph.plan||[]).forEach(row=>(row.entries||[]).forEach(entry=>{
    if(rate[entry.item]!=null)rate[entry.item]+=entry.outHr||0;
    (entry.cons||[]).forEach(input=>{if(rate[input.item]!=null)rate[input.item]-=input.hr||0;});
  }));
  return rate;
}
// The phase's demanded items with the time each currently lands at, latest first — the order idle
// lines are worth putting to work in, so they go to what is holding the phase up rather than to
// whatever happens to be cheapest. Items whose mined chain is blocked never became targets and are
// left out, exactly as solvePhaseFor leaves them out.
function phaseDemandByFinish(ph,rate){
  return ALLITEMS.filter(item=>(ph.net&&ph.net[item]||0)>1e-9&&!(ph.blockedMined&&ph.blockedMined[item]))
    .map(item=>({item,finish:(rate[item]||0)>1e-9?(ph.net[item]||0)/rate[item]:Infinity}))
    .sort((a,b)=>b.finish-a.finish||(a.item<b.item?-1:a.item>b.item?1:0));
}
// Adopt the plan as it now stands: each demanded item finishes at its net demand over the rate the
// plan nets it at, and the phase is done when the last one lands. Refuses to write (returning false)
// if an item has lost its rate or the phase came out LONGER — a fill spending only spare supply can
// do neither, and a fill that somehow did is not one to keep.
function adoptPhasePlanFinish(ph){
  const rate=phasePlanRatesHr(ph),finishes=phaseDemandByFinish(ph,rate);
  if(finishes.some(entry=>!isFinite(entry.finish)))return false;
  const eta=finishes.length?finishes[0].finish:ph.eta;
  if(!(eta>=0)||!isFinite(eta)||eta>ph.eta+1e-9*Math.max(1,ph.eta))return false;
  const adopted={};Object.keys(ph.rate||{}).forEach(item=>{adopted[item]=Math.max(0,rate[item]||0);});
  ph.rate=adopted;ph.eta=eta;ph.bottleneck=finishes.length?finishes[0].item:null;
  return true;
}
// Put a static phase's idle lines on the phase's OWN remaining demand, latest-landing item first.
// Each round re-solves whatever is still idle against the spare the round before it left, so a fill
// that consumes an input is accounted for before the next line is handed out. Mutates ph.
function fillIdleLinesWithOwnDemand(ph,inventory,context,control,baseline,deadline){
  // Work units, not wall-clock: the allowance a fill spends has to be the same on every machine, or
  // the plan a user is shown would depend on how fast their laptop is.
  const spentAt=control?control.work():0,allowance=()=>IDLE_WORK_PHASE_WORK-(control?control.work()-spentAt:0);
  // An item the idle lines could not make is not worth proving unmakeable twice. A round only ever
  // takes supply away from the next one, and a fill that needed a second line already got both from
  // the same solve, so a second attempt at a refused item is the phase's whole allowance spent on the
  // one answer that cannot change — which is what leaves the rest of the lines parked.
  const refused=new Set();
  const worked=[];let shortened=false;
  for(let round=0;round<IDLE_WORK_ROUNDS;round++){
    if(allowance()<=0||(control&&(control.isStopped()||control.deadlineReached())))break;
    const idleRows=(ph.plan||[]).filter(row=>!row.entries||!row.entries.length);
    if(!idleRows.length)break;
    const spare=phaseSpareSupplyHr(ph);
    const before={eta:ph.eta,rate:ph.rate,bottleneck:ph.bottleneck,pre:ph.preProducedDemand};
    const owedBefore=Number(before.pre&&before.pre.Bits)||0;
    const candidates=phaseDemandByFinish(ph,phasePlanRatesHr(ph))
      .filter(candidate=>!refused.has(candidate.item)).slice(0,IDLE_WORK_TARGET_ATTEMPTS);
    let kept=null;
    for(const candidate of candidates){
      if(allowance()<=0)break;
      if(!idleLinesCouldMake(candidate.item,idleRows,spare)){refused.add(candidate.item);continue;}
      const picks=idleLineFillPicks(idleRows,[candidate.item],[1],spare,control,
        Math.min(allowance(),IDLE_WORK_ATTEMPT_WORK),deadline);
      if(!picks.length){refused.add(candidate.item);continue;}
      picks.forEach(pick=>{pick.row.entries.push(pick.entry);});
      // Free by construction, but a phase that stopped replaying would take the whole plan down with
      // it — certify before keeping the fill, and hand the lines back if anything trips. A fill that
      // owes MORE pre-produced Bits than the phase did has to be certified outright: "no worse than
      // the plan already was" is the right test for a fill that costs nothing, and the wrong one for
      // a fill that hands the player a bill.
      const owes=adoptPhasePreProduced(ph)>owedBefore+1e-9;
      const replays=adoptPhasePlanFinish(ph)&&
        (replayProjectSchedule([ph],inventory,context).ok===true||(!owes&&baseline.ok!==true));
      if(replays){kept=picks;break;}
      picks.forEach(pick=>{pick.row.entries.pop();});
      ph.eta=before.eta;ph.rate=before.rate;ph.bottleneck=before.bottleneck;ph.preProducedDemand=before.pre;
      refused.add(candidate.item);   // it solved, but the phase would not carry it
    }
    if(!kept)break;
    if(ph.eta<before.eta-1e-9*Math.max(1,before.eta))shortened=true;
    worked.push(...kept);
    refreshPhaseReadouts(ph);
  }
  if(!worked.length)return;
  ph.idleFill={lines:worked.map(pick=>pick.row.line).sort((a,b)=>a-b),
    items:[...new Set(worked.map(pick=>pick.entry.item))],shortened};
}
// Put a static phase's still-idle lines on the next project's direct costs. Mutates ph; a no-op
// whenever the phase, the budget, or the remaining demand makes banking unsafe.
function fillIdleLinesAhead(ph,laterProjects,inventory,context,control,deadline){
  if(control&&(control.isStopped()||control.deadlineReached()))return;
  const idleRows=(ph.plan||[]).filter(row=>!row.entries||!row.entries.length);
  if(!idleRows.length||!(laterProjects||[]).length)return;
  // The stock a later project would actually start from: replay this phase as it stands — pure
  // arithmetic, no warm-up solving — and net that result off each remaining project's costs in turn.
  const baseline=replayProjectSchedule([ph],inventory,context);
  const after=baseline.finalInventory||inventory;
  const spare=phaseSpareSupplyHr(ph);
  // The queue's next project isn't always the one these particular lines can help — a leftover
  // 256-cap line cannot start a Batteries chain. Walk the queue until one yields a usable fill,
  // bounded so a long shopping list can't turn one phase into an unbounded search.
  const spentAt=control?control.work():0,allowance=()=>LOOKAHEAD_PHASE_WORK-(control?control.work()-spentAt:0);
  let target=null,kept=null;
  for(const project of laterProjects.slice(0,LOOKAHEAD_PROJECT_ATTEMPTS)){
    if(allowance()<=0)break;
    const net=projNetVec(project.sub,after);
    const items=ALLITEMS.filter(it=>net[it]>1e-9);
    if(!items.length)continue;
    const D0=items.reduce((peak,it)=>{const q=toDec0(net[it]);return q.gt(peak)?q:peak;},DEC_ONE);
    const weights=items.map(it=>Math.max(1e-12,toDec0(net[it]).div(D0).toNumber()));
    const picks=idleLineFillPicks(idleRows,items,weights,spare,control,
      Math.min(allowance(),LOOKAHEAD_ATTEMPT_WORK),deadline);
    if(!picks.length)continue;
    const trimmed=trimFillersToDemand(picks,net,ph.eta,spare);
    if(trimmed.length){target=project;kept=trimmed;break;}
  }
  if(!kept)return;
  const pre=ph.preProducedDemand,owedBefore=Number(pre&&pre.Bits)||0;
  kept.forEach(pick=>{pick.row.entries.push(pick.entry);});
  ph.lookAhead={name:target.name,id:target.id||"",
    lines:kept.map(pick=>pick.row.line).sort((a,b)=>a-b),
    items:[...new Set(kept.map(pick=>pick.entry.item))]};
  // Additive by construction, but a phase that stopped replaying would take the whole plan down with
  // it — certify before keeping the fill, and hand the lines back if anything trips. Banking Frames
  // or Wire also moves the pre-produced Bits obligation, and a bank that leaves the player owing
  // Bits they do not have is not free, so that one has to certify outright rather than merely not
  // make a broken phase worse.
  const owes=adoptPhasePreProduced(ph)>owedBefore+1e-9;
  if(replayProjectSchedule([ph],inventory,context).ok!==true&&(owes||baseline.ok===true)){
    kept.forEach(pick=>{pick.row.entries.pop();});
    ph.preProducedDemand=pre;
    delete ph.lookAhead;
  }
  refreshPhaseReadouts(ph);
}
// Everything a static phase can do with the lines it left idle, in the order that helps most: its own
// remaining demand first (that can only make this phase shorter), then a later project's direct costs
// with whatever is still standing still. Every project sub-mode runs it — one combined phase, unlock
// waves, or one project at a time — because a dead line is dead in all three.
//
// Which clock it spends is the whole of the fairness question. Wall-clock is shared: every second a
// fill spends is a second the searches still to come are also racing. So while the run's own control
// has time, that is what a fill spends — exactly as banking ahead always did — and it spends only its
// own slice of the fill allowance, never whatever happens to be left. Once that control has stopped
// the fill falls back to its private clock, and only on the LAST phase, where there is no search left
// to starve. The phases are built in order, so a middle phase whose clock ran out keeps its parked
// lines rather than take the budget its successors need to produce any assignment at all.
function putIdleLinesToWork(ph,laterProjects,inventory,context,runOptions,phaseIndex,phaseCount){
  if(!runIsStatic(runOptions)||!ph||ph.feasible!==true||!(ph.eta>0))return;
  // A phase whose search was cut short is the one most likely to be holding a parked line, and its
  // plan is a replayed, feasible plan like any other — so it is filled like any other. Only a phase
  // that never received an assignment at all is skipped: there is nothing there to fill around.
  if(ph.evaluated===false)return;
  if(!(ph.plan||[]).some(row=>!row.entries||!row.entries.length))return;
  const index=Math.max(0,Number(phaseIndex)||0),count=Math.max(1,Number(phaseCount)||1);
  const holder=runOptions&&runOptions.idleWork,budget=holder&&holder.budget>0?holder.budget:0;
  const root=runOptions&&runOptions.staticControl;
  const control=(root&&!root.isStopped()&&!root.deadlineReached())
    ?root
    :(index>=count-1?idleWorkControl(runOptions):null);
  if(!control||control.isStopped()||control.deadlineReached())return;
  const deadline=budget>0?control.currentTime()+budget/Math.max(1,count-index):undefined;
  const baseline=replayProjectSchedule([ph],inventory,context);
  fillIdleLinesWithOwnDemand(ph,inventory,context,control,baseline,deadline);
  fillIdleLinesAhead(ph,laterProjects,inventory,context,control,deadline);
}
function buildProjectPhases(seq,net,perProject,stabilityPolicy,runOptions){
  const layer=unlockLayers(perProject);
  const maxL=perProject.length?Math.max.apply(null,layer):0;
  const invStart=()=>{const o={};ALLITEMS.forEach(it=>o[it]=toDec0(S.inventory&&S.inventory[it]));return o;};
  const context=projectScheduleContext(),executionPhases=[];
  let exactInventory=invStart(),scheduleBlocked=null;
  const solveBudgetFailure=()=>({kind:"solve-budget",time:0,deficit:0,
    message:"Set & forget search reached the Project solve limit before this phase received a usable assignment."});
  // One phase must not be able to spend the whole run's budget. The static search is anytime: it
  // keeps refining until its clock runs out, so with a single shared deadline the FIRST phase soaks
  // up everything and every phase behind it comes back with no assignment at all — which is a
  // blocked plan, not a slower one. The same save then solves or doesn't depending only on how busy
  // the machine happened to be. Each phase instead gets an equal share of what is LEFT, so a phase
  // that converges early hands its surplus to the ones behind it, and a phase that would have run
  // long returns its best incumbent at the cutoff instead of starving its successors.
  // currentTime(), not readNow(): slicing must not itself sample the clock. The phase that just
  // finished sampled it moments ago, which is accurate enough to divide the remainder by, and taking
  // a reading here would spend a tick of the user's budget on bookkeeping.
  const slicedRunOptions=(index,total)=>{
    const control=runOptions&&runOptions.staticControl;
    if(!control||!(total>1)||control.isStopped())return runOptions;
    const now=control.currentTime(),remaining=control.deadline-now;
    if(!(remaining>0))return runOptions;
    return Object.assign({},runOptions,{staticPhaseDeadline:now+remaining/Math.max(1,total-index)});
  };
  // Warm-ups are solves too, so they take their own fresh share of what is left rather than the
  // phase search's leftovers — a phase that used all of its slice can still be made startable.
  const executePhase=(ph,warmOptions)=>{
    if(scheduleBlocked)return;
    if(ph.evaluated===false){scheduleBlocked=solveBudgetFailure();return;}
    if(ph.preProducedConverged===false){scheduleBlocked=ph.preProducedFailure;return;}
    const control=runOptions&&runOptions.staticControl;
    // The warm-up solver reports budget exhaustion locally, so a retry can clear it. Nothing here
    // touches exactInventory or ph, which is what makes running it twice safe.
    const attempt=options=>{
      let outOfBudget=null;
      const built=buildExecutableProjectSchedule([ph],exactInventory,context,
        (deficit,inventory,info)=>{const warm=solveProjectBuffer(deficit,inventory,info,options);
          if(warm.evaluated===false&&!outOfBudget)outOfBudget=solveBudgetFailure();return warm;});
      return {built,outOfBudget};
    };
    let attempted=attempt(warmOptions||runOptions);
    // A slice is a fairness device, not a wall. If a phase could not be made startable inside its
    // share and the run still has time, let it finish on the shared clock — the allowance exists to
    // protect the phases behind it, not to fail a plan the budget could actually have covered.
    if(!attempted.built.validation.ok&&warmOptions&&warmOptions!==runOptions&&control&&!control.isStopped())
      attempted=attempt(runOptions);
    executionPhases.push(...attempted.built.phases);
    if(attempted.outOfBudget){scheduleBlocked=attempted.outOfBudget;return;}
    if(attempted.built.validation.ok)exactInventory=attempted.built.validation.finalInventory;
    else{
      // A warm-up the clock cut short is a budget problem, and saying so is actionable. Reporting it
      // as a warm-up failure reads as a broken recipe chain the user cannot do anything about.
      const failure=attempted.built.validation.firstFailure;
      scheduleBlocked=(failure&&failure.kind==="warmup"&&control&&control.isStopped())
        ?solveBudgetFailure():failure;
    }
  };
  if(!seq){
    // Single combined phase when nothing is gated, or when the user has turned unlock gating
    // off (projectGate===false) to craft the whole list at once, ignoring unlock waves.
    if(maxL===0||S.projectGate===false){
      const sumSub={};ALLITEMS.forEach(it=>sumSub[it]=perProject.reduce((s,p)=>s.add(toDec0(p.sub[it])),DEC_ZERO));
      const inv0=invStart();
      const combKey=perProject.length>1?perProject.map(p=>p.id).sort().join("+"):perProject[0].id;
      const ph=solveExecutableProjectPhase(sumSub,perProject.length>1?"All projects":perProject[0].name,inv0,stabilityPolicy,combKey,runOptions);
      ph.semanticIndex=0;ph.demandSub=sumSub;ph.invStart=inv0;
      // Nothing comes after the one phase, so there is nobody to bank for — but its own shopping list
      // is still the whole list, and an idle line can always be working on part of it.
      if(!scheduleBlocked)putIdleLinesToWork(ph,[],exactInventory,context,runOptions,0,1);
      ph.doneAt=ph.eta;executePhase(ph);return {phases:[ph],executionPhases,finalInventory:exactInventory,scheduleBlocked};
    }
    // unlocks force ordered "waves": combine within a layer, sequence the layers, carrying
    // crafted surplus forward as inventory so later waves only make what's still missing.
    let cum=0;const phases=[];
    const waves=[];
    for(let L=0;L<=maxL;L++){const members=perProject.filter((_,i)=>layer[i]===L);if(members.length)waves.push(members);}
    waves.forEach((members,index)=>{
      const sumSub={};ALLITEMS.forEach(it=>sumSub[it]=members.reduce((s,p)=>s.add(toDec0(p.sub[it])),DEC_ZERO));
      const inv0=Object.assign({},exactInventory);
      const ph=solveExecutableProjectPhase(sumSub,members.map(m=>m.name).join(" + "),exactInventory,stabilityPolicy,members.map(m=>m.id).sort().join("+"),slicedRunOptions(index,waves.length));
      ph.semanticIndex=phases.length;ph.members=members.map(m=>m.name);ph.demandSub=sumSub;ph.wave=phases.length+1;ph.invStart=inv0;
      // A wave's idle lines work its own list first, then bank for the waves still to come — the
      // unlock order is already fixed above, so neither can reshuffle anything.
      if(!scheduleBlocked)putIdleLinesToWork(ph,[].concat(...waves.slice(index+1)),exactInventory,context,
        slicedRunOptions(index,waves.length),index,waves.length);
      executePhase(ph,slicedRunOptions(index,waves.length));
      cum+=ph.eta;ph.doneAt=cum;phases.push(ph);
    });
    return {phases,executionPhases,finalInventory:exactInventory,scheduleBlocked};
  }
  // Sequenced: one project per phase, ordered by unlock layer, manual priority, then an estimated
  // completion time. Static phases do not draw held intermediates into their one-job assignment, so
  // omit that availability from the estimate instead of ranking in a stock world the actual phase
  // will not use. The estimate remains split-mode and cache-neutral; exact static work is budgeted
  // only for the selected executable phases below.
  const invInit=invStart();
  // The estimates are split-mode LPs in both line modes, so they take the run's tableau memo — and,
  // in Line switching, the run control that now bounds every other LP in the run. In Set & forget
  // the control belongs to the discrete search and these estimates stay off it, as they always have.
  const estimateOptions={scheduleControl:runOptions&&runOptions.scheduleControl,lpMemo:runOptions&&runOptions.lpMemo};
  const cost=perProject.map(p=>{const netDemand=projNetVec(p.sub,invInit),avail=runIsStatic(runOptions)?{}:projAvailVec(p.sub,invInit);
    const ph=solvePhaseFor(netDemand,p.name,avail,false,null,estimateOptions);return ph.feasible?ph.eta:Infinity;});
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
  order.forEach(({p},index)=>{
    const inv0=Object.assign({},exactInventory),sliced=slicedRunOptions(index,order.length);
    const ph=solveExecutableProjectPhase(p.sub,p.name,exactInventory,stabilityPolicy,p.id,sliced);
    ph.semanticIndex=phases.length;ph.prio=(p.prio!=null?p.prio:null);ph.demandSub=p.sub;ph.invStart=inv0;
    // Ordering above is settled before any of this, so a fill can never reshuffle the queue it is
    // banking for: it only puts lines this phase left idle to work on this project, then on what
    // comes next.
    if(!scheduleBlocked)putIdleLinesToWork(ph,order.slice(index+1).map(rest=>rest.p),exactInventory,context,sliced,index,order.length);
    executePhase(ph,slicedRunOptions(index,order.length));
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
  ALLITEMS.forEach(it=>forgieRates[it]=supplyRate(forgieHr(it)));
  MINED_RESOURCES.forEach(r=>minedIncomeRates[r]=supplyRate(minedBudgetHr(r)));
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
  const initialInventory={};ALLITEMS.forEach(it=>initialInventory[it]=toDec0(S.inventory&&S.inventory[it]));
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
  const projectBudget=boundedPersistedField("solveBudget",S.solveBudget,10000,200,60000,true);
  // One control per Project run, in BOTH line modes. Set & forget always had it; Line switching had
  // none at all, so its schedule LPs answered to nothing but a 20000-pivot ceiling per solve and a
  // run could spend unbounded time with no way for the user's solve-time setting to end it. The two
  // modes spend it in different places — the discrete search versus the LP pivots — so it is handed
  // down under the name of the path that consumes it, and each mode's other name stays null.
  const isStatic=S.projLineMode==="static";
  const projectControl=makeSolveControl(projectBudget,testOptions);
  const staticControl=isStatic?projectControl:null;
  // The searches spend the user's budget exactly as they always have; the fills spend a clock of
  // their own, started when the first of them runs. One holder, shared by every phase in the run.
  const runOptions={staticControl,scheduleControl:isStatic?null:projectControl,
    // Scoped to this call so the selected run and the hidden prefer-current comparison share the
    // tableaux they both derive, and so no plan can be answered out of a previous factory's memo.
    lpMemo:makeLpMemo(),
    idleWork:staticControl
      ?{budget:Math.max(projectBudget*STATIC_FILL_TIME_SHARE,STATIC_FILL_TIME_FLOOR),options:testOptions,control:null}
      :null};
  const selectedPolicy={readStability:projectStability==="prefer-current",rememberStability:true,stabilityCache:cacheSnapshot};
  let selected=solveProjectRun(seq,net,perProject,selectedPolicy,runOptions);selected.gross=gross;
  let stabilityComparison=null;
  if(projectStability==="prefer-current"&&selected.phases.some(ph=>ph.stabilized===true)){
    const alternative=solveProjectRun(seq,net,perProject,{readStability:false,rememberStability:false,stabilityCache:{}},runOptions);
    stabilityComparison=stabilityComparisonSummary(selected,alternative);
  }
  /* ---------- Line switching: the candidate the makespan LP cannot see ----------
   * The schedule LP balances a phase in AVERAGE rates: an entry holding a line for fraction f of the
   * phase contributes its output over the whole phase, so the LP prices it at outHr. Execution is
   * time-ordered — that entry runs alone for f of the phase, at outHr/f — and a job handed a small
   * enough fraction therefore consumes its inputs many times faster than the plan replenishes them.
   * The replay catches it and buildExecutableProjectSchedule prepends a warm-up to stock up first.
   *
   * That warm-up is real time the user waits, and `eta` counts it, but the LP that chose the plan
   * never saw it: it optimises `workEta` alone and reports itself exhaustive the moment the tableau
   * is optimal, with the run's budget almost untouched. So a phase can be handed a plan whose 8.5 h
   * of work carries 3.9 h of warm-up in front of it while a slower-on-paper plan needing none would
   * have finished the lot sooner.
   *
   * An assignment that never switches is the one shape immune to this: every entry runs the whole
   * phase, so its average rate IS its instantaneous rate and no warm-up can be induced. It is also
   * an ordinary point of the LP's own feasible region — one entry per line at frac 1 — which makes
   * it a candidate Line switching is entitled to return, not a different mode leaking in. Solving
   * for it costs the budget the LP left unspent, and only a complete run that REPLAYS and comes out
   * strictly shorter is taken, so this can lower the answer and never raise it.
   *
   * Set & forget searches these assignments already, which is why it can beat Line switching on a
   * factory with enough stock to tempt the LP into a fraction it cannot execute (issue #150). With
   * the candidate in hand the two modes are ordered again by construction: Line switching considers
   * everything Set & forget does, so it can never come out slower. */
  let staticSearchControl=staticControl;
  if(!isStatic&&projectRunExecutable(selected)&&selected.warmupEta>0){
    staticSearchControl=projectControl;
    // scheduleControl stays on the run control: the candidate solves its phases through the discrete
    // search, but the ordering estimates around it are split-mode LPs like any other and must remain
    // bounded by the user's solve-time setting rather than running off the books.
    const heldOptions=Object.assign({},runOptions,{lineMode:"static",staticControl:projectControl,
      idleWork:{budget:Math.max(projectBudget*STATIC_FILL_TIME_SHARE,STATIC_FILL_TIME_FLOOR),options:testOptions,control:null}});
    const held=solveProjectRun(seq,net,perProject,selectedPolicy,heldOptions);
    if(projectRunExecutable(held)&&held.eta<selected.eta-etaCompareEpsilon(selected.eta,held.eta)){
      held.gross=gross;held.noSwitchFallback=true;
      delete selected._stabilityUpdates;
      // The plan being returned switches no line, so the prefer-current comparison — which is a
      // statement about which line kept which job across an edit — has nothing left to describe.
      selected=held;stabilityComparison=null;
    }
  }
  if(projectRunExecutable(selected))commitLineStabilityUpdates(selected._stabilityUpdates,cacheSnapshot);
  delete selected._stabilityUpdates;
  selected.staticDeadlineReached=staticSearchControl?staticSearchControl.deadlineReached():false;
  selected.projectStability=projectStability;selected.stabilityComparison=stabilityComparison;selected.ms=performance.now()-t0;
  return selected;
}


/* `shard` is a real parameter and deliberately not a member of testOptions: testOptions is the
 * direct-source test seam and js/solver.js's own contract says it is never posted through the Worker
 * protocol, so routing a production wire field through it would make the seam load-bearing. */
function optimize(testOptions,shard){
  const slice=normalizeShard(shard);
  if(S.mode==="project")return optimizeProjectTop(testOptions,slice);
  // Gel is a native resource inside solveCore now (vespium is its budgeted input), so items and
  // credits need no reservation sweep — the solver allocates Gel lines like any other product.
  return optimizeInner(undefined,testOptions,slice);
}
