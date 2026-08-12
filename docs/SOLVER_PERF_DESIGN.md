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

- Cut time-to-quality several-fold (target ≥3×) for the Items/Credits discrete search at real
  game scale (7 lines today, an 8th planned, ~10 as the hard planning ceiling), and materially
  (≥40%) for multi-project Project runs — where the cost sits on the Line switching path, not in
  Set & forget (see Background).
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

Real problem size: the game exposes 7 crafting lines today, an 8th is planned, and ~10 is the
realistic ceiling. (`fields.js` `maxLines: 64` is a state-validation bound, not a design point;
nothing below is sized against it.) The dimensions that actually grow are elsewhere: 15
compression levels and 9 products + 3 raws (+2 mined resources) put a line's job list at up to
~140 entries, and the number of component solves behind one user action multiplies with features:
share-of-max calibration runs one solve per checked output, a margin runs every stage twice,
Credits runs a baseline plus refinements per priced item, and a Project run stacks fixed-point
passes plus — depending on line mode and phase shape — ordering estimates, warm-ups, idle-line
fills, or a full hidden comparison run. No single Project run does all of those; which ones it does
is what the Project paragraph below is about. Solve times grew with that multiplicity and with
chain size — not with line count.

**Items/Credits discrete search (`solveCore`).** Every local-search probe calls `evalChoice`,
which recomputes the produced/consumed vectors from scratch over all N lines even though a move
changes one line's few coefficients. `repair`, `climb`, `minDeficitAtScore`, and `swapTargets`
try O(N·J) candidate moves per pass (~1,000 probes at 7 lines), and the ILS stagnation limits
(1200/8000 iterations) plus the feeder second pass multiply that into millions of probes per
stage. At real scale the per-probe waste factor is the line count itself (~7–10×), and totals are
driven by J (chain size) and iteration counts. Secondary costs in the same loops: `performance.now()` is sampled on **every**
checkpoint (every candidate job trial, and every coefficient while building the LP), and
`feasibleNow` calls `isMinedResource` (an array scan) per resource per check.

**Project mode (`projectSchedule` / `solveExecutableProjectPhase` / `optimizeProjectTop`).** The
makespan LP (~1.3k columns at 8 lines: lines × items × levels) is rebuilt and solved from scratch
many times per run — but *which* run matters, and the reference save's own Set & forget settings are
not the expensive one.

- **Line switching (`projLineMode: "split"`, the app default).** Every phase solves free
  (`js/solver.js:1366`) and pinned (`:1390`), inside up to 8 pre-produced-Bits fixed-point passes
  where only the LP's z-column moves (`:1320`), plus a second complete fixed-point pass whenever a
  stability policy is engaged (`:1686`), plus compression-fallback retries, plus — whenever
  prefer-current stabilized any phase — a hidden alternative run that doubles all of it. Measured on
  `project-split-7line`: 2,895 pivots, 50.4M dense work units. Nothing bounds them:
  `optimizeProjectTop` builds a solve control only when `projLineMode==="static"` (`:2356`), so this
  path has no deadline, no checkpoint accounting and no cancellation, and a user's budget cannot stop
  it (as much a WS3 finding as a WS2 one).
- **Sequenced Set & forget.** Adds one ordering-estimate LP per project — ~10 on the reference
  10-project list, against the 3 `lpMaximize` calls a combined-phase static run makes in total.
