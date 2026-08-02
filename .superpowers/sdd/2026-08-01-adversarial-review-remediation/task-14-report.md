## Task 14: Release Upgrade and Subpath Safety

Task 14 is complete on `codex/adversarial-remediation-continuation-v2`. The checkpoint UI is unchanged apart from making its existing tooltip asset references document-relative.

### Implemented contract

- The content-addressed build now emits document-relative `static/...` URLs. The same bytes resolve at `/` and `/Forge-Planner/`; source tooltip fallbacks use relative `assets/...` paths.
- The generated app still uses the exact embedded Blob Worker factory and release hook. Both permanent Worker endpoints and all frozen compatibility fixtures retain their registered bytes.
- The reusable release server mounts one `dist` tree at root and subpath, strips only recognized mounts before header matching and contained path resolution, rejects traversal/symlink escape, and supports GET/HEAD with strong SHA-256 ETags, Last-Modified, and standards-correct conditional responses.
- The release lane builds clean production output, runs a Node release smoke, then runs a self-hosted Playwright upgrade spec. Ordinary browser, accessibility, visual, and release-upgrade lanes are named and non-overlapping in CI.
- The release fixture warms an incompatible release A, atomically swaps the same origin to B, and requires B HTML/app coherence, a B Blob-Worker solve, no A-app request, immutable reuse of unchanged CSS/favicon/dupe/speed assets, stable permanent Worker bytes, and clean console/page/network health at both mounts. Fresh-origin B loads are the cold control.
- The emitted graph rejects root-relative owned application URLs and Vercel Analytics signatures. CSS, favicon, dupe, and speed mutations independently rotate only their dependent hashes.
- `README.md` documents the GUI preview plus focused cold and warm-upgrade commands.

### Verification

Independent review used an isolated HEAD-plus-Task-14 snapshot, excluding concurrent Task 15 and Task 16 work:

- static build: 11/11
- release smoke and validator suite: 10/10
- permanent Worker retirement/compatibility suite: 3/3
- syntax and scoped diff checks: pass
- Playwright discovery: 84 ordinary browser, 11 accessibility, 13 visual, and 4 release tests with no lane overlap
- independent adversarial review: no Critical, Important, or Minor findings

No browser, Chrome, GUI, or persistent preview was launched locally. The four release-upgrade browser cases remain CI execution evidence, not a local-pass claim.
