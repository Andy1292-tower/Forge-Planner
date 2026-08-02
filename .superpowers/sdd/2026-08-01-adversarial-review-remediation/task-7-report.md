# Task 7 Report — Visible Project Stability Tradeoffs

## Status

Implemented on `codex/adversarial-remediation-continuation-v2` from task-start base `3962aa3` (which contains the approved `49a9c36` predecessor plus the controller's plan reconciliation). Project line-job stability is now an explicit persisted policy, selected-run cache writes are transactional, and a held plan is compared against a complete memoryless alternative without describing that alternative as unconditionally fastest. No browser was launched locally; the ordinary generated Blob Worker coverage is committed for CI.

## RED evidence

Regression-first tests initially exposed the missing contracts:

- `node test/state-schema.cjs` failed four intended assertions: the schema remained v1, a v2 state without a policy was accepted, valid v1 state was not upgraded with a default policy, and duplicate Project IDs were neither migrated nor rejected.
- `node test/stability-ui.cjs` initially failed four of five core assertions: `projectSchedule()` returned no proposed record, no pure cache-update helper existed, Project results exposed no policy, and no full-run stability comparison existed.
- The UI RED then failed because `projectStabilityHtml` did not exist.
- The first complete `npm test` pass exposed one stale renderer harness: `test/project-transients.cjs` extracted `renderProjectResults()` without injecting its new stability-summary dependency. The harness was corrected, rerun focused, and the subsequent fresh complete suite passed.

## State and identity contract

- `CURRENT_SCHEMA_VERSION` is 2 and `projectStability` is exactly `"prefer-current" | "reoptimize"`.
- New, reset, legacy unversioned, and valid v1 state defaults to `prefer-current`. V2 requires the exact enum. Old versioned structural requirements remain strict through a separate `sourceVersion >= 1` path; future or otherwise unsupported schemas are rejected.
- V2 rejects duplicate `projects[].id` values. Legacy/v1 migration preserves the first occurrence and deterministically renames later collisions from their source-array position, reserving names against every valid original ID so accepted Projects never share a cache/comparison identity.
- The policy survives validation, import/export, JSON roundtrip, default/reset state, UI synchronization, and ordinary generated-Worker payloads.

## Cache and write boundary

- `projectSchedule()` treats every incoming cache as immutable and returns a semantic `stabilityKey` plus a proposed update; it never mutates `S.__stab` or an incoming snapshot.
- Preliminary fixed points, ordering estimates, recursive warm-ups, and hidden alternatives read no stability pins and propose no records.
- The visible `prefer-current` run reads a frozen incoming snapshot and proposes final selected records. The visible `reoptimize` run ignores pins but also proposes its selected records. The hidden alternative is memoryless and write-free.
- `optimizeProjectTop()` completes both the selected visible run and any eligible hidden comparison before committing anything. It commits only final, converged, feasible semantic phases from a fully executable selected run. Failed, partial, replay-invalid, average-infeasible, hidden, preliminary, ordering, and warm-up work cannot write.
- Failed selected runs preserve the previous-good cache. Successful writes preserve unrelated entries, use safe own-property copying, and retain the existing 256-entry cap. The returned `__stab` is the complete post-commit selected snapshot.

## Full-run comparison

- `solveProjectRun()` now owns the complete Task 4 execution path: sequence/wave/combined phases, prerequisites, recursive warm-ups, ordering, carried inventory, replay validation, execution phases, finish clocks, and total/work/warm-up ETAs.
- Sequenced keys are Project IDs; combined and wave keys are sorted Project IDs. Matching never uses display names or array positions.
- A hidden reoptimized run is computed only when the visible prefer-current run actually stabilizes at least one phase. The result returns only the required comparison summary, never the hidden plan.
- Executability requires full feasibility, LP feasibility, no partial result, successful replay validation, no first failure, and finite nonnegative total/work/warm-up ETAs. Comparability additionally requires executable runs, unique phase keys, and one finite positive-throughput alternative row for every stabilized selected key.
- ETA and throughput decisions use the prescribed scale-aware epsilon functions. `alternativeMinusSelected*` consistently means alternative minus selected; `alternativeIsShorter` is true only below negative ETA tolerance.
- The real 420-Frames fixture proves the behavior end to end: selected held throughput is 2.6304% lower, selected phase ETA is 2.7015% longer, the held warm-up is 129.94 seconds shorter, selected complete ETA is `0.6659750249h`, alternative complete ETA is `0.6846583163h`, and reoptimization is 67.26 seconds slower overall. Both plans are executable/comparable and replay-safe within the configured tolerance.

## Player-facing behavior

- Project Shopping-list controls now expose an accessible **Line-job policy** selector with `prefer-current` and `reoptimize` options. Associated help explains the 5% phase-throughput band and that warm-ups/order can make higher phase throughput slower overall.
- `renderProjects()` synchronizes the selector. A shared validated event helper persists the selected policy and performs a full Project re-solve.
- A held comparison escapes phase names and quantifies every affected phase's throughput and ETA, complete ETA, warm-up difference, order change, and executability/comparability.
- The selected state says **Current line jobs retained**. A genuinely shorter alternative offers **Use shorter re-optimized plan**; a uniformly higher-throughput but not shorter alternative offers **Use higher-throughput line jobs anyway**; zero-gap and mixed/negative gaps use the neutral **Use re-optimized line jobs anyway**. A noncomparable result explains that a safe full comparison is unavailable and offers no comparison-block switch action.
- When reoptimization is active, the result offers **Prefer current line jobs on future edits**.
- Remaining Project-facing unconditional `fastest`/`optimal` language was removed from the modal, results, and README. Warm-up copy now describes replay tolerance/no material shortage rather than promising literally nonnegative floating-point boundaries. Accurate Mined-mode wording remains unchanged.

## Proof coverage

`test/stability-ui.cjs` covers the frozen 420 acceptance case, the established 500 release case, pure proposal helpers, selected-only atomic writes, hidden-run isolation, repeat-held stability, reoptimization memorylessness plus selected recording, failed/partial-run cache retention, semantic sequence/wave keys, duplicate display names, exact comparison signs/percentages, truthful shorter/longer/zero/mixed/noncomparable actions, malicious-name escaping, accessible selector/static copy, and validated policy event side effects.

The extended state suite covers v1/unversioned migration, v2 strictness, deterministic legacy duplicate-ID repair, v2 duplicate rejection, persistence, and schema recovery. Project transient coverage injects and exercises the new renderer helper. CI browser specs now cover selector labeling/help, policy switching, schema-v2 recovery, and the ordinary current Blob Worker with a 200-Frames baseline snapshot, the full 420 prefer-current held comparison plus selected cache writes/sentinel preservation, the same 420 reoptimized request with no stabilization/hidden comparison plus free selected writes, Blob transport, and zero permanent Worker/dependency requests.

## Verification

- `node test/stability-ui.cjs` — pass: nine core checks plus UI contracts.
- `node test/state-schema.cjs` — pass: 43 assertions.
- `node test/stability.cjs` — pass: 12 of 12.
- `node test/project-transients.cjs` — pass.
- `npm test` — exit 0: 23 ordered test scripts passed; parity reported `16 ok, 0 improved, 0 failed`; browser specifications were syntax-checked only.
- `npm run build` — pass; static site built successfully.
- `node test/static-asset-build.cjs` — pass: 8 assertions.
- `node test/run-parity.cjs` — exit 0: `16 ok, 0 improved, 0 failed`.
- `node --check` on the changed browser specifications and new Node contract — pass.
- `git diff --check` — pass.

## Compatibility boundaries

Current behavior remains bundled from current page modules into the generated Blob Worker. Neither permanent Worker endpoint, the Worker handler, legacy request fixture, frozen checksum constant, nor parity golden was edited.

- `js/solver.worker.js`: `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
- `compat/solver.worker.v2.js`: `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`

## Files changed

- State/schema: `js/fields.js`, `js/core.js`, `js/state.js`
- Solver/cache/comparison: `js/solver.js`
- UI and interaction: `index.html`, `js/results.js`, `js/events.js`, `README.md`
- Node coverage: `test/stability-ui.cjs`, `test/state-schema.cjs`, `test/project-transients.cjs`, `test/run-all.cjs`
- CI browser coverage: `test/browser/smoke.spec.js`, `test/browser/accessibility.spec.js`, `test/browser/state-recovery.spec.js`
- Delivery record: this report

## Remaining boundary

No known Node-side blocker remains. Actual rendering, accessibility automation, and generated Blob Worker execution remain CI-only because this task explicitly prohibited all local browser launches.

## Formal review fix round 1 — prototype-safe keys and persistence proof

Formal range review found that the hidden alternative index used a normal object even though schema-valid Project IDs include names inherited from `Object.prototype`. A held 200-to-420 comparison for ID `constructor` therefore reached the inherited function and threw instead of producing a comparison. The regression was added first and exited 1 with:

`FAIL prototype-like Project IDs keep the 200-to-420 held comparison exact and executable [(alternativeByKey[key] || alternativeByKey[key]).push is not a function]`

The alternative phase index now uses a `Map`, so `constructor` and `toString` remain exact semantic keys. The real frozen held flow is exercised independently for both IDs and proves selected/alternative executability, comparability, exact phase order, and exact comparison keys. The focused stability contract then passed all nine core checks.

Review also requested explicit end-to-end state acceptance proof beyond enum validation. A Node state-boundary contract now imports `reoptimize`, verifies its committed local-storage bytes, recreates in-memory state through `initializeState()`, and confirms the policy remains `reoptimize`; it then follows the production reset sequence (`defaults()` plus `save()`), reloads again, and confirms `prefer-current`. This behavior was already correct and the new acceptance test passed on first execution. The state suite now passes all 43 assertions.

The report's incorrect “200-line baseline” description was corrected to “200-Frames baseline.” Fresh fix-round gates passed the focused nine-check stability contract, all 43 state assertions, all 23 ordered Node scripts, deterministic build, eight static-release assertions, parity `16 ok, 0 improved, 0 failed`, changed-source/browser-spec syntax checks, immutable endpoint hashes, and diff hygiene. Fresh scoped rereview approved the exact fix range with no Critical, Important, or Minor findings. No browser was launched, and no frozen compatibility or permanent Worker path changed in the fix round.
