"use strict";

const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

async function loadPlanner(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#results")).toContainText("Line assignment");
  await expect(page.locator("#solveOverlay")).toBeHidden();
}

async function expectNoSeriousAxeViolations(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = result.violations.filter(violation =>
    violation.impact === "critical" || violation.impact === "serious"
  );
  expect(violations, violations.map(violation =>
    `${violation.id}: ${violation.help}\n${violation.nodes.map(node => `  ${node.target.join(" ")}: ${node.failureSummary}`).join("\n")}`
  ).join("\n\n")).toEqual([]);
}

test("dynamic planner fields expose item, level, and line context in their names", async ({ page }) => {
  await loadPlanner(page);

  await expect(page.getByRole("combobox", { name: "Line 1 max compression" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Line 1 currently displayed speed multiplier" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Line 1 current turbo stacks" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Plates" }).check();
  await expect(page.getByRole("slider", { name: "Plates priority" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "May-work margin" })).toHaveAttribute("aria-describedby", "marginHelp");

  const help = page.getByRole("button", { name: "Help for max turbo stacks" });
  await expect(help).toHaveAttribute("aria-describedby", /.+/);
  const helpId = await help.getAttribute("aria-describedby");
  await expect(page.locator(`#${helpId}`)).toContainText("global cap");
  await page.getByRole("spinbutton", { name: "max turbo stacks" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(help).toBeFocused();
  expect(await help.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");

  await page.getByRole("button", { name: "Sell prices" }).click();
  await expect(page.getByRole("textbox", { name: "Plates sell price per unit" })).toBeVisible();
  await page.getByRole("button", { name: "Done editing sell prices" }).click();

  await page.getByRole("button", { name: "Lil' Forgie" }).click();
  await expect(page.getByRole("textbox", { name: "Plates Lil' Forgie production per hour" })).toBeVisible();
  await page.getByRole("button", { name: "Done editing Lil' Forgie supply" }).click();

  await page.getByRole("button", { name: "Shopping list" }).click();
  await expect(page.getByRole("textbox", { name: "Plates current inventory" })).toBeVisible();
  await page.getByRole("button", { name: "Done editing shopping list" }).click();

  await page.getByRole("button", { name: "Crafting data" }).click();
  await expect(page.getByRole("spinbutton", { name: "Plates base time at 1x in seconds" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Plates recipe Ingots cost at compression 16384x" })).toBeVisible();
});

test("mode, save, stale, solving, fallback, failure, and completion states are concise", async ({ page }) => {
  await page.addInitScript(() => {
    window.__a11yWorkers = [];
    window.Worker = class ControlledWorker {
      constructor() { this.messages = []; window.__a11yWorkers.push(this); }
      postMessage(message) { this.messages.push(structuredClone(message)); }
      terminate() {}
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const itemsMode = page.getByRole("button", { name: "Max items/hr" });
  const creditsMode = page.getByRole("button", { name: "Max credits/hr" });
  await expect(itemsMode).toHaveAttribute("aria-pressed", "true");
  await expect(creditsMode).toHaveAttribute("aria-pressed", "false");
  await creditsMode.click();
  await expect(creditsMode).toHaveAttribute("aria-pressed", "true");
  await expect(itemsMode).toHaveAttribute("aria-pressed", "false");

  const solving = page.locator("#solveOverlay");
  await expect(solving).toHaveAttribute("role", "status");
  await expect(solving).toHaveAttribute("aria-live", "polite");
  await expect(solving).toContainText("Solving");

  const speed = page.getByRole("spinbutton", { name: "Line 1 currently displayed speed multiplier" });
  await speed.fill("51.25");
  await expect(page.locator("#staleBar")).toHaveAttribute("role", "status");
  await expect(page.locator("#staleBar")).toContainText("out of date");
  await expect(page.locator("#saveind")).toHaveAttribute("role", "status");
  await expect(page.locator("#saveind")).toContainText(/saved|auto-saves locally/);

  await page.getByRole("button", { name: "Resimulate" }).click();
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", false);
  await page.evaluate(() => {
    const worker = window.__a11yWorkers.at(-1);
    const sent = worker.messages[0];
    worker.onmessage({ data: { reqId: sent.reqId, generation: sent.generation, mode: sent.mode, stateRevision: sent.stateRevision, error: "controlled solve failure" } });
  });
  await expect(page.locator("#solveStat")).toHaveAttribute("role", "status");
  await expect(page.locator("#solveStat")).toContainText("Solve failed");
  await expect(page.locator("#results")).not.toHaveAttribute("aria-live", /.+/);
});

test("skip route, project disclosures, and table scrollers work from the keyboard", async ({ page }) => {
  await loadPlanner(page);

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to planner results" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveCSS("visibility", "visible");
  await page.keyboard.press("Enter");
  await expect(page.locator("#plannerMain")).toBeFocused();

  const scroller = page.getByRole("region", { name: /Line assignment table/ });
  await expect(scroller).toHaveAttribute("tabindex", "0");
  await expect(scroller).toHaveAttribute("aria-describedby", "tableScrollHelp");

  await page.getByRole("button", { name: "Shopping list" }).click();
  await page.getByRole("button", { name: "New custom project" }).click();
  const disclosure = page.getByRole("button", { name: "Hide level costs for New project" });
  await expect(disclosure).toHaveAttribute("aria-expanded", "true");
  await disclosure.press("Enter");
  await expect(page.getByRole("button", { name: "Show level costs for New project" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Show level costs for New project" }).press("Space");
  await expect(page.getByRole("button", { name: "Hide level costs for New project" })).toHaveAttribute("aria-expanded", "true");
});

test("touch, zoom, forced colors, and reduced motion retain visible access affordances", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await loadPlanner(page);

  const addLine = page.getByRole("button", { name: "Add line" });
  const box = await addLine.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await addLine.focus();
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).not.toBe("none");
  expect(await page.locator(".spinner").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.getByRole("link", { name: "Skip to planner results" })).toBeAttached();
  await expect(page.locator("#plannerMain")).toBeAttached();
  await expect(page.getByRole("region", { name: /Line assignment table/ })).toHaveAttribute("tabindex", "0");
});

test("axe finds no serious WCAG violations on the planner and primary dialogs", async ({ page }) => {
  await loadPlanner(page);
  await expectNoSeriousAxeViolations(page);

  for (const [openName, dialogName, closeName] of [
    ["Sell prices", "Sell prices", "Done editing sell prices"],
    ["Lil' Forgie", "Lil' Forgie supply", "Done editing Lil' Forgie supply"],
    ["Mined resources", "Mined resources", "Done editing mined resources"],
    ["Shopping list", "Shopping list — projects", "Done editing shopping list"],
    ["Settings", "Settings", "Done editing settings"],
  ]) {
    await page.getByRole("button", { name: openName, exact: true }).click();
    await expect(page.getByRole("dialog", { name: dialogName })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
    await page.getByRole("button", { name: closeName }).click();
  }
});
