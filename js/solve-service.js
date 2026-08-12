"use strict";

// The Worker receives a complete accepted-state clone so the shared schema boundary can validate it.
// Only planStart, a Project card's disclosure state, and the saved output sets are removed from the
// separate equivalence key that decides whether an in-flight solve remains authoritative after
// accepted UI state changes. Naming or deleting an output set leaves S.targets — the solved input —
// untouched, so it must not discard a solve that is already running.
function solveStateSnapshot(state){
  return JSON.parse(JSON.stringify(state||{}));
}
function canonicalSolveJson(value){
  if(Array.isArray(value))return "["+value.map(canonicalSolveJson).join(",")+"]";
  if(value&&typeof value==="object"){
    return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonicalSolveJson(value[key])).join(",")+"}";
  }
  return JSON.stringify(value);
}
function solveStateKey(state){
  const snapshot=solveStateSnapshot(state);
  delete snapshot.planStart;
  delete snapshot.targetSaved;
  delete snapshot.targetActiveId;
  if(Array.isArray(snapshot.projects))snapshot.projects.forEach(project=>{if(project&&typeof project==="object")delete project._open;});
  return canonicalSolveJson(snapshot);
}

/* Items and Credits solves can consume the full user budget even when nothing relevant changed.
 * Keep a small, separate daily cache keyed only by the inputs each mode actually reads. It never
 * enters the save/export schema, and every storage failure falls through to an ordinary solve. */
const DAILY_SOLVE_CACHE_VERSION=4;
// Retain the original storage key; the version invalidates pre-Credits records safely.
const DAILY_SOLVE_CACHE_STORAGE_KEY="forgePlannerMaxItemsCache_v1";
const DAILY_SOLVE_CACHE_AGE_MS=24*60*60*1000;
const DAILY_SOLVE_CACHE_ENTRIES=24;
const DAILY_SOLVE_CACHE_RECORD_CHARS=512*1024;
const DAILY_SOLVE_CACHE_TOTAL_CHARS=2*1024*1024;
let dailySolveCacheMemory=null;

function solveErrorPayload(error){
  if(error&&typeof error==="object"&&typeof error.message==="string"){
    return {message:error.message,stack:typeof error.stack==="string"?error.stack:""};
  }
  const stack=String(error==null?"Unknown solver failure":error);
  const firstUseful=stack.split(/\r?\n/).map(line=>line.trim()).find(line=>line&&!/(?:^|@)blob:/i.test(line)&&!/^at\s+/i.test(line))||"Unknown solver failure";
  return {message:firstUseful.replace(/^(?:Error|TypeError|RangeError):\s*/i,""),stack};
}

