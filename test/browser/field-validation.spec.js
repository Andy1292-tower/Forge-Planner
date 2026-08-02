"use strict";

const { test, expect } = require("@playwright/test");

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

const STORAGE_KEY = "forgePlannerState_v3";

async function observeWorkers(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__fieldValidationWorkerPosts = [];
    window.Worker = class ObservedWorker extends NativeWorker {
      postMessage(message, transfer) {
        window.__fieldValidationWorkerPosts.push(structuredClone(message));
        return super.postMessage(message, transfer);
      }
    };
  });
}

async function loadPlanner(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#results")).toContainText("Line assignment");
  await expect(page.locator("#solveOverlay")).toBeHidden();
}

async function workerPostCount(page) {
  return page.evaluate(() => (window.__fieldValidationWorkerPosts || []).length);
}

async function stored(page) {
  return page.evaluate(key => ({ raw: localStorage.getItem(key), state: JSON.parse(localStorage.getItem(key)) }), STORAGE_KEY);
}

async function dispatchDraft(locator, value, type = "input") {
  await locator.evaluate((input, payload) => {
    input.value = payload.value;
    input.dispatchEvent(new Event(payload.type, { bubbles: true }));
  }, { value, type });
}

async function pasteDraft(locator, value) {
  await locator.evaluate((input, pasted) => {
    input.value = pasted;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste", data: pasted }));
  }, value);
}

async function expectFieldError(page, input, previous) {
  await expect(input).toHaveAttribute("aria-invalid", "true");
  const errorId = await input.getAttribute("data-field-error");
  expect(errorId).toBeTruthy();
  await expect(input).toHaveAttribute("aria-describedby", new RegExp(`(?:^|\\s)${errorId}(?:\\s|$)`));
  const error = page.locator(`#${errorId}`);
  await expect(error).toHaveAttribute("aria-live", "polite");
  await expect(error).toHaveAttribute("aria-atomic", "true");
  await expect(error).toContainText("previous value");
  await expect(error).toContainText(String(previous));
}

async function expectOwnedFieldError(page, input, previous, ownerSelector) {
  await expectFieldError(page, input, previous);
  const errorId = await input.getAttribute("data-field-error");
  expect(await input.evaluate((node, { id, selector }) => {
    const error = document.getElementById(id);
    return !!error && error.closest(selector) === node.closest(selector);
  }, { id: errorId, selector: ownerSelector })).toBe(true);
  return errorId;
}

