"use strict";

const { test, expect } = require("@playwright/test");

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

async function installControllableWorker(page) {
  await page.addInitScript(() => {
    window.__controlledWorkers = [];
    window.__revokedWorkerUrls = [];
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => {
      window.__revokedWorkerUrls.push(String(url));
      return revokeObjectURL(url);
    };
    window.Worker = class ControlledWorker {
      constructor(url) {
        this.url = String(url);
        this.messages = [];
        this.terminated = false;
        this.listeners = { message: [], error: [] };
        window.__controlledWorkers.push(this);
      }
      addEventListener(type, listener) { this.listeners[type].push(listener); }
      postMessage(message) { this.messages.push(structuredClone(message)); }
      terminate() { this.terminated = true; }
    };
  });
}

async function waitForWorkers(page, count) {
  await expect.poll(() => page.evaluate(() => window.__controlledWorkers.length)).toBe(count);
}

async function emitWorkerMessage(page, workerIndex, messageIndex, body) {
  await page.evaluate(({ workerIndex, messageIndex, body }) => {
    const worker = window.__controlledWorkers[workerIndex];
    const sent = worker.messages[messageIndex];
    const event = { data: {
      reqId: sent.reqId,
      generation: sent.generation,
      mode: sent.mode,
      stateRevision: sent.stateRevision,
      ...body,
    } };
    worker.listeners.message.forEach(listener => listener(event));
    worker.onmessage(event);
  }, { workerIndex, messageIndex, body });
}

async function emitWorkerError(page, workerIndex, message = "controlled Worker failure") {
  await page.evaluate(({ workerIndex, message }) => {
    const worker = window.__controlledWorkers[workerIndex];
    const event = { message, preventDefault() {} };
    worker.listeners.error.forEach(listener => listener(event));
    worker.onerror(event);
  }, { workerIndex, message });
}

async function installFactoryWorker(page) {
  await page.evaluate(() => {
    window.__factoryWorkers = [];
    class FactoryWorker {
      constructor() {
        this.messages = [];
        this.terminated = false;
        window.__factoryWorkers.push(this);
      }
      postMessage(message) { this.messages.push(structuredClone(message)); }
      terminate() { this.terminated = true; }
    }
    solveService.setWorkerFactory(() => new FactoryWorker());
  });
}

async function waitForFactoryWorkers(page, count) {
  await expect.poll(() => page.evaluate(() => window.__factoryWorkers.length)).toBe(count);
}

async function emitFactoryWorkerMessage(page, workerIndex, messageIndex, result) {
  await page.evaluate(({ workerIndex, messageIndex, result }) => {
    const worker = window.__factoryWorkers[workerIndex];
    const sent = worker.messages[messageIndex];
    worker.onmessage({ data: {
      reqId: sent.reqId,
      generation: sent.generation,
      mode: sent.mode,
      stateRevision: sent.stateRevision,
      res: result,
    } });
  }, { workerIndex, messageIndex, result });
}

async function revision(page) {
  return page.evaluate(() => eval("stateRevision"));
}

test("rapid Credits to Manual switching cancels the Worker and ignores its stale completion", async ({ page }) => {
  await installControllableWorker(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForWorkers(page, 1);

  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  await waitForWorkers(page, 2);
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", false);

  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await expect(page.locator("#results")).toContainText("Manual mode.");
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true);
  expect(await page.evaluate(() => window.__controlledWorkers[1].terminated)).toBe(true);

  await emitWorkerMessage(page, 1, 0, { error: "stale Credits marker" });
  await expect(page.locator("#results")).toContainText("Manual mode.");
  await expect(page.locator("#results")).not.toContainText("stale Credits marker");
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true);
});

