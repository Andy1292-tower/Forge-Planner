# Task 4 report: executable Project schedules

## Outcome

Project mode now distinguishes an average-feasible LP from an executable schedule. A pure replay module canonicalizes line order, evaluates every global switch boundary, carries exact inventory across phases, enforces instantaneous mined-income caps, reserves pre-produced Bits, and inserts dependency-bounded warm-ups. The UI only emits imperative instructions after both LP and exact replay validation succeed.

## RED evidence

- The first `node test/project-transients.cjs` run preserved the required legacy counterexample: the first switch was `5.171317h` and Ingots reached `-2932.417170`. The old result still reported feasible, so the new assertion failed with `average-feasible plan must not be executable from zero stock` (`actual: true`).
- The expanded first run then showed that the old solver had no `lpFeasible` or schedule-validation contract.
- The malicious warm-up callback test initially returned executable after manufacturing unrelated `C`; it failed at `a callback cannot widen warm-up recursion to an unrelated recipe branch`.
- The contradictory UI fixture (`feasible: true`, exact replay blocked) initially exposed `External pre-produced prerequisite` instructions and failed the blocked-copy assertion.
- The stability consistency test initially failed because the final stabilized plan did not prove that its displayed Bits reservation was the same value used by its solve.

## Implementation decisions

- `replayProjectSchedule` and `buildExecutableProjectSchedule` live in `js/project-schedule.js` and receive copied primitive context only; they do not read application state, the DOM, persistence, or clocks.
- `outHr` and `cons[].hr` are treated as fraction-weighted phase averages and expanded by `1 / frac` only while active. Duplication is not applied again.
- Switches from every line form one canonical boundary union. Forgie accrues continuously, including idle tails. Negative stock is retained in validation output.
- Vespium and Hydracite are instantaneous sustainable-rate budgets. Rocks is informational. None enters ordinary inventory or warm-up recursion.
- Frames/Wire Bits are explicit zero-time external prerequisites. Direct and recipe-feed Bits remain ordinary craftable demand. Compression uses the existing `3^log2(level) / level` convention.
- Each real Project completion debits `demandSub` exactly once. Warm-ups never debit Project demand, and exact replay inventory feeds the next semantic phase.
- Recursive warm-ups are guarded by recipe depth, path signatures, material progress, and transitive ordinary-resource ancestry. A callback cannot widen recursion into an unrelated recipe branch.
- The pre-produced Bits fixed point is bounded to eight passes for free and stabilized solves. Convergence requires the final plan-derived obligation to equal the obligation used by that exact solve; exhaustion becomes an explicit schedule-block diagnostic.
- Stock tolerances match production (`absolute: 1e-8`, `relative: Number.EPSILON * 32`). A direct `1e18`-scale test proves a roughly one-million-unit deficit remains raw and blocking.
- `feasible` now requires `lpFeasible && scheduleValidation.ok`; `workEta` retains analytical LP time while `eta` includes timed warm-ups. Blocked results retain analytical diagnostics but suppress run instructions, prerequisite notices, and warm-up notices.

## Release graph and compatibility

