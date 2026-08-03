"use strict";
/* Web Worker: runs the optimizer off the main thread so a long solve (the user's max-solve-time
 * budget) never freezes the UI. Loads the same core + solver source the page uses; the page posts
 * a snapshot of the state and gets back the plain result object optimize() produces.
 *
 * The Worker imports the same field/schema boundary as the page; no unvalidated snapshot can
 * become the solver's global state. */
importScripts("core.js", "fields.js", "state.js", "project-schedule.js", "solver.js");

self.onmessage = function (e) {
  const { reqId, generation, mode, stateRevision, state, budget, stab } = e.data || {};
  try {
    if(!Number.isInteger(reqId)||reqId<0)throw new Error("Worker request id is invalid");
    if(generation!==reqId)throw new Error("Worker generation is invalid");
    if(!Number.isInteger(stateRevision)||stateRevision<0)throw new Error("Worker state revision is invalid");
    const checked=validateWorkerState(state);
    if(!checked.ok)throw new Error("Worker state rejected: "+checked.errors.join("; "));
    if(mode!==checked.state.mode)throw new Error("Worker mode does not match the validated state");
    if(budget!==undefined&&budget!==checked.state.solveBudget)throw new Error("Worker budget does not match the validated state");
    if(stab!==null&&stab!==undefined){
      const stabilityErrors=[];
      if(!_plainObject(stab))stabilityErrors.push("stability cache must be a plain object");
      else _scanStructure(stab,stabilityErrors);
      if(stabilityErrors.length)throw new Error("Worker stability cache rejected: "+stabilityErrors.join("; "));
    }
    commitState(checked.state);       // rebind the lexical S the solver closes over
    // Seed a reused Worker's line-stability cache from the main thread's latest copy, then return
    // the updated cache so the next solve can pin to it (issue #87).
    if (typeof setLineStability === "function") setLineStability(stab || {});
    const res = optimize();
    if (res && typeof getLineStability === "function") res.__stab = getLineStability();
    self.postMessage({ reqId, generation, mode, stateRevision, res });
  } catch (err) {
    const message=err&&typeof err.message==="string"?err.message:String(err);
    const stack=err&&typeof err.stack==="string"?err.stack:"";
    self.postMessage({ reqId, generation, mode, stateRevision, error: {message,stack} });
  }
};
