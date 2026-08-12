# Solver Performance & Parallelization Design

This document plans the next round of solver work: cut solve wall-clock on complex factories, raise
anytime plan quality at the same budgets, and introduce multi-Worker parallelism **without** ever
recreating the request-storm failure mode from the first Worker rollout. It is written to be
executed as independent workstreams by separate implementation agents, with explicit merge order,
verification gates, and acceptance criteria per workstream.

The behavioral promises in [SOLVER_CONTRACT.md](SOLVER_CONTRACT.md) are constraints on this work,
not casualties of it. Any change that touches a documented guarantee (one is proposed: the
margin-solve bound) lands only together with its contract edit and is called out below.

## Goals

- Reduce time-to-quality on large factories (30–64 lines) by an order of magnitude for the
  Items/Credits discrete search, and materially (≥40%) for multi-project Set & forget runs.
- Use multi-core hardware: a small persistent Worker pool for independent solve work.
- Improve plan quality per second: more search iterations in the same budget, plus one
  structurally better neighborhood (LNS) and tighter pruning bounds.
- Keep every result claim truthful under the contract: `capped`, `deadlineReached`, `bound`,
  budget monotonicity, and machine-independent work-unit accounting all survive.

## Non-goals

- No server-side solving. All computation stays in the browser; Vercel serves static bytes only.
- No external solver dependency (no WASM LP/MIP engine). The dependency-free single-file solver
  stays.
- No change to the persisted state schema. Pool sizing is a device property, not plan input.
- No SharedArrayBuffer / cross-origin isolation. Worker coordination is `postMessage` only, so the
  Vercel header set (CSP included) is untouched.
- No change to what the objective means in any mode.

## Background: where solve time goes

Problem size bounds: up to 64 lines (`fields.js` `maxLines`), 15 compression levels, 9 products +
3 raws (+2 mined resources). A line's job list is up to ~140 entries (idle + raws + 9 products ×
eligible levels).

**Items/Credits discrete search (`solveCore`).** Every local-search probe calls `evalChoice`,
which recomputes the produced/consumed vectors from scratch over all N lines. `repair`, `climb`,
`minDeficitAtScore`, and `swapTargets` each try O(N·J) candidate moves per pass, so one pass costs
O(N²·J) probe work — quadratic in line count — and the ILS plus the feeder second pass run
thousands of passes. This is the dominant cost and matches the observed scaling: solve times grew
as factories grew. Secondary costs in the same loops: `performance.now()` is sampled on **every**
checkpoint (every candidate job trial, and every coefficient while building the LP), and
`feasibleNow` calls `isMinedResource` (an array scan) per resource per check.

**Project mode (`projectSchedule` / `solveExecutableProjectPhase` / `optimizeProjectTop`).** The
makespan LP (up to ~11.5k columns at 64 lines) is rebuilt and solved from scratch many times per
run: free + pinned solves per phase, up to 8 pre-produced-Bits fixed-point passes where only the
Bits terms move, compression-fallback retries, one ordering-estimate LP per project in sequenced
mode, warm-up solves, and a complete hidden alternative run whenever prefer-current stabilized any
phase. `lpMaximize` uses Bland's rule from the first pivot — the slowest anti-cycling rule — and
most of these solves are near-duplicates of each other.

## The edge-request incident, and the invariants that prevent it

### Failure mode (history)

When Workers first shipped, Worker construction was network-bound and construction was frequent:

- `solve-service.js` terminates a busy Worker to supersede it (`optimize()` is synchronous inside
  the Worker, so termination is the only cancellation), and constructs a replacement on the next
  request. Interactive editing produces many supersedes per minute.
- A URL-constructed Worker fetches `js/solver.worker.v2.js` **plus five `importScripts` files**
  (`core.js`, `fields.js`, `state.js`, `project-schedule.js`, `solver.js` — ~250 KB total) on
  every construction.
- Only the two worker entry files carry `Cache-Control: immutable` in `vercel.json`; the five
  imported files revalidate at the edge on each fetch.

Multiplied out, an ordinary editing session generated thousands of edge requests. Adding K× more
Workers without addressing construction cost would multiply the same storm by K.

### Standing safeguards (already shipped — must survive this project)

