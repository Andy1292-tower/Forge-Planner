# Forge Planner Solver Contract

This document separates what the planner guarantees from what it estimates. The solver runs in the browser, normally in a generated Blob Worker so longer searches do not block the interface.

## Result confidence

For a feasible optimized Items, Credits, or Project result, “best” means the best plan found within the applicable selected time budget unless the result explicitly says the relevant search was exhaustive. Manual assignments and blocked or analytical diagnostics make no best-plan claim. A bounded result is not a mathematical proof of optimality.

- `capped: true` means search ended before exhaustive proof.
- Items `deadlineReached: true` means the time budget ended the search, so a larger budget or faster hardware can still change the plan. This is the only bounded outcome the interface reports, because it is the only one the reader can act on.
- `capped: true` with `deadlineReached: false` means the search settled instead: it stopped improving with budget left over and returns that same plan at any larger budget. The size of the remaining gap does not distinguish the two outcomes and is not evidence of a weak plan.
- Items `bound` is the LP relaxation's ceiling on the objective, in the same per-hour units, and is never below the `objective` it bounds. With no margin set it relaxes strict feasibility. With a margin set it relaxes the may-work problem the margin defines instead: each ordinary resource need cover only the same `1 - margin` of its consumption the feasibility test asks for, the mined budgets stay at full strength because a mined budget is a hard burn rate no margin discounts, and every requested output keeps a strict link to the objective, so the ceiling bounds real net output rather than output measured at the discount. A margin `bound` therefore makes the same kind of promise the strict one makes, about a different problem: no plan that margin admits beats it. It sits above the ceiling the same factory reports with the margin off — that is the wider set of plans the margin admits, not a better factory — so two bounds taken at different margins are not comparable, and neither are the gaps quoted from them. It promises nothing about sustaining the plan: a may-work plan is permitted a standing paper shortfall, and relaxing that shortfall further cannot rule one out. `bound` is `null` when no completed relaxation applies, which means only that the search stopped before the relaxation for the requested margin finished. When `capped: true` and `bound` is present, no plan can beat the reported one by more than `(bound - objective) / bound`. That distance is an upper limit on what is missing, not a measure of it: the relaxation lets one line divide its time across several jobs, which no real line can do, so part of every gap is unreachable by construction and more requested outputs put more of it out of reach. A `capped: false` result is optimal whatever the bound says, because the ceiling stays loose even after the search proves the optimum.
- Credits `allCandidatesEvaluated: false` means one or more priced items did not receive a completed baseline; a displayed winner covers evaluated items only.
- Credits `searchExhaustive: false` with all candidates evaluated means every item received a baseline, but deeper search did not finish for at least one candidate.
- A feasible Project result is actionable only when its full replay is valid: `feasible`, `lpFeasible`, and `scheduleValidation.ok` must all be true and no first failure may remain.

Increasing the solve-time setting gives the search more opportunity; it does not promise that every device will explore the same amount of work or prove an optimum.

Credits refinements retain their last completed incumbent when a candidate reaches its local time slice. A local cutoff cannot erase that completed plan; the shared root deadline still ends the overall comparison and is reported truthfully.

## Modes

### Items

Items mode uses the enabled outputs and their mix numbers to maximize the shared weighted output floor. When a feasible solution exists, the numbers shape the output ratio; they do not turn the result into independent per-item maximums.

Two mix modes select which number each output contributes, and the mode is a solve input:

- **Ratio** asks for an output ratio counted in item units. An item whose ceiling is lower costs proportionally more to demand at the same number.
- **Share of max** asks for a percentage of what that output could reach with the whole factory dedicated to it. The planner measures each enabled output's dedicated ceiling with one single-target solve, converts to a ratio weight of `share x ceiling`, and reports the ceilings alongside the plan. Calibration shares the solve's time budget rather than adding to it, and is cached against the factory inputs so changing a share does not re-measure. An output with a zero ceiling cannot be made at all and is named in the result, because every output shares one floor and leaving such an output enabled holds all the others at zero.

