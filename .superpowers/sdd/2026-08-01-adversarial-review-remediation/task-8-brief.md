# Task 8 Brief — Unified Numeric Validation and Field Feedback

## Approved base and scope

- Implement from exact clean base `72f6b2f` on `codex/adversarial-remediation-continuation-v2`.
- Preserve Task 1’s transactional state/recovery boundary, Task 6’s single Credits deadline, Task 7’s schema-v2 Project policy/cache behavior, and Task 11A’s responsive geometry.
- Use regression-first TDD and the SDD implementer -> independent reviewer -> fix -> fresh review -> controller gate loop.
- Do not launch Chrome or any local browser. Browser/accessibility/geometry/Blob Worker execution remains CI-only; syntax-check those specifications locally.

## Frozen compatibility boundary

Do not edit, regenerate, import, or repurpose:

- `js/solver.worker.js` — SHA-256 `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
- `compat/solver.worker.v2.js` — SHA-256 `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`
- `test/fixtures/solver-worker-v2-request.json`
- frozen checksum constants, compatibility golden, or either permanent deployed Worker endpoint

Current validation is bundled into the generated Blob Worker. No production edit is expected in `js/solve-service.js` or `js/solver.worker.v2.js`; stop and justify before crossing either boundary.

## Version and range decisions

Keep:

- `CURRENT_SCHEMA_VERSION = 2`;
- storage key `forgePlannerState_v3`;
- `solveBudget = 200..60000` integer milliseconds.

Task 1 explicitly restored 60 seconds to preserve valid saves. Update the Settings range to 60 seconds and derive UI, normalization, results dispatch, and solver clamps from `FIELD_SCHEMA.solveBudget`; do not reduce or reject an existing 60-second setting.

Authoritative persisted ranges:

| Field | Rule |
| --- | --- |
| line/Manual compression | exact `LEVELS` member; Manual also no higher than line cap |
| line speed | `1e-6..1e9` |
| line turbo / max turbo | `0..1e6` |
| duplication | `0..100` |
| May-work margin | `0..20` |
| solve budget | integer `200..60000ms` |
| base time | `1e-6..1e15` |
| recipe cost | blank/null or `0..1e100` |
| sell price | blank/null or `0..1e100` |
| Forgie rate | blank/null or `0..1e100` |
| mined income | blank/null or `0..1e100` |
| inventory | blank/null or `0..1e100` |
| project quantity | blank/null or `0..1e100` |
| target weight | integer `1..9` |
| project from/to | integer `1..level count`, with `from <= to` |
| project priority | blank/null or integer `1..1e6` |

Give sell price, Forgie, mined income, inventory, and project quantity distinct named descriptors even if their current numeric ceilings match. Move `baseTimeRev`’s inline numeric rule into `FIELD_SCHEMA` as an internal descriptor. Existing calibrated in-range values must round-trip byte-semantically through validation.

## Pure parsing and validation API

Add pure helpers in `js/fields.js` equivalent to:

```js
validateFieldValue(rule, value)
parseFieldDraft(rule, raw, { badInput: false })
formatFieldValue(rule, value)
fieldInputAttributes(rule, overrides)
```

`parseFieldDraft` returns exactly one of:

- `{status: "valid", value}`;
- `{status: "blank", value: null}` only for a blank-allowed rule;
- `{status: "incomplete", message}` for an unfinished edit such as native `badInput`, `1e`, `1e+`, `2.`, `+`, `-`, `1q`, or `1s` where a supported completion still exists;
- `{status: "invalid", message}` for unknown syntax, wrong integer/enum, negative/out-of-range, overflow, or a forbidden blank.

Decimal/integer rules accept ordinary exponent notation. Game-number rules also accept commas, case-insensitive established suffixes, and exponent notation. Do not loosen `parseGameNum()` into accepting unknown suffixes. Messages must be stable/specific enough for direct regression assertions and understandable without developer terminology.

State `_number()` must consume the same pure value validator so schema/import and GUI range decisions cannot drift. Preserve schema-v2 compatibility for historical display text: do not add numeric/text-pair coherence that could quarantine old `priceText`/Forgie/inventory/mined strings. Actual numeric fields remain strictly rejected when invalid.

## Pre-mutation UI boundary

Every free-entry numeric handler follows this order:

1. Parse the DOM draft against its descriptor and any dynamic bounds.
2. On `valid`, mutate the model, clear feedback, save, and retain the field family’s existing solve/schedule/stale behavior.
3. On an allowed `blank`, commit `null`, clear its persisted display text, clear feedback, save, and retain the existing solve behavior.
4. On `incomplete` or `invalid`, do not call `mutateState`, `save`, `markStale`, `scheduleSolve`, `flushSolve`, `doSolve`, or a render that rewrites the input.

The invalid/incomplete draft remains visible in the current DOM while the last valid numeric model and persisted text map stay unchanged. Closing/reopening or otherwise rebuilding that editor may discard the unsaved bad draft and restore the last valid accepted value. Invalid drafts must never enter localStorage, Export, rendering state, or Worker snapshots.

The document-level change/Enter flush must skip controls with `aria-invalid="true"`. A correction removes the invalid state and resumes normal behavior. Do not use fallback coercions such as invalid/blank line speed -> 1, turbo/dupe -> 0, base time -> 1, or malformed amount -> null.

## DOM and feedback contract

Add shared DOM helpers that:

- create/find one stable error element per field;
- set `aria-invalid="true"` for incomplete/invalid drafts;
- append the error ID to existing `aria-describedby` tokens without replacing help/tooltip IDs;
- clear only the error token/state when valid;
- render `.field-error` as `aria-live="polite" aria-atomic="true"` (not one aggressive alert per input);
- explain the accepted form/range and the last valid value still in use.

Placement:

- price/Forgie/inventory: direct second-row feedback element in `.price-row` (replaces dead `data-prev` behavior);
- line/global/mined/calibration: immediately below the control;
- recipe cost: inside its table cell;
- project quantity: inside its quantity cell/stack;
- project range/priority: full-width `.proj-field-errors` inside the existing tools region so identity/tools grid ownership remains intact.

CSS must wrap at 320px with `min-width:0` / `max-width:100%` and create no root horizontal overflow. Preserve Task 10 help/name associations and Task 11A layout selectors.

## Field-family behavior

- Line speed is required; line turbo, max turbo, and duplication are required nonnegative values. Only valid line/global edits mark results stale.
- Margin and target priority remain native ranges, but their min/max/step derive from descriptors. Solver defensive margin clamp becomes 20, matching the descriptor.
- Base time is required and strictly positive. Recipe costs are optional; blank clears to null.
- Sell price, Forgie, mined income, inventory, and project quantity use game notation and optional blank. Only valid raw text is written to the persisted text map; invalid text stays DOM-only.
- Project from/to/priority use integer rules plus current level-count and `from <= to` constraints. Shopping-list and inline Project controls share behavior; an invalid cross-range edit leaves the prior model untouched.
- Calibration speed/seconds use the same decimal rules; Apply stays disabled while either draft is invalid/incomplete.
- Solve-budget UI runs from 0.2 through 60 seconds and commits integer milliseconds within the descriptor.
- Manual compression is already a constrained select and does not become a free-entry control.

## Required test matrix

Create/register `test/field-validation.cjs`:

- required/optional blank, valid decimal/integer/enum, native `badInput`;
- `abc`, negatives, bounds/overflow, integer fractions;
- exponent valid and partial `1e`/`1e+`/`2.`;
- game commas/case, valid suffix/exponent, partial `1q`/`1s`, unknown suffix;
- stable formatter/message behavior;
- all descriptor ranges and generated attribute parity;
- schema value validator parity, calibrated boundary roundtrips, and dynamic Project bounds;
- source contracts that every free-entry handler parses before mutation and invalid branches cannot save/solve.

Extend `test/state-schema.cjs` with an exhaustive representative numeric boundary matrix and 60-second preservation. Imports with invalid numeric values must fail transactionally; schema-v2 historical display strings remain accepted.

Create `test/browser/field-validation.spec.js` for CI only:

- valid -> invalid/incomplete -> corrected and valid -> blank flows;
- line speed/turbo/global/dupe, price, Forgie, inventory, mined income, project quantity/range/priority, base time, recipe cost, calibration;
- exact last-valid `S` and localStorage bytes while invalid;
- invalid Enter/change causes no solve/Worker request; correction resumes stale/solve behavior;
- nearby polite error, `aria-invalid`, preserved `aria-describedby`, keyboard/paste/mobile `inputmode`;
- persisted 60 seconds displays as 60 and dispatches 60,000ms to the ordinary current Worker;
- 320px visible-error states satisfy line/project/price geometry and root-overflow gates;
- Axe scan with representative errors visible.

Extend ordinary generated Blob Worker smoke coverage with one accepted boundary snapshot and one out-of-range state rejection through the shared field boundary. Require Blob transport, rotated hashed application output, and zero permanent Worker/dependency requests.

## Expected files

- Runtime/UI: `js/fields.js`, `js/state.js`, `js/core.js`, `js/dom.js`, `js/render.js`, `js/events.js`, `js/results.js`, `js/solver.js`, `index.html`, `css/styles.css`
- Node: `test/field-validation.cjs`, `test/state-schema.cjs`, `test/run-all.cjs`
- CI-only browser: `test/browser/field-validation.spec.js`, `test/browser/accessibility.spec.js`, `test/browser/visual-layout.spec.js`, `test/browser/smoke.spec.js`
- Report: `.superpowers/sdd/2026-08-01-adversarial-review-remediation/task-8-report.md`

## Controller gates

- Focused parser/state/source contracts.
- `npm test`.
- `npm run build` and `node test/static-asset-build.cjs`.
- `node test/run-parity.cjs` expecting `16 ok, 0 improved, 0 failed` unless an intentional, explained boundary-only change requires a reviewed golden update.
- Changed Node/browser syntax checks only; no local browser execution.
- `git diff --check`.
- Frozen compatibility files/fixture/golden byte-identical and endpoint hashes exactly matching this brief.
- Clean worktree after the task commit/report.

The implementer report must include RED evidence per field family, parser/status rules, pre-mutation proof, accessible feedback placement, 60-second contract, import/Worker evidence, commands/results, changed files, frozen hashes, and CI-only verification left outstanding.
