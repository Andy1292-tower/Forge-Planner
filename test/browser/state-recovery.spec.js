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

async function currentSchemaVersion(page) {
  return page.evaluate(() => CURRENT_SCHEMA_VERSION);
}

async function openSettings(page) {
  await page.locator("#btnSettings").click();
  await expect(page.locator("#settingsModal")).toBeVisible();
}

test("a stored primitive boots defaults, preserves rejected bytes, and uses the visible Settings focus fallback", async ({ page }) => {
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
  await expect(page.locator("#btnSettings")).toBeFocused();
});

test("runtime recovery dismissal restores the exact connected invoker", async ({ page }) => {
  // Break caught: every recovery dismissal falls back to Settings even when a live action opened it.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const invoker = page.locator("#btnSettings");
  await invoker.focus();
  await page.evaluate(() => showStateRecovery(null, "Intentional runtime recovery fixture."));
  await expect(page.getByRole("alert")).toBeFocused();

  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(invoker).toBeFocused();
});

test("runtime recovery resolves a disconnected invoker through its stable ID", async ({ page }) => {
  // Break caught: a render can replace the recorded control and leave dismissal without a valid focus target.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#btnSettings").focus();
  await page.evaluate(() => {
    showStateRecovery(null, "Intentional replacement fixture.");
    const prior = document.getElementById("btnSettings");
    prior.replaceWith(prior.cloneNode(true));
  });

  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.locator("#btnSettings")).toBeFocused();
});

test("runtime recovery does not invent the boot Settings fallback when its anonymous invoker disappears", async ({ page }) => {
  // Break caught: the boot fallback leaks into runtime recovery and moves focus to an unrelated action.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const invoker = document.createElement("button");
    document.body.append(invoker);
    invoker.focus();
    showStateRecovery(null, "Intentional disconnected fixture.");
    invoker.remove();
  });

  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.locator("#btnSettings")).not.toBeFocused();
});

test("a runtime recovery supersedes an already-visible boot fallback with its exact invoker", async ({ page }) => {
  // Break caught: leaving the boot notice open must not make a later runtime failure restore unrelated Settings focus.
  await openWithStored(page, "1");
  const invoker = page.locator("#btnSettings");
  await invoker.focus();
  await page.evaluate(() => showStateRecovery(null, "Intentional runtime recovery after boot."));

  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(invoker).toBeFocused();
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
  await openSettings(page);

  await page.locator("#fileImport").setInputFiles({
    name: "too-large.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 0x20),
  });

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("too large");
  await expect(page.locator("#settingsModal")).toBeHidden();
  await expect(page.getByRole("alert")).toBeFocused();
  expect(await page.locator(".wrap").evaluate(node => node.inert)).toBe(false);
  expect(await page.evaluate(() => window.__fileReaderConstructions)).toBe(0);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(before);
});

test("a rejected future import leaves prior state and persisted bytes unchanged", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const beforeRaw = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  const beforeSpeed = await page.locator('[data-spx="0"]').inputValue();
  const futureVersion = (await currentSchemaVersion(page)) + 1;
  await openSettings(page);

  await page.locator("#fileImport").setInputFiles({
    name: "future.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schemaVersion: futureVersion })),
  });

  await expect(page.getByRole("alert")).toContainText("newer version");
  await expect(page.locator("#settingsModal")).toBeHidden();
  await expect(page.getByRole("alert")).toBeFocused();
  expect(await page.locator(".wrap").evaluate(node => node.inert)).toBe(false);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(beforeRaw);
  await expect(page.locator('[data-spx="0"]')).toHaveValue(beforeSpeed);
});

test("a normal-size rejected import downloads the original File bytes instead of re-encoded text", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const futureVersion = (await currentSchemaVersion(page)) + 1;
  const originalBytes = Buffer.concat([
    Buffer.from(`{"schemaVersion":${futureVersion},"note":"`),
    Buffer.from([0x80]),
    Buffer.from('"}'),
  ]);
  await openSettings(page);

  await page.locator("#fileImport").setInputFiles({
    name: "future-invalid-utf8.json",
    mimeType: "application/json",
    buffer: originalBytes,
  });

  await expect(page.getByRole("alert")).toContainText("newer version");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download rejected save", exact: true }).click();
  const download = await downloadPromise;
  expect(fs.readFileSync(await download.path())).toEqual(originalBytes);
});

