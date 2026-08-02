# Forge Planner Adversarial Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for implementation, `superpowers:test-driven-development` for each defect, and `superpowers:verification-before-completion` before claiming a task complete. Use `build-web-apps:frontend-testing-debugging` plus the in-app Browser for rendered work. Track every checkbox.

**Goal:** Remove the confirmed correctness, security, recovery, accessibility, visual-composition, responsive-layout, and release-trust failures from the 2026-08-01 adversarial review while preserving established Forge Planner mechanics and the static, local-first product.

**Architecture:** Harden the current application incrementally. Establish a test/release spine first; then introduce a versioned state boundary, a single solve lifecycle, executable project-plan validation, exact small combinatorial helpers, and shared semantic/visual UI primitives. Preserve the industrial identity while recomposing the weak surfaces. Do not rewrite the solver, replace the product with a framework, or change game mechanics as part of cleanup.

**Tech stack:** Static HTML/CSS, vanilla JavaScript, Web Worker, Node.js CommonJS tests, Playwright browser tests, GitHub Actions, static hosting.

**Source review:** `docs/reviews/2026-08-01-adversarial-project-review.md`

## Non-Negotiable Product Constraints

- Preserve existing calibrated saves, project progress, custom recipes, Manual presets, sell prices, Forgie rates, and mined incomes.
- Frames and Wire keep their established pre-produced Bits model.
- Vespium and Hydracite remain independent hard budgets. May-work margin must never borrow either one.
- Credits remains a **dedicated-one-item comparison** unless a separate, explicitly approved mixed-sales mode is designed.
- Crafter-line edits remain explicit Resimulate actions; improve visibility without bringing back expensive solve-on-every-keystroke behavior.
- Line stability remains available, but its full-schedule tradeoff must be visible and optional. A lower-throughput held phase may still finish sooner overall by avoiding recursive warm-ups and reordering.
- The application stays usable without a backend or account.
- User-controlled values must never enter executable HTML contexts.
- Every UI change must be checked at desktop and mobile widths, with keyboard-only navigation and preserved focus.
- Preserve the dark industrial character, but do not preserve accidental spacing, collisions, overflowing grids, or equal emphasis across unrelated actions.
- Wide data belongs in named component-level scrollers; page-level clipping is not an acceptable responsive strategy.
- Do not erase a damaged save. Quarantine it and offer GUI recovery/download.
- Do not merge implementation branches or PRs without explicit owner approval.

## Release and Worker Contract

Emergency fixes `188e913` and `1466a5d` are the release baseline for every remaining task:

- `npm run build` produces `dist/` through `scripts/build-static.cjs`. `dist/index.html` is the only revalidated release pointer; generated `/static/*` assets are content-addressed and immutable.
- The current source Worker handler is `js/solver.worker.v2.js`. Production does not fetch that path: the build concatenates the current Worker dependencies and handler into the hashed app, then creates a `blob:` Worker from that in-memory payload.
- `/js/solver.worker.js` is a permanent immutable error fence for the oldest open tabs. `compat/solver.worker.v2.js` is the checksum-locked, self-contained v2-era Worker copied to the permanent immutable `/js/solver.worker.v2.js` compatibility endpoint. Never edit, replace, import, or repurpose either compatibility contract for current features.
- Every change to a page script, Worker dependency, stylesheet, image, or future font must be registered in the build graph and proven to rotate only the affected content hash. Source-mode unit tests remain useful, but browser/release claims must exercise the generated app and its Blob Worker.
- URLs emitted into HTML, CSS, or JavaScript must derive from the document/build base and work at both `/` and a subpath. Do not add new root-relative application assets.
- Worker factories own every resource they create. Terminating an owned Blob Worker must revoke its object URL immediately; a timeout may remain only as a leak backstop, not the normal cleanup path.

## Agentic Execution Model

Use a fresh `codex/` worktree branch for each merge unit. Parallel research and test-authoring are encouraged; implementation that overlaps `js/events.js`, `js/results.js`, or `index.html` must be serialized through one integration agent.

| Wave | Tasks | Parallelism |
| --- | --- | --- |
| 0 | Task 0 | One foundation agent; merge first |
| 1 | Task 1, then Tasks 2–3 | Merge the state boundary first; security and solve-lifecycle work may then run in parallel worktrees with serialized integration |
| 2 | Task 3F, then Tasks 4–7 | Land the Worker/release follow-up first. Solver corrections can be independent if each owns separate functions/tests; one integration review after all four |
| 3 | Tasks 8–10 | Field, dialog, and accessibility foundations; serialize shared markup/events changes |
| 4 | Task 11A checkpoint only | The owner accepted and released the checkpoint as the final UI scope for this pass. Do not implement Tasks 11B–11D or Task 12 without a new explicit request. |
| 5 | Tasks 13–14, then Task 15, then Task 16 | Resilience and release engineering may run in parallel where safe; documentation follows Task 14 and settled behavior, then final verification runs after integration |

Each task follows this handoff:

1. Worker writes the failing regression and records the RED output.
2. Worker implements only that task and records focused GREEN output.
3. Reviewer checks the diff against the review finding and runs the focused test independently.
4. Integration agent rebases, resolves overlaps, and runs the standard full gate.
5. Owner reviews rendered changes before merge.

### Deferred minor ownership

The checkpoint minors remain assigned and must not disappear merely because their originating task is marked complete:

| Deferred minor | Owning task |
| --- | --- |
| Recovery dismissal restores Import focus rather than the exact invoker | Task 16 targeted regression; no UI redesign |
| An owned but idle reused Worker can report an error as an active failure | Task 3F |
| Dialog cleanup can overwrite a pre-existing `inert` state | Task 16 targeted regression; no dialog redesign |
| Skip-link destination suppresses a visible focus indicator | Task 16 targeted regression; preserve the checkpoint composition |
| Visual CI step is unnamed and `test:browser` duplicates `visual-layout` | Task 14 CI/release wiring |

## Standard Verification Gate

Task 0 creates `npm test` and `test:browser`. Task 10 adds `test:a11y`; Task 11 adds `test:visual`. Emergency baseline `1466a5d` supplies `build`; Task 14 adds `test:release` and completes its upgrade/subpath coverage. Until each command exists, run the task's focused checks plus the available subset. Never add a placeholder command that reports green without running its promised checks.

```bash
npm test
npm run test:browser
npm run test:a11y
npm run test:visual
npm run build
npm run test:release
git diff --check
```

The final gate must also include a real browser/Worker solve, a warm-cache release upgrade, keyboard-only dialog traversal, geometry assertions plus reviewed 320/390/768/900/1024/1440px screenshots, and a clean application-console/network review (with any intentionally unavailable local hosting service named explicitly).

---

## Task 0: Create the Test and Release Spine

**Priority:** Foundation

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `test/run-all.cjs`
- Create: `test/run-parity.cjs`
- Create: `playwright.config.js`
- Create: `test/browser/smoke.spec.js`
- Create: `.github/workflows/verify.yml`
- Modify: `README.md`

**Interfaces produced:** one documented `npm test`; `npm run test:browser`; a CI gate; stable browser-test server lifecycle.

- [ ] Inventory every current test and define an explicit ordered list in `test/run-all.cjs`; do not glob `test/check.cjs` as a standalone test because it requires arguments.
- [ ] Make `test/run-parity.cjs` write current parity to a temporary directory and invoke `test/check.cjs` against `test/golden.json`.
- [ ] Add scripts for `check:syntax`, `test:node`, `test:parity`, `test`, and `test:browser`. Later tasks extend this same manifest rather than creating another runner.
- [ ] Add a Playwright smoke test that loads the real page over HTTP, waits for the real Worker result, switches all four modes, and fails on unexpected console/page errors. Ignore only the documented local Vercel Analytics 404 until analytics is removed.
- [ ] Add CI using a pinned Node major and the committed lockfile. Upload browser traces/screenshots only on failure.
- [ ] Keep the existing pure-Node tests fast; browser coverage is a second lane, not a replacement.
- [ ] Make `test/scale.cjs` either assert every scenario it prints or label non-asserted rows explicitly as telemetry so a green exit cannot be mistaken for full scale coverage.
- [ ] Verify all existing results remain green, including `16 ok, 0 improved, 0 failed` parity.
- [ ] Commit as one foundation change.

## Task 1: Add a Versioned, Transactional State Boundary and GUI Recovery

**Priority:** P1

**Depends on:** Task 0

**Files:**

- Create: `js/state.js`
- Create: `js/fields.js`
- Create: `test/state-schema.cjs`
- Create: `test/browser/state-recovery.spec.js`
- Modify: `index.html`
- Modify: `js/core.js`
- Modify: `js/events.js`
- Modify: `js/solver.worker.js`

**Interfaces produced:**

