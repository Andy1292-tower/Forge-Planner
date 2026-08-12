"use strict";
/* Solver bench measurement engine (WS0 of docs/SOLVER_PERF_DESIGN.md).
 *
 * USAGE
 *
 *   const { runFixture, measureWorkToObjective, DEFAULT_LADDER } = require("./harness.cjs");
 *   const { fixtureById } = require("./corpus.cjs");
 *
 *   runFixture(fixtureById("items-7line"), { kind: "virtual", budgetMs: 4000 });
 *   runFixture(fixtureById("items-7line"), { kind: "wall", repeat: 5 });  // budget from the state
 *   measureWorkToObjective(fixtureById("items-7line"));                  // work to reach the plateau
 *
 * The CLI over this is `npm run bench` (test/perf/bench.cjs); the CI self-test that keeps it honest
 * is test/perf-harness.cjs.
 *
 * Each call builds a throwaway solver realm (js/catalog.js, js/core.js, js/fields.js, js/state.js,
 * js/project-schedule.js, js/solver.js — catalog.js plus exactly what the Worker importScripts),
 * loads the fixture through validateWorkerState/commitState (the Worker's own boundary), runs any
 * seed solves the fixture declares, then runs one measured optimize() and returns a metrics object.
 * No file under js/ is modified to make any of this work: the only seam used is optimize(testOptions),
 * which threads `now`, `workLimit` and `onCheckpoint` into every makeSolveControl call.
 *
 * THREE RUN KINDS, AND WHY EACH EXISTS
 *
 *   "wall"    — real clock, real budget. An anytime solver always spends its whole wall budget, so
 *               wall-clock alone measures nothing. The number to read is `wall.probeWorkPerSec`:
 *               search throughput. Cheaper probes (WS1) show up here and nowhere else. Machine-
 *               dependent, informational, never a gate. Repeated (see REPEATS) because one sample
 *               of it is not a measurement.
 *
 *   "virtual" — the clock is consumed work (see VIRTUAL CLOCK below). Nothing in the solve path
 *               reads a real clock except two ms-reporting lines in optimizeProjectTop, so the whole
 *               run becomes machine-independent while keeping its time shape: deadlines, stagnation
 *               timers and the Credits fair slicing all behave as they would on a machine of exactly
 *               this speed. (Freezing the clock at 0 instead would collapse the Credits refinement
 *               loop, which slices the wall time that remains.) Same objective, same total work,
 *               same per-label counts on every machine — the deterministic proxy CI gates on.
 *
 *   "work"    — the virtual clock plus an explicit `workLimit`, so a run can be stopped at an exact
 *               work count. This is the only way to reach the low end of the curve: the budget of a
 *               "virtual" run is written into the saved state, and `solveBudget` is a persisted
 *               field clamped to 200..60000 ms, which on the Items fixtures is already past the
 *               point where the objective has plateaued. `measureWorkToObjective` bisects on this
 *               kind to report work-to-reach-the-plateau — acceptance criterion A1's Items metric,
 *               which objective-at-budget alone cannot express.
 *
 * Together they decompose A1. Work-to-reach-an-objective comes from `measureWorkToObjective`, split
 * into its two currencies; throughput in each currency comes from wall runs; and the quantity A1 is
 * actually written in falls out of them:
 *
 *   time-to-objective  =  probeWork / probeWorkPerSec  +  denseWork / denseWorkPerSec
 *
 * Both terms of the sum are machine-independent, only the two divisors are not, and each of the
 * four factors names the workstream that moves it (WS1 the probe divisor, WS2 both dense terms,
 * WS4 the probe numerator). Objective-at-budget from a virtual sweep over DEFAULT_LADDER is the
 * quality half — A2 — and the sweep is what the objective-vs-budget curve per fixture comes from.
 *
 * TWO WORK CURRENCIES, EVERYWHERE
 *
 * The solver charges work in two currencies whose real-time costs differ by ~280x (see VIRTUAL
 * CLOCK). Every number this harness reports keeps them apart:
 *
 *   probe work — one unit per checkpoint, the discrete search.
 *   dense work — LP tableau cells, charged only inside lpMaximize.
 *
 * `work.total / seconds` pools them, so it moves 5.7x with budget alone on an unchanged solver
 * (measured on items-7line: 3,178,608 units/s at a 300 ms budget against 553,125 at 20000 ms,
 * purely because the fixed ~817k-unit LP block is amortised over a longer run). It is therefore not
 * reported. `wall.probeWorkPerSec` over the same range moves 9% (469,274 -> 512,282), and that is
 * the headline. Dense work gets its own rate off the time actually spent inside lpMaximize.
 *
 * REPEATS
 *
 * Wall throughput drifts between node processes by ~10% on an idle machine, which is the same order
 * as the wins WS1 is asked for. A wall run is therefore repeated (default REPEAT_WALL, each in a
 * fresh realm) and reports median/min/max and a coefficient of variation, so a reader can tell a
 * 40% win from noise. Virtual runs are bit-reproducible and are never repeated.
 *
 * DETERMINISM
 *
 * Everything a virtual or work run reports is a pure function of the fixture except the fields
 * under `nonDeterministic`, which hold real-clock readings kept for triage (how long the run took,
 * how long its LPs took). A baseline diff ignores that sub-object; nothing else in a virtual run's
 * JSON may differ between machines, and test/perf-harness.cjs asserts exactly that.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const os = require("os");
const { performance } = require("perf_hooks");

const { materialize } = require("./corpus.cjs");

const ROOT = path.join(__dirname, "..", "..");

/* catalog.js first: core.js normalize() rehydrates a project's levels from PROJECT_CATALOG when it
 * carries a catId, and the reference save does. The remaining six are exactly the Worker's
 * importScripts list, so the realm below is the one the app actually solves in. */
