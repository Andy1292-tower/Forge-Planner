# Mined Resources and New Craftables Design

**Date:** 2026-08-01

**Status:** Approved

## Goal

Add Reinforced Concrete and Batteries as fully supported craftables, model Hydracite as an independently budgeted mined resource, move the existing Gel controls into a consolidated Mined Resources modal, and extend compression through 16,384x without changing established production mechanics or saved calibrations.

## Confirmed Mechanics

| Craftable | Ordinary inputs at 1x | Mined input at 1x | Base craft time at 1x |
| --- | --- | --- | ---: |
| Reinforced Concrete | 10,000 Bricks; 100,000 Concrete; 700 Frames | None | 355,531.88s |
| Batteries | 500 Wire; 100,000 Gel | 5,000,000,000,000 Hydracite | 1,034,274.56s |

Every compression tier keeps the existing formulas:

- Yield is the exact compression multiplier.
- Each ordinary and mined input cost is multiplied by `3^log2(compression)`.
- Craft time is multiplied by `1.5^log2(compression)`.
- Duplication increases output without increasing input consumption.
- Effective crafting speed retains the existing one-second cycle floor.

The two new exact compression values are `8192` and `16384`. The interface displays them as `8192x` and `16.4kx` respectively, using the multiplication-sign styling already used elsewhere (`8192×` and `16.4k×`). Internal calculations and saved state always retain the exact integer values.

## Product Model

Reinforced Concrete and Batteries join the central `PRODUCTS` collection and are classified as finished assemblies for presentation. This automatically makes them available to output targets, sell prices, Lil' Forgie, crafting-data calibration, custom project costs, inventory, credits mode, project mode, and Manual mode.

Ordinary craftable inputs remain in `RECIPE` and editable `prodCost` tables:

- Reinforced Concrete: Bricks, Concrete, Frames.
- Batteries: Wire, Gel.

Mined inputs remain separate from `RAWS` and `PRODUCTS`. They cannot be assigned to a crafter line, selected as an output target, or substituted for one another.

A shared descriptor in `js/core.js` defines each mined-input craft:

- Gel consumes Vespium as its hard-budget resource and Rocks as an informational unlimited cost.
- Batteries consumes Hydracite as its hard-budget resource in addition to its ordinary Wire and Gel inputs.

Vespium and Hydracite use distinct resource identities, state entries, solver constraints, usage summaries, and warnings. Vespium can only fund Gel crafts. Hydracite can only fund Battery crafts. A large Vespium income can therefore increase available Gel but can never satisfy or inflate the Hydracite side of Battery production.

## Persisted State and Migration

The authoritative state shape becomes:

```js
minedIncome: {
  Vespium: null,
  Hydracite: null
},
minedIncomeText: {
  Vespium: "",
  Hydracite: ""
}
```

`normalize()` migrates an older save's `gelVesp` and `gelVespText` values into the Vespium entries before removing the legacy fields. Existing custom line settings, base times, recipe costs, prices, targets, projects, inventory, and Manual presets remain unchanged. Missing Reinforced Concrete and Batteries data, Hydracite income fields, and 8192x/16384x compression costs are backfilled from defaults. Older exported builds continue to import through the same normalization path.

The state remains plain JSON so it can pass unchanged through local storage, export/import, and Web Worker structured cloning.

## Mined Resources Modal

The collapsible Gel card and the separate Gel ore-cost modal are replaced by one prominent **Mined resources** button in the header toolbar. It opens a centered modal using the application's existing modal design language and close behavior.

The modal contains two visually separate sections:

### Vespium / Gel

- Vespium-per-minute income field, preserving game-number notation and the existing explanatory tooltip.
- Existing maximum sustainable Gel-per-hour summary and recommended all-Gel line loadout.
- Compression breakout showing Rocks and Vespium per craft, fastest eligible current line time, and Rocks and Vespium needed per minute.

### Hydracite / Batteries

- Hydracite-per-minute income field with game-number notation.
- Compression breakout showing Hydracite per craft, fastest eligible current line time, and Hydracite needed per minute.
- Clear copy that actual Battery output also requires the full Wire and Gel pipeline. The modal does not show a misleading Hydracite-only Battery production ceiling.

The fields are independent. Editing one never changes, aliases, or derives the other. Income changes save immediately and schedule a background re-solve. Tables remain horizontally scrollable on narrow screens, and the modal closes through its close button, Done button, backdrop, or Escape key.