- `CURRENT_SCHEMA_VERSION`
- `FIELD_SCHEMA` with pure type/range/blank/string-limit rules shared by state validation and later UI bindings
- `parseStoredState(raw): {state, recovery}`
- `validateAndMigrate(candidate): {ok, state?, errors?, sourceVersion?}`
- `importState(candidate): {ok, state?, errors?}`
- `quarantineRejectedState(raw, reason)`

- [ ] Write RED tests for JSON primitives, arrays, wrong nested types, missing fields, malformed targets, unknown compression levels, negative/nonfinite-like values, old unversioned exports, and future versions.
- [ ] Confirm a stored primitive currently prevents startup in the real browser.
- [ ] Reject an oversized file before `FileReader` reads it. After parsing, bound object depth, line count, project/level/cost counts, preset count, and every string length so a hostile import cannot exhaust memory or lock the UI.
- [ ] Define the schema and pure field descriptors from `defaults()` rather than accepting arbitrary nested objects. Copy whitelisted fields into fresh defaults; never normalize an attacker-owned object in place. Task 8 must bind these same descriptors to the UI rather than inventing a second range schema.
- [ ] Add `schemaVersion` to exports and stored state. Preserve the existing field-detection migrations for known unversioned Gel, dupe, base-time, and other historical shapes; add a fixture for every known shape instead of pretending all unversioned saves are one schema.
- [ ] Keep the existing storage key readable for backward compatibility. Write the upgraded state only after validation succeeds; retain one previous-good backup.
- [ ] Wrap read, parse, validate, migrate, normalize, and initial render in one recovery boundary.
- [ ] On rejection, boot defaults and show an accessible recovery banner with **Download rejected save**, **Try another import**, and **Dismiss**. Do not require DevTools/site-data clearing.
- [ ] Make import transactional: run pure validation and invariants first, keep a previous-state snapshot, atomically swap only a valid candidate, and roll back if the first render fails. A rejected/failed file leaves the prior persisted state byte-for-byte unchanged. Do not claim to render a temporary candidate while renderers still close over global `S`.
- [ ] Validate Worker messages against the same normalized state shape before solving.
- [ ] GREEN: all malformed cases boot; all valid legacy/current exports preserve calibrated values; future versions are rejected clearly rather than guessed.

## Task 2: Close the Imported-Markup Execution Boundary

**Priority:** P1 security

**Depends on:** Task 1

**Files:**

- Create: `js/dom.js`
- Create: `test/browser/import-security.spec.js`
- Modify: `js/events.js`
- Modify: `js/manual.js`
- Modify: `js/results.js`
- Modify: `index.html`

**Interfaces produced:** safe element/value helpers and a CSP-compatible page.

- [ ] Write a browser RED test importing payloads through every `priceText`, `forgieText`, `inventoryText`, project name/description, and Manual preset ID/name field. Keep `planStart` in schema/type tests; it is not one of the confirmed raw HTML sinks.
- [ ] Assert that no injected element/event attribute is created, no marker side effect runs, and no unexpected request leaves the page.
- [ ] Replace user-value HTML strings with `document.createElement`, `.value`, `.textContent`, and `replaceChildren`. If a remaining template contains user data, use a context-specific helper and test that exact context.
- [ ] Render solver errors with `textContent`; never insert exception text into HTML.
- [ ] Constrain imported strings to sensible lengths and IDs to a safe generated/validated format.
- [ ] Move the inline analytics bootstrap out of inline script or remove analytics, then add a host-header CSP (meta fallback) with at minimum `default-src 'self'`, `script-src 'self'`, no inline script execution, `object-src 'none'`, and restricted images/fonts/connections. Until inline style attributes are removed and fonts are self-hosted, explicitly account for them with the narrowest workable `style-src`/font origins rather than shipping a policy the page immediately violates.
- [ ] Do not rely on CSP as the primary fix; the DOM must remain safe with CSP disabled in the test.
- [ ] GREEN: attack corpus is inert, clean export/import round-trips, and all form values display exactly as entered.

## Task 3: Centralize Solve Ownership, Cancellation, and Worker Recovery

**Priority:** P1

**Depends on:** Tasks 0 and 1; may run alongside Task 2, then serialize overlapping integration

**Files:**

- Create: `js/solve-service.js`
- Create: `test/solve-lifecycle.cjs`
- Create: `test/browser/solve-lifecycle.spec.js`
- Modify: `index.html`
- Modify: `js/results.js`
- Modify: `js/events.js`
- Modify: `js/solver.worker.js`

**Interfaces produced:**

- `solveService.request({mode, stateRevision, budget, stateSnapshot}, callback)`
- `solveService.cancel(reason)`
- `solveService.status()`

- [ ] Write a controllable fake-Worker RED test: start Credits A, enter Manual, deliver A, assert the old result currently paints.
- [ ] Add late-error coverage: start A, supersede with B, deliver A’s `onerror`, and assert B remains authoritative.
- [ ] Give every request a monotonically increasing generation plus expected mode/state revision.
- [ ] Route every accepted state mutation through one hook that increments `stateRevision`; direct assignments that bypass revision ownership are test failures.
- [ ] `cancel()` must increment generation, terminate only the owned Worker, clear callback/timers, and hide the overlay.
- [ ] Call full cancellation before Manual renders, reset/import changes state, and page teardown occurs. Define a separate owned Worker→synchronous-fallback transition that preserves the current generation/callback while terminating only that Worker.
- [ ] Check Worker identity in both `onmessage` and `onerror`.
- [ ] Replace sticky permanent `_workerBroken` with a bounded retry policy and an accessible “background solver unavailable; using slower fallback” status.
- [ ] Preserve per-request Worker termination while `optimize()` remains synchronous. A healthy Worker may be reused only after it completes a request; superseding an active request still requires termination because it cannot process a cancel message mid-solve. Any reused idle Worker must reset its line-stability cache from the request snapshot.
- [ ] GREEN in browser: rapid mode switching, reset/import mid-solve, Worker load failure/recovery, and repeated solves never paint stale output or leave the overlay stuck.

## Task 3F: Reconcile Worker Lifecycle With the Hashed Blob Release

**Priority:** P1 follow-up

**Depends on:** Task 3 and release baseline `1466a5d`; must land before Task 4

**Files:**

- Modify: `js/solve-service.js`
- Modify: `scripts/build-static.cjs`
- Modify: `test/solve-lifecycle.cjs`
- Modify: `test/browser/solve-lifecycle.spec.js`
- Modify: `test/browser/smoke.spec.js`
- Modify: `test/static-asset-build.cjs`
- Modify: `test/legacy-worker-retirement.cjs`
- Create: `test/fixtures/solver-worker-v2-request.json`
- Preserve unchanged: `js/solver.worker.js`
- Preserve unchanged: `compat/solver.worker.v2.js`

**Interfaces produced:** an explicit current-Worker factory/owner contract used by `solveService`, with a termination path that releases factory-owned resources.

- [ ] RED: finish a request so the current Worker is owned but idle, emit that exact Worker’s late `error`, and assert the service neither increments failure state nor exposes fallback for a request that no longer exists.
- [ ] Ignore errors from an owned idle Worker after a completed delivery. An event may affect retry/fallback state only when that Worker is busy and owns the authoritative generation/callback.
- [ ] RED at the build boundary: create a generated Blob Worker, terminate it before its first message/error, and require its object URL to be revoked immediately rather than waiting for the 60-second backstop.
- [ ] Make the Worker factory return/attach an idempotent release operation and ensure every `solveService` termination path calls it. Natural completion/error may release the Blob URL after construction, but early termination must also release it synchronously.
- [ ] Keep one frozen v2-era request/response fixture that executes against `compat/solver.worker.v2.js` and proves the permanent compatibility endpoint still solves with its historical schema. Do not regenerate that fixture from current source.
- [ ] Keep source tests injectable without weakening the production build: the current source handler remains `js/solver.worker.v2.js`, while `scripts/build-static.cjs` substitutes the registered in-memory Blob factory in the hashed app.
- [ ] Assert the oldest-tab fence and checksum-locked v2 compatibility file are byte-for-byte unchanged.
- [ ] GREEN: focused lifecycle, static-build, compatibility, and generated-app Blob Worker tests all pass.

## Task 4: Make Project Instructions Executable From the Stated Inventory

**Priority:** P1 correctness

**Depends on:** Tasks 0 and 3

**Files:**

- Create: `js/project-schedule.js`
- Create: `test/project-transients.cjs`
- Modify: `index.html`
- Modify: `js/solver.js`
- Modify: `js/results.js`
- Modify: `js/events.js`
- Modify: `js/solver.worker.v2.js`
- Modify: `scripts/build-static.cjs` when registering any new page/Worker module
- Modify: `test/static-asset-build.cjs`
- Modify: `test/browser/smoke.spec.js`

**Worker ownership:** current Project behavior belongs only to the current source graph and generated Blob Worker. Never change `js/solver.worker.js`, `compat/solver.worker.v2.js`, or either permanent deployed compatibility endpoint for this task.

