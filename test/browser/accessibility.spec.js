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

async function expectNoWcagViolations(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const violations = result.violations;
  expect(violations, violations.map(violation =>
    `${violation.id}: ${violation.help}\n${violation.nodes.map(node => `  ${node.target.join(" ")}: ${node.failureSummary}`).join("\n")}`
  ).join("\n\n")).toEqual([]);
}

async function seedNamedProjects(page) {
  await page.getByRole("button", { name: "Shopping list" }).click();
  await page.getByRole("button", { name: "New custom project" }).click();
  await page.getByRole("button", { name: "New custom project" }).click();
  await page.evaluate(() => {
    mutateState(st => {
      const configure = (project, id, name, done) => Object.assign(project, {
        id, name, on: true, from: 1, to: 2, done,
        levels: [{ costs: [{ item: "Glass", qty: 1 }] }, { costs: [{ item: "Bricks", qty: 1 }] }]
      });
      configure(st.projects.at(-2), "alpha-project", "Alpha Reactor", 1);
      configure(st.projects.at(-1), "beta-project", "Beta Reactor", 0);
    });
    renderProjects();
    save();
  });
  await page.getByRole("button", { name: "Done editing shopping list" }).click();
  await page.getByRole("button", { name: "Project plan" }).click();
  await expect(page.getByText("Adjust project levels & completion")).toBeVisible();
}

async function expectNoPageClipping(page) {
  const root = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(root.scrollWidth, `root width ${root.scrollWidth}px exceeds ${root.clientWidth}px viewport`).toBeLessThanOrEqual(root.clientWidth + 1);
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
  await expect(solving).toHaveAttribute("aria-hidden", "true");
  await expect(solving).toContainText("Solving");
  await expect(page.locator("#solveStat")).toHaveAttribute("role", "status");
  await expect(page.locator("#solveStat")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#solveStat")).toContainText("Solving");

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
  const collapsedDisclosure = page.getByRole("button", { name: "Show level costs for New project" });
  await expect(collapsedDisclosure).toHaveAttribute("aria-expanded", "false");
  await expect(collapsedDisclosure).toBeFocused();
  await collapsedDisclosure.press("Space");
  const expandedDisclosure = page.getByRole("button", { name: "Hide level costs for New project" });
  await expect(expandedDisclosure).toHaveAttribute("aria-expanded", "true");
  await expect(expandedDisclosure).toBeFocused();
});

test("project adjustment and progress actions include the project in every accessible name", async ({ page }) => {
  await loadPlanner(page);
  await seedNamedProjects(page);

  await page.getByText("Adjust project levels & completion").click();
  for (const project of ["Alpha Reactor", "Beta Reactor"]) {
    await expect(page.getByRole("checkbox", { name: `Include ${project} in the plan` })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: `${project} starting level` })).toBeVisible();
    await expect(page.getByRole("spinbutton", { name: `${project} ending level` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Mark one fewer ${project} level done` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Mark one more ${project} level done` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Mark ${project} complete` })).toBeVisible();
  }
  await expectNoWcagViolations(page);

  await page.getByRole("button", { name: "Track progress" }).click();
  await expect(page.getByRole("button", { name: "Reset Alpha Reactor progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo Alpha Reactor level 1 completion" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark Alpha Reactor completed through level 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark Beta Reactor completed through level 1" })).toBeVisible();
  await expectNoWcagViolations(page);
});

test("390px and 200%-equivalent reflow retain reachable controls without page clipping", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadPlanner(page);

  const addLine = page.getByRole("button", { name: "Add line" });
  const box = await addLine.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  await addLine.focus();
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).not.toBe("none");
  await expectNoPageClipping(page);
  await page.setViewportSize({ width: 195, height: 422 });
  await expect(page.locator("#plannerMain")).toBeVisible();
  await expectNoPageClipping(page);
  const scroller = page.getByRole("region", { name: /Line assignment table/ });
  await expect(scroller).toHaveAttribute("tabindex", "0");
  const scrollerGeometry = await scroller.evaluate(element => {
    const box=element.getBoundingClientRect();
    return { left:box.left, right:box.right, clientWidth:element.clientWidth, scrollWidth:element.scrollWidth, viewport:document.documentElement.clientWidth };
  });
  expect(scrollerGeometry.left).toBeGreaterThanOrEqual(0);
  expect(scrollerGeometry.right).toBeLessThanOrEqual(scrollerGeometry.viewport + 1);
  expect(scrollerGeometry.scrollWidth).toBeGreaterThan(scrollerGeometry.clientWidth);
});

test("forced colors retain boundaries and focus while reduced motion stops animated surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ forcedColors: "active" });
  await loadPlanner(page);
  for (const selector of [".card", ".btn", "select"]) {
    expect(await page.locator(selector).first().evaluate(element => getComputedStyle(element).borderStyle)).not.toBe("none");
  }
  const help = page.getByRole("button", { name: "Help for max turbo stacks" });
  await help.focus();
  expect(await help.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");

  await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
  expect(await page.locator(".spinner").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  expect(await page.locator(".brand .spark").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  expect(await page.locator(".card").first().evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(.001);
});

test("save feedback does not repeat for every keystroke and solving has one live source", async ({ page }) => {
  await page.addInitScript(() => {
    window.Worker = class ControlledWorker { postMessage() {} terminate() {} };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", false);
  expect(await page.locator('[role="status"][aria-live]:has-text("Solving")').count()).toBe(1);
  await page.evaluate(() => {
    window.__saveMutations = 0;
    new MutationObserver(records => { window.__saveMutations += records.length; })
      .observe(document.getElementById("saveind"), { childList: true, subtree: true, characterData: true });
  });
  const speed = page.getByRole("spinbutton", { name: "Line 1 currently displayed speed multiplier" });
  await speed.selectText();
  await page.keyboard.press("Backspace");
  await speed.pressSequentially("51.25", { delay: 10 });
  expect(await page.evaluate(() => window.__saveMutations)).toBe(1);
});

test("calibration warning text meets normal-text contrast", async ({ page }) => {
  await loadPlanner(page);
  await page.getByRole("button", { name: "Crafting data" }).click();
  await page.getByRole("spinbutton", { name: "that unit's speed ×" }).fill("50");
  await page.getByRole("spinbutton", { name: "craft seconds" }).fill("999");
  const warning = page.locator(".calib-warning").first();
  await expect(warning).toBeVisible();
  const ratio = await warning.evaluate(element => {
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = color => rgb(color).map(v => v / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    let surface=element;
    while(surface.parentElement && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)")surface=surface.parentElement;
    const fg = lum(getComputedStyle(element).color), bg = lum(getComputedStyle(surface).backgroundColor);
    return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test("axe finds no WCAG violations on the planner and primary dialogs", async ({ page }) => {
  await loadPlanner(page);
  await expectNoWcagViolations(page);

  for (const [openName, dialogName, closeName] of [
    ["Sell prices", "Sell prices", "Done editing sell prices"],
    ["Lil' Forgie", "Lil' Forgie supply", "Done editing Lil' Forgie supply"],
    ["Mined resources", "Mined resources", "Done editing mined resources"],
    ["Shopping list", "Shopping list — projects", "Done editing shopping list"],
    ["Settings", "Settings", "Done editing settings"],
  ]) {
    await page.getByRole("button", { name: openName, exact: true }).click();
    await expect(page.getByRole("dialog", { name: dialogName })).toBeVisible();
    await expectNoWcagViolations(page);
    await page.getByRole("button", { name: closeName }).click();
  }
});
