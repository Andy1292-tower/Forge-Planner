## Task 15: Product Trust Copy and Operator Documentation

Task 15 is complete on `codex/adversarial-remediation-continuation-v2`. It changes documentation, provenance metadata, and two remaining inaccurate product claims; it does not alter solver mechanics or the approved checkpoint composition.

### Implemented contract

- `README.md` and the persistent footer now qualify bounded solving, May-work sustainability, Project replay, browser support, export scope, local-first privacy, and release behavior without claiming a proven optimum or an always-executable schedule.
- The Shopping-list explanation no longer promises a complete executable schedule when replay can be blocked. A focused trust-copy regression owns that correction.
- `docs/STATE_SCHEMA.md`, `docs/SOLVER_CONTRACT.md`, `docs/CATALOG.md`, and `docs/RELEASING.md` document the accepted state boundary, solver confidence/mechanics, catalog update rules, and cold/warm release process.
- `PROJECT_CATALOG_METADATA` records the current provenance honestly as unknown and unverified. No source version, date, hash, or game quantity was invented.
- The explicit catalog gate validates dense project/level/cost arrays, exact plain-object prototypes, required data properties, known items, finite supported quantities, stable unique IDs, prerequisite references/cycles, and unlock ownership.
- Malformed catalog nodes and prerequisite adjacency are rejected without invoking accessor fields or throwing during cycle traversal. Structural validation remains explicitly distinct from verifying game values or defending against arbitrary JavaScript objects.
- `test/run-all.cjs` registers the catalog gate, so `npm test` owns the contract.

### Review and verification

The first independent review found that sparse array slots were skipped. The second found a permissive custom-prototype check and an unsafe prerequisite cycle pass. Each was reproduced, repaired, and re-reviewed.

- catalog validation: 11/11
- focused Credits/trust-copy contract: pass
- full `npm test`: 27 scripts passed, including parity 16/16
- JavaScript syntax and diff hygiene: pass
- final independent review: no Critical, Important, or Minor findings

No browser, Chrome, GUI, or persistent preview was launched locally. Task 16 and the dedicated PR CI own rendered/browser verification.
