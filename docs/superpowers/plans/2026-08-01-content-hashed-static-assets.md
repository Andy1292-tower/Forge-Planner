# Content-Hashed Static Assets Implementation Plan

> **For Forge Planner maintainers:** execute this plan with red-green tests and verify the generated deployment, browser behavior, response headers, and post-deploy Vercel traffic before calling it complete.

**Goal:** Make a loaded Forge Planner release self-contained and browser-cacheable so it does not repeatedly reach Vercel for unchanged JavaScript, Worker dependencies, CSS, or images.

**Architecture:** Add a deterministic, Node-built `dist/` release. The page's classic scripts are concatenated in their existing order into one content-hashed app asset. The Worker dependencies and handler are concatenated into a self-contained Worker payload, embedded into that app asset, and launched from a `blob:` URL, so solves and Worker recreation make no network request. CSS and images receive hashes based on their final bytes. The HTML document remains the sole revalidated release pointer. The original Worker URL remains an immutable error fence for the oldest tabs, while the v2 URL remains a checksum-locked, self-contained, functional Worker for tabs opened on the immediately preceding release.

**Tech Stack:** Node.js built-ins (`fs`, `path`, `crypto`), classic browser JavaScript, Playwright, Vercel static output and cache headers.

---

### Task 1: Lock the release contract in failing tests

**Files:**
- Create: `test/static-asset-build.cjs`
- Modify: `test/run-all.cjs`

- [x] Build twice into temporary directories and require byte-identical names and contents.
- [x] Assert generated filenames contain the SHA-256 prefix of their final bytes.
- [x] Assert `index.html` references only hashed same-origin app/CSS/image assets.
- [x] Assert the app contains the self-contained Worker payload and no production Worker URL or `importScripts` call.
- [x] Assert the original legacy path is an error fence and v2 is checksum-locked, functional, and self-contained.
- [x] Assert changing a Worker dependency changes the app hash while leaving unrelated CSS unchanged.
- [x] Run the new test and record the expected missing-build failure (RED).

### Task 2: Implement the deterministic build

**Files:**
- Create: `scripts/build-static.cjs`
- Create: `compat/solver.worker.v2.js`
- Modify: `package.json`
- Modify: `.gitignore`

- [x] Hash/copy images and CSS using final emitted bytes.
- [x] Build a self-contained Worker payload in exact dependency order with `importScripts` removed.
- [x] Build one app bundle in exact page-script order, embedding the Worker payload and rewriting the speed-image reference.
- [x] Rewrite `index.html` to hashed app/CSS/image URLs and update `worker-src` for the generated Blob Worker.
- [x] Copy the permanent original fence and frozen functional v2 Worker into `dist/js/`.
- [x] Fail closed if an expected source reference or import is absent or survives the build.
- [x] Run the build-contract test until it passes (GREEN).

### Task 3: Make local verification production-faithful

**Files:**
- Modify: `vercel.json`
- Modify: `test/serve-vercel-config.cjs`
- Create: `test/serve-built.cjs`
- Modify: `playwright.config.js`
- Modify: `test/legacy-worker-retirement.cjs`
- Modify: `test/browser/smoke.spec.js`

- [x] Configure Vercel to run the build and publish `dist/`.
- [x] Set one-year immutable browser caching only on content-hashed assets and the two permanent compatibility URLs.
- [x] Explicitly revalidate `/` and `/index.html`.
- [x] Serve `dist/` with the real Vercel header rules for browser tests.
- [x] Verify the original legacy path fails without dependencies and v2 completes two real solves without fan-out.
- [x] Verify a real browser solves through a Blob Worker and makes no Worker-script HTTP request.
- [x] Verify repeated Worker creation after the initial page load adds zero same-origin network requests.

### Task 4: Regression verification and release

**Files:**
- Verify all modified files and generated output; do not commit `dist/`.

- [x] Run syntax checks, all Node tests, deterministic build validation, and the full Chromium smoke suite.
- [x] Inspect local cache headers and the browser network log.
- [x] Fetch the newest `origin/main`, reconcile safely, and rerun affected verification.
- [ ] Commit without AI attribution and push `main`.
- [ ] Confirm the new Vercel production deployment is READY and serves the expected hashed assets and cache headers.
- [ ] Observe a clean, post-deploy Vercel log window and report measured Edge Requests, including whether either legacy fence or any dependency fan-out appears.