function dailySolveConditionKey(state){
  const source=state||{};
  const lines=Array.isArray(source.lines)?source.lines.map(line=>({
    max:line&&line.max,spx:line&&line.spx,turbo:line&&line.turbo
  })):[];
  const mode=source.mode==="credits"?"credits":"items";
  const projected={
    version:DAILY_SOLVE_CACHE_VERSION,mode,
    lines,maxTurbo:source.maxTurbo,dupe:source.dupe,margin:source.margin,
    solveBudget:source.solveBudget,baseTime:source.baseTime||{},
    prodCost:source.prodCost||{},forgie:source.forgie||{},minedIncome:source.minedIncome||{}
  };
  if(mode==="credits")projected.sellPrice=source.sellPrice||{};
  // The mix mode reads a different number off each target, so two states with identical `targets`
  // still solve to different plans under it. It belongs in the key beside them.
  else{projected.targets=source.targets||{};projected.targetMode=source.targetMode==="share"?"share":"ratio";}
  return canonicalSolveJson(projected);
}
function dailySolveConditionHash(value){
  let first=2166136261,second=2246822507;
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i);
    first=Math.imul(first^code,16777619)>>>0;
    second=Math.imul(second^code,3266489917)>>>0;
  }
  return first.toString(16).padStart(8,"0")+second.toString(16).padStart(8,"0");
}
function dailySolveJsonSafe(value,depth=0,budget){
  budget=budget||{nodes:0};
  if(++budget.nodes>50000||depth>16)return false;
  if(value===null||typeof value==="boolean")return true;
  if(typeof value==="number")return Number.isFinite(value);
  if(typeof value==="string")return value.length<=10000&&!/[<>]/.test(value);
  if(Array.isArray(value))return value.length<=5000&&value.every(item=>dailySolveJsonSafe(item,depth+1,budget));
  if(Object.prototype.toString.call(value)!=="[object Object]")return false;
  const keys=Object.keys(value);if(keys.length>5000)return false;
  return keys.every(key=>key.length<=200&&dailySolveJsonSafe(value[key],depth+1,budget));
}
function dailySolvePlanValid(result){
  let needsIndex=false;
  const valid=result.plan.every(row=>{
    if(!row||Object.prototype.toString.call(row)!=="[object Object]"||!row.job||
      Object.prototype.toString.call(row.job)!=="[object Object]")return false;
    const job=row.job;
    if(job.kind==="idle")return true;
    if((job.kind!=="produce"&&job.kind!=="craft")||typeof job.res!=="string"||
      !Number.isFinite(job.lvl)||!Number.isFinite(job.ct)||!Array.isArray(job.prod)||
      !job.prod.length||!Array.isArray(job.prod[0])||!Number.isFinite(job.prod[0][1])||
      !Array.isArray(job.cons))return false;
    if(job.cons.length)needsIndex=true;
    return job.cons.every(input=>Array.isArray(input)&&input.length>=2&&Number.isFinite(input[0])&&Number.isFinite(input[1]));
  });
  return valid&&(!needsIndex||Object.prototype.toString.call(result.resIndex)==="[object Object]");
}
function dailySolveConditionFromKey(conditionKey){
  if(typeof conditionKey!=="string"||conditionKey.length>DAILY_SOLVE_CACHE_RECORD_CHARS)return null;
  try{
    const condition=JSON.parse(conditionKey);
    if(!condition||Object.prototype.toString.call(condition)!=="[object Object]"||
      condition.version!==DAILY_SOLVE_CACHE_VERSION||
      (condition.mode!=="items"&&condition.mode!=="credits")||
      !dailySolveJsonSafe(condition)||canonicalSolveJson(condition)!==conditionKey)return null;
    return condition;
  }catch(error){return null;}
}
function dailySolveResultValid(result,conditionKey){
  if(!result||Object.prototype.toString.call(result)!=="[object Object]"||
    (result.mode!=="items"&&result.mode!=="credits"))return false;
  const condition=dailySolveConditionFromKey(conditionKey);
  if(!condition||condition.mode!==result.mode)return false;
  if(!dailySolveJsonSafe(result))return false;
  if(result.empty===true)return result.mode==="items";
  if(result.empty!==false||!Array.isArray(result.issues)||!Array.isArray(result.plan)||
    !Array.isArray(result.balance)||!result.issues.every(issue=>typeof issue==="string")||
    !Number.isFinite(result.ms)||result.ms<0||!dailySolvePlanValid(result))return false;
  // `bound` is optional so a cache written before it existed still replays; anything present must be
  // a usable ceiling, since the notice divides by it.
  if(result.mode==="items")return Array.isArray(result.targets)&&
    result.targets.every(target=>typeof target==="string")&&
    (result.bound==null||(Number.isFinite(result.bound)&&result.bound>=0))&&
    Object.prototype.toString.call(result.out)==="[object Object]";
  if(!Array.isArray(result.ranking)||result.ranking.length>100||
    (result.bestItem!==null&&typeof result.bestItem!=="string")||
    !Number.isFinite(result.credits)||result.credits<0||!Number.isFinite(result.objective)||result.objective<0||
    !Number.isFinite(result.tol)||typeof result.usesMargin!=="boolean"||typeof result.feasible!=="boolean"||
    typeof result.capped!=="boolean"||result.allCandidatesEvaluated!==true||
    typeof result.deadlineReached!=="boolean"||typeof result.searchExhaustive!=="boolean"||
    !Array.isArray(result.minedUsage)||Object.prototype.toString.call(result.resIndex)!=="[object Object]")return false;
  if(!condition.sellPrice||Object.prototype.toString.call(condition.sellPrice)!=="[object Object]")return false;
  const expectedPrices=new Map(Object.entries(condition.sellPrice)
    .filter(([,price])=>Number.isFinite(price)&&price>0));
  if(result.ranking.length!==expectedPrices.size)return false;
  const rankedItems=[];
  const valid=result.ranking.every(candidate=>{
    if(!candidate||Object.prototype.toString.call(candidate)!=="[object Object]"||
      typeof candidate.item!=="string"||rankedItems.includes(candidate.item)||!expectedPrices.has(candidate.item)||
      (candidate.kind!=="raw"&&candidate.kind!=="product")||
      !Number.isFinite(candidate.out)||candidate.out<0||candidate.price!==expectedPrices.get(candidate.item)||
      !Number.isFinite(candidate.credits)||candidate.credits<0||
      typeof candidate.feasible!=="boolean"||typeof candidate.usesMargin!=="boolean"||
      typeof candidate.capped!=="boolean"||candidate.evaluated!==true||!Number.isFinite(candidate.ms)||candidate.ms<0||
      !Array.isArray(candidate.plan)||!Array.isArray(candidate.balance)||!Array.isArray(candidate.minedUsage)||
      Object.prototype.toString.call(candidate.resIndex)!=="[object Object]")return false;
    rankedItems.push(candidate.item);
    return dailySolvePlanValid(candidate);
  });
  return valid&&(result.bestItem===null||rankedItems.includes(result.bestItem));
}
function dailySolveRecordValid(record,now){
  if(!record||record.version!==DAILY_SOLVE_CACHE_VERSION||typeof record.savedAt!=="number"||
    typeof record.id!=="string"||typeof record.conditionKey!=="string"||!dailySolveResultValid(record.result,record.conditionKey))return false;
  try{if(JSON.stringify(record).length>DAILY_SOLVE_CACHE_RECORD_CHARS)return false;}
  catch(error){return false;}
  const age=now-record.savedAt;
  return age>=0&&age<DAILY_SOLVE_CACHE_AGE_MS&&record.id===dailySolveConditionHash(record.conditionKey);
}
function loadDailySolveCache(now=Date.now()){
  if(dailySolveCacheMemory!==null)return dailySolveCacheMemory.filter(record=>dailySolveRecordValid(record,now));
  let entries=[];
  try{
    if(typeof localStorage!=="undefined"){
      const raw=localStorage.getItem(DAILY_SOLVE_CACHE_STORAGE_KEY);
      if(raw&&raw.length<=DAILY_SOLVE_CACHE_TOTAL_CHARS){
        const parsed=JSON.parse(raw);
        if(parsed&&parsed.version===DAILY_SOLVE_CACHE_VERSION&&Array.isArray(parsed.entries))entries=parsed.entries;
      }
    }
  }catch(error){entries=[];}
  dailySolveCacheMemory=entries.filter(record=>dailySolveRecordValid(record,now)).slice(0,DAILY_SOLVE_CACHE_ENTRIES);
  return dailySolveCacheMemory;
}
function persistDailySolveCache(entries){
  dailySolveCacheMemory=entries.slice(0,DAILY_SOLVE_CACHE_ENTRIES);
  if(typeof localStorage==="undefined")return false;
  let kept=dailySolveCacheMemory.slice();
  while(kept.length){
    let raw;
    try{raw=JSON.stringify({version:DAILY_SOLVE_CACHE_VERSION,entries:kept});}
    catch(error){return false;}
    if(raw.length>DAILY_SOLVE_CACHE_TOTAL_CHARS){kept.pop();continue;}
    try{localStorage.setItem(DAILY_SOLVE_CACHE_STORAGE_KEY,raw);dailySolveCacheMemory=kept;return true;}
    catch(error){kept.pop();}
  }
  try{localStorage.removeItem(DAILY_SOLVE_CACHE_STORAGE_KEY);}catch(error){}
  dailySolveCacheMemory=[];return false;
}
function readDailySolveCache(conditionKey,expectedMode,now=Date.now()){
  try{
    const id=dailySolveConditionHash(conditionKey);
    const record=loadDailySolveCache(now).find(entry=>entry.id===id&&entry.conditionKey===conditionKey&&entry.result.mode===expectedMode);
    if(!record)return null;
    return {savedAt:record.savedAt,result:JSON.parse(JSON.stringify(record.result))};
  }catch(error){return null;}
}
function removeDailySolveCache(conditionKey,now=Date.now()){
  try{return persistDailySolveCache(loadDailySolveCache(now).filter(entry=>entry.conditionKey!==conditionKey));}
  catch(error){return false;}
}
function writeDailySolveCache(conditionKey,result,now=Date.now()){
  try{
    const storedResult=JSON.parse(JSON.stringify(result));
    if(!dailySolveResultValid(storedResult,conditionKey)||storedResult.empty===true)return false;
    const record={version:DAILY_SOLVE_CACHE_VERSION,savedAt:now,id:dailySolveConditionHash(conditionKey),conditionKey,result:storedResult};
    if(JSON.stringify(record).length>DAILY_SOLVE_CACHE_RECORD_CHARS)return false;
    const entries=loadDailySolveCache(now).filter(entry=>entry.conditionKey!==conditionKey);
    return persistDailySolveCache([record,...entries]);
  }catch(error){return false;}
}

