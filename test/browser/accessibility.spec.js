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

async function openInputsTab(page, name) {
  await page.locator("#btnInputs").click();
  await page.getByRole("tab", { name, exact: true }).click();
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
  await openInputsTab(page, "Projects");
  const lineJobPolicy = page.getByLabel("Line-job policy");
  await expect(lineJobPolicy).toHaveAttribute("aria-describedby", "projectStabilityHelp");
  await expect(page.locator("#projectStabilityHelp")).toContainText("within 5%");
  await expect(page.locator("#projectStabilityHelp")).toContainText("warm-ups");
  await lineJobPolicy.selectOption("reoptimize");
  await expect.poll(async () => page.evaluate(() => S.projectStability)).toBe("reoptimize");
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
  await page.locator("#inputsDone").click();
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

  await openInputsTab(page, "Sell prices");
  await expect(page.getByRole("textbox", { name: "Plates sell price per unit" })).toBeVisible();
  await page.locator("#inputsDone").click();

  await page.getByRole("button", { name: "Lil' Forgie" }).click();
  await expect(page.getByRole("textbox", { name: "Plates Lil' Forgie production per hour" })).toBeVisible();
  await page.getByRole("button", { name: "Done editing Lil' Forgie supply" }).click();

  await openInputsTab(page, "Projects");
  await expect(page.locator("#inputsProjectsPanel")).toContainText("required material unlocks first");
  await expect(page.locator("#inputsProjectsPanel")).toContainText("numeric order");
  await expect(page.locator("#inputsProjectsPanel")).toContainText("estimated completion time");
  await expect(page.locator("#inputsProjectsPanel")).not.toContainText("cheapest first");
  await page.getByRole("tab", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Plates current inventory" })).toBeVisible();
  await page.locator("#inputsDone").click();

  await page.locator("#recipeToggle").click();
  await expect(page.getByRole("spinbutton", { name: "Plates base time at 1x in seconds" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Plates recipe Ingots cost at compression 16384x" })).toBeVisible();
});

test("visible validation feedback is polite, preserves help descriptions, and passes Axe", async ({ page }) => {
  await loadPlanner(page);
  const speed = page.getByRole("spinbutton", { name: "Line 1 currently displayed speed multiplier" });
  await speed.fill("");
  const speedErrorId = await speed.getAttribute("data-field-error");
  await expect(speed).toHaveAttribute("aria-invalid", "true");
  await expect(speed).toHaveAttribute("aria-describedby", new RegExp(`line1SpeedHelp.*${speedErrorId}|${speedErrorId}.*line1SpeedHelp`));
  await expect(page.locator(`#${speedErrorId}`)).toHaveAttribute("aria-live", "polite");
  await expect(page.locator(`#${speedErrorId}`)).toHaveAttribute("aria-atomic", "true");

  await openInputsTab(page, "Projects");
  await page.getByRole("button", { name: "New custom project" }).click();
  await page.getByRole("button", { name: "Add level to New project" }).click();
  const from = page.getByRole("spinbutton", { name: "New project starting level" });
  await page.getByRole("spinbutton", { name: "New project ending level" }).fill("1");
  await from.fill("2");
  const projectErrorId = await from.getAttribute("data-field-error");
  const projectError = page.locator(`#${projectErrorId}`);
  await expect(projectError).toBeVisible();
  expect(await projectError.evaluate(element => element.closest("label") === null)).toBe(true);
  await expectNoWcagViolations(page);
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
  const plannerMain = page.locator("#plannerMain");
  await expect(plannerMain).toBeFocused();
  const mainFocus = await plannerMain.evaluate(element => {
    const style=getComputedStyle(element);
    return {style:style.outlineStyle,width:parseFloat(style.outlineWidth)};
  });
  expect(mainFocus.style).not.toBe("none");
  expect(mainFocus.width).toBeGreaterThan(0);

  const scroller = page.getByRole("region", { name: /Line assignment table/ });
  await expect(scroller).toHaveAttribute("tabindex", "0");
  await expect(scroller).toHaveAttribute("aria-describedby", "tableScrollHelp");

  await openInputsTab(page, "Projects");
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

test("the project line-plan toggle follows the planning-mode switch pattern", async ({ page }) => {
  await loadPlanner(page);
  await seedNamedProjects(page);

  const lineSwitching = page.getByRole("button", { name: "Line switching" });
  const setForget = page.getByRole("button", { name: "Set & forget" });
  await expect(lineSwitching).toHaveAttribute("aria-pressed", "true");
  await expect(setForget).toHaveAttribute("aria-pressed", "false");
  expect((await setForget.boundingBox()).height).toBeGreaterThanOrEqual(44);
  // Tab in from the sibling so the focus ring is evaluated under keyboard modality (:focus-visible).
  await lineSwitching.focus();
  await page.keyboard.press("Tab");
  await expect(setForget).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)).not.toBe("none");

  await setForget.click();
  await expect(setForget).toHaveAttribute("aria-pressed", "true");
  await expect(lineSwitching).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => S.projLineMode)).toBe("static");
  // The step plan must describe the mode honestly: one job per line, slowest item sets the time —
  // never a promise that everything lands together, and never a "fastest total" caption.
  await expect(page.locator("#results")).toContainText("every busy line keeps one job for the whole phase");
  await expect(page.locator("#results")).toContainText("The slowest required item sets");
  await expect(page.locator("#results")).not.toContainText("(fastest total)");
  await expectNoWcagViolations(page);

  // Two sentence-length labels are the tightest thing in #results, so check the narrow widths too.
  for (const width of [390, 320, 195]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(setForget).toBeVisible();
    expect((await setForget.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expectNoPageClipping(page);
  }
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

  const skipLink = page.getByRole("link", { name: "Skip to planner results" });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  const plannerMain = page.locator("#plannerMain");
  await expect(plannerMain).toBeFocused();
  const forcedMainFocus = await plannerMain.evaluate(element => {
    const style=getComputedStyle(element);
    return {style:style.outlineStyle,width:parseFloat(style.outlineWidth)};
  });
  expect(forcedMainFocus.style).not.toBe("none");
  expect(forcedMainFocus.width).toBeGreaterThan(0);

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
  await page.locator("#recipeToggle").click();
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
  // Break caught: the consolidated tab semantics or moved Settings actions introduce a WCAG violation in a state the base page scan cannot see.
  await loadPlanner(page);
  await expectNoWcagViolations(page);

  await openInputsTab(page, "Inventory");
  await expect(page.getByRole("dialog", { name: "Projects+Prices", exact: true })).toBeVisible();
  for (const name of ["Inventory", "Projects", "Sell prices"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expectNoWcagViolations(page);
  }
  await page.locator("#inputsDone").click();

  for (const [openName, dialogName, closeName] of [
    ["Lil' Forgie", "Lil' Forgie supply", "Done editing Lil' Forgie supply"],
    ["Mined resources", "Mined resources", "Done editing mined resources"],
    ["Settings", "Settings", "Done editing settings"],
  ]) {
    await page.getByRole("button", { name: openName, exact: true }).click();
    await expect(page.getByRole("dialog", { name: dialogName })).toBeVisible();
    await expectNoWcagViolations(page);
    await page.getByRole("button", { name: closeName }).click();
  }
});
