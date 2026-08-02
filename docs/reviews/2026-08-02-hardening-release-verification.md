# Hardening Release Verification — 2026-08-02

## Decision

The hardening candidate is ready for a dedicated pull request. It is **not** approved for production or a direct update to `main` by this document.

The local deterministic, solver, state, static-build, compatibility, and release-server gates pass. Browser execution is intentionally assigned to pull-request CI, and the owner must approve the rendered preview before merge. No current user save/export was supplied for this final pass, so release acceptance must also include a non-destructive import/solve/export check with a copy of the current live build.

This document closes the implementation loop for the [adversarial project review](2026-08-01-adversarial-project-review.md) and its [agentic remediation plan](../superpowers/plans/2026-08-01-adversarial-review-remediation.md).

## Candidate boundary

- Branch: `codex/adversarial-remediation-continuation-v2`
- Current remote `main` verified before finalization: `1466a5d96aafd93f4ad7d022158357a7c1bd11ba`
- PR #94 exact head retained as a real merge parent: `b97cc95ce8c143879b0fafc6b14180900cafffb2`
- PR #94 integration merge: `f793341d0297cf9052c183a787623b4c9894f3b5`
- Delivery: feature branch and dedicated PR only; no direct push or merge to `main`
- Attribution: use a normal merge for the final PR, not squash, so Allen Terwilliger's original commits and author metadata remain in repository history

The already-released Task 11A checkpoint remains the UI composition for this pass. The only new presentation changes are the three owned safety repairs: visible skip-target focus, original inert-state restoration, and exact recovery focus restoration. Historical visual-system units 11B–11D and the Task 12 onboarding/navigation redesign remain deliberately deferred; this candidate does not reopen the rejected redesign.

## Implemented risk controls

| Area | Release-candidate behavior |
| --- | --- |
| State/import | Versioned strict validation, transactional import/render/persistence, previous-good backup, rejected-save download/recovery, bounded collections and strings, and inert rendering of imported text. |
| Solve lifecycle | One generation/mode/solve-state authority owns Worker requests, cancellation, stale-result rejection, fallback, and overlay state. The Worker receives a complete strictly validated clone; its separate canonical equivalence key ignores object insertion order and display-only Project disclosure/clock changes. |
| Project execution | Displayed schedules are exact-replay checked against carried inventory, warm-ups, external pre-produced Bits, mined budgets, and switch boundaries. Blocked analytical output is not presented as execution guidance. |
| Optimizer trust | Exact Gel capacity through the supported exact UI boundary, bounded/estimated larger-factory copy, winner-owned Credits warnings, shared Credits deadlines, and visible full-run stability tradeoffs. |
| PR #94 | Set & forget persists through schema validation and uses the current executable replay, inventory, mined-resource, stability, and shared-deadline contracts. Certified static incumbents survive interrupted recovery attempts. |
| Persistence | Accepted edits have explicit immediate or 100 ms persistence ownership; page teardown flushes without manufacturing a solve; Progress uses the authoritative async Project result instead of main-thread optimization. |
| Accessibility | Shared dialog lifecycle, named controls/statuses/scrollers, inert background, keyboard Project controls, contrast/motion/forced-color coverage, visible skip-target focus, and exact invoker restoration. |
| Release | Deterministic content-addressed graph, embedded Blob Worker, frozen permanent Worker endpoints, root/subpath-safe relative URLs, strong validators, contained static serving, and incompatible same-origin A-to-B warm-upgrade coverage. |
| Trust/docs | Qualified best-found/May-work/Project copy, complete state and solver contracts, precise local-first/Google Fonts disclosure, release runbook, and explicit unknown/unverified catalog provenance. |

## Local evidence

No browser, Chrome, GUI, or persistent preview was launched locally.

