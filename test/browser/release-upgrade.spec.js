"use strict";

const { randomUUID } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { buildStaticSite } = require("../../scripts/build-static.cjs");
const { createStaticServer } = require("../serve-vercel-config.cjs");

const root = path.resolve(__dirname, "..", "..");
const mounts = ["", "/Forge-Planner"];
let suiteRoot;
let releaseA;
let releaseB;

function copyReleaseSource(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of ["assets", "compat", "css", "js"]) {
    fs.cpSync(path.join(root, entry), path.join(destination, entry), { recursive: true });
  }
  fs.copyFileSync(path.join(root, "index.html"), path.join(destination, "index.html"));
}

function addReleaseSentinel(sourceRoot, release) {
  const htmlFile = path.join(sourceRoot, "index.html");
  const html = fs.readFileSync(htmlFile, "utf8");
  const headEnd = "</head>";
  if (!html.includes(headEnd)) throw new Error("Release fixture could not find </head>");
  fs.writeFileSync(htmlFile, html.replace(
    headEnd,
    `<meta name="forge-release-sentinel" content="${release}">\n${headEnd}`
  ));

  const appFile = path.join(sourceRoot, "js", "catalog.js");
  fs.appendFileSync(appFile, `\n;(()=>{\n` +
    `  const appRelease=${JSON.stringify(release)};\n` +
    `  const marker=document.querySelector('meta[name="forge-release-sentinel"]');\n` +
    `  const htmlRelease=marker&&marker.content;\n` +
    `  if(htmlRelease!==appRelease)throw new Error("Mixed Forge Planner release: HTML "+htmlRelease+" loaded app "+appRelease);\n` +
    `  globalThis.__FORGE_APP_RELEASE_SENTINEL__=appRelease;\n` +
    `})();\n`);
}

function buildRelease(release) {
  const sourceRoot = path.join(suiteRoot, `source-${release}`);
  const outputRoot = path.join(suiteRoot, `dist-${release}`);
  copyReleaseSource(sourceRoot);
  addReleaseSentinel(sourceRoot, release);
  buildStaticSite({ sourceRoot, outputRoot });
  return outputRoot;
}

function pageUrl(origin, mount) {
  return `${origin}${mount}/`;
}

function installHealthCollectors(page, origin) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const failedResponses = [];
  const sameOriginWorkerRequests = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("requestfailed", request => {
    failedRequests.push(`${request.method()} ${request.url()}: ${request.failure() && request.failure().errorText}`);
  });
  page.on("response", response => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin === origin && request.resourceType() === "worker") {
      sameOriginWorkerRequests.push(url.pathname);
    }
  });
  return { consoleErrors, pageErrors, failedRequests, failedResponses, sameOriginWorkerRequests };
}

async function installWorkerObservation(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__releaseWorkerUrls = [];
    window.Worker = class ObservedReleaseWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        window.__releaseWorkerUrls.push(String(url));
      }
    };
  });
}

async function releaseIdentity(page) {
  return page.evaluate(() => {
    const html = document.querySelector('meta[name="forge-release-sentinel"]');
    const linkedUrls = [
      ...[...document.scripts].map(node => node.src),
      ...[...document.querySelectorAll("link[href]")].map(node => node.href),
    ];
    const tooltipUrls = [...document.documentElement.innerHTML.matchAll(/static\/(?:dupe|speed)\.[0-9a-f]{16}\.jpg/g)]
      .map(match => new URL(match[0], location.href).href);
    const staticUrls = [...linkedUrls, ...tooltipUrls].filter(candidate => {
      if (!candidate) return false;
      const url = new URL(candidate, location.href);
      return url.origin === location.origin && /\/static\//.test(url.pathname);
    });
    const appUrl = staticUrls.find(candidate => /\/static\/app\.[0-9a-f]{16}\.js$/.test(new URL(candidate).pathname));
    return {
      html: html && html.content,
      app: globalThis.__FORGE_APP_RELEASE_SENTINEL__,
      appUrl,
      unchangedUrls: [...new Set(staticUrls.filter(candidate => candidate !== appUrl))].sort(),
    };
  });
}

function waitForAppResponse(page, origin) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === origin && /\/static\/app\.[0-9a-f]{16}\.js$/.test(url.pathname);
  });
}

async function expectReleaseHeaders(response, { immutable }) {
  const headers = await response.allHeaders();
  expect(headers.etag).toBeTruthy();
  expect(headers["last-modified"]).toBeTruthy();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("worker-src 'self' blob:");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  if (immutable) {
    expect(headers["cache-control"]).toContain("max-age=31536000");
    expect(headers["cache-control"]).toContain("immutable");
  } else {
    expect(headers["cache-control"]).toContain("max-age=0");
    expect(headers["cache-control"]).toContain("must-revalidate");
  }
  return headers;
}

async function digestUrls(page, urls) {
  return page.evaluate(async candidates => {
    const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
    const out = {};
    for (const candidate of candidates) {
      const url = new URL(candidate, location.href);
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`${url.pathname} returned ${response.status}`);
      out[url.pathname] = hex(await crypto.subtle.digest("SHA-256", await response.arrayBuffer()));
    }
    return out;
  }, urls);
}