const SOURCES = [
  "js/catalog.js",
  "js/decimal.js",
  "js/core.js",
  "js/fields.js",
  "js/state.js",
  "js/project-schedule.js",
  "js/solver.js",
];

/* ---- VIRTUAL CLOCK ----------------------------------------------------------------------------
 *
 * A virtual millisecond is bought with consumed work, so the clock is a pure function of the search
 * and identical on every machine. Two rates, because the solver charges work in two different
 * currencies and they are not interchangeable:
 *
 *   PROBE work — one unit per checkpoint. A `climb-job` unit is one candidate job evaluation, a
 *     `repair-job` unit one repair probe, and so on. Measured cost on the capture machine spans
 *     roughly 100–1100 units/ms across every such label, centred near 500.
 *
 *   DENSE work — the only sites that charge more than one unit are the two inside lpMaximize
 *     (`lp-tableau-row` charges a row, `lp-pivot` charges W*(m+1) tableau cells). These count array
 *     elements, not probes: measured ~140,000 units/ms for `lp-pivot`, i.e. a `lp-pivot` unit is
 *     ~280x cheaper in real time than a `climb-job` unit.
 *
 * Pricing both at one rate is not a neutral simplification — it hands the LP relaxation a share of
 * every budget that it does not take in reality. On items-10line the root LP charges ~2.2M units;
 * at a single 1500 units/ms rate that is 1.5 s of a 20 s budget and the entire 250 ms rung, so the
 * low rungs of the ladder would measure nothing but Bland's rule. Priced separately, the same LP
 * costs ~22 virtual ms, and a 250 ms virtual run performs the same ~120k probes a real 250 ms run
 * performs. The rates below reproduce the real apportionment; they do not model any one machine's
 * absolute speed, and they are not what a later workstream is measured on (that is `objective` at a
 * fixed budget, and work-to-objective).
 *
 * These are committed constants: every virtual budget in every recorded baseline is denominated in
 * them, so changing either invalidates every baseline. DENSE_LABELS must stay in step with the
 * solver's multi-unit charge sites — test/perf-harness.cjs asserts that from observed behaviour
 * (no label outside this list may ever charge more than one unit) rather than from a source grep,
 * because the solver's dominant call shape passes a computed label a grep cannot name. */
const UNITS_PER_MS = 500;
const DENSE_UNITS_PER_MS = 100000;
const DENSE_LABELS = ["lp-pivot", "lp-tableau-row"];

/* Budget ladder for a virtual sweep: two decades of budget, so the objective-vs-budget curve shows
 * both the early climb and the plateau. 20000 is the reference save's own solve budget.
 *
 * The ladder deliberately stops at four rungs. Intermediate rungs were measured and add nothing:
 * project-7line returns eta 38.89252642409503 at every one of 200, 500, 1000, 2000, 4000, 6000,
 * 8000 and 12000 ms and only moves at 20000, because below that the static search plateaus and the
 * idle-line fill's own clock (STATIC_FILL_TIME_FLOOR) dominates the difference. The Items fixtures
 * are flat across the whole ladder for the opposite reason — their plateau is reached below the
 * schema's 200 ms budget floor. Resolving either curve needs work limits, not more budgets, which
 * is what `measureWorkToObjective` is for. */
const DEFAULT_LADDER = [250, 1000, 4000, 20000];
const QUICK_LADDER = [250, 1000];

/* solveBudget is a persisted field; boundedPersistedField clamps it to this range and
 * validateWorkerState rejects a state outside it. A budget outside the range is a bad flag, not a
 * measurement, so the CLI checks it rather than letting validation throw. */
const MIN_BUDGET_MS = 200;
const MAX_BUDGET_MS = 60000;