- The production build (`scripts/build-static.cjs`) inlines the entire Worker payload into the app
  bundle as `__FORGE_SOLVER_WORKER_SOURCE__` and constructs Workers from a Blob URL
  (`__forgeCreateSolverWorker`). **Production Worker construction performs zero network I/O.**
- Build-time assertions fail the build if the bundle still contains `importScripts(` or any
  `js/solver.worker*.js` URL, and `replaceExactly` guarantees exactly one Worker-construction site
  exists to rewrite.
- `scripts/release-smoke.cjs` counts requests against a served build, including the legacy
  immutable worker URLs kept for stale pages.
- CSP `connect-src 'self'` plus no `fetch` in solver code means a running Worker cannot generate
  requests at all; construction time is the only exposure.

### Invariants for any multi-Worker change (N1–N7)

These are requirements, not suggestions. WS3 implements them; every later change is bound by them.

- **N1 — Zero-network construction in production.** Pool Workers are constructed only through the
  single existing factory seam (the one `workerFactory` indirection in `solve-service.js`, rewritten
  by the build to the Blob bootstrap). No second construction path may be introduced; the build's
  exactly-one-rewrite assertion is extended to keep this true.
- **N2 — One payload, one URL, page lifetime.** The Blob object URL is created lazily **once per
  page load** and shared by every pool Worker; it is not revoked per Worker (today's bootstrap
  revokes after first message — the pool version hoists the URL to page lifetime; ~250 KB retained
  is acceptable). Respawn after termination reuses the same URL: zero allocations of new payloads,
  zero network.
- **N3 — Bounded pool.** Size = `min(4, max(1, navigator.hardwareConcurrency - 1))`, with a
  runtime kill switch (localStorage flag) forcing size 1, which is exactly today's behavior. No
  persisted-state field.
- **N4 — Constructions are bounded by terminations.** Workers are persistent across solves. A new
  Worker is constructed only (a) filling the pool on first parallel use, or (b) replacing a Worker
  that was terminated because it was busy with a superseded generation or failed. Idle Workers are
  reused, never churned. Superseding an idle pool constructs nothing.
- **N5 — Dev path may fetch only at pool fill.** Source-served dev keeps URL Workers with
  `importScripts`; a K-Worker pool may cost up to K×6 requests once per page load and must never
  fetch per solve. The same reuse rules apply.
- **N6 — Enforcement is automated.**
  - Build: existing assertions (no `importScripts`, no worker URL, exactly-one factory rewrite)
    stay green; a new assertion checks the bootstrap creates at most one object URL.
  - Release smoke: a scripted session (load → ≥50 solves with rapid supersedes, pool enabled)
    asserts zero solver-source requests after page load in the built app, and that the legacy
    worker URL counts are unchanged.
  - Unit: solve-service pool tests with an instrumented factory assert construction counts under a
    supersede storm (constructions ≤ pool cap + observed busy-terminations) and idle reuse.
- **N7 — Runtime tripwire.** The pool counts constructions; exceeding `4 × pool cap` within 10
  minutes disables parallelism for the session (falls back to one Worker) and surfaces the standing
  fallback notice. A bug can then degrade performance, never generate a request storm — and in
  production a storm is structurally impossible anyway (N1: construction has no network step).

## Workstreams

### WS0 — Measurement harness and fixture corpus (first, gates everything)

Build the evidence base before touching the solver.

- Fixture corpus under `test/perf/`: small (8-line), mid (30-line), and max (64-line) Items
  factories; a Credits state with many priced items; a 3+ project Set & forget run exercising
  fixed points, fills, and the hidden comparison. Fixtures are saved states, loadable by the
  existing Node test bootstrap.
- Harness: runs `optimize()` per fixture with `makeSolveControl`'s existing `onCheckpoint` seam,
  emitting per-label work/elapsed histograms, LP pivot counts, ILS iteration counts, final
  objectives, and `capped`/`deadlineReached` flags as JSON into `test-results/`.
- Baseline snapshot recorded and committed (JSON) before WS1 merges; later PRs attach a
  before/after comparison.
- CI stance: the bench suite is opt-in (`npm run bench`), not part of `npm test` — CI gates on
  deterministic proxies (objective parity, work-unit counts, construction counts), never on
  wall-clock.

