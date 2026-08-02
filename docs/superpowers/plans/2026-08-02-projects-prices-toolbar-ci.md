# Projects+Prices Toolbar and Parallel CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded header and long Shopping list/Sell prices dialogs with a four-action toolbar, Settings-based build management, and one accessible `Projects+Prices` tabbed dialog, while making GitHub verification parallel and fail-complete.

**Architecture:** Preserve all state objects, field IDs, rendering functions, and solver entry points. Consolidate only dialog ownership: one controller owns Inventory, Projects, and Sell prices, while compatibility wrappers select the correct tab. GitHub Actions runs Node and four Playwright lanes independently, then an always-running `verify` job aggregates their results.

**Tech Stack:** Static HTML, CSS, browser JavaScript, Node.js 24 contract tests, Playwright 1.62, Axe, GitHub Actions.

## Global Constraints

- Header label is exactly `Projects+Prices`; order is `Projects+Prices`, `Lil' Forgie`, `Mined resources`, `Settings`.
- Tabs are exactly `Inventory`, `Projects`, `Sell prices` in that order.
- First direct opening selects Inventory; later direct openings select the last-used tab for this page session.
- Credits prompts select Sell prices; project-specific callers select Projects.
- Export build, Import, and Reset move into Settings without changing their behavior.
- Crafting data remains through `#recipeToggle`; remove only its header shortcut.
- Preserve the current visual language, 700px project-dialog width, state objects, content IDs, clear actions, and confirmations.
- No solver, worker, simulation, save-schema, migration, or default-value changes.
- Do not launch a local GUI browser. Browser execution happens only on GitHub-hosted Playwright.
- Keep work on `codex/adversarial-remediation-continuation-v2` and draft PR #96. Do not push to or merge `main`.
- Do not add AI, Claude, or Codex attribution to commits, PR text, or public comments.

---

### Task 1: Parallel, fail-complete GitHub verification

**Files:**
- Modify: `test/ci-workflow.cjs`
- Modify: `.github/workflows/verify.yml`

**Interfaces:**
- Consumes: package scripts `test`, `test:browser`, `test:a11y`, `test:visual`, `test:release`.
- Produces: jobs `node`, `playwright`, final `verify`; matrix lanes `browser`, `accessibility`, `visual`, `release`.

- [ ] **Step 1: Extend the CI contract test before changing the workflow**

Add a `jobBlock(source, name)` helper and assertions equivalent to:

```js
assert.match(workflow, /^concurrency:\n[\s\S]*?cancel-in-progress: true$/m);
const nodeJob = jobBlock(workflow, "node");
const playwrightJob = jobBlock(workflow, "playwright");
const verifyJob = jobBlock(workflow, "verify");
assert.match(nodeJob, /run: npm test/);
assert.match(playwrightJob, /fail-fast: false/);
for (const lane of ["browser", "accessibility", "visual", "release"])
  assert.match(playwrightJob, new RegExp(`- lane: ${lane}\\b`));
assert.match(playwrightJob, /playwright-\$\{\{ matrix\.lane \}\}-artifacts/);
assert.match(verifyJob, /needs: \[node, playwright\]/);
assert.match(verifyJob, /if: always\(\)/);
assert.match(verifyJob, /needs\.node\.result/);
assert.match(verifyJob, /needs\.playwright\.result/);
```

Retain unique command-owner assertions. Scope visual-evidence assertions to its upload step. Add negative mutations for a removed lane, `fail-fast: true`, missing final `if: always()`, relaxed `if-no-files-found`, and non-unique failure artifact names.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `node test/ci-workflow.cjs`

Expected: FAIL because the serialized workflow has no concurrency, matrix, or aggregator.

- [ ] **Step 3: Implement the parallel workflow**

Required shape:

```yaml
concurrency:
  group: verify-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  node:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm test

  playwright:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - { lane: browser, command: "npm run test:browser" }
          - { lane: accessibility, command: "npm run test:a11y" }
          - { lane: visual, command: "npm run test:visual" }
          - { lane: release, command: "npm run test:release" }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Run ${{ matrix.lane }} lane
        run: ${{ matrix.command }}
      - name: Upload visual release-matrix evidence
        if: always() && matrix.lane == 'visual'
        uses: actions/upload-artifact@v4
        with:
          name: visual-release-matrix
          path: test-results/**/release-matrix-*.png
          if-no-files-found: error
      - name: Upload Playwright failure artifacts
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-${{ matrix.lane }}-artifacts
          path: |
            playwright-report/
            test-results/
          if-no-files-found: ignore

  verify:
    name: verify
    runs-on: ubuntu-latest
    if: always()
    needs: [node, playwright]
    steps:
      - name: Require every verification lane
        env:
          NODE_RESULT: ${{ needs.node.result }}
          PLAYWRIGHT_RESULT: ${{ needs.playwright.result }}
        run: test "$NODE_RESULT" = success && test "$PLAYWRIGHT_RESULT" = success
```

