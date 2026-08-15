"use strict";
/* Bench harness self-test (WS0 of docs/SOLVER_PERF_DESIGN.md).
 *
 * The bench itself is opt-in (`npm run bench`) and never gates CI — wall-clock numbers would fail on
 * a slower machine. What CI does gate is that the harness still measures the thing it claims to:
 *
 *  - every corpus fixture is a state the app could actually produce (validateWorkerState accepts it)
 *    and it has the mode and line count it advertises;
 *  - a small virtual solve of each fixture returns a finite objective and well-formed metrics;
 *  - the same virtual run repeated in a fresh realm returns an IDENTICAL metrics document apart
 *    from the fields under `nonDeterministic` — the machine-independence guarantee every later
 *    workstream's before/after comparison rests on;
 *  - a re-run reaches the COMMITTED baseline's objective exactly, and its work counts are either the
 *    baseline's or a drift declared with a reason in test/perf/work-drift.json — so the baseline is
 *    a tripwire rather than a document, and stays the project's before-picture rather than being
 *    re-recorded around each change; and that baseline names its corpus and the machine its
 *    machine-dependent numbers came from;
 *  - no label outside the virtual clock's dense list ever charges more than one work unit, and
 *    every dense label does — the pricing check, made on observed behaviour rather than on a source
 *    grep, because the solver's dominant checkpoint call passes a computed label;
 *  - the harness realm still loads what the Worker loads.
 *
 * Usage: node test/perf-harness.cjs
 */

const fs = require("fs");
const path = require("path");

const { FIXTURES, materialize } = require("./perf/corpus.cjs");
const harness = require("./perf/harness.cjs");
const { createSolverContext, runFixture, DENSE_LABELS, SOURCES, UNITS_PER_MS, DENSE_UNITS_PER_MS } = harness;

const ROOT = path.join(__dirname, "..");
const BASELINE_PATH = path.join(__dirname, "perf", "baseline.json");
// Declared, reasoned differences from the baseline's work counts. The baseline itself is never
// re-recorded, so this is where a change that legitimately moves a checkpoint count is written down.
const DRIFT_PATH = path.join(__dirname, "perf", "work-drift.json");

// The floor boundedPersistedField clamps solveBudget to, so this is the cheapest run that still
// exercises the whole path. Two runs per fixture at this budget keep the suite in single seconds.
const SELF_TEST_BUDGET_MS = 200;

// What each fixture claims about the factory it describes. Stated here rather than read back off the
// fixture so a silent edit to corpus.cjs fails instead of redefining the corpus.
const EXPECTED = {
  "items-7line": { mode: "items", lines: 7 },
  "items-share-margin-7line": { mode: "items", lines: 7 },
  "items-8line": { mode: "items", lines: 8 },
  "items-10line": { mode: "items", lines: 10 },
  "credits-7line": { mode: "credits", lines: 7 },
  "project-7line": { mode: "project", lines: 7 },
  "project-seq-7line": { mode: "project", lines: 7 },
  // Line switching spends the run control inside the schedule LP's pivots rather than inside a
  // discrete search, so its whole work total is dense and its histogram holds only the LP labels.
  "project-split-7line": { mode: "project", lines: 7, denseOnly: true },
};

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + name + (detail ? " [" + detail + "]" : ""));
  if (!ok) failures++;
}

/* ---- the corpus describes states the app could produce ---- */

check("the corpus covers exactly the fixtures the design names",
  FIXTURES.length === Object.keys(EXPECTED).length && FIXTURES.every(fixture => EXPECTED[fixture.id]),
  FIXTURES.map(fixture => fixture.id).join(", "));

const loader = createSolverContext();
for (const fixture of FIXTURES) {
  const expected = EXPECTED[fixture.id];
  if (!expected) continue;
  const state = materialize(fixture, { budgetMs: SELF_TEST_BUDGET_MS });
  let loaded = null, error = null;
  try { loaded = loader.loadState(state); } catch (thrown) { error = thrown; }
  const mode = loaded && loaded.mode;
  check(fixture.id + " materializes into a state validateWorkerState accepts",
    error === null, error ? error.message : "mode=" + mode);
  check(fixture.id + " has the mode and line count it declares",
    mode === expected.mode && fixture.mode === expected.mode && state.lines.length === expected.lines,
    "mode=" + mode + " declared=" + fixture.mode + " lines=" + state.lines.length + " expected=" + expected.lines);
  check(fixture.id + " keeps one manual crafter row per line",
    Array.isArray(state.manual) && state.manual.length === state.lines.length,
    "manual=" + (state.manual || []).length + " lines=" + state.lines.length);
}