test("accepted GUI mutations advance revision synchronously before a solve is requested", async ({ page }) => {
  await installControllableWorker(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForWorkers(page, 1);
  const initial = await revision(page);

  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  const afterMode = await revision(page);
  expect(afterMode).toBe(initial + 1);
  await waitForWorkers(page, 2);
  expect(await page.evaluate(() => window.__controlledWorkers[1].messages[0].stateRevision)).toBe(afterMode);

  const speed = page.locator("[data-spx=\"0\"]");
  await speed.fill("51.25");
  const afterLine = await revision(page);
  expect(afterLine).toBe(afterMode + 1);
  await expect(page.locator("#staleBar")).toBeVisible();
});

test("reset cancels before state replacement and a stale result cannot alter the reset page", async ({ page }) => {
  await installControllableWorker(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForWorkers(page, 1);
  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  await waitForWorkers(page, 2);

  const beforeReset = await revision(page);
  const beforeStatus = await page.evaluate(() => solveService.status());
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Reset", exact: true }).click();

  const afterStatus = await page.evaluate(() => solveService.status());
  expect(afterStatus.generation).toBe(beforeStatus.generation + 2);
  expect(await revision(page)).toBe(beforeReset + 1);
  expect(await page.evaluate(() => window.__controlledWorkers[1].terminated)).toBe(true);
  await emitWorkerMessage(page, 1, 0, { error: "stale pre-reset marker" });
  await expect(page.locator("#results")).not.toContainText("stale pre-reset marker");
});

test("import cancels before transactional replacement and stale imported-over work stays inert", async ({ page }) => {
  await installControllableWorker(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForWorkers(page, 1);
  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  await waitForWorkers(page, 2);

  const candidate = JSON.parse(await page.evaluate(() => eval("JSON.stringify(S)")));
  candidate.mode = "project";
  candidate.lines[0].spx = 77;
  const beforeRevision = await revision(page);
  const beforeStatus = await page.evaluate(() => solveService.status());

  await page.locator("#fileImport").setInputFiles({
    name: "valid-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(candidate)),
  });
  await waitForWorkers(page, 3);

  const afterStatus = await page.evaluate(() => solveService.status());
  expect(afterStatus.generation).toBe(beforeStatus.generation + 2);
  expect(await revision(page)).toBe(beforeRevision + 1);
  expect(await page.evaluate(() => eval("S.mode"))).toBe("project");
  expect(await page.evaluate(() => window.__controlledWorkers[1].terminated)).toBe(true);

  await emitWorkerMessage(page, 1, 0, { error: "stale pre-import marker" });
  await expect(page.locator("#results")).not.toContainText("stale pre-import marker");
});

test("failed import rollback cancels candidate work before restoring accepted state", async ({ page }) => {
  await installControllableWorker(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForWorkers(page, 1);

  const beforeRaw = await page.evaluate(() => localStorage.getItem("forgePlannerState_v3"));
  const beforeState = await page.evaluate(() => JSON.stringify(S));
  const candidate = JSON.parse(beforeState);
  candidate.mode = candidate.mode === "credits" ? "items" : "credits";
  candidate.lines[0].spx = 88.75;
  await page.evaluate(() => {
    const realRenderAll = renderAll;
    let calls = 0;
    renderAll = function failCandidateAndRollbackRender() {
      calls++;
      if (calls === 1) {
        realRenderAll();
        throw new Error("candidate render failed after starting solve");
      }
      throw new Error("rollback render failed before starting replacement work");
    };
  });

  await page.locator("#fileImport").setInputFiles({
    name: "candidate-render-failure.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(candidate)),
  });

  await expect(page.getByRole("alert")).toContainText("could not be rendered");
  await waitForWorkers(page, 2);
  expect(await page.evaluate(() => window.__controlledWorkers[1].terminated)).toBe(true);
  expect(await page.evaluate(() => JSON.stringify(S))).toBe(beforeState);
  expect(await page.evaluate(() => localStorage.getItem("forgePlannerState_v3"))).toBe(beforeRaw);
  expect(await page.evaluate(() => solveService.status().active)).toBe(false);
  expect(await page.evaluate(() => solveService.status().fallbackActive)).toBe(false);
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true);
  await expect(page.locator("#solveFallback")).toBeHidden();
});

test("Worker failure falls back accessibly, then a later request retries and recovers", async ({ page }) => {
  await installControllableWorker(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForWorkers(page, 1);

  await emitWorkerError(page, 0, "failed to load solver script");
  await expect(page.locator("#solveFallback")).toBeVisible();
  await expect(page.locator("#solveFallback")).toContainText("slower fallback");
  await expect.poll(() => page.evaluate(() => solveService.status().fallbackActive)).toBe(true);
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true, { timeout: 10_000 });

  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  await waitForWorkers(page, 2);
  await emitWorkerMessage(page, 1, 0, { error: "controlled valid Worker response" });

  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true);
  await expect(page.locator("#solveFallback")).toBeHidden();
  expect(await page.evaluate(() => solveService.status().workerFailures)).toBe(0);
});

test("a completed idle Worker's late error disposes it silently before the next solve", async ({ page }) => {
  await installControllableWorker(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForWorkers(page, 1);

  await emitWorkerMessage(page, 0, 0, { error: "controlled completed request" });
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true);
  expect(await page.evaluate(() => solveService.status().active)).toBe(false);

  await emitWorkerError(page, 0, "late failure after delivery");

  expect(await page.evaluate(() => solveService.status())).toMatchObject({
    active: false,
    workerOwned: false,
    workerBusy: false,
    workerFailures: 0,
    fallbackActive: false,
  });
  expect(await page.evaluate(() => solveService.status().retryInMs)).toBe(0);
  expect(await page.evaluate(() => window.__controlledWorkers[0].terminated)).toBe(true);
  await expect(page.locator("#solveFallback")).toBeHidden();
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true);

  await page.getByRole("button", { name: "Max credits/hr", exact: true }).click();
  await waitForWorkers(page, 2);
  await emitWorkerMessage(page, 1, 0, { error: "controlled replacement completion" });

  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true);
  await expect(page.locator("#solveFallback")).toBeHidden();
  expect(await page.evaluate(() => solveService.status().workerFailures)).toBe(0);
});

