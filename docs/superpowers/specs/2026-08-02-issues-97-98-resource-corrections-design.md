# Issues #97 and #98 Resource Corrections Design

**Date:** 2026-08-02

**Status:** Approved

## Goal

Resolve issues #97 and #98 in one pull request while also applying the approved Battery batch-size correction, changing the top compression label to the value shown in game, and repairing the pre-existing Credits deadline race discovered during baseline verification.

The finished change must preserve existing planner builds, keep every game-facing input clearly labeled, apply the corrected mechanics in Items, Credits, Project, and Manual modes, and retain one strict state-validation boundary on the page and in the generated Worker.

## Scope

This pull request contains five changes:

1. Replace the single Vespium income with separate **Vespium Rig (/min)** and **Resources & Trading Vespium (/sec)** inputs, and change Hydracite to **Resources & Trading Hydracite (/sec)**.
2. Fix issue #98 so lowering any crafter line's compression cap also keeps its hidden Manual assignment valid, survives reload, and never dispatches invalid state to the Worker.
3. Correct Batteries to produce five units per base craft: 5 at 1× compression, 10 at 2×, 20 at 4×, and `5 × compression` thereafter.
4. Display the exact in-game top-tier abbreviation `16.38k×` while retaining numeric compression `16384` everywhere in calculations and state.
5. Fix the Credits local-deadline race so a longer solve does not lose a completed better incumbent or intermittently fail the scale suite.

The reported custom-project save-loss incident is explicitly out of scope. This change will not add speculative save salvage, loosen project validation, alter custom-project data, or add project-recovery UI.

## Player-Facing Design

### Mined Resources inputs

The existing Mined resources dialog retains its two-card layout and established visual language. Its income controls become three independent text inputs:

| Card | Visible label | Stored unit |
| --- | --- | --- |
| Vespium → Gel | **Vespium Rig production (/min)** | Vespium per minute |
| Vespium → Gel | **Resources & Trading Vespium (/sec)** | Vespium per second |
| Hydracite → Batteries | **Resources & Trading Hydracite (/sec)** | Hydracite per second |

Each field accepts the planner's existing game-number notation and has its own validation message. Editing one field must not overwrite either sibling. The first Vespium Rig field remains the dialog's initial focus target.

The Vespium card shows an additive breakdown and total hourly budget so the conversion is visible rather than implicit. Its Gel capacity and recommended line loadout use the combined total. The Hydracite card shows the converted hourly total and retains the warning that Batteries also require Wire and Gel.

The exact budget formulas are:

```text
Vespium/hour = max(0, rigPerMin) × 60
              + max(0, resourcesTradingPerSec) × 3600

Hydracite/hour = max(0, resourcesTradingPerSec) × 3600
```

Vespium and Hydracite remain independent, non-transferable constraints. Blank fields contribute zero.

### Crafter-line cap safety and error messages

When a player lowers a line's maximum compression, the app immediately clamps that line's Manual compression to the new cap inside the same state mutation. This applies to every line; Lines 6 and 7 are the common reproduction, not a special case.

After the edit:

- the state remains valid;
- the new cap and any later stat changes can persist;
- reload restores those values;
- Resimulate and mode switches never send an invalid hidden Manual level to the Worker.

If a solve genuinely fails, the visible notice shows the useful error message. A Firefox-style Blob Worker stack such as `self.onmessage@blob:…` must never replace the actual validation message. Stack data remains diagnostic only and is not presented as the primary player-facing error.

### Battery output and crafting copy

Batteries are the only current recipe with a base batch output greater than one. The interface explains:

- compression is a crafting tier, not a universal statement of total units produced;
- ordinary recipes currently output `compression` units per craft;
- Batteries output `5 × compression` units per craft;
- ordinary and mined costs are per craft cycle;
- duplication increases output only and does not multiply the costs paid by a craft cycle.

The Battery recipe card and Hydracite section provide a concise batch-output disclosure. The existing cost tables continue to show costs per craft.

### Top compression label

All current player-facing surfaces use the shared compression formatter and display `16.38k×` for the numeric tier `16384`. Option values, saved data, calculations, costs, craft times, and solver limits retain exact integer `16384`.

The correction applies to line caps, tooltips, calibration, crafting data, mined-resource tables, Items/Credits results, Project steps, Manual mode, README copy, and current solver documentation. Historical implementation plans and the immutable compatibility Worker are not rewritten.

## State Model and Schema Migration

### Schema v4

The current schema advances from version 3 to version 4. Source units are encoded in the property names so callers cannot confuse minutes with seconds:

```js
minedIncome: {
  Vespium: {
    rigPerMin: null,
    resourcesTradingPerSec: null
  },
  Hydracite: {
    resourcesTradingPerSec: null
  }
},
minedIncomeText: {
  Vespium: {
    rigPerMin: "",
    resourcesTradingPerSec: ""
  },
  Hydracite: {
    resourcesTradingPerSec: ""
  }
}
```

