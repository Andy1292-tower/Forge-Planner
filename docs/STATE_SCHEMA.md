# Forge Planner State Schema

This document describes the build data that Forge Planner accepts, stores, imports, and exports. The executable sources of truth are `js/fields.js` and `js/state.js`; update this document with them.

## Current format

- Current schema version: `4`
- Primary browser-storage key: `forgePlannerState_v3`
- Previous-good backup key: `forgePlannerState_v3_previous_good`
- Rejected payload key: `forgePlannerState_v3_rejected`
- Rejection-reason key: `forgePlannerState_v3_rejected_reason`
- Export filename: `forge-build.json`

Despite the historical storage-key suffix, `schemaVersion` inside the JSON is the authoritative format version. Export writes the complete accepted planner build, not only crafting-data fields.

## What an export contains

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Integer format version. Current exports write `4`. |
| `lines[]` | Crafter lines: supported compression cap (`max`), displayed speed (`spx`), and current turbo stacks (`turbo`). |
| `maxTurbo`, `dupe` | Global maximum turbo stacks and duplication percentage. |
| `prodCost`, `baseTime`, `baseTimeRev` | Ordinary recipe costs at each supported compression, per-item base craft times, and their migration revision. Mined costs remain code-defined mechanics. |
| `margin`, `mode`, `solveBudget` | May-work margin, selected mode, and bounded solve-time setting. |
| `sellPrice`, `priceText` | Accepted sell prices plus the user's display drafts. |
| `forgie`, `forgieText` | Accepted Lil' Forgie rates plus display drafts. |
| `minedIncome`, `minedIncomeText` | Source-aware Vespium and Hydracite income values plus matching display drafts. |
| `targets` | Per-item enabled state, ratio weight, and share-of-maximum percentage. |
| `targetMode` | Which of those two numbers an Items solve reads: `ratio` or `share`. |
| `targetSaved[]`, `targetActiveId` | Named output sets and the ID of the set most recently loaded or saved. |
| `projects[]` | Catalog or custom projects, level costs, active range, completion count, numeric order, and the `_open` card-disclosure state. |
| `inventory`, `inventoryText` | Current ordinary-item stock plus display drafts. |
| `projectSeq`, `projectGate` | Project ordering and one-phase choices. |
| `projectStability`, `projLineMode` | Prefer-current versus re-optimize policy, and line-switching versus set-and-forget scheduling. |
| `planStart` | Required current-schema key containing a nullable epoch-millisecond display anchor for Project clock times. It does not change elapsed solve durations. |
| `manual[]` | Current Manual-mode job, compression, and sell flag for each line. |
| `manualSaved[]`, `manualActiveId` | Named Manual presets and the selected preset ID. |

Catalog-backed projects retain their `catId`, user range, completion, activation, and order. On normalization, their name, description, and level costs are refreshed from the current shipped catalog. Custom projects retain their exported level data.

### Saved output sets

A `targetSaved[]` entry is `{id, name, mode, config}`, where `config` lists only the checked outputs as `{item, w, share}`. Applying a set clears every checkbox first, so an item the set does not name is off afterwards regardless of its previous state. Each item may appear at most once per set, and the shared 128-preset ceiling applies.

A set records the mix mode it was saved in, and loading one restores that mode. The same figure means different things in each — `w` is a demanded ratio in item units, `share` is a percentage of the item's own ceiling — so a set restored without its mode would silently ask a different question than the one that was saved.

`targetSaved` and `targetActiveId` are additive: a build written before they existed imports with no saved sets rather than being rejected, and every other accepted schema keeps its own required fields.

`targetMode`, `targets.*.share`, and a saved set's `mode` and `config[].share` are likewise additive. A build written before the share-of-maximum mode existed imports as the ratio build its numbers were always meant as, with default percentages, rather than being rejected or re-read as percentages.

### Mined-resource source units

Schema 4 stores the unit in each source property's name:

```json
{
  "minedIncome": {
    "Vespium": {
      "rigPerMin": null,
      "resourcesTradingPerSec": null
    },
    "Hydracite": {
      "resourcesTradingPerSec": null
    }
  },
  "minedIncomeText": {
    "Vespium": {
      "rigPerMin": "",
      "resourcesTradingPerSec": ""
    },
    "Hydracite": {
      "resourcesTradingPerSec": ""
    }
  }
}
```

Every source and matching display-text leaf is required in a schema-4 build, although a numeric source may be blank (`null`). The effective independent hourly budgets are:

```text
Vespium/hour = max(0, rigPerMin) × 60
              + max(0, resourcesTradingPerSec) × 3600

Hydracite/hour = max(0, resourcesTradingPerSec) × 3600
```

Vespium cannot satisfy a Hydracite requirement, and Hydracite cannot satisfy a Vespium requirement.

## Validation boundaries

Imports are data, not executable configuration. The validator requires ordinary JSON data properties, rejects accessors/non-plain objects, and builds a fresh defaults-based state rather than trusting or mutating the imported object.

Important limits include:

| Boundary | Accepted range |
| --- | --- |
| Import file | At most 2 MiB |
| Object depth | At most 10 |
| Crafter lines | 1–64 |
| Projects | At most 128 |
| Levels per project | At most 256 |
| Costs per level | At most 64 |
| Total project levels / costs | At most 4,096 / 32,768 |
| Manual presets | At most 128 |
| Display drafts | At most 128 characters |
| IDs | 1–64 characters; a letter first, then letters, digits, `_`, or `-` |
| General amounts | Finite, `0` through `1e100`; blank only where the field permits it |
| Solve time | Integer milliseconds from `200` through `60000` |
| May-work margin | `0` through `20` percent |
| Duplication | `0` through `100` percent |

Compression values must be one of the levels declared in `LEVELS`. Item names must resolve through `ALLITEMS`. Current-version project ranges and Manual compression choices are rejected when inconsistent; they are not silently rewritten.

## Import, migration, and recovery

The accepted inputs are current schema `4`, schemas `1`, `2`, and `3`, and recognized unversioned shapes containing `lines`, `prodCost`, and `targets`. Schema 2 retains its original strict project-stability and unique-project-ID validation. Unknown/future versions and truncated lookalikes are rejected instead of guessed.

Schemas 1–3 store scalar per-minute values at `minedIncome.Vespium` and `minedIncome.Hydracite`. Those scalar leaves are validated under their original rules before conversion. During migration:

- Vespium moves to `Vespium.rigPerMin`, retaining its display text;
- Vespium Resources & Trading starts blank;
- Hydracite moves to `Hydracite.resourcesTradingPerSec` after division by 60;
- Hydracite display text is regenerated from the converted per-second number;
- legacy `gelVesp` and `gelVespText` move to the Vespium Rig source.

The conversion preserves the effective hourly budgets. A schema-3 build containing `{Vespium: 120, Hydracite: 60}` becomes 120 Vespium/min and 1 Hydracite/sec, retaining 7,200 Vespium/hour and 3,600 Hydracite/hour.

Schema 3 raised the fresh/reset solve-time default to 10 seconds. Unversioned, schema-1, and schema-2 saves still receive that one-time value during migration. A schema-3 save has already passed that migration, so its exact accepted 200–60,000ms choice is preserved when it becomes schema 4.

Import is transactional:

1. Parse and validate into a new state.
2. Render the candidate state.
3. Persist it while retaining the previous accepted state as a backup.
4. If validation, rendering, or persistence fails, restore the prior state and storage pair.

At startup, an invalid stored build does not brick the GUI. Forge Planner starts from safe defaults, preserves the rejected text and reason, and offers **Download rejected save** and **Try another import**. A valid previous state is retained separately as the previous-good backup.

Successful migration keeps using the historical `forgePlannerState_v3` keys. Before writing migrated schema-4 JSON to the primary key, startup rotates the exact accepted pre-migration primary bytes to `forgePlannerState_v3_previous_good`. A successful migration does not create or alter rejected-state records.

When adding schema `5` or later, update defaults and `FIELD_SCHEMA`, add an explicit migration in `validateAndMigrate`, retain transactional rollback, and add current/legacy/future-version fixtures before changing `CURRENT_SCHEMA_VERSION`.

## Not persisted in the build

Solver results, active Worker requests, generation tokens, solve overlays, active dialog/focus state, and the internal line-job stability cache are runtime-only. Project card `_open` is intentionally persisted, but it and `planStart` are display-only and omitted from solve equivalence. `targetSaved` and `targetActiveId` are persisted and likewise omitted: only `targets` is a solve input, so naming or deleting a set never discards a running solve. The Worker receives a complete cloned accepted state so it can use the same strict schema boundary as import and persistence; the optimizer does not consume those display-only values. The chosen stability policy is persisted; the cached prior assignment is not.

Planner state is local-first. The shipped app has no planner backend or analytics payload. It still loads a font stylesheet and font files from Google Fonts, so a browser makes ordinary third-party font requests; planner state is not placed in those request URLs or bodies.
