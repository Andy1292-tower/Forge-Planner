## Task 16: Final Adversarial Regression and PR Candidate Audit

Task 16 is locally complete on `codex/adversarial-remediation-continuation-v2`; browser execution and rendered approval remain explicit PR gates.

### Targeted repairs

- Recovery notices restore the exact connected runtime invoker, then a same-ID replacement; the Import fallback is reserved for boot recovery.
- The dialog stack snapshots every body child's original `inert` state once, preserves it through nested/exception paths, and restores it after the final close.
- Skip-link activation leaves `#plannerMain` with a visible focus outline in normal and forced-color modes.

Focused RED harnesses reproduced all three prior defects. The repaired harness passed 3/3, and an independent source/spec review found no Critical, Important, or Minor issue.

### First PR-run corrections

- A real Worker-boundary regression proved the solve payload must remain a complete schema-valid accepted-state clone; only the separate equivalence key omits display-only `planStart` and Project `_open`.
- An exact startup validate/adopt regression reproduced a semantically identical state canceling its initial solve because raw JSON serialization depended on object insertion order. Solve keys now sort object keys recursively while preserving array order.
- Two direct Blob Worker fixtures now model custom projects correctly by omitting optional `catId` instead of supplying the invalid value `""`.

The focused RED run failed `2/24`; the repaired lifecycle passes `24/24`. The full local suite again passes `28/28` scripts. The replacement PR browser run remains the authoritative rendered gate.

### Release matrix

- 13 exact viewport pairs, four modes, all six registered semantic dialogs, and sparse Crafting-data cards.
- Whole-document overflow and label/control checks plus result inset/header geometry, Project identity, dialog reachability/scroll ownership, and named table-scroller assertions.
- Four deterministic CI screenshot artifacts; missing artifacts fail the workflow.
- Independent review found and closed one Important scope gap plus two Minor race/evidence gaps. Final rereview is clean.

### Local verification

- `npm test`: 28/28 scripts, including the CI trigger/lane/evidence contract
- parity: 16/16
- static graph: 11/11
- permanent Worker compatibility: 3/3
- release smoke: 10/10
- syntax/YAML/diff hygiene: pass
- Playwright discovery: 85 browser, 11 accessibility, 26 visual, 4 release; no lane overlap

No local browser, GUI, or persistent preview was launched; release smoke used only bounded ephemeral Node servers. The dedicated PR must execute the browser lanes. No current live save/export was supplied, so the exact live-save compatibility smoke remains an owner release gate rather than a passed claim.

### Second PR-CI correction

- Tooltip custom-property URLs are source-relative (`../assets/...`), so the existing content-hash substitutions emit `../static/<hash>` and resolve from `static/styles.<hash>.css` under both `/` and `/Forge-Planner/`. The static-graph regression extracts the actual generated custom-property URLs, requires those exact paths, and resolves them against the generated stylesheet at both mounts. No server alias or console filtering was added.
- The field-validation browser specs now make a valid crafter-line speed edit and confirm Resimulate is visible before each existing Resimulate action. The first edit is before direct invalid-state corruption; the second follows closing Sell prices. Product behavior is unchanged.
- The imported unlock-wave browser test now inspects `#results .step-phase .step-h > b`, waits for and filters to the two imported project names, and asserts each exactly once while retaining the two-row semantic Wave breakdown assertion. Warm-up/prerequisite phases are no longer counted as failures.

Verification: `node test/static-asset-build.cjs` passes 11/11; `node --check` passes for `js/render.js`, the static test, and both changed browser specs; `git diff --check` passes. Browser execution was intentionally not run because this correction's handoff prohibits Chrome/browser/GUI; the PR browser lanes remain required CI verification.
