"use strict";
/* The simplex's two entering rules, and the restart that makes the fast one safe (Node).
 *
 * Bland's rule is what every recorded plan was produced under and is the default. Dantzig's
 * most-negative rule is available through lpMaximize's own options and reaches the same optimum in
 * far fewer pivots — when it reaches it at all. It has no anti-cycling guarantee and, on these
 * tableaux, no numerical one: every tolerance in the loop is absolute and unscaled while b spans 1.0
 * to 1e100 on the reference factory (a Vespium rig income), so the ratio tie-break degrades to
 * "first eligible row wins".
 *
 * It is therefore a speculative ATTEMPT, not a switch. It runs under a pivot budget, aborts on a
 * falling objective row, a basic variable that went negative, an unboundedness claim it is not
 * allowed to make, or a finished solve that fails to certify — and an abort throws the tableau away
 * and re-solves the CALLER'S UNTOUCHED arrays under Bland. What is pinned here is that the caller
 * can never tell: on this corpus of real captured tableaux, every answer lpMaximize returns is
 * Bland's answer, bit for bit, whether the attempt ran or not.
 *
 * The certificate is checked against (c,A,b) rather than against the tableau, because the tableau is
 * the thing that may have been bent. A pivot-magnitude abort trigger was measured here first and
 * rejected: over the corpus the chosen element runs as low as 2.5e-30 of its own column on solves
 * whose objective still agrees with Bland's to 1e-16, so no threshold separates a bad pivot from a
 * good one. Primal feasibility, dual feasibility and equal objectives do.
 *
 * Usage: node test/lp-pivot.cjs
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { materialize, fixtureById } = require("./perf/corpus.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCES = ["js/decimal.js", "js/catalog.js", "js/core.js", "js/fields.js", "js/state.js", "js/project-schedule.js", "js/solver.js"];

// Small enough that a capture run is seconds, large enough that every fixture reaches its LPs: the
// relaxation and the schedule LP are both built before any budget-sensitive refinement.
const CAPTURE_BUDGET_MS = 200;
const CAPTURE_FIXTURES = ["items-7line", "credits-7line", "project-split-7line"];

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + name + (detail ? " [" + detail + "]" : ""));
  if (!ok) failures++;
}

function realm() {
  const context = vm.createContext({
    console, performance, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => ({ innerHTML: "", textContent: "" }) },
  });
  for (const file of SOURCES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  }
  return context;
}

/* ---- capture the tableaux the app actually builds ------------------------------------------ */

/* Captured rather than committed as a blob: a frozen corpus of numbers stops describing the solver
 * the moment either builder changes, and the point of this test is the tableaux the app produces. */
const CAPTURE = `
(function(){
  var raw=lpMaximize;
  __captured=[];__ruleSeen=[];
  lpMaximize=function(c,A,b,control,opts){
    __captured.push({c:Array.from(c),A:A.map(function(row){return Array.from(row);}),b:Array.from(b)});
    __ruleSeen.push(opts&&opts.pivotRule||"(default)");
    return raw(c,A,b,control,opts);
  };
})();
`;

const captured = [];
const rulesSeen = new Set();
for (const id of CAPTURE_FIXTURES) {
  const context = realm();
  context.__stateJson = JSON.stringify(materialize(fixtureById(id), { budgetMs: CAPTURE_BUDGET_MS }));
  vm.runInContext(`
    (function(){
      var checked=validateWorkerState(JSON.parse(__stateJson));
      if(!checked.ok)throw new Error("fixture rejected: "+checked.errors.join("; "));
      commitState(checked.state);
    })()
  `, context, { filename: "lp-pivot-load" });
  vm.runInContext(CAPTURE, context, { filename: "lp-pivot-capture" });
  let clock = 0;
  context.__testOptions = { now: () => (clock += 0.05) };
  vm.runInContext("optimize(__testOptions);", context, { filename: "lp-pivot-solve" });
  const batch = JSON.parse(vm.runInContext("JSON.stringify({t:__captured,r:__ruleSeen});", context, { filename: "lp-pivot-read" }));
  batch.t.forEach((tableau, index) => captured.push(Object.assign({ fixture: id }, tableau)));
  batch.r.forEach(rule => rulesSeen.add(rule));
}

