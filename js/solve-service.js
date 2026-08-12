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
  /* Parallel solving is opt-in per page load and off by default, so a reader who hits a pool bug
   * restores exact single-Worker behavior by clearing one storage key instead of waiting for a
   * release. Read once: a switch that flips mid-session would leave live Workers unaccounted for. */
  const POOL_FLAG_STORAGE_KEY="forgePlannerSolverPool";
  const POOL_MAX_SIZE=4;
  let poolEnabled=false;
  try{if(typeof localStorage!=="undefined")poolEnabled=localStorage.getItem(POOL_FLAG_STORAGE_KEY)==="on";}
  catch(error){poolEnabled=false;}
  // navigator is absent from the Node harnesses and from hosts that report no core count; both read
  // as a single slot rather than as an unbounded pool.
  function poolCap(){
    if(!poolEnabled)return 1;
    let cores=0;
    try{if(typeof navigator!=="undefined"&&navigator)cores=Math.floor(Number(navigator.hardwareConcurrency))||0;}
    catch(error){cores=0;}
    return Math.min(POOL_MAX_SIZE,Math.max(1,cores-1));
  }
  let generation=0;
  let expectedMode=null;
  let expectedRevision=null;
  let expectedKey=null;
  let expectedDailyCacheKey=null;
  let callback=null;
  let worker=null;
  let workerBusy=false;
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
  function fallbackNotice(show,reason){
    fallbackActive=show;
    if(reason)lastReason=String(reason);
    const el=document.getElementById("solveFallback");if(!el)return;
    el.hidden=!show;
    el.textContent=show?"Background solver unavailable; using slower fallback.":"";
  }
  function terminateOwned(){
    const owned=worker;worker=null;workerBusy=false;
    if(owned){
      try{owned.terminate();}catch(error){}
      try{if(typeof owned.__forgeRelease==="function")owned.__forgeRelease();}catch(error){}
    }
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
    terminateOwned();
    fallbackNotice(false,"");
    overlay(false);
    return status();
  }
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
  function workerFailed(owned,requestGeneration,reason){
    if(owned!==worker||requestGeneration!==generation)return;
    terminateOwned();
    workerFailures=Math.min(MAX_FAILURES,workerFailures+1);
    retryAfter=Date.now()+Math.min(1000,RETRY_BASE_MS*Math.pow(2,workerFailures-1));
    runFallback(requestGeneration,reason);
  }
  function bindWorker(owned){
    owned.onmessage=event=>{
      const data=event.data||{};
      if(owned!==worker||data.generation!==generation)return;
      if(!isCurrent(data.generation)){cancel("accepted state changed before Worker completion");return;}
      if(data.mode!==expectedMode||data.stateRevision!==expectedRevision){
        workerFailed(owned,data.generation,"Worker response did not match the requested mode and revision");
        return;
      }
      workerBusy=false;
      workerFailures=0;retryAfter=0;fallbackNotice(false,"");
      if(data.error){deliver(data.generation,null,data.error);return;}
      if(data.res&&data.res.__stab&&typeof setLineStability==="function"){
        setLineStability(data.res.__stab);delete data.res.__stab;
      }
      deliver(data.generation,data.res,null);
    };
    owned.onerror=event=>{
      if(owned!==worker)return;
      if(event&&typeof event.preventDefault==="function")event.preventDefault();
      if(!workerBusy||callback===null){terminateOwned();return;}
      if(!isCurrent(generation))return;
      workerFailed(owned,generation,(event&&event.message)||"Worker failed");
    };
  }
  function shouldTryWorker(){return (workerFactory!==defaultWorkerFactory||typeof Worker!=="undefined")&&Date.now()>=retryAfter;}
  function setWorkerFactory(factory){
    const next=factory==null?defaultWorkerFactory:factory;
    if(typeof next!=="function")throw new TypeError("solveService Worker factory must be a function or null");
    if(next===workerFactory)return status();
    cancel("Solver Worker factory changed");
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

    const dailyCacheKey=(mode==="items"||mode==="credits")?dailySolveConditionKey(dispatchedState):null;
    const requestGeneration=++generation;
    clearFallbackTimer();
    callback=done;expectedMode=mode;expectedRevision=revision;expectedKey=stateKey;expectedDailyCacheKey=dailyCacheKey;

    // optimize() is synchronous inside the Worker. Superseding busy work requires termination;
    // a healthy idle Worker may be reused and receives a fresh stability snapshot below.
    if(workerBusy)terminateOwned();
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

    try{
      if(!worker){worker=workerFactory();bindWorker(worker);}
      workerBusy=true;
      const stabilitySnapshot=(typeof getLineStability==="function")?JSON.parse(JSON.stringify(getLineStability()||{})):{};
      worker.postMessage({
        reqId:requestGeneration,generation:requestGeneration,mode,stateRevision:revision,
        state:dispatchedState,budget,stab:stabilitySnapshot
      });
    }catch(error){workerFailed(worker,requestGeneration,(error&&error.message)||String(error));}
    return requestGeneration;
  }
  function status(){
    return {
      generation,active:callback!==null,mode:expectedMode,stateRevision:expectedRevision,
      solveStateOwned:expectedKey!==null,
      current:callback!==null&&isCurrent(generation),
      workerOwned:worker!==null,workerBusy,workerFailures,fallbackActive,
      retryInMs:Math.max(0,retryAfter-Date.now()),lastReason
    };
  }

  return {request,cancel,status,setWorkerFactory};
})();
