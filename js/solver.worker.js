"use strict";
/* Web Worker: runs the optimizer off the main thread so a long solve (the user's max-solve-time
 * budget) never freezes the UI. Loads the same core + solver source the page uses; the page posts
 * a snapshot of the state and gets back the plain result object optimize() produces.
 *
 * core.js touches localStorage/document only in functions the solve never calls (its load-time
 * load() swallows the missing-localStorage error), so it runs cleanly in a worker. */
importScripts("core.js", "solver.js");

self.onmessage = function (e) {
  const { reqId, state, budget } = e.data || {};
  try {
    S = state;                       // rebind the lexical S the solver closes over
    if (budget) S.solveBudget = budget;
    syncManual(S);
    const res = optimize();
    self.postMessage({ reqId, res });
  } catch (err) {
    self.postMessage({ reqId, error: (err && err.stack) || String(err) });
  }
};
