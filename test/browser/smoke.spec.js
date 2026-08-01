"use strict";

const { test, expect } = require("@playwright/test");

test("the planner serves, solves in its Worker, and opens every planning mode", async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const workerPromise = page.waitForEvent("worker", worker =>
    new URL(worker.url()).pathname.endsWith("/js/solver.worker.js")
  );

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
    const url = new URL(response.url());
    const isKnownAnalytics404 =
      url.pathname === "/_vercel/insights/script.js" && response.status() === 404;
    if (response.status() >= 400 && !isKnownAnalytics404) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await workerPromise;
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
