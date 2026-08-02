# Task 7 Brief — Visible Project Stability Tradeoffs

## Approved base and scope

- Implement against exact base `49a9c36` on `codex/adversarial-remediation-continuation-v2`.
- Task 4's executable Project schedules and Task 6's neutral bounded-search copy are prerequisites and must remain intact.
- This task exposes and controls the existing 5% line-job stability behavior. It does not change game recipes, independent mined-resource budgets, the pre-produced Frames/Wire Bits convention, Credits semantics, or the stability band.
- Use regression-first TDD and the SDD implementer -> independent reviewer -> fix -> fresh review -> controller gate loop.
- Do not launch Chrome or any local browser. Browser coverage may be authored/syntax-checked for CI only.

## Frozen compatibility boundary

Do not edit, regenerate, import, or repurpose:

- `js/solver.worker.js` — SHA-256 `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
- `compat/solver.worker.v2.js` — SHA-256 `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`
- `test/fixtures/solver-worker-v2-request.json`
- frozen compatibility checksum constants or parity golden
- either permanent deployed Worker endpoint

Current behavior is bundled from current page modules into the generated Blob Worker. No production edit is expected in `js/solve-service.js` or `js/solver.worker.v2.js`; if implementation appears to require one, stop and explain the concrete need before crossing that boundary.

## Required state contract

Add `projectStability: "prefer-current" | "reoptimize"` and bump `CURRENT_SCHEMA_VERSION` from 1 to 2. Keep storage key `forgePlannerState_v3`.

- New, unversioned, and valid v1 state defaults to `prefer-current`.
- v2 requires the exact enum.
- v1 migration remains strict for every field v1 already required. Separate a `sourceVersion === 2` current-version check from a `sourceVersion >= 1` versioned-structure check rather than weakening old validation.
- V2 requires unique `projects[].id` values. For v1/unversioned duplicates, preserve the first occurrence and deterministically assign later duplicates a collision-free, safe ID derived from the source-array position; cover both migration and v2 rejection. Accepted projects must never share a cache/comparison identity.
- Preserve through export/import, reset/default state, UI synchronization, Worker payloads, and JSON roundtrip.
- Update browser recovery fixtures from future schema 2 to 3 and expected stored schema 1 to 2 where applicable.

## Required solve/cache design

Use these policies consistently:

| Purpose | Read stability pins | Propose/remember selected records |
| --- | --- | --- |
| Visible `prefer-current` run | yes | yes |
| Visible `reoptimize` run | no | yes |
| Hidden alternative comparison | no | no |
| Ordering estimates, preliminary fixed point, recursive warm-ups | no | no |

- `projectSchedule()` must not mutate `S.__stab` or any incoming cache.
- Return the chosen plan, a full semantic stability key, and proposed final records.
- Build records only from final converged feasible semantic phases—not preliminary, partial, warm-up, hidden, or failed phases.
- A prefer-current second pass may read an immutable incoming snapshot but cannot write during the pass.
- `optimizeProjectTop()` computes visible and eligible hidden runs first, then atomically commits only the selected visible run's proposed updates.
- A failed selected full run retains the previous-good cache. Preserve unrelated entries and the existing 256-entry cap.
- The Worker response `__stab` is the complete post-commit cache snapshot. It preserves unrelated incoming records, while every addition/replacement must come exclusively from the successful selected visible run; hidden/preliminary/ordering/warm-up/partial/failed work contributes no record.
- Prefer small explicit helpers equivalent to `makeLineStabilityUpdate()` and `commitLineStabilityUpdates()`.

## Required full-run comparison

Refactor one path such as `solveProjectRun(sequence, net, perProject, policy)` through every Task 4 behavior: sequencing, combined/wave phases, dependency prerequisites, recursive warm-ups, ordering, carried inventory, replay validation, execution phases, total ETA, and finish clocks.

Only compute a hidden reoptimized alternative when the selected `prefer-current` run actually stabilized at least one phase. Compare by stable semantic `phaseKey`:

- sequenced phase: project ID;
- combined phase: sorted project IDs;
- wave phase: sorted project IDs.

Never match by display name or array index. V2's unique-ID validation and deterministic legacy duplicate-ID migration make these keys collision-proof. Per-phase comparison rows include only phases that were actually stabilized.

The top-level result must include:

```js
{
  projectStability,
  stabilityComparison: null | {
    comparable,
    selectedExecutable,
    alternativeExecutable,
    selectedPhaseOrder: string[],
    alternativePhaseOrder: string[],
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

All signed fields are `alternative - selected`; a negative value means reoptimization is shorter. Total ETA comes from full `executionPhases`. Work/per-phase ETA comes from semantic phases. Return only the summary, never the hidden plan.

`selectedPhaseOrder` and `alternativePhaseOrder` contain phase keys, not display names. Set the execution flags only when `scheduleValidation.ok === true`, there is no first failure, and total/work/warm-up ETAs are finite and nonnegative. `comparable` additionally requires both executions, unique phase keys, and exactly one alternative semantic phase with finite positive throughput and finite nonnegative ETA for every stabilized selected key.

Use:

- `ETA_COMPARE_EPS = max(1e-9 hours, Number.EPSILON * 64 * max(1, abs(selected), abs(alternative)))`;
- `THROUGHPUT_COMPARE_EPS = max(LP_ASSIGN_EPS, Number.EPSILON * 64 * max(1, abs(selected), abs(alternative)))`.

`alternativeIsShorter` is true only when the total difference is below `-ETA_COMPARE_EPS`. Define throughput loss as `100 * (alternativeThroughput - selectedThroughput) / alternativeThroughput` and ETA penalty as `100 * (selectedEta - alternativeEta) / alternativeEta`. A zero/invalid denominator makes the summary noncomparable; do not invent a percentage.

## Frozen acceptance case

The real 420-Frames held case is the primary RED/acceptance fixture:

- held phase throughput is 2.6304% below reoptimized;
- held phase ETA is 2.7015% longer;
- held warm-up is 129.94 seconds shorter;
- held complete executable ETA is `0.6659750249h`;
- reoptimized complete executable ETA is `0.6846583163h`;
- reoptimization is 67.26 seconds slower overall;
- both alternatives have `scheduleValidation.ok === true`, no first failure, and no boundary below the replay context's configured absolute-plus-relative stock tolerance. The current exact replay may retain tiny negative floating-point residuals inside that tolerance; do not clamp them just to satisfy a literal nonnegative assertion.

This proves the reoptimized alternative must never be called `fastest` unconditionally.

## Player-facing contract

Add a Project selector in the Shopping-list controls:

```html
<label for="projectStability">Line-job policy</label>
<select id="projectStability" aria-describedby="projectStabilityHelp">
  <option value="prefer-current">Prefer current line jobs</option>
  <option value="reoptimize">Re-optimize line jobs</option>
</select>
```

The help text explains the 5% band, phase-throughput benefit of reoptimization, and why warm-ups/order mean it may not finish sooner. `renderProjects()` synchronizes it. A shared validated event helper mutates state, saves, and runs a full Project re-solve.

When prefer-current holds jobs, render escaped phase names and show:

- affected-phase throughput and ETA differences;
- selected versus alternative complete ETA;
- warm-up difference and ordering change;
- executability/comparability;
- why current jobs were retained.

Actions and selected state must be truthful:

- show `Current line jobs retained` as selected-state text, not a no-op button;
- `Use shorter re-optimized plan` only if alternative total ETA is lower;
- otherwise `Use higher-throughput line jobs anyway` only if the alternative exceeds the throughput tolerance;
- `Use re-optimized line jobs anyway` for an effective zero throughput gap;
- while reoptimize is active, `Prefer current line jobs on future edits`.

If either run is nonexecutable, keys do not match, required metrics are invalid, or the comparison is otherwise noncomparable, explain that a safe full comparison is unavailable and render no speed/throughput switching action inside the comparison block. The labeled policy selector remains available as an explicit override.

Remove remaining Project-facing `fastest`/`optimal` promises from the modal, sequence toggle, result summary, and README. Replace the existing warm-up promise that every boundary is literally nonnegative with truthful no-material-shortage / replay-tolerance wording. Leave accurate Mined-mode `fastest current line` copy unchanged.

## Required test matrix

Create/register `test/stability-ui.cjs` and extend the existing state, stability, Project transient, and browser smoke suites.

- 420 holds; established 500 case releases; reoptimize ignores pins.
- Real longer reoptimized alternative and a synthetic shorter alternative render the correct action.
- Effective zero-gap copy is neutral; a failed/noncomparable alternative produces no misleading comparison action.
- Hidden comparison, ordering, preliminary fixed-point, and warm-up work cannot mutate a sentinel cache.
- Repeated held runs remain held; visible reoptimize remembers; failed selected full run retains previous-good records; JSON roundtrip and eviction stay correct.
- Sequenced/wave phase keys are stable, duplicate display names cannot cross-match, legacy duplicate IDs migrate deterministically, and v2 duplicate IDs are rejected.
- v1/unversioned migration, v2 enum strictness, persistence, import/export, and reset are covered.
- Malicious phase names render inertly.
- Static Project copy contains no unqualified `fastest`/`optimal` claim.
- Selector/help/action relationships are keyboard and screen-reader accessible by construction, including an explicit accessible name and associated help description.
- Generated-app smoke uses the ordinary current Blob Worker: establish schema-v2 prefer-current pins, capture the complete post-commit `__stab` snapshot, assert the 420 prefer-current full tradeoff and selected held writes while preserving unrelated entries, assert 420 reoptimize has no stabilization/hidden comparison and returns the free selected writes, and require Blob transport with zero permanent Worker/dependency requests.

Do not run browser tests locally. Syntax-check them and leave actual rendering/Blob smoke to CI.

## Controller gates before review handoff

- Focused new/changed Node contracts.
- `npm test`.
- `npm run build` and deterministic/static build checks.
- `node test/run-parity.cjs` expecting `16 ok, 0 improved, 0 failed` unless an intentional, explained Project-only golden change is required.
- Browser-spec syntax checks only.
- `git diff --check`.
- Frozen compatibility files byte-identical with the hashes above.
- Clean worktree after the task commit/report.

The implementer report must record RED evidence, the exact cache/write boundary, full-run comparison semantics, user-visible copy/actions, commands/results, changed files, compatibility hashes, and any CI-only browser verification left outstanding.