Every numeric leaf uses the existing mined-income field rule. Every display leaf uses the existing bounded display-text rule. A complete v4 save must contain the complete nested shape, although each numeric value may be blank (`null`). Missing leaves, negative amounts, non-finite numbers, wrong container types, and future schema versions remain rejected transactionally.

The primary, previous-good, rejected, and rejected-reason browser-storage keys retain their existing `forgePlannerState_v3` names. The schema number inside the JSON remains authoritative; changing storage keys would strand existing local builds.

Migration retains the existing backup semantics exactly. If the primary key contains valid raw v3 bytes `P` and the previous-good key contains older bytes `B`, a successful startup leaves the migrated v4 bytes at the primary key and writes byte-for-byte `P` to `forgePlannerState_v3_previous_good`, replacing `B`. Rejected-state keys are not created or changed by a successful migration.

### Migration behavior

The validator continues to accept known unversioned saves and schema versions 1, 2, and 3, then emits schema v4. It validates each legacy scalar shape under that version's existing rules before conversion; malformed legacy data must not be normalized into an acceptable v4 save.

For accepted legacy data:

- old Vespium `/min` becomes `Vespium.rigPerMin`;
- the new Vespium Resources & Trading field starts blank;
- old Hydracite `/min` becomes `Hydracite.resourcesTradingPerSec = oldValue / 60`;
- legacy `gelVesp` and `gelVespText` map to the Vespium Rig field;
- old Vespium display text is retained for the Rig field;
- converted Hydracite display text is regenerated from the converted numeric value so an old `/min` draft is never mislabeled as `/sec`.

This preserves effective hourly budgets exactly. For example, old `{Vespium: 120, Hydracite: 60}` becomes 120 Vespium/min and 1 Hydracite/sec, retaining 7,200 Vespium/hour and 3,600 Hydracite/hour.

The existing one-time solve-budget migration must be narrowed from `sourceVersion < CURRENT_SCHEMA_VERSION` to `sourceVersion < 3`. Valid v3 saves retain a player-selected value such as 2,345 ms when they become v4; only the older formats that have not yet received the 10-second migration are reset once.

No schema migration is needed for Battery output or the compression label because neither mechanic is stored as derived solver output.

## Shared Resource-Budget Architecture

`core.js` owns a source descriptor for the three inputs, including each source's per-hour multiplier. `minedBudgetHr(resource, state)` is the only conversion and aggregation authority for consumers that need an effective hourly rate. Its optional `state` argument defaults to the global accepted `S`, preserving current one-argument callers while allowing pure migration and test calculations.

All consumers continue to ask for an hourly resource budget rather than reading a source leaf directly:

- exact and bounded Gel loadouts;
- Items and Credits resource constraints;
- Project split and set-and-forget scheduling;
- Manual mined-resource balances;
- results and missing-income diagnostics;
- each modal's total-hourly summary.

Source-aware surfaces retain the full nested data rather than collapsing it prematurely. Modal input rendering and the Vespium source breakdown read the individual leaves through the same descriptor. The daily-cache condition includes the raw nested `minedIncome` object, so changing any source invalidates the prior record even when two edits happen to produce the same aggregate. Page-to-Worker snapshots clone the full v4 source shape so the Worker validates exactly what the page accepted.

This boundary keeps solver math unchanged apart from receiving the correct aggregate. Two Vespium sources are additive; neither can affect Hydracite. Under deterministic solve controls, equal effective hourly budgets must produce equal mechanics and objectives regardless of how the Vespium total is split between its two sources; wall-clock metadata and serialized object identity are not part of that equality.

## Battery Yield Architecture

Battery batch size is recipe metadata, not a Battery-specific multiplier in each solver. `RECIPE.Batteries` receives `baseOutput: 5`, and one shared helper defines output per craft:

```text
craftYield(item, compression) = (recipe baseOutput or 1) × compression
```

Every production-rate constructor uses this helper, including raw/Gel constructors where it remains behavior-neutral, Items/Credits jobs, Project split variables, the jobs consumed by set-and-forget Project mode, and Manual assignments.

Consumption remains based on craft cycles:

- ordinary recipe costs are unchanged and paid once per craft;
- Hydracite and Vespium costs are unchanged and paid once per craft;
- compression cost scaling remains unchanged;
- craft-time scaling and the one-second effective cycle floor remain unchanged;
- duplication multiplies output after cycle rate, never consumption;
- Forgie, inventory, targets, prices, and project costs remain expressed in individual units;
- pre-produced Bits handling for Frames and Wire remains cycle/input-based.

Set-and-forget scheduling receives the corrected `job.prod` rate from the shared job builder. Replay treats its existing `outHr` as authoritative and must not multiply by Battery yield a second time.