- **Static Set & forget, gating off (the reference save's own settings).** Not that shape at all.
  `staticSchedule` (`:1441`) returns `stabilized:false`, `stabilityKey:null` and
  `stabilityUpdate:null` unconditionally, and the stability re-run at `:1686` is guarded `!isStatic`,
  so line stability is never recorded in this mode and the hidden prefer-current comparison can never
  fire however many times the same factory is solved. The makespan LP is barely built at all:
  `project-7line` measures 0 `projectSchedule` calls and 3 `lpMaximize` calls. Its time is the
  discrete static search — the same `solveCore` hot loop as Items — plus, at budgets ≤4000 ms, an
  idle-line fill on a clock of its own. At the reference 20 s budget the search assigns every line,
  `putIdleLinesToWork` returns at its no-idle-rows guard, and no fill runs.

`lpMaximize` uses Bland's rule from the first pivot — the slowest anti-cycling rule — and most of the
Line switching solves are near-duplicates of each other.

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
  `js/solver.worker*.js` URL, and `replaceExactly` guarantees exactly one occurrence of the
  `new Worker("js/solver.worker.v2.js")` literal exists to rewrite. Note what that last one does
  *not* say: it pins the literal, not the number of construction paths (see N1).
- `scripts/release-smoke.cjs` counts requests against a served build, including the legacy
  immutable worker URLs kept for stale pages.
- CSP `connect-src 'self'` plus no `fetch` in solver code means a running Worker cannot generate
  requests at all; construction time is the only exposure.

### Invariants for any multi-Worker change (N1–N7)

These are requirements, not suggestions. WS3 implements them; every later change is bound by them.

- **N1 — Zero-network construction in production.** Pool Workers are constructed only through the
  single existing factory seam (the one `workerFactory` indirection in `solve-service.js`, rewritten
  by the build to the Blob bootstrap). The build does **not** enforce that today: `replaceExactly`
  (`scripts/build-static.cjs:137-143`) matches the string literal `new Worker("js/solver.worker.v2.js")`
  inside `defaultWorkerFactory` (`js/solve-service.js:236`) and asserts exactly one occurrence *of
  that literal*. `workerFactory` (`:237`) is a mutable test seam the build never touches, so a pool
  that added a second `workerFactory()` call site would pass the assertion silently. WS3 therefore
  adds the assertion that does hold: a count of `workerFactory()` call sites in the assembled bundle
  — exactly one today (`js/solve-service.js:373`) — failing the build on any other count.
- **N2 — One payload, one URL, page lifetime.** The Blob object URL is created lazily **once per
  page load** and shared by every pool Worker (~250 KB retained is acceptable). Respawn after
  termination reuses the same URL: zero allocations of new payloads, zero network. Today's bootstrap
  releases that URL from **four** independent triggers, and hoisting to page lifetime means removing
  all four: the `message` once-listener (`scripts/build-static.cjs:118`), the `error` once-listener
  (`:119`), the 60000 ms `setTimeout` backstop (`:120`, or a 0 ms one on the no-`addEventListener`
  path at `:121`), and `created.__forgeRelease=release` (`:116`), which `js/solve-service.js:254`
  invokes on **every** `terminateOwned()`. The fourth is the trap: under a shared URL it revokes on
  the first busy supersede and poisons every later construction. Revocation moves to page teardown or
  is dropped outright.
- **N3 — Bounded pool.** Size = `min(4, max(1, navigator.hardwareConcurrency - 1))`, with a
  runtime kill switch (localStorage flag) forcing size 1, which is exactly today's behavior. No
  persisted-state field.
- **N4 — Constructions are bounded by terminations.** Workers are persistent across solves. A new
  Worker is constructed only (a) filling the pool on first parallel use, or (b) replacing a Worker
  that was terminated because it was busy with a superseded generation or failed. Idle Workers are
  reused, never churned. Superseding an idle pool constructs nothing (`js/solve-service.js:360`
  already only terminates when busy, and `:373` only constructs when there is no Worker — keep both
  true). Two of today's termination paths sit outside that classification and the pool has to answer
  each:
  - **`cancel()` terminates busy slots only.** Today `cancel()` → `terminateOwned()`
    (`js/solve-service.js:264-268`) disposes an idle Worker unconditionally, and ordinary UI reaches
    it: every switch to Manual mode (`js/results.js:437`), import, import-rollback and reset
    (`js/events.js:336`, `:337`, `:346`), and `pagehide` (`:1187`). Multiplied by pool size that is K
    constructions per mode switch. Under the pool, `cancel()` terminates only the slots busy with the
    cancelled generation; idle slots survive and are reused. Page teardown still disposes everything.
  - **The idle late-error path stays unrated, and N7 is what bounds it.**
    `js/solve-service.js:325` — `if(!workerBusy||callback===null){terminateOwned();return;}` — disposes
    with no `workerFailures` increment and no `retryAfter`, so a Worker that dies after every delivery
    is reconstructed forever, unrated. That silence is deliberate (an error arriving after a
    successful delivery is not a failed solve) and is pinned by `test/solve-lifecycle.cjs:822-853`, so
    the pool keeps it. What changes is that the replacement construction it causes is counted, which
    makes N7's tripwire the only thing that bounds the loop.
- **N5 — Dev path may fetch only at pool fill.** Source-served dev keeps URL Workers with
  `importScripts`; a K-Worker pool may cost up to K×6 requests once per page load and must never
  fetch per solve. The same reuse rules apply.
- **N6 — Enforcement is automated, on the harness the repo already has.**
  - Build: existing assertions (no `importScripts`, no worker URL, the literal Worker-constructor
    rewrite) stay green, plus N1's `workerFactory()` call-site count and a new assertion that the
    bootstrap creates at most one object URL.
  - Node suite: one `.cjs` test built on the existing vm harness — the mechanism
    `test/static-asset-build.cjs` already uses — which builds the bundle, evaluates it in a vm realm
    with a stubbed `Worker`/`URL`, drives a supersede storm through `solve-service`, and asserts
    construction counts (≤ pool cap + observed busy-terminations), idle reuse across supersede and
    `cancel()`, exactly one object URL per realm, and no solver-source URL construction. Registered
    in `test/run-all.cjs`, so `npm test` runs it on every PR. No Playwright, no browser automation,
    no new dependency.
  - Release smoke (`scripts/release-smoke.cjs`, `npm run test:release`) keeps counting requests
    against a served build, including the legacy immutable worker URLs. It is **not** in CI today —
    `.github/workflows/verify.yml` runs `npm ci` + `npm test` only — so it is a maintainer step, and
    nothing that gates a PR may depend on it. That is why the vm test above, not the smoke script,
    carries N6.
- **N7 — Runtime tripwire on constructions.** The pool counts **constructions**, not failures or
  parallel dispatches; exceeding `4 × pool cap` within 10 minutes disables parallelism for the
  session (falls back to one Worker) and surfaces a notice. Counting constructions is what also
  bounds the size-1 late-error loop in N4 — that loop churns one Worker at a time, so disabling
  parallelism does nothing to it, but a construction ceiling stops it. The existing notice string
  (`js/solve-service.js:248`, "Background solver unavailable; using slower fallback.") would be false
  in this state — the Worker is still solving, just not in parallel — so the tripwire ships with new
  copy of its own. A bug can then degrade performance, never generate a request storm — and in
  production a storm is structurally impossible anyway (N1: construction has no network step).

## Workstreams

### WS0 — Measurement harness and fixture corpus (first, gates everything)

Build the evidence base before touching the solver.

- Fixture corpus under `test/perf/` (`corpus.cjs`): eight fixtures, every one a complete saved state
  derived by a deterministic edit from the single committed reference save
  `test/perf/fixtures/lategame-7line.json` (7 heterogeneous lines from 16384× down to 512×, every
  item priced, a 10-project list, Set & forget with gating off, 20 s budget), so there is no second
  copy of the reference numbers to drift out of sync and every fixture still loads through the
  Worker's own `validateWorkerState` boundary. They are: `items-7line` (the plain discrete search,
  one `solveCore` chain behind one user action); `items-share-margin-7line` (share mode + 5% margin —
  one calibration solve per checked output, every stage run twice); `items-8line` and `items-10line`
  (the planned expansion and the planning ceiling, added lines given distinct speeds so the DFS's
  identical-line symmetry skip stays as rare as it is on the real save); `credits-7line` (12
  baselines in catalog order, then fair refinement slices on one shared clock); `project-7line`
  (static Set & forget, gating off, the whole list as one phase); `project-seq-7line` (static,
  sequenced — the only shape that runs the per-project ordering-estimate LPs, and the only one that
  reaches the look-ahead fill with a non-empty queue); and `project-split-7line` (Line switching,
  prefer-current, measured warm so the hidden comparison is inside the measurement — the fixture the
  repeated near-identical-LP claim is about). Gaps are recorded in each fixture's notes in measured
  terms rather than implied away: at the reference 20 s budget `project-7line` runs no idle fill at
  all (fills appear only at budgets ≤4000 ms, where they park three lines on Reinforced Concrete,
  Bricks and Concrete), and neither Set & forget fixture ever banks a look-ahead on this save.