- Registered `project-schedule.js` before `solver.js` in the page, current source Worker, generated page bundle, and generated Blob Worker payload.
- Added build tests proving helper presence/order and app-hash rotation.
- Preserved frozen compatibility sources byte-for-byte:
  - `js/solver.worker.js`: `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
  - `compat/solver.worker.v2.js`: `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`

## Golden changes

The documented classifier workflow found exactly four intended Project-mode changes: Frames and Wire scenarios at 5 and 7 lines. Their synthetic Bits jobs disappeared, and executable ETA/objective changed because external Bits and warm-up time are now represented correctly. No Items, Credits, or unrelated Project golden changed. The accepted golden now reports `16 ok, 0 improved, 0 failed`.

## Verification

- `node test/project-transients.cjs` — pass
- impacted inventory, Forgie, mined, stability, stock-risk, gate, and static-build tests — pass
- `node test/stability.cjs` — `12 ok, 0 failed`
- `npm test` — `20 test scripts passed`; parity `16 ok, 0 improved, 0 failed`
- `npm run build` — pass
- syntax checks for `js/project-schedule.js`, `js/solver.js`, direct tests, and `test/browser/smoke.spec.js` — pass
- `git diff --check` — pass
- compatibility-file numstat diff — empty

The generated Blob Worker smoke spec now solves the exact 10,000-Frames/zero-stock fixture and asserts the 80,000-Bits prerequisite, timed warm-up, longer executable ETA, and nonnegative replay boundaries. Per the task constraint, no local browser was launched; this spec is intended for the CI browser lane.

## Files changed

- Runtime/build: `index.html`, `js/project-schedule.js`, `js/solver.js`, `js/results.js`, `js/events.js`, `js/solver.worker.v2.js`, `scripts/build-static.cjs`
- Direct/release/browser coverage: `test/project-transients.cjs`, `test/static-asset-build.cjs`, `test/browser/smoke.spec.js`, `test/run-all.cjs`, `test/stability.cjs`
- Existing solver harnesses now load the pure scheduling module: `test/forgieproject.cjs`, `test/gate.cjs`, `test/inventory.cjs`, `test/minedmodes.cjs`, `test/minedrender.cjs`, `test/minedsolver.cjs`, `test/parity.cjs`, `test/rawtargets.cjs`, `test/scale.cjs`, `test/stockrisk.cjs`
- Intended parity baseline: `test/golden.json`

## Remaining verification boundary

The browser smoke test was syntax-checked but not executed locally because browser launch was explicitly prohibited. CI remains the owner of the generated-app/Blob-Worker browser execution.

## Review fix round 1

Commit `1e36613` received a NEEDS FIXES review. The follow-up used separate RED/GREEN cycles for every Important finding.

### RED evidence

- The malformed schedule table reported all original failures in one run: non-array top-level input and bad maps failed open; null phases and object-shaped `plan`, `entries`, and `cons` containers threw. Infinity and negative resource values were silently accepted.
- A zero-fraction entry initially bypassed validation of its unknown output, infinite rate, and object-shaped consumption.
- A callback consuming unrelated `C` remained executable when `C` inventory was sufficient, proving ancestry was only checked after a deficit.
- A callback with an invalid explicit `demandSub` map was accepted because scheduler-owned fields overwrote it before validation.
- The legitimate mined warm-up test initially failed because Vespium was incorrectly treated as an ordinary recipe-ancestry requirement.
- The partial-Bits step renderer said `Have 40k Bits` even though the actual contract was 40k additional and 80k total.
- Scheduler prerequisite fixtures without a total, with supply above total, with nonzero time, or with line work all failed open. A tolerated `1e-9` carry was initially rejected by a strict comparison.
- Blocked result fixtures retained ordering, wave, `Done by`, and finish-time language.

### Fixes and regression coverage

- Every schedule container and explicit resource map is now shape-checked before iteration. Values must be known, numeric, finite, and nonnegative; malformed inputs return stable `{kind: "malformed"}` diagnostics instead of throwing.
- Canonicalization applies safe bounds to phase, line, entry, and consumption counts. Callback results have a stricter 64-phase bound.
- Callback maps are validated before scheduler fields are imposed. Callback `externalSupply`, unknown resources, unrelated ordinary output/consumption, and sufficient-stock ancestry bypasses are blocked.
- Dependency closure preserves a root that is also another combined root's legitimate ancestor (`B -> A` with roots `A + B`), while cycles, repeated targets, depth overflow, and unrelated widening remain blocked.
- Known mined consumption is allowed through ancestry validation and remains subject to instantaneous replay caps; informational consumption remains non-inventory data.
- Scheduler-owned external prerequisites require zero ETA, no line entries, a matching finite total, and supply no greater than that total within production stock tolerance.
- Both prerequisite renderers now say how much more to pre-produce, the total requirement, and current on-hand stock. Blocked results omit imperative ordering/wave/finish-clock language and label retained data as analytical LP output.
- Added direct coverage for deep input non-mutation, identical deficits in separate semantic phases, simultaneous Vespium/Hydracite rates, epsilon-filtered malformed entries, callback bounds, callback external-supply/unknown/unrelated cheats, legitimate mined warm-ups, combined-root recursion, and cyclic ancestry.
- The generated Worker smoke fixture now explicitly invokes its attached object-URL release hook on response, timeout, and error before termination.

### Fix-round verification

- `node test/project-transients.cjs` — pass
- impacted Project, inventory, Forgie, mined, stability, gate, stock-risk, and static-build tests — pass
- `npm test` — `20 test scripts passed`; parity `16 ok, 0 improved, 0 failed`
- `npm run build` — pass
- browser smoke spec syntax — pass; browser not launched per task constraint
- `git diff --check` — pass
- frozen compatibility Worker hashes unchanged and compatibility numstat diff empty
