"use strict";
/* Solver bench CLI (WS0 of docs/SOLVER_PERF_DESIGN.md). Opt-in: `npm run bench`, never `npm test`.
 *
 *   npm run bench                                  every fixture, wall + virtual, saved 20 s budget
 *   npm run bench -- --quick                       short virtual ladder, ~a minute
 *   npm run bench -- --sweep                       the full virtual budget ladder, plus wall runs
 *   npm run bench -- --fixture items-7line --kind virtual --budget 4000
 *   npm run bench -- --sweep --baseline test/perf/baseline.json
 *   npm run bench -- --sweep --work-to-objective --repeat 5 --write-baseline test/perf/baseline.json
 *
 * A full sweep with wall repeats takes ten-odd minutes; --quick is the sanity run.
 *
 * Writes one JSON report into test-results/ (gitignored) and prints a table. With --baseline it
 * also prints deltas and applies two gates, both of them machine-independent:
 *
 *   QUALITY, on virtual runs. In ratio mode the gate is `objective`; a drop of more than 0.1% is a
 *     regression (acceptance criterion A2 verbatim). In SHARE mode `objective` is the plan divided
 *     by a calibration ceiling the solver searches for, and that ceiling improves with budget — an
 *     unchanged plan scores 0.876% lower at 20000 ms than at 4000 ms on items-share-margin-7line —
 *     so share-mode runs are gated per output on the absolute `result.out` vector instead.
 *
 *   WORK IDENTITY, on virtual runs. A virtual run is bit-reproducible, so its work totals, its
 *     per-label checkpoint counts, its LP pivot counts and its component-solve counts must all
 *     reproduce the baseline exactly. That is WS1's own invariant ("identical search semantics for
 *     1-4: same probe order, same acceptances") stated as something a machine can check. The
 *     workstreams that legitimately move those counts (WS1.5's restricted repair set, WS2's
 *     memoization, WS4's LNS operator) pass --allow-work-change and the gate becomes informational.
 *
 * Wall-clock and throughput are INFORMATIONAL and never fail the run. Nothing here gates on
 * anything a slower machine would fail.
 */

const fs = require("fs");
const path = require("path");

const { FIXTURES, fixtureById } = require("./corpus.cjs");
const harness = require("./harness.cjs");
const {
  runFixture, measureWorkToObjective, DEFAULT_LADDER, QUICK_LADDER, UNITS_PER_MS, DENSE_UNITS_PER_MS,
  MIN_BUDGET_MS, MAX_BUDGET_MS, REPEAT_WALL, machine, sameMachine, round,
} = harness;

const ROOT = path.join(__dirname, "..", "..");
const DEFAULT_OUT = path.join(ROOT, "test-results", "solver-bench.json");

// A drop beyond this on a virtual run is a quality regression, not float-trajectory drift. It is
// acceptance criterion A2 verbatim.
const OBJECTIVE_TOLERANCE = 0.001;

const USAGE = `usage: node test/perf/bench.cjs [options]

  --fixture <id>          run only this fixture (repeatable); default: all
  --kind wall|virtual|both  default: both (--quick runs virtual only)
  --budget <ms>           override the saved solve budget (${MIN_BUDGET_MS}..${MAX_BUDGET_MS}) for the non-sweep runs
  --repeat <n>            wall repeats per measurement (default ${REPEAT_WALL}); virtual runs never repeat
  --sweep                 virtual runs across the full budget ladder (${DEFAULT_LADDER.join(", ")} ms)
  --quick                 virtual runs across a short ladder (${QUICK_LADDER.join(", ")} ms); fast sanity run
  --work-to-objective     also bisect work-to-reach-the-budgeted-objective per fixture (A1's Items metric)
  --out <path>            report JSON destination (default test-results/solver-bench.json)
  --baseline <path>       compare against a recorded baseline; quality and work identity gate
  --allow-work-change     downgrade the work-identity gate to informational (WS1.5 / WS2 / WS4)
  --write-baseline <path> write this run's report to <path> as well
  --help

fixtures: ${FIXTURES.map(fixture => fixture.id).join(", ")}
`;