// The two variants exist for the solve multiplicity they add, so the edits that create it are named.
const shareState = materialize(FIXTURES.find(fixture => fixture.id === "items-share-margin-7line"));
check("the share/margin fixture really sets share mode and a margin",
  shareState.targetMode === "share" && shareState.margin === 5,
  "targetMode=" + shareState.targetMode + " margin=" + shareState.margin);

// The hidden prefer-current run is a second complete solve, so a fixture that claims to measure it
// has to be measured warm — and it only exists on the line-switching path, which is why the Set &
// forget fixture does not seed.
const splitFixture = FIXTURES.find(fixture => fixture.id === "project-split-7line");
const staticFixture = FIXTURES.find(fixture => fixture.id === "project-7line");
const seqFixture = FIXTURES.find(fixture => fixture.id === "project-seq-7line");
check("the line-switching project fixture declares the seed run its hidden comparison needs",
  splitFixture.seedRuns === 1 && materialize(splitFixture).projLineMode === "split",
  "seedRuns=" + splitFixture.seedRuns + " projLineMode=" + materialize(splitFixture).projLineMode);
check("the Set & forget project fixture stays on static lines and does not seed",
  !staticFixture.seedRuns && materialize(staticFixture).projLineMode === "static",
  "seedRuns=" + staticFixture.seedRuns + " projLineMode=" + materialize(staticFixture).projLineMode);
check("the sequenced project fixture is static lines, one project per phase",
  materialize(seqFixture).projLineMode === "static" && materialize(seqFixture).projectSeq === true,
  "projLineMode=" + materialize(seqFixture).projLineMode + " projectSeq=" + materialize(seqFixture).projectSeq);

/* ---- a virtual run is well formed, and identical in a fresh realm ---- */

// Everything a virtual run reports is a pure function of the fixture except this sub-object, which
// holds real-clock readings kept for triage. A baseline diff ignores it; nothing else may move.
const deterministic = run => {
  const copy = JSON.parse(JSON.stringify(run));
  delete copy.nonDeterministic;
  return JSON.stringify(copy);
};

const maxUnitsByLabel = new Map();