test("a valid import commits once and retains the exact previous-good bytes", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const beforeRaw = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  const candidate = JSON.parse(beforeRaw);
  candidate.lines[0].spx = 88.25;
  await openSettings(page);

  await page.locator("#fileImport").setInputFiles({
    name: "valid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(candidate)),
  });

  await expect(page.locator('[data-spx="0"]')).toHaveValue("88.25");
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(stored.schemaVersion).toBe(await currentSchemaVersion(page));
  expect(stored.lines[0].spx).toBe(88.25);
  expect(await page.evaluate(() => localStorage.getItem("forgePlannerState_v3_previous_good"))).toBe(beforeRaw);
  await page.locator("#settingsDone").click();
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
  await openSettings(page);

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
  await page.locator("#btnInputs").click();
  await page.getByRole("tab", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "+ New custom project", exact: true }).click();

  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).projects.length, STORAGE_KEY)).toBe(1);
  const project = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).projects[0], STORAGE_KEY);
  expect(project.name).toBe("New project");
  expect(project.prio).toBeNull();
  expect(project.done).toBe(0);
});

test("an invalid JSON import leaves Settings before focusing reachable recovery actions", async ({ page }) => {
  // Break caught: import parsing fails inside an inert modal and traps the recovery notice behind Settings.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openSettings(page);
  await page.locator("#fileImport").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not-json"),
  });

  const recovery = page.getByRole("alert");
  await expect(page.locator("#settingsModal")).toBeHidden();
  await expect(recovery).toBeVisible();
  await expect(recovery).toBeFocused();
  expect(await page.locator(".wrap").evaluate(node => node.inert)).toBe(false);

  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(recovery).toBeHidden();
  await expect(page.locator("#btnSettings")).toBeFocused();
});

test("Try another import targets the Settings-owned file input without reopening Settings", async ({ page }) => {
  // Break caught: recovery's retry action reopens an inert Settings dialog or loses its direct file-input wiring.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openSettings(page);
  await page.locator("#fileImport").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{not-json"),
  });
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Try another import", exact: true }).click();
  await chooserPromise;
  await expect(page.locator("#settingsModal")).toBeHidden();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(await page.locator(".wrap").evaluate(node => node.inert)).toBe(false);
});

test("export validation recovery closes Settings and restores focus to its visible opener", async ({ page }) => {
  // Break caught: export validation calls base recovery from inside Settings and leaves the notice inaccessible behind modal inertness.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openSettings(page);
  await page.evaluate(() => { S.dupe = 101; });
  await page.locator("#btnExport").click();
  await expect(page.locator("#settingsModal")).toBeHidden();
  await expect(page.getByRole("alert")).toContainText("cannot be exported safely");
  await expect(page.getByRole("alert")).toBeFocused();
  expect(await page.locator(".wrap").evaluate(node => node.inert)).toBe(false);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.locator("#btnSettings")).toBeFocused();
});

test("a FileReader failure leaves Settings and restores the visible Settings fallback", async ({ page }) => {
  // Break caught: asynchronous file-read errors use a hidden Import fallback or leave Settings modal state active.
  await page.addInitScript(() => {
    window.FileReader = class FailedReader {
      readAsText() { queueMicrotask(() => this.onerror?.(new Event("error"))); }
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await openSettings(page);
  await page.locator("#fileImport").setInputFiles({
    name: "unreadable.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await expect(page.locator("#settingsModal")).toBeHidden();
  await expect(page.getByRole("alert")).toContainText("Could not read that file");
  await expect(page.getByRole("alert")).toBeFocused();
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.locator("#btnSettings")).toBeFocused();
});
