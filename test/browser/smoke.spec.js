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

test("the generated current Blob Worker exposes the exact Gel capacity helper without script requests", async ({ page }) => {
  await isolateRequestCounts(page);
  const workerScriptRequests = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === "http://127.0.0.1:4173" &&
      (request.resourceType() === "worker" || /\/js\/solver\.worker(?:\.v2)?\.js$/.test(url.pathname))) {
      workerScriptRequests.push(url.pathname);
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const probe = await page.evaluate(async () => {
    const appendedHandler = `
self.onmessage = function () {
  S = defaults();
  S.dupe = 0;
  S.maxTurbo = 0;
  const rows = [
    { __i: 0, max: 1, spx: 6, turbo: 0 },
    { __i: 1, max: 1, spx: 4, turbo: 0 },
    { __i: 2, max: 1, spx: 4, turbo: 0 },
  ];
  self.postMessage(gelLoadout(rows, 4498594189315839));
};`;
    const nativeRevoke = URL.revokeObjectURL;
    const revoked = [];
    URL.revokeObjectURL = function (candidate) {
      revoked.push(String(candidate));
      return nativeRevoke.call(URL, candidate);
    };
    let objectUrl = null;
    let worker = null;
    let result = null;
    try {
      objectUrl = URL.createObjectURL(new Blob([
        __FORGE_SOLVER_WORKER_SOURCE__,
        "\n;\n",
        appendedHandler,
      ], { type: "text/javascript" }));
      worker = new Worker(objectUrl);
      result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("exact Gel Worker probe timed out")), 10_000);
        worker.onmessage = event => {
          clearTimeout(timeout);
          resolve(event.data);
        };
        worker.onerror = event => {
          clearTimeout(timeout);
          reject(new Error(event.message || "exact Gel Worker probe failed"));
        };
        worker.postMessage({ probe: "gel-loadout-exact" });
      });
    } finally {
      if (worker) worker.terminate();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      URL.revokeObjectURL = nativeRevoke;
    }
    return { objectUrl, result, revoked };
  });
  const requestCounts = await page.evaluate(async () => {
    const response = await fetch("/__test/request-counts", { cache: "no-store" });
    return response.json();
  });

  expect(probe.result.perLine.map(line => [line.__i, line.L])).toEqual([[1, 1], [2, 1]]);
  expect(probe.result.gelHr).toBeCloseTo(8.997188378631677, 12);
  expect(probe.result.vespHr).toBeLessThanOrEqual(4498594189315839);
  expect(probe.revoked).toContain(probe.objectUrl);
  expect(workerScriptRequests, "the appended Blob Worker must not fetch a Worker script").toEqual([]);
  expect(requestCounts["/js/solver.worker.js"] || 0).toBe(0);
  expect(requestCounts["/js/solver.worker.v2.js"] || 0).toBe(0);
});

test("the generated current Blob Worker preserves Credits warning ownership", async ({ page }) => {
  await isolateRequestCounts(page);
  const workerScriptRequests = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === "http://127.0.0.1:4173" &&
      (request.resourceType() === "worker" || /\/js\/solver\.worker(?:\.v2)?\.js$/.test(url.pathname))) {
      workerScriptRequests.push(url.pathname);
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const response = await page.evaluate(async () => {
    const state = defaults();
    state.mode = "credits";
    state.margin = 20;
    [...RAWS, ...PRODUCTS].forEach(item => { state.sellPrice[item] = null; });
    state.sellPrice.Bits = 1;
    state.sellPrice.Glass = 1;
    state.solveBudget = 2_000;
    normalize(state);
    syncManual(state);
    const worker = __forgeCreateSolverWorker();
    const release = () => { if (typeof worker.__forgeRelease === "function") worker.__forgeRelease(); };
    try {
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Credits Worker contract probe timed out")), 10_000);
        worker.onmessage = event => { clearTimeout(timeout);resolve(event.data); };
        worker.onerror = event => { clearTimeout(timeout);reject(new Error(event.message || "Credits Worker contract probe failed")); };
        worker.postMessage({ reqId: 992, generation: 992, mode: "credits", stateRevision: 1,
          state, budget: state.solveBudget, stab: {} });
      });
    } finally {
      release();
      worker.terminate();
    }
  });
  const requestCounts = await page.evaluate(async () => {
    const response = await fetch("/__test/request-counts", { cache: "no-store" });
    return response.json();
  });

  expect(response).toMatchObject({ reqId: 992, generation: 992, mode: "credits", stateRevision: 1 });
  expect(response.error).toBeUndefined();
  const result = response.res;
  const bits = result.ranking.find(candidate => candidate.item === "Bits");
  const glass = result.ranking.find(candidate => candidate.item === "Glass");
  expect(result.bestItem).toBe("Bits");
  expect(result.usesMargin).toBe(false);
  expect(result.capped).toBe(bits.capped);
  expect(result.allCandidatesEvaluated).toBe(true);
  expect(typeof result.deadlineReached).toBe("boolean");
  expect(typeof result.searchExhaustive).toBe("boolean");
  expect(bits).toMatchObject({ usesMargin: false, evaluated: true });
  expect(glass).toMatchObject({ usesMargin: true, evaluated: true });
  expect(result.ranking.every(candidate =>
    typeof candidate.capped === "boolean" && typeof candidate.ms === "number"
  )).toBe(true);
  expect(workerScriptRequests, "the current Credits Blob Worker must not fetch a Worker script").toEqual([]);
  expect(requestCounts["/js/solver.worker.js"] || 0).toBe(0);
  expect(requestCounts["/js/solver.worker.v2.js"] || 0).toBe(0);
});