- Harness: runs `optimize()` per fixture with `makeSolveControl`'s existing `onCheckpoint` seam,
  emitting per-label work/elapsed histograms, LP pivot counts, component-solve counts, final
  objectives, and `capped`/`deadlineReached` flags as JSON into `test-results/`. It also meters
  `lpMaximize` directly, which is what makes `project-split-7line` measurable at all: that path
  builds no solve control (Background), so its work histogram is empty and its LP cost is read off
  the meter instead.
- Two work currencies, priced and reported separately. Probe work (one unit per checkpoint, the
  discrete search) and dense work (LP tableau cells, charged only inside `lpMaximize`) differ by
  ~280× in real time — ~500 units/ms across probe labels against ~140,000 units/ms for `lp-pivot`.
  Pooling them is not a neutral simplification: it hands the LP relaxation a share of every budget it
  does not take in reality (on `items-10line` the root LP's ~2.2M units would swallow the entire
  250 ms rung), and `work.total / seconds` moves 5.7× with budget alone on an unchanged solver, so it
  is never reported. A1's headline decomposes into
  `probeWork/probeWorkPerSec + denseWork/denseWorkPerSec`: both numerators are machine-independent,
  only the divisors are not, and each of the four factors names the workstream that moves it (WS1 the
  probe divisor, WS2 both dense terms, WS4 the probe numerator).
