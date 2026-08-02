# Projects+Prices Toolbar and CI Design

**Date:** 2026-08-02

**Status:** Approved

## Objective

Reduce header clutter and eliminate the long Shopping list dialog without changing the planner's visual language, save format, solver, or simulation behavior. Move build-management actions into Settings, combine inventory/projects/sell prices into one tabbed dialog, and restructure GitHub Actions so independent verification lanes run concurrently and report all failures from a single commit.

## Header

The desktop toolbar contains exactly four equal-width actions in this order:

1. `Projects+Prices`
2. `Lil' Forgie`
3. `Mined resources`
4. `Settings`

The toolbar remains a single four-column row where the available width can support readable labels. At phone widths it becomes a two-by-two grid. At the existing extreme-width fallback it may become one column. The current colors, button treatment, typography, and general header composition remain unchanged.

The header `Crafting data` button is removed. The existing Crafting stats disclosure at the bottom of the page remains the only entry point for crafting data.

## Projects+Prices Dialog

`Projects+Prices` opens one semantic modal dialog with three tabs in this exact order:

1. Inventory
2. Projects
3. Sell prices

Only the selected tab panel is presented. The dialog retains the existing project-dialog width and fixed header/footer shell; only its body scrolls. This prevents the previous inventory-plus-projects endless scroll while preserving room for project cards.

The header button reopens the tab last selected during the current page session. The first direct header opening starts on Inventory. Existing contextual entry points remain specific:

- Credits-mode requests for missing prices open the dialog on Sell prices.
- Project-related entry points open the dialog on Projects.

The tablist follows the WAI-ARIA tabs interaction pattern:

- Every tab has `role="tab"`, `aria-selected`, `aria-controls`, and roving `tabindex`.
- Every panel has `role="tabpanel"` and `aria-labelledby`.
- Left/Right arrows move between tabs and activate the newly focused tab.
- Home activates Inventory; End activates Sell prices.
- Inactive panels are hidden and excluded from focus order.
- Closing the dialog restores focus to the exact element that opened it.

Existing field IDs and state behavior are preserved so this remains a presentation change:

- Inventory keeps `#invRows` and its existing inventory state.
- Projects keeps `#projList`, catalog controls, project toggles, stability policy, and custom-project controls.
- Sell prices keeps `#priceRows` and existing sell-price state.

Each tab exposes only its relevant secondary action:

- Inventory: `Clear inventory`
- Projects: `Clear projects`
- Sell prices: `Clear all` prices

The dialog has one shared `Done` action. No clear action changes its existing confirmation or state-mutation behavior.

The missing-sell-prices attention nudge moves from the removed Sell prices header button to `Projects+Prices`. Activating that nudged button opens Sell prices, even if another tab was previously selected.

## Settings and Build Management

Settings retains Max solve time and adds a visually separated `Build management` section containing:

- `Export build`
- `Import`
- `Reset`

The existing button IDs and handlers remain, so export format, import validation, reset confirmation, state persistence, and solver cancellation behavior do not change. The hidden file input remains available to both Settings and the rejected-save recovery action.

Because Settings is modal, any export/import failure that needs the page-level recovery alert must first close Settings. The recovery alert then receives focus on the active page rather than behind an inert dialog. The recovery alert's own import action continues to open the hidden file picker directly. Dismissing recovery restores focus to the visible Settings header button rather than attempting to focus Import inside a closed dialog.

## Responsive and Accessibility Requirements

- Four desktop header actions must not overlap, clip, or introduce page-level horizontal overflow.
- The phone toolbar is a readable two-by-two grid, not four crushed columns.
- The dialog header, tabs, and footer remain reachable at 320px width and short viewport heights.
- Only the dialog body scrolls vertically.
- Inventory and price rows retain their narrow-screen stacked layout.
- Project identity and project tools retain the existing `720px` responsive handoff.
- Dialog focus trapping, Escape, backdrop close, Done close, background inertness, and focus restoration continue to use the shared dialog controller.
- Axe checks must pass for the default page and every selected tab.

## CI Architecture

The `Verify` workflow gains concurrency cancellation for superseded runs from the same pull request or ref.

Independent work runs concurrently:

- `node`: installs dependencies and runs `npm test`.
- `playwright` matrix with `fail-fast: false`:
  - `browser`: `npm run test:browser`
  - `accessibility`: `npm run test:a11y`
  - `visual`: `npm run test:visual`
  - `release`: `npm run test:release`

Every Playwright matrix child performs checkout, Node 24 setup with npm cache, `npm ci`, and Chromium installation. Failing children upload uniquely named lane artifacts. The visual child always uploads `visual-release-matrix` and treats missing release-matrix screenshots as an error.

A final job with the exact check name `verify` uses `if: always()` and depends on both `node` and the complete Playwright matrix. It succeeds only when both dependencies report success. This preserves the existing expected merge-gate name while ensuring every independent lane reports in the same run.

The expected green wall time is approximately 2.5 to 3 minutes instead of the observed 6 minutes 44 seconds, subject to GitHub runner availability.

## Verification

Implementation is test-first. Coverage must prove:

- Header action presence, order, desktop four-column geometry, mobile two-by-two geometry, and absence of the header Crafting data button.
- Settings contains working Export, Import, and Reset actions.
- Invalid import/export recovery is never hidden behind an inert Settings dialog.
- The combined dialog has correct semantics, tab keyboard behavior, last-used behavior, contextual routing, focus trapping, and focus restoration.
- All three panels fit the existing responsive and overflow contracts at the release viewport matrix.
- Existing inventory, projects, prices, Credits nudge, persistence, validation, and state-recovery flows still work.
- The CI workflow contract enforces concurrency cancellation, one owner per command, all four matrix lanes, `fail-fast: false`, unique artifacts, strict visual evidence, and a final always-running `verify` aggregator.
- Full Node/parity, browser behavior, accessibility, visual layout, and release-upgrade suites pass on the exact branch head.

## Non-Goals and Delivery Constraints

- No visual redesign.
- No solver or worker changes.
- No save-schema, migration, default-value, or simulation changes.
- No changes to project or sell-price meaning.
- No local Chrome launch; browser verification runs through the existing GitHub-hosted Playwright workflow to avoid repeating the previously reported local Chrome crashes.
- Changes remain on `codex/adversarial-remediation-continuation-v2` in draft PR #96.
- Do not push directly to `main` and do not merge without explicit user approval.
