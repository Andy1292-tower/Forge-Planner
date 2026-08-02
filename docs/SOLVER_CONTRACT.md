# Forge Planner Solver Contract

This document separates what the planner guarantees from what it estimates. The solver runs in the browser, normally in a generated Blob Worker so longer searches do not block the interface.

## Result confidence

For a feasible optimized Items, Credits, or Project result, “best” means the best plan found within the applicable selected time budget unless the result explicitly says the relevant search was exhaustive. Manual assignments and blocked or analytical diagnostics make no best-plan claim. A bounded result is not a mathematical proof of optimality.

- `capped: true` means search ended before exhaustive proof.
- Credits `allCandidatesEvaluated: false` means one or more priced items did not receive a completed baseline; a displayed winner covers evaluated items only.
- Credits `searchExhaustive: false` with all candidates evaluated means every item received a baseline, but deeper search did not finish for at least one candidate.
- A feasible Project result is actionable only when its full replay is valid: `feasible`, `lpFeasible`, and `scheduleValidation.ok` must all be true and no first failure may remain.

Increasing the solve-time setting gives the search more opportunity; it does not promise that every device will explore the same amount of work or prove an optimum.

## Modes

### Items

Items mode uses the enabled outputs and their priority weights to maximize the shared weighted output floor. When a feasible solution exists, the weights shape the output ratio; they do not turn the result into independent per-item maximums.

### Credits

Credits mode ignores output checkboxes and priorities. It evaluates one dedicated whole-factory plan for each item with a sell price and ranks those candidates by credits per hour. It does not optimize a mixed sell portfolio. Winner-specific feasibility, capping, and May-work flags belong to the winning candidate; comparison completeness is reported separately.

### Project

Project mode converts the remaining selected levels into demand after completed levels and inventory. It respects the selected ordering controls, known catalog prerequisites/unlocks, cross-phase inventory carry, mined-income caps, and executable replay.

Two line-plan choices are supported:

- **Line switching** lets a line change jobs at replayed boundaries within a phase.
- **Set & forget** gives each busy line one job for the whole timed phase; lines reset only between listed phases. A bounded recovery may try lower compression ceilings, but only a replay-certified schedule can be shown as executable.

The step plan is ordered execution guidance only when replay validation succeeds. An analytical LP breakdown may remain visible for diagnosis when no executable schedule is available; it must not be followed as run instructions.

### Manual

Manual mode bypasses optimization. It evaluates the user's exact line assignments and labels resource balances as healthy, tight, or short. A negative ordinary-resource surplus means the setup is not self-sustaining.

## May-work margin

The May-work margin permits a small paper shortfall in Items/Credits search. When the selected result uses it, the plan is explicitly labeled **May-work** and is not guaranteed to sustain forever. Project replay and Manual balances remain concrete execution/balance checks rather than sustainability promises derived from the margin slider.

## Mined-resource budgets

Vespium and Hydracite are independent hard rate budgets:

- Gel consumes Vespium.
- Batteries consume Hydracite.
- Each entered per-minute income is converted to an independent per-hour cap.
- One resource's unused budget cannot cover the other resource.
- Rocks are informational and are not substituted for either hard cap.

The planner reports mined usage separately from ordinary inventory because mined income is a rate, not stock carried between phases.

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
- Project inventory is carried and replayed across prerequisite, warm-up, and work phases.
- Prefer-current stability may trade local phase throughput for a shorter or less disruptive complete run.
- Explicit Resimulate for line-capacity edits is a deliberate user control.
- Bounded search language must remain qualified: best found within the time budget, not proven optimal.
