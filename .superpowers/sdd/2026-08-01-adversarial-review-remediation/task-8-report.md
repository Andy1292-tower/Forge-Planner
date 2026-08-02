# Task 8 Report — Unified Numeric Validation and Field Feedback

## Status

Implemented on `codex/adversarial-remediation-continuation-v2` from the emergency-resynced, controller-approved base `299b5f320f2132c3b757830382b4507da2574b81`. The task keeps `CURRENT_SCHEMA_VERSION = 2`, storage key `forgePlannerState_v3`, and the compatible integer solve-budget range `200..60000ms`. Numeric UI drafts now share the state/import boundary, invalid drafts remain DOM-only, Project endpoints commit atomically, and feedback is accessible and responsive. No browser or Playwright process was launched locally; browser, Axe, geometry, and generated-Blob-Worker execution remain CI-only by task instruction.

## RED evidence

Regression-first work began with `node test/field-validation.cjs`. The first run exited 1 because `validateFieldValue` was not exported; the same RED suite also exposed the missing `baseTimeRev` descriptor, parser/formatter/input-attribute API, field-family descriptors, and parse-before-mutation/source boundaries. The suite covered required line speed/base time, optional recipe and amount blanks, turbo/max turbo/dupe, margin/target weight, calibration, Project quantity/range/priority, decimal exponent notation, game suffixes/commas/case, partial drafts, overflow, integer failures, and dynamic Project bounds before those contracts were implemented.

Additional observed RED/fix cycles:

- The first complete `npm test` exposed `test/minedrender.cjs` as a stale renderer harness because it omitted the new `fields.js` dependency. The harness was corrected before the suite was rerun.
- A transaction edge test passed 129 characters of leading zeroes plus `1`; it failed because the draft was reported `valid` even though its raw display text could not fit the schema's 128-character persisted map. Shared game-field draft limits and `maxlength` attributes now reject that draft before mutation.
- Mined-input binding coverage initially reported no descriptor attributes (`{}`). `renderMinedResources()` now applies the shared min/max/input-mode/draft-length attributes. That change exposed the second stale harness, `test/minedui.cjs`, which now loads `fields.js`/`dom.js` and supplies the DOM behavior those modules use.
- Exact-feedback coverage initially expected `0.000001` but received `0`: compact game formatting had rounded a still-active value down to zero. Compact display is now used only when parsing it returns the exact accepted numeric value; otherwise feedback uses the exact JavaScript number string.
- Static review reproduced the new accepted Worker smoke snapshot being rejected because a schema-v2 fixture omitted required `baseTimeRev`. The fixture now sets it, and an exact local `validateWorkerState()` reproduction returns `{ok:true}`.
- Independent review also identified missing CI-only field-family flows. The browser matrix now explicitly covers line turbo, max turbo, margin, target priority, Project quantity invalid/blank, Project priority blank, paste input, and correction/blank-resume for Forgie, mined income, and inventory.

## Authoritative field boundary

`js/fields.js` now owns distinct descriptors and shared pure APIs:

- `validateFieldValue(rule, value)` is the numeric/value authority consumed by state validation.
- `parseFieldDraft(rule, raw, {badInput})` returns exactly `valid`, `blank`, `incomplete`, or `invalid`.
- `formatFieldValue(rule, value)` produces truthful, round-trip-safe prior-value text.
- `fieldInputAttributes(rule, overrides)` derives min, max, step, input mode, and applicable draft length.
- `fieldRuleWithBounds()` provides dynamic Project level bounds, and `clampFieldValue()` gives page/solver defensive consumers the descriptor boundary.

The accepted persisted ranges are:

- line speed `1e-6..1e9`; line turbo and max turbo `0..1e6`; duplication `0..100`;
- May-work margin `0..20`; integer solve budget `200..60000ms`;
- base time `1e-6..1e15`; optional recipe cost `0..1e100`;
- distinct optional sell-price, Forgie, mined-income, inventory, and Project-quantity descriptors, each `0..1e100` with game notation;
- integer target weight `1..9`; dynamic Project endpoints `1..level count`; optional integer Project priority `1..1e6`;
- calibration speed `1e-6..1e9`, craft seconds `1e-6..1e15`, and internal integer `baseTimeRev` `0..12`.

Decimal and integer rules accept ordinary exponent notation. Game rules additionally accept commas, established case-insensitive suffixes, and exponent notation. `1e`, `1e+`, `1q`, `1s`, signs, decimal points, and native `badInput` remain incomplete. `2.` is valid and canonicalizes to `2`. Unknown syntax, negatives where forbidden, fractions for integer rules, out-of-range values, overflow, and overlong persisted display drafts are invalid.