test("required line/global drafts preserve the last accepted state and storage and never flush invalid Enter", async ({ page }) => {
  await observeWorkers(page);
  await loadPlanner(page);
  const speed = page.getByRole("spinbutton", { name: "Line 1 currently displayed speed multiplier" });

  await speed.fill("77.5");
  const accepted = await stored(page);
  expect(accepted.state.lines[0].spx).toBe(77.5);
  expect(await page.evaluate(() => S.lines[0].spx)).toBe(77.5);

  const postsBeforeInvalid = await workerPostCount(page);
  await speed.fill("");
  await expect(speed).toHaveValue("");
  await expectFieldError(page, speed, "77.5");
  await expect(speed).toHaveAttribute("aria-describedby", /line1SpeedHelp/);
  expect(await page.evaluate(() => S.lines[0].spx)).toBe(77.5);
  expect((await stored(page)).raw).toBe(accepted.raw);

  await speed.press("Enter");
  await page.waitForTimeout(650);
  expect(await workerPostCount(page)).toBe(postsBeforeInvalid);
  expect((await stored(page)).raw).toBe(accepted.raw);

  await speed.fill("8e1");
  await expect(speed).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(`#${await speed.getAttribute("data-field-error")}`)).toBeEmpty();
  expect(await page.evaluate(() => S.lines[0].spx)).toBe(80);
  expect((await stored(page)).state.lines[0].spx).toBe(80);

  const dupe = page.getByRole("spinbutton", { name: "dupe %" });
  await dupe.fill("101");
  await expectFieldError(page, dupe, await page.evaluate(() => S.dupe));
  await expect(dupe).toHaveAttribute("aria-describedby", /dupeHelp/);
  await dupe.fill("25");
  await expect(dupe).not.toHaveAttribute("aria-invalid", "true");
  expect((await stored(page)).state.dupe).toBe(25);

  const turbo = page.getByRole("spinbutton", { name: "Line 1 current turbo stacks" });
  await turbo.fill("40");
  let checkpoint = await stored(page);
  await turbo.fill("-1");
  await expectFieldError(page, turbo, "40");
  expect(await page.evaluate(() => S.lines[0].turbo)).toBe(40);
  expect((await stored(page)).raw).toBe(checkpoint.raw);
  await turbo.fill("50");
  expect((await stored(page)).state.lines[0].turbo).toBe(50);

  const maxTurbo = page.getByRole("spinbutton", { name: "max turbo stacks" });
  await maxTurbo.fill("100");
  checkpoint = await stored(page);
  await maxTurbo.fill("1000001");
  await expectFieldError(page, maxTurbo, "100");
  expect(await page.evaluate(() => S.maxTurbo)).toBe(100);
  expect((await stored(page)).raw).toBe(checkpoint.raw);
  await maxTurbo.fill("80");
  expect((await stored(page)).state.maxTurbo).toBe(80);

  const margin = page.getByRole("slider", { name: "May-work margin" });
  await expect(margin).toHaveAttribute("min", "0");
  await expect(margin).toHaveAttribute("max", "20");
  await expect(margin).toHaveAttribute("step", "0.5");
  await margin.fill("20");
  expect((await stored(page)).state.margin).toBe(20);

  const priority = page.getByRole("slider", { name: "Frames priority" });
  await expect(priority).toHaveAttribute("min", "1");
  await expect(priority).toHaveAttribute("max", "9");
  await priority.fill("9");
  expect((await stored(page)).state.targets.Frames.w).toBe(9);

  await speed.fill("81");
  await expect(page.getByRole("button", { name: "Resimulate" })).toBeVisible();
  await page.evaluate(() => { S.dupe = 101; });
  const postsBeforeRejectedState = await workerPostCount(page);
  await page.getByRole("button", { name: "Resimulate" }).click();
  await page.waitForTimeout(650);
  expect(await workerPostCount(page)).toBe(postsBeforeRejectedState);
  expect((await stored(page)).state.dupe).toBe(25);
  await page.evaluate(() => { S.dupe = 25; });
});