Because Items and Credits results can persist for 24 hours, `DAILY_SOLVE_CACHE_VERSION` advances from 2 to 3. Existing cached plans are rejected automatically; the storage key itself remains unchanged. The version-3 cache condition retains the raw nested source map rather than only its computed hourly total.

## State Mutation and Solve Dispatch

The line-cap handler updates `lines[i].max` and calls the existing `syncManual(state)` within one `mutateState` callback. The strict validator continues to reject imported current-version Manual levels above their line caps; the fix keeps live state coherent rather than weakening that boundary.

`doSolve()` remains the validated persistence gate before result rendering or Worker dispatch. Event-driven paths that currently call `save(); renderResults()` directly—including mode changes, calibration apply, and Manual mutations—must use the same gate. Each such path retains the prior accepted state until persistence succeeds; if the gate returns `false`, it restores that state and the matching controls before stopping. Startup and import rendering remain separate because those states have already passed their transactional validation boundary.

No Worker request may be created from a state that failed page-side persistence validation. A failed gate must leave the prior accepted result in place and use the existing `saveind` status (`invalid value not saved`) rather than painting results from rejected state. This rollback is live-mutation safety, not new rejected-save recovery or salvage UI.

## Worker Error Contract

The target generated-Worker response contract places a structured error inside the existing request envelope:

```js
{
  reqId,
  generation,
  mode,
  stateRevision,
  error: {
    message: "Worker state rejected: …",
    stack: "optional diagnostic stack"
  }
}
```

The solve service normalizes synchronous-fallback failures to the same `{message, stack}` shape and preserves the message through delivery. The results renderer accepts both the target structure and legacy string errors, chooses the explicit message or first meaningful non-stack line, and inserts it with text nodes. Stack text is retained only for diagnostics and is never injected as HTML.

The live `js/solver.worker.v2.js` source may change because `scripts/build-static.cjs` embeds it into the generated Blob Worker. It is not the file published at the permanent v2 URL: generated `dist/js/solver.worker.v2.js` continues to be copied from checksum-locked `compat/solver.worker.v2.js`. The permanently retired `js/solver.worker.js` source/endpoint and the compatibility file must remain byte-for-byte unchanged.

## Credits Deadline Repair

Credits uses one root solve control plus local refinement deadlines. Current main can read a cached time below the local cutoff, then sample the clock again inside the root checkpoint after the process has crossed both deadlines. The root becomes globally stopped, the refinement is marked interrupted, and Credits discards a completed better incumbent back to its deterministic baseline.

The repair uses one authoritative clock sample for each checkpoint. Global work-limit exhaustion remains a root stop and takes precedence. Among time limits, the local cutoff takes temporary precedence when the same sample has crossed both the local and root deadlines: the wrapper first stops its candidate and returns the last safe incumbent without a second clock read poisoning that result. Outer scheduling/finalization then observes the same monotonic time, marks the shared root deadline reached, and prevents any further refinement. If the sample has not reached the local cutoff, ordinary root-deadline behavior remains unchanged.

Increasing the finalization guard is not the fix; it would only make the race less frequent. The production invariant is that a locally time-limited refinement cannot erase its previously completed candidate or stop unrelated Credits candidates while shared root time and work remain.

Strict objective monotonicity is tested with deterministic clock/work controls. Real-wall-clock scale checks remain responsible for loose responsiveness bounds, not exact scheduling-sensitive objective comparisons.

## Module Responsibilities

| Area | Primary files | Responsibility |
| --- | --- | --- |
| Mechanics and budgets | `js/core.js` | Source descriptors, hourly aggregation, Battery batch metadata/helper, compression label |
| Schema | `js/fields.js`, `js/state.js`, `docs/STATE_SCHEMA.md` | v4 validation, v1-v3 migration, storage-key and solve-budget preservation |
| Mined-resource UI | `index.html`, `css/styles.css`, `js/render.js`, `js/events.js` | Three labeled inputs, independent drafts, summaries, responsive layout |
| State safety | `js/events.js`, `js/manual.js` | Atomic cap/Manual synchronization and validated result-refresh paths |
| Solver | `js/solver.js`, `js/project-schedule.js` | Shared yield use, Credits local-deadline repair, replay without double multiplication |
| Manual and results | `js/manual.js`, `js/results.js` | Correct output, mined balances, labels, and safe error messages |
| Worker and cache | `js/solver.worker.v2.js`, `js/solve-service.js`, `scripts/build-static.cjs` | v4 state, structured errors, cache v3, generated Blob parity |
| Player documentation | `README.md`, `docs/SOLVER_CONTRACT.md` | Units, Battery batch rule, per-craft costs, exact display label |

## Testing Strategy

Implementation follows test-driven development: add focused failing regressions first, then make the smallest production change that satisfies them.

### Source-aware income and migration

