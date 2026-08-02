# Forge Planner

A steady-state crafting-line optimizer for a power-law compression economy. Enter your own per-level stats (cost + time) for each input and craft, set your crafter line caps, pick the outputs you want, and it computes the optimal assignment that runs forever without starving, maximizing throughput at a priority-weighted output ratio.

Everything runs client-side.

## Verify changes

Use Node 24 and install the committed dependencies with `npm ci`.

```bash
npm test
npm run test:browser
```

`npm test` first checks JavaScript syntax, then runs the explicit fast Node-test list, including a fresh parity snapshot checked against `test/golden.json`. `npm run test:browser` serves the real static page, verifies its Worker result, exercises every planning mode, and fails on any console error or failed request.

## What it does

- **Inputs:** Ingots, Bits, Concrete (raw producers — time only)
- **Crafts:** Glass (←Bits), Bricks (←Concrete), Plates (←Ingots), Rods (←Ingots), Frames (←Plates + Rods; Bits pre-produced), Gel (←Vespium), Wire (←Gel + Rods), Reinforced Concrete (←Bricks + Concrete + Frames), Batteries (←Wire + Gel, plus Hydracite)
- **Mined income:** enter Vespium and Hydracite income separately; the planner budgets each resource independently for Gel and Batteries
- **Per-line caps:** each crafter line has its own max compression, 1×–16.4k×
- **Multi-output:** select several outputs at once; the priority slider sets the *ratio* (higher = more of that one), and the solver maximizes the weighted floor so you always get a real mix
- **Project plan + shopping list:** build named **projects** (each a list of levels, each level a set of item costs), enter your current inventory, and **Project plan** mode sums what's left to craft and lays out a complete pipelined schedule — either all projects together or one at a time (cheapest first, with "do first" projects pinned ahead). Choose whether small edits should preserve familiar line jobs within a 5% phase-throughput band or re-optimize them; the planner compares complete schedules because warm-ups and ordering can outweigh phase throughput. Accepts game notation (`1.2m`, `3.4qa`), and a **step-by-step** view gives the exact per-phase line setup.
- **Manual mode:** skip the solver and assign each line a resource and compression level by hand. A live resource-balance readout flags each input as healthy / tight / short, so you can build setups that aren't purely optimal but still sustain themselves.
- **Persistence:** auto-saves to `localStorage`; Export/Import craftables stats as JSON

The solver is branch-and-bound with symmetry reduction over identical lines — instant at 5 lines, fine at 6+.
