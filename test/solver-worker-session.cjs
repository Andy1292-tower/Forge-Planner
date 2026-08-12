"use strict";

/* N6, enforced rather than described. The release-smoke script is a raw Node http client that runs
 * no page JavaScript, and it is not in CI at all, so nothing there can see what a page does to its
 * solver Workers over a long session. This drives the generated bundle's own bytes through a
 * scripted session instead: many solves, most of them superseded before they finish, on a page whose
 * pool cap is greater than one.
 *
 * What "no solver-source request" means here: the session has no network, so the claim is proved
 * structurally. Every Worker on the page must be constructed from the one in-memory payload URL, the
 * payload must be allocated exactly once however many Workers are built, and none of the primitives
 * that could fetch a script may be touched at all. A build that reverted to a per-Worker object URL,
 * or to a Worker constructed from a js/ path, fails on the first of those. */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const { buildStaticSite } = require("../scripts/build-static.cjs");

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function generatedApp(directory) {
  const names = fs.readdirSync(path.join(directory, "static")).filter(name => /^app\.[0-9a-f]{16}\.js$/.test(name));
  assert.equal(names.length, 1, `expected one generated app bundle, got ${names.join(", ")}`);
  return fs.readFileSync(path.join(directory, "static", names[0]), "utf8");
}

/* The Worker bootstrap the build generates, plus the solveService module, and nothing between them.
 * The page scripts in between own the DOM and would need the whole document to evaluate; the pair
 * taken here is the entire path from "the page wants a solve" to "a Worker exists". */
function workerLifecycleSource(app) {
  const catalogBoundary = app.indexOf(`\n;\n${fs.readFileSync(path.join(root, "js", "catalog.js"), "utf8")}`);
  assert.ok(catalogBoundary > 0, "generated app must retain the registered page-script boundary");
  const serviceAnchor = app.indexOf("const solveService=(()=>{");
  const serviceStart = app.lastIndexOf('"use strict";', serviceAnchor);
  const serviceEnd = app.indexOf("\n;\n", serviceAnchor);
  assert.ok(serviceStart > catalogBoundary && serviceEnd > serviceStart,
    "generated app must retain the solveService module boundary");
  return `${app.slice(0, catalogBoundary)}\n;\n${app.slice(serviceStart, serviceEnd)}`;
}

class FakeElement {
  constructor() { this.hidden = true; this.textContent = ""; }
}