function parseArgs(argv) {
  const opts = {
    fixtures: [], kind: "both", kindGiven: false, budgetMs: null, repeat: REPEAT_WALL,
    sweep: false, quick: false, workToObjective: false, allowWorkChange: false,
    out: DEFAULT_OUT, baseline: null, writeBaseline: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i], next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(arg + " needs a value");
      return value;
    };
    if (arg === "--help" || arg === "-h") return null;
    else if (arg === "--fixture") opts.fixtures.push(next());
    else if (arg === "--kind") { opts.kind = next(); opts.kindGiven = true; }
    else if (arg === "--budget") opts.budgetMs = Number(next());
    else if (arg === "--repeat") opts.repeat = Number(next());
    else if (arg === "--sweep") opts.sweep = true;
    else if (arg === "--quick") opts.quick = true;
    else if (arg === "--work-to-objective") opts.workToObjective = true;
    else if (arg === "--allow-work-change") opts.allowWorkChange = true;
    else if (arg === "--out") opts.out = path.resolve(next());
    else if (arg === "--baseline") opts.baseline = path.resolve(next());
    else if (arg === "--write-baseline") opts.writeBaseline = path.resolve(next());
    else throw new Error("unknown option: " + arg);
  }
  if (!["wall", "virtual", "both"].includes(opts.kind)) throw new Error("--kind must be wall, virtual or both");
  // solveBudget is a persisted field the state schema rejects outside this range, so an out-of-range
  // budget is a bad flag rather than a run that fails deep inside validateWorkerState.
  if (opts.budgetMs !== null && !(Number.isFinite(opts.budgetMs) && opts.budgetMs >= MIN_BUDGET_MS && opts.budgetMs <= MAX_BUDGET_MS)) {
    throw new Error("--budget must be between " + MIN_BUDGET_MS + " and " + MAX_BUDGET_MS + " ms (the persisted solveBudget range)");
  }
  if (!(Number.isFinite(opts.repeat) && opts.repeat >= 1)) throw new Error("--repeat must be 1 or more");
  // Both of these used to be silently discarded, which reads as a run that honoured the flag.
  if (opts.quick && opts.kindGiven && opts.kind !== "virtual") throw new Error("--quick runs virtual only; drop --kind " + opts.kind);
  if ((opts.sweep || opts.quick) && opts.budgetMs !== null) throw new Error("--budget cannot be combined with --sweep/--quick: the ladder sets the virtual budgets");
  return opts;
}

/* The run plan. A wall budget is never swept: wall runs cost their budget in real seconds and their
 * only readable number — probe throughput — does not need a ladder to be read. */
function planRuns(opts) {
  const fixtures = opts.fixtures.length ? opts.fixtures.map(fixtureById) : FIXTURES;
  const ladder = opts.quick ? QUICK_LADDER : opts.sweep ? DEFAULT_LADDER : null;
  const kinds = opts.quick ? ["virtual"] : opts.kind === "both" ? ["wall", "virtual"] : [opts.kind];
  const plan = [];
  for (const fixture of fixtures) {
    if (kinds.includes("wall")) plan.push({ fixture, kind: "wall", budgetMs: opts.budgetMs });
    if (kinds.includes("virtual")) {
      // A fixture with no solve control has no deadline to sweep; laddering it would print the same
      // row four times.
      const budgets = ladder && !fixture.budgetInsensitive ? ladder : [opts.budgetMs];
      for (const budgetMs of budgets) plan.push({ fixture, kind: "virtual", budgetMs });
    }
  }
  return { plan, ladder };
}

const runKey = run => run.fixture + "|" + run.kind + "|" + run.budgetMs;

function fmt(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6 || magnitude < 1e-3) return value.toExponential(4);
  return String(round(value, 4));
}

