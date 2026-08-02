# Project Catalog Contract

`js/catalog.js` is the shipped, read-only source for premade Shopping-list projects. It is planning data, not proof that the values match a particular current game build.

## Provenance status

The repository does not currently contain a trusted source artifact that can establish the catalog's game version, export date, source hash, or last verified update date. The machine-readable `PROJECT_CATALOG_METADATA` therefore records:

```json
{
  "schemaVersion": 1,
  "status": "unverified",
  "sourceType": "unknown",
  "gameVersion": null,
  "exportedAt": null,
  "sourceSha256": null,
  "updatedAt": null,
  "verified": false
}
```

Do not infer or fill those fields from a commit date, issue comment, remembered game version, or generated values. For the documented catalog and prerequisite shapes, structural validation checks safe use by the current catalog consumers and internal coherence. It is not a defense against arbitrary JavaScript objects and does not verify game quantities.

## Entry shape

Each `PROJECT_CATALOG` entry contains:

| Field | Contract |
| --- | --- |
| `catId` | Stable, unique ID: a letter first, then letters, digits, `_`, or `-`, at most 64 characters. Do not rename an existing ID without a migration because saved builds reference it. |
| `name` | Nonempty, trimmed player-facing name, at most 256 characters. |
| `description` | Player-facing text, at most 2,048 characters; an empty string is allowed. |
| `levels` | Nonempty array with at most 256 levels. Array position is the one-based project level. |
| `levels[].costs` | At most 64 `{ item, qty }` entries. An item may appear only once within a level. |
| `item` | A known ordinary item from `ALLITEMS`. Vespium/Hydracite rate costs are derived through craft mechanics, not entered as project cost items. |
| `qty` | Finite number from `0` through `1e100`. Zero is valid catalog data. |

The catalog, each `levels` array, and each `costs` array must be dense: every numeric index through `length - 1` must be an own data property. Each project, level, and cost node must use one of the validator's two exact known plain-object prototypes (the loaded catalog realm or the Node test realm), and required fields must also be own data properties. Sparse slots, accessor-backed slots or fields, `null`, arrays used as nodes, null-prototype objects, chained null prototypes, and custom prototypes are rejected so malformed data cannot skip validation and then fail during normalization.

`PROJECT_PREREQS` maps a dependent catalog ID to catalog IDs that must finish before it. Each enumerable mapping value must be an own data property containing a dense array whose numeric slots are own data properties. Non-array or accessor-backed values and sparse or accessor-backed entries are rejected and omitted from the sanitized adjacency used for cycle detection. Every key and target must resolve, duplicates/self-dependencies are invalid, and the validated graph must remain acyclic. `UNLOCKS` maps a catalog ID to the material it unlocks; each key and item must resolve, and a material may have only one catalog unlock owner. These edges participate only when the relevant projects are selected and still have remaining levels in the current Shopping-list solve.

## Updating the catalog

1. Obtain a trusted game/save export for the intended game build. Preserve the original artifact unchanged.
2. Record the exact game version shown by the source, the artifact/export timestamp, and its SHA-256. If any value is unavailable, leave it `null` and keep the status unverified.
3. Generate `{ catId, name, description, levels }` entries from the artifact. The browser-console transform documented at the top of `js/catalog.js` is a starting point, not verification by itself.
4. Keep existing `catId` values stable. Compare additions/removals and every changed level against the source; do not extrapolate quantities from neighboring levels unless the game artifact explicitly supplies that rule.
5. Update `PROJECT_PREREQS` and `UNLOCKS` only from confirmed unlock relationships.
6. Set provenance fields to non-null values only when the retained artifact supports them. Mark `verified: true` only after an independent source-to-catalog comparison.
7. Run:

   ```bash
   node test/catalog-validation.cjs
   npm test
   ```

8. In the PR, identify the retained source artifact and review method. Do not add exact game-value assertions to `test/catalog-validation.cjs`; that test protects structure, supported ranges, references, and dependency integrity.

Catalog-backed saved projects are refreshed from the shipped entry during normalization. A catalog correction therefore affects future solves for previously saved `catId` projects; call that out explicitly in the PR.
