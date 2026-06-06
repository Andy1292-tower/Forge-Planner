# Forge Planner

A steady-state crafting-line optimizer for a power-law compression economy. Enter your own per-level stats (cost + time) for each input and craft, set your crafter line caps, pick the outputs you want, and it computes the optimal assignment that runs forever without starving, maximizing throughput at a priority-weighted output ratio.

Everything runs client-side.

## What it does

- **Inputs:** Ingots, Bits, Concrete (raw producers — time only)
- **Crafts:** Glass (←Bits), Bricks (←Concrete), Plates (←Ingots), Rods (←Ingots), Frames (←Plates + Rods; Bits pre-produced)
- **Per-line caps:** each crafter line has its own max compression, 1×–1024×
- **Multi-output:** select several outputs at once; the priority slider sets the *ratio* (higher = more of that one), and the solver maximizes the weighted floor so you always get a real mix
- **Persistence:** auto-saves to `localStorage`; Export/Import craftables stats as JSON

The solver is branch-and-bound with symmetry reduction over identical lines — instant at 5 lines, fine at 6+.