test("game-notation amount families accept suffixes, reject DOM-only drafts, and commit optional blank", async ({ page }) => {
  await observeWorkers(page);
  await loadPlanner(page);

  await page.getByRole("button", { name: "Sell prices" }).click();
  const price = page.getByRole("textbox", { name: "Frames sell price per unit" });
  await expect(price).toHaveAttribute("inputmode", "decimal");
  await expect(price).toHaveAttribute("maxlength", "128");
  await price.fill("2.5QA");
  let checkpoint = await stored(page);
  expect(checkpoint.state.sellPrice.Frames).toBe(2.5e15);
  expect(checkpoint.state.priceText.Frames).toBe("2.5QA");
  await price.fill("1wat");
  await expectFieldError(page, price, "2.5qa");
  expect((await stored(page)).raw).toBe(checkpoint.raw);
  expect(await page.evaluate(() => S.priceText.Frames)).toBe("2.5QA");

  const postsBeforeHiddenDraft = await workerPostCount(page);
  await page.getByRole("button", { name: "Done editing sell prices" }).click();
  const speed = page.getByRole("spinbutton", { name: "Line 1 currently displayed speed multiplier" });
  await speed.fill("2");
  await expect(page.getByRole("button", { name: "Resimulate" })).toBeVisible();
  await page.getByRole("button", { name: "Resimulate" }).click();
  await expect.poll(() => workerPostCount(page)).toBeGreaterThan(postsBeforeHiddenDraft);

  await page.getByRole("button", { name: "Sell prices" }).click();
  const rebuiltPrice = page.getByRole("textbox", { name: "Frames sell price per unit" });
  await expect(rebuiltPrice).toHaveValue("2.5QA");
  await rebuiltPrice.fill("");
  checkpoint = await stored(page);
  expect(checkpoint.state.sellPrice.Frames).toBeNull();
  expect(checkpoint.state.priceText.Frames).toBe("");
  await page.getByRole("button", { name: "Done editing sell prices" }).click();

  await page.getByRole("button", { name: "Lil' Forgie" }).click();
  const forgie = page.getByRole("textbox", { name: "Frames Lil' Forgie production per hour" });
  await forgie.fill("1,250k");
  expect((await stored(page)).state.forgie.Frames).toBe(1.25e6);
  await forgie.fill("-1");
  await expectFieldError(page, forgie, "1.25m");
  await forgie.fill("");
  await expect(forgie).not.toHaveAttribute("aria-invalid", "true");
  expect((await stored(page)).state.forgie.Frames).toBeNull();
  await forgie.fill("2m");
  expect((await stored(page)).state.forgie.Frames).toBe(2e6);
  await page.getByRole("button", { name: "Done editing Lil' Forgie supply" }).click();

  await page.getByRole("button", { name: "Mined resources" }).click();
  const mined = page.getByRole("textbox", { name: "Hydracite per minute income" });
  await expect(mined).toHaveAttribute("maxlength", "128");
  await mined.fill("3B");
  expect((await stored(page)).state.minedIncome.Hydracite).toBe(3e9);
  await mined.fill("1q");
  await expectFieldError(page, mined, "3b");
  await mined.fill("");
  await expect(mined).not.toHaveAttribute("aria-invalid", "true");
  expect((await stored(page)).state.minedIncome.Hydracite).toBeNull();
  await mined.fill("4b");
  expect((await stored(page)).state.minedIncome.Hydracite).toBe(4e9);
  await page.getByRole("button", { name: "Done editing mined resources" }).click();

  await page.getByRole("button", { name: "Shopping list" }).click();
  const inventory = page.getByRole("textbox", { name: "Frames current inventory" });
  await pasteDraft(inventory, "4e3");
  expect((await stored(page)).state.inventory.Frames).toBe(4000);
  await inventory.fill("abc");
  await expectFieldError(page, inventory, "4k");
  await inventory.fill("");
  await expect(inventory).not.toHaveAttribute("aria-invalid", "true");
  expect((await stored(page)).state.inventory.Frames).toBeNull();
  await pasteDraft(inventory, "5e3");
  expect((await stored(page)).state.inventory.Frames).toBe(5000);
});

test("Shopping-list and inline Project endpoint pairs commit atomically in either correction order", async ({ page }) => {
  await observeWorkers(page);
  await loadPlanner(page);
  await page.getByRole("button", { name: "Shopping list" }).click();
  await page.getByRole("button", { name: "New custom project" }).click();
  await page.getByRole("button", { name: "Add level to New project" }).click();
  await page.getByRole("button", { name: "+ item", exact: true }).first().click();
  const qty = page.locator("[data-cqty]").first();
  await expect(qty).toHaveAttribute("inputmode", "decimal");
  await qty.fill("100");
  let quantityCheckpoint = await stored(page);
  await qty.fill("-1");
  await expectFieldError(page, qty, "100");
  expect(await page.evaluate(() => S.projects[0].levels[0].costs[0].qty)).toBe(100);
  expect((await stored(page)).raw).toBe(quantityCheckpoint.raw);
  await qty.fill("");
  expect((await stored(page)).state.projects[0].levels[0].costs[0].qty).toBeNull();
  await qty.fill("2.5k");
  expect((await stored(page)).state.projects[0].levels[0].costs[0].qty).toBe(2500);

  const from = page.getByRole("spinbutton", { name: "New project starting level" });
  const to = page.getByRole("spinbutton", { name: "New project ending level" });
  await expect.poll(async () => page.evaluate(() => [S.projects[0].from, S.projects[0].to])).toEqual([1, 2]);

  await to.fill("1");
  await from.fill("2");
  await expectFieldError(page, from, "1");
  await expectFieldError(page, to, "1");
  expect(await page.evaluate(() => [S.projects[0].from, S.projects[0].to])).toEqual([1, 1]);
  const invalidRaw = (await stored(page)).raw;
  await to.fill("2");
  await expect(from).not.toHaveAttribute("aria-invalid", "true");
  await expect(to).not.toHaveAttribute("aria-invalid", "true");
  expect(await page.evaluate(() => [S.projects[0].from, S.projects[0].to])).toEqual([2, 2]);
  expect((await stored(page)).raw).not.toBe(invalidRaw);

  await to.fill("1");
  await expectFieldError(page, to, "2");
  expect(await page.evaluate(() => [S.projects[0].from, S.projects[0].to])).toEqual([2, 2]);
  await from.fill("1");
  expect(await page.evaluate(() => [S.projects[0].from, S.projects[0].to])).toEqual([1, 1]);

  const priority = page.getByRole("spinbutton", { name: "New project schedule order" });
  await priority.fill("1.5");
  await expect(priority).toHaveAttribute("aria-invalid", "true");
  expect(await page.evaluate(() => S.projects[0].prio)).toBeNull();
  await priority.fill("3");
  expect((await stored(page)).state.projects[0].prio).toBe(3);
  await priority.fill("");
  expect((await stored(page)).state.projects[0].prio).toBeNull();
  await priority.fill("3");

  await to.fill("2");
  await page.getByRole("button", { name: "Done editing shopping list" }).click();
  await page.getByRole("button", { name: "Project plan" }).click();
  await expect(page.getByText("Adjust project levels & completion")).toBeVisible();
  await page.getByText("Adjust project levels & completion").click();
  const inlineFrom = page.locator("[data-spfrom]").first();
  const inlineTo = page.locator("[data-spto]").first();
  await dispatchDraft(inlineTo, "1");
  await dispatchDraft(inlineFrom, "2");
  const postsBeforeInvalidChange = await workerPostCount(page);
  await inlineFrom.dispatchEvent("change");
  await page.waitForTimeout(650);
  expect(await workerPostCount(page)).toBe(postsBeforeInvalidChange);
  expect(await page.evaluate(() => [S.projects[0].from, S.projects[0].to])).toEqual([1, 1]);

  await dispatchDraft(inlineTo, "2");
  await inlineTo.dispatchEvent("change");
  await expect.poll(() => workerPostCount(page)).toBeGreaterThan(postsBeforeInvalidChange);
  expect(await page.evaluate(() => [S.projects[0].from, S.projects[0].to])).toEqual([2, 2]);
});

