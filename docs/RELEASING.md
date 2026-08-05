# Release and Preview Runbook

Forge Planner ships as a static site. Releases should come from a reviewed feature PR, not a direct push to `main`.

## Prerequisites

- Node.js 24
- Dependencies installed from the lockfile with `npm ci`
- A branch synchronized with current `main`
- A clean understanding of any open PR that touches the same solver, state, build, or UI files

## Local checks and GUI preview

Run the fast deterministic checks first:

```bash
npm test
```

Build and open the production-form GUI preview with:

```bash
npm run preview
```

Then open either mount:

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/Forge-Planner/`

Both addresses serve the same generated `dist/`. The bare `/Forge-Planner` path redirects to `/Forge-Planner/`. Stop the preview when inspection is complete.

## Cold and warm release verification

Run the complete release gate:

```bash
npm run test:release
```

The release check verifies the static server, both mounts, containment, permanent Worker files, cache headers, strong ETags, Last-Modified, conditional GET/HEAD, and same-origin A-to-B release rotation.

## Build and cache contract

Create the deployable directory with:

```bash
npm run build
```

The builder stages a complete release and atomically replaces `dist/`. Do not hand-edit `dist/`.

The release contract is:

- HTML is revalidated (`public, max-age=0, must-revalidate`).
- Generated JS, CSS, favicon, and tooltip images use content-hashed, document-relative `static/...` URLs and are immutable for one year.
- The current app creates the solver from a Blob assembled into the hashed app bundle; a current solve should not request a Worker script.
- `/js/solver.worker.js` and `/js/solver.worker.v2.js` are permanent compatibility URLs. Never change bytes at an immutable URL or remove either file; add a new versioned path for a genuinely new legacy endpoint.
- The generated release must resolve from both the local root and subpath portability mounts without root-relative asset assumptions. This verifies base-safe assets; it does not configure a production subpath rewrite.
- The emitted app contains no Vercel Analytics bootstrap or endpoint.

The source page still requests Big Shoulders Stencil Display, Chakra Petch, and JetBrains Mono from Google Fonts. No font files or licenses are copied into this repository. Those network requests expose normal connection metadata to Google, but planner state is not put into the request. The application has no planner backend and the generated release contains no analytics integration.

The one server route the app calls is `/api/report-issue`, the account-free half of the report form. It is a Vercel Function deployed from `api/`, outside `dist/`, so it sits outside the content-hash and immutable-cache contract above and answers `no-store`. It carries only the text typed into that form, never planner state. Setup, token scope, and rotation are in [issue intake](ISSUE_INTAKE.md).

## Deploy and verify

Use the repository's configured Vercel PR/deployment workflow; this runbook does not invent a separate production CLI command or deployment ID. Before promotion, verify the PR checks and inspect the GUI preview generated for the exact commit when one is available.

After promotion, verify the production alias directly:

1. Confirm the deployment is Ready and points at the intended commit.
2. Load `/` on the current Vercel deployment with a cold context. `vercel.json` does not currently create a `/Forge-Planner/` production rewrite.
3. If a different host actually deploys the app at a subpath, verify that configured subpath separately.
4. Load again with a warm cache and confirm the same release remains coherent.
5. Run one real planner solve and confirm no console errors, failed static requests, or current Worker-script request.
6. Check HTML revalidation and immutable headers on generated `static/...` files.
7. Check route-level request telemetry after the release; current solves should not create repeated Worker HTTP traffic.
8. Open the header report disclosure and confirm the account-free button is enabled, which means `GITHUB_TOKEN` reached this deployment. A disabled button is the honest failure mode, not a broken page — the GitHub path still works. `curl /api/report-issue` returns `{"error":"unconfigured"}` when the variable is missing.

A successful push, build log, or runtime log alone does not establish that the production alias and cached browser path are healthy.

## Rollback

Use the Vercel dashboard to restore/promote the last known-good deployment for the production alias. Because release assets are content-addressed, old and new hashed files may safely coexist; do not “clean up” immutable URLs during rollback.

After rollback, repeat the production checks above, including a warm-cache load and a real solve. Confirm the permanent Worker compatibility files are still available with their original bytes.
