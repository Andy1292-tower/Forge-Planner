"use strict";

const { test, expect } = require("@playwright/test");

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

test("a Shopping-list disclosure survives immediate page teardown without launching a solve", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true, { timeout: 15_000 });

  await page.getByRole("button", { name: "Shopping list", exact: true }).click();
  await page.getByRole("button", { name: "New custom project", exact: false }).click();
  const disclosure = page.locator("[data-ptoggle=\"0\"]");
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  const generation = await page.evaluate(() => solveService.status().generation);

  await disclosure.click();
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("forgePlannerState_v3")));
  expect(persisted.projects[0]._open).toBe(false);
  expect(await page.evaluate(() => solveService.status().generation)).toBe(generation + 1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Shopping list", exact: true }).click();
  await expect(page.locator("[data-ptoggle=\"0\"]")).toHaveAttribute("aria-expanded", "false");
});

test("the persistence debounce writes state without rendering or requesting a solve", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true, { timeout: 15_000 });
  await page.getByRole("button", { name: "Shopping list", exact: true }).click();
  await page.getByRole("button", { name: "New custom project", exact: false }).click();

  const before = await page.evaluate(() => ({
    generation: solveService.status().generation,
    results: document.getElementById("results").innerHTML,
  }));
  await page.locator("[data-ptoggle=\"0\"]").click();
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => ({
    generation: solveService.status().generation,
    results: document.getElementById("results").innerHTML,
    open: JSON.parse(localStorage.getItem("forgePlannerState_v3")).projects[0]._open,
  }));
  expect(after.open).toBe(false);
  expect(after.generation).toBe(before.generation);
  expect(after.results).toBe(before.results);
});

test("numeric drafts that Task 8 made immediate remain durable without waiting for a debounce", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sell prices", exact: true }).click();
  await page.getByRole("textbox", { name: "Frames sell price per unit", exact: true }).fill("12.5m");

  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("forgePlannerState_v3")));
  expect(persisted.sellPrice.Frames).toBe(12_500_000);
  expect(persisted.priceText.Frames).toBe("12.5m");
});

test("hiding the page flushes persistence without cancelling or manufacturing solve work", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true, { timeout: 15_000 });
  const before = await page.evaluate(() => {
    mutateState(state => { state.planStart = 12_345; });
    schedulePersist();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    return solveService.status();
  });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  const after = await page.evaluate(() => ({
    status: solveService.status(),
    planStart: JSON.parse(localStorage.getItem("forgePlannerState_v3")).planStart,
  }));
  expect(after.planStart).toBe(12_345);
  expect(after.status.generation).toBe(before.generation);
  expect(after.status.active).toBe(before.active);
});
