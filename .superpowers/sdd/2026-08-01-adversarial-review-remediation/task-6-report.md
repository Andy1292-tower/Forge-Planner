# Task 6 Report — Credits Deadline, Confidence, and Copy Safety

## Status

Implemented against approved base `e5418e41563fdc385753b36183aafb2ed86a96e5` with a single absolute Credits deadline, candidate-owned confidence metadata, truthful incomplete-search UI, and a guarded Copy-to-Manual path. No browser was launched locally; the normal generated Blob Worker probe is committed to the CI browser lane.

## RED evidence

`node test/credits-contract.cjs` initially exited 1 and proved four independent defects in the previous behavior:

- Credits candidates had no `usesMargin`, `capped`, `evaluated`, or `ms` ownership.
- A losing Glass candidate's margin use leaked into the strict Bits winner's top-level warning.
- The result lacked `allCandidatesEvaluated`, `deadlineReached`, and `searchExhaustive`, so the UI could not distinguish winner confidence from ranking confidence.
- The rendered page could make an unqualified May-work or no-plan claim and expose Copy to Manual without a real executable assignment.

Later REDs proved that deadline interruption had to be exercised inside repair, climb, simplex, role enumeration, DFS, deficit balancing, and Gel seed/prefix work—not only between products—and that a local baseline work cap could not discard the already-valid idle/completed lower bound. Final review fixtures additionally caught a tolerated numerical objective decrease, stale and null-row copy input, deadline telemetry not refreshing after the final checkpoint, a non-transitive fuzzy ranking comparator, lost passive output when target costs were missing, missing transitive recipe issues, and one remaining “profitable mix” label.

## Implemented contract

- `makeSolveControl()` owns one monotonic start time and one absolute deadline. Credits shares that same control across catalog-ordered baselines and every later refinement, so a new product never restarts the clock.
- Result finalization refreshes deadline telemetry without conflating it with an interrupted checkpoint. An exact already-completed raw proof can remain exhaustive when only final serialization crosses the deadline. A product whose completion checkpoint succeeded remains an evaluated/capped lower bound, while later products are unevaluated; a product interrupted before that checkpoint is discarded.
- Checkpoints cover raw lines/levels, repair and climb passes/jobs, LP construction and atomic pivots, randomized seeds, Gel prefix/seed work, role enumeration, target seeds, ILS perturbation, DFS nodes, and deficit balancing.
- Interrupted mutations roll back before returning. An interrupted LP exposes only its current feasible basis and never supplies a proven upper bound.
- Credits completes a finite deterministic baseline for every priced item before deeper search. Each product has a bounded local baseline-work allowance; reaching it retains the valid best completed lower bound and marks that candidate capped. Reaching the shared root deadline discards the partial candidate and marks it and later catalog rows unevaluated.
- Deeper refinement starts from the stored baseline plan. If the shared deadline interrupts it, the completed baseline remains selectable. A refinement replaces that baseline only when its raw numeric objective is exactly nondecreasing; even a tiny decrease retains the prior plan and confidence.
- Every ranking row owns `{usesMargin, capped, evaluated, ms}`. Top-level `usesMargin` and `capped` belong only to the selected feasible winner. Ranking confidence is separately exposed as `{allCandidatesEvaluated, deadlineReached, searchExhaustive}`.
- Ranking uses raw credits descending. Stable `ALLITEMS` catalog order is used only for bit-exact equality, avoiding a non-transitive chained-near-tie comparator.
- A product with no executable craft cost still receives its exact all-idle passive-Forgie baseline. Missing target and transitive recipe data are deduplicated into top-level issues so the UI cannot turn an incomplete model into a definitive no-plan claim.
- The implementation now describes Credits honestly as a dedicated whole-factory comparison; it does not claim mixed sales are mathematically inferior.

## Player-facing behavior

- Incomplete baselines identify the priced items that were not evaluated and show dashes instead of fabricated zero output/credits.
- A fully evaluated but capped comparison says **Best found, not proven best**. The old “almost certainly optimal” claim is removed.
- A capped infeasible row says **no plan found in bounded search**; **no sustainable plan** is reserved for an exhaustive result.
- A losing candidate may show its own compact `may-work` note without creating a global May-work warning for a strict winner.
- The ranking heading is **Output /hr**, not **Max output /hr**.
- Empty Items guidance calls Credits a dedicated sell-plan comparison, never a mixed-sales search.
- Copy to Manual is rendered only when the selected plan contains a non-idle job whose resource is in the current `ALLITEMS` catalog. `copyPlanToManual()` independently enforces the same rule and maps null, stale, and otherwise invalid rows to Idle, so malformed input cannot crash or overwrite Manual state incorrectly.

## Proof coverage

`test/credits-contract.cjs` covers:

- the strict Bits winner versus a losing margin-using Glass candidate;
- winner-only versus losing-candidate capped ownership;
- complete, incomplete, deadline-reached, and non-exhaustive confidence states;
- final deadline refresh for an exact raw proof, retention of a just-completed capped Glass baseline, and an unevaluated later Bricks baseline;
- deterministic repeated 200/400/800/1600 work budgets, nondecreasing evaluated sets, per-candidate objectives, and global objective;
- exact refinement acceptance that rejects every numerical decrease;
- meaningful deeper-search progress (`33317.7962506505` to `33700.47981017031` credits/hour in the frozen fixture);
- byte-identical solver input state;
- baseline-before-refinement ordering;
- actual forced-clock interruption at repair-job, climb-job, LP-pivot, role-enumeration, DFS-node, deficit-job, Gel-seed-line, and Gel-prefix checkpoints;
- rollback-valid result shapes and the rule that an interrupted candidate is never promoted as uncapped;
- deadline expiry during a baseline, with current/later candidates left unevaluated at `ms: 0`;
- honest incomplete/no-plan and dedicated-comparison wording, stale-resource Copy-to-Manual visibility/side effects, and null/invalid-row Idle mapping;
- passive-Forgie output with missing target costs and surfaced transitive missing-recipe issues;
- bit-exact catalog-order ties plus a three-candidate chained-near-tie regression that sorts by raw value;
- real-clock 12-line, all-priced 200/400/800/1600 ms deadline guards.

The CI smoke tests create the ordinary generated current Blob Worker through `__forgeCreateSolverWorker()` and use no deterministic hooks. One posts a validated 2000ms Bits/Glass request and verifies warning ownership. A second posts a normal 12-line, all-priced 200ms request, requires all catalog rows plus `deadlineReached: true` and non-exhaustive/incomplete-or-capped confidence, applies a loose 2.5-second Worker/startup envelope, and asserts that neither permanent Worker script URL was requested.

## Verification

- `node test/credits-contract.cjs` — pass.
- `node test/scale.cjs` — pass, including the 12-line all-priced Credits and frozen Items/Credits correctness cases.
- `npm test` — exit 0; syntax and the complete ordered Node suite passed.
- `npm run build` — exit 0; static site built successfully.
- `node test/run-parity.cjs` — exit 0: `16 ok, 0 improved, 0 failed`.
- `node --check test/browser/smoke.spec.js` and `node --check test/credits-contract.cjs` — pass.
- Real-clock normal-path Bits/Glass probe — Bits strict winner, Glass candidate `usesMargin: true`, all candidates evaluated, exhaustive result, about 103 ms under a 2000 ms budget.
- `git diff --check` — pass.

## Compatibility boundaries

The current Worker implementation is bundled from the changed current modules by the static build. Permanent compatibility files, the Worker handler, build script, parity golden, and legacy request fixture were not changed.

- `js/solver.worker.js`: `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
- `compat/solver.worker.v2.js`: `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`

## Files changed

- Runtime/UI: `js/solver.js`, `js/results.js`, `js/manual.js`
- Contract and release coverage: `test/credits-contract.cjs`, `test/run-all.cjs`, `test/browser/smoke.spec.js`
- Delivery record: this report

## Remaining boundary

No known Node-side blocker remains. The normal generated Blob Worker test is syntax-valid and CI-owned because local browser launch was prohibited for this task.

## Formal review fix round 1 — neutral persistent labels

Formal range review found that the persistent shell still said “get the optimal crafter setup” and titled the result card “Optimal setup.” Those labels contradicted the result-level **Best found, not proven best** state whenever Credits is capped or incomplete.

The focused static regression was added first to `test/credits-contract.cjs`. Its valid RED exited 1 with:

`FAIL persistent planner labels make no unqualified optimality promise [oldTagline=true, oldHeading=true]`

`index.html` now uses the neutral end-user copy **Crafting production-line planner · enter your stats, compare crafter setups** and **Planner results**. The regression requires both exact labels and rejects either former unqualified claim.

The adversarial child review also found that a stale result with one current physical line and `plan: [null, validExtraRow]` could enable Copy to Manual from the out-of-range row. Direct copying then switched modes, let `syncManual()` truncate the extra row, and saved an all-Idle setup. The focused RED recorded both failures:

- `FAIL render ignores executable rows beyond the current physical line count [error=Cannot read properties of null (reading 'job'), copy=false]`
- `FAIL direct copy ignores executable rows beyond the current physical line count [error=null, mode=manual, mutations=1]`

Items/Credits rendering now derives a safe visible plan from the current physical `S.lines`, substitutes Idle for a missing/null in-range row, and ignores extra result rows for the assignment table, Copy eligibility, idle/pre-production notes, and Bits breakdown. `copyPlanToManual()` likewise considers only in-range rows and builds `st.manual` from current lines rather than arbitrary result length. The focused contract proves the adversarial result renders one Idle line with no Copy action and the direct call is a side-effect-free no-op.

The focused Credits contract then exited 0. No solver mechanics, confidence fields, responsive geometry, Worker compatibility endpoint, browser state, or build graph changed.