| Gate | Result |
| --- | --- |
| `npm test` | 28/28 test scripts passed |
| Golden parity | 16 ok, 0 improved, 0 failed |
| Catalog contract | 11/11 passed, including sparse/custom-prototype/accessor prerequisite mutations |
| Current state schema | 49/49 passed, including legacy/current/future, recovery, rollback, limits, and revision ownership |
| Solve lifecycle | 24/24 passed, including real Worker-schema dispatch and startup validate/adopt currentness |
| Set & forget focused contract | 36/36 passed |
| Static asset graph | 11/11 passed |
| Permanent Worker compatibility | 3/3 passed; original fence and v2 compatibility endpoint remain byte locked |
| `npm run build` | Production `dist/` built successfully |
| Node release smoke | 10/10 passed for dual mounts, containment, GET/HEAD, validators, A-to-B swap, metrics, and server shutdown |
| Syntax and diff hygiene | Passed for all changed source/test files and staged/unstaged diffs |

Playwright collection was parsed without launching a browser or server:

| CI lane | Discovered ownership |
| --- | ---: |
| Ordinary browser behavior | 85 tests |
| Accessibility | 11 tests |
| Visual layout | 26 tests |
| Cold/warm release upgrade | 4 tests |

The lanes are non-overlapping. The visual lane contains 13 exact release-matrix cases at 1440×900, 1024×768, 900×760, 881×900, 880×900, 768×1024, 640×900, 561×900, 560×900, 430×932, 390×844, 375×812, and 320×568.

Feature branches run this full suite through `pull_request` only; the `push` trigger is limited to `main`. This prevents one branch update from launching duplicate Chromium matrices while retaining post-merge verification.

Each viewport covers all four modes and all six registered semantic dialogs: 130 mode/dialog states plus 13 sparse Crafting-data states. Assertions cover document overflow, result inset, title/tab/status containment, persistent label/control collisions, named table scrollers, Project identity width, dialog action reachability/scroll ownership, and sparse-card width. CI must also retain four representative screenshots: 1440 Items, 880 Project, 390 Shopping list, and 320 Manual. Missing evidence fails the workflow.

## Pull-request CI and owner gates

The candidate is not release-complete until all of these are satisfied on the exact PR head:

1. Ordinary browser, accessibility/Axe, visual matrix, and cold/warm release-upgrade jobs pass in GitHub Actions.
2. The four release-matrix screenshot artifacts are present and visually reviewed.
3. The Vercel preview for the exact commit is Ready and the owner approves the established UI at desktop and mobile widths.
4. A copy of the current live save/export is imported without overwriting the original. Items, Credits, Project line-switching, Project Set & forget, Manual, Progress, export, and reload are smoke-tested.
5. The final PR is merged normally rather than squashed if preserving PR #94's commit-level attribution is still required.
6. After an explicitly approved merge, verify the production alias, HTML revalidation, immutable asset headers, a real solve, no current Worker HTTP request, no failed owned asset, and route-level telemetry.

## Known limitations and deliberate deferrals

- The final live-save gate is pending because no current user export was supplied. Existing schema/migration fixtures are green but are not a substitute for that exact build.
- Browser automation currently gates Chromium only. Other modern browsers may work but do not have equivalent release evidence.
- Real screen-reader timing and subjective rendered quality still require human preview review; automated keyboard, forced-color, reflow, and Axe coverage do not replace it.
- Catalog structure is validated, but its game version, source artifact, date, and hash remain unknown/unverified. No game values were invented during this pass.
- The page still loads its established Google Fonts from Google. Planner state is not sent in those requests; fonts were not self-hosted because the approved checkpoint appearance and scope were preserved.
- The global-script/static architecture remains. State, solve, Worker, persistence, dialog, and release ownership are now bounded and regression-tested, but this was not a framework rewrite.
- The broader 11B–11D composition/source-consolidation work and Task 12 onboarding/navigation redesign require a new explicit owner request and visual approval. They are not hidden work in this PR.
- Production alias and telemetry verification necessarily occur after an explicitly approved merge; a green PR preview alone does not prove production health.

## Release recommendation

Open the dedicated PR and let CI produce the browser and screenshot evidence. If CI is green, the current live-save smoke succeeds, and the owner approves the exact preview, this candidate is suitable for a normal reviewed merge. Until then, keep `main` and production unchanged.
