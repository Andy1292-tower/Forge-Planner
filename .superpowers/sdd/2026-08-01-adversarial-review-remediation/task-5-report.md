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
