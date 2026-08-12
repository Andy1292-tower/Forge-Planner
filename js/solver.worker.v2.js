"use strict";
/* Web Worker: runs the optimizer off the main thread so a long solve (the user's max-solve-time
 * budget) never freezes the UI. Loads the same core + solver source the page uses; the page posts
 * a snapshot of the state and gets back the plain result object optimize() produces.
 *
 * The Worker imports the same field/schema boundary as the page; no unvalidated snapshot can
 * become the solver's global state. */
importScripts("core.js", "fields.js", "state.js", "project-schedule.js", "solver.js");

/* A shard descriptor names which slice of one request this Worker was handed. It is its own
 * top-level field rather than a widened reqId or budget because both of those are pinned to
 * something else below: reqId is asserted equal to generation, and budget is asserted equal to the
 * validated state's solveBudget, so neither can carry a per-shard value. Absent, every byte of this
 * exchange is what it was before shards existed. */
function shardDescriptorErrors(shard){
  const errors=[];
  if(!_plainObject(shard))return ["descriptor must be a plain object"];
  const keys=Object.keys(shard);
  if(keys.length!==2||!keys.includes("index")||!keys.includes("count"))errors.push("descriptor must carry exactly index and count");
  if(!Number.isInteger(shard.count)||shard.count<1)errors.push("count must be a positive integer");
  if(!Number.isInteger(shard.index)||shard.index<0)errors.push("index must be a non-negative integer");
  else if(Number.isInteger(shard.count)&&shard.index>=shard.count)errors.push("index must be below count");
  return errors;
}

self.onmessage = function (e) {
  const { reqId, generation, mode, stateRevision, state, budget, stab, shard } = e.data || {};
  /* Echoed on both replies so a merge layer can attribute a result or a failure to the shard that
   * produced it: the main thread matches on generation, and generation is identical across every
   * shard of one request. Only a descriptor that passed validation is echoed — sending an unusable
   * one back would hand the merge layer a shard id it must not trust. */
  let attributed = null;
  try {
    if(!Number.isInteger(reqId)||reqId<0)throw new Error("Worker request id is invalid");
    if(generation!==reqId)throw new Error("Worker generation is invalid");
    if(!Number.isInteger(stateRevision)||stateRevision<0)throw new Error("Worker state revision is invalid");
    // Ahead of the state: the descriptor says which shard this reply belongs to, and a rejected
    // state is exactly the reply a merge layer most needs to attribute.
    if(shard!==null&&shard!==undefined){
      const shardErrors=shardDescriptorErrors(shard);
      if(shardErrors.length)throw new Error("Worker shard descriptor rejected: "+shardErrors.join("; "));
      attributed={index:shard.index,count:shard.count};
    }
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
    if(attributed===null)self.postMessage({ reqId, generation, mode, stateRevision, res });
    else self.postMessage({ reqId, generation, mode, stateRevision, shard: attributed, res });
  } catch (err) {
    const message=err&&typeof err.message==="string"?err.message:String(err);
    const stack=err&&typeof err.stack==="string"?err.stack:"";
    if(attributed===null)self.postMessage({ reqId, generation, mode, stateRevision, error: {message,stack} });
    else self.postMessage({ reqId, generation, mode, stateRevision, shard: attributed, error: {message,stack} });
  }
};
