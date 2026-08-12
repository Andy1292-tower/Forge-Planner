"use strict";
/* Contract test for solveCore's destroy-and-repair operator (WS4.1 of docs/SOLVER_PERF_DESIGN.md).
 *
 * The operator freezes all but k lines, folds the frozen lines' production and burn into the supply
 * the freed ones see, and enumerates the freed subset exactly against the incumbent's own score. It
 * ships OFF — opts.lnsCadence is a direct-source test seam, 0 in production — because on the bench
 * corpus it refutes every subset it can afford to search (the measurement is recorded beside the
 * code). This test is what keeps the code from rotting while it is off, and what pins the two
 * properties that decide whether it could ever be turned on:
 *
 *   OFF IS OFF. With the seam absent, at 0, or at a value the run never reaches, the plan, the
 *   objective and the total charged work are identical. The operator draws random numbers and
 *   charges work, so a leak either way would move the whole search, not just this move.
 *
 *   THE VECTORS STILL DESCRIBE THE PLAN. The enumeration backtracks by restoring a per-depth
 *   snapshot rather than by undoing arithmetic, four moves deep. If that restore were inexact the
 *   result would still look plausible — a plan, a score, a balance table — while the balance it
 *   reports belonged to some branch the search rejected. So the returned produced/consumed are
 *   re-derived from the returned choice and compared per resource, and the returned plan is checked
 *   feasible on the solver's own epsilon.
 *
 *   STOPPING STAYS BUDGET-INDEPENDENT. The repair's ceiling is a work count and the enumeration
 *   reads no clock of its own, so under a frozen clock the same factory must return the same plan,
 *   and spend the same number of enumeration nodes, at any budget. That is the property that keeps
 *   a longer budget from returning a worse plan than a short one already converged to; a repair
 *   bounded by time instead of work would break it silently.
 *
 * Usage: node test/lns-repair.cjs
 */

const vm = require("vm");
const { fixtureById, materialize } = require("./perf/corpus.cjs");
const { createSolverContext } = require("./perf/harness.cjs");

// Enough work to clear the root LP (~817k dense units on this factory) and then run several hundred
// ILS iterations, which is where the operator lives. The clock is frozen, so this is the only stop.
const WORK_LIMIT = 2_000_000;
// Relative agreement per resource between the reported vectors and a re-derivation of the reported
// plan. Both are sums of positive terms in the same order, so they differ only where the supply
// round-trips through forgie (x/3600 then *3600 then /3600 again); 1e-12 is far above that and far
// below a term landing on the wrong row.
const REL_TOL = 1e-12;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
  if (!ok) failures++;
}

/* Runs inside the solver realm: solveCore is a plain function declaration in a classic script and
 * its opts are not reachable from outside. Returns a summary per requested cadence. */
const RUN_SRC = `
(function(targets, cadences, workLimit, timeBudget){
  const rc=relevantChain(targets);
  return JSON.stringify(cadences.map(cadence=>{
    const labels={};
    const opts={now:()=>0,workLimit,onCheckpoint:e=>{
      if(e.type!=="checkpoint")return;labels[e.label]=(labels[e.label]||0)+1;}};
    if(cadence!==null)opts.lnsCadence=cadence;
    const sr=solveCore(targets,targets.map(()=>1),rc.prods,rc.raws,timeBudget,opts);
    const {best,sorted,lineJobs,resources,R,tol,forgie,feasible}=sr;

    // The reported vectors, re-derived from the reported plan the way evalChoice sums them: the
    // base supply, then each line's production and consumption at that line's effective speed.
    const P=new Float64Array(R),C=new Float64Array(R);
    for(let r=0;r<R;r++)P[r]=(forgie[resources[r]]||0)/3600;
    for(let i=0;i<sorted.length;i++){
      const job=lineJobs[i][best.choice[i]],dp=sorted[i].dp;
      const sp=(job.ct>0&&sorted[i].sp>job.ct)?job.ct:sorted[i].sp;
      for(const[r,a]of job.prod)if(r>=0&&r<R)P[r]+=a*sp*dp;
      for(const[r,a]of job.cons)if(r>=0&&r<R)C[r]+=a*sp;
    }
    let worstRel=0,infeasible=0;
    const relaxed=1-tol;
    for(let r=0;r<R;r++){
      const need=MINED_RESOURCES.includes(resources[r])?1:relaxed;
      if(best.produced[r]<best.consumed[r]*need-1e-7)infeasible++;
      for(const pair of [[best.produced[r],P[r]],[best.consumed[r],C[r]]]){
        if(Object.is(pair[0],pair[1]))continue;
        const scale=Math.max(Math.abs(pair[0]),Math.abs(pair[1]));
        const rel=scale>0?Math.abs(pair[0]-pair[1])/scale:Infinity;
        if(rel>worstRel)worstRel=rel;
      }
    }
    return {cadence,score:best.score,choice:best.choice.join(","),feasible:!!feasible,
      lnsNodes:labels["lns-node"]||0,ilsIterations:labels["ils-iteration"]||0,
      work:Object.keys(labels).reduce((sum,key)=>sum+labels[key],0),
      infeasible,worstRel,N:sorted.length,R};
  }));
})(__lnsTargets, __lnsCadences, __lnsWorkLimit, __lnsBudget)
`;