**Interfaces produced:**

- `replayProjectSchedule(phases, initialInventory, context): {ok, boundaries, requiredBuffers, firstFailure}`
- `buildExecutableProjectSchedule(lpPhases, initialInventory, context, solveBuffer): {phases, eta, validation}`

`context` is immutable and explicit: production/consumption rates, Forgie rates, mined incomes, duplication, and pre-produced-Bits obligations. The replay module must not close over global `S`.

- [ ] Preserve the exact 10,000-Frames/zero-stock counterexample as the first RED test: current replay reaches `-2932.417170` Ingots.
- [ ] Build a pure piecewise replay engine. Combine every line’s switch times into global event boundaries; apply production, Forgie, consumption, mined budgets, and inventory over each interval.
- [ ] Treat `plan.entries[].outHr` and `cons[].hr` as fraction-weighted phase averages. While a segment is active, replay `outHr / frac` and `consHr / frac` for `frac * eta`; reuse `LP_ASSIGN_EPS` and do not apply duplication a second time.
- [ ] Define mined-resource timing before implementation. Recommended contract: entered income is an instantaneous sustainable rate available in every interval, not a banked starting stock; each displayed interval must stay within it. If the game actually banks mined stock, add an explicit starting-stock input rather than inferring one.
- [ ] Keep Vespium/Hydracite out of ordinary inventory, warm-up recursion, startup-buffer calculations, and May-work tolerance. Rocks remains informational only.
- [ ] Do not clamp negative stock during validation. Return exact resource, time, deficit, and minimum startup buffer.
- [ ] Add property tests that perturb line ordering and demand, checking every displayed boundary rather than only phase-average balance.
- [ ] Implement dependency-aware warm-up phases for the combined ordinary-shortfall vector through the injected `solveBuffer` callback. Replay every generated phase, carry its outputs into inventory without debiting them as project demand, and guarantee progress/termination through the acyclic recipe graph. Preserve the pre-produced Bits convention: show Bits as an external prerequisite unless the owner explicitly approves timed Bits production for Project mode.
- [ ] At each real phase completion, debit `phase.demandSub`, account for the established `PREPROD_BITS` obligations for Frames/Wire, and only then carry residual inventory into the next phase.
- [ ] Include warm-up duration in ETA and finish-by clocks. Never retain the old ETA after inserting prerequisites.
- [ ] If an executable schedule cannot be constructed, suppress imperative run instructions and show a blocking diagnostic; never call it feasible merely because the average LP is feasible.
- [ ] Ensure displayed stock comes from the event replay, not phase-average rates, and never hide a deficit by `Math.max(0, ...)` before validation.
- [ ] Register `js/project-schedule.js` in the page and Worker dependency arrays in `scripts/build-static.cjs`; fail the build if the current Worker payload omits it or a compatibility file changes.
- [ ] GREEN in both direct Node coverage and the generated Blob Worker: zero-stock Frames starts with a valid warm-up, all boundaries stay nonnegative, ETA includes it, and existing inventory/mined/partial scenarios retain their intended behavior.

## Task 5: Replace the Greedy Gel Capacity Claim With an Exact Loadout

**Priority:** P2 optimizer trust

**Depends on:** Task 0

**Files:**

- Create: `test/gel-loadout-exact.cjs`
- Modify: `js/solver.js`
- Modify: `js/render.js`
- Modify: `test/minedsolver.cjs`
- Modify: `test/scale.cjs`

**Interface:** `gelLoadout(rows, vespiumBudgetHr)` keeps its current result shape but becomes exact for the discrete full-time choice model.

- [ ] Add the cap-1 speeds `6/4/4` counterexample and require the two medium lines (`8.997188379` Gel/hour).
- [ ] Add a small exhaustive oracle and compare every 1–5 line case across caps/budgets.
- [ ] Implement multiple-choice Pareto-frontier dynamic programming: each line contributes off plus every eligible compression; after each line, prune states dominated in both Vespium use and Gel output.
- [ ] Define epsilon, stable tie-breaks, and deterministic line ordering explicitly. On equal Gel, prefer lower Vespium, then a documented lexicographic choice over physical line IDs and compression; do not refer to “fewer line changes” unless prior loadout is an explicit input.
- [ ] Account for real call volume: `solveCore` invokes Gel loadouts for ranked-line prefixes and Credits repeats that work across candidates. Reuse prefix frontiers incrementally where possible, or keep a separately named bounded seed helper while reserving exact `gelLoadout` for claims of maximum capacity.
- [ ] Add full Items/Credits timing, parity, and budget-monotonicity tests plus 5/7/8/10/12-line helper guards. Do not introduce a wall-clock cap that silently makes “best” approximate again.
- [ ] Assert `vespHr <= budget`, one choice per line, exact total sums, and no exhaustive candidate beats the result.
- [ ] Prove the exact helper through the generated app’s current Blob Worker as well as direct Node tests. A `js/solver.js` change must rotate the hashed app; no test or implementation may update the frozen v2 compatibility Worker.
- [ ] Update copy only if the result remains approximate for any supported input. Otherwise retain “best” with the new proof tests.

## Task 6: Correct Credits Warning Ownership and Enforce a Real Deadline

**Priority:** P2 correctness/performance

**Depends on:** Tasks 0 and 3

**Files:**

- Create: `test/credits-contract.cjs`
- Modify: `js/solver.js`
- Modify: `js/results.js`
- Modify: `index.html`

**Result contract:** every ranking candidate owns `usesMargin`, `capped`, `ms`, and `evaluated`; the top-level result separately exposes `allCandidatesEvaluated`, `deadlineReached`, and `searchExhaustive`.

- [ ] Add the strict Bits winner / losing Glass margin RED test. Require no May-work notice on Bits.
- [ ] Add deterministic injected monotonic-clock/work-budget tests plus loose 12-line all-products wall-time guards for 200/400/800/1600ms budgets.
- [ ] Store plan-specific flags on candidates and derive the displayed plan warning from `top` only.
- [ ] Treat “some candidate capped” as ranking confidence, not winning-plan feasibility.
- [ ] Use one absolute deadline for the whole Credits comparison. Define a genuinely bounded deterministic baseline for every priced item before spending remaining work on deeper refinement; if even that baseline cannot finish, mark the remaining candidates unevaluated.
- [ ] Thread the deadline/work budget into `repair`, `climb`, `minDeficitAtScore`, prefix Gel seeds, role enumeration, and every other individual seed loop—not only checks between seed families.
- [ ] Assert repeated-run determinism and nondecreasing per-candidate/global objectives at 200/400/800/1600ms.
- [ ] Define confidence precisely: `allCandidatesEvaluated` means every candidate got the bounded baseline; `searchExhaustive` means no competitive candidate was capped. Copy remains “best found” whenever exhaustive comparison is false, and identifies unevaluated candidates when present.
- [ ] Hide/disable Copy to Manual unless the winning plan contains a non-idle job.
- [ ] Rewrite the false “always mono-product” comment to describe the dedicated-item comparison contract.
- [ ] Run the budget/deadline contract through the generated current Blob Worker. Keep deterministic clock/work-budget injection in current source/test seams only; never add it to either permanent compatibility endpoint.

## Task 7: Expose and Control Project Line-Stability Tradeoffs

**Priority:** P2 trust

**Depends on:** Tasks 4 and 6

**Files:**

- Create: `test/stability-ui.cjs`
- Modify: `js/fields.js`
- Modify: `js/state.js`
- Modify: `test/state-schema.cjs`
- Modify: `js/core.js`
- Modify: `js/solver.js`
- Modify: `js/results.js`
- Modify: `js/events.js`
- Modify: `index.html`
- Modify: `test/stability.cjs`
- Modify: `test/project-transients.cjs`
- Modify: `test/browser/smoke.spec.js`
- Modify: `test/browser/state-recovery.spec.js`
- Modify: `test/run-all.cjs`
- Modify: `README.md`
- Modify: `css/styles.css` only if the new semantic block needs component styling

**State contract:** bump `CURRENT_SCHEMA_VERSION` from 1 to 2 without renaming `forgePlannerState_v3`. Add `projectStability: "prefer-current" | "reoptimize"`; default new, unversioned, and valid v1 saves to `prefer-current`, and require the exact enum for v2. Preserve strict validation of every v1-required field during migration—do not let the new version branch weaken old structural checks. V2 also requires unique project IDs. For a legacy v1/unversioned duplicate, preserve the first ID and deterministically assign each later duplicate a collision-free safe migrated ID based on its source-array position; never let two accepted projects share a semantic/cache identity.

