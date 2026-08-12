"use strict";
/* Solver bench fixture corpus (WS0 of docs/SOLVER_PERF_DESIGN.md).
 *
 * One committed reference save — fixtures/lategame-7line.json, a real late-game factory: 7
 * heterogeneous lines from 16384x down to 512x, every item priced, a 10-project list, Set & forget
 * with gating off, 20 s budget — drives every fixture below. Each fixture is a complete saved state
 * derived from that one by a deterministic edit, so the corpus stays one file to re-capture when the
 * game moves on, and every fixture still loads through the same validateWorkerState boundary the
 * Worker uses.
 *
 * Deriving rather than committing eight near-duplicate 28 KB saves keeps the corpus honest: there is
 * no second copy of the reference numbers to drift out of sync with the first. The cost is that a
 * fixture can only exercise what THIS factory does — where that leaves a documented gap, the
 * fixture's notes say so in measured terms rather than implying coverage.
 *
 *   const { FIXTURES, materialize } = require("./corpus.cjs");
 *   const state = materialize(FIXTURES[0]);        // a saved state, ready for validateWorkerState
 */

const fs = require("fs");
const path = require("path");

const REFERENCE_PATH = path.join(__dirname, "fixtures", "lategame-7line.json");

function referenceState() {
  return JSON.parse(fs.readFileSync(REFERENCE_PATH, "utf8"));
}

/* A line the player unlocks next arrives at the smallest compression they already run and a little
 * slower than the slowest line they own. Distinct speeds are the point: identical lines would let the
 * DFS's identical-line symmetry skip fire, which it almost never does on the real save.
 *
 * The manual crafter row is appended alongside, exactly as the app's own add-line edit does: state
 * validation requires one manual entry per line, so a fixture that only grew `lines` would be a save
 * the app could never produce and validateWorkerState would reject it. */
function expandLines(state, extra) {
  const slowest = state.lines[state.lines.length - 1];
  for (let k = 1; k <= extra; k++) {
    const line = {
      max: slowest.max,
      spx: Math.round(slowest.spx * Math.pow(0.96, k) * 100) / 100,
      turbo: slowest.turbo,
    };
    state.lines.push(line);
    state.manual.push({ job: "Idle", lvl: line.max, sell: false });
  }
}