test("entering Manual after fallback clears the inactive fallback notice", async ({ page }) => {
  await installControllableWorker(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForWorkers(page, 1);

  await emitWorkerError(page, 0, "failed to load solver script");
  await expect(page.locator("#solveFallback")).toBeVisible();
  await page.getByRole("button", { name: "Manual", exact: true }).click();

  await expect(page.locator("#results")).toContainText("Manual mode.");
  await expect(page.locator("#solveFallback")).toBeHidden();
  await expect(page.locator("#solveFallback")).toHaveText("");
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true);
  expect(await page.evaluate(() => solveService.status().fallbackActive)).toBe(false);
  expect(await page.evaluate(() => solveService.status().active)).toBe(false);
});

test("page teardown fully cancels the owned Worker and overlay", async ({ page }) => {
  await installControllableWorker(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForWorkers(page, 1);
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", false);

  await page.evaluate(() => {
    mutateState(state => { state.targets.Frames.w = 2; });
    scheduleSolve();
  });

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));

  expect(await page.evaluate(() => window.__controlledWorkers[0].terminated)).toBe(true);
  expect(await page.evaluate(() => window.__revokedWorkerUrls))
    .toEqual([await page.evaluate(() => window.__controlledWorkers[0].url)]);
  expect(await page.evaluate(() => solveService.status().active)).toBe(false);
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true);
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => window.__controlledWorkers.length)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("forgePlannerState_v3")).targets.Frames.w)).toBe(2);
});

test("Progress consumes the authoritative cache and shares one slow factory solve with the main panel", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true, { timeout: 15_000 });
  await page.evaluate(() => {
    const source = PROJECT_CATALOG[0];
    mutateState(state => {
      state.mode = "project";
      state.projects = [{
        id: "factory-progress",
        catId: source.catId,
        name: source.name,
        description: source.description || "",
        on: true,
        prio: null,
        from: 1,
        to: source.levels.length,
        done: 0,
        levels: JSON.parse(JSON.stringify(source.levels)),
        _open: false,
      }];
    });
    save();
    renderModeSwitch();
    renderResults();
  });
  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true, { timeout: 15_000 });
  await expect(page.locator("#btnProgress")).toBeVisible();

  const controlledResult = await page.evaluate(() => structuredClone(eval("_lastProjectRes")));
  await installFactoryWorker(page);
  await page.evaluate(() => {
    window.__mainThreadProjectOptimizations = 0;
    optimizeProjectTop = function forbiddenProgressOptimization() {
      window.__mainThreadProjectOptimizations += 1;
      throw new Error("Progress must not optimize on the main thread");
    };
  });

  await page.locator("#btnProgress").click();
  await expect(page.locator("#progSummary")).not.toContainText("out of date");
  await page.locator("#progList .prog-lvl").first().click();
  expect(await page.evaluate(() => S.projects[0].done)).toBe(1);
  await expect(page.locator("#progSummary")).toContainText("updating");
  await waitForFactoryWorkers(page, 1);
  expect(await page.evaluate(() => window.__factoryWorkers[0].messages.length)).toBe(1);

  await page.evaluate(() => {
    mutateState(state => {
      state.planStart = 2_000;
      state.projects[0]._open = !state.projects[0]._open;
    });
    schedulePersist();
  });
  await emitFactoryWorkerMessage(page, 0, 0, controlledResult);

  await expect(page.locator("#solveOverlay")).toHaveJSProperty("hidden", true);
  await expect(page.locator("#progSummary")).not.toContainText(/updating|out of date/i);
  await expect(page.locator("#solveStat")).toContainText(/Plan updated|Schedule blocked/);
  expect(await page.evaluate(() => window.__mainThreadProjectOptimizations)).toBe(0);
  expect(await page.evaluate(() => window.__factoryWorkers.length)).toBe(1);

  await page.getByRole("button", { name: "Done reviewing progress", exact: true }).click();
  await page.locator("[data-spx=\"0\"]").fill("51.25");
  await page.locator("#btnProgress").click();
  await expect(page.locator("#progSummary")).toContainText("out of date");
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => window.__factoryWorkers.length)).toBe(1);
  expect(await page.evaluate(() => window.__factoryWorkers[0].messages.length)).toBe(1);
  expect(await page.evaluate(() => window.__mainThreadProjectOptimizations)).toBe(0);
});
