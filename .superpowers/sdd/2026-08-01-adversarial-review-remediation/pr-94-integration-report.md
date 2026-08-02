# PR #94 Semantic Integration Report

Date: 2026-08-02
Integration branch: `codex/adversarial-remediation-continuation-v2`
Pre-merge remediation head: `83e2b1f`
PR #94 head: `b97cc95`
Status: staged; independent review clean; not committed, pushed, or merged to `main`

## Outcome

PR #94's Set & forget scheduling feature is semantically integrated with the current remediation architecture. The resolution preserves the checkpoint UI, Task 4 executable replay, Task 5 exact Gel behavior, Task 6 shared absolute solve control, Task 7 line-stability boundary, Task 8 schema/field validation, Task 13 solve-keyed Progress cache, and the emergency content-addressed Blob Worker release graph.

This is not a visual redesign. The checkpoint markup, geometry, and visual system are preserved. The only new visible surface is the compact Project line-plan switch required to expose the feature, its narrow-screen/overflow CSS, the disabled state for an inapplicable order field, and focused truthful copy for ordering, static limitations, and bounded executable results.

## Conflict resolution

Seven textual conflicts were resolved manually rather than accepting either side wholesale:

- `index.html`: checkpoint markup retained; the one-at-a-time help sentence now states the implemented precedence exactly: required unlocks, numeric order, then estimated completion time.
- `js/core.js`: additive `projLineMode: "split"` default and normalization retained alongside current state contracts.
- `js/fields.js`: additive `split`/`static` enum descriptor added without downgrading schema v2.
- `js/state.js`: optional validated field added so older valid v2 saves default safely while explicit invalid values reject.
- `js/events.js`: line-mode persistence/re-solve, accessible priority behavior, summary-only Progress refresh, and static execution instructions integrated without weakening Task 13 freshness.
- `js/results.js`: minimal accessible line-mode control, setting-aware order copy, replay-safe deadline diagnostics, and per-phase mined-use rendering integrated with current executable guards.
- `js/solver.js`: PR concepts were ported onto current exact replay/control/stability architecture rather than restoring superseded inventory or budget logic.

## Solver semantics

Integrated:

- One job per busy line for each complete static phase (`frac === 1`).
- Strict Project tolerance in static mode.
- Transitive material-unlock ordering.
- Finite/`Infinity` comparator guard.
- Fully inventory-covered phases as zero-time feasible phases.
- Exact carry of static overproduction between semantic phases.
- Raw sequence/gate settings on result objects so one-project headers stay truthful.
- One shared absolute Task 6 control for the complete static Project run, including static fixed-point passes and warm-ups.
- Explicit `evaluated`, `capped`, `searchExhaustive`, `allPhasesEvaluated`, and `staticDeadlineReached` telemetry.
- Post-deadline short-circuit: later static phases do not restart or continue expensive setup, and the result reports `solve-budget` rather than a false material/warm-up failure.
- Replay-certified static incumbents: an analytically feasible fixed-point pass may become a deadline incumbent only after the pure executable builder inserts external prerequisites and exact replay succeeds. A later replay-invalid pass cannot erase it.
- Pre-produced Bits cycle recovery: repeated fixed-point obligations are detected, then finite lower compression ceilings below the implicated assignment are tried in descending order under the same root control. Only replay-certified feasible fallbacks compete, by complete phase ETA; the selected result is explicitly capped/non-exhaustive.
- A lower-ceiling attempt that reaches the deadline cannot erase a replay-certified unrestricted incumbent.
- Static search remains outside Task 7 cache reads, proposals, comparisons, and commits.

Preserved instead of PR #94's older implementations:

- Task 4 replay owns pre-produced Frames/Wire Bits, prerequisite insertion, warm-ups, inventory debit, surplus carry, and final validation.
- Task 5's bounded Gel seed path remains unchanged; no exact Gel capacity enumeration was introduced into the solver.
- Task 6's current control/checkpoint/rollback system replaces per-phase grant arrays, seed counters, and positional tolerance arguments.
- Task 7's pure proposal plus atomic commit model remains authoritative.
- Task 13's `solveStateKey` cache and explicit Resimulate policy remain authoritative.

Deliberate contract: static sequencing uses a cache-neutral split/no-intermediate-stock estimate for unpinned ordering. It is presented as an estimate, not as an exact static makespan or guaranteed fastest order.

## Post-integration adversarial follow-up

The independent semantic review found two previously hidden P1 cases and four user-facing P2 gaps. All were reproduced before repair:

- A deadline during the second pre-produced-Bits fixed-point pass overwrote a completed four-line Frames plan with an empty unevaluated phase. The retained result now carries its original 800-Bits solve assumption, its actual 1,200-Bits replay obligation, `preProducedConverged: null`, one deadline stop, and valid prerequisite → project instructions.
- With 950 Bits held and a project costing 100 Frames plus 100 Bits, 4× assignments alternated between 800 and 1,200 pre-produced Bits and falsely failed convergence even though the 2× domain was executable. Cycle detection plus bounded lower-ceiling recovery now returns the valid 2× assignment without mutating configured 4× caps.
- Unrestricted static phases no longer expose a synthetic `compressionCeiling: 0`; the field is `null` unless a positive fallback ceiling was actually applied.
- Static infeasibility copy now cautiously explains the one-job-per-line structural limit without hard-coding a five-job chain.
- Shopping-list ordering copy matches the implemented unlock → numeric order → estimate precedence.
- A held-intermediate notice is derived only from replayed execution-phase inventory and solved consumption. It appears when held stock can cover a feeder's phase use, but subtracts same-phase external pre-produced reserves so Frames/Glass cannot falsely label injected Bits as held stock.
- Executable static results that are capped, non-exhaustive, or first observe the deadline during finalization explicitly say the instructions passed exact replay but may not be the shortest plan.

## Regression evidence

RED evidence encountered and repaired:

- State validation initially failed 3 additive line-mode cases.
- Static mode initially passed 29/30 because the PR test assumed pre-Task4 four-line Frames infeasibility. The corrected contract proves three lines infeasible, four lines executable, exact replay valid, and a 1,200-Bits external prerequisite that includes static overshoot.
- Seqgate initially aborted on removed per-phase budget helpers and ordinary `net.Bits` assumptions. It now asserts exact prerequisite/replay boundaries and current shared-control behavior.
- A sharpened advancing-clock deadline test reproduced one failure at 27/28: the clock reached 2,520 ms and reported `warmup`. The short-circuit repair now stops once at 2,040 ms and reports `solve-budget`.
- Existing extracted renderer harnesses were updated for the new result helpers without weakening their safety assertions.

Final focused gates:

- `test/staticmode.cjs`: 36/36.
- `test/seqgate.cjs`: 37/37.
- `test/state-schema.cjs`: 49/49.
- `test/field-validation.cjs`: 14/14.
- `test/solve-lifecycle.cjs`: 21/21.
- `test/stability.cjs`: 12/12.
- `test/stability-ui.cjs`: pass.
- `test/project-transients.cjs`: pass.
- `test/gel-loadout-exact.cjs`: 18/18.
- `test/credits-contract.cjs`: pass.

Final repository/release gates:

- `npm test`: pass, including syntax and all ordered Node suites.
- `node test/static-asset-build.cjs`: 9/9.
- `node test/run-parity.cjs`: 16 ok, 0 improved, 0 failed.
- Browser-spec syntax: pass for accessibility and visual-layout specs.
- `git diff --check`: pass.
- Two clean builds produced the same full-tree digest: `04c9fce882e85b08776ed447772b49268e26f5c2e6298a83f964d1ff7ace6386`.
- Current stable Worker endpoint matches generated `dist/js/solver.worker.js` byte for byte.
- Frozen v2 compatibility endpoint matches generated `dist/js/solver.worker.v2.js` byte for byte.

Frozen hashes remained unchanged:

- `js/solver.worker.js`: `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
- `compat/solver.worker.v2.js`: `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`
- `test/fixtures/solver-worker-v2-request.json`: `ce3df88d0cb7ce7df1ea1b57a5731349aac412078a897fb49fdd9121b43ae5f4`
- `test/golden.json`: `1fa06b6698de157a5507639f5dd72dbe9dd37271b433d2fa84b19cbe80a976a1`

## Browser policy

No browser, Chrome process, preview server, or GUI was launched in this integration pass. The changed accessibility spec was syntax-checked and is left for the existing CI browser lane.

## Review scope

The staged integration set includes the seven resolved files, minimal CSS, adapted/new PR #94 regressions, ordered-runner registration, the Task 13P plan/ledger entries, and this report. It intentionally excludes commits, pushes, deployment, and any merge to `main` pending independent exact-diff review and owner approval.

Final independent re-review found no remaining P1/P2 issues. It also benchmarked 200 warmed split solves after the static-only certification gate: working `1.045–1.124s` versus staged baseline `1.079–1.126s`, confirming the intermediate 40–55% split regression was removed.