const FIXTURES = [
  {
    id: "items-7line",
    mode: "items",
    title: "Items — reference factory, 7 lines",
    notes: "The saved target mix (Glass, Bricks, Plates, Rods, Gel) in ratio mode. The plain " +
      "discrete search: one solveCore chain behind one user action.",
    derive(state) {
      state.mode = "items";
    },
  },
  {
    id: "items-share-margin-7line",
    mode: "items",
    title: "Items — share-of-max mix with a 5% margin, 7 lines",
    notes: "Share mode adds one calibration solve per checked output, and a margin runs every " +
      "stage of the search twice (strict, then the user's tolerance). This is the per-action " +
      "solve multiplicity the design attributes solve-time growth to.",
    derive(state) {
      state.mode = "items";
      state.targetMode = "share";
      state.margin = 5;
    },
  },
  {
    id: "items-8line",
    mode: "items",
    title: "Items — 8 lines (the planned expansion)",
    notes: "The 8th line the game is planned to expose.",
    derive(state) {
      state.mode = "items";
      expandLines(state, 1);
    },
  },
  {
    id: "items-10line",
    mode: "items",
    title: "Items — 10 lines (the planning ceiling)",
    notes: "Headroom fixture: ~10 lines is the realistic ceiling. fields.js maxLines:64 is a " +
      "state-validation bound and is deliberately not exercised here.",
    derive(state) {
      state.mode = "items";
      expandLines(state, 3);
    },
  },
  {
    id: "credits-7line",
    mode: "credits",
    title: "Credits — all 12 items priced, 7 lines",
    notes: "A whole-factory plan per priced item: 12 baselines in catalog order, then fair " +
      "refinement slices against one shared clock.",
    derive(state) {
      state.mode = "credits";
    },
  },
  {
    id: "project-7line",
    mode: "project",
    title: "Project — Set & forget, one combined phase, gating off",
    notes: "Static line mode, gating off, so the whole 10-project list solves as one phase. No " +
      "seed run: staticSchedule returns stabilized:false unconditionally, so line stability never " +
      "records anything in this mode and the hidden prefer-current comparison cannot run however " +
      "many times the same factory is solved. project-split-7line covers that.\n" +
      "Idle-line fill coverage, measured rather than assumed: at budgets up to 4000 ms the static " +
      "search leaves three lines parked and the own-demand fill puts them on Reinforced Concrete, " +
      "Bricks and Concrete — a second solve control (the fill's own clock) appears in the metrics, " +
      "and result.phases[].idleFill records it. At the reference 20000 ms budget the search " +
      "assigns every line, putIdleLinesToWork returns at its no-idle-rows guard, and NO fill runs " +
      "at all: the Set & forget reference measurement contains no fill. The look-ahead banking " +
      "pass never banks here either, because gating-off collapses the list into one phase and a " +
      "single phase has no later project to bank for — project-seq-7line is the fixture that " +
      "reaches that call with a non-empty queue.",
    derive(state) {
      state.mode = "project";
    },
  },
  {
    id: "project-seq-7line",
    mode: "project",
    title: "Project — Set & forget, one project per phase (sequenced)",
    notes: "Static lines, sequenced: one phase per project, which is the only shape that runs the " +
      "per-project ordering-estimate LPs (~10 lpMaximize calls against project-7line's 1–3) that " +
      "WS2 names as repeated near-identical solves and WS3 names as parallelizable, and the only " +
      "one that calls the look-ahead fill with a real queue behind it.\n" +
      "Measured caveat, recorded so it is not mistaken for coverage: on this save the sequenced " +
      "phases leave no line parked at any rung of the ladder, so idleFill and lookAhead are null " +
      "throughout and the banking pass is reached but never banks. Attempts to force it by adding " +
      "weak 256x lines were rejected as a fixture: whether a fill lands flips with the line count " +
      "(8 lines fills nothing, 9 and 10 each fill one phase — a different phase in each case — and " +
      "11 fills nothing again), which is a coin toss, not a regression detector. Closing that gap " +
      "needs a saved factory that parks a line at its own budget, not a derivation of this one.",
    derive(state) {
      state.mode = "project";
      state.projectSeq = true;
    },
  },
  {
    id: "project-split-7line",
    mode: "project",
    title: "Project — Line switching, 10-project list, prefer-current",
    notes: "The default project line mode, and the only one that reaches the stability machinery: " +
      "measured warm, so the hidden prefer-current comparison — a second complete run re-deriving " +
      "the same free tableaux — is inside the measurement. This is the fixture the design's " +
      "repeated near-identical-LP claim is about, and the one the tableau memo is measured on.\n" +
      "The whole run is dense work: Line switching schedules every phase through projectSchedule's " +
      "simplex and never enters the discrete search, so `work` here is pivots and tableau rows and " +
      "nothing else and `work.probe` is zero. It is charged to the run's own solve control, so the " +
      "user's solve-time setting bounds it and a budget ladder over it means something.",
    seedRuns: 1,
    derive(state) {
      state.mode = "project";
      state.projLineMode = "split";
    },
  },
];

function fixtureById(id) {
  const found = FIXTURES.find(fixture => fixture.id === id);
  if (!found) throw new Error("unknown fixture: " + id + " (have: " + FIXTURES.map(f => f.id).join(", ") + ")");
  return found;
}

/* A fresh saved state for one fixture. budgetMs overrides the save's own solve budget so a sweep can
 * ask the same factory for the same plan at a ladder of budgets. */
function materialize(fixture, options) {
  const opts = options || {};
  const state = referenceState();
  fixture.derive(state);
  if (Number.isFinite(opts.budgetMs)) state.solveBudget = opts.budgetMs;
  return state;
}

module.exports = { FIXTURES, REFERENCE_PATH, referenceState, fixtureById, materialize };