- Defaults contain all three blank sources.
- `2/min + 3/sec` equals 10,920 Vespium/hour; `4/sec` equals 14,400 Hydracite/hour.
- Editing one source preserves its siblings; invalid drafts never enter state.
- Booting from a raw v3 primary value writes that exact pre-migration JSON byte-for-byte to the existing previous-good key, rewrites the primary as v4 under the unchanged `forgePlannerState_v3` key, creates no v4-named storage keys, and preserves a value such as `solveBudget: 2345`.
- v3 Vespium text moves unchanged to `rigPerMin`, the new Vespium Resources & Trading text starts blank, and Hydracite text is regenerated from `oldValue / 60` rather than retaining the old `/min` draft.
- v1, v2, and known unversioned fixtures are validated under their legacy rules and still migrate; malformed legacy data rejects before conversion; complete v4 accepts; incomplete or malformed v4 rejects; v5 rejects.
- Equal hourly totals produce equal Items/Credits output; split Vespium sources can jointly enable Gel; Hydracite remains isolated.
- Project and Manual report the combined hourly Vespium total and independent Hydracite total.
- Worker snapshots contain the nested source shape, and changing any source invalidates cached solving.

### Issue #98 state safety

- Add Lines 6 and 7, lower their caps to 64 and 32, and verify matching Manual clamps, valid persisted bytes, and reload preservation.
- Lower Line 1 as a control proving the behavior is not index-specific.
- Change caps followed by speed/turbo edits and verify every accepted value survives reload.
- Switch among Items, Credits, Project, and Manual after cap changes without an invalid Worker dispatch.
- Preserve the strict import test that rejects a current-version Manual level above its line cap.
- Verify all direct result-refresh paths roll back to the prior accepted state and matching controls, keep the prior result, show `invalid value not saved`, and dispatch no Worker request when persistence fails.
- Feed Chromium-style and Firefox-style error stacks through the Worker/service/results boundary and verify the useful message is primary.

### Battery output and compression display

- Batteries yield exactly 5, 10, and 20 at 1×, 2×, and 4×; a control recipe retains ordinary output.
- Items and Credits output use the five-unit batch while ordinary and mined consumption remains per craft.
- Project split and set-and-forget schedules agree on corrected Battery output and replay validation.
- Manual output matches the solver and reports unchanged Wire, Gel, and Hydracite cycle consumption.
- Cache-version-2 results are rejected and version-3 results can be reused.
- `compressionLabel(16384)` returns `16.38k×`, while select values, state, and calculations retain `16384`.
- User copy states the Battery batch rule and does not equate compression with universal output.

### Credits deadline and integration

- A deterministic clock jump across the local and root deadlines first returns the locally safe better incumbent, then finalization marks the root deadline reached without erasing it.
- A candidate hitting only its local cutoff while root time remains does not prevent the next eligible Credits candidate from beginning refinement; an elapsed root deadline or genuine root work-limit exhaustion stops the shared comparison.
- Repeated deterministic 400 ms/1,600 ms-equivalent searches are non-worsening.
- Real-clock scale tests retain loose wall-time bounds without using scheduler-sensitive values as an exact correctness oracle.
- Items, Credits, Project split, Project set-and-forget, Manual, worker parity, golden scenarios, static-asset generation, frozen compatibility endpoints, syntax, and the full Node suite pass. Build assertions prove that the live handler is embedded only in the Blob while the permanent generated v2 endpoint still matches `compat/solver.worker.v2.js` byte-for-byte.

## GUI Verification

Serve the built application over HTTP so verification exercises the generated Blob Worker rather than only synchronous test harnesses.

Desktop and narrow mobile checks cover:

- three clearly labeled source inputs with the correct `/min` and `/sec` units;
- additive Vespium and independent Hydracite summaries;
- modal focus, Escape/backdrop/Done close behavior, field errors, and non-clipped responsive layout;
- Lines 6/7 cap changes, Resimulate, every mode switch, and reload persistence;
- Battery recipe/output disclosure and corrected results;
- `16.38k×` text paired with numeric `16384` option values;
- useful solver errors without Blob-stack noise;
- no console errors and responsive background solving.

Run the issue #98 flow in Chromium and Firefox when the local browser harness supports both engines. The automated error-contract regression remains mandatory even if one GUI engine is unavailable locally.

## Delivery

All changes ship from the isolated feature branch in one pull request that closes #97 and #98 and describes the approved resource/mechanics corrections plus the Credits deadline prerequisite. Before publication:

- update from current `origin/main` without touching the user's unrelated working tree;
- inspect open pull requests for overlapping files;
- run focused tests, the complete suite, parity/golden, scale, release build, Worker checks, and GUI verification;
- scan the diff, commits, and pull-request text for prohibited attribution wording;
- stop after opening the pull request unless the user separately authorizes a merge.