// Wall repeats per measurement. Three fits an opt-in bench run; the committed baseline is recorded
// with more (see the bench header) because it is what every later PR is diffed against.
const REPEAT_WALL = 3;

/* Installed after the sources load. Every call site resolves these names through the global object
 * at call time (they are plain function declarations in a classic script), so reassigning them here
 * instruments every caller — including the idle-work control the static fill creates lazily. */
const INSTRUMENT = `
(function(){
  var hooks=__forgeBench;
  var rawControl=makeSolveControl,rawSolveCore=solveCore,rawLp=lpMaximize;
  var rawSchedule=projectSchedule,rawStatic=staticSchedule,rawPhase=solveExecutableProjectPhase;
  // One optimize() call creates several controls (items: one; project static: staticControl plus a
  // lazily created idle-work control), each with its own zero-based work counter and its own
  // startedAt, so a single shared observer would see work and elapsed jump backwards whenever the
  // control changed. Every control gets its own observer and its own delta bookkeeping instead.
  //
  // The observer is installed only when the run needs per-checkpoint detail. js/solver.js's emit()
  // calls the observer on every single checkpoint, so an installed observer is a tax on the search
  // itself — measured at +4.4% on an items-7line solve of fixed work. That tax would shrink WS1's
  // reported speedup below its own acceptance threshold, so a wall run, whose entire purpose is
  // throughput, runs un-instrumented: its work totals come off the controls and its dense/probe
  // split off the LP meter below, neither of which costs anything per checkpoint.
  makeSolveControl=function(timeBudget,options){
    var opts={},k;
    if(options)for(k in options)opts[k]=options[k];
    var id=hooks.openControl(timeBudget);
    if(hooks.watchCheckpoints){
      var caller=typeof opts.onCheckpoint==="function"?opts.onCheckpoint:null;
      opts.onCheckpoint=function(event){
        hooks.observe(id,event.type,event.label,event.work,event.elapsed,event.reason);
        if(caller)caller(event);
      };
    }
    if(hooks.virtual&&typeof opts.now!=="function")opts.now=hooks.now;
    if(hooks.workLimit>0&&!Number.isFinite(Number(opts.workLimit)))opts.workLimit=hooks.workLimit;
    var control=rawControl(timeBudget,opts);
    hooks.attachControl(id,control);
    return control;
  };
  // How many component solves one user action fans out into is a headline number in its own right.
  solveCore=function(){hooks.count("solveCore");return rawSolveCore.apply(null,arguments);};
  // lpMaximize charges every dense unit in the solver and nothing else does, so metering it here
  // yields the dense/probe split without a per-checkpoint observer. The meter also stands in for a
  // missing control: a caller that passes none still gets its pivots counted, because every charge
  // site inside lpMaximize is guarded by \`control&&\` and a meter that always grants the checkpoint
  // is behaviour-identical to passing nothing.
  //
  // The trailing options argument selects the pivot rule and MUST be forwarded: swallowing it would
  // run the bench against a different simplex than the app, which is the one thing a bench may never
  // do. Same reason the meter is passed positionally rather than as a rebuilt argument list.
  lpMaximize=function(c,A,b,control,opts){
    var real=control&&typeof control.checkpoint==="function"?control:null;
    var meter={__forgeSolveControl:true,checkpoint:function(label,cost){
      var before=real?real.work():0;
      var granted=real?real.checkpoint(label,cost):true;
      var units=real?real.work()-before:Math.max(1,Math.floor(Number(cost)||1));
      hooks.lpCharge(label,units,granted,!!real);
      return granted;
    }};
    hooks.count("lpMaximize");
    var at=hooks.clock();
    var out=rawLp(c,A,b,meter,opts);
    hooks.lpDone(hooks.clock()-at,!!(out&&out.interrupted));
    return out;
  };
  projectSchedule=function(){hooks.count("projectSchedule");return rawSchedule.apply(null,arguments);};
  // Static line mode — what the reference save uses — routes phases through staticSchedule rather
  // than projectSchedule, so both are counted or a Set & forget run looks like it scheduled nothing.
  staticSchedule=function(){hooks.count("staticSchedule");return rawStatic.apply(null,arguments);};
  solveExecutableProjectPhase=function(){hooks.count("projectPhase");return rawPhase.apply(null,arguments);};
})();
`;

const LOAD_STATE = `
(function(){
  var checked=validateWorkerState(JSON.parse(__forgeBenchStateJson));
  if(!checked.ok)throw new Error("fixture state rejected by validateWorkerState: "+checked.errors.join("; "));
  commitState(checked.state);
  return {mode:checked.state.mode,budgetMs:checked.state.solveBudget,lines:(checked.state.lines||[]).length};
})()
`;

