"use strict";

const { test, expect } = require("@playwright/test");

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

const dialogCases = [
  { name: "Projects+Prices", opener: "#btnInputs", root: "#inputsModal", panel: "#inputsModal .modal", title: "#inputsTitle", initial: '#invRows [data-inv="Glass"]', done: "#inputsDone" },
  { name: "Lil' Forgie", opener: "#btnForgie", root: "#forgieModal", panel: "#forgieModal .modal", title: "#forgieTitle", initial: '#forgieRows [data-forgie="Glass"]', done: "#forgieDone" },
  { name: "Mined resources", opener: "#btnMined", root: "#minedModal", panel: "#minedModal .modal", title: "#minedTitle", initial: "#minedVespium", done: "#minedDone" },
  { name: "Settings", opener: "#btnSettings", root: "#settingsModal", panel: "#settingsModal .modal", title: "#settingsTitle", initial: "#solveBudget", done: "#settingsDone" },
  { name: "Track progress", opener: "#btnProgress", root: "#progModal", panel: "#progModal .modal", title: "#progTitle", initial: "#progDone", done: "#progDone" },
];

const inputTabs = [
  { name: "Inventory", tab: "#inputsInventoryTab", panel: "#inputsInventoryPanel", clear: "#projInvClear", initial: '#invRows [data-inv="Glass"]' },
  { name: "Projects", tab: "#inputsProjectsTab", panel: "#inputsProjectsPanel", clear: "#projClear", initial: "#projSeqToggle" },
  { name: "Sell prices", tab: "#inputsPricesTab", panel: "#inputsPricesPanel", clear: "#priceClear", initial: '#priceRows [data-price="Glass"]' },
];

async function openInputsTab(page, name = "Inventory") {
  await page.locator("#btnInputs").click();
  await expect(page.locator("#inputsModal")).toBeVisible();
  if (name !== "Inventory") await page.getByRole("tab", { name, exact: true }).click();
}

async function addProjectForProgress(page) {
  await openInputsTab(page, "Projects");
  await page.getByRole("button", { name: "+ New custom project", exact: true }).click();
  await page.locator("#inputsDone").click();
  await page.getByRole("button", { name: "Project plan", exact: true }).click();
  await expect(page.locator("#btnProgress")).toBeVisible();
}

async function open(page, dialog) {
  if (dialog.opener === "#btnProgress") await addProjectForProgress(page);
  await page.locator(dialog.opener).click();
  await expect(page.locator(dialog.root)).toBeVisible();
}

test("the header exposes exactly four planner actions in product order and no Crafting Data shortcut", async ({ page }) => {
  // Break caught: stale build buttons or the Crafting Data shortcut remain in the header and displace the four primary destinations.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tools > button")).toHaveText(["Projects+Prices", "Lil' Forgie", "Mined resources", "Settings"]);
  await expect(page.locator("#btnRecipes")).toHaveCount(0);
});

test("Settings owns every build-management action while its file input remains paired with Import", async ({ page }) => {
  // Break caught: Export, Import, Reset, or the backing file input stays in the header or becomes unreachable after the move.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#btnSettings").click();
  const section = page.locator("#settingsModal .build-management");
  await expect(section).toBeVisible();
  await expect(section.locator("#btnExport")).toBeVisible();
  await expect(section.locator("#btnImport")).toBeVisible();
  await expect(section.locator("#btnReset")).toBeVisible();
  await expect(section.locator("#fileImport")).toHaveCount(1);
  await expect(page.locator("header #btnExport, header #btnImport, header #btnReset, header #fileImport")).toHaveCount(0);
});