**Cache policy:** a visible prefer-current solve may read pins and propose remembered stability records; a visible reoptimize solve ignores pins but may remember its selected jobs. Hidden comparison solves, ordering estimates, preliminary fixed-point passes, and warm-up solves may neither read nor write pins. `projectSchedule()` must not mutate stability state directly. `optimizeProjectTop()` commits only the selected visible plan’s proposed updates, atomically after a successful full run; failed selected runs retain the previous-good cache, unrelated keys survive, and the 256-entry cap remains. Worker `__stab` is the complete post-commit cache snapshot: it preserves unrelated incoming records, applies additions/replacements only from the successful selected visible run, and includes nothing learned from hidden, preliminary, ordering, warm-up, partial, or failed work.

**Comparison contract:** return the selected visible plan plus this summary only; never expose the hidden alternative plan:

```js
{
  projectStability,
  stabilityComparison: null | {
    comparable,
    selectedExecutable,
    alternativeExecutable,
    selectedPhaseOrder,
    alternativePhaseOrder,
    orderChanged,
    selectedTotalEta,
    alternativeTotalEta,
    alternativeMinusSelectedTotalEta,
    selectedWorkEta,
    alternativeWorkEta,
    alternativeMinusSelectedWorkEta,
    selectedWarmupEta,
    alternativeWarmupEta,
    alternativeMinusSelectedWarmupEta,
    alternativeIsShorter,
    phases: [{
      phaseKey,
      name,
      selectedThroughput,
      alternativeThroughput,
      selectedEta,
      alternativeEta,
      selectedThroughputLossPct,
      selectedEtaPenaltyPct
    }]
  }
}
```

The three `alternativeMinusSelected*` fields are `alternative - selected`; a negative total difference means re-optimization is shorter. Totals come from complete `executionPhases`; work/per-phase values come from semantic phases. `selectedPhaseOrder` and `alternativePhaseOrder` are arrays of phase keys, never display names. Match phases by a validated-unique semantic key—sequenced project ID, sorted combined IDs, or sorted wave IDs—never by display name or array index. Include only actually stabilized phases in the per-phase comparison.

`selectedExecutable` / `alternativeExecutable` require the run itself to have `feasible === true`, `lpFeasible === true`, and `partial !== true`, plus `scheduleValidation.ok === true`, no first failure, and finite nonnegative total/work/warm-up ETAs. The same full-demand success boundary gates selected-cache commit. `comparable` additionally requires both schedules executable, unique phase keys, and exactly one finite positive-throughput/nonnegative-ETA alternative match for every stabilized selected key. Use `ETA_COMPARE_EPS = max(1e-9 hours, Number.EPSILON * 64 * max(1, |selected|, |alternative|))` for total/work/phase ETA comparisons and the analogous `THROUGHPUT_COMPARE_EPS = max(LP_ASSIGN_EPS, Number.EPSILON * 64 * max(1, |selected|, |alternative|))` for throughput. `alternativeIsShorter` is true only when `alternativeTotalEta - selectedTotalEta < -ETA_COMPARE_EPS`. Define `selectedThroughputLossPct = 100 * (alternativeThroughput - selectedThroughput) / alternativeThroughput` and `selectedEtaPenaltyPct = 100 * (selectedEta - alternativeEta) / alternativeEta`; a zero/invalid denominator makes the comparison noncomparable instead of fabricating a percentage.

- [ ] Freeze the 420-Frames case as RED coverage: held phase throughput is 2.6304% lower and its ETA 2.7015% longer, but held warm-up is 129.94 seconds shorter and complete held ETA `0.6659750249h` beats reoptimized `0.6846583163h` by 67.26 seconds. Both schedules must have `scheduleValidation.ok === true`, no first failure, and no inventory boundary below the configured absolute-plus-relative stock tolerance. Do not clamp the tiny accepted floating-point residuals merely to satisfy a literal `>= 0` assertion.
- [ ] Refactor a full-run path such as `solveProjectRun(sequence, net, perProject, policy)` through sequencing, waves/combined phases, recursive warm-ups, phase ordering, carried inventory, replay, and finish clocks. The hidden alternative is eligible only when prefer-current actually stabilizes a phase.
- [ ] Make stability records an explicit input/output of schedule construction. Build records only from final converged feasible semantic phases; never mutate cache during preliminary, hidden, ordering, warm-up, failed, or partial work.
- [ ] Add the Project policy selector in the Shopping-list controls with a visible `<label for="projectStability">Line-job policy</label>` plus `aria-describedby` help explaining the 5% band and that re-optimization can improve phase throughput yet lose overall after warm-ups/order changes. Sync it from state and re-solve Project mode on a valid user change; cover both the accessible name and description association.
- [ ] Render escaped affected-phase throughput/ETA differences, selected versus alternative complete ETA, warm-up difference, order changes, executability, and the retained-policy reason. Present **Current line jobs retained** as selected-state text rather than a no-op button. Offer **Use shorter re-optimized plan** only when its total is shorter. Otherwise use **Use higher-throughput line jobs anyway** only when every compared phase is at least within its pairwise throughput tolerance and at least one phase is higher by more than tolerance. Use neutral **Use re-optimized line jobs anyway** when all phases are within tolerance or when material phase deltas are mixed/negative. Quantify across every compared phase; never branch on the first row. When reoptimize is active, offer **Prefer current line jobs on future edits**. If the alternative is nonexecutable or the summary is noncomparable, explain why and offer no comparison-block speed/throughput switch; the always-available policy selector remains the deliberate override.
- [ ] Remove remaining unqualified Project-facing “fastest/optimal” wording, including the Project modal, sequence toggle, result summary, and README. Replace the existing warm-up promise that every boundary is literally nonnegative with truthful “no material shortage / within replay tolerance” copy. Do not alter accurate Mined-mode “fastest current line” copy.
- [ ] Cover sub-band holds, past-band release at the established 420/500 boundary, zero-gap swaps, both longer and shorter alternatives, a replay-safe but LP-partial run that is not executable/comparable and cannot commit cache, a failed/noncomparable alternative with no misleading action, a mixed multi-phase throughput case that uses neutral copy rather than the first row, duplicate display names, deterministic legacy duplicate-ID migration plus v2 duplicate-ID rejection, sequenced/wave key ordering, JSON roundtrip, eviction, schema migration/strictness, selector persistence/reset, malicious phase names, and truthful static copy.
- [ ] Prove cache isolation with sentinels: hidden comparison, ordering, preliminary, and warm-up work cannot touch cache; repeated held runs remain held; visible reoptimize remembers its selected jobs; failed selected runs retain prior-good records.
- [ ] Extend generated-app smoke coverage using the ordinary current Blob Worker: establish schema-v2 prefer-current pins, rerun the 420 case under both policies, assert the expected executable/full-ETA tradeoff and a full post-commit `__stab` snapshot whose changes come only from the selected visible run, and require zero permanent Worker/dependency requests. Use no deterministic test hook in the browser path.
- [ ] Preserve `js/solver.worker.js`, `compat/solver.worker.v2.js`, `test/fixtures/solver-worker-v2-request.json`, the compatibility checksums/golden, and both permanent endpoints byte-for-byte. No production change is expected in `js/solve-service.js` or the current Worker handler.

## Task 8: Unify Numeric Validation, Error Messaging, and UI Ranges

**Priority:** P2

**Depends on:** Tasks 1, 6, and 7

**Files:**

- Create: `test/field-validation.cjs`
- Create: `test/browser/field-validation.spec.js`
- Modify: `js/fields.js`
- Modify: `js/state.js`
- Modify: `test/state-schema.cjs`
- Modify: `js/core.js`
- Modify: `js/events.js`
- Modify: `js/render.js`
- Modify: `js/dom.js`
- Modify: `js/results.js`
- Modify: `js/solver.js`
- Modify: `css/styles.css`
- Modify: `index.html`
- Modify: `test/run-all.cjs`
- Modify: `test/browser/accessibility.spec.js`
- Modify: `test/browser/visual-layout.spec.js`
- Modify: `test/browser/smoke.spec.js`

**Interface:** extend Task 1’s authoritative field descriptors with parser/formatter/error presentation and bind them to controls; do not duplicate state/import constraints.

**Version and budget decision:** keep `CURRENT_SCHEMA_VERSION = 2`, storage key `forgePlannerState_v3`, and the established `solveBudget` range of **200–60,000ms**. Task 1 explicitly restored 60 seconds for save compatibility, and current schema/normalization/solver/Worker code accepts it. Make the Settings slider reach 60 seconds and derive every clamp/range from the descriptor. Do not quarantine, coerce, or silently reduce valid existing 60-second saves.

**Pure field API:** add helpers equivalent to `validateFieldValue(rule, value)`, `parseFieldDraft(rule, raw, {badInput})`, `formatFieldValue(rule, value)`, and descriptor-derived input attributes. Parsing returns exactly `valid`, `blank`, `incomplete`, or `invalid`. Rules own decimal versus integer versus enum/game-notation parsing, blank behavior, min/max, input mode, units, and specific end-user errors. `1e`, `1e+`, `1q`, `1s`, and native `badInput` are incomplete; a readable trailing decimal such as `2.` is valid and canonicalizes to `2` so blur/change/Enter cannot strand an otherwise unambiguous value. Split the generic amount rule into named sell-price, Forgie, mined-income, inventory, and project-quantity descriptors even where their security limits currently match.