for (const fixture of FIXTURES) {
  const denseOnly = !!(EXPECTED[fixture.id] && EXPECTED[fixture.id].denseOnly);
  const options = { kind: "virtual", budgetMs: SELF_TEST_BUDGET_MS };
  const first = runFixture(fixture, options);
  const second = runFixture(fixture, options);

  for (const [label, bucket] of Object.entries(first.work.byLabel)) {
    if (!maxUnitsByLabel.has(label) || maxUnitsByLabel.get(label) < bucket.maxUnits) maxUnitsByLabel.set(label, bucket.maxUnits);
  }

  check(fixture.id + " reports a finite objective from a small virtual solve",
    Number.isFinite(first.objective) && first.objective >= 0,
    "objective=" + first.objective);
  check(fixture.id + " reports well-formed metrics",
    first.kind === "virtual" && first.budgetMs === SELF_TEST_BUDGET_MS && first.mode === fixture.mode &&
    typeof first.flags.capped === "boolean" && typeof first.flags.feasible === "boolean" &&
    first.calls.controls >= 1 && first.work.total > 0 && first.virtualMs > 0 &&
    Object.keys(first.work.byLabel).length > 0,
    "work=" + first.work.total + " virtualMs=" + first.virtualMs + " controls=" + first.calls.controls +
    " labels=" + Object.keys(first.work.byLabel).length);
  check(fixture.id + " splits its work into probe and dense units that add up",
    first.work.probe + first.work.dense === first.work.total && first.work.dense === first.lp.workOnControl &&
    first.work.probe >= 0 && first.work.dense >= 0,
    "probe=" + first.work.probe + " dense=" + first.work.dense + " total=" + first.work.total);
  check(fixture.id + " charges every histogram bucket a count, a work total and an elapsed time",
    Object.values(first.work.byLabel).every(bucket =>
      Number.isInteger(bucket.count) && bucket.count > 0 && Number.isFinite(bucket.work) &&
      Number.isFinite(bucket.ms) && Number.isFinite(bucket.maxUnits)),
    Object.keys(first.work.byLabel).length + " labels");

  // If this one fails, virtual runs are no longer machine-independent and no later workstream's
  // before/after comparison means anything: the baseline it is measured against was recorded on a
  // different machine. Find the nondeterminism; do not re-record the baseline around it.
  const reproduced = deterministic(first) === deterministic(second);
  check(fixture.id + " repeats identically in a fresh realm (the machine-independence guarantee)",
    reproduced,
    reproduced ? "objective " + first.objective + ", work " + first.work.total
      : first.objective !== second.objective ? "objective " + first.objective + " vs " + second.objective
      : first.work.total !== second.work.total ? "work " + first.work.total + " vs " + second.work.total
      : "metrics documents differ somewhere outside nonDeterministic");

  // Every dense unit in the solver is charged inside lpMaximize, so a run whose LP work is not on a
  // control is a run the user's solve-time setting cannot bound — which is what this asserts, not
  // merely that pivots were counted.
  //
  // Line switching is no longer dense-only. When its own plan carries a warm-up it also searches the
  // no-switch assignment (issue #150), and that search charges probe work. What still has to hold is
  // that NOTHING escapes the run control: the harness only records work it observes through a
  // control, so any probe work here is bounded work, and the LP totals must still reconcile exactly.
  if (denseOnly) {
    check(fixture.id + " charges every pivot it runs to a real solve control",
      first.calls.lpMaximize > 0 && first.lp.pivots > 0 && first.lp.work > 0 &&
      first.lp.workOnControl === first.lp.work,
      "LPs=" + first.calls.lpMaximize + " pivots=" + first.lp.pivots + " units=" + first.lp.work +
      " onControl=" + first.lp.workOnControl + " probe=" + first.work.probe);
  }

  // The fixture that exists for the hidden prefer-current comparison has to actually produce one,
  // or it is measuring a single run and the design's Project parallelization target has no fixture.
  if (fixture.id === "project-split-7line") {
    check("the line-switching project fixture really runs the hidden prefer-current comparison",
      first.result.hiddenComparisonRan === true && first.calls.projectPhase >= 2,
      "hiddenComparisonRan=" + first.result.hiddenComparisonRan +
      " phases solved=" + first.calls.projectPhase +
      " schedule LPs=" + first.calls.lpMaximize + " projectSchedule=" + first.calls.projectSchedule);
  }

  // The idle-line fills are a documented guarantee with no other footprint: stubbing them out leaves
  // eta, every phase field and every contract flag byte-identical. Recording what each pass did is
  // the only way losing one shows up as a metric change, so the recording itself is gated.
  if (fixture.mode === "project" && !denseOnly) {
    check(fixture.id + " records what each idle-line fill pass did, per phase",
      (first.result.phases || []).every(phase => phase.idleFill !== undefined && phase.lookAhead !== undefined) &&
      Number.isInteger(first.result.idleFillPhases) && Number.isInteger(first.result.lookAheadPhases),
      "phases=" + (first.result.phases || []).length + " filled=" + first.result.idleFillPhases +
      " banked ahead=" + first.result.lookAheadPhases);
  }
}

/* ---- a wall run is measured un-instrumented, and still reports both currencies ---- */

// js/solver.js calls the onCheckpoint observer on EVERY checkpoint, so installing one costs ~4.4% of
// a solve — a fixed tax on exactly the number a wall run exists to report, and one that grows as a
// share of the run as WS1 succeeds. Wall runs therefore install nothing: their totals come off the
// controls and their dense/probe split off the LP meter.
{
  const wall = runFixture(FIXTURES.find(fixture => fixture.id === "items-7line"),
    { kind: "wall", budgetMs: SELF_TEST_BUDGET_MS, repeat: 1 });
  check("a wall run reports probe and dense throughput separately and carries no histogram",
    Object.keys(wall.work.byLabel).length === 0 && wall.work.probe > 0 && wall.work.dense > 0 &&
    wall.wall.probeWorkPerSec > 0 && wall.wall.denseWorkPerSec > 0 && wall.wall.samples === 1,
    "probe/s=" + wall.wall.probeWorkPerSec + " dense/s=" + wall.wall.denseWorkPerSec +
    " labels=" + Object.keys(wall.work.byLabel).length);
}

/* ---- a seeded fixture reports the measured run, not the realm ---- */

