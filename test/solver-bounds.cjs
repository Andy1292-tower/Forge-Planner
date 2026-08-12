"use strict";
/* The solver's upper bounds, checked against what it actually achieves (WS4.2 of
 * docs/SOLVER_PERF_DESIGN.md).
 *
 * A bound is the one number in a solve result that is a CLAIM rather than a measurement: the plan is
 * whatever the search found, but `bound` asserts that nothing better exists. A bound that sits below
 * an achieved objective is not a loose bound, it is a false statement, and it fails silently — the
 * interface clamps the two together (`Math.max(scaled, objective)` in optimizeInner) before a reader
 * ever sees them, so the only place the claim can be checked is on the raw solveCore result.
 *
 * Checked on the real corpus factories rather than on toy numbers, because the arithmetic is the
 * point: the reference save carries a Hydracite budget of 5.31e12/s beside a Vespium budget of
 * 1e99/min, and those rows are in the tableau.
 *
 *   (a) THE LP CEILING BOUNDS THE PLAN, at every margin. Asserted at zero tolerance: `bound` is
 *       either null or at least the score of the plan returned beside it.
 *
 *   (b) A MARGIN SOLVE QUOTES ONE. The relaxation rebuilt over needFrac is the may-work problem's
 *       own, so the tolerance the caller asked for no longer costs the result its ceiling.
 *
 *   (c) A MARGIN CEILING IS THE HIGHER ONE. The margin admits every strictly feasible plan and more,
 *       so its optimum cannot be lower — a margin bound below the strict bound of the same factory
 *       means the relaxation lost a constraint rather than relaxed one.
 *
 *   (d) THE CEILING SURVIVES A LONGER SEARCH. A bound a bigger budget walks past was never a bound.
 *
 * Usage: node test/solver-bounds.cjs
 */

const vm = require("vm");
const { FIXTURES, materialize } = require("./perf/corpus.cjs");
const { createSolverContext } = require("./perf/harness.cjs");

// Margins to solve at. 0 is the strict problem, 5 the app's own suggested margin, 20 the top of the
// persisted range — the widest relaxation the schema can produce.
const TOLS = [0, 0.05, 0.2];
// Virtual milliseconds per solve. The bound is a property of the factory, not of the search, so the
// short budget costs the assertions nothing; (d) is what covers the budget dimension.
const SHORT_MS = 600, LONG_MS = 2000;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
  if (!ok) failures++;
}
const round = value => (Number.isFinite(value) ? Math.round(value * 1000) / 1000 : value);

// Runs inside the solver realm: solveCore's raw result never leaves it through optimize().
const PROBE_SRC = `
(function(tols, shortMs, longMs){
  const own=[...PRODUCTS,...RAWS].filter(it=>S.targets[it]&&S.targets[it].on);
  const sets=[];
  if(own.length)sets.push(own);
  // One dedicated mined-craft run beside the fixture's own mix: Gel against a 1e99/min Vespium
  // budget is where a row's terms span eighty orders, and a bound built by summing them is where
  // that would show.
  Object.keys(MINED_CRAFTS).forEach(P=>{if(PRODUCTS.includes(P)&&sets.length<2)sets.push([P]);});
  if(!sets.length)sets.push([PRODUCTS[PRODUCTS.length-1]]);

  const run=(targets,tol,budget)=>{
    const rc=relevantChain(targets);
    const sr=solveCore(targets,targets.map(()=>1),rc.prods,rc.raws,budget,{tolOverride:tol});
    return {tol,budget,score:sr.best.score,bound:sr.bound,feasible:sr.feasible,capped:sr.capped};
  };

  return JSON.stringify(sets.map(targets=>({
    targets:targets.join("+"),
    rows:tols.map(tol=>run(targets,tol,shortMs)),
    longer:tols.map(tol=>run(targets,tol,longMs)),
  })));
})(__tols, __shortMs, __longMs)
`;

const started = Date.now();
for (const fixture of FIXTURES) {
  const realm = createSolverContext();
  // The virtual clock: a budget bought with work, so what this asserts is reproducible on any
  // machine rather than a function of how much search fitted into a real second.
  realm.resetRun({ virtual: true, watchCheckpoints: true });
  realm.loadState(materialize(fixture));
  realm.context.__tols = TOLS;
  realm.context.__shortMs = SHORT_MS;
  realm.context.__longMs = LONG_MS;
  const reports = JSON.parse(vm.runInContext(PROBE_SRC, realm.context, { filename: "bounds-probe" }));

  for (const report of reports) {
    const where = fixture.id + " (" + report.targets + ")";
    const below = report.rows.concat(report.longer)
      .filter(row => row.bound !== null && row.bound < row.score);
    check("no LP ceiling sits below the plan it bounds on " + where, below.length === 0,
      report.rows.map(row => "tol " + row.tol + ": " + round(row.score) + " <= " + round(row.bound)).join(", "));

    const margins = report.rows.filter(row => row.tol > 0);
    const quoted = margins.filter(row => row.bound !== null).length;
    check("a margin solve quotes a ceiling of its own on " + where, quoted === margins.length,
      quoted + " of " + margins.length + " margin rows bounded");

    const strict = report.rows.find(row => row.tol === 0);
    const notAbove = margins.filter(row =>
      row.bound !== null && strict && strict.bound !== null && row.bound < strict.bound * (1 - 1e-9));
    check("every margin ceiling sits at or above the strict one on " + where, notAbove.length === 0,
      report.rows.map(row => row.tol + ":" + round(row.bound)).join(" "));

    const passed = report.longer.filter(row => {
      const short = report.rows.find(item => item.tol === row.tol);
      return short && short.bound !== null && row.score > short.bound * (1 + 1e-9);
    });
    check("a longer search never passes the short search's ceiling on " + where, passed.length === 0,
      report.longer.map(row => row.tol + ":" + round(row.score)).join(" "));
  }
}

console.log("\n" + (failures ? failures + " solver-bound check(s) failed" : "every solver bound holds on every corpus fixture") +
  " (" + ((Date.now() - started) / 1000).toFixed(1) + "s)");
process.exitCode = failures ? 1 : 0;