- Virtual runs versus wall runs, and what each cannot see. A virtual run buys its milliseconds with
  consumed work, so it is bit-reproducible and machine-independent — same objective, same total work,
  same per-label counts everywhere — and it keeps the time *shape* (deadlines, stagnation timers,
  Credits fair slicing) that freezing the clock would destroy. It is the deterministic proxy every
  gate reads. What it cannot measure is throughput: it is denominated in the very units WS1 makes
  cheaper, so cheaper probes are invisible to it. Throughput is `wall.probeWorkPerSec` on a wall run
  only — machine-dependent, drifting ~10% between node processes (the same order as the wins WS1 is
  asked for), therefore repeated with median/min/max and a coefficient of variation, and never a
  gate. Installing the checkpoint observer costs +4.4% on the search itself, so wall runs run
  un-instrumented and take their totals off the controls and the LP meter.
- Share-of-max fixtures gate on the plan, not the objective. In share mode `objective` is the plan
  divided by a calibration ceiling the solver itself searches for, and that ceiling improves with
  budget: an unchanged plan scores 0.876% lower at 20000 ms than at 4000 ms on
  `items-share-margin-7line`. A2's 0.1% tolerance applied to that number would fail an unchanged
  solver, so share-mode runs are gated per output on the absolute `result.out` vector instead.
- Baseline snapshot recorded and committed (`test/perf/baseline.json`) before WS1 merges; later PRs
  attach a before/after comparison.
- CI stance: the bench itself is opt-in (`npm run bench`), never part of `npm test`; what `npm test`
  carries is the harness self-test (`test/perf-harness.cjs`), which asserts that a virtual run's JSON
  is machine-independent. The baseline gates — plan/objective parity and work identity — are applied
  by `npm run bench -- --baseline` on the PR. Nothing gates on wall-clock, ever.

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
   units — bounded and machine-independent. The DFS has a **second** clock read that no checkpoint
   covers: `js/solver.js:564`, `const _n=control.readNow()`, driving the `convergeWindow` stall test
   at every node. `keepGoing` on the line above (`:563`) has already sampled on that same node, so
   `:564` reads the control's cached `currentTime()` (`:191`) instead of taking a second sample.