// The virtual clock is monotone for the life of a realm so that a second solve cannot see time run
// backwards. A run therefore has to report the span it consumed; reporting the reading would bill a
// seeded fixture for its seed runs as well.
{
  const seeded = createSolverContext();
  seeded.resetStability();
  seeded.loadState(materialize(FIXTURES.find(fixture => fixture.id === "project-7line"), { budgetMs: SELF_TEST_BUDGET_MS }));
  seeded.resetRun({ virtual: true }); seeded.solve();
  const cold = seeded.snapshot();
  seeded.resetRun({ virtual: true }); seeded.solve();
  const warm = seeded.snapshot();
  check("a second run in the same realm reports its own virtual span, not the realm's clock reading",
    warm.virtualMs > 0 && Math.abs(warm.virtualMs - cold.virtualMs) < 1e-6,
    "first run " + cold.virtualMs + " ms, second run " + warm.virtualMs + " ms");
}

/* ---- the harness still measures the solver the app runs ---- */

// Behaviour, not syntax: a label that ever charges more than one unit is priced at DENSE_UNITS_PER_MS
// and everything else at UNITS_PER_MS, ~280x apart. Reading the charge sites out of the source
// cannot decide this — js/solver.js routes every solveCore probe through checkpoint(label) with a
// COMPUTED label, so a grep for quoted labels misses the very call shape that dominates the file,
// while a grep that keys off "has a second argument" flags an explicit cost of 1. What the observer
// saw across the whole corpus above cannot be fooled by either.
{
  const mispriced = [...maxUnitsByLabel.entries()].filter(([label, units]) => units > 1 && !DENSE_LABELS.includes(label));
  const unproven = DENSE_LABELS.filter(label => !(maxUnitsByLabel.get(label) > 1));
  check("no label outside the virtual clock's dense list ever charges more than one work unit",
    mispriced.length === 0,
    mispriced.length ? mispriced.map(([label, units]) => label + " charged " + units).join(", ")
      : maxUnitsByLabel.size + " labels observed, max units " +
        [...maxUnitsByLabel.entries()].filter(([, units]) => units > 1).map(([label, units]) => label + "=" + units).join(" "));
  check("every label the virtual clock prices as dense really does charge more than one unit",
    unproven.length === 0,
    unproven.length ? unproven.join(", ") + " never charged >1 on the corpus — either it is priced wrong or nothing exercises it"
      : DENSE_LABELS.join(", "));
}

/* Second net, over every source the harness loads rather than solver.js alone: find the charge sites
 * that pass a cost at all. A pure relay — a control wrapper forwarding its own (label, cost)
 * parameters verbatim — is not an independent site and is excluded by name; anything else that
 * charges is. This catches a new multi-unit site that the corpus above never happens to execute,
 * without depending on the label being executed.
 *
 * The test is on the LABELS, not on the number of sites: one dense label may legitimately be charged
 * from more than one place (the pivot loop and the certificate that closes it both cost a dense row
 * sweep and both bill `lp-pivot`), and counting sites would report that as a mispricing. What may
 * never happen is a multi-unit site under a label the clock prices at the probe rate, or a dense
 * label with no site behind it at all. */
function chargeSitesWithCost(source) {
  const sites = [], call = /\bcheckpoint(?:Within)?\s*\(/g;
  for (let match = call.exec(source); match; match = call.exec(source)) {
    let depth = 1, i = call.lastIndex, quote = null, current = "";
    const args = [];
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (quote) { current += ch; if (ch === "\\") { current += source[i + 1]; i += 2; continue; } if (ch === quote) quote = null; i++; continue; }
      if (ch === "\"" || ch === "'" || ch === "`") { quote = ch; current += ch; i++; continue; }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") { depth--; if (depth === 0) { i++; break; } }
      if (depth === 1 && ch === ",") { args.push(current.trim()); current = ""; i++; continue; }
      current += ch; i++;
    }
    args.push(current.trim());
    if (args.length < 2 || !args[1] || args[1] === "1") continue;      // no cost, or an explicit one unit
    if (args[0] === "label" && args[1] === "cost") continue;           // a wrapper relaying its caller
    sites.push({ label: args[0], cost: args[1] });
  }
  return sites;
}
{
  const found = [], priced = new Set(DENSE_LABELS.map(label => JSON.stringify(label)));
  for (const file of SOURCES) {
    for (const site of chargeSitesWithCost(fs.readFileSync(path.join(ROOT, file), "utf8"))) {
      found.push({ where: file + " " + site.label + " charges " + site.cost, label: site.label });
    }
  }
  const unpriced = found.filter(site => !priced.has(site.label));
  const unbacked = [...priced].filter(label => !found.some(site => site.label === label));
  check("every multi-unit charge site in the solver sources bills a label the clock prices as dense",
    unpriced.length === 0 && unbacked.length === 0,
    (unpriced.length ? "unpriced: " + unpriced.map(site => site.where).join(" | ") + ". " : "") +
    (unbacked.length ? "no site charges: " + unbacked.join(", ") + ". " : "") +
    found.length + " site(s) over " + DENSE_LABELS.length + " dense label(s): " + DENSE_LABELS.join(", "));
}