const RUN_SOLVE = `
(function(){
  var testOptions={};
  if(__forgeBench.virtual)testOptions.now=__forgeBench.now;
  if(__forgeBench.workLimit>0)testOptions.workLimit=__forgeBench.workLimit;
  return optimize(testOptions);
})()
`;

function freshCalls() {
  return { solveCore: 0, lpMaximize: 0, projectSchedule: 0, staticSchedule: 0, projectPhase: 0 };
}

function freshLp() {
  return { pivots: 0, tableauRows: 0, work: 0, workOnControl: 0, refused: 0, interrupted: 0, ms: 0 };
}

function round(value, digits) {
  if (!Number.isFinite(value)) return value;
  const scale = Math.pow(10, digits);
  return Math.round(value * scale) / scale;
}

function createSolverContext() {
  const dense = new Set(DENSE_LABELS);
  const state = {
    virtual: false,
    watchCheckpoints: true,
    workLimit: 0,
    virtualMs: 0,          // never reset: the virtual clock must be monotone for the realm's life
    runVirtualStart: 0,    // ... so what a run reports is the span it consumed, not the reading
    controls: [],
    labels: new Map(),
    events: new Map(),
    stopReasons: new Map(),
    calls: freshCalls(),
    lp: freshLp(),
    controlsOpened: 0,
  };

  const hooks = {
    get virtual() { return state.virtual; },
    get watchCheckpoints() { return state.watchCheckpoints; },
    get workLimit() { return state.workLimit; },
    now() { return state.virtualMs; },
    clock() { return performance.now(); },
    openControl(budget) {
      const id = state.controls.length;
      state.controls.push({ id, budget: Number(budget) || 0, control: null, lastWork: 0, lastElapsed: 0 });
      state.controlsOpened++;
      return id;
    },
    attachControl(id, control) {
      const entry = state.controls[id];
      if (entry) entry.control = control;
    },
    /* Per-label work has to come from deltas: the multi-unit sites would otherwise report the cost
     * of a checkpoint as 1, understating exactly the loops WS2 targets. A checkpoint that reserved
     * work and then returned without emitting (a local-deadline cutoff) leaves its units to be
     * picked up by the next event on the same control — a bounded, deterministic shift of
     * attribution, not lost work. `work.total` is read straight off the controls, not from here. */
    observe(id, type, label, work, elapsed, reason) {
      const entry = state.controls[id];
      if (!entry) return;
      const dWork = work - entry.lastWork, dMs = elapsed - entry.lastElapsed;
      entry.lastWork = work;
      entry.lastElapsed = elapsed;
      if (dWork > 0) state.virtualMs += dWork / (dense.has(label) ? DENSE_UNITS_PER_MS : UNITS_PER_MS);
      if (type === "checkpoint" || type === "stopped") {
        const key = label || "(unlabeled)";
        let bucket = state.labels.get(key);
        if (!bucket) state.labels.set(key, (bucket = { count: 0, work: 0, ms: 0, maxUnits: 0 }));
        bucket.count++;
        // The largest single charge ever seen under a label is what says whether that label is a
        // probe or a dense site, and it is the only statement about pricing that cannot be fooled
        // by a computed label. test/perf-harness.cjs gates DENSE_LABELS on it.
        if (dWork > bucket.maxUnits) bucket.maxUnits = dWork;
        if (dWork > 0) bucket.work += dWork;
        if (dMs > 0) bucket.ms += dMs;
      }
      if (type !== "checkpoint") state.events.set(type, (state.events.get(type) || 0) + 1);
      // A work-limit stop and a deadline stop both set deadlineReached; only `reason` tells them
      // apart, and A4 makes those two meanings a survival requirement.
      if (reason) state.stopReasons.set(reason, (state.stopReasons.get(reason) || 0) + 1);
    },
    lpCharge(label, units, granted, onControl) {
      const lp = state.lp;
      lp.work += units;
      if (onControl) lp.workOnControl += units;
      if (!granted) { lp.refused++; return; }
      if (label === "lp-pivot") lp.pivots++; else lp.tableauRows++;
    },
    lpDone(ms, interrupted) {
      state.lp.ms += ms;
      if (interrupted) state.lp.interrupted++;
    },
    count(name) { state.calls[name] = (state.calls[name] || 0) + 1; },
  };

  const context = vm.createContext({
    console,
    performance,
    setTimeout,
    clearTimeout,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => ({ innerHTML: "", textContent: "" }) },
    __forgeBench: hooks,
  });

  for (const file of SOURCES) {
    const filename = path.join(ROOT, file);
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  }
  vm.runInContext(INSTRUMENT, context, { filename: "bench-instrument" });

  // The state crosses the realm boundary as text: validateAndMigrate inspects prototypes, and a
  // Node-realm object literal is not an in-realm plain object. What comes back is read off the
  // VALIDATED state, so a field the schema clamped is reported as the solver actually saw it.
  function loadState(saved) {
    context.__forgeBenchStateJson = JSON.stringify(saved);
    return vm.runInContext(LOAD_STATE, context, { filename: "bench-load-state" });
  }

  // Every run starts from a cold solve-constant cache, so what is reported is the whole cost of the
  // action rather than the cost of whatever a previous run in this realm left warm.
  function resetRun(options) {
    const opts = options || {};
    state.virtual = !!opts.virtual;
    state.watchCheckpoints = opts.watchCheckpoints !== false;
    state.workLimit = Number.isFinite(opts.workLimit) && opts.workLimit > 0 ? Math.floor(opts.workLimit) : 0;
    state.runVirtualStart = state.virtualMs;
    state.controls = [];
    state.labels = new Map();
    state.events = new Map();
    state.stopReasons = new Map();
    state.calls = freshCalls();
    state.lp = freshLp();
    state.controlsOpened = 0;
    vm.runInContext("_soloMaxCache={key:\"\",values:{}};", context, { filename: "bench-reset" });
  }

  function resetStability() {
    vm.runInContext("resetLineStability();", context, { filename: "bench-reset-stability" });
  }

  function solve() {
    return vm.runInContext(RUN_SOLVE, context, { filename: "bench-solve" });
  }

  function snapshot() {
    let total = 0;
    for (const entry of state.controls) if (entry.control) total += Number(entry.control.work()) || 0;
    const byLabel = {};
    const ordered = [...state.labels.entries()].sort((a, b) => b[1].work - a[1].work || (a[0] < b[0] ? -1 : 1));
    for (const [key, bucket] of ordered) {
      byLabel[key] = { count: bucket.count, work: bucket.work, maxUnits: bucket.maxUnits, ms: round(bucket.ms, 3) };
    }
    const events = {};
    for (const key of [...state.events.keys()].sort()) events[key] = state.events.get(key);
    const stopReasons = {};
    for (const key of [...state.stopReasons.keys()].sort()) stopReasons[key] = state.stopReasons.get(key);
    // Dense work is exactly what lpMaximize charged to a real control; every other unit the controls
    // hold is a one-unit probe. The two are separable without a per-checkpoint observer, which is
    // what lets a wall run stay un-instrumented.
    const dense = Math.min(total, state.lp.workOnControl);
    return {
      work: { total, probe: total - dense, dense, byLabel },
      lp: Object.assign({}, state.lp),
      calls: Object.assign({ controls: state.controlsOpened }, state.calls),
      events,
      stopReasons,
      virtualMs: state.virtualMs - state.runVirtualStart,
    };
  }

  return { context, loadState, resetRun, resetStability, solve, snapshot };
}