Acceptance: harness runs on all fixtures; baseline JSON committed; README-level usage note in the
harness file header.

### WS1 — Hot-loop cost reduction (`solveCore` internals)

1. **Incremental move evaluation.** Maintain `produced`/`consumed` as live state with
   `applyMove(i, j)` / `revertMove` deltas (a single-line move touches only that job's few
   coefficients; a swap touches two lines). Track the total-deficit sum and an
   infeasible-resource count incrementally over touched resources so `repair`'s and
   `minDeficitAtScore`'s inner loops stop rescanning everything. Guard float drift: full
   re-evaluation on every adopted incumbent and periodically (every 4096 accepted moves), keeping
   all EPS comparisons anchored.
2. **Amortized clock sampling.** `checkpoint`/`checkpointWithin` keep exact per-call work
   accounting (work-limit determinism is untouched) but sample `performance.now()` only when ≥256
   work units accrued since the last sample. Local deadlines may overshoot by at most that many
   units — bounded and machine-independent.
3. **Precomputed `needFrac` array.** Rebuilt when `curTol` changes (twice per margin solve),
   removing `isMinedResource` string scans from `feasibleNow`/DFS leaves.
4. **Seed dedup.** Hash choice vectors before `localOpt`; the role enumeration (cap 350) and LP
   roundings submit many duplicates after `jobLike` clamping.
5. **(Behind fixture parity) restricted repair candidate set.** Index jobs by produced resource;
   repair scans producers of currently-short resources plus moves on lines consuming them, instead
   of all N·J. This changes repair trajectories, so it lands separately, gated on corpus parity.

Invariants: identical search *semantics* for 1–4 (same probe order, same acceptances) up to float
drift; property test runs delta-path and full-recompute paths side by side over randomized move
sequences on every fixture and asserts vectors agree within 1e-12 before drift resync.

Expected effect: probe cost drops from O(N) to O(1); at 30–64 lines the dominant loops get an
order of magnitude cheaper, which also means far more ILS/second-pass iterations inside the same
iteration-based stagnation limits (a quality gain at unchanged budgets).

### WS2 — LP engine (`lpMaximize` + Project-mode call sites)

1. **Pivot rule.** Dantzig (most-negative reduced cost) with automatic permanent switch to Bland
   after a degeneracy stall (no objective progress for a fixed pivot window or repeated basis
   signature). Termination stays guaranteed; typical pivot counts drop several-fold. The pivot cap
   and atomic-pivot cancellation semantics stay.