async function solveWithCurrentBlobWorker(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const state = defaults();
    state.schemaVersion = CURRENT_SCHEMA_VERSION;
    state.mode = "items";
    state.solveBudget = 2_000;
    normalize(state);
    syncManual(state);
    const worker = __forgeCreateSolverWorker();
    const release = () => {
      if (typeof worker.__forgeRelease === "function") worker.__forgeRelease();
    };
    const timeout = setTimeout(() => {
      release();
      worker.terminate();
      reject(new Error("Release Blob Worker solve timed out"));
    }, 10_000);
    worker.onmessage = event => {
      clearTimeout(timeout);
      release();
      worker.terminate();
      if (event.data && event.data.error) reject(new Error(event.data.error));
      else resolve({ response: event.data, workerUrls: window.__releaseWorkerUrls.slice() });
    };
    worker.onerror = event => {
      clearTimeout(timeout);
      release();
      worker.terminate();
      reject(new Error(event.message || "Release Blob Worker solve failed"));
    };
    worker.postMessage({
      reqId: 20260802,
      generation: 20260802,
      mode: state.mode,
      stateRevision: 1,
      state,
      budget: state.solveBudget,
      stab: {},
    });
  }));
}

async function permanentWorkerDigests(page) {
  return page.evaluate(async () => {
    const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
    const out = {};
    for (const relative of ["js/solver.worker.js", "js/solver.worker.v2.js"]) {
      const url = new URL(relative, location.href);
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`${url.pathname} returned ${response.status}`);
      const bytes = await response.arrayBuffer();
      out[url.pathname] = {
        cacheControl: response.headers.get("cache-control"),
        sha256: hex(await crypto.subtle.digest("SHA-256", bytes)),
      };
    }
    return out;
  });
}

function countSnapshot(controller, scope) {
  const metrics = controller.requestMetrics(scope);
  return JSON.parse(JSON.stringify(metrics.counts || {}));
}

function expectHealthy(health) {
  expect(health.consoleErrors, "unexpected console errors").toEqual([]);
  expect(health.pageErrors, "unexpected page errors").toEqual([]);
  expect(health.failedRequests, "unexpected failed requests").toEqual([]);
  expect(health.failedResponses, "unexpected HTTP error responses").toEqual([]);
  expect(health.sameOriginWorkerRequests, "the current release must use only Blob Workers").toEqual([]);
}

test.beforeAll(() => {
  suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-upgrade-"));
  releaseA = buildRelease("A");
  releaseB = buildRelease("B");
});

test.afterAll(() => {
  if (suiteRoot) fs.rmSync(suiteRoot, { recursive: true, force: true });
});