check("the capture reached the LPs of every fixture it ran",
  captured.length >= CAPTURE_FIXTURES.length &&
  CAPTURE_FIXTURES.every(id => captured.some(tableau => tableau.fixture === id)),
  captured.length + " tableaux from " + [...new Set(captured.map(t => t.fixture))].join(", "));
check("no call site asks for the speculative rule today",
  rulesSeen.size === 1 && rulesSeen.has("(default)"),
  "rules requested: " + [...rulesSeen].join(", "));

/* ---- replay each captured tableau under both rules ----------------------------------------- */

const bench = realm();
bench.__tableaux = captured.map(tableau => ({ c: tableau.c, A: tableau.A, b: tableau.b }));
const REPLAY = `
(function(){
  var out=[];
  for(var k=0;k<__tableaux.length;k++){
    var t=__tableaux[k],c=t.c,A=t.A,b=t.b;
    // A snapshot of the caller's arrays: an aborted attempt must leave them exactly as they were,
    // or the fallback is not re-solving the pristine problem it claims to.
    var beforeC=c.slice(),beforeA=A.map(function(r){return r.slice();}),beforeB=b.slice();
    var count=function(){var n=0;return {control:{__forgeSolveControl:true,
      checkpoint:function(label){if(label==="lp-pivot")n++;return true;}},read:function(){return n;}};};
    var mB=count(),mD=count(),mR=count();
    var bland=lpSimplexSolve(c,A,b,mB.control,false);
    var dantzig=lpSimplexSolve(c,A,b,mD.control,true);
    var routed=lpMaximize(c,A,b,mR.control,{pivotRule:"dantzig"});
    var pristine=true;
    for(var j=0;j<c.length&&pristine;j++)pristine=beforeC[j]===c[j];
    for(var i=0;i<A.length&&pristine;i++){
      if(beforeB[i]!==b[i]){pristine=false;break;}
      for(var q=0;q<A[i].length;q++)if(beforeA[i][q]!==A[i][q]){pristine=false;break;}
    }
    var dot=function(x){var s=0;for(var j=0;j<c.length;j++)s+=c[j]*x[j];return s;};
    var identical=!!routed.x&&!!bland.x&&routed.x.length===bland.x.length;
    for(var j=0;j<(identical?bland.x.length:0);j++)if(routed.x[j]!==bland.x[j]){identical=false;break;}
    out.push({n:c.length,m:A.length,
      blandComplete:!!bland.complete,blandPivots:mB.read(),blandObj:bland.x?dot(bland.x):null,
      dantzigAborted:!!dantzig.aborted,dantzigComplete:!!dantzig.complete,dantzigPivots:mD.read(),
      dantzigObj:dantzig.x?dot(dantzig.x):null,
      routedPivots:mR.read(),routedAborted:!!routed.aborted,routedMatchesBland:identical,pristine:pristine});
  }
  return out;
})()
`;
const replayed = vm.runInContext(REPLAY, bench, { filename: "lp-pivot-replay" });

const rel = (a, b) => (Math.abs(a - b) / Math.max(1, Math.abs(b)));
const completed = replayed.filter(row => !row.dantzigAborted);
const aborted = replayed.filter(row => row.dantzigAborted);

check("Bland solves every captured tableau to completion",
  replayed.every(row => row.blandComplete && row.blandObj !== null),
  replayed.length + " tableaux, largest " +
  Math.max(...replayed.map(row => row.n)) + " columns x " + Math.max(...replayed.map(row => row.m)) + " rows");

check("where the speculative rule finishes, it finishes at Bland's optimum",
  completed.every(row => row.dantzigComplete && rel(row.dantzigObj, row.blandObj) <= 1e-9),
  completed.length + " completed, worst relative objective gap " +
  (completed.length ? Math.max(...completed.map(row => rel(row.dantzigObj, row.blandObj))).toExponential(3) : "n/a"));

