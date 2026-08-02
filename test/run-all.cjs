"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

// Keep this list explicit: test/check.cjs is a comparator helper and needs arguments,
// while test/parity.cjs is exercised through run-parity.cjs with its golden snapshot.
const tests = [
  "test/check-classifier.cjs",
  "test/craftdata.cjs",
  "test/credits-contract.cjs",
  "test/field-validation.cjs",
  "test/forgieproject.cjs",
  "test/gate.cjs",
  "test/gel-loadout-exact.cjs",
  "test/inventory.cjs",
  "test/legacy-worker-retirement.cjs",
  "test/minedfocus.cjs",
  "test/minedmodes.cjs",
  "test/minedrender.cjs",
  "test/minedsolver.cjs",
  "test/minedui.cjs",
  "test/project-transients.cjs",
  "test/rawtargets.cjs",
  "test/scale.cjs",
  "test/solve-lifecycle.cjs",
  "test/static-asset-build.cjs",
  "test/state-schema.cjs",
  "test/stability.cjs",
  "test/stability-ui.cjs",
  "test/stockrisk.cjs",
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
