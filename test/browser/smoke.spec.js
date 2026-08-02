"use strict";

const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const frozenV2 = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "fixtures", "solver-worker-v2-request.json"), "utf8"
));

if (process.env.PLAYWRIGHT_CHROME_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROME_PATH } });
}

async function isolateRequestCounts(page) {
  await page.context().addCookies([{
    name: "forge-test-session",
    value: randomUUID(),
    url: "http://127.0.0.1:4173/",
  }]);
}

function responseContract(message) {
  return {
    reqId: message.reqId,
    generation: message.generation,
    mode: message.mode,
    stateRevision: message.stateRevision,
    res: {
      empty: message.res.empty,
      mode: message.res.mode,
      issues: message.res.issues,
      targets: message.res.targets,
      feasible: message.res.feasible,
      plan: message.res.plan.map(line => ({
        line: line.line,
        max: line.max,
        job: { label: line.job.label, kind: line.job.kind },
      })),
    },
  };
}

test("the retired original Worker URL errors once and stays in the browser cache", async ({ page }) => {
  await isolateRequestCounts(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const retiredUrls = ["/js/solver.worker.js"];
  const runRetiredWorkers = () => page.evaluate(async urls => Promise.all(urls.map(url => new Promise((resolve, reject) => {
    const worker = new Worker(url);
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`${url} did not fail`));
    }, 3_000);
    worker.onmessage = event => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`retired Worker posted a caught response: ${JSON.stringify(event.data)}`));
    };
    worker.onerror = event => {
      clearTimeout(timeout);
      event.preventDefault();
      worker.terminate();
      resolve(event.message);
    };
    worker.postMessage({ reqId: 1, state: { mode: "items" }, budget: 200, stab: {} });
  }))), retiredUrls);
  const requestCounts = () => page.evaluate(async () => {
    const response = await fetch("/__test/request-counts", { cache: "no-store" });
    return response.json();
  });

  const messages = await runRetiredWorkers();
  const afterFirstAttempt = await requestCounts();
  await runRetiredWorkers();
  const afterSecondAttempt = await requestCounts();

  expect(messages).toEqual([
    expect.stringContaining("Refresh to restore background solving"),
  ]);
  for (const url of retiredUrls) {
    expect(afterFirstAttempt[url] || 0).toBeGreaterThan(0);
    expect(afterSecondAttempt[url], `${url} retry must stay in the browser cache`).toBe(afterFirstAttempt[url]);
  }
});

test("the frozen v2 Worker keeps current legacy tabs solving without dependency requests", async ({ page }) => {
  await isolateRequestCounts(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const requestCounts = () => page.evaluate(async () => {
    const response = await fetch("/__test/request-counts", { cache: "no-store" });
    return response.json();
  });
  const solveWithV2 = () => page.evaluate(request => new Promise((resolve, reject) => {
    const worker = new Worker("/js/solver.worker.v2.js");
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("v2 compatibility Worker timed out"));
    }, 10_000);
    worker.onmessage = event => {
      clearTimeout(timeout);
      worker.terminate();
      if (event.data && event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = event => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || "v2 compatibility Worker failed"));
    };
    worker.postMessage(request);
  }), frozenV2.request);

  const first = await solveWithV2();
  expect(responseContract(first)).toEqual(frozenV2.response);
  const afterFirstSolve = await requestCounts();
  const second = await solveWithV2();
  expect(responseContract(second)).toEqual(frozenV2.response);
  const afterSecondSolve = await requestCounts();
  expect(afterFirstSolve["/js/solver.worker.v2.js"] || 0).toBeGreaterThan(0);
  expect(afterSecondSolve["/js/solver.worker.v2.js"], "v2 reuse must stay in the browser cache")
    .toBe(afterFirstSolve["/js/solver.worker.v2.js"]);
  for (const dependency of ["core.js", "fields.js", "state.js", "solver.js"]) {
    expect(afterSecondSolve[`/js/${dependency}`] || 0).toBe(0);
  }
});