check("where it finishes, it costs fewer pivots than Bland in total",
  completed.length > 0 &&
  completed.reduce((sum, row) => sum + row.dantzigPivots, 0) < completed.reduce((sum, row) => sum + row.blandPivots, 0),
  "dantzig " + completed.reduce((sum, row) => sum + row.dantzigPivots, 0) +
  " vs bland " + completed.reduce((sum, row) => sum + row.blandPivots, 0) + " pivots over " + completed.length + " tableaux");

// If this stops firing the restart is untested, not unnecessary: the corpus has to keep a tableau
// the attempt refuses, or the fallback below is proving nothing.
check("the corpus still contains a tableau the speculative rule refuses",
  aborted.length > 0,
  aborted.length + " of " + replayed.length + " aborted" +
  (aborted.length ? " (largest " + Math.max(...aborted.map(row => row.n)) + " columns)" : ""));

check("an aborted attempt leaves the caller's c, A and b untouched",
  replayed.every(row => row.pristine), replayed.filter(row => !row.pristine).length + " tableaux mutated");

check("lpMaximize never surfaces an abort to its caller",
  replayed.every(row => !row.routedAborted && row.routedPivots > 0),
  replayed.filter(row => row.routedAborted).length + " of " + replayed.length + " leaked an abort");

check("a refused attempt falls back to Bland's answer, bit for bit",
  aborted.length > 0 && aborted.every(row => row.routedMatchesBland),
  aborted.filter(row => !row.routedMatchesBland).length + " of " + aborted.length + " differ from Bland");

/* THE reason the rule is opt-in, kept as a measured fact rather than a comment. Both rules reach the
 * same optimum; they do not reach the same VERTEX, because these LPs have alternate optima. Every
 * consumer reads the vertex — the makespan LP's line assignment and reported ETA, the relaxation's
 * roundings that seed the whole local search — so switching rules moves plans while the objective
 * holds to 1e-16. If this check ever stops firing, the vertex has become canonical and the rule can
 * be reconsidered on its pivot counts alone. */
check("where it finishes it lands on a different vertex of the same optimum",
  completed.some(row => !row.routedMatchesBland) &&
  completed.every(row => rel(row.dantzigObj, row.blandObj) <= 1e-9),
  completed.filter(row => !row.routedMatchesBland).length + " of " + completed.length +
  " completed tableaux return a vertex Bland does not");

check("a refused attempt is paid for once and only once",
  aborted.every(row => row.routedPivots === row.dantzigPivots + row.blandPivots),
  aborted.map(row => row.routedPivots + "=" + row.dantzigPivots + "+" + row.blandPivots).join(" "));

/* ---- the certificate itself ----------------------------------------------------------------- */
{
  const context = realm();
  const certified = vm.runInContext(`
    (function(){
      var c=[1,1],A=[[1,0],[0,1],[1,1]],b=[4,5,6];
      var sol=lpMaximize(c,A,b);
      // The duals of a bounded LP at its optimum: only the binding x1+x2<=6 row carries weight.
      var y=[0,0,1];
      var truthful=lpCertifyOptimal(c,A,b,sol.x,y);
      var infeasible=lpCertifyOptimal(c,A,b,new Float64Array([4,5]),y);   // 9 > 6 on the third row
      var negative=lpCertifyOptimal(c,A,b,new Float64Array([-1,7]),y);    // x1 below zero
      var badDual=lpCertifyOptimal(c,A,b,sol.x,[0,0,0.5]);                // duals do not cover c
      var gap=lpCertifyOptimal(c,A,b,sol.x,[0,0,2]);                      // objectives disagree
      return {truthful:truthful,infeasible:infeasible,negative:negative,badDual:badDual,gap:gap,
        objective:sol.x[0]+sol.x[1]};
    })()
  `, context, { filename: "lp-pivot-certificate" });
  check("the certificate accepts a true primal/dual optimal pair",
    certified.truthful === true && Math.abs(certified.objective - 6) <= 1e-12,
    "objective=" + certified.objective);
  check("the certificate rejects a primal-infeasible vertex",
    certified.infeasible === false, "verdict=" + certified.infeasible);
  check("the certificate rejects a negative variable",
    certified.negative === false, "verdict=" + certified.negative);
  check("the certificate rejects duals that do not price every column",
    certified.badDual === false, "verdict=" + certified.badDual);
  check("the certificate rejects a duality gap",
    certified.gap === false, "verdict=" + certified.gap);
}