function pad(text, width, right) {
  const value = String(text);
  if (value.length >= width) return value;
  const fill = " ".repeat(width - value.length);
  return right ? fill + value : value + fill;
}

const medianOf = value => (value && typeof value === "object" ? value.median : value);

function printTable(runs) {
  const columns = [
    ["fixture", 26, false, run => run.fixture],
    ["kind", 8, false, run => run.kind],
    ["budget", 7, true, run => run.budgetMs],
    ["objective", 13, true, run => fmt(run.objective)],
    // The nominal budget is not always the clock the run spent: a static Project run whose search
    // parks a line hands the idle-line fill its own floor-1200 ms clock on top, so the 250 ms rung
    // of project-7line actually consumes 570 virtual ms and the 1000 ms rung 1320. Printing the
    // clock beside the budget is what stops that reading as a flat objective-vs-budget curve.
    ["clock ms", 10, true, run => run.kind === "wall" ? fmt(medianOf(run.wall.ms)) : fmt(run.virtualMs)],
    ["probe work", 12, true, run => run.work.probe],
    ["dense work", 12, true, run => run.work.dense],
    ["probe/s", 10, true, run => run.kind === "wall" ? fmt(medianOf(run.wall.probeWorkPerSec)) : "-"],
    ["cv%", 6, true, run => run.kind === "wall" && run.wall.probeWorkPerSec && run.wall.probeWorkPerSec.cvPct !== undefined ? run.wall.probeWorkPerSec.cvPct : "-"],
    ["pivots", 8, true, run => run.lp.pivots],
    ["capped", 7, false, run => fmt(run.flags.capped)],
    ["solves", 7, true, run => run.calls.solveCore],
    ["LPs", 5, true, run => run.calls.lpMaximize],
  ];
  console.log(columns.map(([title, width, right]) => pad(title, width, right)).join(" "));
  console.log(columns.map(([, width]) => "-".repeat(width)).join(" "));
  for (const run of runs) console.log(columns.map(([, width, right, read]) => pad(read(run), width, right)).join(" "));
}

/* Top work labels for one run, so a report is readable without opening the JSON. Wall runs carry no
 * histogram on purpose: the per-checkpoint observer that builds it costs ~4.4% of the solve, which
 * is a tax on exactly the number a wall run exists to report. */
function printHistogram(run, top) {
  const entries = Object.entries(run.work.byLabel).slice(0, top);
  if (!entries.length) return;
  const total = run.work.total || 1;
  console.log("  " + run.fixture + " " + run.kind + " @" + run.budgetMs + "ms  " +
    entries.map(([label, bucket]) => label + " " + bucket.count + "x/" + Math.round(100 * bucket.work / total) + "%").join("  "));
}

/* What a virtual run must reproduce bit-for-bit. Only fields the baseline actually carries are
 * compared, so an older baseline degrades to comparing less rather than to failing on absence. */
function workFields(run) {
  // Sorted by label, not by the histogram's own work-descending order: two runs that charge exactly
  // the same counts but rank two labels differently are identical searches, not a regression.
  const labels = Object.entries((run.work && run.work.byLabel) || {})
    .map(([label, bucket]) => label + "=" + bucket.count + "/" + bucket.work).sort().join(",");
  return {
    "work.total": run.work && run.work.total,
    "work.probe": run.work && run.work.probe,
    "work.dense": run.work && run.work.dense,
    "lp.pivots": run.lp && run.lp.pivots,
    "lp.tableauRows": run.lp && run.lp.tableauRows,
    "lp.work": run.lp && run.lp.work,
    "calls": run.calls && JSON.stringify(run.calls),
    "work.byLabel": labels,
  };
}

function workDiff(prior, run) {
  const before = workFields(prior), after = workFields(run), differ = [];
  for (const key of Object.keys(before)) {
    if (before[key] === undefined) continue;                     // baseline predates the field
    if (before[key] !== after[key]) differ.push(key);
  }
  return differ;
}

