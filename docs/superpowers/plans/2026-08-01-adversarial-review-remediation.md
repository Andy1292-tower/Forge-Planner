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
- Line stability remains available, but its speed cost must be visible and optional.
- The application stays usable without a backend or account.
- User-controlled values must never enter executable HTML contexts.
- Every UI change must be checked at desktop and mobile widths, with keyboard-only navigation and preserved focus.
- Preserve the dark industrial character, but do not preserve accidental spacing, collisions, overflowing grids, or equal emphasis across unrelated actions.
- Wide data belongs in named component-level scrollers; page-level clipping is not an acceptable responsive strategy.
- Do not erase a damaged save. Quarantine it and offer GUI recovery/download.
- Do not merge implementation branches or PRs without explicit owner approval.

## Agentic Execution Model

Use a fresh `codex/` worktree branch for each merge unit. Parallel research and test-authoring are encouraged; implementation that overlaps `js/events.js`, `js/results.js`, or `index.html` must be serialized through one integration agent.

| Wave | Tasks | Parallelism |
| --- | --- | --- |
| 0 | Task 0 | One foundation agent; merge first |
| 1 | Task 1, then Tasks 2–3 | Merge the state boundary first; security and solve-lifecycle work may then run in parallel worktrees with serialized integration |
| 2 | Tasks 4–7 | Solver corrections can be independent if each owns separate functions/tests; one integration review after all four |
| 3 | Tasks 8–10 | Field, dialog, and accessibility foundations; serialize shared markup/events changes |
| 4 | Task 11A; approval; Tasks 11B–11D; then Task 12 | Land P1 geometry first, then approved system composition, then onboarding/IA; one UI integration agent |
| 5 | Tasks 13–14, then Task 15, then Task 16 | Resilience and release engineering may run in parallel where safe; documentation follows Task 14 and settled behavior, then final verification runs after integration |

Each task follows this handoff:

1. Worker writes the failing regression and records the RED output.
2. Worker implements only that task and records focused GREEN output.
3. Reviewer checks the diff against the review finding and runs the focused test independently.
4. Integration agent rebases, resolves overlaps, and runs the standard full gate.
5. Owner reviews rendered changes before merge.

## Standard Verification Gate

Task 0 creates `npm test` and `test:browser`. Task 10 adds `test:a11y`; Task 11 adds `test:visual`; Task 14 adds `build` and `test:release`. Until each command exists, run the task's focused checks plus the available subset. Never add a placeholder command that reports green without running its promised checks.

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
- Modify: `js/solver.worker.js`

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
- [ ] GREEN: zero-stock Frames case starts with a valid warm-up, all boundaries stay nonnegative, ETA includes it, and existing inventory/mined/partial scenarios retain their intended behavior.

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

## Task 7: Expose and Control Project Line-Stability Tradeoffs

**Priority:** P2 trust

**Depends on:** Task 4

**Files:**

- Create: `test/stability-ui.cjs`
- Modify: `js/state.js`
- Modify: `test/state-schema.cjs`
- Modify: `js/core.js`
- Modify: `js/solver.js`
- Modify: `js/results.js`
- Modify: `js/events.js`
- Modify: `index.html`

- [ ] Reuse the existing 2.36% held-plan case as RED UI coverage.
- [ ] Add persisted, schema-validated setting `projectStability: "prefer-current" | "fastest"`; default new and legacy saves to `prefer-current`, preserve it through export/import, and cover its migration.
- [ ] When stabilized and slower, render each affected phase’s exact throughput/ETA difference plus the total plan ETA difference, the reason jobs were retained, and GUI actions **Keep current line jobs** / **Use fastest plan**.
- [ ] Make the choice global and unambiguous: **Use fastest plan** changes the persisted setting to `fastest`, bypasses pins for every phase, and re-solves the entire plan. A future phase-specific override requires a separate design.
- [ ] Remove unqualified “fastest/optimal” wording when a slower stable plan is displayed.
- [ ] Test zero-gap swaps, sub-band holds, past-band releases, mode persistence, and Worker serialization.

## Task 8: Unify Numeric Validation, Error Messaging, and UI Ranges

**Priority:** P2

**Depends on:** Task 1

**Files:**

