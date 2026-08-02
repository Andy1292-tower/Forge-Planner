# Task 5 report: exact Gel capacity with honest large-factory fallback

## Outcome

The Mined Resources Gel-capacity claim is now exact for factories through 12 lines. The exact helper solves the discrete full-time, one-compression-per-line model with deterministic staged tie handling and a strict Vespium budget. Solver seed paths remain bounded, and compatible saves above 12 lines keep the existing fast heuristic with explicit **Estimated capacity** / **Best found loadout** copy. The 64-line persisted-state ceiling is unchanged.

The frozen `6/4/4` counterexample is corrected: at `4498594189315839` Vespium/hour, the exact result selects physical lines 2 and 3 (zero-based IDs 1 and 2) for `8.997188378631677` Gel/hour instead of the greedy line-1 result of `6.747891283973758`.

## RED and mutation evidence

- The first exact regression failed with greedy output `[0]` instead of `[1,2]` on the frozen `6/4/4` case.
- A broad `1e-9` equality policy failed the ULP-scale probes by erasing a real sub-`1e-9` Gel improvement.
- The initial UI test showed that a 13-line factory still called the exact-name helper and rendered unqualified `sustain up to` / `Best loadout` claims.
- A seed-path mutation that changed `solveCore` back to `gelLoadout` triggered the spy's `solve paths must not invoke exact Gel loadout` error; restoring `gelSeedLoadout` returned the test to green.
- The future-extension floating regression initially returned `[[0,2],[1,1],[2,1]]`; the independent staged exhaustive oracle required `[[0,1],[1,2],[2,1]]`.
- A second adversarial fixture proved that a raw-dominated state inside both final ULP tie bands can still be the documented lexicographic winner. A third proved that a streaming pairwise fuzzy reducer is order-dependent.
- The first correctness-safe envelope implementation was exact but used a quadratic frontier scan: the representative mixed 12-line case took about `8.9s`. The monotone two-query dominance scan reduced it to about `227ms` without a cutoff or a weaker envelope.
- Twelve identical max-512 lines exposed a separate symmetry cost (`2236ms`). Canonical identical-profile sequencing reduced it to `3-4ms` while retaining the lexicographically smallest physical assignment.

## Exact helper design

- `gelLoadout(rows, vespiumBudgetHr)` remains uncapped and deterministic. It has no deadline, frontier-size limit, randomization, or silent approximation.
- Each physical line contributes `off` plus every legal compression. Input rows are canonicalized by physical line ID, and returned rows are sorted by that ID.
- Partial pruning retains every tradeoff and every raw-dominated state whose Gel and Vespium gaps remain inside conservative fixed envelopes.
- Each envelope includes the final ULP tie width plus `2 * gamma_n * magnitude` IEEE addition-rounding slack. This protects two prefix sums from rounding differently as common future line rates are added.
- The dominance scan is order-independent and near-linear after the Vespium/Gel sort: it tracks global maximum Gel and maximum Gel among candidates more than the Vespium envelope behind. Equality at either envelope is retained; only a strict crossing is pruned.
- Final choice is staged rather than pairwise: raw maximum Gel, its final tolerance band, raw minimum Vespium within that band, its final tolerance band, then lexicographically smallest active `[physical line ID, compression]` list. Lower physical ID and then lower compression win the final lexicographic tie.
- Rows with identical max and exact option-rate profiles use one canonical rank sequence: positive compression low-to-high, then off. This represents each level multiset once with earliest IDs active and lower compression on lower IDs, including when identical profiles are interleaved with other rows.
- Per-line and aggregate output are recomputed from source rows after reconstruction; no cached frontier total is trusted as display output.

## Bounded seed and UI ownership

- The old greedy routine is retained as `gelSeedLoadout` and is used only for repeated Items/Credits reservation seeds and the large-factory estimate.
- The Mined Resources UI branches before helper work: 12 or fewer lines call exact `gelLoadout`; 13-64 lines call only `gelSeedLoadout`.
- Exact UI retains `Gel/hr capacity`, `sustain up to`, and `Best loadout` language.
- Large-factory UI says `Estimated capacity`, `bounded search`, and `Best found loadout`. It does not claim `maximum`, `sustain up to`, leftover profit, or an unqualified best result.

## Proof coverage