/* The objective as the plain number a comparison sorts on. In Credits it is a quantity — a Decimal,
 * because a late-game sell price outgrows a float64 — so Number.isFinite would read every one of
 * them as "not a number" and record a flat 0. Number() goes through the Decimal's own valueOf, and a
 * value past the float ceiling saturates rather than becoming Infinity, which keeps the baseline's
 * "every run carries a finite objective" contract true at any magnitude. */
function objectiveScalar(value) {
  if (value === null || value === undefined) return 0;
  const flat = Number(value);
  if (Number.isFinite(flat)) return flat;
  return Number.isNaN(flat) ? 0 : Number.MAX_VALUE;
}

/* Every mode returns an objective where higher is better. The summary keeps the fields a later PR
 * would actually diff; the contract flags live in flagsOf. */
function summarize(mode, result) {
  if (!result || result.empty) return { empty: true };
  if (mode === "credits") {
    const ranking = (result.ranking || []).map(entry => ({
      item: entry.item, credits: entry.credits, capped: !!entry.capped, evaluated: !!entry.evaluated,
    }));
    return {
      bestItem: result.bestItem, credits: result.credits, ranking,
      priced: ranking.length, pricedEvaluated: ranking.filter(entry => entry.evaluated).length,
      pricedRefined: ranking.filter(entry => entry.evaluated && !entry.capped).length,
    };
  }
  if (mode === "project") {
    const comparison = result.stabilityComparison;
    const phases = (result.phases || []).map(phase => ({
      phaseKey: phase.phaseKey, name: phase.name, eta: phase.eta, z: phase.z,
      capped: phase.capped === true, stabilized: phase.stabilized === true,
      // The idle-line fills are a contract guarantee with no other footprint in the metrics:
      // stubbing putIdleLinesToWork out entirely leaves eta, every phase field and every flag
      // byte-identical on this corpus, and only moves a work total the comparison prints as
      // informational. Recording what each pass actually did is what makes losing one visible.
      idleFill: phase.idleFill || null,
      lookAhead: phase.lookAhead ? { name: phase.lookAhead.name, lines: phase.lookAhead.lines, items: phase.lookAhead.items } : null,
    }));
    return {
      eta: result.eta, workEta: result.workEta, warmupEta: result.warmupEta,
      lpFeasible: !!result.lpFeasible, partial: !!result.partial,
      phases,
      idleFillPhases: phases.filter(phase => phase.idleFill).length,
      lookAheadPhases: phases.filter(phase => phase.lookAhead).length,
      executionPhases: (result.executionPhases || []).length,
      // The hidden prefer-current comparison — a second complete run — only happens once
      // _lineStability holds a record, which is why the fixture declares a seed run.
      hiddenComparisonRan: !!comparison,
      stabilityComparison: comparison ? {
        comparable: comparison.comparable, orderChanged: comparison.orderChanged,
        selectedTotalEta: comparison.selectedTotalEta, alternativeTotalEta: comparison.alternativeTotalEta,
        alternativeIsShorter: comparison.alternativeIsShorter,
      } : null,
    };
  }
  return {
    bound: result.bound, binding: result.binding, mixMode: result.mixMode,
    tol: result.tol, usesMargin: !!result.usesMargin,
    out: result.out, blocked: result.blocked || [],
    // In share mode `objective` is out[binding] divided by a calibration ceiling the solver itself
    // searches for, and that ceiling improves with budget: items-share-margin-7line returns a
    // byte-identical `out` at 4000 and 20000 virtual ms while soloMax.Bricks rises 0.88%, so the
    // normalized objective FALLS 0.876% on an unchanged plan. Recording the denominator is what
    // makes that diagnosable, and it is why bench.cjs gates share-mode runs on `out` instead.
    soloMax: result.soloMax || null,
    shareOfMax: result.shareOfMax || null,
    gap: Number.isFinite(result.bound) && result.bound > 0 ? round((result.bound - result.objective) / result.bound, 6) : null,
  };
}

