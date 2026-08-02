# Max Items Daily Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse identical Max Items solves for 24 hours, retain an explicit fresh-solve path, and remove the browser UI suite from required CI and the repository.

**Architecture:** `js/solve-service.js` owns a small versioned cache policy beside its existing request authority, so Worker and synchronous-fallback responses share one safe storage path. `js/results.js` passes a one-shot `forceFresh` request from Resimulate and renders cache-hit status. Playwright is removed; focused Node lifecycle and build contracts remain.

**Tech Stack:** Browser localStorage, plain JavaScript, Node `assert`/`vm`, GitHub Actions.

## Global Constraints

- Keep all work in the existing pull request and branch.
- Cache Max Items only for exactly 24 hours per solver-input key.
- Do not alter solver formulas, save schema, export/import bytes, Credits, Project Plan, or Manual behavior.
- Explicit Resimulate must force a fresh solve.
- Cache failures must silently fall through to a normal solve.
- Remove Playwright/browser UI tests and do not replace them with another browser suite.
- Use focused Node/build checks only.
- Do not add AI or Codex attribution to commits or the pull request.

---

### Task 1: Remove the browser UI suite and simplify CI

**Files:**
- Delete: `test/browser/*.spec.js`
- Delete: `playwright.config.js`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `test/ci-workflow.cjs`
- Modify: `README.md`
- Modify: `docs/RELEASING.md`

**Interfaces:**
- Consumes: existing `npm test`, `npm run build`, and `node scripts/release-smoke.cjs` commands.
- Produces: one required `verify` job with no Playwright install, browser command, or browser artifact upload.

- [ ] Delete the browser test directory and Playwright configuration.
- [ ] Remove `test:browser`, `test:a11y`, `test:visual`, and browser-backed `test:release` scripts and Playwright/Axe dependencies; retain a non-browser `test:release` that builds and runs release smoke.
- [ ] Replace the CI matrix with one job named `verify` that runs `npm ci` and `npm test`.
- [ ] Rewrite `test/ci-workflow.cjs` to reject Playwright/browser commands and require the single fast job.
- [ ] Update active user-facing development and release documentation.
- [ ] Run `node test/ci-workflow.cjs` and verify it exits 0.

### Task 2: Add the failing Max Items cache lifecycle contract

**Files:**
- Modify: `test/solve-lifecycle.cjs`

**Interfaces:**
- Consumes: `solveService.request(options, callback)` and the existing fake Worker/current-state harness.
- Produces: shared fake local storage and controlled clock coverage for `forceFresh` and cache metadata.

- [ ] Extend the harness with shared local-storage bytes and a controlled initial clock.
- [ ] Add a test that completes an Items Worker solve, recreates the service, and requires an identical request to deliver without creating a Worker.
- [ ] Add table cases proving a line-speed change and an expired timestamp dispatch a Worker.
- [ ] Add cases proving Credits/Project requests, `forceFresh`, and malformed cache bytes dispatch a Worker.
- [ ] Run `node test/solve-lifecycle.cjs` and verify the new assertions fail because cache behavior is absent.

### Task 3: Implement the 24-hour bounded cache

**Files:**
- Modify: `js/solve-service.js`
- Modify: `js/results.js`
- Modify: `js/events.js`

**Interfaces:**
- Consumes: `canonicalSolveJson(state)`, accepted state snapshots, `Date.now()`, and localStorage.
- Produces: `maxItemsConditionKey(state)`, private read/write/prune helpers, `options.forceFresh`, and callback metadata `{ cached, savedAt }`.

- [ ] Add the versioned input projection, collision-safe hash slot, strict record validation, 24-hour expiry, 24-entry pruning, and 512-KiB record cap.
- [ ] Check the cache only for Items requests before overlay/Worker creation; use existing generation/current-state delivery.
- [ ] Store only successful authoritative Items responses from both Worker and fallback paths.
- [ ] Pass cache-hit metadata to the existing render callback.
- [ ] Thread `forceFresh: true` only from explicit Resimulate actions and show a clear cached-result status instead of stale solve milliseconds.
- [ ] Run `node test/solve-lifecycle.cjs` and verify all lifecycle assertions pass.

### Task 4: Bundle and deliver the focused change

**Files:**
- Modify: `scripts/build-static.cjs` only if a new page module is introduced.
- Verify: `js/*.js`, `scripts/*.cjs`, `test/*.cjs`, package/workflow files, and the final diff.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: one committed and pushed update to the existing pull request.

- [ ] Run `npm run check:syntax`.
- [ ] Run `node test/ci-workflow.cjs` and `node test/solve-lifecycle.cjs`.
- [ ] Run `npm run test:release` to build and execute non-browser release smoke.
- [ ] Inspect the diff for accidental solver/save-schema changes, browser-test remnants, and attribution text.
- [ ] Commit with product-only wording and push the existing branch; do not merge.