test("Projects+Prices opens one semantic dialog with Inventory active and the other panels natively hidden", async ({ page }) => {
  // Break caught: separate legacy dialogs survive or the consolidated opener lands on multiple visible input surfaces.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#btnInputs").click();
  await expect(page.locator("#inputsModal")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Projects+Prices", exact: true })).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveText(["Inventory", "Projects", "Sell prices"]);
  await expect(page.getByRole("tab", { name: "Inventory", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#inputsInventoryPanel")).toBeVisible();
  await expect(page.locator("#inputsProjectsPanel")).toBeHidden();
  await expect(page.locator("#inputsPricesPanel")).toBeHidden();
});

for (const keyboardCase of [
  { name: "ArrowRight advances and wraps", start: "Inventory", keys: ["ArrowRight", "ArrowRight", "ArrowRight"], expected: ["Projects", "Sell prices", "Inventory"] },
  { name: "ArrowLeft retreats and wraps", start: "Inventory", keys: ["ArrowLeft", "ArrowLeft"], expected: ["Sell prices", "Projects"] },
  { name: "Home selects the first tab", start: "Sell prices", keys: ["Home"], expected: ["Inventory"] },
  { name: "End selects the last tab", start: "Inventory", keys: ["End"], expected: ["Sell prices"] },
]) {
  test(`tab keyboard routing: ${keyboardCase.name} with one roving tabindex`, async ({ page }) => {
    // Break caught: a tab-key handler moves focus without activation, fails to wrap, or leaves multiple tabs in the page Tab order.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await openInputsTab(page, keyboardCase.start);
    const start = page.getByRole("tab", { name: keyboardCase.start, exact: true });
    await start.focus();
    for (let index = 0; index < keyboardCase.keys.length; index += 1) {
      await page.keyboard.press(keyboardCase.keys[index]);
      const selected = page.getByRole("tab", { name: keyboardCase.expected[index], exact: true });
      await expect(selected).toBeFocused();
      await expect(selected).toHaveAttribute("aria-selected", "true");
      await expect(selected).toHaveAttribute("tabindex", "0");
      expect(await page.getByRole("tab").evaluateAll(tabs => tabs.map(tab => ({ name: tab.textContent.trim(), tabIndex: tab.tabIndex })))).toEqual(
        inputTabs.map(tab => ({ name: tab.name, tabIndex: tab.name === keyboardCase.expected[index] ? 0 : -1 }))
      );
    }
  });
}

test("inactive Projects+Prices panels are excluded from sequential keyboard focus", async ({ page }) => {
  // Break caught: visually hidden Inventory or Sell-prices controls remain tabbable after Projects is selected.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openInputsTab(page, "Projects");
  await expect(page.locator("#inputsInventoryPanel")).toHaveAttribute("hidden", "");
  await expect(page.locator("#inputsPricesPanel")).toHaveAttribute("hidden", "");
  await page.locator("#inputsProjectsTab").focus();
  const visitedPanels = [];
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab");
    const panel = await page.evaluate(() => document.activeElement?.closest('[role="tabpanel"]')?.id || null);
    if (panel) visitedPanels.push(panel);
  }
  expect(new Set(visitedPanels)).toEqual(new Set(["inputsProjectsPanel"]));
});

test("direct Projects+Prices reopening restores the session-only last-used tab and its first editable control", async ({ page }) => {
  // Break caught: closing the dialog resets every direct open to Inventory or restores focus to a stale tab instead of its editable field.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openInputsTab(page, "Projects");
  await page.locator("#inputsDone").click();
  await page.locator("#btnInputs").click();
  await expect(page.getByRole("tab", { name: "Projects", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#projSeqToggle")).toBeFocused();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#btnInputs").click();
  await expect(page.getByRole("tab", { name: "Inventory", exact: true })).toHaveAttribute("aria-selected", "true");
});

for (const selected of inputTabs) {
  test(`${selected.name} exposes only its matching clear action beside the shared Done control`, async ({ page }) => {
    // Break caught: a clear button from an inactive tab can erase unrelated input data.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await openInputsTab(page, selected.name);
    await expect(page.locator("#inputsDone")).toBeVisible();
    for (const candidate of inputTabs) {
      if (candidate.name === selected.name) await expect(page.locator(candidate.clear)).toBeVisible();
      else await expect(page.locator(candidate.clear)).toBeHidden();
    }
  });
}

test("empty Project results open the real Projects editor and restore focus to their visible action", async ({ page }) => {
  // Break caught: the empty state tells the user to edit projects but provides no working context action, or closing returns focus to the header.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Project plan", exact: true }).click();
  const invoker = page.locator('#results [data-open-projects]');
  await expect(invoker).toBeVisible();
  await expect(invoker).toHaveAccessibleName("Edit projects");
  await invoker.click();
  await expect(page.getByRole("tab", { name: "Projects", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#projSeqToggle")).toBeFocused();
  await page.locator("#inputsDone").click();
  await expect(invoker).toBeFocused();
});

test("completed Project results retain the real Projects editor beside progress and restore its focus", async ({ page }) => {
  // Break caught: completing every configured project removes the only direct path for adding or editing another project.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openInputsTab(page, "Projects");
  await page.getByRole("button", { name: "+ New custom project", exact: true }).click();
  await page.locator("#inputsDone").click();
  await page.getByRole("button", { name: "Project plan", exact: true }).click();
  await expect(page.getByText("All projects complete 🎉", { exact: false })).toBeVisible();
  const invoker = page.locator('#results [data-open-projects]');
  await expect(invoker).toBeVisible();
  await expect(invoker).toHaveAccessibleName("Edit projects");
  await invoker.click();
  await expect(page.getByRole("tab", { name: "Projects", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.locator("#inputsDone").click();
  await expect(invoker).toBeFocused();
});

test("the Credits nudge forces Sell prices without overwriting the prior direct-open tab", async ({ page }) => {
  // Break caught: the nudge opens Projects, or its temporary route permanently destroys the user's last-used Projects context.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openInputsTab(page, "Projects");
  await page.locator("#inputsDone").click();
  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  await expect(page.locator("#btnInputs")).toHaveClass(/poke-on/);
  await page.locator("#btnInputs").click();
  await expect(page.getByRole("tab", { name: "Sell prices", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.locator("#inputsDone").click();
  await page.getByRole("button", { name: "Project plan", exact: true }).click();
  await expect(page.locator("#btnInputs")).not.toHaveClass(/poke-on/);
  await page.locator("#btnInputs").click();
  await expect(page.getByRole("tab", { name: "Projects", exact: true })).toHaveAttribute("aria-selected", "true");
});

function lifecycleCases(device) {
  for (const dialog of dialogCases) {
    test(`${device}: ${dialog.name} has a modal lifecycle that returns focus to its exact opener`, async ({ page }) => {
      // Break caught: bypassing the shared dialog controller leaves semantic dialogs, focus, or page lock inconsistent.
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await open(page, dialog);

      const panel = page.locator(dialog.panel);
      await expect(panel).toHaveAttribute("role", "dialog");
      await expect(panel).toHaveAttribute("aria-modal", "true");
      await expect(panel).toHaveAttribute("aria-labelledby", dialog.title.slice(1));
      await expect(page.locator(dialog.initial)).toBeFocused();
      expect(await page.evaluate(() => document.body.classList.contains("dialog-open"))).toBe(true);
      expect(await page.locator(".wrap").evaluate(node => node.inert)).toBe(true);

      await page.keyboard.press("Escape");
      await expect(page.locator(dialog.root)).toBeHidden();
      await expect(page.locator(dialog.opener)).toBeFocused();
      expect(await page.evaluate(() => document.body.classList.contains("dialog-open"))).toBe(false);
      expect(await page.locator(".wrap").evaluate(node => node.inert)).toBe(false);
    });
  }
}

test.describe("desktop dialog lifecycle", () => lifecycleCases("desktop"));
test.describe("mobile dialog lifecycle", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  lifecycleCases("mobile");
});

test("Projects+Prices traps Tab from shared Done to its close control", async ({ page }) => {
  // Break caught: a missing focus trap lets keyboard focus leave the consolidated dialog.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await open(page, dialogCases[0]);
  await page.locator("#inputsDone").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#inputsClose")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#inputsModal")).toBeHidden();
  await expect(page.locator("#btnInputs")).toBeFocused();
});

test("Projects+Prices traps Shift+Tab from its close control to shared Done", async ({ page }) => {
  // Break caught: reverse keyboard navigation escapes from the consolidated dialog.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await open(page, dialogCases[0]);
  await page.locator("#inputsClose").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#inputsDone")).toBeFocused();
});

for (const dialog of dialogCases) {
  test(`${dialog.name} Done control closes and restores its invoker`, async ({ page }) => {
    // Break caught: a controller-owned Done path stops restoring the control that opened this dialog.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await open(page, dialog);
    await page.locator(dialog.done).click();
    await expect(page.locator(dialog.root)).toBeHidden();
    await expect(page.locator(dialog.opener)).toBeFocused();
  });
  test(`${dialog.name} backdrop closes and restores its invoker`, async ({ page }) => {
    // Break caught: the overlay click path bypasses controller cleanup or focus restoration.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await open(page, dialog);
    await page.locator(dialog.root).click({ position: { x: 2, y: 2 } });
    await expect(page.locator(dialog.root)).toBeHidden();
    await expect(page.locator(dialog.opener)).toBeFocused();
  });
}

test("controller restores state when an onOpen callback throws", async ({ page }) => {
  // Break caught: a rendering exception leaves an invisible dialog on the stack and the page inert.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(() => {
    const root=document.createElement("div"),panel=document.createElement("div"),button=document.createElement("button"),preserved=document.createElement("div");
    preserved.inert=true;root.hidden=true;root.append(panel);document.body.append(button,preserved,root);button.focus();
    const api=dialogController.register({root,panel,opener:button,onOpen(){throw new Error("open boom");}});
    let error;try{api.open(button);}catch(e){error=e.message;}
    return {error,hidden:root.hidden,locked:document.body.classList.contains("dialog-open"),inert:document.querySelector(".wrap").inert,preserved:preserved.inert,focused:document.activeElement===button};
  });
  expect(result).toEqual({ error: "open boom", hidden: true, locked: false, inert: false, preserved: true, focused: true });
});

test("controller restores state and focus when an onClose callback throws", async ({ page }) => {
  // Break caught: a close callback exception leaves background inertness and scroll lock behind.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(() => {
    const root=document.createElement("div"),panel=document.createElement("div"),button=document.createElement("button"),preserved=document.createElement("div");
    preserved.inert=true;root.hidden=true;root.append(panel);document.body.append(button,preserved,root);button.focus();
    const api=dialogController.register({root,panel,opener:button,onClose(){throw new Error("close boom");}});
    api.open(button);let error;try{api.close();}catch(e){error=e.message;}
    return {error,hidden:root.hidden,locked:document.body.classList.contains("dialog-open"),inert:document.querySelector(".wrap").inert,preserved:preserved.inert,focused:document.activeElement===button};
  });
  expect(result).toEqual({ error: "close boom", hidden: true, locked: false, inert: false, preserved: true, focused: true });
});

test("only the top registered dialog handles Escape before focus returns to Projects+Prices", async ({ page }) => {
  // Break caught: a stack regression closes both dialogs or restores focus behind the remaining dialog.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const root = document.createElement("div"), panel = document.createElement("div"), button = document.createElement("button");
    root.id = "nestedDialogFixture";root.className = "modal-bg";root.hidden = true;
    panel.className = "modal";panel.setAttribute("role", "dialog");panel.setAttribute("aria-modal", "true");
    button.id = "nestedDialogFixtureDone";button.textContent = "Close nested fixture";button.setAttribute("data-dialog-close", "");
    panel.append(button);root.append(panel);document.body.append(root);
    window.__nestedDialogFixture = dialogController.register({ root, panel, opener: null, initialFocus: button });
  });
  await open(page, dialogCases[0]);
  await page.evaluate(() => window.__nestedDialogFixture.open(document.getElementById("inputsDone")));
  await expect(page.locator("#nestedDialogFixture")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#nestedDialogFixture")).toBeHidden();
  await expect(page.locator("#inputsModal")).toBeVisible();
  await expect(page.locator('#invRows [data-inv="Glass"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#inputsModal")).toBeHidden();
  await expect(page.locator("#btnInputs")).toBeFocused();
});

test("nested dialogs restore each body child's original inert state after the final close", async ({ page }) => {
  // Break caught: stack cleanup flattens both pre-existing inert and active body children to inert=false.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const states = await page.evaluate(() => {
    const preserved=document.createElement("div"),active=document.createElement("div");
    preserved.inert=true;
    const makeDialog=id=>{const root=document.createElement("div"),panel=document.createElement("div"),button=document.createElement("button");root.id=id;root.hidden=true;button.textContent=`Close ${id}`;panel.append(button);root.append(panel);return {root,api:dialogController.register({root,panel,opener:null,initialFocus:button})};};
    const first=makeDialog("inertStackFirst"),second=makeDialog("inertStackSecond");
    document.body.append(preserved,active,first.root);first.api.open();document.body.append(second.root);second.api.open();
    const nested={preserved:preserved.inert,active:active.inert,first:first.root.inert,second:second.root.inert};
    second.api.close();const underlying={preserved:preserved.inert,active:active.inert,first:first.root.inert,second:second.root.inert};
    first.api.close();const restored={preserved:preserved.inert,active:active.inert,first:first.root.inert,second:second.root.inert};
    return {nested,underlying,restored};
  });
  expect(states).toEqual({
    nested: { preserved: true, active: true, first: true, second: false },
    underlying: { preserved: true, active: true, first: false, second: true },
    restored: { preserved: true, active: false, first: false, second: false },
  });
});

test("opening an already-open underlying dialog does not duplicate its stack entry", async ({ page }) => {
  // Break caught: re-entering an underlying dialog lets the first close hide it while it remains on the stack.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const add=id=>{const root=document.createElement("div"),panel=document.createElement("div"),button=document.createElement("button");root.id=id;root.hidden=true;panel.append(button);root.append(panel);document.body.append(root);return dialogController.register({root,panel,opener:button,initialFocus:button});};
    window.__stackA=add("stackA");window.__stackB=add("stackB");
  });
  await page.evaluate(() => { window.__stackA.open(); window.__stackB.open(); window.__stackA.open(); });
  await page.keyboard.press("Escape");
  await expect(page.locator("#stackB")).toBeHidden();
  await expect(page.locator("#stackA")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#stackA")).toBeHidden();
});

test("Progress restores its re-rendered opener when the captured button disconnects", async ({ page }) => {
  // Break caught: an async results render disconnects Progress's invoker and leaves focus nowhere after close.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const progress=dialogCases[4];
  await open(page, progress);
  await page.evaluate(() => {const old=document.getElementById("btnProgress"),next=old.cloneNode(true);old.replaceWith(next);});
  await page.locator(progress.done).click();
  await expect(page.locator("#btnProgress")).toBeFocused();
});

test("Mined resources reopens at the title and body top after prior scrolling", async ({ page }) => {
  // Break caught: stale overlay/body scroll leaves Mined Resources reopened below its heading and close control.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const mined = dialogCases[2];
  await open(page, mined);
  await page.locator("#minedModal").evaluate(root => { root.scrollTop = 400; root.querySelector(".modal-b").scrollTop = 400; });
  await page.locator(mined.done).click();
  await open(page, mined);
  expect(await page.locator("#minedModal").evaluate(root => ({ overlay: root.scrollTop, body: root.querySelector(".modal-b").scrollTop }))).toEqual({ overlay: 0, body: 0 });
  await expect(page.locator("#minedVespium")).toBeFocused();
});