## Solver Behavior

### Items and Credits

The discrete solver adds a separate constrained resource for each mined input required by the active recipe chain:

- Vespium supply equals entered Vespium/minute multiplied by 60.
- Hydracite supply equals entered Hydracite/minute multiplied by 60.

Gel jobs consume only the Vespium constraint. Battery jobs consume ordinary Wire and Gel balances plus the Hydracite constraint. Both constraints may exist in the same solve and are enforced independently.

The user-configurable may-work margin continues to apply to craftable material balances, but it may not borrow against Vespium or Hydracite. Mined-income limits are hard caps.

The existing Gel loadout helper and Gel-specific reservation-style search seeds remain available to the integer solver even though their UI moves. LP seeding, deterministic role enumeration, iteration-based ILS stopping, time-bounded DFS, and result monotonicity remain intact. Batteries is added to the same product-chain search rather than introducing another reservation sweep.

### Project Mode

The project LP creates independent Vespium and Hydracite constraints when their dependent crafts are reachable. Missing-income diagnostics identify the blocked item and exact resource instead of reporting every mined-resource failure as a Gel problem.

Each phase carries its own mined-resource usage summary. Sequenced and waved projects retain phase-specific usage so later-phase Gel or Battery work is not hidden by a first-phase-only summary.

No new project-unlock relationships are added because no corresponding unlock projects or dependencies were supplied.

### Manual Mode

Manual assignments can select both new craftables. A Gel assignment records Vespium consumption; a Batteries assignment records ordinary Wire and Gel consumption plus Hydracite consumption.

The resource-balance table displays Vespium and Hydracite as mined income, not as Lil' Forgie passive production. Each receives its own income, consumption, surplus, and healthy/tight/short status. One mined resource cannot cover a deficit in the other.

### Worker and Results

Shared mined-resource metadata lives in `core.js` so the Web Worker loads the same definitions as the main page. Solver results expose generic mined usage by craft and resource while preserving established Gel search behavior.

User-facing plans show mined-resource consumption alongside ordinary inputs, name the exact missing income when a chain is blocked, and link guidance to the Mined resources button. Compression labels use one shared formatter across line caps, calibration, crafting data, mined-resource tables, result plans, project steps, and Manual mode.

## Error Handling and Compatibility

- Blank, invalid, or negative mined income is treated as off and never converted into another resource.
- A missing mined income makes the dependent craft unavailable unless existing passive production directly satisfies the relevant craftable requirement.
- Existing Gel-only saves and plans retain their prior Vespium values and mechanics after migration.
- Existing pre-produced Bits behavior for Frames and Wire is unchanged.
- Existing non-Gel scenarios must retain their prior output and plan behavior.
- The open Set & Forget PR overlaps solver and UI files; its state and diff must be checked again before final publication so this branch is not silently based on stale assumptions.

## Testing Strategy

Implementation follows test-driven development.

Automated tests will cover:

- Exact new base recipes and craft times.
- Exact `3^13`, `3^14`, `1.5^13`, and `1.5^14` scaling at 8192x and 16384x.
- Exact `16.4k×` display formatting while preserving the numeric `16384` value.
- Legacy `gelVesp` save migration and preservation of existing calibrated values.
- Zero, one, and both mined incomes.
- Independent Vespium and Hydracite hard caps, including may-work margin cases.
- Reinforced Concrete and Battery production in items, credits, project, and Manual modes.
- Full Battery feasibility through Wire, Gel, Vespium, and Hydracite simultaneously.
- Web Worker-safe state/result serialization.
- Existing parity, inventory, unlock, Forgie, raw-target, stock-risk, stability, and scale checks.
- Large-line-count Gel and Battery chains, preserving deterministic search seeds and non-worsening results at larger solve budgets.

The parity checker will also be corrected so scenario names containing `noGel` actually use the strict non-Gel comparison path.

Rendered QA will serve the app over HTTP so the real worker path runs. Desktop and mobile checks will cover modal layout, both independent inputs, cost tables, persistence after reload, compression labels, target/manual selection, plan warnings, console health, and background solve responsiveness.

## Delivery

All work stays on `feature/mined-resources-and-new-crafts` and ships in one pull request. Before publication, the branch will be checked against current `origin/main` and the overlapping open PR. The commit and pull-request title/body will describe only the product changes and verification.