- Create: `test/field-validation.cjs`
- Create: `test/browser/field-validation.spec.js`
- Modify: `js/fields.js`
- Modify: `js/state.js`
- Modify: `test/state-schema.cjs`
- Modify: `js/core.js`
- Modify: `js/events.js`
- Modify: `js/render.js`
- Modify: `index.html`

**Interface:** extend Task 1’s authoritative field descriptors with parser/formatter/error presentation and bind them to controls; do not duplicate state/import constraints.

- [ ] RED: `abc`, negatives, oversized dupe/margin, invalid compression, imported 60-second budget versus 15-second slider, and partial scientific/game notation.
- [ ] Choose one supported solve-budget maximum and use it in HTML, descriptors, normalization, Worker messages, and solver. Recommendation: retain 15 seconds unless measured user cases justify 60.
- [ ] Apply explicit valid ranges to dupe, margin, turbo, line speed, inventory, Forgie, prices, mined income, project quantities, base time, and recipe costs.
- [ ] Preserve typed text while invalid, preserve the last valid model value, and show a nearby message with `aria-invalid=true` and `aria-describedby`.
- [ ] Remove dead `data-prev` lookup or render the intended feedback element consistently.
- [ ] Reject invalid import fields in the transactional preview rather than silently coercing them.
- [ ] Verify keyboard, paste, mobile numeric keyboards, game suffixes, exponent notation, blank values, and localization-safe display.

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
- [ ] Self-host the selected fonts with license notices before recording geometry/screenshots. Capture only after `document.fonts.ready`; freeze animations, current-clock text, and solver-time text; use deterministic saved-state fixtures.
- [ ] Store approved baselines under `test/browser/visual-baselines/<viewport>/<state>.png`. The manifest records source revision, viewport, fixture/state name, font asset revision, capture command, expected intentional differences, reviewer, and approval date.
- [ ] GREEN geometry at 320, 375, 390, 430, 560, 561, 640, 768, 880, 881, 900, 1024, and 1440px: document `scrollWidth <= clientWidth + 1`; each surface matches its documented inset token; the 11A selector assertions remain green; and sparse recipe layouts have neither stretched cards nor large empty row gaps.
- [ ] Screenshot-review fresh Items, solved Items, stale, Credits empty/solved, Project empty/long, Manual, Crafting Data, Sell prices, Forgie, Mined Resources, Shopping list with a long catalog name, Progress, and Settings at 320/375/390/430/768/900/1024/1440px. Record reviewer sign-off in the manifest and design spec.

## Task 12: Redesign First-Run and Mobile Task Flow Without Hiding Power

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

**Depends on:** Tasks 1 and 3

**Files:**

- Create: `test/browser/persistence.spec.js`
- Modify: `js/events.js`
- Modify: `js/results.js`
- Modify: `js/solve-service.js`

- [ ] RED: edit a target/price/margin and reload within 500ms; current value is lost.
- [ ] Add a cheap persistence debounce independent of the solve debounce; flush pending persistence on `pagehide` and when visibility becomes hidden.
- [ ] Do not launch an expensive solve merely to persist.
- [ ] Remove synchronous `optimizeProjectTop()` from `renderProgress()`. Consume a current cached project result or request it through the solve service.
- [ ] Add a deliberately slow fake solve and assert Progress remains responsive.

## Task 14: Make Releases Cache-Coherent and Subpath-Safe

**Priority:** P2 delivery

**Depends on:** Task 0

**Files:**

- Create: `scripts/build.cjs`
- Create: `scripts/release-smoke.cjs`
- Create: `test/browser/release-upgrade.spec.js`
- Modify: `package.json`
- Modify: `index.html`
- Modify: `js/results.js`
- Modify: `js/solver.worker.js`
- Modify: `README.md`
- Modify: deployment configuration if/when confirmed

