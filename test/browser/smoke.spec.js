"use strict";

const { test, expect } = require("@playwright/test");

const LOCAL_ORIGIN = "http://127.0.0.1:4173";

function isKnownAnalytics404(responseUrl, status) {
  const url = new URL(responseUrl);
  return url.origin === LOCAL_ORIGIN &&
    url.pathname === "/_vercel/insights/script.js" && status === 404;
}

test("only the local Vercel Analytics 404 is ignored", () => {
  expect(isKnownAnalytics404("http://127.0.0.1:4173/_vercel/insights/script.js", 404)).toBe(true);
  expect(isKnownAnalytics404("https://example.test/_vercel/insights/script.js", 404)).toBe(false);
});

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
    const location = message.location();
    const isKnownAnalytics404 =
      location.url === "http://127.0.0.1:4173/_vercel/insights/script.js";
    if (message.type() === "error" && !isKnownAnalytics404) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400 && !isKnownAnalytics404(response.url(), response.status())) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
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
