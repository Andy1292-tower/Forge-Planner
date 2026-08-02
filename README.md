# Forge Planner

A browser-based crafting-line planner for a power-law compression economy. Enter your per-level costs and times, crafter caps, and goals; Forge Planner returns the best plan it finds within your selected solve-time budget. A bounded result is not a proof of optimality, and a plan using the optional May-work margin can include a disclosed paper shortfall.

Calculations, autosaves, imports, and exports stay in the browser. The page loads its existing typefaces from Google Fonts, but the generated app contains no analytics integration or planner backend and does not place planner state in those requests.

## Verify changes

Use Node 24 and install the committed dependencies with `npm ci`.

```bash
npm test
npm run test:browser
```

`npm test` first checks JavaScript syntax, then runs the explicit fast Node-test list, including a fresh parity snapshot checked against `test/golden.json`. `npm run test:browser` serves the real static page, verifies its Worker result, exercises every planning mode, and fails on any console error or failed request.

For a GUI preview, build and serve the production files, then open either listed address in your browser:

```bash
npm run preview
```

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/Forge-Planner/`

The preview rebuilds `dist/` and serves the same generated release at both mounts. Run the release checks with:

```bash
npm run test:release
npm run test:release -- --grep @cold
npm run test:release -- --grep @warm-upgrade
```

The cold check opens release B on a fresh origin at both mounts. The warm-upgrade check first caches an intentionally incompatible release A, swaps the same origin to release B, and requires coherent B HTML, app code, and Blob-Worker results without re-requesting A or unchanged immutable assets.

## What it does

- **Inputs:** Ingots, Bits, Concrete (raw producers — time only)
- **Crafts:** Glass (←Bits), Bricks (←Concrete), Plates (←Ingots), Rods (←Ingots), Frames (←Plates + Rods; Bits pre-produced), Gel (←Vespium), Wire (←Gel + Rods), Reinforced Concrete (←Bricks + Concrete + Frames), Batteries (←Wire + Gel, plus Hydracite)
- **Mined income:** enter Vespium and Hydracite income separately; the planner budgets each resource independently for Gel and Batteries
- **Per-line caps:** each crafter line has its own max compression, 1×–16.4k×
- **Multi-output:** select several outputs at once; priority weights shape the shared weighted-output floor. The result reports when constraints are infeasible or the bounded search did not finish an exhaustive proof.
- **Project plan + shopping list:** build named **projects** (each a list of levels and item costs), enter inventory, and ask **Project plan** mode for a replay-validated schedule. One-at-a-time ordering applies known unlocks first, then numeric order, then estimated completion time. Choose whether small edits preserve familiar line jobs within a 5% phase-throughput band or re-optimize them; complete-run comparisons include warm-ups and ordering. The **step-by-step** view is execution guidance only for a replay-valid schedule; blocked results retain a labeled analytical breakdown for diagnosis.
- **Manual mode:** skip optimization and assign each line a resource and compression level. The live balance readout labels ordinary inputs healthy, tight, or short.
- **Persistence and recovery:** auto-saves the complete schema-v3 build to `localStorage`, retains a previous-good backup, and provides GUI recovery for rejected saves. Export/Import covers the complete accepted build—not only crafting data—including lines, recipes, prices, projects, inventory, settings, and Manual presets.
- **Browser evidence:** automated browser, accessibility, visual, and release-upgrade gates currently run in Playwright Chromium. Other modern browsers may work but are not an equivalent release gate yet.

The solver runs in a generated Blob Worker with a configurable 200 ms–60 s budget, so the interface remains responsive. Simple searches can finish early; larger searches may return a clearly labeled best-found bounded result.

Operator contracts: [state schema](docs/STATE_SCHEMA.md), [solver behavior](docs/SOLVER_CONTRACT.md), [catalog provenance](docs/CATALOG.md), and [release/rollback](docs/RELEASING.md).
