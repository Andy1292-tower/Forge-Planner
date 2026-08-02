"use strict";

// The Worker receives a complete accepted-state clone so the shared schema boundary can validate it.
// Only planStart and a Project card's disclosure state are removed from the separate equivalence key
// that decides whether an in-flight solve remains authoritative after accepted UI state changes.
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
  if(Array.isArray(snapshot.projects))snapshot.projects.forEach(project=>{if(project&&typeof project==="object")delete project._open;});
  return canonicalSolveJson(snapshot);
}

/* One authority owns asynchronous solve generations, the Worker, fallback timer, callback, and
 * overlay. Callers provide the exact accepted-state revision and snapshot they want solved; a
 * completion is delivered only while that mode/solve-equivalent state is still current. */
const solveService=(()=>{
  const MAX_FAILURES=3;
  const RETRY_BASE_MS=250;
  let generation=0;
  let expectedMode=null;
  let expectedRevision=null;
  let expectedKey=null;
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
  function clearRequest(){callback=null;expectedMode=null;expectedRevision=null;expectedKey=null;clearFallbackTimer();}
  function cancel(reason){
    generation+=1;
    lastReason=String(reason||"cancelled");
    clearRequest();
    terminateOwned();
    fallbackNotice(false,"");
    overlay(false);
    return status();
  }
  function deliver(requestGeneration,result,error){
    if(!isCurrent(requestGeneration)){cancel("accepted state changed before solve completion");return;}
    const done=callback;
    callback=null;
    expectedMode=null;
    expectedRevision=null;
    expectedKey=null;
    overlay(false);
    if(done)done(result,error||null);
  }
  function runFallback(requestGeneration,reason){
    fallbackNotice(true,reason);
    clearFallbackTimer();
    fallbackTimer=setTimeout(()=>{
      fallbackTimer=null;
      if(!isCurrent(requestGeneration)){cancel("accepted state changed before fallback");return;}
      let result;
      try{result=optimize();}
      catch(error){deliver(requestGeneration,null,(error&&error.stack)||String(error));return;}
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

    const requestGeneration=++generation;
    clearFallbackTimer();
    callback=done;expectedMode=mode;expectedRevision=revision;expectedKey=stateKey;
    overlay(true);

    // optimize() is synchronous inside the Worker. Superseding busy work requires termination;
    // a healthy idle Worker may be reused and receives a fresh stability snapshot below.
    if(workerBusy)terminateOwned();
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
