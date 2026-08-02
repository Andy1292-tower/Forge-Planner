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