function flagsOf(mode, result) {
  const flags = {
    feasible: !!(result && result.feasible),
    capped: !!(result && result.capped),
    deadlineReached: result && result.deadlineReached !== undefined ? !!result.deadlineReached : null,
  };
  if (mode === "credits") {
    flags.allCandidatesEvaluated = !!result.allCandidatesEvaluated;
    flags.searchExhaustive = !!result.searchExhaustive;
  }
  if (mode === "project") {
    // A project run reports its static search's clock separately; there is no deadlineReached on it.
    flags.staticDeadlineReached = !!result.staticDeadlineReached;
    flags.allPhasesEvaluated = !!result.allPhasesEvaluated;
    flags.searchExhaustive = !!result.searchExhaustive;
  }
  return flags;
}

/* One measured run of one fixture in its own realm.
 *
 *   kind       "virtual" (default), "wall" or "work"
 *   budgetMs   overrides the saved solve budget; omitted means the fixture's own (20 s reference)
 *   workLimit  kind "work" only: the exact work count every control is allowed
 *
 * A fixture that declares seedRuns is solved that many times first, un-measured, in the same realm:
 * project-split-7line needs it, because the hidden prefer-current comparison run only happens once
 * _lineStability already holds a record for a phase, which a cold run cannot produce. The measured
 * run is therefore the warm one, which is the shape the design's 40% Set & forget target is written
 * against. */