function run(fixtureId, targets, cadences, budget) {
  const realm = createSolverContext();
  realm.resetRun({ virtual: false, watchCheckpoints: false });
  realm.loadState(materialize(fixtureById(fixtureId)));
  realm.context.__lnsTargets = targets;
  realm.context.__lnsCadences = cadences;
  realm.context.__lnsWorkLimit = WORK_LIMIT;
  realm.context.__lnsBudget = budget;
  return JSON.parse(vm.runInContext(RUN_SRC, realm.context, { filename: "lns-repair-run" }));
}

/* Two target sets, because the operator's two halves are only both live in one of them. The saved
 * multi-output mix is the plain case; the single-output Gel solve is the one that reaches the feeder
 * second pass, which is the coupled move this operator was built to find. */
const CASES = [
  { fixture: "items-7line", targets: ["Glass", "Bricks", "Plates", "Rods", "Gel"], label: "5-output mix" },
  { fixture: "items-7line", targets: ["Gel"], label: "Gel only" },
];

const started = Date.now();
for (const testCase of CASES) {
  // null = the option omitted entirely, which is what the app and the Worker always pass.
  const [absent, zero, on, never] = run(testCase.fixture, testCase.targets, [null, 0, 1, 1e9], 4000);
  const where = testCase.fixture + " (" + testCase.label + ", N=" + on.N + " R=" + on.R + ")";

  check("an absent seam and cadence 0 run the identical search on " + where,
    absent.choice === zero.choice && absent.score === zero.score && absent.work === zero.work &&
      zero.lnsNodes === 0,
    absent.work + " vs " + zero.work + " work units, " + zero.lnsNodes + " enumeration nodes");
  check("a cadence the loop never reaches is inert on " + where,
    never.choice === absent.choice && never.score === absent.score && never.work === absent.work,
    never.work + " work units, " + never.lnsNodes + " enumeration nodes");
  check("cadence 1 actually reaches the enumeration on " + where,
    on.lnsNodes > 0 && on.ilsIterations > 0,
    on.lnsNodes + " enumeration nodes over " + on.ilsIterations + " ILS iterations");
  check("the plan the operator returns is feasible on " + where,
    on.feasible && on.infeasible === 0,
    on.infeasible + " row(s) short of the solver's own epsilon");
  check("the reported balance describes the reported plan on " + where,
    on.worstRel <= REL_TOL,
    "worst relative disagreement " + on.worstRel.toExponential(2));

  // Frozen clock: timeBudget then reaches nothing but convergeWindow, which cannot fire, so a
  // difference here is the repair having consulted a clock instead of a work count.
  const [long] = run(testCase.fixture, testCase.targets, [1], 60000);
  check("the repair stops on work, not on the budget, on " + where,
    long.choice === on.choice && long.score === on.score && long.lnsNodes === on.lnsNodes,
    on.lnsNodes + " nodes at 4000 ms vs " + long.lnsNodes + " at 60000 ms");
}

console.log("\n" + (failures ? failures + " lns-repair check(s) failed" : "the destroy-and-repair operator holds its contract") +
  " (" + ((Date.now() - started) / 1000).toFixed(1) + "s)");
process.exitCode = failures ? 1 : 0;
