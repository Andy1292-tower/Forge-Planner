# Daily Items and Credits Cache Design

## Outcome

Forge Planner will reuse a successful Max Items or complete Max Credits solve for up to 24 hours when the inputs that affect that mode are identical. The feature ships in the existing `codex/adversarial-remediation-continuation-v2` pull request. It does not create another PR and does not change solver formulas.

The repository and required CI will no longer contain Playwright/browser UI tests. CI will run one fast Node/build verification job.

## Cache scope

- Cache `mode === "items"` and complete `mode === "credits"` results.
- Keep Project Plan and Manual behavior unchanged and uncached.
- Persist cache records outside `forgePlannerState_v3`; exports and imports remain unchanged.
- Reuse capped and exhaustive successful Items results. Reuse Credits results only after every priced item received a baseline; never freeze a comparison with unevaluated candidates for 24 hours.
- The 24-hour expiry and explicit Resimulate bypass provide the requested refresh path for both cached modes.
- Do not cache errors, canceled/stale responses, null responses, or malformed results.

## Condition identity

The cache key is canonical JSON over an explicit mode-specific input projection plus cache version `2`:

- crafter lines: `max`, `spx`, and `turbo`, in line order;
- `maxTurbo`, `dupe`, `margin`, and exact `solveBudget`;
- `baseTime` and `prodCost` calibration;
- numeric Lil' Forgie production;
- numeric mined-resource income.

Max Items additionally keys target enabled state and weights while ignoring sell prices. Max Credits additionally keys sell prices while ignoring Items target choices. Project definitions, project inventory, Manual layouts, text-format mirrors, project disclosure state, and `planStart` affect neither mode and do not invalidate the cache.

## Persistence and safety

- Use a separate versioned local-storage cache so normal save validation and export/import schemas remain untouched.
- Store at most 24 entries, prune expired/oldest entries, and reject records larger than 512 KiB.
- Hash the canonical condition key for the storage slot, but retain and compare the full key inside the record to make hash collisions harmless.
- Treat cache bytes as untrusted: require the expected version, timestamp, exact condition key, matching Items/Credits mode, complete priced-item set and prices for Credits, plain JSON data, and the result shape required by rendering.
- A missing API, malformed record, future/expired timestamp, quota error, or write failure silently falls through to the normal Worker/fallback solve.

## Request lifecycle

1. `renderResults()` dispatches the accepted state through `solveService.request()` as it does now.
2. `solveService` checks the matching Items or Credits cache before showing the overlay or creating a Worker.
3. A hit is delivered through the same current-state/generation gate and reports cached status to the renderer.
4. A successful fresh Items response, or a Credits response that evaluated every priced candidate, is stored only after it passes authority and render-shape checks.
5. Clicking or keyboard-triggering Resimulate sets `forceFresh: true` and removes that condition's old record before solving; a complete fresh result replaces it, while an incomplete result remains uncached.

## UI-test removal

- Delete `test/browser/` and `playwright.config.js`.
- Remove Playwright/Axe dependencies and browser scripts.
- Remove the Playwright CI matrix and artifact uploads.
- Keep `npm test` as deterministic Node checks and keep `npm run build`/release smoke available without a browser.
- Update current README/release instructions and the fast CI contract.

## Focused verification

- A focused Node lifecycle test proves Items and Credits reuse, mode-specific relevant misses, exact Credits candidate/price matching, incomplete-Credits rejection, force-refresh invalidation, 24-hour expiry, Project bypass, and corrupted-storage fail-open behavior.
- A fast CI contract proves the workflow has one Node job and no Playwright/browser installation or commands.
- Syntax and static build/release smoke verify the new page module is bundled.
