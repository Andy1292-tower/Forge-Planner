## Task 16: Credits save regression, fair refinement, and 10-second migration

Completed locally on the adversarial-remediation continuation branch. Nothing was pushed or merged.

### Repair

- Credits still completes the catalog-order baseline before refinement.
- Refinement candidates are ranked by demonstrated baseline Credits, with catalog order for exact ties.
- The first refinement pass reserves each remaining candidate an equal fraction of the wall time still available before a small finalization guard. A candidate-local cutoff keeps its last fully evaluated incumbent and does not stop the shared root control; a true root deadline/work interruption still rolls the in-flight candidate back.
- Fast candidates return unused wall time to the remaining pool. Adaptive deep work begins only after every capped product completes the fair pass, and uses the newly demonstrated Credits order.
- Candidate solves remain independent and reusable; no item name, recipe, or winner is hard-coded. Per-item cache persistence is deliberately deferred.
- Fresh/reset solve time is 10,000ms. Schema v3 preserves every valid current choice from 200 through 60,000ms. Valid schema v1, schema v2, and recognized unversioned saves have their old budget validated, then receive 10,000ms once while migrating to v3. Schema-v2 Project stability and duplicate-ID strictness remain unchanged.
- The schema version was decoupled from the base-time calibration revision, which remains 2.

### Deterministic RED/GREEN evidence

The save-derived counterexample failed before the wall-slice repair: fixed work units reached the shared deadline during Reinforced Concrete, discarded that candidate's in-flight work, and selected Frames at 246.9462158190911 Credits/hr. Reinforced Concrete remained at its 100-credit baseline instead of its independently established 248.08412092636604 Credits/hr result.

After the repair, under the deterministic slow clock (`0.0018ms` per read/checkpoint):

- every priced product finishes the fair refinement pass before adaptive deep work starts;
- Reinforced Concrete wins the all-priced counterexample at exactly 248.08412092636604 Credits/hr;
- a separate all-priced fixture selects Batteries at exactly 107.16075431887117 Credits/hr, guarding against item-specific priority;
- a 2,000ms run remains safe, completes all baselines, and never starts deep work ahead of the fair pass;
- local cutoffs preserve completed incumbents, while existing root-interruption rollback cases remain green.

### Immutable-save verification

Read-only input: `/Users/andrewstewart/Downloads/forge-build (11).json`

- SHA-256 before/after: `9a9fea042830e9a56bc1cbbf11f0df1ff2d2c88677afccb02e5e127b9da98db0`
- Source schema: v1
- Migrated state: schema v3, solve budget 10,000ms
- Result: Wire, 18,423.900967529135/hr
- A separately validated current-v3 clone with 2,000ms preserved that exact budget and also returned Wire at 18,423.900967529135/hr.

The downloaded save was never written.

### Verification

- `node test/credits-contract.cjs`: pass
- `node test/field-validation.cjs`: 15/15
- `node test/state-schema.cjs`: 52/52
- `node test/solve-lifecycle.cjs`: 24/24
- `node test/staticmode.cjs`: 36/36
- `node test/run-parity.cjs`: 16/16
- `node test/legacy-worker-retirement.cjs`: 3/3
- `node test/static-asset-build.cjs`: 11/11
- `node test/scale.cjs`: pass; its loose wall guard was aligned with the new 10-second default (12-second test allowance)
- `npm test`: 28/28 test scripts
- `git diff --check`: pass

Frozen compatibility evidence:

- `js/solver.worker.js`: `4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188`
- `compat/solver.worker.v2.js`: `9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2`
- `test/fixtures/solver-worker-v2-request.json`: `ce3df88d0cb7ce7df1ea1b57a5731349aac412078a897fb49fdd9121b43ae5f4`

No browser or GUI run was needed for the solver/state repair. The initial static Settings value and Worker-boundary schema fixture were updated, while the frozen compatibility Worker and request fixture were not modified.
