"use strict";
/* A clock a test can trust: virtual milliseconds bought with consumed work.
 *
 * The solver is anytime. Give it a wall-clock budget and what it returns depends on how much search
 * the machine got through in that many milliseconds — so the same assertion passes on an idle laptop
 * and fails on a loaded CI box, or fails only when the suite runs its files in parallel. That is not
 * a solver bug the test has caught; it is the test measuring the machine.
 *
 * Freezing the clock at 0 is the blunt fix and is right for a search whose only limiter is a work
 * count (test/lns-repair.cjs does exactly that). It is WRONG for Credits: the refinement loop slices
 * the wall time that remains, so a clock that never advances collapses it and the test stops
 * exercising the code it names. A virtual clock keeps the time SHAPE — deadlines, stagnation
 * windows and fair slicing all behave as they would on a machine of exactly this speed — while
 * remaining a pure function of the search, identical everywhere.
 *
 * The two rates are the committed ones from test/perf/harness.cjs, imported rather than copied so a
 * virtual millisecond means the same thing here as in every recorded perf baseline. They differ
 * because the solver charges work in two currencies: one unit per checkpoint for the discrete
 * search, and array-element counts inside the LP, which are ~280x cheaper in real time.
 *
 * Usage:
 *   const { virtualClock } = require("./virtual-clock.cjs");
 *   const clock = virtualClock();
 *   const result = optimize({ now: clock.now, onCheckpoint: clock.onCheckpoint });
 */
const { UNITS_PER_MS, DENSE_UNITS_PER_MS, DENSE_LABELS } = require("./perf/harness.cjs");

function virtualClock() {
  const dense = new Set(DENSE_LABELS);
  let ms = 0, lastWork = 0;
  /* Work arrives as each control's own running total, and one optimize() call may open several,
   * each counting from zero. A reading below the last one is therefore a fresh control rather than
   * time running backwards, and its own total is the delta. Controls that interleave would shift
   * some attribution between them, which moves nothing that matters here: the clock only has to be
   * monotone, and the same function of the same search on every machine. */
  return {
    now: () => ms,
    onCheckpoint(event) {
      const work = Number(event && event.work);
      if (!Number.isFinite(work)) return;
      const delta = work >= lastWork ? work - lastWork : work;
      lastWork = work;
      if (delta > 0) ms += delta / (dense.has(event && event.label) ? DENSE_UNITS_PER_MS : UNITS_PER_MS);
    },
    get ms() { return ms; },
  };
}

// The testOptions object optimize() takes, ready to spread into one that carries more seams.
function virtualClockOptions() {
  const clock = virtualClock();
  return { now: clock.now, onCheckpoint: clock.onCheckpoint, clock };
}

module.exports = { virtualClock, virtualClockOptions, UNITS_PER_MS, DENSE_UNITS_PER_MS, DENSE_LABELS };