/* Quality comparison for one run. Share-of-max mode is normalized by a ceiling the solver itself
 * improves with budget, so its `objective` is not a quantity two runs can be compared on; the plan
 * vector is. */
function qualityVerdict(prior, run) {
  const share = run.result && run.result.mixMode === "share";
  if (share) {
    const before = (prior.result && prior.result.out) || null, after = (run.result && run.result.out) || null;
    if (!before || !after) return { gated: false, note: "share run without an out vector" };
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    // An all-zero baseline plan records a budget at which the search never found one. Nothing can
    // fall below it, so calling the row "ok" would report a gate that never ran.
    if (!keys.some(key => Number(before[key]) > 0)) return { gated: false, note: "baseline plan is all zeros" };
    const dropped = [];
    for (const key of keys) {
      const was = Number(before[key]) || 0, now = Number(after[key]) || 0;
      if (was > 0 && now < was * (1 - OBJECTIVE_TOLERANCE)) dropped.push(key + " " + fmt(was) + " -> " + fmt(now));
    }
    const worst = keys.reduce((low, key) => {
      const was = Number(before[key]) || 0, now = Number(after[key]) || 0;
      if (!(was > 0)) return low;
      const pct = 100 * (now - was) / was;
      return low === null || pct < low ? pct : low;
    }, null);
    return { gated: true, basis: "out", deltaPct: worst, regressed: dropped.length > 0, detail: dropped.join("; ") };
  }
  const before = Number(prior.objective) || 0, after = Number(run.objective) || 0;
  // A baseline of 0 records a budget at which the search never found a feasible plan. `after < 0`
  // is impossible, so no future value can fail against it — say so rather than print "ok".
  if (!(before > 0)) {
    return { gated: false, note: "baseline objective 0", deltaPct: after > 0 ? Infinity : 0 };
  }
  const deltaPct = 100 * (after - before) / before;
  return { gated: true, basis: "objective", deltaPct, regressed: after < before * (1 - OBJECTIVE_TOLERANCE) };
}