- Independent staged exhaustive oracle across 120 mixed 1-5-line cap, speed, budget, duplication, and input-permutation cases.
- Every feasible exhaustive state is checked against the raw Gel anchor, Vespium anchor, and final lexicographic band; the proof does not test only one oracle winner.
- Structural checks cover strict budget compliance, unique physical IDs, legal caps, full-time fraction, output order, fresh per-line rates, exact aggregate sums, and nested input non-mutation.
- Frozen secondary/tertiary ties cover lower Vespium, lower physical ID, and lower compression.
- Dedicated anchors cover turbo, duplication, compression, the one-second craft floor, empty input, zero/negative/NaN budgets, and just-inside/outside ULP and prune-envelope boundaries.
- A 12-line cap-1 fixture checks below/at/above boundaries across all 4096 subsets and reversed input order.
- Items and Credits preserve the corrected `8.997188378631677` result at real-clock 200ms and 400ms production budgets.
- A 12-line all-priced Credits run exercises repeated bounded work (`36` Gel seed calls, about `710-732ms`) under an asserted loose wall bound.
- Mixed high-cap exact timings from the final full run (forward high / reversed high / low) were:
  - 5 lines: `4 / 2 / 2ms`
  - 7 lines: `7 / 7 / 6ms`
  - 8 lines: `17 / 19 / 22ms`
  - 10 lines: `61 / 56 / 52ms`
  - 12 lines: `213 / 202 / 225ms`
  - 12 identical max-512 lines: `3ms`
- Every representative Items/Credits scale scenario has an asserted `<5s` wall bound, and 400ms to 1600ms Items/Credits Battery objectives are non-worsening.

## Release graph and compatibility

- Static-build coverage mutates `js/solver.js` and proves that the hashed app URL rotates while styles and both permanent compatibility endpoints stay unchanged.
- The CI browser smoke spec creates a test-owned Blob from the generated `__FORGE_SOLVER_WORKER_SOURCE__`, appends only a test handler, runs the frozen exact helper case, terminates the Worker, revokes that exact Blob URL, and asserts no HTTP Worker-script request occurred.
- No local browser was launched. The generated-Blob Worker execution remains owned by the CI browser lane; local verification syntax-checks the spec.
- Frozen compatibility hashes are unchanged:
  - `js/solver.worker.js`: `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
  - `compat/solver.worker.v2.js`: `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`
- `js/solver.worker.js`, `compat/solver.worker.v2.js`, `js/solver.worker.v2.js`, `scripts/build-static.cjs`, and `test/golden.json` are byte-identical to approved base `5e619fe07f96bc759707bf9df7c292ebda133e6a`.

## Verification

- Focused syntax, exact helper, mined render/solver/modes, scale, static build, Project transients, stability, and parity command: pass.
- `npm test`: pass, including the new exact suite and all existing Node suites.
- `npm run build`: pass.
- `node test/run-parity.cjs`: pass; no golden change.
- `node --check test/browser/smoke.spec.js`: pass; browser not launched.
- `git diff --check`: pass.
- Compatibility diff against approved base: empty; both registered hashes match.

## Files changed

- Runtime/UI: `js/solver.js`, `js/render.js`
- Exact/integration/scale coverage: `test/gel-loadout-exact.cjs`, `test/minedsolver.cjs`, `test/minedrender.cjs`, `test/scale.cjs`, `test/run-all.cjs`
- Release/CI coverage: `test/static-asset-build.cjs`, `test/browser/smoke.spec.js`
- Delivery record: this report

## Remaining verification boundary

No known Node-side blocker remains. The only intentionally deferred check is actual browser execution of the generated current Blob Worker; the spec is complete and syntax-valid, but CI must execute it because local browser launch was explicitly prohibited for this task.

## Fix round 1: assignment-independent feasibility and rank-aware pruning

Formal review found two correctness holes in the first exact implementation.

- Identical-profile symmetry canonicalized a multiset onto the earliest physical IDs, but feasibility and totals were accumulated in physical-ID order. IEEE-754 addition is not associative, so the same multiset could fall on opposite sides of a strict budget when assigned to different symmetric IDs. Before the fix, the five-row regression returned `[[0,1],[1,2]]`; the independent exhaustive search found the higher-output strict-feasible assignment `[[1,1],[3,1],[4,1]]` under sequential physical-order aggregation.
- Numeric dominance pruning compared states that had different last compression ranks for a symmetric profile. Those states permit different future option suffixes, so one cannot dominate the other until their remaining transition constraints match.

The fix keeps the symmetry reduction and makes its equivalence relation exact:

- Candidate Gel and Vespium totals are now recomputed from their positive rate multiset in ascending-value order. Strict `vespium <= budget` feasibility, objective comparison, upper-bound construction, and returned aggregate totals all use that deterministic order. A multiset therefore has one bit-identical total regardless of which symmetric physical IDs reconstruct it.
- Frontier pruning is partitioned by the last-rank signature of every symmetric profile that appears in a future row. Numeric dominance runs only within one signature group. Ranks for profiles with no future occurrence are intentionally omitted because they can no longer constrain a transition.
- The exhaustive test oracle independently implements ascending positive-value aggregation rather than calling the production helper. Structural aggregate checks and scale-budget construction use the same declared model through separately coded test logic.

Two frozen strict-budget fixtures now cover the assignment-order boundary:

- Five rows at budget `908244231392255100` produce `1816.4884627845104` Gel/hour and canonical pairs `[[0,1],[1,1],[3,1]]`, identically for forward and reversed input.
- The minimized four-row fixture produces the same Gel total and canonical pairs `[[0,1],[1,1],[2,1]]`. Its Vespium total equals the budget exactly; reducing the budget by one Vespium ULP (`128`) rejects the higher-output multiset.

Rank-aware pruning has both a focused unit regression and a production-path spy: different future-rank signatures retain both candidate states, an equal signature still permits numeric pruning, and `gelLoadout` is proven to pass multiple live signatures when a repeated profile remains.

The final fix-round scale run remained below the asserted five-second bound:

- 5 mixed lines, forward / reverse / low: `9 / 6 / 5ms`
- 7 mixed lines: `30 / 28 / 23ms`
- 8 mixed lines: `61 / 70 / 56ms`
- 10 mixed lines: `194 / 189 / 177ms`
- 12 mixed lines: `689 / 667 / 673ms`
- 12 identical max-512 lines: `27ms`
- 12-line all-priced Credits: `36` bounded Gel seed calls in `693ms`

Fix-round verification passed the exact helper suite and all impacted mined-render, mined-solver, mined-mode, static-build, project-transient, stability, and parity suites. The full non-browser release gate was rerun after this report update. No browser was launched, and no cutoff, frontier limit, approximation threshold, Worker compatibility file, build script, or golden fixture changed. The compatibility hashes remain:

- `js/solver.worker.js`: `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
- `compat/solver.worker.v2.js`: `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`