function session(source, options = {}) {
  const workers = [];
  const urls = [];
  const revoked = [];
  const reachedNetwork = [];
  const timers = new Map();
  const elements = { solveOverlay: new FakeElement(), solveFallback: new FakeElement(), solveStat: new FakeElement() };
  let nextTimer = 1;

  class SessionWorker {
    constructor(url) {
      this.url = String(url);
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  // Anything that could pull a script over the wire. The page must not reach them at all, so they
  // record and throw rather than returning something a caller could carry on with.
  const forbidden = name => (...args) => {
    reachedNetwork.push({ name, args });
    throw new Error(`${name} is not available to a released page's solver path`);
  };

  const storage = new Map([["forgePlannerSolverPool", "on"]]);
  const context = {
    console,
    Blob: class SessionBlob { constructor(parts) { this.size = String(parts && parts[0] || "").length; } },
    URL: {
      createObjectURL() { const url = `blob:forge-solver-${urls.length + 1}`; urls.push(url); return url; },
      revokeObjectURL(url) { revoked.push(String(url)); },
    },
    Worker: SessionWorker,
    // Eight cores caps the pool at four, so the session runs on a page that is allowed more than one
    // Worker rather than one that is structurally incapable of having a second.
    navigator: { hardwareConcurrency: 8 },
    document: { getElementById(id) { return elements[id] || null; } },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    fetch: forbidden("fetch"),
    XMLHttpRequest: forbidden("XMLHttpRequest"),
    importScripts: forbidden("importScripts"),
    getLineStability() { return {}; },
    setLineStability() {},
    optimize() { context.fallbackSolves += 1; return { mode: "items", marker: "sync-fallback" }; },
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    S: { mode: "items", solveBudget: 200 },
    stateRevision: 0,
    delivered: 0,
    fallbackSolves: 0,
  };
  vm.createContext(context);
  vm.runInContext(options.mutate ? options.mutate(source) : source, context, { filename: "released-app-session.js" });

  return {
    workers, urls, revoked, reachedNetwork, elements, context,
    solve(revision, marker) {
      context.__request = {
        mode: "items", stateRevision: revision, budget: 200,
        stateSnapshot: { mode: "items", solveBudget: 200, marker },
      };
      vm.runInContext(
        "S=__request.stateSnapshot;stateRevision=__request.stateRevision;" +
        "solveService.request(__request,()=>{delivered+=1;})", context);
      delete context.__request;
    },
    respond(worker) {
      const sent = worker.messages[worker.messages.length - 1];
      worker.onmessage({ data: {
        reqId: sent.reqId, generation: sent.generation, mode: sent.mode,
        stateRevision: sent.stateRevision, res: { mode: "items", marker: sent.state.marker },
      } });
    },
    cancel(reason) { context.__reason = reason; vm.runInContext("solveService.cancel(__reason)", context); },
    flushTimers() {
      while (timers.size) {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach(callback => callback());
      }
    },
    status() { return vm.runInContext("solveService.status()", context); },
  };
}

function drive(harness, rounds) {
  let busyTerminations = 0;
  for (let revision = 1; revision <= rounds; revision += 1) {
    const busyBefore = harness.status().poolBusy;
    const terminatedBefore = harness.workers.filter(worker => worker.terminated).length;
    harness.solve(revision, `session-${revision}`);
    const terminated = harness.workers.filter(worker => worker.terminated).length - terminatedBefore;
    assert.ok(terminated <= busyBefore, "a request may only terminate Workers that were busy");
    busyTerminations += terminated;
    // Two of every three solves are superseded before they answer, which is what a reader dragging a
    // slider produces. The third completes, so the session is not one long unanswered storm.
    if (revision % 3 === 0) harness.respond(harness.workers[harness.workers.length - 1]);
    if (revision % 17 === 0) harness.cancel("Manual mode renders synchronously");
  }
  return busyTerminations;
}

test("a scripted release session solves sixty times without ever fetching solver source", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-solver-session-"));
  buildStaticSite({ sourceRoot: root, outputRoot: temporary });
  const source = workerLifecycleSource(generatedApp(temporary));
  const harness = session(source);
  assert.equal(harness.status().poolEnabled, true, "the session must run on a page the pool switch is on for");

  const busyTerminations = drive(harness, 60);
  harness.flushTimers();
  const status = harness.status();

  assert.deepEqual(harness.urls, ["blob:forge-solver-1"],
    "a page allocates its solver payload once, however many Workers it builds");
  assert.ok(harness.workers.length > 1, "a session with no supersede cost would prove nothing");
  assert.deepEqual(new Set(harness.workers.map(worker => worker.url)), new Set(["blob:forge-solver-1"]));
  for (const worker of harness.workers) {
    assert.doesNotMatch(worker.url, /\.js(?:[?#]|$)/, "no Worker may be constructed from a script URL");
  }
  assert.deepEqual(harness.revoked, [], "the shared payload URL must survive the whole session");
  assert.deepEqual(harness.reachedNetwork, [], "a released page must not reach a network primitive to solve");

  assert.equal(status.poolTripped, false, "ordinary supersede churn must not spend the construction budget");
  assert.equal(status.poolUnratedDisposals, 0);
  assert.ok(status.poolConstructions <= 4 + busyTerminations,
    `constructions (${status.poolConstructions}) exceeded the cap plus its ${busyTerminations} busy terminations`);
  assert.equal(status.poolConstructions, harness.workers.length);
  assert.equal(harness.context.delivered, 20, "every third solve must have been answered by a Worker");
  assert.equal(harness.context.fallbackSolves, 0, "nothing in this session may fall back to the main thread");
});

test("the session's payload assertion fails on a page that allocates per Worker", () => {
  /* The guard lives in generated bytes, so the only way to show the assertion above measures
   * something is to feed the same session a page built without it. */
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-solver-session-unguarded-"));
  buildStaticSite({ sourceRoot: root, outputRoot: temporary });
  const source = workerLifecycleSource(generatedApp(temporary));
  const unguarded = session(source, {
    mutate: text => {
      const before = "if(__forgeSolverWorkerUrl===null)";
      assert.ok(text.includes(before), "the generated memo guard must keep its declared form");
      return text.replace(before, "if(true)");
    },
  });

  drive(unguarded, 60);
  assert.equal(unguarded.urls.length, unguarded.workers.length,
    "an unguarded page allocates one payload per Worker, which is what the guard prevents");
  assert.ok(unguarded.urls.length > 1);
});

(async () => {
  let failed = 0;
  for (const entry of tests) {
    try {
      await entry.fn();
      console.log(`PASS ${entry.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${entry.name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failed) process.exitCode = 1;
  else console.log(`${tests.length} solver Worker session tests passed`);
})();