The search itself is unchanged by the mix mode: both modes produce a ratio weight per output and hand the same weighted max-min problem to the same solver.

The result names which output is setting the floor and how much room each other output has above it. Slider positions do not map one-to-one onto plans: an output's achievable rate is quantized by whole line assignments, so a range of positions can legitimately produce the same plan.

Checking an output's own feeder as a second output is not a way to get more of the first one. Every constraint is the same whichever outputs are checked — a feeder is produced and consumed inside the plan either way — so any plan reachable with the feeder checked is reachable without it, at the same rate for the first output. What checking the feeder does change is where the search spends its effort, and the two runs are randomized anytime searches over the same feasible set, so a fraction of a percent either way is which run got luckier and not a real difference. A systematic gap is a search defect rather than a property of the factory; one such defect is fixed in `solveCore`'s second pass, which reaches plans that put a feeder on an otherwise idle line and move the output onto the line that freed up (issue #134).

### Credits

Credits mode ignores output checkboxes and priorities. It evaluates one dedicated whole-factory plan for each item with a sell price and ranks those candidates by credits per hour. It does not optimize a mixed sell portfolio. Winner-specific feasibility, capping, and May-work flags belong to the winning candidate; comparison completeness is reported separately.

### Project

Project mode converts the remaining selected levels into demand after completed levels and inventory. It respects the selected ordering controls, known catalog prerequisites/unlocks, cross-phase inventory carry, mined-income caps, and executable replay.

Two line-plan choices are supported:

- **Line switching** lets a line change jobs at replayed boundaries within a phase.
- **Set & forget** gives each busy line one job for the whole timed phase; lines reset only between listed phases. A bounded recovery may try lower compression ceilings, but only a replay-certified schedule can be shown as executable.

No plan in any mode may keep a line on a job it gains nothing from. A line is reported busy only when idling it would break the plan's feasibility or lower its objective; otherwise it is reported idle.

In **Set & forget**, under every project ordering, a phase's idle lines are put to work rather than left parked. Two passes try, in order: the phase's own remaining demand, latest-landing material first, and then — with projects still queued — a later project's direct costs, which cross-phase carry nets off that project's demand.

Both are free by contract, and that contract is about the phase. A filler may consume only what its phase leaves unused after both its own consumption and the rate each demanded material must be met at to land by the end of the phase. No busy line moves, the phase's full demand is still met, and its duration can only stay the same or fall — it falls where the search had been cut short holding a plan that parked a line. What a filler spends is the slack a material finishing early represents, so an individual material may come out later than it otherwise would, never later than the phase itself, in exchange for a line that was doing nothing at all. A fill is discarded if the filled phase no longer replays.

Frames and Wire may be filled like any other material. Both burn Bits outside the recipe graph, pre-produced before the phase runs, so a fill making either re-derives that obligation from the plan it produced and the phase reserves exactly what it now owes; a fill whose obligation the phase cannot already cover is dropped rather than billed to the player. Banking is limited to direct project costs, since held stock does not remove a Set & forget feeder job. Ordering is settled before any fill, so no fill can reshuffle the queue it banks for.

These passes are not funded out of the search. They spend the run's own control while it has time, and otherwise a separate bounded allowance — a quarter of the solve-time setting, at least 1.2 s — so a run may exceed that setting by up to that allowance, and only ever to put a line back to work. The allowance is per run, not per phase, and a phase whose clock ran out while later phases still need solving keeps its parked lines rather than spend what those searches need.

The step plan is ordered execution guidance only when replay validation succeeds. An analytical LP breakdown may remain visible for diagnosis when no executable schedule is available; it must not be followed as run instructions.

### Manual

Manual mode bypasses optimization. It evaluates the user's exact line assignments and labels resource balances as healthy, tight, or short. A negative ordinary-resource surplus means the setup is not self-sustaining.

## May-work margin

The May-work margin permits a small paper shortfall in Items/Credits search. When the selected result uses it, the plan is explicitly labeled **May-work** and is not guaranteed to sustain forever. Project replay and Manual balances remain concrete execution/balance checks rather than sustainability promises derived from the margin slider.

## Mined-resource budgets

Vespium and Hydracite are independent hard rate budgets:

- Gel consumes Vespium.
- Batteries consume Hydracite.
- Vespium Rig production is entered per minute and contributes `rigPerMin × 60` to the hourly Vespium cap.
- Resources & Trading Vespium is entered per second and contributes `resourcesTradingPerSec × 3600` to that same hourly Vespium cap.
- Resources & Trading Hydracite is entered per second and contributes `resourcesTradingPerSec × 3600` to the independent hourly Hydracite cap.
- One resource's unused budget cannot cover the other resource.
- Rocks are informational and are not substituted for either hard cap.

The planner reports mined usage separately from ordinary inventory because mined income is a rate, not stock carried between phases.

## Craft output and per-craft costs

Compression is a crafting tier. Most current recipes output exactly the compression amount per craft. Batteries have a base batch output of five, so they output `5 × compression`: 5 at 1×, 10 at 2×, 20 at 4×, and so on.

Ordinary recipe costs and mined-resource costs are paid once per craft cycle regardless of batch output. Compression retains its existing input-cost and craft-time scaling. Duplication multiplies output only; it does not multiply Wire, Gel, Vespium, Hydracite, or any other input consumption.

## Pre-produced Bits are intentional

Frames and Wire keep their established Bits requirement outside the ordinary line-allocation model. At `1×`, Frames require 8 pre-produced Bits per craft and Wire requires 2; compressed costs follow the same `3^level` input scaling as the corresponding craft. The planner reports or inserts that obligation as an external prerequisite.

This does not make all Bits external. Direct Bits targets remain craftable, and Glass still consumes line-produced Bits as an ordinary recipe input. Same-phase Bits production cannot satisfy a Project phase's external pre-produced-Bits obligation; the required stock must exist before that phase begins.

## Project warm-ups, buffers, and stability

Project schedules are replayed in time order. If an ordinary input would go negative at a switch boundary, the planner recursively builds a prerequisite warm-up where possible, carries its output forward, and replays the schedule. Warm-up time is included in the executable ETA. Required external Bits appear as a zero-duration prerequisite before line work.

**Prefer current line jobs** is a visible stability policy, not a hidden optimality guarantee. The pinned phase assignment may be retained when it remains within 5% of a fresh phase-throughput solve. Because changed jobs can add warm-ups or reorder work, the UI compares complete executable schedules before offering a “shorter” claim. **Re-optimize line jobs** requests fresh assignments instead.

Hidden comparisons, ordering estimates, and failed candidates do not mutate the visible stability cache. Only a successful visible executable run may commit its proposed remembered jobs.

## Stale results and Resimulate

Explicit **Resimulate** after crafter-line edits is intentional. Speed, turbo, line-cap, duplication, and related line-capacity edits can make a solve expensive, so the current result is marked out of date while edits are batched. Press **Resimulate** or Enter in a valid line field to accept a fresh result. Do not reintroduce solve-on-every-keystroke behavior as a “fix.”

Other accepted controls use their established automatic or debounced solve path. Invalid/incomplete drafts do not enter accepted state or trigger a solve.

The solve service accepts a Worker response only for the active generation, mode, and state revision. Mode changes, reset, import, and synchronous Manual rendering cancel obsolete work so an old response cannot replace the current screen.

## Intentional mechanics future reviews must preserve

- Frames/Wire pre-produced Bits are external only for those recipe obligations.
- Vespium and Hydracite have separate non-transferable budgets.
- Vespium sources aggregate with their declared `/min` and `/sec` units; Hydracite remains `/sec` and independent.
- Battery output is `5 × compression`, while every Battery input remains a per-craft cost and duplication remains output-only.
- Project inventory is carried and replayed across prerequisite, warm-up, and work phases.
- Prefer-current stability may trade local phase throughput for a shorter or less disruptive complete run.
- Explicit Resimulate for line-capacity edits is a deliberate user control.
- Bounded search language must remain qualified: best found within the time budget, not proven optimal.