3. **Precomputed `needFrac` array.** Rebuilt when `curTol` changes (twice per margin solve),
   removing `isMinedResource` string scans from every feasibility comparison. Three call sites, not
   one: `feasibleNow` (`js/solver.js:328`), the DFS leaf test (`:567`), and the DFS **suffix prune**
   (`:574`), which runs at every internal node and per resource — so the win is per-node, not
   per-leaf, and the suffix prune is the larger half of it.
4. **Seed dedup.** Hash choice vectors before `localOpt`: the role enumeration (cap 350) and the LP
   roundings submit many duplicates. The collapse is not `jobLike` — that helper (`js/solver.js:393`)
   has exactly one caller, `swapTargets` at `:422`, and no seed path touches it. The clamps that
   actually map distinct role assignments onto the same vector are `roleJob`/`findIndex` returning
   -1 (`:672`, `:694`), where the role is simply not applied and the seed falls back to the
   all-targets vector, and `tgtSeed`'s `lvl<=8` rule (`:687`), which sends many lines to the same
   low-level craft.
5. **(Behind fixture parity) restricted repair candidate set.** Index jobs by produced resource;
   repair scans producers of currently-short resources plus moves on lines consuming them, instead
   of all N·J. This changes repair trajectories, so it lands separately, gated on corpus parity.

Invariant: identical search *semantics* for 1–4 — same probe order, same acceptances. It is stated
on the trajectory, not on the vectors. A relative agreement bound like 1e-12 is unachievable here and
would be the wrong bar anyway: the reference save's mined rows carry magnitudes around 1e12
(Hydracite trading income) and 1e99 (a Vespium rig), and 1e-12 relative on those sits orders of
magnitude above the −1e-7 **absolute** epsilon every feasibility comparison actually uses
(`js/solver.js:328`, `:567`, `:574`). What is asserted instead:

- **Identical local-search trajectory**, proved by virtual-run work-histogram equality: per-label
  checkpoint counts, LP pivot counts and component-solve counts reproduce the baseline exactly. That
  is the bench's work-identity gate, and it is a stronger statement than any float tolerance.
- **Verdict agreement on the delta path**: a property test runs delta and full-recompute side by side
  over randomized move sequences on every fixture and asserts the *decisions* match — `feasibleNow`'s
  verdict per resource and the EPS objective comparison per candidate — rather than the vectors'
  digits.
- **DFS depth may differ on wall runs.** Node counts there are clock-dependent by construction, so
  depth and node totals are compared only on virtual and work-limited runs.

WS1.2 legitimately moves the histogram at the low budget rungs (a deadline is noticed up to 256 work
units late), so it declares that and is compared with `--allow-work-change`, as WS1.5 already is.

Expected effect: probe cost drops from O(N) to O(1) — roughly the line count (7–10×) off the
dominant loops, with the clock and `needFrac` wins on top — which also means more ILS/second-pass
iterations inside the same iteration-based stagnation limits (a quality gain at unchanged
budgets).

### WS2 — LP engine (`lpMaximize` + Project-mode call sites)

1. **Pivot rule, at the `lpRelax` site only.** Dantzig (most-negative reduced cost) with automatic
   permanent switch to Bland after a degeneracy stall (no objective progress for a fixed pivot window
   or repeated basis signature), confined to the `solveCore` relaxation call
   (`js/solver.js:597-623`). Termination stays guaranteed; typical pivot counts drop several-fold.
   The pivot cap and atomic-pivot cancellation semantics stay. **The two makespan sites (`:1366`
   free, `:1390` pinned) keep Bland.** The makespan LP has alternate optima, and every consumer of it
   reads the *vertex*, not the objective: `:1403-1409` turns `y` into per-item `rate`, the per-line
   `plan` entries and the stability update. A pivot rule that lands on a different optimal vertex can
   hold z to 1e-15 and still move which line takes which job, and with it the reported project ETA.
   That also means the acceptance below — z within 1e-9 relative — is not sufficient on its own: it
   is the right check for `lpRelax` (a bound, read as a number), and no check at all for the makespan
   sites, which is exactly why the rule there does not change.