test("the planner serves, solves in its Worker, and opens every planning mode", async ({ page }) => {
  const consoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const sameOriginWorkerRequests = [];
  const workerPromise = page.waitForEvent("worker", worker =>
    worker.url().startsWith("blob:")
  );

  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__forgeWorkerResponses = [];
    window.__forgeWorkerCreations = [];
    window.Worker = class ObservedWorker extends NativeWorker {
      constructor(...args) {
        super(...args);
        window.__forgeWorkerCreations.push(String(args[0]));
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
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:4173" && request.resourceType() === "worker") {
      sameOriginWorkerRequests.push(url.pathname);
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await workerPromise;
  await expect.poll(async () => page.evaluate(() =>
    (window.__forgeWorkerResponses || []).some(response => response && response.res && !response.error)
  )).toBe(true);
  await expect(page.locator("#results")).toContainText("Line assignment");
  const projectWorkerResult = await page.evaluate(() => new Promise((resolve, reject) => {
    const state = defaults();
    state.mode = "project";
    state.dupe = 0;
    state.lines = [
      {max:64,spx:20,turbo:0},{max:64,spx:18,turbo:0},{max:32,spx:16,turbo:0},
      {max:16,spx:14,turbo:0},{max:8,spx:12,turbo:0},
    ];
    state.projects = [{ id: "smoke-project", name: "Worker Project", catId: "", on: true,
      from: 1, to: 1, done: 0, prio: null, levels: [{ costs: [{ item: "Frames", qty: 10_000 }] }] }];
    normalize(state);syncManual(state);
    const worker = __forgeCreateSolverWorker();
    const release = () => { if(typeof worker.__forgeRelease === "function")worker.__forgeRelease(); };
    const timeout = setTimeout(() => { release();worker.terminate();reject(new Error("Project Worker solve timed out")); }, 10_000);
    worker.onmessage = event => {
      clearTimeout(timeout);release();worker.terminate();
      if(event.data&&event.data.error)reject(new Error(event.data.error));else resolve(event.data&&event.data.res);
    };
    worker.onerror = event => { clearTimeout(timeout);release();worker.terminate();reject(new Error(event.message||"Project Worker failed")); };
    worker.postMessage({reqId:991,generation:991,mode:"project",stateRevision:1,state,budget:state.solveBudget,stab:{}});
  }));
  expect(projectWorkerResult.mode).toBe("project");
  expect(projectWorkerResult.scheduleValidation.ok).toBe(true);
  expect(projectWorkerResult.executionPhases.some(phase => phase.kind === "prerequisite" && phase.externalSupply.Bits === 80_000)).toBe(true);
  expect(projectWorkerResult.executionPhases.some(phase => phase.kind === "warmup")).toBe(true);
  expect(projectWorkerResult.eta).toBeGreaterThan(projectWorkerResult.workEta);
  expect(projectWorkerResult.scheduleValidation.boundaries.every(boundary =>
    Object.values(boundary.inventory || {}).every(value => value >= -1e-6)
  )).toBe(true);

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

  const secondWorker = page.waitForEvent("worker", worker => worker.url().startsWith("blob:"));
  await page.getByRole("button", { name: "Max items/hr", exact: true }).click();
  await secondWorker;
  await expect(page.locator("#results")).toContainText("Line assignment");
  const creations = await page.evaluate(() => window.__forgeWorkerCreations || []);
  expect(creations).toHaveLength(3);
  expect(creations.every(url => url.startsWith("blob:"))).toBe(true);
  expect(sameOriginWorkerRequests, "Blob Worker creation must not reach the server").toEqual([]);

  expect(consoleErrors, "unexpected console errors").toEqual([]);
  expect(pageErrors, "unexpected page errors").toEqual([]);
  expect(failedResponses, "unexpected failed HTTP responses").toEqual([]);
});

test("a second visit revalidates only HTML and reuses every unchanged local asset", async ({ page }) => {
  await isolateRequestCounts(page);
  const counts = () => page.evaluate(async () => {
    const response = await fetch("/__test/request-counts", { cache: "no-store" });
    return response.json();
  });

  await page.goto("/", { waitUntil: "networkidle" });
  const before = await counts();
  await page.goto("about:blank");
  await page.goto("/", { waitUntil: "networkidle" });
  const after = await counts();

  expect((after["/"] || 0) - (before["/"] || 0)).toBe(1);
  const staticPaths = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(pathname => pathname.startsWith("/static/"));
  expect(staticPaths.length).toBeGreaterThan(0);
  for (const pathname of staticPaths) {
    expect(after[pathname] || 0, `${pathname} should come from the browser cache`).toBe(before[pathname]);
  }
});