- [ ] **Step 4: Run GREEN checks and commit**

Run: `node test/ci-workflow.cjs && npm test`

Expected: exit 0; all Node scripts pass.

```bash
git add .github/workflows/verify.yml test/ci-workflow.cjs
git commit -m "Parallelize verification lanes"
```

---

### Task 2: Four-action toolbar and Settings build management

**Files:**
- Modify: `test/browser/dialogs.spec.js`
- Modify: `test/browser/state-recovery.spec.js`
- Modify: `test/browser/solve-lifecycle.spec.js`
- Modify: `test/browser/visual-layout.spec.js`
- Modify: `index.html`
- Modify: `css/styles.css`
- Modify: `js/events.js`

**Interfaces:**
- Consumes: `#btnExport`, `#btnImport`, `#fileImport`, `#btnReset`, `settingsDialog`, state recovery.
- Produces: header opener `#btnInputs`; Settings-owned build-management actions; desktop four-column and phone two-by-two toolbar.

- [ ] **Step 1: Write browser expectations before production changes**

Add expectations equivalent to:

```js
await expect(page.locator(".tools > button")).toHaveText([
  "Projects+Prices", "Lil' Forgie", "Mined resources", "Settings",
]);
await expect(page.locator("#btnRecipes")).toHaveCount(0);
await page.locator("#btnSettings").click();
await expect(page.locator("#settingsModal #btnExport")).toBeVisible();
await expect(page.locator("#settingsModal #btnImport")).toBeVisible();
await expect(page.locator("#settingsModal #btnReset")).toBeVisible();
```

Add geometry checks for one four-button row at 1440px and a two-by-two grid at 390px. Update Reset tests to open Settings first.

- [ ] **Step 2: Confirm RED selectors are absent without launching a browser**

Run: `npm run check:syntax && ! rg -n "btnInputs|build-management" index.html`

Expected: exit 0 because production selectors do not exist yet. Hosted browser RED is captured before this task's production commit is accepted as green.

- [ ] **Step 3: Move controls and replace header markup**

Use exactly:

```html
<div class="tools">
  <span class="saveind" id="saveind" role="status" aria-live="polite" aria-atomic="true"></span>
  <button class="btn primary" id="btnInputs">Projects+Prices</button>
  <button class="btn primary" id="btnForgie">Lil' Forgie</button>
  <button class="btn primary" id="btnMined">Mined resources</button>
  <button class="btn ghost" id="btnSettings">Settings</button>
</div>
```

Move `#btnExport`, `#btnImport`, and `#fileImport` into a separated Build management section below solve time. Retain IDs and handlers. Remove `#btnRecipes` and its listener; keep `#recipeToggle`.

- [ ] **Step 4: Add responsive styling**

Use these contracts, adjusting desktop width only if hosted geometry proves overflow:

```css
.tools{grid-template-columns:repeat(4,minmax(0,1fr));width:536px}
.settings-section{margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
.settings-section-title{margin-bottom:8px;font-size:10.5px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:var(--ink3)}
.settings-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
@media(max-width:560px){
  .tools{grid-template-columns:repeat(2,minmax(0,1fr));width:100%}
  .settings-actions{grid-template-columns:minmax(0,1fr)}
}
@media(max-width:260px){.tools{grid-template-columns:minmax(0,1fr)}}
```

- [ ] **Step 5: Keep page recovery reachable from Settings**

Extend `showStateRecovery` to accept an explicit invoker. Route export-validation and import parse/validation/read failures through:

```js
function showSettingsRecovery(raw,reason,file){
  if(!document.getElementById("settingsModal").hidden)closeSettings();
  showStateRecovery(raw,reason,file,document.getElementById("btnSettings"));
}
```

Keep recovery's Try another import action wired directly to `#fileImport`. Replace the hidden `#btnImport` dismissal fallback with visible `#btnSettings`.

- [ ] **Step 6: Run non-browser checks and commit**

Run: `npm run check:syntax && npm test`

Expected: exit 0.

```bash
git add index.html css/styles.css js/events.js test/browser/dialogs.spec.js test/browser/state-recovery.spec.js test/browser/solve-lifecycle.spec.js test/browser/visual-layout.spec.js
git commit -m "Clean up planner toolbar and build settings"
```

---

### Task 3: Consolidated accessible Projects+Prices dialog

**Files:**
- Modify: `test/browser/dialogs.spec.js`
- Modify: `test/browser/accessibility.spec.js`
- Modify: `test/browser/field-validation.spec.js`
- Modify: `test/browser/persistence.spec.js`
- Modify: `test/browser/import-security.spec.js`
- Modify: `index.html`
- Modify: `css/styles.css`
- Modify: `js/events.js`