**Mutation boundary:** parse before `mutateState`. A valid value updates the model and follows that field’s existing save/solve-or-stale behavior; a valid optional blank commits `null` and clears its persisted display text. Incomplete/invalid input stays visible in the DOM, leaves both the numeric model and persisted text map at their last valid values, and triggers no mutation, save, stale marker, solve scheduling, or Enter/change flush. Project `from`/`to` handlers parse both visible endpoint drafts together: only a syntactically and dynamically valid `from <= to` pair commits, and it commits both endpoints atomically. Correcting either endpoint may resolve a previously invalid peer draft, clear both errors, and commit the pair without forcing a particular edit order. The inline `change` path must not solve an invalid/uncommitted pair. `doSolve()` must also stop when transactional persistence rejects the current state rather than dispatching it to a Worker. Closing/reopening or otherwise rebuilding an editor may abandon an unsaved bad draft and restore the last valid persisted value.

**Feedback contract:** render each empty `.field-error` before it can be updated, as a polite atomic live region outside any wrapping `<label>` naming subtree. Set `aria-invalid="true"` and append its stable ID to—not replace—any existing `aria-describedby` help tokens. Error copy names the accepted form/range and says which previous value remains active. Price/Forgie/inventory rows regain a direct feedback row; line/global/mined/calibration fields place feedback under the control; recipe errors remain inside their table cell; Shopping-list Project range/priority errors use a full-width tools error row so Task 11A geometry is preserved. Each inline Project row owns a separate full-width `.proj-inline-errors` flex/grid child after its controls, with stable per-endpoint associations. Refactor nested calibration and Hydracite labels as needed so feedback is a sibling rather than part of the accessible name. At 320px, both Project error placements wrap without page overflow.

**Solve-budget control:** preserve the exact persisted integer range while making low budgets usable on a narrow screen. Map the range control over friendly millisecond stops `200, 500, 1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000, 30000, 45000, 60000`; if an accepted persisted value is not a standard stop, inject it into the sorted stops for that session so merely opening Settings never rounds or changes it. Derive the first/last stops from `FIELD_SCHEMA.solveBudget`, expose the actual duration through `aria-valuetext`, and commit only the selected exact millisecond value.

- [ ] RED: `abc`, negatives, oversized dupe/margin, invalid compression, imported 60-second budget versus 15-second slider, and partial scientific/game notation.
- [ ] Use the decided 60-second maximum in HTML, descriptors, normalization, result dispatch, Worker messages, and solver. Prove a persisted 60-second value renders accurately and reaches the current generated Worker unchanged.
- [ ] Apply explicit valid ranges to dupe, margin, turbo, line speed, inventory, Forgie, prices, mined income, project quantities, base time, and recipe costs.
- [ ] Preserve a typed invalid/incomplete DOM draft without changing the last valid model or stored bytes. Show nearby feedback with `aria-invalid=true`, preserved help associations, and prior-value copy; correction clears the error and resumes the existing solve/stale path.
- [ ] Replace the dead `data-prev` lookup with the shared visible field-feedback contract.
- [ ] Keep schema v2 compatibility for historical display-text maps, but reject actual invalid numeric/import fields transactionally instead of normalizing them. Invalid GUI drafts must never enter export, localStorage, rendering state, or Worker snapshots.
- [ ] Cover required line speed/base time, optional recipe cost and amount blanks, turbo/max turbo/dupe, target/margin sliders, calibration fields, Project quantity/range/priority (including `from <= to` and live level bounds), and inline Project range controls. Manual compression remains a constrained select.
- [ ] Align solver defensive clamps with descriptors (including margin 20 and budget 60,000) without changing valid objectives.
- [ ] Verify keyboard, paste, mobile numeric keyboards, game suffixes, exponent notation, blank values, and localization-safe display.
- [ ] Node coverage must prove descriptor/state parity, commas/case/game suffixes, exponent notation, partial `1e`/`1e+`/`1q`, readable trailing-decimal canonicalization, native `badInput`, negative/overflow/integer failures, optional/required blank behavior, stable messages, formatting, and dynamic Project bounds.
- [ ] CI-only browser coverage must prove last-valid state/storage behavior, no invalid Enter/change solve, atomic two-endpoint Project correction in either edit order, valid-to-invalid-to-corrected and valid-to-blank flows, pre-existing live-region/error associations, exact preservation of a nonstandard in-range solve budget, 60-second settings/Worker dispatch, calibration Apply gating, both Project feedback layouts at 320px, root-overflow geometry, and Axe with visible errors. Syntax-check locally; do not launch a browser.
- [ ] Exercise accepted/rejected snapshots through the ordinary generated current Blob Worker because `js/fields.js` and `js/state.js` are embedded Worker dependencies. Assert the hashed app rotates, no permanent Worker/dependency URL is requested, and both permanent compatibility files plus the historical fixture/golden remain byte-for-byte unchanged.

## Task 9: Introduce One Accessible Dialog Controller

**Priority:** P1 accessibility

**Depends on:** Task 2; if Task 8 lands first, rebase before integrating shared markup

**Files:**

- Create: `js/dialogs.js`
- Create: `test/browser/dialogs.spec.js`
- Modify: `index.html`
- Modify: `js/events.js`
- Modify: `css/styles.css`

**Interface:** `dialogController.register({root, panel, opener, initialFocus, onOpen, onClose})`.

- [ ] Add RED keyboard tests for Sell prices, Forgie, Mined Resources, Settings, Shopping list, and Progress.
- [ ] Give every panel `role="dialog"`, `aria-modal="true"`, and an `aria-labelledby` title.
- [ ] On open, record the invoker, lock background scroll, mark background inert, render, and move focus to the most useful first control/heading.
- [ ] Reset the overlay and designated dialog-body scroll position on every open. RED/GREEN test: scroll Mined Resources, close, reopen, and require its title/close context at the top rather than the previous `scrollTop`.
- [ ] Trap Tab/Shift+Tab, close on Escape/backdrop/Done, and restore focus to the exact invoker.
- [ ] Ensure only the top dialog responds if nested dialogs are ever introduced.
- [ ] Replace duplicate document-level Escape listeners with controller ownership.
- [ ] Give every close button an action-specific accessible name.
- [ ] GREEN: complete lifecycle for all six dialogs on desktop/mobile; Mined Resources behavior is preserved.

## Task 10: Repair Accessible Names, Status, Project Controls, Contrast, and Motion

**Priority:** P1/P2 accessibility

**Depends on:** Task 9

**Files:**