2. **Within-run LP memoization.** One `optimizeProjectTop` run solves near-identical LPs
   repeatedly (fixed-point passes, the hidden alternative run's free solves, ordering estimates).
   Memoize `lpMaximize` results in a per-run table keyed by a canonical serialization of exactly
   the inputs that shape the tableau: (net, avail, targets, maxCompression/static flags, line
   signature, and the solve-constant tables already hashed by `soloMaxKey`). The table lives in
   the run, so cross-solve staleness is impossible.
3. **(Stretch) warm-started re-solves.** Fixed-point passes change only Bits-related terms;
   re-pivoting from the previous basis usually needs a handful of pivots. This requires care with
   basis feasibility after `b` changes, so it is explicitly a stretch goal behind the memo win,
   not a dependency of anything else.

Acceptance: identical LP optima on the corpus (z within 1e-9 relative); Project fixture pivot
counts and repeated-solve counts drop in the bench JSON; hidden-comparison runs no longer double
free-solve time.

### WS3 — Worker pool (`solve-service.js`, build bootstrap, worker protocol)

#### Pool lifecycle

- `solve-service` grows from one owned Worker to a pool honoring N1–N7. The pool fills lazily on
  the first request that can use it; small solves (below an engagement threshold, e.g. <12 lines
  and <4 priced Credits items and non-project modes) keep the single-Worker path — parallelism has
  spawn/merge overhead that tiny solves should not pay.
- Supersede: terminate **only** Workers busy with the obsolete generation; idle Workers are
  reused. Replacement construction is lazy and reuses the shared Blob URL (N2/N4).
- Per-Worker failure/backoff mirrors today's `workerFailed` logic; total pool failure falls back
  to one Worker, then to the existing synchronous main-thread path. The user-facing fallback
  notice and overlay flow are unchanged.
- `status()` gains pool fields (size, busy, constructions) for the existing diagnostics surface.

#### What runs in parallel (per mode)

- **Credits:** partition priced items across Workers round-robin in catalog order. Each Worker
  runs baselines then its own fair refinement slicing against the same absolute remaining budget;
  the "one clock, never restarted per candidate" rule holds per shard. Merge on the main thread:
  rank by credits then catalog order (unchanged rule); `allCandidatesEvaluated` /
  `searchExhaustive` / `deadlineReached` aggregate conservatively (AND / AND / OR).
- **Items:** K independent `solveCore` chains over identical inputs, distinct ILS RNG streams,
  shard 0 keeping the canonical seed constant (so shard 0 alone reproduces today's trajectory).
  Merge takes the best objective; ties break by shard index. Each shard is budget-monotone, and a
  max of monotone results is monotone, so the contract's language survives; run-to-run variance is
  already acknowledged there. `bound` comes from the (deterministic) LP; `capped`/`deadlineReached`
  OR across shards.
- **Share-of-max calibration:** the per-output single-target ceiling solves are independent —
  scatter across the pool.
- **Project:** phases stay sequential on one Worker (inventory carry is inherently ordered). Two
  independent pieces parallelize: the hidden prefer-current **alternative run** (pure given the
  cache snapshot; only the selected run may commit stability updates — already the rule) and the
  sequenced-mode **ordering-estimate** solves.
- **Protocol:** the request message grows an optional shard descriptor (mode-specific: candidate
  subset, RNG stream id, or run role). A Worker without a descriptor behaves exactly as today.
  Merge logic is pure, main-thread, and unit-tested for arrival-order independence.

#### Worker-resident caches

- `_lineStability` already round-trips through the main thread per request — unchanged.
- `_soloMaxCache` currently lives in Worker globals and would fragment across a pool: move it to
  the same pattern (main thread owns it, seeds requests, accepts updates keyed by `soloMaxKey`).

Acceptance: N6 tests green; bench shows Credits full-corpus refinement completing at budgets it
previously exhausted, and ~pool-size speedups on calibration and the hidden-comparison Project
fixture; kill switch verified to restore exact single-Worker behavior.

### WS4 — Search quality (after WS1 lands)

1. **LNS repair operator.** Alternate the ILS random kick with a destroy-and-repair move: freeze
   all but k lines (k = 2–4; biased toward target-carrying lines and lines the LP fractionated),
   fold the frozen lines' contributions into the base supply vector, and re-solve the free subset
   exactly with the existing DFS under a fixed per-repair work cap. Accept on strict improvement.
   This systematically finds the coupled moves the feeder second pass exists for (feeder onto an
   idle line + target relocation) without surrogate tuning, and it reuses the subset machinery the
   idle-line fills already prove out. Iteration-count stagnation keeps stopping budget-independent.
2. **Margin-pass LP bound (contract edit).** The may-work tolerance is linear: scaling each
   ordinary resource row's consumption by `(1 − tol)` (mined stays 1) yields a valid relaxation of
   the margin problem. Parameterize `lpRelax` by the `needFrac` vector and run it for the margin
   stage: margin solves gain the incumbent-meets-bound early exit (skipping the DFS and second
   pass entirely when proven) and a reportable `bound`. This contradicts the current contract
   sentence that no completed relaxation applies when a margin is set, so it ships only with that
   contract paragraph rewritten and explicit sign-off.
3. **Dual-priced DFS bound.** The current DFS upper bound assumes remaining lines can max-produce
   every target with zero input cost. Price jobs with the root LP's duals for a Lagrangian bound —
   one dot product per node, dramatically tighter on feeder-heavy chains, meaning more
   `capped:false` proofs inside the budget. Gated by an equivalence harness: on every corpus
   fixture the DFS with the new bound must return the same optimum as without it, and the bound
   must never sit below an achieved objective.

## Contract implications (summary)

- Unchanged and load-bearing: budget monotonicity via fixed seed sets and iteration-based
  stagnation; work-unit (machine-independent) allowances for fills; `capped` vs `deadlineReached`
  meanings; hidden runs never mutating stability state.
- Run-to-run variance: already acknowledged for wall-clock anytime search; pool scheduling adds
  variance of the same kind, and shard-0 canonical seeding keeps a deterministic backbone.
- One deliberate edit: the margin-bound paragraph (WS4.2). No other contract sentence changes.

## Orchestration plan

Execution is by parallel implementation agents in isolated worktrees, one workstream each, with an
integration owner controlling merge order. Every workstream lands as its own PR off up-to-date
`main` (repo convention: PRs are merged by the maintainer; branches rebase onto `main` after each
merge).

| Phase | Work | Agents | Parallel with |
| --- | --- | --- | --- |
| 0 | WS0 harness + baseline | 1 implementer | — (merges first) |
| 1 | WS1 hot loop | 1 implementer + 1 adversarial reviewer | WS3 |
| 1 | WS3 worker pool | 1 implementer + 1 adversarial reviewer | WS1 |
| 2 | WS2 LP engine | 1 implementer + 1 reviewer | WS4 prep |
| 3 | WS4 quality (LNS, bounds, contract edit) | 1 implementer + 1 reviewer | — |
| 4 | Integration bench sweep, docs reconciliation, pool default-on decision | integrator | — |

Conflict control: WS1, WS2, and WS4 all edit `js/solver.js`, so they are **sequenced** (WS1 →
WS2 → WS4), each rebasing on the previous merge; WS3 touches `js/solve-service.js`,
`scripts/build-static.cjs`, worker files, and tests — nearly disjoint — so it runs concurrently
with WS1. WS4 depends on WS1's delta-eval primitives by design, not just by merge order.

Reviewer agents get fresh context and an explicit brief per workstream: for WS1, attempt to break
delta/full-recompute equivalence and EPS-anchoring; for WS3, attempt to construct a request-storm
or unbounded-construction scenario and verify N1–N7 close it; for WS4, attempt to produce a bound
below an achievable objective.

Verification gates on every PR, in order: `npm test` (syntax + node suites) and `npm run
test:parity`; workstream-specific new tests; bench comparison against the Phase-0 baseline
attached to the PR (informational for wall-clock, gating for objective parity); release smoke for
any PR touching the build or worker lifecycle.

## Acceptance criteria (project-level)

- **A1 — Speed.** On the 64-line Items fixture, time-to-baseline-objective drops ≥5×; the
  multi-project Set & forget fixture total solve time drops ≥40%; Credits at the default budget
  refines every capped candidate at least once where the baseline could not.
- **A2 — Quality parity or better.** On every corpus fixture, final objective ≥ baseline − 0.1%
  (near-tie tolerance for float-trajectory drift); regressions beyond that block the PR.
- **A3 — Network safety.** Release-smoke scripted session: zero solver-source requests after page
  load in the built app, at any pool size, under a supersede storm; construction-count unit tests
  green; build assertions extended and green.
- **A4 — Truthful reporting.** Contract flags (`capped`, `deadlineReached`, `bound`,
  `allCandidatesEvaluated`, `searchExhaustive`) verified by existing suites; the only contract
  text change is the WS4.2 margin-bound paragraph.

## Risks

- **Float-trajectory drift (WS1).** Near-tied plans can flip. Mitigated by resync points, the
  equivalence property test, the A2 tolerance, and the existing line-stability hysteresis that
  already damps visible churn.
- **Pool complexity (WS3).** More lifecycle states in `solve-service`. Mitigated by keeping the
  single-Worker path as the literal fallback (kill switch = today's code path) and by the
  construction-count tripwire (N7).
- **Memory/thermal.** K Workers each hold solver state (~250 KB source + working set); cap 4 and
  the engagement threshold keep small devices and small solves on one Worker.
- **Warm-start correctness (WS2.3).** Explicitly a stretch goal; the memo + pivot-rule wins do not
  depend on it.
- **Bound validity (WS4).** Both new bounds are gated by never-below-achieved assertions across
  the corpus before they can prune.

## Open questions

- Pool engagement threshold values (line count / priced-item count) — settle empirically in WS3
  from Phase-0 baselines.
- Whether Items-mode sharding is worth more than 2 Workers once WS1 lands (the hot loop may become
  cheap enough that calibration and Credits are the only pool beneficiaries that matter).
- Final wording of the margin-bound contract paragraph (WS4.2) — needs maintainer sign-off before
  implementation starts.