**Interfaces:**
- Consumes: `renderInv`, `renderProjects`, `renderCatalog`, `renderPrices`, `dialogController`, `#btnInputs`.
- Produces: `#inputsModal`, `selectInputsTab(name, options)`, `openInputs(invoker, requestedTab)`, compatibility wrappers `openPrices` and `openProjects`.

- [ ] **Step 1: Write tab behavior tests first**

Require one dialog and three tabs:

```js
await page.locator("#btnInputs").click();
await expect(page.locator("#inputsModal")).toBeVisible();
await expect(page.getByRole("tab")).toHaveText(["Inventory", "Projects", "Sell prices"]);
await expect(page.getByRole("tab", { name: "Inventory" })).toHaveAttribute("aria-selected", "true");
await expect(page.locator("#inputsInventoryPanel")).toBeVisible();
await expect(page.locator("#inputsProjectsPanel")).toBeHidden();
await expect(page.locator("#inputsPricesPanel")).toBeHidden();
```

Add separate tests for Right/Left/Home/End, roving `tabindex`, last-used reopening, inactive-panel focus exclusion, shared Done focus restoration, per-tab clear visibility, Credits routing to Sell prices, and project callers routing to Projects. Each test name states the break it catches.

- [ ] **Step 2: Confirm RED selectors are absent**

Run: `! rg -n "inputsModal|inputsInventoryTab|selectInputsTab" index.html js/events.js`

Expected: exit 0 because production support is not present.

- [ ] **Step 3: Replace separate price/project dialogs with one shell**

Create `#inputsModal` at `max-width:700px` with heading `Projects+Prices`, one tablist, three tab panels in its scrolling body, and one footer. Tab markup:

```html
<div class="inputs-tabs" role="tablist" aria-label="Projects and prices sections">
  <button type="button" id="inputsInventoryTab" role="tab" aria-selected="true" aria-controls="inputsInventoryPanel" tabindex="0">Inventory</button>
  <button type="button" id="inputsProjectsTab" role="tab" aria-selected="false" aria-controls="inputsProjectsPanel" tabindex="-1">Projects</button>
  <button type="button" id="inputsPricesTab" role="tab" aria-selected="false" aria-controls="inputsPricesPanel" tabindex="-1">Sell prices</button>
</div>
```

Move `#invRows` into `#inputsInventoryPanel`, current project controls and `#projList` into `#inputsProjectsPanel`, and `#priceRows` into `#inputsPricesPanel`. Preserve `#projInvClear`, `#projClear`, and `#priceClear`; the selected panel's clear action is visible beside shared `#inputsDone`.

- [ ] **Step 4: Implement one controller and explicit selection**

Use session-only state, never saved state:

```js
const INPUT_TABS=Object.freeze({
  inventory:{tab:"inputsInventoryTab",panel:"inputsInventoryPanel",clear:"projInvClear",initial:()=>document.querySelector("#invRows input")},
  projects:{tab:"inputsProjectsTab",panel:"inputsProjectsPanel",clear:"projClear",initial:()=>document.getElementById("projSeqToggle")},
  prices:{tab:"inputsPricesTab",panel:"inputsPricesPanel",clear:"priceClear",initial:()=>document.querySelector("#priceRows input")},
});
let activeInputsTab="inventory";
function selectInputsTab(name,{focus=false}={}){
  const selected=INPUT_TABS[name]?name:"inventory";
  activeInputsTab=selected;
  Object.entries(INPUT_TABS).forEach(([key,meta])=>{
    const on=key===selected;
    const tab=document.getElementById(meta.tab);
    tab.setAttribute("aria-selected",on?"true":"false");
    tab.tabIndex=on?0:-1;
    document.getElementById(meta.panel).hidden=!on;
    document.getElementById(meta.clear).hidden=!on;
  });
  if(focus)document.getElementById(INPUT_TABS[selected].tab).focus();
}
```

On open, render inventory, projects, catalog, and prices, then apply `activeInputsTab`. Initial focus is the active panel's first editable control, falling back to its tab. `openPrices(invoker)` selects `prices`; `openProjects(invoker)` selects `projects`; direct `#btnInputs` uses `activeInputsTab`. Wire wrapping ArrowLeft/Right plus Home/End on the tablist, activating and focusing together.

- [ ] **Step 5: Add accessible tab styling**

Use the existing mode-switch palette, borders, uppercase type, and selected colors for three equal columns. Keep the three tabs within 320px without horizontal scrolling. Inactive panels use native `hidden`.

- [ ] **Step 6: Migrate consuming tests and commit**

Update price/project/inventory setup in field validation, persistence, import security, accessibility, and dialog lifecycle tests to open `#btnInputs` and select the named tab. Remove old `#priceModal`, `#projModal`, `#btnPrices`, `#btnProjects`, `#priceDone`, and `#projDone` expectations.