for (const mount of mounts) {
  const label = mount || "/";

  test(`@cold release B loads and solves from ${label}`, async ({ page, context }) => {
    const controller = createStaticServer({
      staticRoot: releaseB,
      host: "127.0.0.1",
      port: 0,
      mounts,
      enableRequestMetrics: true,
    });
    try {
      const { origin } = await controller.start();
      const scope = randomUUID();
      await context.addCookies([{ name: "forge-test-session", value: scope, url: origin }]);
      await installWorkerObservation(page);
      const health = installHealthCollectors(page, origin);

      const appResponsePromise = waitForAppResponse(page, origin);
      const documentResponse = await page.goto(pageUrl(origin, mount), { waitUntil: "domcontentloaded" });
      const appResponse = await appResponsePromise;
      expect(documentResponse.status()).toBe(200);
      await expectReleaseHeaders(documentResponse, { immutable: false });
      await expectReleaseHeaders(appResponse, { immutable: true });
      const identity = await releaseIdentity(page);
      expect(identity).toMatchObject({ html: "B", app: "B" });
      expect(identity.appUrl).toMatch(/\/static\/app\.[0-9a-f]{16}\.js$/);
      await expect(page.locator("#results")).toContainText("Line assignment");

      const solve = await solveWithCurrentBlobWorker(page);
      expect(solve.response).toMatchObject({
        reqId: 20260802,
        generation: 20260802,
        mode: "items",
        stateRevision: 1,
        res: { mode: "items", feasible: true },
      });
      expect(solve.workerUrls.length).toBeGreaterThan(0);
      expect(solve.workerUrls.every(url => url.startsWith("blob:"))).toBe(true);

      const permanent = await permanentWorkerDigests(page);
      expect(Object.keys(permanent)).toHaveLength(2);
      for (const contract of Object.values(permanent)) {
        expect(contract.cacheControl).toContain("immutable");
        expect(contract.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
      expectHealthy(health);
    } finally {
      await controller.close();
    }
  });

  test(`@warm-upgrade incompatible A to B stays coherent on one origin at ${label}`, async ({ page, context }) => {
    const controller = createStaticServer({
      staticRoot: releaseA,
      host: "127.0.0.1",
      port: 0,
      mounts,
      enableRequestMetrics: true,
    });
    try {
      const { origin } = await controller.start();
      const scope = randomUUID();
      await context.addCookies([{ name: "forge-test-session", value: scope, url: origin }]);
      await installWorkerObservation(page);
      const health = installHealthCollectors(page, origin);

      const aAppResponsePromise = waitForAppResponse(page, origin);
      const aDocument = await page.goto(pageUrl(origin, mount), { waitUntil: "domcontentloaded" });
      const aAppResponse = await aAppResponsePromise;
      const aHeaders = await expectReleaseHeaders(aDocument, { immutable: false });
      await expectReleaseHeaders(aAppResponse, { immutable: true });
      const aIdentity = await releaseIdentity(page);
      expect(aIdentity).toMatchObject({ html: "A", app: "A" });
      expect(aIdentity.appUrl).toMatch(/\/static\/app\.[0-9a-f]{16}\.js$/);
      expect(aHeaders.etag).toBeTruthy();
      expect(aHeaders["last-modified"]).toBeTruthy();
      await expect(page.locator("#results")).toContainText("Line assignment");

      const aPermanent = await permanentWorkerDigests(page);
      const aUnchanged = await digestUrls(page, aIdentity.unchangedUrls);
      for (const stem of ["styles", "favicon", "dupe", "speed"]) {
        expect(Object.keys(aUnchanged).some(pathname => new RegExp(`/static/${stem}\\.[0-9a-f]{16}\\.`).test(pathname)),
          `release fixture must warm the hashed ${stem} asset`).toBe(true);
      }
      const beforeSwap = countSnapshot(controller, scope);
      controller.setStaticRoot(releaseB);

      const bAppResponsePromise = waitForAppResponse(page, origin);
      const bDocument = await page.reload({ waitUntil: "domcontentloaded" });
      const bAppResponse = await bAppResponsePromise;
      const bHeaders = await expectReleaseHeaders(bDocument, { immutable: false });
      await expectReleaseHeaders(bAppResponse, { immutable: true });
      const bRequestHeaders = await bDocument.request().allHeaders();
      expect(bDocument.status(), "A validators must not turn changed B HTML into a 304").toBe(200);
      expect(bHeaders.etag).toBeTruthy();
      expect(bHeaders.etag).not.toBe(aHeaders.etag);
      expect(
        bRequestHeaders["if-none-match"] || bRequestHeaders["if-modified-since"],
        "the warm reload must revalidate HTML with its A validator"
      ).toBeTruthy();

      const bIdentity = await releaseIdentity(page);
      expect(bIdentity).toMatchObject({ html: "B", app: "B" });
      expect(bIdentity.appUrl).toMatch(/\/static\/app\.[0-9a-f]{16}\.js$/);
      expect(bIdentity.appUrl).not.toBe(aIdentity.appUrl);
      expect(bIdentity.unchangedUrls).toEqual(aIdentity.unchangedUrls);
      await expect(page.locator("#results")).toContainText("Line assignment");

      const bSolve = await solveWithCurrentBlobWorker(page);
      expect(bSolve.response).toMatchObject({
        reqId: 20260802,
        generation: 20260802,
        mode: "items",
        stateRevision: 1,
        res: { mode: "items", feasible: true },
      });
      expect(bSolve.workerUrls.length).toBeGreaterThan(0);
      expect(bSolve.workerUrls.every(url => url.startsWith("blob:"))).toBe(true);

      const bPermanent = await permanentWorkerDigests(page);
      expect(bPermanent).toEqual(aPermanent);
      const bUnchanged = await digestUrls(page, bIdentity.unchangedUrls);
      expect(bUnchanged).toEqual(aUnchanged);
      const afterSwap = countSnapshot(controller, scope);
      const aAppPath = new URL(aIdentity.appUrl).pathname;
      const bAppPath = new URL(bIdentity.appUrl).pathname;
      expect(beforeSwap[aAppPath] || 0, "release A app must have been warmed").toBeGreaterThan(0);
      expect(afterSwap[aAppPath], "release B must not request the incompatible A app again")
        .toBe(beforeSwap[aAppPath]);
      expect(
        (afterSwap[bAppPath] || 0) - (beforeSwap[bAppPath] || 0),
        "release B must request its own app exactly once"
      ).toBe(1);
      for (const unchangedUrl of aIdentity.unchangedUrls) {
        const pathname = new URL(unchangedUrl).pathname;
        expect(beforeSwap[pathname] || 0, `${pathname} must have been warmed`).toBeGreaterThan(0);
        expect(afterSwap[pathname] || 0, `${pathname} must be reused from immutable cache`)
          .toBe(beforeSwap[pathname] || 0);
      }
      for (const pathname of Object.keys(aPermanent)) {
        expect(beforeSwap[pathname] || 0, `${pathname} permanent contract must have been warmed`).toBeGreaterThan(0);
        expect(afterSwap[pathname] || 0, `${pathname} must remain cached across the upgrade`)
          .toBe(beforeSwap[pathname] || 0);
      }
      expectHealthy(health);
    } finally {
      await controller.close();
    }
  });
}
