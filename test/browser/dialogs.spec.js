"use strict";

const { test, expect } = require("@playwright/test");

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

const dialogCases = [
  { name: "Sell prices", opener: "#btnPrices", root: "#priceModal", panel: "#priceModal .modal", title: "#priceTitle", initial: '#priceRows [data-price="Glass"]', done: "#priceDone" },
  { name: "Lil' Forgie", opener: "#btnForgie", root: "#forgieModal", panel: "#forgieModal .modal", title: "#forgieTitle", initial: '#forgieRows [data-forgie="Glass"]', done: "#forgieDone" },
  { name: "Mined resources", opener: "#btnMined", root: "#minedModal", panel: "#minedModal .modal", title: "#minedTitle", initial: "#minedVespium", done: "#minedDone" },
  { name: "Settings", opener: "#btnSettings", root: "#settingsModal", panel: "#settingsModal .modal", title: "#settingsTitle", initial: "#solveBudget", done: "#settingsDone" },
  { name: "Shopping list", opener: "#btnProjects", root: "#projModal", panel: "#projModal .modal", title: "#projTitle", initial: "#projSeqToggle", done: "#projDone" },
  { name: "Track progress", opener: "#btnProgress", root: "#progModal", panel: "#progModal .modal", title: "#progTitle", initial: "#progDone", done: "#progDone" },
];

async function open(page, dialog) {
  if (dialog.opener === "#btnProgress") {
    await page.locator("#btnProjects").click();
    await page.getByRole("button", { name: "+ New custom project", exact: true }).click();
    await page.locator("#projDone").click();
    await page.getByRole("button", { name: "Project plan", exact: true }).click();
    await expect(page.locator("#btnProgress")).toBeVisible();
  }
  await page.locator(dialog.opener).click();
  await expect(page.locator(dialog.root)).toBeVisible();
}

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

test("a dialog traps Tab from its last enabled control", async ({ page }) => {
  // Break caught: a missing focus trap lets keyboard focus leave the active dialog.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await open(page, dialogCases[0]);
  await page.locator("#priceDone").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator("#priceClose")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#priceModal")).toBeHidden();
  await expect(page.locator("#btnPrices")).toBeFocused();
});

test("a dialog traps Shift+Tab from its first enabled control", async ({ page }) => {
  // Break caught: reverse keyboard navigation escapes from the dialog.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await open(page, dialogCases[0]);
  await page.locator("#priceClose").focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#priceDone")).toBeFocused();
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
    const root=document.createElement("div"),panel=document.createElement("div"),button=document.createElement("button");
    root.hidden=true;root.append(panel);document.body.append(button,root);button.focus();
    const api=dialogController.register({root,panel,opener:button,onOpen(){throw new Error("open boom");}});
    let error;try{api.open(button);}catch(e){error=e.message;}
    return {error,hidden:root.hidden,locked:document.body.classList.contains("dialog-open"),inert:document.querySelector(".wrap").inert,focused:document.activeElement===button};
  });
  expect(result).toEqual({ error: "open boom", hidden: true, locked: false, inert: false, focused: true });
});

test("controller restores state and focus when an onClose callback throws", async ({ page }) => {
  // Break caught: a close callback exception leaves background inertness and scroll lock behind.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(() => {
    const root=document.createElement("div"),panel=document.createElement("div"),button=document.createElement("button");
    root.hidden=true;root.append(panel);document.body.append(button,root);button.focus();
    const api=dialogController.register({root,panel,opener:button,onClose(){throw new Error("close boom");}});
    api.open(button);let error;try{api.close();}catch(e){error=e.message;}
    return {error,hidden:root.hidden,locked:document.body.classList.contains("dialog-open"),inert:document.querySelector(".wrap").inert,focused:document.activeElement===button};
  });
  expect(result).toEqual({ error: "close boom", hidden: true, locked: false, inert: false, focused: true });
});

test("only the top registered dialog handles Escape before focus returns to the underlying dialog", async ({ page }) => {
  // Break caught: a stack regression closes both dialogs or restores focus behind the remaining dialog.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const root = document.createElement("div");
    const panel = document.createElement("div");
    const button = document.createElement("button");
    root.id = "nestedDialogFixture";
    root.className = "modal-bg";
    root.hidden = true;
    panel.className = "modal";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    button.id = "nestedDialogFixtureDone";
    button.textContent = "Close nested fixture";
    button.setAttribute("data-dialog-close", "");
    panel.append(button);
    root.append(panel);
    document.body.append(root);
    window.__nestedDialogFixture = dialogController.register({ root, panel, opener: null, initialFocus: button });
  });
  await open(page, dialogCases[0]);
  await page.evaluate(() => window.__nestedDialogFixture.open(document.getElementById("priceDone")));
  await expect(page.locator("#nestedDialogFixture")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#nestedDialogFixture")).toBeHidden();
  await expect(page.locator("#priceModal")).toBeVisible();
  await expect(page.locator('#priceRows [data-price="Glass"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#priceModal")).toBeHidden();
  await expect(page.locator("#btnPrices")).toBeFocused();
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
  const progress=dialogCases[5];
  await open(page, progress);
  await page.evaluate(() => {
    const old=document.getElementById("btnProgress"),next=old.cloneNode(true);
    old.replaceWith(next);
  });
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
