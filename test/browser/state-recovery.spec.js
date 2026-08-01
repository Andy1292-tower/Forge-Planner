"use strict";

const fs = require("fs");
const { test, expect } = require("@playwright/test");

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

const STORAGE_KEY = "forgePlannerState_v3";

async function openWithStored(page, raw) {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: STORAGE_KEY, value: raw });
  await page.goto("/", { waitUntil: "domcontentloaded" });
}

test("a stored primitive boots defaults, preserves rejected bytes, and exposes accessible recovery", async ({ page }) => {
  await openWithStored(page, "1");

  await expect(page.locator("#lines .line-row")).toHaveCount(5);
  const recovery = page.getByRole("alert");
  await expect(recovery).toBeVisible();
  await expect(recovery).toContainText("couldn’t use your saved build");
  await expect(page.getByRole("button", { name: "Download rejected save", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try another import", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
  await expect(recovery).toBeFocused();
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe("1");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download rejected save", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("forge-planner-rejected-save.json");
  expect(fs.readFileSync(await download.path(), "utf8")).toBe("1");

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Try another import", exact: true }).click();
  await chooserPromise;
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(recovery).toBeHidden();
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeFocused();
});

test("an oversized file is rejected before FileReader construction", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeFileReader = window.FileReader;
    window.__fileReaderConstructions = 0;
    window.FileReader = class ObservedFileReader extends NativeFileReader {
      constructor() {
        super();
        window.__fileReaderConstructions++;
      }
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const before = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);

  await page.locator("#fileImport").setInputFiles({
    name: "too-large.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 0x20),
  });

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("too large");
  expect(await page.evaluate(() => window.__fileReaderConstructions)).toBe(0);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(before);
});

test("a rejected future import leaves prior state and persisted bytes unchanged", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const beforeRaw = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  const beforeSpeed = await page.locator('[data-spx="0"]').inputValue();

  await page.locator("#fileImport").setInputFiles({
    name: "future.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 2 })),
  });

  await expect(page.getByRole("alert")).toContainText("newer version");
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(beforeRaw);
  await expect(page.locator('[data-spx="0"]')).toHaveValue(beforeSpeed);
});

test("a valid import commits once and retains the exact previous-good bytes", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const beforeRaw = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  const candidate = JSON.parse(beforeRaw);
  candidate.lines[0].spx = 88.25;

  await page.locator("#fileImport").setInputFiles({
    name: "valid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(candidate)),
  });

  await expect(page.locator('[data-spx="0"]')).toHaveValue("88.25");
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(stored.schemaVersion).toBe(1);
  expect(stored.lines[0].spx).toBe(88.25);
  expect(await page.evaluate(() => localStorage.getItem("forgePlannerState_v3_previous_good"))).toBe(beforeRaw);
});

test("a first-render failure during import restores global state and exact persisted bytes", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const beforeRaw = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  const beforeSpeed = await page.evaluate(() => S.lines[0].spx);
  const candidate = JSON.parse(beforeRaw);
  candidate.lines[0].spx = 99.75;
  await page.evaluate(() => {
    const original = renderLines;
    let first = true;
    renderLines = function renderLinesFailOnce() {
      if (first) { first = false; throw new Error("intentional first-render failure"); }
      return original();
    };
  });

  await page.locator("#fileImport").setInputFiles({
    name: "render-failure.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(candidate)),
  });

  await expect(page.getByRole("alert")).toContainText("could not be rendered");
  expect(await page.evaluate(() => S.lines[0].spx)).toBe(beforeSpeed);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(beforeRaw);
  await expect(page.locator('[data-spx="0"]')).toHaveValue(String(beforeSpeed));
});

test("a project created through the GUI is complete enough to cross the strict save boundary", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Shopping list", exact: true }).click();
  await page.getByRole("button", { name: "+ New custom project", exact: true }).click();

  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).projects.length, STORAGE_KEY)).toBe(1);
  const project = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).projects[0], STORAGE_KEY);
  expect(project.name).toBe("New project");
  expect(project.prio).toBeNull();
  expect(project.done).toBe(0);
});