- [ ] Build a static release directory with content-addressed filenames for CSS, every page script, the Worker, and Worker dependencies. Do not treat a query string on an overwritten path as equivalent unless the actual host is separately proven to provide atomic, immutable, query-keyed artifacts.
- [ ] Add `build` and `test:release` package scripts to the existing manifest and CI release lane.
- [ ] Keep HTML revalidated/no-cache and fingerprinted assets long-lived/immutable.
- [ ] Make Worker dependency revision derive from its own revisioned URL so page and Worker code cannot split versions.
- [ ] Replace root-relative tooltip assets with base-aware/document-relative URLs. Remove Vercel Analytics or make its script/request path explicitly subpath-safe before claiming `/Forge-Planner/` support.
- [ ] Serve and test under both `/` and `/Forge-Planner/`.
- [ ] On one origin, warm release A, swap to incompatible release B, reload without clearing cache, and assert every loaded asset belongs to B and no console error occurs. Exercise explicit `Cache-Control`, ETag, and Last-Modified behavior; use a fresh origin only as the control case.
- [ ] Document the exact GUI-friendly local preview and release verification steps.

## Task 15: Correct Product Copy, Privacy Scope, Catalog Provenance, and Release Docs

**Priority:** P2/P3 trust

**Depends on:** behavior decisions from Tasks 4–7 and 14

**Files:**

- Create: `docs/STATE_SCHEMA.md`
- Create: `docs/SOLVER_CONTRACT.md`
- Create: `docs/CATALOG.md`
- Create: `docs/RELEASING.md`
- Create: `test/catalog-validation.cjs`
- Modify: `test/run-all.cjs`
- Modify: `README.md`
- Modify: `index.html`
- Modify: `js/results.js`

- [ ] Replace “almost certainly optimal” with “best found within this time budget; not proven optimal.”
- [ ] Remove the absolute sustainability guarantee when May-work margin is active.
- [ ] Explain dedicated-item Credits, visible stability tradeoff, project warm-up/buffer semantics, and mined-resource hard caps.
- [ ] Document Task 11’s self-hosted font assets/licenses. Recommendation: remove analytics so the local-only privacy story stays simple. If analytics is retained, document it visibly and verify planner state never enters requests.
- [ ] Clarify README export scope, solve-time behavior, browser support, persistence/recovery, schema version, and release process.
- [ ] Document catalog source/version/update procedure, add structural/semantic validation to the explicit `test/run-all.cjs` list, and prove `npm test` executes it.
- [ ] Document supported mechanics and intentional non-findings so future agents do not “correct” pre-produced Bits, independent mined budgets, or explicit Resimulate.

## Task 16: Final Adversarial Regression and Release Candidate Audit

**Priority:** Release gate

**Depends on:** all accepted tasks

**Files:**

- Create: `docs/reviews/YYYY-MM-DD-hardening-release-verification.md`
- Update tests/docs only when the verification discovers a real gap

- [ ] Start from the current live application save or an exported copy supplied for release verification; never overwrite it during testing.
- [ ] Run the Standard Verification Gate twice: cold cache and warm upgrade cache.
- [ ] Replay every review counterexample: project transient, Worker/Manual race, import attack corpus, corrupt storage, Gel packing, Credits warnings/deadline, stability disclosure, invalid notation, empty Credits copy, stale price nudge, and stale dialog scroll.
- [ ] Run exhaustive-oracle small solver cases, parity, scale through 12 lines, catalog validation, and all legacy migration fixtures.
- [ ] Browser-test every mode/dialog at 1440×900, 1024×768, 900×760, 881×900, 880×900, 768×1024, 640×900, 561×900, 560×900, 430×932, 390×844, 375×812, and 320×568; capture representative screenshots.
- [ ] Keyboard-test the complete first-run → data entry → solve → project → progress → export path.
- [ ] Inspect console, failed requests, CSP violations, storage mutations, Worker lifecycle, and outbound request payloads.
- [ ] Confirm no body-level horizontal overflow, zero-inset result state, title/tab/status collision, project-name collapse, label/input overlap, offscreen dialog action, or stretched sparse recipe card; intentional tables must identify and contain horizontal scrolling.
- [ ] Have a second agent review the implementation against this plan and the original review without seeing the implementer’s conclusions first.
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
- Visual tokens and semantic component classes own layout; new arbitrary inline presentation is blocked outside the documented dynamic allowlist.
- One command runs the deterministic suite; CI, browser/Worker, accessibility, and release-upgrade gates are green.
- Existing saves and intentional mechanics are preserved.
- Final documentation describes observed behavior without stronger guarantees than the code can support.