function runOnce(fixture, options) {
  const opts = options || {};
  const kind = opts.kind === "wall" ? "wall" : opts.kind === "work" ? "work" : "virtual";
  const virtual = kind !== "wall";
  const workLimit = kind === "work" ? Math.max(1, Math.floor(Number(opts.workLimit) || 0)) : 0;
  const saved = materialize(fixture, { budgetMs: opts.budgetMs });
  const seedRuns = Math.max(0, Math.floor(Number(fixture.seedRuns) || 0));

  const ctx = createSolverContext();
  ctx.resetStability();
  const loaded = ctx.loadState(saved);
  if (loaded.mode !== fixture.mode) {
    throw new Error(fixture.id + ": validated state mode " + loaded.mode + " does not match the declared " + fixture.mode);
  }
  // Off the validated state, never off the fixture's request: if solveBudget were ever clamped
  // rather than rejected, a baseline key would otherwise name a budget the solver never ran at.
  const budgetMs = loaded.budgetMs;

  // A wall run reports throughput, so it must not carry the observer's per-checkpoint tax; every
  // other kind is measured in work units the observer cannot distort.
  const runOptions = { virtual, watchCheckpoints: virtual, workLimit };
  for (let seed = 0; seed < seedRuns; seed++) {
    ctx.resetRun(runOptions);
    ctx.solve();
  }

  ctx.resetRun(runOptions);
  const startedAt = performance.now();
  const result = ctx.solve();
  const wallMs = performance.now() - startedAt;
  const snap = ctx.snapshot();

  const metrics = {
    fixture: fixture.id,
    mode: fixture.mode,
    kind,
    budgetMs,
    seedRuns,
    lines: loaded.lines,
    objective: objectiveScalar(result && result.objective),
    result: summarize(fixture.mode, result),
    flags: flagsOf(fixture.mode, result),
    work: { total: snap.work.total, probe: snap.work.probe, dense: snap.work.dense, byLabel: snap.work.byLabel },
    // LP counters come off the meter wrapped around lpMaximize, so they exist even on the line-
    // switching project path, where the solver builds no control and `work` is therefore all zeros.
    lp: {
      pivots: snap.lp.pivots, tableauRows: snap.lp.tableauRows,
      work: snap.lp.work, workOnControl: snap.lp.workOnControl,
      refused: snap.lp.refused, interrupted: snap.lp.interrupted,
    },
    calls: snap.calls,
    events: snap.events,
    stopReasons: snap.stopReasons,
  };
  if (kind === "work") metrics.workLimit = workLimit;
  // Project mode times itself off the real clock, so its reported ms is a wall reading even on a
  // virtual run and belongs with the other non-deterministic fields. Items and Credits report their
  // control's clock, which under a virtual run is a pure function of the search.
  const reportedMs = Number.isFinite(result && result.ms) ? round(result.ms, 3) : null;
  if (virtual) {
    metrics.unitsPerMs = UNITS_PER_MS;
    metrics.denseUnitsPerMs = DENSE_UNITS_PER_MS;
    metrics.virtualMs = round(snap.virtualMs, 3);
    if (fixture.mode !== "project") metrics.reportedMs = reportedMs;
    metrics.nonDeterministic = {
      wallMs: round(wallMs, 1),
      lpMs: round(snap.lp.ms, 3),
    };
    if (fixture.mode === "project") metrics.nonDeterministic.reportedMs = reportedMs;
  } else {
    metrics.reportedMs = reportedMs;
    const seconds = wallMs / 1000;
    // Time inside lpMaximize is the dense currency's own clock; the rest of the run is the search.
    // Dividing an undifferentiated work total by an undifferentiated second is what makes a blended
    // throughput swing 5.7x with budget alone — see the header.
    const denseMs = snap.lp.ms, probeMs = Math.max(0, wallMs - denseMs);
    metrics.wall = {
      ms: round(wallMs, 1),
      probeMs: round(probeMs, 1),
      denseMs: round(denseMs, 1),
      probeWorkPerSec: probeMs > 0 ? Math.round(snap.work.probe / (probeMs / 1000)) : null,
      denseWorkPerSec: denseMs > 0 ? Math.round(snap.work.dense / (denseMs / 1000)) : null,
      totalWorkPerSec: seconds > 0 ? Math.round(snap.work.total / seconds) : null,
    };
  }
  return metrics;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const variance = n > 1 ? sorted.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / (n - 1) : 0;
  return {
    median: round(median, 3), min: sorted[0], max: sorted[n - 1],
    cvPct: mean > 0 ? round(100 * Math.sqrt(variance) / mean, 2) : 0,
  };
}

/* A measurement. Wall runs are repeated (each in a fresh realm) because one sample of a throughput
 * number whose run-to-run drift is the same size as the win being claimed is not evidence. The row
 * returned is the median sample by probe throughput, with the dispersion of every repeat attached
 * so a reader can size a delta against the noise that produced it. */
function runFixture(fixture, options) {
  const opts = options || {};
  const kind = opts.kind === "wall" ? "wall" : opts.kind === "work" ? "work" : "virtual";
  const repeat = kind === "wall" ? Math.max(1, Math.floor(Number(opts.repeat) || REPEAT_WALL)) : 1;
  if (repeat === 1) {
    const single = runOnce(fixture, opts);
    if (kind === "wall") single.wall.samples = 1;
    return single;
  }
  const samples = [];
  for (let i = 0; i < repeat; i++) samples.push(runOnce(fixture, opts));
  const throughputs = samples.map(sample => sample.wall.probeWorkPerSec || 0);
  const ordered = [...throughputs].sort((a, b) => a - b);
  const pick = ordered[Math.floor((ordered.length - 1) / 2)];
  const metrics = samples[throughputs.indexOf(pick)];
  metrics.wall = {
    samples: repeat,
    ms: stats(samples.map(sample => sample.wall.ms)),
    probeMs: stats(samples.map(sample => sample.wall.probeMs)),
    denseMs: stats(samples.map(sample => sample.wall.denseMs)),
    probeWorkPerSec: stats(throughputs),
    denseWorkPerSec: stats(samples.map(sample => sample.wall.denseWorkPerSec || 0)),
    totalWorkPerSec: stats(samples.map(sample => sample.wall.totalWorkPerSec || 0)),
  };
  // A wall run's objective is not reproducible the way a virtual one's is; the spread says whether
  // the plan itself moved between repeats or only the clock did.
  metrics.objectiveRange = [Math.min(...samples.map(s => s.objective)), Math.max(...samples.map(s => s.objective))];
  return metrics;
}