2. **Within-run LP memoization, keyed on the built tableau.** One `optimizeProjectTop` run in Line
   switching mode solves near-identical LPs repeatedly (fixed-point passes, the hidden alternative
   run's free solves, ordering estimates in sequenced mode). Memoize `lpMaximize` results in a
   per-run table keyed by a digest of `(c, A, b)` computed at the call site *after* the tableau is
   built, with an element-wise comparison against the stored arrays on digest hit before the memo is
   returned — so a collision costs a comparison, never a wrong optimum. A key assembled from
   caller-level inputs (net, avail, targets, flags, line signature) cannot be correct, because
   neither tableau builder is a function of its arguments: `buildScheduleLP` reads `S.forgie` and
   `S.minedIncome` through `forgieHr`/`minedBudgetHr` (`:1321`), and `projectSchedule` reads `S.lines`,
   `S.maxTurbo` and `S.dupe` via `sortedLines()` (`:1336`), `S.baseTime` via `craftTime`, `S.prodCost`
   twice — at `:1354` as a validity gate that drops the variable from the LP entirely and at `:1355`
   as its coefficient — `S.minedCost` at `:1357`, and `activeMinedResources` at `:1343`, which decides
   which rows exist at all. Hashing the arrays sees every one of those; enumerating them by hand does
   not. The table lives in the run, so cross-solve staleness is impossible.
3. **(Stretch) warm-started re-solves.** The blocker is not `b`. Across fixed-point passes `b` does
   not move: `buildScheduleLP` fills it from the constant 1 (`:1316`) and from
   `forgieHr`/`minedBudgetHr` (`:1321`), and what the Bits and stock terms actually change is
   `row[zCol]` (`:1320`) — one *column* of `A`. The real blocker is that `lpMaximize` keeps a dense
   tableau and no basis factorization: it returns `x` and drops `T` and `basis` (`:1307-1308`), so
   there is nothing to re-price a changed column against. Warm starting therefore means either
   replaying every pivot to rebuild the tableau (no saving) or writing a revised simplex with an
   explicit basis inverse — a new engine, not a tweak. Explicitly a stretch goal behind the memo win,
   and a dependency of nothing.

Acceptance: identical LP optima on the corpus at the `lpRelax` site (z within 1e-9 relative); an
unchanged pivot sequence at the makespan sites, whose acceptance is therefore unchanged behavior —
identical `plan` and `rate`, not a numeric tolerance on z; `project-split-7line` and
`project-seq-7line` pivot counts and repeated-solve counts drop in the bench JSON; hidden-comparison
runs no longer double free-solve time.

### WS3 — Worker pool (`solve-service.js`, build bootstrap, worker protocol)

#### Pool lifecycle

- `solve-service` grows from one owned Worker to a pool honoring N1–N7. The pool fills lazily on
  the first request that can use it. Engagement is by work shape, never line count (the game is
  7–10 lines across the board): a plain Items solve stays on one Worker; the pool engages where
  one user action fans out into many component solves — Credits comparisons (the reference save
  prices all 12 items), share-of-max calibration (one solve per checked output), and Project runs
  with a hidden prefer-current comparison (Line switching only; a static Set & forget run has no
  hidden comparison to parallelize).
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
previously exhausted, and ~pool-size speedups on calibration and on `project-split-7line`, the
hidden-comparison fixture; kill switch verified to restore exact single-Worker behavior.

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
   `capped:false` proofs inside the budget. The assignment space at 7 lines is still ~10^15, and
   the reference save's lines are all distinct profiles (the DFS's identical-line symmetry skip
   almost never fires), so proofs do not come free at real scale; whether this item pays is
   decided by Phase-0 `capped` rates on the corpus. Gated by an equivalence harness: on every corpus
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
WS2 → WS4), each rebasing on the previous merge. WS2 and WS4 additionally meet inside one function:
both edit `lpRelax` (`js/solver.js:597-623`) — WS2 for the pivot rule it solves with, WS4 for the
`needFrac`-parameterized margin relaxation — so WS4 rebases onto WS2 rather than developing beside
it.