function compare(runs, baseline, opts) {
  const byKey = new Map((baseline.runs || []).map(run => [runKey(run), run]));
  const comparable = sameMachine(baseline.machine, machine());
  const rows = [], regressions = [];
  let matched = 0, qualityGated = 0, workGated = 0;
  for (const run of runs) {
    const prior = byKey.get(runKey(run));
    if (!prior) { rows.push({ run, prior: null }); continue; }
    matched++;
    const virtual = run.kind === "virtual";
    const quality = virtual ? qualityVerdict(prior, run) : { gated: false, note: "wall run" };
    if (quality.gated) qualityGated++;
    const differ = virtual ? workDiff(prior, run) : [];
    const workBroken = virtual && differ.length > 0 && !opts.allowWorkChange;
    if (virtual && !opts.allowWorkChange) workGated++;
    if (quality.regressed) regressions.push({ run, prior, kind: "quality", quality });
    if (workBroken) regressions.push({ run, prior, kind: "work", differ });
    rows.push({ run, prior, quality, differ, workBroken });
  }
  if (!comparable) {
    console.log("");
    console.log("! baseline machine " + [baseline.machine && baseline.machine.cpu, baseline.machine && baseline.machine.node].join(" / ") +
      " differs from this one " + [machine().cpu, machine().node].join(" / ") +
      "; throughput deltas are suppressed (work and objective comparisons are machine-independent)");
  }
  console.log("");
  console.log("comparison against baseline (quality and work identity gate on virtual runs only)");
  console.log(pad("fixture", 26) + " " + pad("kind", 8) + " " + pad("budget", 7, true) + " " +
    pad("baseline", 13, true) + " " + pad("current", 13, true) + " " + pad("delta%", 9, true) + " " +
    pad("work", 10, false) + " " + pad("throughput delta%", 18, true) + " verdict");
  for (const row of rows) {
    if (!row.prior) {
      console.log(pad(row.run.fixture, 26) + " " + pad(row.run.kind, 8) + " " + pad(row.run.budgetMs, 7, true) + "  (no baseline entry)");
      continue;
    }
    const priorThroughput = medianOf(row.prior.wall && row.prior.wall.probeWorkPerSec);
    const nowThroughput = medianOf(row.run.wall && row.run.wall.probeWorkPerSec);
    const throughput = !comparable ? "cross-machine"
      : priorThroughput > 0 && nowThroughput > 0 ? round(100 * (nowThroughput - priorThroughput) / priorThroughput, 1) : "-";
    const workCell = row.run.kind !== "virtual" ? "-"
      : row.differ.length === 0 ? "identical"
      : opts.allowWorkChange ? "changed*" : "DIFFERS";
    const verdict = row.quality.regressed ? "REGRESSION"
      : row.workBroken ? "WORK CHANGED"
      : row.quality.gated ? "ok (" + row.quality.basis + ")"
      : "ungated: " + row.quality.note;
    console.log(pad(row.run.fixture, 26) + " " + pad(row.run.kind, 8) + " " + pad(row.run.budgetMs, 7, true) + " " +
      pad(fmt(row.prior.objective), 13, true) + " " + pad(fmt(row.run.objective), 13, true) + " " +
      pad(Number.isFinite(row.quality.deltaPct) ? round(row.quality.deltaPct, 3) : "-", 9, true) + " " +
      pad(workCell, 10, false) + " " +
      pad(throughput, 18, true) + " " + verdict);
    if (row.differ && row.differ.length) console.log(pad("", 26) + "   work fields that moved: " + row.differ.join(", "));
  }
  const missing = (baseline.runs || []).filter(run => !runs.some(current => runKey(current) === runKey(run)));
  if (missing.length) console.log("(" + missing.length + " baseline run(s) not re-run in this invocation)");
  return { regressions, matched, qualityGated, workGated };
}