- Create: `test/browser/accessibility.spec.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `index.html`
- Modify: `js/render.js`
- Modify: `js/events.js`
- Modify: `js/results.js`
- Modify: `css/styles.css`

- [ ] Add `@axe-core/playwright` or equivalent automated checks, but retain explicit assertions for control names and focus because automated scans do not catch the whole workflow.
- [ ] Add the `test:a11y` package script to the existing manifest and run it in CI.
- [ ] Give price/Forgie/inventory/recipe fields names containing item and level context.
- [ ] Label target priorities and May-work margin; connect visible help to controls programmatically.
- [ ] Replace CSS-only tooltip content with DOM text referenced by `aria-describedby`; preserve hover/focus visuals.
- [ ] Give mode controls `aria-pressed` or proper tab semantics.
- [ ] Add concise live/status behavior for save, stale, solving, solve failure/fallback, and result completion; do not announce entire result tables.
- [ ] Replace project disclosure spans with buttons and `aria-expanded`; make every action keyboard operable.
- [ ] Establish touch target tokens: prefer 44px, never below 24px without sufficient spacing.
- [ ] Adjust `--ink3`/surface/border tokens so small text is at least 4.5:1 and control boundaries/states at least 3:1.
- [ ] Add `<main>` and `prefers-reduced-motion` fallbacks.
- [ ] Add a keyboard-visible skip route to the primary planner/results flow.
- [ ] Give horizontal table scrollers a focusable, named region with instructions/affordance so keyboard and screen-reader users can discover and operate them.
- [ ] Test 200% zoom, high-contrast/forced-colors where supported, keyboard-only, and mobile touch layouts.

## Task 11: Repair Visual Regressions and Establish the Visual System

> **Owner scope correction (2026-08-02):** Merge unit 11A was reviewed, approved, released on `main`, and is the final UI checkpoint for this remediation pass. Merge units 11B–11D below are retained only as historical review notes and must not be implemented unless the owner makes a new explicit request. Preserve the checkpoint's design and continue with code, resilience, release, documentation, and audit work.

**Priority:** P1 responsive regressions / P2 visual system

**Overall dependencies:** Task 0 and Task 9. Merge unit 11A may begin after Task 9 and must serialize overlaps with Task 10; units 11B–11D also depend on Tasks 8–10 and the visual approval gate.

**Files:**

- Create: `docs/superpowers/specs/forge-planner-visual-system-design.md`
- Create: `test/browser/visual-layout.spec.js`
- Create: `test/browser/visual-states.spec.js`
- Create: `test/browser/visual-baselines/manifest.json`
- Create: `test/browser/visual-baselines/<viewport>/<state>.png`
- Create: self-hosted files under `assets/fonts/` plus their license notices
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `index.html`
- Modify: `css/styles.css`
- Modify: `js/render.js`
- Modify: `js/results.js`
- Modify: `js/manual.js`
- Modify: `js/events.js`
- Modify: `js/dialogs.js`

**Ownership boundary:** Task 10 defines accessible names, keyboard behavior, status semantics, and the semantic contract for scroll regions. Task 11 implements the visual primitives, component-level scrollers, final header/dialog composition, and responsive geometry. Task 12 consumes these components for onboarding/progressive disclosure; it must not redesign the header or dialog shell.

**P1 repair gate:** unit 11A stays within the existing product structure and may land before broader visual approval after its RED/GREEN evidence and rendered diff are owner-reviewed. It must not be held behind subjective P2 restyling.

**P2 design approval gate:** before units 11B–11D change production composition, capture annotated alternatives for (A) surgical polish and (B) system-first recomposition. Recommend B: preserve the industrial palette/type character while rebuilding the weak composition. Show the header, line card, result navigation/KPI, a wide result table, a project card, and a long dialog at 1440, 1024, 430, 390, and 320px. Do not expand this into a full step-based application shell without separate owner approval.

**Interfaces produced:**

- CSS tokens for spacing, type roles, control heights, radii, border strength, elevation, and semantic emphasis
- Reusable `.card-body`, `.field`, `.section-bar`, `.mode-nav`, `.metric-grid`, `.action-group`, `.dialog-shell`, and `.table-scroll` contracts (final names may change in the approved design spec)
- `npm run test:visual`, backed by real geometry/state assertions rather than an always-green screenshot command

### Merge unit 11A — P1 geometry and lifecycle repairs

- [ ] Write RED geometry/state tests for the actual failures: `#results` padding `0`; 900px mode-nav overflow; 1024px title/status wrapping; document overflow at 561–900px; 390/375px project-name collapse; 320px label/input overlap and orphaned line field; non-full-width toolbar at 430/560px; unreachable result columns; offscreen dialog actions; and the Credits price nudge surviving Project/Manual.
- [ ] Add the minimum spacing/control tokens needed by these repairs so fixes do not introduce another set of arbitrary constants. Task 10 remains authoritative for contrast, focus, target-size, naming, and keyboard constraints.
- [ ] Repair the missing result inset through a DOM-depth-independent card-body contract. Do not compensate with margins on notices, metrics, tables, or individual modes.
- [ ] Give mobile project cards named layout areas and put their tools on an intentional second row. Stack price/Forgie/inventory labels and inputs when inline placement cannot preserve their gap.
- [ ] Move result modes into a stable full-width row, contain/flip tooltip popovers, and remove page-level overflow masking after the underlying overflow is fixed.
- [ ] Constrain every dialog to the visual viewport using a sticky header/footer and an independently scrolling body. Reset that body’s scroll on open and respect safe-area insets.
- [ ] Move each oversized table into its nearest component-level scroller using Task 10’s semantic contract and a visible overflow cue. `#results` and the document must not be table scrollers; mobile Manual controls may not remain hidden in offscreen columns.
- [ ] Correct the reversed mobile cascade for `.brand h1`, `.tools`, and `button.btn`; at 430/560px the wrapped toolbar must fill its available container within 1px.
- [ ] Clear the Credits-only price nudge before every early return/mode transition. RED/GREEN Credits → Project and Credits → Manual: no stale prompt remains and Shopping list is not covered.
- [ ] 11A selector-level GREEN checks, with a documented 1px rounding tolerance: `#results` matches its inset token; `.mode-nav` stays within the result card; `.pname-static` is at least 140px wide at 375/390px; stacked `.proj-tools` begins below the identity row; label/input rectangles are disjoint; long-dialog header/footer stay within the viewport while only the body scrolls; and every element whose `scrollWidth > clientWidth + 1` has a nearest named `.table-scroll` owner.

### Merge unit 11B — Main composition and hierarchy

- [ ] Inventory the presentation surface in the design spec: 146 inline `style` attributes, at least 16 stylesheet font sizes, six unrelated max-width breakpoints, and every intentional dynamic exception.
- [ ] Finalize the compact token scale. Recommended starting values: space `4/8/12/16/24/32`; compact/standard/touch controls `32/36/44`; control/card/dialog radii `6/8/12`. Task 10’s accessible color/border decisions are inputs, not a second palette to replace.
- [ ] Recompose the page header as the final owner of its structure/content: concise identity, compact Help/About route for contribution instructions, grouped secondary utilities, and at most one visually primary action. Reset remains visually destructive and confirmation-protected.
- [ ] Recompose Optimal Setup into stable title/status and mode-navigation rows; refine 11A without weakening its geometry tests.
- [ ] Rebuild each crafter line as an identity/action header plus field grid. Remove redundant visual numbering, align label/control baselines, and define the third field’s 320px placement without an empty quadrant.
- [ ] Give single and odd-count metric sets intentional spans; avoid an 800px-wide lone KPI and a stranded half-width third Project metric.
- [ ] Prototype a sticky desktop result workspace versus a revised non-sticky flow. Choose only after checking long inputs, short results, and long Project results.
- [ ] Theme native controls consistently, including the blue Settings range, without breaking platform focus or forced-color behavior.

### Merge unit 11C — Dense dialogs, data editors, and Project output

- [ ] At desktop and mobile, make Mined Resources tables fit their information architecture. Either stack cards until primary columns have usable width or redesign the columns/table; if any overflow remains, its cue and named scroller must be persistent. Assert the current 650px table is not silently clipped inside 534px/443px card viewports.
- [ ] Replace Crafting Data’s row-coupled grid with separate raw/product groupings, masonry, or another approved non-row-coupled layout. Sparse cards must retain intrinsic height without leaving large dead gutters beneath them.
- [ ] Replace the multi-thousand-pixel nested-scroll Crafting Data surface on phones with an approved searchable/accordion editor. Opening one resource must not force eight simultaneous vertical scrollers.
- [ ] Recompose Project instructions into repeatable per-line groups with aligned job, duration, stop time, and expected stock. Preserve every number and sequence; change only presentation.
- [ ] Separate destructive Shopping list footer actions from the primary Done action and preserve the dialog shell established in 11A.

### Merge unit 11D — Source consolidation and deterministic visual gate

- [ ] Move presentation-only inline styles in owned surfaces into semantic classes. Keep an explicit allowlist only for genuinely dynamic values such as progress width and tooltip image variables; fail a source check on new unapproved inline presentation.
- [ ] Consolidate breakpoints around component needs and keep overrides after—or at equal specificity to—the declarations they replace.
- [ ] Self-host the selected fonts with license notices before recording geometry/screenshots. Add every font file and CSS reference to `scripts/build-static.cjs` so fonts are content-addressed members of the closed asset graph; the build must fail on an unregistered `url(...)` dependency.
- [ ] Emit font and other owned asset URLs relative to the generated stylesheet/document base so the same build works at `/` and `/Forge-Planner/`; do not add a new root-relative `/static/...` assumption while extending the graph.
- [ ] Capture only after `document.fonts.ready`; freeze animations, current-clock text, and solver-time text; use deterministic saved-state fixtures.
- [ ] Store approved baselines under `test/browser/visual-baselines/<viewport>/<state>.png`. The manifest records source revision, viewport, fixture/state name, font asset revision, capture command, expected intentional differences, reviewer, and approval date.
- [ ] Name the visual CI step and make `test:browser`/`test:visual` ownership non-overlapping so `visual-layout.spec.js` is not silently executed twice in the same gate.
- [ ] GREEN geometry at 320, 375, 390, 430, 560, 561, 640, 768, 880, 881, 900, 1024, and 1440px: document `scrollWidth <= clientWidth + 1`; each surface matches its documented inset token; the 11A selector assertions remain green; and sparse recipe layouts have neither stretched cards nor large empty row gaps.
- [ ] Screenshot-review fresh Items, solved Items, stale, Credits empty/solved, Project empty/long, Manual, Crafting Data, Sell prices, Forgie, Mined Resources, Shopping list with a long catalog name, Progress, and Settings at 320/375/390/430/768/900/1024/1440px. Record reviewer sign-off in the manifest and design spec.

## Task 12: Redesign First-Run and Mobile Task Flow Without Hiding Power

