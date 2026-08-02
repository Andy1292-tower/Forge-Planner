# Task 13 Report — Persistence Ownership and Asynchronous Progress

## Status

Implemented on `codex/adversarial-remediation-continuation-v2`. Work began from the dispatched runtime base `2009776ddd47634ccbe29a07c21fa7c8888f5a3f` and was integrated after the controller's non-overlapping plan-only commits through `52c0627`. This task changes persistence and solve lifecycle behavior only. It does not alter the merged Task 11A UI checkpoint, CSS, page composition, navigation, onboarding, headers, or dialog layout. No browser, Playwright process, GUI, or dev server was launched locally; browser execution remains CI-only.

## RED evidence

The first production-facing regression run was:

`node test/solve-lifecycle.cjs`

It exited 1 with `4/16 solve lifecycle tests failed`:

- display-only `planStart` / Project `_open` mutations discarded an otherwise valid in-flight Project result (`[]` instead of `['accepted']`);
- `solveService.setWorkerFactory` did not exist;
- the 100ms checkpoint recorded zero saves, proving persistence still waited on the 500ms solve path;
- opening Progress invoked `optimizeProjectTop()` once on the main thread instead of zero times.

A focused self-review RED then exited 1 with `2/19` failures: completed requests retained their solve-currentness key, and the initial `renderT === undefined` sentinel mislabeled a truly stale Progress result as `updating…`. Both have dedicated regressions and are fixed.

The CI-only browser RED specifications cover the actual lost `_open` reproduction: add a custom Shopping-list Project, toggle its disclosure, dispatch immediate page teardown before any unrelated save, reload, and require the disclosure state to survive.

## Implementation

### Independent persistence owner

`js/events.js` now owns one 100ms persistence debounce through `schedulePersist()`, `persistNow()`, and `flushPersist()`, independent of the existing 500ms solve debounce. `scheduleSolve()` schedules durability immediately as a separate concern. `doSolve()` and `markStale()` use `persistNow()`. Successful direct legacy `save()` calls are recognized by exact stored-state comparison before a scheduled persistence callback, so they do not cause a duplicate write for the same accepted revision.

The Project `_open` disclosure now schedules persistence without solving. `pagehide` performs the required order: flush persistence, clear `renderT`, then cancel `solveService`. Hidden-page `visibilitychange` flushes persistence only; it neither cancels nor creates/reschedules solve work.

### Accepted-mutation audit

Every accepted GUI state mutation was checked across `js/events.js`, `js/results.js`, and `js/manual.js`:

- numeric drafts from Task 8 (price, margin, line/global fields, target priority, recipes, Forgie, mined income, inventory, and Project numeric fields) retain their immediate-save behavior;
- mutations followed by `scheduleSolve()` now gain independent 100ms durability even where they previously relied on the future solve (`targets[*].on` was the live example);
- explicit-Resimulate crafter-line mutations use immediate `persistNow()` through `markStale()` and still do not auto-solve;
- Project disclosure `_open` uses `schedulePersist()` and no solve;
- mode, Manual, import/reset, plan-start, inline Project, catalog/Project structural, and completion mutations retain an immediate successful save/persist path;
- `_projAdjustOpen`, `_breakdownOpen`, `catQuery`, and DOM-only recipe/dialog disclosure state are explicitly local transient UI, not accepted persisted state.

The direct-save regression proves a legacy `save()` followed by `scheduleSolve()` is detected as already durable and does not queue a duplicate persistence write.

### Solve-equivalent currentness and Progress

`solveStateSnapshot()` clones the exact dispatched state and removes only display-only `planStart` and every Project's `_open`; `solveStateKey()` serializes that solve-equivalent snapshot. The Worker receives that sanitized snapshot. `solveService` uses the same key at its in-flight currentness boundary, while still validating the Worker's echoed request mode/revision. Display-only mutations therefore keep a slow solve authoritative, while every solver-relevant mutation rejects it. Request completion and cancellation clear the owned key with all other request fields.

Project results are cached with the dispatched solve key. `renderProgress()` no longer calls `optimizeProjectTop()`. A current cache is consumed immediately; a completion edit persists, schedules the existing normal Project solve before repaint, and shows `updating…` while the key is stale. A stale result with no scheduled/active Project solve shows `out of date — Resimulate`, including after a crafter-line edit, and opening Progress never starts a second request. The one authoritative result updates the main Project panel and refreshes an already-open Progress dialog.

### Worker factory hook

`solveService.setWorkerFactory()` accepts a test/current Worker factory or `null` to restore the default. Changing factories cancels and releases any owned Worker before replacement. The default retains the exact `new Worker("js/solver.worker.v2.js")` source seam; the static builder still replaces exactly one occurrence with the embedded Blob Worker constructor, and all static graph tests remain green.

CI-only coverage installs a deliberately slow controlled Worker through this hook without replacing global `Worker`. It opens Progress from a real cached Project result, accepts a completion control, proves no main-thread Project optimization, observes exactly one factory request, accepts display-only mutations during that request, refreshes both surfaces on delivery, and proves a later explicit-Resimulate line edit stays stale without silently spawning another request.

## Verification

- `node test/solve-lifecycle.cjs` — pass: 21 lifecycle, persistence, factory, solve-key, Progress, teardown, and visibility contracts.
- `node test/field-validation.cjs` — pass: 14 contracts; immediate-save source ownership remains enforced through `persistNow()` at the solve boundary.
- `node test/static-asset-build.cjs` — pass: 9 static graph/Blob Worker assertions; exact builder seam preserved.
- `npm test` — exit 0: syntax plus all 24 ordered Node scripts; parity inside the suite passed.
- `npm run build` — pass: deterministic content-addressed release built at `dist/`.
- `npm run test:parity` — pass: `16 ok, 0 improved, 0 failed`.
- `npm run check:syntax` — pass, including both changed CI-only browser specifications.
- `git diff --check` and generated compatibility endpoint byte comparisons — pass.
- Local browser execution — intentionally not run by task prohibition.

## Frozen compatibility boundary

No permanent Worker endpoint, historical request fixture, or parity golden was edited.

- `js/solver.worker.js`: `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
- `compat/solver.worker.v2.js`: `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`
- `test/fixtures/solver-worker-v2-request.json`: `ce3df88d0cb7ce7df1ea1b57a5731349aac412078a897fb49fdd9121b43ae5f4`
- `test/golden.json`: `1fa06b6698de157a5507639f5dd72dbe9dd37271b433d2fa84b19cbe80a976a1`

## Files changed

- Runtime: `js/events.js`, `js/results.js`, `js/solve-service.js`
- Node coverage: `test/solve-lifecycle.cjs`, `test/field-validation.cjs`
- CI-only browser coverage: `test/browser/persistence.spec.js`, `test/browser/solve-lifecycle.spec.js`
- Delivery record: this report and the SDD progress ledger

## Self-review and remaining boundary

The final self-review explicitly confirmed: accepted GUI mutation durability; full `expectedKey` cleanup; correct handling of `renderT`'s initial `undefined` sentinel; and reconciliation of direct legacy `save()` call sites without duplicate writes. The factory default still owns exactly one static-builder constructor seam, both permanent Worker endpoints remain byte-identical, and no UI checkpoint file was changed.

No known Node-side blocker or unresolved Task 13 issue remains. The authored teardown/reload, hidden-page, slow-factory, open-Progress refresh, and explicit-Resimulate flows remain CI-only because local browser execution is prohibited.
