"use strict";

const fs = require("fs");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "forgePlannerState_v3";
const ATTACK_PATH = "/__forge_import_attack__/";

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

function valuePayload(label) {
  return `x\"><img data-import-attack=\"${label}\" src=\"${ATTACK_PATH}${label}\" onerror=\"X.push('${label}')\">`;
}

function textPayload(label) {
  return `<img data-import-attack=\"${label}\" src=\"${ATTACK_PATH}${label}\" onerror=\"X.push('${label}')\">Text <>&\"'`;
}

function presetIdPayload(label) {
  return `x\"></option></select><img data-import-attack=i src=${ATTACK_PATH}i onerror=X.push(1)><select><option value=\"x`;
}

async function startAttackPage(page) {
  const attackRequests = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(ATTACK_PATH)) attackRequests.push(url.pathname);
  });
  await page.addInitScript(() => { window.X = []; });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const bypassed = await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__forgeCspBypassConfirmed = true";
    document.head.appendChild(script);
    script.remove();
    return window.__forgeCspBypassConfirmed === true;
  });
  expect(bypassed, "the attack corpus must bypass CSP so only DOM construction can stop it").toBe(true);
  return attackRequests;
}

async function currentCandidate(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
}

async function importCandidate(page, candidate, name = "attack.json") {
  await page.locator("#fileImport").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(candidate)),
  });
}

async function attackEvidence(page, attackRequests) {
  await page.waitForTimeout(150);
  return page.evaluate(requests => ({
    createdNodes: [...document.querySelectorAll("[data-import-attack]")].map(node => ({
      tag: node.tagName,
      marker: node.getAttribute("data-import-attack"),
    })),
    eventAttributes: [...document.querySelectorAll("[onerror],[onload]")].map(node => ({
      tag: node.tagName,
      onerror: node.getAttribute("onerror"),
      onload: node.getAttribute("onload"),
    })),
    markerSideEffects: window.X.slice(),
    requests,
  }), attackRequests.slice());
}

async function expectAttackInert(page, attackRequests) {
  expect(await attackEvidence(page, attackRequests)).toEqual({
    createdNodes: [],
    eventAttributes: [],
    markerSideEffects: [],
    requests: [],
  });
}