/* Work-to-reach-an-objective — acceptance criterion A1's Items metric, which no budget ladder can
 * express. `solveBudget` is clamped to 200 ms at the low end and every Items fixture has already
 * plateaued there (measured: 200, 220 and 250 ms all return 744475.5911111111 on items-7line), so
 * the curve has to be driven by work limits instead. The objective turns out to be a step, not a
 * climb — items-7line is infeasible below ~820k units and at its final value above ~825k — so what
 * this reports is the location of that step: the smallest work limit at which the run reaches the
 * objective it reaches with the budget it is given.
 *
 * Exponential search up to a limit that succeeds, then bisection to `precision` relative width. The
 * probe runs are virtual-clocked and deterministic, so the answer is reproducible on any machine.
 * A fixture whose objective is not monotone in work would return the crossing point the bisection
 * happens to land on; `probes` records how many runs paid for the answer. */
function measureWorkToObjective(fixture, options) {
  const opts = options || {};
  const budgetMs = opts.budgetMs;
  const precision = Number.isFinite(opts.precision) && opts.precision > 0 ? opts.precision : 0.02;
  const tolerance = Number.isFinite(opts.tolerance) ? opts.tolerance : 1e-9;
  // The reference: what this fixture reaches when it is allowed its whole budget.
  const reference = runOnce(fixture, { kind: "virtual", budgetMs });
  const target = reference.objective;
  let probes = 1;
  if (!(target > 0)) {
    return { fixture: fixture.id, budgetMs: reference.budgetMs, target, reached: false, probes,
      note: "fixture reports objective 0 at its full budget; there is no threshold to find" };
  }
  // A work limit lives on a solve control. The line-switching project path builds none, so nothing
  // there can be stopped at a work count — the same reason a user's budget cannot cancel it.
  if (!reference.calls.controls) {
    return { fixture: fixture.id, budgetMs: reference.budgetMs, target, reached: false, probes,
      note: "fixture builds no solve control, so no work limit applies to it" };
  }
  const reaches = limit => {
    probes++;
    const run = runOnce(fixture, { kind: "work", budgetMs, workLimit: limit });
    return { ok: run.objective >= target * (1 - tolerance), run };
  };
  let lo = 0, hi = 0, hit = null;
  for (let limit = Math.max(1000, Math.floor(reference.work.total / 512)); ; limit *= 2) {
    const probe = reaches(limit);
    if (probe.ok) { hi = limit; hit = probe.run; break; }
    lo = limit;
    if (limit >= reference.work.total) {
      return { fixture: fixture.id, budgetMs: reference.budgetMs, target, reached: false, probes,
        note: "no work limit up to the fixture's own total reached the budgeted objective" };
    }
  }
  while (hi - lo > hi * precision) {
    const mid = Math.floor((lo + hi) / 2);
    const probe = reaches(mid);
    if (probe.ok) { hi = mid; hit = probe.run; } else lo = mid;
  }
  return {
    fixture: fixture.id,
    budgetMs: reference.budgetMs,
    target,
    reached: true,
    probes,
    precision,
    workLimit: hi,
    lowerBound: lo,
    objective: hit.objective,
    work: { total: hit.work.total, probe: hit.work.probe, dense: hit.work.dense },
    controls: hit.calls.controls,
  };
}

function machine() {
  const cpus = os.cpus() || [];
  return {
    node: process.version,
    platform: process.platform + " " + process.arch,
    cpu: cpus.length ? cpus[0].model : "unknown",
    cores: cpus.length,
  };
}

// Two machine descriptors are comparable for throughput only when every field matches; a different
// Node build reorders enough of the JIT to move a throughput number on its own.
function sameMachine(a, b) {
  if (!a || !b) return false;
  return a.node === b.node && a.platform === b.platform && a.cpu === b.cpu && a.cores === b.cores;
}

module.exports = {
  UNITS_PER_MS, DENSE_UNITS_PER_MS, DENSE_LABELS, DEFAULT_LADDER, QUICK_LADDER, SOURCES, ROOT,
  MIN_BUDGET_MS, MAX_BUDGET_MS, REPEAT_WALL,
  createSolverContext, runOnce, runFixture, measureWorkToObjective, summarize, flagsOf,
  machine, sameMachine, stats, round,
};