WS3 is **not** file-disjoint from WS1. Two of its items edit `js/solver.js`: moving `_soloMaxCache`
(`:859`, keyed by `soloMaxKey` at `:861-867`, consumed in `mixWeights` at `:893`) to main-thread
ownership, and threading the shard descriptor down `optimize` (`:2378`) → `optimizeInner` (`:917`) →
`mixWeights` (`:893`) → `solveCore` (`:226`). WS3 therefore splits: the pool lifecycle, Blob
bootstrap, worker protocol, merge logic and enforcement tests (`js/solve-service.js`,
`scripts/build-static.cjs`, worker files, `test/`) run concurrently with WS1; the two `js/solver.js`
items queue behind WS1's merge. WS4 depends on WS1's delta-eval primitives by design, not just by
merge order.

Reviewer agents get fresh context and an explicit brief per workstream: for WS1, attempt to break
delta/full-recompute equivalence and EPS-anchoring; for WS3, attempt to construct a request-storm
or unbounded-construction scenario and verify N1–N7 close it; for WS4, attempt to produce a bound
below an achievable objective.

Verification gates on every PR, in order: `npm test` (syntax + node suites) and `npm run
test:parity`; workstream-specific new tests; bench comparison against the Phase-0 baseline
attached to the PR (informational for wall-clock, gating for plan/objective parity and work
identity); release smoke, run locally, for any PR touching the build or worker lifecycle — CI does
not run it.

## Acceptance criteria (project-level)

- **A1 — Speed.** On the reference-save Items fixture, time-to-baseline-objective drops ≥3× (≥5× on
  the 10-line expansion variant). The Project clause is measured on `project-split-7line` — Line
  switching with the hidden prefer-current comparison, the run that actually rebuilds the makespan LP
  (2,895 pivots / 50.4M dense units at baseline) — and asks for ≥40% off its dense work, read from
  the harness's LP meter rather than a clock, since that path carries no solve control. The Set &
  forget fixtures are held to what they actually do: `project-7line` to static-search probe work at
  the reference 20 s budget, where there is no hidden comparison, no makespan LP to speak of and no
  idle fill, and `project-seq-7line` to its ~10 per-project ordering-estimate LPs. Credits refines
  all 12 priced candidates within the reference 20 s budget where the baseline cannot.
- **A2 — Quality parity or better.** On every corpus fixture, final objective ≥ baseline − 0.1%
  (near-tie tolerance for float-trajectory drift); regressions beyond that block the PR. On the
  share-mode fixture the same tolerance is applied per output to the absolute `result.out` vector,
  not to `objective`, which is divided by a budget-sensitive calibration ceiling (WS0).
- **A3 — Network safety.** The gating check is N6's vm test in `npm test`: zero solver-source
  constructions after page load in the built bundle, at any pool size, under a supersede storm, with
  construction counts and one-object-URL asserted; build assertions extended (call-site count,
  single object URL) and green. Release smoke confirms the same against a served build as a
  maintainer step (`npm run test:release`), since CI does not run it.
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
  shape-based engagement keep small devices and simple solves on one Worker.
- **Warm starts need a different LP engine (WS2.3).** `lpMaximize` keeps no basis factorization to
  restart from, so the item is a revised-simplex rewrite wearing a small name. Explicitly a stretch
  goal; the memo + pivot-rule wins do not depend on it.
- **Bound validity (WS4).** Both new bounds are gated by never-below-achieved assertions across
  the corpus before they can prune.

## Open questions

- Pool engagement rules — which work shapes beyond Credits, calibration, and the hidden
  comparison benefit — settle empirically in WS3 from Phase-0 baselines.
- Whether Items-mode sharding is worth more than 2 Workers once WS1 lands (the hot loop may become
  cheap enough that calibration and Credits are the only pool beneficiaries that matter).
- Final wording of the margin-bound contract paragraph (WS4.2) — needs maintainer sign-off before
  implementation starts.