Run: `npm run check:syntax && npm test`

Expected: exit 0.

```bash
git add index.html css/styles.css js/events.js test/browser/dialogs.spec.js test/browser/accessibility.spec.js test/browser/field-validation.spec.js test/browser/persistence.spec.js test/browser/import-security.spec.js
git commit -m "Combine projects inventory and sell prices"
```

---

### Task 4: Context routing, nudge, and remaining consumer migration

**Files:**
- Modify: `js/events.js`
- Modify: `test/browser/dialogs.spec.js`
- Modify: `test/browser/solve-lifecycle.spec.js`
- Modify: `test/browser/state-recovery.spec.js`
- Modify: `test/stability-ui.cjs`
- Modify: `docs/reviews/2026-08-02-hardening-release-verification.md`

**Interfaces:**
- Consumes: Task 3 `selectInputsTab`, `openInputs`, `openPrices`, `openProjects`.
- Produces: price nudge on `#btnInputs`; every project/price caller routed to its tab; updated stability slice.

- [ ] **Step 1: Add routing and recovery regressions first**

Add tests that select Projects, close, enter Credits with no prices, activate the nudged `Projects+Prices`, and observe Sell prices. Exercise visible project-specific entry paths and observe Projects. Cause invalid import from Settings and prove Settings is hidden, recovery is visible/focused, `.wrap` is not inert, dismiss restores `#btnSettings`, and Try another import still targets `#fileImport` without reopening Settings.

- [ ] **Step 2: Run the current stability source test RED**

Run: `node test/stability-ui.cjs`

Expected: FAIL after old `#projModal` markup is removed and before its slice targets `#inputsProjectsPanel`.

- [ ] **Step 3: Retarget nudge and stale consumers**

Move nudge positioning/pulsing to `#btnInputs`. While the nudge is active, direct activation selects Sell prices; after the nudge clears, direct activation returns to normal last-used behavior.

Run: `rg -n "btnPrices|btnProjects|priceModal|projModal|priceDone|projDone" js test index.html`

Expected after migration: no production/test hits except historical documentation being deliberately updated in this task.

- [ ] **Step 4: Update stability test and review documentation**

Point `test/stability-ui.cjs` at the Projects panel in `#inputsModal`. Update the hardening review's semantic-dialog count and replace separate Sell prices/Shopping list entries with Projects+Prices.

- [ ] **Step 5: Run Node suite and commit**

Run: `node test/stability-ui.cjs && npm test`

Expected: exit 0.

```bash
git add js/events.js test/browser/dialogs.spec.js test/browser/solve-lifecycle.spec.js test/browser/state-recovery.spec.js test/stability-ui.cjs docs/reviews/2026-08-02-hardening-release-verification.md
git commit -m "Finish Projects+Prices routing migration"
```

---

### Task 5: Hosted responsive, accessibility, and release verification

**Files:**
- Modify: `test/browser/visual-layout.spec.js`
- Modify: `test/browser/accessibility.spec.js`
- Modify: any browser spec with a stale dialog selector

**Interfaces:**
- Consumes: Tasks 1-4 behavior and workflow.
- Produces: exact-head GitHub-hosted evidence for Node, browser, accessibility, visual, release, and final `verify`; updated draft PR #96.

- [ ] **Step 1: Complete release-matrix coverage before acceptance**

List only `#inputsModal`, `#forgieModal`, `#minedModal`, `#settingsModal`, `#progModal` as semantic dialogs. For `#inputsModal`, select Inventory, Projects, and Sell prices in turn and run overflow/action-reachability checks for each.

Cover four equal desktop header columns; phone two-by-two geometry; all panels at 320, 390, 560, 640, 900, 1024, 1440; body-only vertical scrolling; existing project-card containment through 720/721; Axe on Settings and all three tabs.

- [ ] **Step 2: Run every non-browser check locally**

Run: `npm test`

Run: `git diff --check`

Expected: both exit 0.

- [ ] **Step 3: Commit final browser coverage**

```bash
git add test/browser
git commit -m "Cover Projects+Prices responsive behavior"
```

- [ ] **Step 4: Push and observe hosted verification**

Push `codex/adversarial-remediation-continuation-v2`. Do not merge. Require success from `node`, all four Playwright matrix lanes, and final `verify`. If a lane fails, inspect only that lane's artifact, add a regression for the specific defect, fix it, run non-browser checks, and push once more.

- [ ] **Step 5: Inspect screenshots and exact-head PR state**

Inspect generated 1440px items, 880px project, 640px Projects+Prices, 390px Projects+Prices, and 320px manual screenshots. Confirm no overlap, clipping, cramped controls, or hidden actions. Verify PR #96 remains draft/CLEAN against `main` and the successful workflow SHA equals `git rev-parse HEAD`. Update PR text without AI attribution.
