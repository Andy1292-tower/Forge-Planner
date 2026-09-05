"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

// Keep this list explicit: test/check.cjs is a comparator helper and needs arguments,
// while test/parity.cjs is exercised through run-parity.cjs with its golden snapshot.
const tests = [
  "test/catalog-validation.cjs",
  "test/ci-workflow.cjs",
  "test/check-classifier.cjs",
  "test/craftdata.cjs",
  "test/credits-contract.cjs",
  "test/delta-eval.cjs",
  "test/feeder-plateau.cjs",
  "test/field-validation.cjs",
  "test/forgieproject.cjs",
  "test/free-headroom.cjs",
  "test/single-output-restart.cjs",
  "test/game-alignment.cjs",
  "test/gate.cjs",
  "test/gel-loadout-exact.cjs",
  "test/inventory.cjs",
  "test/legacy-worker-retirement.cjs",
  "test/lns-repair.cjs",
  "test/lookahead.cjs",
  "test/lp-memo.cjs",
  "test/lp-pivot.cjs",
  "test/manual-throttle.cjs",
  "test/minedfocus.cjs",
  "test/minedmodes.cjs",
  "test/minedrender.cjs",
  "test/minedsolver.cjs",
  "test/minedui.cjs",
  "test/optimality-gap.cjs",
  "test/outputs-solve-scope.cjs",
  "test/perf-harness.cjs",
  "test/project-transients.cjs",
  "test/rawtargets.cjs",
  "test/report-issue.cjs",
  "test/scale.cjs",
  "test/seqgate.cjs",
  "test/shard-merge.cjs",
  "test/sharemode.cjs",
  "test/solve-lifecycle.cjs",
  "test/solver-bounds.cjs",
  "test/solver-worker-session.cjs",
  "test/static-asset-build.cjs",
  "test/state-schema.cjs",
  "test/staticmode.cjs",
  "test/stability.cjs",
  "test/stability-ui.cjs",
  "test/stockrisk.cjs",
  "test/target-presets.cjs",
  "test/unbounded-quantities.cjs",
  "test/update-check.cjs",
  "test/boot-recovery.cjs",
  "test/run-parity.cjs",
];

let failed = 0;
for (const testFile of tests) {
  console.log(`\n=== ${testFile} ===`);
  const run = spawnSync(process.execPath, [path.join(__dirname, "..", testFile)], {
    stdio: "inherit",
  });
  if (run.error) {
    console.error(`FAIL ${testFile}: ${run.error.message}`);
    failed++;
  } else if (run.status !== 0) {
    console.error(`FAIL ${testFile}: exited ${run.status}`);
    failed++;
  }
}

if (failed) {
  console.error(`\n${failed} test script(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${tests.length} test scripts passed`);
}
