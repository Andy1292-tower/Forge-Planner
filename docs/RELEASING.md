# Release and Preview Runbook

Forge Planner ships as a static site. Releases should come from a reviewed feature PR, not a direct push to `main`.

## Prerequisites

- Node.js 24
- Dependencies installed from the lockfile with `npm ci`
- A branch synchronized with current `main`
- A clean understanding of any open PR that touches the same solver, state, build, or UI files

Automated browser evidence currently covers Playwright Chromium. Other current browsers may work, but they are not a release gate unless equivalent evidence is added.

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

The normal browser lanes are intentionally separate:

```bash
npm run test:browser
npm run test:a11y
npm run test:visual
```

Run them in CI when local browser execution is undesirable or unstable. `test:browser` excludes the dedicated accessibility, visual, and release-upgrade specs so the lanes do not silently duplicate work.

## Cold and warm release verification

Run the complete release gate:

```bash
npm run test:release
```

Focused variants are:

```bash
npm run test:release -- --grep @cold
npm run test:release -- --grep @warm-upgrade
```

The Node portion verifies the static server, both mounts, containment, permanent Worker files, cache headers, strong ETags, Last-Modified, conditional GET/HEAD, and same-origin A-to-B release rotation. The browser portion requires a clean current Blob-Worker solve and no mixed-release console/request failures.

- `@cold` loads release B on a fresh browser context at `/` and `/Forge-Planner/`.
- `@warm-upgrade` first caches an intentionally incompatible release A, atomically switches the same origin to B, and proves that B HTML selects B's hashed app while unchanged immutable assets remain reusable.

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

A successful push, build log, or runtime log alone does not establish that the production alias and cached browser path are healthy.

## Rollback

Use the Vercel dashboard to restore/promote the last known-good deployment for the production alias. Because release assets are content-addressed, old and new hashed files may safely coexist; do not “clean up” immutable URLs during rollback.

After rollback, repeat the production checks above, including a warm-cache load and a real solve. Confirm the permanent Worker compatibility files are still available with their original bytes.