test.describe("imported markup stays inert with CSP bypassed", () => {
  test.use({ bypassCSP: true });

  test("every imported sell-price display string remains an exact input value", async ({ page }) => {
    const requests = await startAttackPage(page);
    const candidate = await currentCandidate(page);
    const expected = {};
    Object.keys(candidate.sellPrice).forEach((item, index) => { expected[item] = valuePayload(`price-${index}`); });
    candidate.priceText = expected;

    await importCandidate(page, candidate, "sell-price-attack.json");
    await page.getByRole("button", { name: "Sell prices", exact: true }).click();

    await expectAttackInert(page, requests);
    expect(await page.locator("[data-price]").evaluateAll(inputs =>
      Object.fromEntries(inputs.map(input => [input.dataset.price, input.value]))
    )).toEqual(expected);
  });

  test("every imported Forgie display string remains an exact input value", async ({ page }) => {
    const requests = await startAttackPage(page);
    const candidate = await currentCandidate(page);
    const expected = {};
    Object.keys(candidate.forgie).forEach((item, index) => { expected[item] = valuePayload(`forgie-${index}`); });
    candidate.forgieText = expected;

    await importCandidate(page, candidate, "forgie-attack.json");
    await page.getByRole("button", { name: "Lil' Forgie", exact: true }).click();

    await expectAttackInert(page, requests);
    expect(await page.locator("[data-forgie]").evaluateAll(inputs =>
      Object.fromEntries(inputs.map(input => [input.dataset.forgie, input.value]))
    )).toEqual(expected);
  });

  test("every imported inventory display string remains an exact input value", async ({ page }) => {
    const requests = await startAttackPage(page);
    const candidate = await currentCandidate(page);
    const expected = {};
    Object.keys(candidate.inventory).forEach((item, index) => { expected[item] = valuePayload(`inventory-${index}`); });
    candidate.inventoryText = expected;

    await importCandidate(page, candidate, "inventory-attack.json");
    await page.getByRole("button", { name: "Shopping list", exact: true }).click();

    await expectAttackInert(page, requests);
    expect(await page.locator("[data-inv]").evaluateAll(inputs =>
      Object.fromEntries(inputs.map(input => [input.dataset.inv, input.value]))
    )).toEqual(expected);
  });

  test("imported project names and descriptions remain exact text in every rendered project surface", async ({ page }) => {
    const requests = await startAttackPage(page);
    const candidate = await currentCandidate(page);
    const name = textPayload("project-name");
    const description = textPayload("project-description");
    candidate.mode = "project";
    candidate.projectSeq = false;
    candidate.projectGate = false;
    candidate.projects = [{
      id: "attack-project",
      catId: "attack-catalog",
      name,
      description,
      on: true,
      prio: null,
      from: 1,
      to: 1,
      done: 0,
      levels: [{ costs: [{ item: "Frames", qty: 1 }] }],
      _open: true,
    }];

    await importCandidate(page, candidate, "project-text-attack.json");
    await expect(page.locator("#results")).toContainText(name);
    await page.getByRole("button", { name: "Shopping list", exact: true }).click();
    await expect(page.locator("#projList .pname-static")).toContainText(name);
    await expect(page.locator("#projList .cat-card-desc")).toHaveText(description);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Track progress", exact: true }).click();
    await expect(page.locator("#progList .prog-proj-name")).toContainText(name);
    await expect(page.locator("#progList .prog-desc")).toHaveText(description);
    await expectAttackInert(page, requests);
  });

  test("an imported Manual preset ID cannot create markup", async ({ page }) => {
    const requests = await startAttackPage(page);
    const candidate = await currentCandidate(page);
    candidate.mode = "manual";
    candidate.manualSaved = [{ id: presetIdPayload("preset-id"), name: "Safe setup", config: candidate.manual.map(entry => ({ ...entry })) }];
    candidate.manualActiveId = null;

    await importCandidate(page, candidate, "preset-id-attack.json");

    await expectAttackInert(page, requests);
    await expect(page.getByRole("alert")).toContainText("safe ID format");
  });

  test("an imported Manual preset name remains exact option and button text", async ({ page }) => {
    const requests = await startAttackPage(page);
    const candidate = await currentCandidate(page);
    const name = textPayload("preset-name");
    candidate.mode = "manual";
    candidate.manualSaved = [{ id: "preset-safe", name, config: candidate.manual.map(entry => ({ ...entry })) }];
    candidate.manualActiveId = "preset-safe";

    await importCandidate(page, candidate, "preset-name-attack.json");

    await expect(page.locator("#manualPreset option[value='preset-safe']")).toHaveText(name);
    await expect(page.locator("#manualUpdate")).toContainText(name);
    await expectAttackInert(page, requests);
  });

  test("solver exception text is rendered as inert text", async ({ page }) => {
    const requests = await startAttackPage(page);
    const message = textPayload("solver-error");

    await expect(page.locator("#solveOverlay")).toBeHidden();
    await page.evaluate(value => {
      if (_solveWorker) _solveWorker.terminate();
      _solveReq++;
      _solvePending = null;
      solveError(value);
    }, message);

    await expectAttackInert(page, requests);
    await expect(page.locator("#results")).toHaveText(`Solver error. ${message}`);
  });

  test("clean text values survive import, export, reset, and re-import exactly", async ({ page }) => {
    await startAttackPage(page);
    const candidate = await currentCandidate(page);
    const exact = `  1.20qa <sample> & \"quoted\" 'value'  `;
    candidate.priceText.Frames = exact;
    candidate.forgieText.Bits = exact;
    candidate.inventoryText.Ingots = exact;
    candidate.projects = [{ id: "roundtrip-project", name: exact, description: exact, on: true, prio: null, from: 1, to: 1, done: 0, levels: [{ costs: [] }], _open: true }];
    candidate.manualSaved = [{ id: "roundtrip-preset", name: exact, config: candidate.manual.map(entry => ({ ...entry })) }];
    candidate.manualActiveId = "roundtrip-preset";

    await importCandidate(page, candidate, "clean-text.json");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export build", exact: true }).click();
    const download = await downloadPromise;
    const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
    expect(exported.priceText.Frames).toBe(exact);
    expect(exported.forgieText.Bits).toBe(exact);
    expect(exported.inventoryText.Ingots).toBe(exact);
    expect(exported.projects[0].name).toBe(exact);
    expect(exported.projects[0].description).toBe(exact);
    expect(exported.manualSaved[0].name).toBe(exact);

    await page.evaluate(key => localStorage.removeItem(key), STORAGE_KEY);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#fileImport").setInputFiles({
      name: "roundtrip.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(exported)),
    });
    await page.getByRole("button", { name: "Sell prices", exact: true }).click();
    await expect(page.locator("[data-price='Frames']")).toHaveValue(exact);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Lil' Forgie", exact: true }).click();
    await expect(page.locator("[data-forgie='Bits']")).toHaveValue(exact);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Shopping list", exact: true }).click();
    await expect(page.locator("[data-inv='Ingots']")).toHaveValue(exact);
    await expect(page.locator("[data-pname='0']")).toHaveValue(exact);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await expect(page.locator("#manualPreset option[value='roundtrip-preset']")).toHaveText(exact);
  });
});

test.describe("static Content Security Policy", () => {
  test.use({ bypassCSP: false });

  test("deployment headers and the meta fallback enforce the same script boundary", async ({ page }) => {
    const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
    const route = config.headers.find(entry => entry.source === "/(.*)");
    const header = route && route.headers.find(entry => entry.key === "Content-Security-Policy");
    expect(header).toBeTruthy();

    await page.goto("/", { waitUntil: "domcontentloaded" });
    const fallback = await page.locator("meta[http-equiv='Content-Security-Policy']").getAttribute("content");
    for (const policy of [header.value, fallback]) {
      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain("script-src 'self'");
      expect(policy).toContain("object-src 'none'");
      expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    }
    expect(header.value).toContain("frame-ancestors 'none'");
  });

  test("allows the current app while blocking inline script and analytics requests", async ({ page }) => {
    const requests = [];
    const consoleMessages = [];
    page.on("request", request => requests.push(request.url()));
    page.on("console", message => consoleMessages.push(message.text()));

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#results")).toContainText("Line assignment");
    const inlineRan = await page.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "window.__forgeInlineScriptRan = true";
      document.head.appendChild(script);
      script.remove();
      return window.__forgeInlineScriptRan === true;
    });

    expect(inlineRan).toBe(false);
    expect(requests.some(url => url.includes("/_vercel/insights"))).toBe(false);
    expect(consoleMessages.filter(message => /Content Security Policy/i.test(message))).toHaveLength(1);
  });
});