> **Owner scope correction (2026-08-02):** Deferred outside this remediation pass. The approved UI checkpoint is complete; do not reopen onboarding, navigation, header, dialog, or visual composition work without a new explicit request.

**Priority:** P2 UX

**Depends on:** Tasks 8–10 and completion of Task 11A–11D

**Files:**

- Create: `docs/superpowers/specs/forge-planner-onboarding-ia-design.md`
- Create: `test/browser/onboarding.spec.js`
- Modify: `js/dialogs.js`
- Modify: `test/browser/dialogs.spec.js`
- Modify: `index.html`
- Modify: `js/core.js`
- Modify: `js/events.js`
- Modify: `js/results.js`
- Modify: `css/styles.css`

**Design approval gate:** before production code, capture two alternatives for the first-run journey, progressive-disclosure rules, and mobile input↔result navigation. Get owner approval. Reuse Task 11’s approved header, dialog shell, tokens, and components; this task does not reopen their visual design.

- [ ] Clearly distinguish **Sample factory** from the user’s saved factory. Never relabel an existing saved build as sample.
- [ ] First-run choices: **Use sample**, **Enter my stats**, **Import build**. Explain the short journey: lines → goal/mode → result.
- [ ] Add an obvious mobile Results route and a sticky/out-of-date Resimulate action when the changed field and result are far apart.
- [ ] Make solve status say **Out of date** immediately; do not keep “solved in …” as the current status.
- [ ] Replace stacked generic/missing/zero-result Credits messaging with one concise empty state and direct **Enter sell prices** action. Add equally direct **Open Shopping list** and **Set mined income** actions where relevant; do not reintroduce floating overlays after Task 11A removes the stale nudge.
- [ ] Define when Mined Resources reference tables, Crafting Data editors, and Shopping list inventory/catalog are initially summarized versus expanded. Task 11 owns their shell/layout; this task owns disclosure order, labels, and task-oriented defaults.
- [ ] Replace native `alert`, `confirm`, and `prompt` flows with the shared app dialog language; provide recoverable undo for project deletion/clear actions where practical.
- [ ] Visually verify fresh, saved, imported, empty, error, blocked, stale, and long-project states at 320/375/390/768/900/1024/1440 widths.

## Task 13: Separate Persistence From Solving and Remove Main-Thread Progress Solves

**Priority:** P3 resilience/performance

**Depends on:** Tasks 1, 3, 3F, and 8 on the emergency-resynced current-build baseline

**Files:**

- Create: `test/browser/persistence.spec.js`
- Modify: `test/solve-lifecycle.cjs`
- Modify: `test/browser/solve-lifecycle.spec.js`
- Modify: `js/events.js`
- Modify: `js/results.js`
- Modify: `js/solve-service.js`
- Modify: `scripts/build-static.cjs` and `test/static-asset-build.cjs` only if the exact production Worker-constructor replacement seam changes

- [ ] RED: toggle a Shopping-list Project disclosure and tear down/reload before any unrelated save; `_open` is accepted schema-v2 state but is currently lost because the handler mutates without persistence. Also prove a dedicated persistence timer can write accepted state without calling `doSolve()`, `renderResults()`, or `solveService.request()`. Preserve Task 8's immediate-save behavior for price, margin, and other numeric drafts with explicit non-regression coverage.
- [ ] Add one owned 100ms persistence debounce (`schedulePersist` / `persistNow` / `flushPersist`) independent of the 500ms solve debounce. Audit accepted GUI mutations: each must save immediately, schedule persistence, or be explicitly documented as non-persisted transient UI. The disclosure path must schedule persistence. Existing solve-scheduling handlers must no longer depend on a future solve for durability; avoid duplicate delayed writes when `doSolve()` or an immediate save already persisted the same revision.
- [ ] Lifecycle ordering is exact: `pagehide` flushes pending persistence, clears `renderT` so delayed `doSolve()` cannot restart work, then cancels `solveService`; `visibilitychange` while hidden flushes persistence only and does not otherwise cancel, reschedule, or manufacture a solve. Do not launch an expensive solve merely to persist.
- [ ] Remove synchronous `optimizeProjectTop()` from `renderProgress()`. Cache a Project result with a solve-equivalence key derived from the exact dispatched state snapshot after removing only documented display-only `planStart` and each Project's `_open`; do not use raw global `stateRevision`, because those display mutations legitimately advance it without changing solver output. Any other state change invalidates the cache. Use that same solve-equivalence key at `solveService`'s in-flight currentness boundary (or an exactly equivalent solve-relevant revision): display-only `_open`/`planStart` mutations during a slow solve must not discard an otherwise authoritative result, while every solver-relevant mutation must still reject or supersede it.
- [ ] Opening Progress with a current key consumes the cache immediately. A Progress completion mutation schedules the existing normal debounced Project render/solve before repainting its counts, shows a truthful pending ETA while the key is stale, and refreshes an open Progress dialog when that one authoritative result returns. Opening an already-stale Project result after an explicit-Resimulate crafter-line edit must show out-of-date ETA and must not silently solve. Never start a second Progress request that supersedes the authoritative main Project request.
- [ ] Add the missing explicit current-solver factory/test hook inside `solveService`. Its default factory must retain the exact source constructor seam consumed by `scripts/build-static.cjs`, or the builder and static graph tests must be updated in the same task. Changing the factory must cancel/release any owned Worker before replacement.
- [ ] Add a deliberately slow fake solve through that factory hook and assert Progress opens and accepts completion controls without main-thread optimization or global `Worker` replacement; when the controlled result returns, both the main Project result and still-open Progress summary become current. Cover both sides of in-flight currentness explicitly: `_open` and `planStart` changes during the slow solve still accept its result, while a solver-relevant mutation rejects/supersedes it. Do not bypass `solveService` or couple persistence tests to either permanent compatibility endpoint.
- [ ] Preserve the explicit-Resimulate policy for crafter-line edits: persistence may flush independently, but this task must not turn those edits back into automatic expensive solves.

## Task 14: Finish Release Upgrade Coverage and Subpath Safety on the Hashed Build

**Priority:** P2 delivery

**Depends on:** Tasks 0 and 3F, emergency baseline `1466a5d`, and the integrated current build graph

**Files:**

- Create: `scripts/release-smoke.cjs`
- Create: `test/browser/release-upgrade.spec.js`
- Modify: `package.json`
- Modify: `scripts/build-static.cjs`
- Modify: `test/static-asset-build.cjs`
- Modify: `test/serve-built.cjs`
- Modify: `test/serve-vercel-config.cjs`
- Modify: `playwright.config.js`
- Modify: `.github/workflows/verify.yml`
- Modify: `js/render.js`
- Modify: `index.html` and owned asset references only where subpath fixes require it
- Modify: `README.md`
- Modify: `vercel.json` only if verification exposes a header/routing gap

**Implemented baseline at `1466a5d`:**

- [x] `scripts/build-static.cjs` emits deterministic content-addressed app, CSS, image, and embedded Worker bytes into `dist/`.
- [x] The current Worker and its dependencies are one self-contained payload inside the hashed app and run from a Blob URL; production solves do not fetch Worker scripts or `importScripts` dependencies.
- [x] `npm run build` and `npm run preview` exist, Playwright serves `dist/`, and the generated asset graph has a Node regression test.
- [x] `/` and `/index.html` revalidate; `/static/*` is long-lived/immutable under the production header configuration.
- [x] The original retired Worker fence and checksum-locked v2-era functional compatibility Worker are served at permanent immutable endpoints.
- [x] Current tooltip images are copied into the hashed graph and the generated app/page references their emitted assets.

**Remaining gaps:**

- [ ] Preserve the exact current Worker-constructor substitution, idempotent `__forgeRelease`, immediate termination revocation/setup-failure cleanup, frozen fixtures, and both permanent Worker bytes while changing URL emission or release wiring.
- [ ] Add `test:release` to the existing manifest and CI. It must build from clean source and verify the emitted site; it must not be an alias for the ordinary Node suite. Give every browser lane a named, non-overlapping CI step: `test:browser` excludes the dedicated accessibility, visual, and release-upgrade specs, while `test:a11y`, `test:visual`, and `test:release` each run their owned lane exactly once.
- [ ] Make every emitted application URL base-aware for both `/` and `/Forge-Planner/`. Replace the builder’s current root-relative `/static/...` output and any remaining root-relative tooltip/font/application references with document- or stylesheet-relative URLs. Preserve and assert the existing absence of Vercel Analytics.
- [ ] Extend the actual server seam in `test/serve-vercel-config.cjs` plus `test/serve-built.cjs`/release smoke so one identical `dist` byte tree is mounted at `/` and `/Forge-Planner/`. Strip only the recognized mount before safe file resolution and logical header matching; verify HTML revalidation, immutable hashed assets, CSP, `nosniff`, and the generated Blob Worker at both mounts.
- [ ] Implement standards-correct validators in the release server: ETag and Last-Modified on emitted files, conditional GET/HEAD, A validators against changed B HTML returning `200` with B bytes and a new ETag, and B validators returning `304`.
- [ ] On one port/origin, build temporary A and B sources with matching HTML/app release sentinels that deliberately fail when mixed. Warm A, atomically swap the served tree to B, reload with A validators, and assert B HTML plus the B app sentinel, a successful B Blob-Worker solve, no A-app request, unchanged-asset reuse, and no same-origin console/network error. Use a fresh origin only as a control.
- [ ] Assert old permanent Worker endpoints retain their exact bytes/cache behavior across the A→B swap while current page/Worker changes rotate only content-addressed assets.
- [ ] Verify current CSS/image graph changes independently rotate their affected hashes. If the existing externally hosted fonts are self-hosted solely for deterministic release/privacy, preserve the checkpoint's exact font families and appearance, register them here, and do not treat that plumbing as authorization for visual redesign.
- [ ] Document the exact GUI-friendly local preview plus cold-cache and warm-upgrade release verification steps. Do not replace the existing build architecture while filling these gaps.