/* One authority owns asynchronous solve generations, the Worker, fallback timer, callback, and
 * overlay. Callers provide the exact accepted-state revision and snapshot they want solved; a
 * completion is delivered only while that mode/solve-equivalent state is still current. */
const solveService=(()=>{
  const MAX_FAILURES=3;
  const RETRY_BASE_MS=250;
  /* Parallel solving is opt-in per page load, so a reader who hits a pool bug restores exact
   * single-Worker behavior by setting one storage key instead of waiting for a release. The switch
   * is tri-state rather than a one-way opt-in: an explicit "on" or "off" wins and anything else
   * takes the default, so making the pool the default later is a one-constant change and the key
   * still turns it off afterwards. Read once, because a switch that flipped mid-session would
   * leave live Workers unaccounted for. */
  const POOL_FLAG_STORAGE_KEY="forgePlannerSolverPool";
  const POOL_DEFAULT_ON=false;
  const POOL_MAX_SIZE=4;
  /* Constructions the pool is allowed to make without anything to charge them to. Every disposal the
   * page asked for, and every one that abandoned work in flight, buys back the construction it costs
   * the next request; the one disposal that buys nothing is the unrated idle late-error branch in
   * bindWorker, so this grace is the whole budget that branch gets. Four rebuilds is a Worker that
   * dies every time rather than one that died once, and the pool stops rebuilding it. */
  const POOL_CONSTRUCTION_GRACE=4;
  let poolEnabled=POOL_DEFAULT_ON;
  try{
    if(typeof localStorage!=="undefined"){
      const flag=localStorage.getItem(POOL_FLAG_STORAGE_KEY);
      poolEnabled=flag==="on"?true:flag==="off"?false:POOL_DEFAULT_ON;
    }
  }catch(error){poolEnabled=POOL_DEFAULT_ON;}
  /* Rung 2 of the degradation ladder, in its two forms. poolDegraded is the recoverable one: the
   * pool ran out of healthy slots for a request, so it stops trying to be parallel until a Worker
   * delivers again. poolTripped is the tripwire and is not cleared, because what trips it is a
   * Worker that cannot survive its own delivery. */
  let poolTripped=false;
  let poolDegraded=false;
  function poolActive(){return poolEnabled&&!poolTripped&&!poolDegraded;}
  // navigator is absent from the Node harnesses and from hosts that report no core count; both read
  // as a single slot rather than as an unbounded pool.
  function poolCap(){
    if(!poolActive())return 1;
    let cores=0;
    try{if(typeof navigator!=="undefined"&&navigator)cores=Math.floor(Number(navigator.hardwareConcurrency))||0;}
    catch(error){cores=0;}
    return Math.min(POOL_MAX_SIZE,Math.max(1,cores-1));
  }
  // Sampled before anything can degrade the pool, so the construction ledger keeps one fixed base
  // for the page instead of a base that shrinks exactly when the ledger starts to matter.
  const POOL_CEILING=poolCap();
  let generation=0;
  let expectedMode=null;
  let expectedRevision=null;
  let expectedKey=null;
  let expectedDailyCacheKey=null;
  let callback=null;
  /* Slot records, not one owned Worker: {worker,busy}. Membership in this array is the identity a
   * late message or error is checked against, so a disposed Worker's events are ignored by the same
   * test whatever else the pool holds. */
  const pool=[];
  let poolConstructions=0;
  /* One counter per rung, because a rung that shares its counter with the rung below it cannot be
   * shown to have fired. slotFailures is rung 1 (one slot gave out and was dropped), poolFailures is
   * rung 2 (the pool had no healthy slot left for the request), workerFailures below is rung 3 (the
   * Worker mechanism itself is suspect and gets a cooldown), and rung 4 is runFallback. */
  let slotFailures=0;
  let poolFailures=0;
  let paidTerminations=0;
  let unratedDisposals=0;
  let fallbackTimer=null;
  let workerFailures=0;
  let retryAfter=0;
  let fallbackActive=false;
  let lastReason="";
  const defaultWorkerFactory=()=>new Worker("js/solver.worker.v2.js");
  let workerFactory=defaultWorkerFactory;

  function overlay(show){
    const el=document.getElementById("solveOverlay");if(el)el.hidden=!show;
    if(show){const stat=document.getElementById("solveStat");if(stat)stat.textContent="Solving plan…";}
  }
  /* Shown by runFallback and nowhere else. The string is a statement about this solve, and it is
   * true there because a request terminates busy slots before it dispatches and the failing slot is
   * gone by the time the fallback runs, so nothing is solving in the background when it appears.
   * The rungs above runFallback deliberately show nothing: degrading a pool to one slot changes how
   * fast an answer arrives, not where it comes from, and announcing an unavailable background solver
   * while other slots are still working would be false. */
  function fallbackNotice(show,reason){
    fallbackActive=show;
    if(reason)lastReason=String(reason);
    const el=document.getElementById("solveFallback");if(!el)return;
    el.hidden=!show;
    el.textContent=show?"Background solver unavailable; using slower fallback.":"";
  }
  function ownsSlot(slot){return pool.indexOf(slot)>=0;}
  function busySlots(){return pool.filter(slot=>slot.busy).length;}
  // Terminating a Worker never releases the payload URL: it is shared for the page's lifetime, so
  // revoking it here would break every Worker constructed after the first supersede.
  function removeSlot(slot){
    const at=pool.indexOf(slot);
    if(at<0)return false;
    pool.splice(at,1);
    slot.busy=false;
    try{slot.worker.terminate();}catch(error){}
    return true;
  }
  // A disposal the page asked for, or one that abandoned work in flight, pays for the construction
  // it forces on the next request. That is what keeps the ledger below blind to ordinary churn — a
  // supersede storm and a Manual-mode toggle loop both settle their own bill.
  function terminateSlot(slot){if(removeSlot(slot))paidTerminations+=1;}
  // Only work that is now obsolete is killed. An idle Worker costs nothing to keep and is the whole
  // reason a supersede constructs nothing.
  function terminateBusySlots(){pool.filter(slot=>slot.busy).forEach(slot=>terminateSlot(slot));}
  function terminatePool(){pool.slice().forEach(slot=>terminateSlot(slot));}
  /* The N7 tripwire, counting constructions rather than parallel solves. Counting parallel solves
   * would say nothing about a page that never had more than one Worker, which is exactly the page
   * the unrated idle disposal ruins: it costs a construction per request and rates nothing, so
   * constructions are the only quantity that moves. */
  function constructionAllowance(){return POOL_CEILING+paidTerminations+POOL_CONSTRUCTION_GRACE;}
  function tripPool(){if(poolTripped)return;poolTripped=true;poolFailures+=1;}
  /* An idle slot serves the request without constructing, so the ledger only gets a say when a
   * Worker actually has to be built — and refusing is what trips the pool, which is why this asks
   * and decides in one step. A tripped pool still lends out a Worker it already has; what it stops
   * is building more. */
  function poolCanServe(){
    if(pool.some(slot=>!slot.busy))return true;
    if(!poolTripped&&poolConstructions<constructionAllowance())return true;
    tripPool();
    return false;
  }
  /* The dispatching request terminates busy slots before it asks, so an idle slot is always waiting
   * or the pool is below its cap. An exhausted pool is unreachable today and degrades to the
   * synchronous fallback rather than growing past the cap. */
  function acquireSlot(){
    const idle=pool.find(slot=>!slot.busy);
    if(idle)return idle;
    if(pool.length>=poolCap())throw new Error("Solver Worker pool is exhausted");
    const slot={worker:workerFactory(),busy:false};
    poolConstructions+=1;
    pool.push(slot);
    bindWorker(slot);
    return slot;
  }
  function clearFallbackTimer(){
    if(fallbackTimer!==null){clearTimeout(fallbackTimer);fallbackTimer=null;}
  }
  function isCurrent(requestGeneration){
    return requestGeneration===generation&&expectedMode===S.mode&&expectedKey===solveStateKey(S);
  }
  function clearRequest(){callback=null;expectedMode=null;expectedRevision=null;expectedKey=null;expectedDailyCacheKey=null;clearFallbackTimer();}
  function cancel(reason){
    generation+=1;
    lastReason=String(reason||"cancelled");
    clearRequest();
    /* Pooling on: only the Workers still grinding on the cancelled generation are killed, and an
     * idle Worker stays for the next request to reuse — it has no obsolete work to abandon.
     * Pooling off: the whole pool goes, so a page with the switch cleared disposes Workers on
     * exactly the schedule the single-Worker service did. That is what makes the switch a rollback
     * rather than a sizing knob, since cancel() is reached from ordinary UI — every render in
     * Manual mode, import, rollback, and reset. */
    if(poolActive())terminateBusySlots();else terminatePool();
    fallbackNotice(false,"");
    overlay(false);
    return status();
  }
  // Teardown, not supersede: every Worker goes however the switch is set. A page being unloaded and
  // a factory swap both leave nothing a later request could legitimately reuse.
  function dispose(reason){cancel(reason);terminatePool();return status();}
  function deliver(requestGeneration,result,error,metadata){
    if(!isCurrent(requestGeneration)){cancel("accepted state changed before solve completion");return;}
    const done=callback;
    const dailyCacheKey=expectedDailyCacheKey;
    if(!error&&result&&dailyCacheKey&&!(metadata&&metadata.cached))writeDailySolveCache(dailyCacheKey,result);
    callback=null;
    expectedMode=null;
    expectedRevision=null;
    expectedKey=null;
    expectedDailyCacheKey=null;
    overlay(false);
    if(done)done(result,error||null,metadata||null);
  }
  function runFallback(requestGeneration,reason){
    fallbackNotice(true,reason);
    clearFallbackTimer();
    fallbackTimer=setTimeout(()=>{
      fallbackTimer=null;
      if(!isCurrent(requestGeneration)){cancel("accepted state changed before fallback");return;}
      let result;
      try{result=optimize();}
      catch(error){deliver(requestGeneration,null,solveErrorPayload(error));return;}
      deliver(requestGeneration,result,null);
    },0);
  }
  /* The degradation ladder, in order. Rung 1 attributes the failure to the slot and drops it, which
   * is all a failure means once work is sharded: the shard moves to a healthy slot and the rest of
   * the pool is untouched. Rung 2 fires only when the drop left no slot to move it to. Rung 3 is the
   * Worker mechanism's own rating, unchanged, and it is what makes the retry a cooldown rather than
   * a permanent verdict. Rung 4 is the synchronous fallback.
   *
   * A null slot is a construction that never produced one; it still costs the request a failure and
   * the fallback, which is what a factory that throws has always done.
   *
   * Rungs 1 and 2 are indistinguishable while the pool holds one slot, which is every page today:
   * one request occupies one slot, so dropping it always empties the pool. They separate as soon as
   * a request holds several. */
  function workerFailed(slot,requestGeneration,reason){
    if(requestGeneration!==generation||(slot&&!ownsSlot(slot)))return;
    if(slot){slotFailures+=1;terminateSlot(slot);}
    if(!pool.length){poolFailures+=1;poolDegraded=true;}
    workerFailures=Math.min(MAX_FAILURES,workerFailures+1);
    retryAfter=Date.now()+Math.min(1000,RETRY_BASE_MS*Math.pow(2,workerFailures-1));
    runFallback(requestGeneration,reason);
  }
  function bindWorker(slot){
    const owned=slot.worker;
    owned.onmessage=event=>{
      const data=event.data||{};
      if(!ownsSlot(slot)||data.generation!==generation)return;
      if(!isCurrent(data.generation)){cancel("accepted state changed before Worker completion");return;}
      if(data.mode!==expectedMode||data.stateRevision!==expectedRevision){
        workerFailed(slot,data.generation,"Worker response did not match the requested mode and revision");
        return;
      }
      slot.busy=false;
      workerFailures=0;retryAfter=0;poolDegraded=false;fallbackNotice(false,"");
      if(data.error){deliver(data.generation,null,data.error);return;}
      if(data.res&&data.res.__stab&&typeof setLineStability==="function"){
        setLineStability(data.res.__stab);delete data.res.__stab;
      }
      deliver(data.generation,data.res,null);
    };
    owned.onerror=event=>{
      if(!ownsSlot(slot))return;
      if(event&&typeof event.preventDefault==="function")event.preventDefault();
      /* Unrated on purpose: a late error with no request behind it must not count against the Worker
       * mechanism or arm a backoff, because nothing was lost and the next request is entitled to a
       * Worker. Unrated is not free — it is the one disposal that pays for nothing, so it is drawn
       * against the pool's construction allowance instead of against workerFailures. */
      if(!slot.busy||callback===null){if(removeSlot(slot))unratedDisposals+=1;return;}
      if(!isCurrent(generation))return;
      workerFailed(slot,generation,(event&&event.message)||"Worker failed");
    };
  }
  function shouldTryWorker(){return (workerFactory!==defaultWorkerFactory||typeof Worker!=="undefined")&&Date.now()>=retryAfter;}
  function setWorkerFactory(factory){
    const next=factory==null?defaultWorkerFactory:factory;
    if(typeof next!=="function")throw new TypeError("solveService Worker factory must be a function or null");
    if(next===workerFactory)return status();
    // A Worker built by the previous factory is not a Worker the new factory would have produced,
    // so none of them may be reused however the pool switch is set.
    dispose("Solver Worker factory changed");
    workerFactory=next;
    return status();
  }
  function request(options,done){
    const mode=options&&options.mode;
    const revision=options&&options.stateRevision;
    const budget=options&&options.budget;
    const stateSnapshot=options&&options.stateSnapshot;
    if(typeof mode!=="string"||!Number.isInteger(revision)||!stateSnapshot||typeof done!=="function"){
      throw new TypeError("solveService.request requires mode, stateRevision, stateSnapshot, and callback");
    }
    const dispatchedState=solveStateSnapshot(stateSnapshot);
    const stateKey=solveStateKey(dispatchedState);
    if(options.solveKey!==undefined&&options.solveKey!==stateKey){
      throw new TypeError("solveService.request solveKey must describe the dispatched state snapshot");
    }
    /* Rejected here as well as in the Worker, for two different reasons: the Worker cannot trust
     * anything that arrives over the wire, and a caller that built a shard wrong should hear about
     * it before it costs a Worker round trip. A caller with nothing to shard passes nothing, and
     * the dispatched message is byte-for-byte the one the single-Worker service sent. */
    const shard=options.shard===undefined||options.shard===null?null:options.shard;
    if(shard!==null&&!(Object.prototype.toString.call(shard)==="[object Object]"&&
      Object.keys(shard).length===2&&Number.isInteger(shard.index)&&Number.isInteger(shard.count)&&
      shard.count>=1&&shard.index>=0&&shard.index<shard.count)){
      throw new TypeError("solveService.request shard must be {index,count} with 0 <= index < count");
    }

    const dailyCacheKey=(mode==="items"||mode==="credits")?dailySolveConditionKey(dispatchedState):null;
    const requestGeneration=++generation;
    clearFallbackTimer();
    callback=done;expectedMode=mode;expectedRevision=revision;expectedKey=stateKey;expectedDailyCacheKey=dailyCacheKey;

    // optimize() is synchronous inside the Worker. Superseding busy work requires termination;
    // a healthy idle Worker may be reused and receives a fresh stability snapshot below.
    terminateBusySlots();
    if(dailyCacheKey&&options.forceFresh===true)removeDailySolveCache(dailyCacheKey);
    if(dailyCacheKey&&options.forceFresh!==true){
      const cached=readDailySolveCache(dailyCacheKey,mode);
      if(cached){lastReason="Daily solve cache hit";deliver(requestGeneration,cached.result,null,{cached:true,savedAt:cached.savedAt});return requestGeneration;}
    }
    overlay(true);
    if(!shouldTryWorker()){
      runFallback(requestGeneration,typeof Worker==="undefined"?"Worker is unavailable":"Worker retry is cooling down");
      return requestGeneration;
    }
    /* Checked here rather than inside acquireSlot: a slot the ledger declines is not a failure of
     * this request's Worker, and routing it through workerFailed would rate a Worker that was never
     * built and arm a cooldown that cannot fix anything. */
    if(!poolCanServe()){
      runFallback(requestGeneration,"Solver Workers were rebuilt more often than the pool can account for");
      return requestGeneration;
    }

    let slot=null;
    try{
      slot=acquireSlot();
      slot.busy=true;
      const stabilitySnapshot=(typeof getLineStability==="function")?JSON.parse(JSON.stringify(getLineStability()||{})):{};
      const message={
        reqId:requestGeneration,generation:requestGeneration,mode,stateRevision:revision,
        state:dispatchedState,budget,stab:stabilitySnapshot
      };
      if(shard!==null)message.shard={index:shard.index,count:shard.count};
      slot.worker.postMessage(message);
    }catch(error){workerFailed(slot,requestGeneration,(error&&error.message)||String(error));}
    return requestGeneration;
  }
  function status(){
    return {
      generation,active:callback!==null,mode:expectedMode,stateRevision:expectedRevision,
      solveStateOwned:expectedKey!==null,
      current:callback!==null&&isCurrent(generation),
      workerOwned:pool.length>0,workerBusy:busySlots()>0,workerFailures,fallbackActive,
      retryInMs:Math.max(0,retryAfter-Date.now()),lastReason,
      // poolEnabled reports whether the pool is parallel now, not what the switch said at load:
      // a degraded or tripped pool is a pool of one however the reader set the key.
      poolEnabled:poolActive(),poolSize:pool.length,poolBusy:busySlots(),poolConstructions,
      poolTripped,poolSlotFailures:slotFailures,poolFailures,poolUnratedDisposals:unratedDisposals
    };
  }

  return {request,cancel,dispose,status,setWorkerFactory};
})();
