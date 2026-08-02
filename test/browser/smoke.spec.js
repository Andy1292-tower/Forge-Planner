"use strict";

const { test, expect } = require("@playwright/test");

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

test("the planner serves, solves in its Worker, and opens every planning mode", async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const workerPromise = page.waitForEvent("worker", worker =>
    new URL(worker.url()).pathname.endsWith("/js/solver.worker.js")
  );

  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__forgeWorkerResponses = [];
    window.Worker = class ObservedWorker extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", event => {
          const response = event.data;
          if (response && typeof response === "object" && (response.res || response.error)) {
            window.__forgeWorkerResponses.push(response);
          }
        });
      }
    };
  });

  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await workerPromise;
  await expect.poll(async () => page.evaluate(() =>
    (window.__forgeWorkerResponses || []).some(response => response && response.res && !response.error)
  )).toBe(true);
  await expect(page.locator("#results")).toContainText("Line assignment");

  const modes = [
    ["Max items/hr", "Line assignment"],
    ["Max credits/hr", "Credits mode."],
    ["Project plan", "No project demand yet"],
    ["Manual", "Manual mode."],
  ];
  for (const [mode, expectedResult] of modes) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    await expect(page.locator("#results")).toContainText(expectedResult);
  }

  expect(consoleErrors, "unexpected console errors").toEqual([]);
  expect(pageErrors, "unexpected page errors").toEqual([]);
  expect(failedResponses, "unexpected failed HTTP responses").toEqual([]);
});