test("case-distinct project IDs keep Shopping-list and inline feedback uniquely owned", async ({ page }) => {
  await observeWorkers(page);
  await loadPlanner(page);
  await page.getByRole("button", { name: "Shopping list" }).click();
  await page.evaluate(() => {
    const project = (id, name) => ({
      id, name, on: true, prio: null, from: 1, to: 2, done: 0, _open: false,
      levels: [
        { costs: [{ item: "Frames", qty: 100 }] },
        { costs: [{ item: "Frames", qty: 100 }] },
      ],
    });
    mutateState(st => { st.projects = [project("ProjectA", "Upper case ID"), project("projecta", "Lower case ID")]; });
    renderProjects();
    save();
  });

  const shopping = page.locator("#projList");
  const upperFrom = shopping.getByRole("spinbutton", { name: "Upper case ID starting level" });
  const upperTo = shopping.getByRole("spinbutton", { name: "Upper case ID ending level" });
  const lowerFrom = shopping.getByRole("spinbutton", { name: "Lower case ID starting level" });
  const lowerTo = shopping.getByRole("spinbutton", { name: "Lower case ID ending level" });
  await upperTo.fill("1");
  await upperFrom.fill("2");
  await lowerTo.fill("1");
  await lowerFrom.fill("2");

  const shoppingIds = [
    await expectOwnedFieldError(page, upperFrom, "1", ".proj"),
    await expectOwnedFieldError(page, upperTo, "1", ".proj"),
    await expectOwnedFieldError(page, lowerFrom, "1", ".proj"),
    await expectOwnedFieldError(page, lowerTo, "1", ".proj"),
  ];
  expect(new Set(shoppingIds).size).toBe(shoppingIds.length);

  await upperTo.fill("2");
  await upperFrom.fill("1");
  await lowerTo.fill("2");
  await lowerFrom.fill("1");
  await page.getByRole("button", { name: "Done editing shopping list" }).click();
  await page.getByRole("button", { name: "Project plan" }).click();
  await expect(page.getByText("Adjust project levels & completion")).toBeVisible();
  await page.getByText("Adjust project levels & completion").click();

  const results = page.locator("#results");
  const inlineUpperFrom = results.getByRole("spinbutton", { name: "Upper case ID starting level" });
  const inlineUpperTo = results.getByRole("spinbutton", { name: "Upper case ID ending level" });
  const inlineLowerFrom = results.getByRole("spinbutton", { name: "Lower case ID starting level" });
  const inlineLowerTo = results.getByRole("spinbutton", { name: "Lower case ID ending level" });
  await dispatchDraft(inlineUpperTo, "1");
  await dispatchDraft(inlineUpperFrom, "2");
  await dispatchDraft(inlineLowerTo, "1");
  await dispatchDraft(inlineLowerFrom, "2");

  const inlineIds = [
    await expectOwnedFieldError(page, inlineUpperFrom, "1", ".proj-inline-row"),
    await expectOwnedFieldError(page, inlineUpperTo, "1", ".proj-inline-row"),
    await expectOwnedFieldError(page, inlineLowerFrom, "1", ".proj-inline-row"),
    await expectOwnedFieldError(page, inlineLowerTo, "1", ".proj-inline-row"),
  ];
  expect(new Set(inlineIds).size).toBe(inlineIds.length);
  expect(new Set([...shoppingIds, ...inlineIds]).size).toBe(shoppingIds.length + inlineIds.length);
});