## Task 15: Align Remaining Product Trust Copy and Operator Documentation

**Priority:** P2/P3 trust

**Depends on:** settled behavior from Tasks 4–7, 13, and 14

**Files:**

- Create: `docs/STATE_SCHEMA.md`
- Create: `docs/SOLVER_CONTRACT.md`
- Create: `docs/CATALOG.md`
- Create or update: `docs/RELEASING.md`
- Create: `test/catalog-validation.cjs`
- Modify: `test/run-all.cjs`
- Modify: `README.md`
- Modify: `index.html`
- Modify: `js/catalog.js` only to add truthful machine-readable provenance/update metadata; do not invent a source version or date
- Modify: `js/results.js` only if a focused regression proves a remaining inaccurate runtime claim

- [ ] Preserve the already-correct bounded-result, May-work, dedicated Credits, stability, warm-up/buffer, and mined-resource runtime copy. Do not churn released UI copy or layout unless a focused regression proves a remaining false claim. The live trust-copy corrections are currently limited to the stale absolute guarantee/privacy language in `index.html` and the unqualified solver/export/speed claims in `README.md`.
- [ ] Replace any remaining unqualified “optimal” claim with “best found within this time budget; not proven optimal,” and remove any absolute sustainability guarantee when May-work margin is active.
- [ ] Explain dedicated-item Credits, visible stability tradeoff, project warm-up/buffer semantics, and mined-resource hard caps in the operator/contract documentation without duplicating already-correct runtime copy.
- [ ] Document any Task 14 self-hosted copies of the checkpoint's existing font assets and their licenses. Keep the existing no-backend/local-first privacy scope precise; if any analytics remains after Task 14, document it visibly and verify planner state never enters requests.
- [ ] Clarify only the still-missing README/operator facts: export scope, solve-time behavior, browser support, persistence/recovery, schema version, and the final Task 14 preview/release commands. Reference the existing hashed-build and permanent Worker compatibility contract rather than redesigning or duplicating it.
- [ ] Document catalog source/version/update procedure and provenance. If no trusted game export/version/date/hash is available, record it explicitly as unknown/unverified rather than inventing provenance. Add structural/semantic validation to the explicit `test/run-all.cjs` list and prove `npm test` executes it: category IDs are unique and descriptor-valid; names and levels are nonempty and well-formed; item references are known; quantities are finite, nonnegative, and within the supported range; duplicate cost items within a level are rejected where that is the catalog contract; and every `PROJECT_PREREQS` key/target resolves to a catalog entry. Do not encode unverified game-value assertions.
- [ ] Document supported mechanics and intentional non-findings so future agents do not “correct” pre-produced Bits, independent mined budgets, or explicit Resimulate.
- [ ] Keep release documentation bounded to operator behavior: clean build, GUI-friendly preview, cold/warm verification, immutable asset expectations, and rollback. The deterministic builder and cache headers remain executable truth.

## Task 16: Final Adversarial Regression and Release Candidate Audit

**Priority:** Release gate

**Depends on:** all accepted tasks

**Files:**

- Create: `docs/reviews/YYYY-MM-DD-hardening-release-verification.md`
- Modify: `js/events.js`
- Modify: `js/dialogs.js`
- Modify: `css/styles.css`
- Modify: `test/browser/state-recovery.spec.js` (or the existing owned recovery spec)
- Modify: `test/browser/dialogs.spec.js`
- Modify: `test/browser/accessibility.spec.js`
- Update other tests/docs only when verification discovers a real gap

- [ ] Start from the current live application save or an exported copy supplied for release verification; never overwrite it during testing.
- [ ] Before the broad audit, close the three owned checkpoint minors with targeted RED/GREEN regressions and no composition, navigation, dialog, or token redesign: recovery dismissal restores the connected exact invoker (or its replacement by stable ID), with a safe Import fallback only for boot-time recovery; nested-dialog cleanup snapshots and restores each body child's pre-existing `inert` state; and activating the skip link focuses `#plannerMain` with a visible non-`none` focus indicator in normal and forced-colors modes.
- [ ] Run the Standard Verification Gate twice: cold cache and warm upgrade cache.
- [ ] Re-run and record the existing named counterexample coverage—including project transients, Worker/Manual lifecycle, import attack corpus, state schema/recovery, Gel exactness, Credits contracts, stability UI, numeric fields, compatibility/static build, dialogs, and visual layout—instead of duplicating it. Add new tests only for Task 13 persistence/Progress, Task 14 release upgrade/subpath, Task 15 catalog validation, the three targeted minors above, or a newly reproduced gap.
- [ ] Run exhaustive-oracle small solver cases, parity, scale through 12 lines, catalog validation, and all legacy migration fixtures.
- [ ] Run the frozen v2-era compatibility request/response fixture and byte/checksum assertions for both permanent Worker endpoints; confirm current features execute only in the generated Blob Worker.
- [ ] Browser-test every mode/dialog at 1440×900, 1024×768, 900×760, 881×900, 880×900, 768×1024, 640×900, 561×900, 560×900, 430×932, 390×844, 375×812, and 320×568; capture representative screenshots. Current visual coverage samples only a subset of mode×viewport combinations, so the release matrix itself must be complete. Any repair is limited to a reproduced regression against the released checkpoint tokens/geometry and is not authorization for redesign.
- [ ] Keyboard-test the existing checkpoint flow from fresh load → data entry → solve → project → progress → export; no new onboarding or navigation design is implied.
- [ ] Inspect console, failed requests, CSP violations, storage mutations, Worker lifecycle, and outbound request payloads.
- [ ] Instrument current Blob Worker creation/termination and prove every early termination immediately revokes its object URL, an idle late error cannot activate fallback, and repeated solves add no Worker/dependency HTTP requests.
- [ ] Confirm no body-level horizontal overflow, zero-inset result state, title/tab/status collision, project-name collapse, label/input overlap, offscreen dialog action, or stretched sparse recipe card; intentional tables must identify and contain horizontal scrolling.
- [ ] Have a second agent review the implementation against this plan and the original review without seeing the implementer’s conclusions first.
- [ ] Build and serve the same release under `/` and `/Forge-Planner/`; verify all app/CSS/image/font URLs, CSP, dialogs/tooltips, and solves without root-relative leakage.
- [ ] On one origin, execute the release-A warm cache → incompatible release-B swap. Record HTML revalidation, cache headers/validators, loaded asset hashes, compatibility endpoint bytes, and the successful B solve.
- [ ] Confirm the generated asset graph is closed: every page script, Worker dependency, stylesheet, image, and font is registered; a mutation rotates the expected hash and leaves unrelated assets stable.
- [ ] Record passed evidence, known limitations, and any deliberately deferred P3 item in the verification document.
- [ ] Do not call the release complete, push, or merge until the owner reviews the rendered release candidate and explicitly approves it.

## Definition of Done

- Every P1 finding has a regression that fails on revision `78f496a` and passes on the release candidate.
- Project instructions are executable from the displayed inventory or state an exact, included warm-up requirement.
- No stale Worker result can paint after a mode/state change.
- Malformed/imported state can neither execute markup nor prevent GUI recovery.
- Gel “best,” Credits warnings, Credits timing, and Project stability copy match the actual algorithms.
- All primary workflows are keyboard-operable, named, focus-safe, contrast-compliant, and usable at 320px.
- Every primary surface has approved spacing/hierarchy at the breakpoint matrix; the document never hides horizontal overflow, and wide components own visible, operable scrolling.
- The released Task 11A geometry remains intact across the viewport matrix; no post-checkpoint visual redesign or new visual-system requirement is implied.
- One command runs the deterministic suite; CI, browser/Worker, accessibility, and release-upgrade gates are green.
- Existing saves and intentional mechanics are preserved.
- Final documentation describes observed behavior without stronger guarantees than the code can support.