## Fix round 2: four-path recomputation interval

The second formal proof pass found that fix round 1 still understated the safe dominance interval. A prefix comparison contains the errors of two independently stable-summed states, and each final state is then stable-summed again from scratch. Relating a stored prefix gap to the final stored gap therefore requires four sum-error paths, not the prior two. The far-Vespium branch also used bare `maxFarGel >= candidate.gelHr`, which could discard a state after equal stored Gel values reverse order during final recomputation.

The new boundary-first test failed on `707772e`: the strict decisive-gap case retained two states instead of one because the old scalar-envelope API could not express the new interval policy. The same fixture includes the substantive far-cost regression: at 64 additions, its computed round-drift bound is wider than the public final tie, so two equal stored Gel states must both survive instead of the old far-cost branch discarding one.

Pruning now uses one explicit bounds object for each dimension:

- `publicMagnitude` is the documented stored-value upper used for the unchanged final ULP-scale tie policy.
- `exactMagnitude = publicMagnitude / (1 - gamma)` conservatively inflates a stored upper that may itself have rounded down.
- `roundDrift` covers at least `4 * gamma * exactMagnitude`, plus a four-epsilon-magnitude comparison pad that rounds threshold construction away from pruning.
- The decisive gap is `finalTie + roundDrift`. Equality is retained; only a strict crossing can use the ordinary dominance branch.
- Far-cost dominance requires the cheaper state to lead by the full Gel `roundDrift`. This is intentionally more conservative than subtracting the final tie: it prevents worst-case Gel-order reversal entirely and avoids guessing the magnitude of a future final tie.
- The same decisive construction protects the Vespium gap, using the budget as its stored public upper. The final public equality constants remain unchanged.

Focused proof coverage now checks:

- exact decisive-Gel equality versus the next representable strict crossing;
- exact decisive-Vespium equality versus a strict crossing;
- a far-cost Gel lead immediately below the safe margin is retained, while equality at the safe margin may prune;
- the exact-magnitude inflation and the full four-path lower bound;
- a synthetic 64-addition policy where `roundDrift > finalTie`, including equal stored Gel under decisive far-cost separation;
- every assignment-order, signature-partition, exhaustive-oracle, 4096-subset, strict-budget, and solver-seed fixture from the prior rounds.

The widened intervals did not materially change the bounded 12-line performance envelope in the focused scale run:

- 5 mixed lines, forward / reverse / low: `9 / 6 / 5ms`
- 7 mixed lines: `36 / 26 / 27ms`
- 8 mixed lines: `56 / 68 / 59ms`
- 10 mixed lines: `199 / 186 / 188ms`
- 12 mixed lines: `676 / 672 / 660ms`
- 12 identical max-512 lines: `31ms`
- 12-line all-priced Credits: `36` bounded Gel seed calls in `697ms`

Fix-round focused syntax, exact-helper, mined-render, mined-solver, mined-mode, static-build, project-transient, stability, scale, and parity checks passed. The full non-browser release gate was then rerun. No browser was launched; no cutoff or threshold was weakened; and the frozen Worker, compatibility, build, and golden files remain unchanged with the hashes recorded above.