function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (error) { console.error(error.message); console.error("");
    console.error(USAGE); return 2; }
  if (!opts) { console.log(USAGE); return 0; }

  let planned;
  try { planned = planRuns(opts); } catch (error) { console.error(error.message); return 2; }
  const runs = [];
  const startedAt = Date.now();
  try {
    for (const item of planned.plan) {
      process.stdout.write("running " + item.fixture.id + " " + item.kind +
        (item.budgetMs ? " @" + item.budgetMs + "ms" : " @saved budget") +
        (item.kind === "wall" && opts.repeat > 1 ? " x" + opts.repeat : "") + " ...");
      const at = Date.now();
      runs.push(runFixture(item.fixture, { kind: item.kind, budgetMs: item.budgetMs, repeat: opts.repeat }));
      console.log(" " + (Date.now() - at) + "ms");
    }
  } catch (error) { console.error(""); console.error("run failed: " + error.message); return 2; }

  const workToObjective = [];
  if (opts.workToObjective) {
    const fixtures = opts.fixtures.length ? opts.fixtures.map(fixtureById) : FIXTURES;
    for (const fixture of fixtures) {
      process.stdout.write("bisecting work-to-objective for " + fixture.id + " ...");
      const at = Date.now();
      try { workToObjective.push(measureWorkToObjective(fixture, { budgetMs: opts.budgetMs })); }
      catch (error) { console.log(""); console.error("run failed: " + error.message); return 2; }
      console.log(" " + (Date.now() - at) + "ms");
    }
  }

  const report = {
    schema: "forge-solver-bench/3",
    generatedAt: new Date().toISOString(),
    // The corpus as it stood when this was recorded. Without it, a baseline missing a fixture reads
    // as a corpus that never had one rather than as an incomplete capture.
    corpus: FIXTURES.map(fixture => ({ id: fixture.id, mode: fixture.mode, title: fixture.title })),
    // What in this document depends on the machine below, and is therefore informational. A wall run
    // is machine-dependent in its entirety — its objective is whatever search fit inside a real
    // budget — and a virtual run keeps real-clock readings for triage under `nonDeterministic`.
    // Everything else is a pure function of the fixture, and is what later workstreams are gated on.
    machineDependent: ["runs[kind=wall]", "runs[kind=virtual].nonDeterministic", "elapsedMs"],
    machine: machine(),
    unitsPerMs: UNITS_PER_MS,
    denseUnitsPerMs: DENSE_UNITS_PER_MS,
    ladder: planned.ladder,
    wallRepeat: opts.repeat,
    elapsedMs: Date.now() - startedAt,
    runs,
    workToObjective,
  };
  const json = JSON.stringify(report, null, 2) + "\n";
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, json);
  if (opts.writeBaseline) {
    fs.mkdirSync(path.dirname(opts.writeBaseline), { recursive: true });
    fs.writeFileSync(opts.writeBaseline, json);
  }

  console.log("");
  printTable(runs);
  if (workToObjective.length) {
    console.log("");
    console.log("work to reach the budgeted objective (A1's Items metric; bisected on an exact work limit)");
    for (const entry of workToObjective) {
      console.log("  " + pad(entry.fixture, 26) + " " +
        (entry.reached
          ? pad(entry.workLimit, 12, true) + " units (>" + entry.lowerBound + ", " + entry.probes + " probes) objective " + fmt(entry.objective)
          : "(" + entry.note + ")"));
    }
  }
  console.log("");
  console.log("work histogram (top labels by share of total work; virtual runs only)");
  for (const run of runs) printHistogram(run, 6);
  console.log("");
  console.log("report: " + opts.out);
  if (opts.writeBaseline) console.log("baseline written: " + opts.writeBaseline);

  if (!opts.baseline) return 0;
  let baseline;
  try { baseline = JSON.parse(fs.readFileSync(opts.baseline, "utf8")); }
  catch (error) { console.error("cannot read baseline " + opts.baseline + ": " + error.message); return 2; }
  if (baseline.unitsPerMs !== UNITS_PER_MS || baseline.denseUnitsPerMs !== DENSE_UNITS_PER_MS) {
    console.error("baseline was recorded at a different virtual clock rate (" + baseline.unitsPerMs + "/" +
      baseline.denseUnitsPerMs + " vs " + UNITS_PER_MS + "/" + DENSE_UNITS_PER_MS + "); its budgets mean something else");
    return 2;
  }
  const outcome = compare(runs, baseline, opts);
  console.log("");
  if (!outcome.matched) {
    console.error("no run in this invocation matched a baseline entry — nothing was compared " +
      "(a --fixture typo or a corpus rename reads exactly like this)");
    return 2;
  }
  if (outcome.regressions.length) {
    console.error(outcome.regressions.length + " gate failure(s):");
    for (const item of outcome.regressions) {
      if (item.kind === "quality") {
        console.error("  quality  " + item.run.fixture + " @" + item.run.budgetMs + "ms  " +
          (item.quality.basis === "out"
            ? "outputs fell beyond " + (OBJECTIVE_TOLERANCE * 100) + "%: " + item.quality.detail
            : fmt(item.prior.objective) + " -> " + fmt(item.run.objective) + " (" + round(item.quality.deltaPct, 3) + "%)"));
      } else {
        console.error("  work     " + item.run.fixture + " @" + item.run.budgetMs + "ms  " +
          "no longer reproduces the baseline: " + item.differ.join(", ") +
          " (pass --allow-work-change if this workstream is meant to move them)");
      }
    }
    return 1;
  }
  console.log("compared " + outcome.matched + " run(s): quality gated on " + outcome.qualityGated +
    ", work identity gated on " + outcome.workGated + (opts.allowWorkChange ? " (work gate downgraded)" : "") + " — all clear");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