`js/state.js` consumes the same validator for numeric imports while retaining the established recovery messages. Historical schema-v2 display strings remain independent from their numeric counterparts, so an old readable string is not quarantined merely because it differs from the accepted number. Actual invalid numeric fields continue to reject transactionally.

## Pre-mutation and persistence contract

Every free-entry numeric event reaches `commitFieldDraft()` or the paired Project equivalent. Parsing and DOM feedback occur before the only `mutateState()` call. Invalid/incomplete drafts therefore:

- stay visible in the current control;
- leave the numeric model and any raw-text map unchanged;
- leave local-storage bytes unchanged;
- do not save, schedule, mark stale, flush, or dispatch a solve;
- cannot enter export, render state, or a Worker snapshot.

Accepted values save immediately before their existing solve-or-stale behavior. Accepted optional blanks commit `null` and clear persisted raw text. A raw game draft that cannot fit the display-text schema is rejected before mutation, preventing a post-mutation `save()` failure.

Shopping-list and inline Project `from`/`to` controls parse both visible endpoints together against the live level count. Only a valid `from <= to` pair commits, and both endpoints plus the bounded completion count update atomically. Correcting either endpoint can validate the peer draft and commit the pair in either order. An invalid inline `change` cannot solve.

The document-level `change`/Enter flush and line-local Enter handler skip `aria-invalid=true`. `doSolve()` stops on a visible invalid draft and also returns without rendering when transactional `save()` rejects the current model. A hidden modal draft does not block an unrelated explicit solve because it never changed accepted state; reopening the editor rebuilds the last accepted value.

## Accessible feedback and responsive placement

Shared DOM helpers pre-render stable empty `.field-error` elements with `aria-live="polite"` and `aria-atomic="true"`. Invalid/incomplete controls receive `aria-invalid="true"`. The error ID is appended to existing `aria-describedby` tokens, preserving help/tooltip associations; correction removes only the error token. Copy explains the accepted range/form and the exact previous value still active.

Feedback placement follows the approved ownership:

- direct second row in price/Forgie/inventory rows;
- under line/global/mined/calibration inputs;
- inside base-time/recipe and Project-quantity field stacks;
- full-width `.proj-field-errors` within Shopping-list tools;
- separate full-width `.proj-inline-errors` after inline Project controls.

Calibration and Hydracite markup no longer wraps feedback inside a naming label. Error styles wrap with `min-width:0`, `max-width:100%`, and `overflow-wrap:anywhere`; CI-only geometry covers line, price, Shopping-list Project, and inline Project errors at 320px plus root overflow. CI-only Axe coverage runs with representative errors visible.

## Solve-budget and solver contract

Settings maps the exact compatible budget over friendly stops `200, 500, 1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000, 30000, 45000, 60000`. The endpoints come from `FIELD_SCHEMA.solveBudget`. A valid nonstandard persisted value is inserted into the sorted session stops, so opening and closing Settings cannot round or rewrite it. `aria-valuetext` and the visible value expose the actual duration.

Normalization, result dispatch, and both solver budget clamps consume the descriptor-backed boundary. Solver margin clamps now match `0..20`. Existing compatibility fallbacks remain only for isolated legacy Node harnesses that intentionally load core/solver without `fields.js`; production page and generated Worker paths use the descriptors.

## Import, generated Worker, and release evidence

State coverage accepts every descriptor boundary, including exactly `60000ms`, and rejects representative invalid values across every live numeric family without mutating caller bytes or accepted storage. Invalid imports leave the prior in-memory state and exact stored bytes intact; historical display text remains accepted independently.

The current static build embeds `fields.js` and `state.js` into the ordinary generated Blob Worker. Static coverage proves the parser/validator and 60-second ceiling are present, a `fields.js` change rotates both embedded payload and content-addressed app URL, and neither permanent Worker endpoint changes. CI smoke sends one complete schema-v2 accepted boundary snapshot (including `baseTimeRev` and `projectStability`) and one out-of-range duplication snapshot through the generated Blob Worker, requires Blob URLs, and asserts no permanent Worker/dependency request.

## Verification