const workerSource = fs.readFileSync(path.join(ROOT, "js", "solver.worker.v2.js"), "utf8");
const imported = (workerSource.match(/importScripts\(([^)]*)\)/) || [, ""])[1]
  .split(",").map(part => part.trim().replace(/^["']|["']$/g, "")).filter(Boolean).map(file => "js/" + file);
check("the harness realm loads what the Worker loads, plus the catalog the page supplies",
  SOURCES.join(",") === ["js/catalog.js"].concat(imported).join(","),
  "harness=" + SOURCES.join(" ") + " | worker=" + imported.join(" "));

/* ---- the committed baseline is usable, and is a tripwire ---- */

let baseline = null, baselineError = null;
try { baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")); }
catch (error) { baselineError = error; }
check("the committed baseline parses", baseline !== null,
  baselineError ? baselineError.message : "test/perf/baseline.json");
if (baseline) {
  const covered = new Set((baseline.runs || []).map(run => run.fixture));
  const uncovered = FIXTURES.filter(fixture => !covered.has(fixture.id)).map(fixture => fixture.id);
  check("the committed baseline covers every corpus fixture", uncovered.length === 0,
    (baseline.runs || []).length + " runs, missing: " + (uncovered.join(", ") || "none"));
  // A baseline is read months later by someone deciding whether a number moved or the hardware did,
  // so it has to say what it measured, which numbers are hardware, and what hardware they came from.
  const captured = baseline.machine || {};
  check("the committed baseline names its schema, its corpus and the machine its wall numbers came from",
    typeof baseline.schema === "string" &&
    Array.isArray(baseline.corpus) && FIXTURES.every(fixture => baseline.corpus.some(entry => entry.id === fixture.id)) &&
    Array.isArray(baseline.machineDependent) && baseline.machineDependent.length > 0 &&
    typeof captured.node === "string" && typeof captured.platform === "string" &&
    typeof captured.cpu === "string" && Number.isFinite(captured.cores),
    baseline.schema + ", " + (baseline.corpus || []).length + " fixtures, " +
    [captured.node, captured.platform, captured.cpu, captured.cores + " cores"].join(" / "));
  check("the committed baseline was recorded at this virtual clock rate",
    baseline.unitsPerMs === UNITS_PER_MS && baseline.denseUnitsPerMs === DENSE_UNITS_PER_MS,
    "baseline=" + baseline.unitsPerMs + "/" + baseline.denseUnitsPerMs +
    " harness=" + UNITS_PER_MS + "/" + DENSE_UNITS_PER_MS);
  check("every baseline run carries the objective and work a comparison reads",
    (baseline.runs || []).length > 0 && baseline.runs.every(run =>
      typeof run.fixture === "string" && (run.kind === "wall" || run.kind === "virtual") &&
      Number.isFinite(run.budgetMs) && Number.isFinite(run.objective) &&
      Number.isFinite(run.work && run.work.total) && Number.isFinite(run.work && run.work.probe) &&
      Number.isFinite(run.work && run.work.dense) && Number.isFinite(run.lp && run.lp.pivots)),
    (baseline.runs || []).length + " runs");
  check("no baseline virtual run carries a real-clock reading outside nonDeterministic",
    (baseline.runs || []).filter(run => run.kind === "virtual").every(run => run.wallMsInformational === undefined &&
      (run.mode !== "project" || run.reportedMs === undefined)),
    "re-recording must not produce churn a reviewer cannot tell from a real change");
  check("the committed baseline includes a virtual run at the reference save's own 20 s budget",
    (baseline.runs || []).some(run => run.kind === "virtual" && run.budgetMs === 20000),
    "budgets: " + [...new Set((baseline.runs || []).map(run => run.kind + "@" + run.budgetMs))].join(" "));
  check("the committed baseline records work-to-objective for the Items fixtures",
    (baseline.workToObjective || []).some(entry => entry.fixture === "items-7line" && entry.reached === true),
    (baseline.workToObjective || []).length + " bisections recorded");

  /* The baseline is only a tripwire if something re-runs against it. One cheap virtual rung is what
   * makes "the baseline was recorded on another machine" and "the search changed" distinguishable
   * without running the whole bench.
   *
   * The baseline is the project's before-picture and is never re-recorded, so a workstream that
   * legitimately moves a checkpoint count cannot silence this by rewriting what it is measured
   * against. It declares the new counts in test/perf/work-drift.json with a reason instead, and the
   * rung then has to reproduce EITHER the baseline or its declaration. An undeclared change fails,
   * which is the property the exact compare had; a declared one is reviewable as a diff of the
   * reason next to the numbers.
   *
   * The objective is outside that concession. It must reproduce the baseline whatever the work
   * counts did — a run that finds a different plan is a quality change, not drift, and the bench's
   * --allow-work-change has no equivalent for it either. */
  const rung = (baseline.runs || []).find(run => run.fixture === "items-7line" && run.kind === "virtual" &&
    run.budgetMs === 250 && run.lp && run.work && Number.isFinite(run.work.probe));
  if (!rung) check("the committed baseline holds the items-7line virtual 250 ms rung this test re-runs", false,
    "rung missing, or recorded before the probe/dense split existed");
  else {
    let drift = null, driftError = null;
    try { drift = JSON.parse(fs.readFileSync(DRIFT_PATH, "utf8")); }
    catch (error) { driftError = error; }
    check("the declared work drift parses and every entry names a reason",
      drift !== null && Array.isArray(drift.runs) &&
      drift.runs.every(entry => typeof entry.reason === "string" && entry.reason.trim().length > 20),
      driftError ? driftError.message : (drift.runs || []).length + " declared run(s)");

    const now = runFixture(FIXTURES.find(fixture => fixture.id === "items-7line"), { kind: "virtual", budgetMs: 250 });
    const labelCounts = run => Object.keys(run.work.byLabel).sort()
      .map(label => label + "=" + run.work.byLabel[label].count + "/" + run.work.byLabel[label].work).join(",");
    const declared = ((drift && drift.runs) || []).find(entry => entry.fixture === "items-7line" &&
      entry.kind === "virtual" && entry.budgetMs === 250) || null;
    const matches = expected => !!expected && now.work.total === expected.work.total &&
      now.work.probe === expected.work.probe && now.work.dense === expected.work.dense &&
      now.lp.pivots === expected.lp.pivots &&
      labelCounts(now) === (expected.byLabel !== undefined ? expected.byLabel : labelCounts(expected)) &&
      JSON.stringify(now.calls) === JSON.stringify(expected.calls);
    const reproducesBaseline = matches(rung), reproducesDeclared = matches(declared);

    check("the items-7line virtual 250 ms rung still reaches the baseline's objective exactly",
      now.objective === rung.objective,
      "objective " + now.objective + " vs " + rung.objective);
    check("the items-7line virtual 250 ms rung's work counts are the baseline's or a declared drift from it",
      reproducesBaseline || reproducesDeclared,
      reproducesBaseline ? "unchanged since Phase 0"
        : reproducesDeclared ? "declared: " + declared.reason
        : "work " + now.work.total + " vs baseline " + rung.work.total +
          (declared ? " / declared " + declared.work.total : " (nothing declared)") +
          ", pivots " + now.lp.pivots + " vs " + rung.lp.pivots +
          (labelCounts(now) === labelCounts(rung) ? "" : ", per-label counts differ"));
    // A declaration that has been overtaken is as misleading as none: it describes a solver that no
    // longer exists and it silences the tripwire for the run it names.
    check("no declared drift describes work the solver no longer does",
      !declared || reproducesDeclared || reproducesBaseline,
      declared ? "declared total " + declared.work.total + ", measured " + now.work.total : "nothing declared");
  }
}

console.log("");
console.log(failures ? (failures + " perf-harness test(s) failed") : "all perf-harness tests passed");
process.exit(failures ? 1 : 0);