test("the generated current Blob Worker honors the shared Credits deadline", async ({ page }) => {
  await isolateRequestCounts(page);
  const workerScriptRequests = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === "http://127.0.0.1:4173" &&
      (request.resourceType() === "worker" || /\/js\/solver\.worker(?:\.v2)?\.js$/.test(url.pathname))) {
      workerScriptRequests.push(url.pathname);
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const probe = await page.evaluate(async () => {
    const state = defaults();
    state.mode = "credits";
    state.lines = [512, 512, 256, 128, 64, 64, 32, 512, 128, 64, 256, 32]
      .map((max, index) => ({ max, spx: 40 + (index * 7 % 13), turbo: 0 }));
    ALLITEMS.forEach(item => { state.sellPrice[item] = 1; });
    state.solveBudget = 200;
    normalize(state);
    syncManual(state);
    const worker = __forgeCreateSolverWorker();
    const release = () => { if (typeof worker.__forgeRelease === "function") worker.__forgeRelease(); };
    const started = performance.now();
    try {
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("bounded Credits Worker probe timed out")), 10_000);
        worker.onmessage = event => { clearTimeout(timeout);resolve(event.data); };
        worker.onerror = event => { clearTimeout(timeout);reject(new Error(event.message || "bounded Credits Worker probe failed")); };
        worker.postMessage({ reqId: 993, generation: 993, mode: "credits", stateRevision: 2,
          state, budget: state.solveBudget, stab: {} });
      });
      return { response, elapsed: performance.now() - started, catalog: ALLITEMS.slice() };
    } finally {
      release();
      worker.terminate();
    }
  });
  const requestCounts = await page.evaluate(async () => {
    const response = await fetch("/__test/request-counts", { cache: "no-store" });
    return response.json();
  });

  expect(probe.response).toMatchObject({ reqId: 993, generation: 993, mode: "credits", stateRevision: 2 });
  expect(probe.response.error).toBeUndefined();
  expect(probe.elapsed, "a 200ms solve should return with only loose Worker/startup overhead").toBeLessThan(2_500);
  const result = probe.response.res;
  expect(result.ranking.map(candidate => candidate.item).sort()).toEqual(probe.catalog.slice().sort());
  expect(result.deadlineReached).toBe(true);
  expect(result.searchExhaustive).toBe(false);
  expect(!result.allCandidatesEvaluated || result.ranking.some(candidate => candidate.capped)).toBe(true);
  expect(result.ranking.every(candidate =>
    typeof candidate.evaluated === "boolean" && typeof candidate.capped === "boolean" && typeof candidate.ms === "number"
  )).toBe(true);
  expect(workerScriptRequests, "the bounded current Credits Blob Worker must not fetch a Worker script").toEqual([]);
  expect(requestCounts["/js/solver.worker.js"] || 0).toBe(0);
  expect(requestCounts["/js/solver.worker.v2.js"] || 0).toBe(0);
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