/* ---- the pivot loop answers to the run's solve control -------------------------------------- */

/* Line switching schedules every phase through this simplex and never enters the discrete search, so
 * these pivots are the whole run. Until the run carried a control they were charged to nothing and
 * bounded by nothing but a per-solve pivot ceiling: the user's solve-time setting could not end the
 * run and neither could anything else. What is pinned is the pair — the work is charged, and when it
 * runs out the run says the budget stopped it instead of publishing an empty plan as a verdict about
 * the factory. */
function splitRun(testOptionsSource) {
  const context = realm();
  context.__stateJson = JSON.stringify(materialize(fixtureById("project-split-7line")));
  vm.runInContext(`
    (function(){
      var checked=validateWorkerState(JSON.parse(__stateJson));
      if(!checked.ok)throw new Error("fixture rejected: "+checked.errors.join("; "));
      commitState(checked.state);
    })()
  `, context, { filename: "lp-pivot-load" });
  return JSON.parse(vm.runInContext(`
    (function(){
      var labels={};
      var options=${testOptionsSource};
      options.onCheckpoint=function(event){if(event.type==="checkpoint")labels[event.label]=(labels[event.label]||0)+1;};
      var res=optimize(options);
      var failure=res.scheduleValidation&&res.scheduleValidation.firstFailure;
      return JSON.stringify({labels:labels,feasible:!!res.feasible,capped:!!res.capped,
        allPhasesEvaluated:res.allPhasesEvaluated!==false,eta:res.eta,
        infeasItems:res.infeasItems||[],failureKind:failure?failure.kind:null,
        validationOk:!!(res.scheduleValidation&&res.scheduleValidation.ok)});
    })()
  `, context, { filename: "lp-pivot-split" }));
}

{
  const clock = "{now:(function(){var t=0;return function(){return t+=0.05;};})()}";
  const whole = splitRun(clock);
  check("a line-switching run charges its pivots and tableau rows to the run's control",
    (whole.labels["lp-pivot"] || 0) > 0 && (whole.labels["lp-tableau-row"] || 0) > 0,
    "lp-pivot=" + (whole.labels["lp-pivot"] || 0) + " lp-tableau-row=" + (whole.labels["lp-tableau-row"] || 0));
  check("with its budget intact that run still produces a feasible, replayable plan",
    whole.feasible && whole.validationOk && whole.failureKind === null && whole.eta > 0,
    "feasible=" + whole.feasible + " replay=" + whole.validationOk + " eta=" + whole.eta);

  // One pivot's worth of allowance: enough to build a tableau, nowhere near enough to solve it.
  const starved = splitRun("{workLimit:1200,now:(function(){var t=0;return function(){return t+=0.05;};})()}");
  check("a line-switching run that runs out of allowance stops",
    (starved.labels["lp-pivot"] || 0) === 0 && !starved.feasible,
    "lp-pivot=" + (starved.labels["lp-pivot"] || 0) + " lp-tableau-row=" +
    (starved.labels["lp-tableau-row"] || 0) + " feasible=" + starved.feasible);
  check("and reports the budget as the blocker rather than a verdict about the factory",
    starved.failureKind === "solve-budget" && starved.allPhasesEvaluated === false &&
    starved.capped === true && starved.infeasItems.length === 0,
    "failure=" + starved.failureKind + " evaluated=" + starved.allPhasesEvaluated +
    " capped=" + starved.capped + " infeasItems=" + JSON.stringify(starved.infeasItems));
}

console.log(failures ? "\n" + failures + " LP pivot check(s) failed" : "\nall LP pivot checks passed");
process.exitCode = failures ? 1 : 0;