test("base time, recipe cost, and calibration share validation without fallback coercion", async ({ page }) => {
  await observeWorkers(page);
  await loadPlanner(page);
  await page.getByRole("button", { name: "Crafting data" }).click();

  const base = page.getByRole("spinbutton", { name: "Glass base time at 1x in seconds" });
  await base.fill("90");
  const accepted = await stored(page);
  await base.fill("0");
  await expectFieldError(page, base, "90");
  expect(await page.evaluate(() => S.baseTime.Glass)).toBe(90);
  expect((await stored(page)).raw).toBe(accepted.raw);

  const recipe = page.getByRole("spinbutton", { name: "Glass recipe Bits cost at compression 1x" });
  await recipe.fill("123.5");
  expect((await stored(page)).state.prodCost.Glass.Bits[1]).toBe(123.5);
  await recipe.fill("");
  await recipe.pressSequentially("1e");
  await expect(recipe).toHaveAttribute("aria-invalid", "true");
  await recipe.fill("");
  await expect(recipe).not.toHaveAttribute("aria-invalid", "true");
  expect((await stored(page)).state.prodCost.Glass.Bits[1]).toBeNull();

  const speed = page.locator("#cbSpeed"), seconds = page.locator("#cbSec"), apply = page.locator("#cbApply");
  await speed.fill("49.38");
  await seconds.fill("");
  await expect(apply).toBeDisabled();
  await expect(seconds).toHaveAttribute("aria-invalid", "true");
  await seconds.fill("7.5");
  await expect(apply).toBeEnabled();
  await seconds.fill("");
  await seconds.pressSequentially("1e");
  await expect(apply).toBeDisabled();
  await expect(seconds).toHaveAttribute("aria-invalid", "true");
});

test("Settings preserves exact 60-second and nonstandard in-range budgets and dispatches exact milliseconds", async ({ page }) => {
  await observeWorkers(page);
  await loadPlanner(page);
  await page.evaluate(() => { mutateState(st => { st.solveBudget = 60000; });save(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#results")).toContainText("Line assignment");
  await expect.poll(async () => page.evaluate(() => (window.__fieldValidationWorkerPosts || []).some(post => post.budget === 60000))).toBe(true);

  await page.getByRole("button", { name: "Settings" }).click();
  const slider = page.getByRole("slider", { name: "Max solve time" });
  await expect(slider).toHaveAttribute("aria-valuetext", "60 s");
  await expect(page.locator("#solveBudgetVal")).toHaveText("60 s");
  await page.getByRole("button", { name: "Done editing settings" }).click();

  await page.evaluate(() => { mutateState(st => { st.solveBudget = 2345; });save(); });
  const before = await stored(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(slider).toHaveAttribute("aria-valuetext", "2.345 s");
  await expect(page.locator("#solveBudgetVal")).toHaveText("2.345 s");
  await page.getByRole("button", { name: "Done editing settings" }).click();
  const after = await stored(page);
  expect(after.raw).toBe(before.raw);
  expect(after.state.solveBudget).toBe(2345);
});