- `node test/field-validation.cjs` — pass: 14 focused parser/descriptor/formatter/identity/state/source contracts.
- `node test/state-schema.cjs` — pass: 46 state/import/Worker boundary assertions.
- `node test/minedrender.cjs` and `node test/minedui.cjs` — pass, including descriptor-bound mined controls.
- `npm test` — exit 0: syntax plus all 24 ordered Node scripts; parity reported `16 ok, 0 improved, 0 failed`.
- `npm run build` — pass; deterministic content-addressed release built at `dist/`.
- `node test/static-asset-build.cjs` — pass: 9 assertions, including shared-fields app/embedded-Worker rotation.
- `node test/run-parity.cjs` — exit 0: `16 ok, 0 improved, 0 failed`.
- `node --check` on all changed runtime, Node, and browser specifications — pass.
- Exact smoke fixture through `validateWorkerState()` — pass: `{ok:true}`.
- `git diff --check` and frozen-byte diff — pass at the final gate.

## Frozen compatibility boundary

No permanent Worker endpoint, compatibility handler, historical request fixture, or parity golden was edited.

- `js/solver.worker.js`: `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
- `compat/solver.worker.v2.js`: `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`
- `test/fixtures/solver-worker-v2-request.json`: `ce3df88d0cb7ce7df1ea1b57a5731349aac412078a897fb49fdd9121b43ae5f4`
- `test/golden.json`: `1fa06b6698de157a5507639f5dd72dbe9dd37271b433d2fa84b19cbe80a976a1`

## Files changed

- Runtime/UI: `js/fields.js`, `js/state.js`, `js/core.js`, `js/dom.js`, `js/render.js`, `js/events.js`, `js/results.js`, `js/solver.js`, `index.html`, `css/styles.css`
- Node coverage: `test/field-validation.cjs`, `test/state-schema.cjs`, `test/minedrender.cjs`, `test/minedui.cjs`, `test/static-asset-build.cjs`, `test/run-all.cjs`
- CI-only browser coverage: `test/browser/field-validation.spec.js`, `test/browser/accessibility.spec.js`, `test/browser/visual-layout.spec.js`, `test/browser/smoke.spec.js`
- Delivery record: this report and the SDD progress ledger

## Remaining boundary

No known Node-side blocker remains. Browser behavior, Axe, 320px painted geometry, and actual generated Blob Worker execution are specified but intentionally not run locally. They remain CI-only under the Task 8 browser prohibition.

## Independent review

The first independent review found two Important gaps (the incomplete accepted Worker fixture and missing required browser field-family flows) plus the Minor inaccurate tiny-number feedback. All were fixed, focused and full gates were rerun, and a fresh read-only re-review approved the complete Task 8 diff with no residual actionable findings. The reviewer independently confirmed the exact Worker snapshot, field-family matrix, round-trip formatter, mined harness integration, 24-script Node suite, `16/0/0` parity, 9 static-release assertions, frozen compatibility hashes, and diff hygiene. No browser was launched during either review.

## Formal review fix round 1 — feedback identity and exact budget copy

Formal review of exact range `299b5f3..dcf471d` found two additional Important issues and no Critical or Minor findings:

- `fieldDomToken()` lowercased and normalized source strings, so schema-valid case-distinct Project IDs such as `ProjectA` and `projecta` generated the same feedback IDs. Because `fieldErrorForInput()` resolves through `document.getElementById()`, the second Shopping-list or inline Project row could update and describe the first row's live region.
- the valid nonstandard persisted budget `2345ms` remained exact in state and storage but its visible value and `aria-valuetext` rounded to `2.3 s`, misreporting the accepted setting.

The focused regression suite was extended first and failed for both causes: the formatter API did not exist and distinct case/punctuation/Unicode string fixtures collapsed to duplicate tokens. `fieldDomToken()` now uses deterministic fixed-width UTF-16 hexadecimal with a safe leading token marker, so every distinct JavaScript string maps injectively to a selector-safe ID component. CI-only Project coverage creates `ProjectA` and `projecta`, then proves all Shopping-list and inline `from`/`to` IDs are unique across both scopes, every control owns the error resolved by its ID, and each invalid control's `aria-describedby` includes that owned ID.

`formatMillisecondsAsSeconds()` now validates the integer-millisecond value through the same descriptor and renders up to three exact, trailing-zero-trimmed decimal places. Settings uses it for both visible copy and `aria-valuetext`, so `200`, `1000`, `2340`, `2345`, and `60000ms` render as `0.2 s`, `1 s`, `2.34 s`, `2.345 s`, and `60 s`. The existing browser contract still proves opening and closing Settings neither changes the exact `2345` state value nor rewrites its stored bytes.

Fix-round verification is green: focused field contracts `14/14`, state contracts `46/46`, all 24 ordered Node scripts, deterministic build, static release `9/9`, parity `16 ok, 0 improved, 0 failed`, changed runtime/Node/browser syntax, `git diff --check`, and frozen endpoint hashes. No browser or Playwright process was launched; the new ownership and rendered-budget flows remain CI-only as required.
