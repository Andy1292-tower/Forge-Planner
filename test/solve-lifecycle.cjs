"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");

class FakeElement {
  constructor() {
    this.hidden = true;
    this.textContent = "";
    this.children = [];
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  classList = { toggle() {} };
}

function lifecycleHarness() {
  const workers = [];
  const timers = new Map();
  const elements = {
    solveOverlay: new FakeElement(),
    solveFallback: new FakeElement(),
    results: new FakeElement(),
    solveStat: new FakeElement(),
  };
  let nextTimer = 1;
  let now = 1_000;
  let stability = { remembered: ["line-1"] };

  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    emitMessage(data) { if (this.onmessage) this.onmessage({ data }); }
    emitError(message = "worker failed") {
      if (this.onerror) this.onerror({ message, preventDefault() {} });
    }
  }

  const context = {
    console,
    Date: { now() { return now; } },
    JSON,
    Math,
    Number,
    Object,
    String,
    Worker: FakeWorker,
    document: {
      getElementById(id) { return elements[id] || null; },
      createTextNode(text) { return { textContent: String(text) }; },
    },
    domElement(_tag, _className, text) { const el = new FakeElement(); el.textContent = text || ""; return el; },
    getLineStability() { return stability; },
    setLineStability() {},
    optimize() { return { mode: "sync-fallback" }; },
    num(value) { const number = Number(value); return Number.isFinite(number) ? number : null; },
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    S: { mode: "items", solveBudget: 200 },
    stateRevision: 0,
  };
  vm.createContext(context);

  const servicePath = path.join(root, "js", "solve-service.js");
  if (fs.existsSync(servicePath)) {
    vm.runInContext(fs.readFileSync(servicePath, "utf8"), context, { filename: servicePath });
  } else {
    // Before Task 3, the lifecycle lives in results.js. This adapter lets the first RED run
    // demonstrate the real stale-completion and late-error behavior, then the same tests move
    // automatically to the production solveService once it exists.
    const resultsPath = path.join(root, "js", "results.js");
    vm.runInContext(fs.readFileSync(resultsPath, "utf8"), context, { filename: resultsPath });
    vm.runInContext(`globalThis.solveService = {
      request(options, callback) {
        S = options.stateSnapshot;
        stateRevision = options.stateRevision;
        solveAsync(callback);
      },
      cancel() {},
      status() { return {}; }
    };`, context);
  }

  return {
    workers,
    elements,
    callRequest(options, callback) {
      context.__request = options;
      context.__callback = callback;
      vm.runInContext("S = globalThis.__request.stateSnapshot; stateRevision = globalThis.__request.stateRevision; solveService.request(globalThis.__request, globalThis.__callback)", context);
      delete context.__request;
      delete context.__callback;
    },
    setCurrent(mode, revision) {
      context.__mode = mode;
      context.__revision = revision;
      vm.runInContext("S.mode = globalThis.__mode; stateRevision = globalThis.__revision", context);
      delete context.__mode;
      delete context.__revision;
    },
    flushTimers() {
      while (timers.size) {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach(callback => callback());
      }
    },
    advance(ms) { now += ms; },
    setStability(next) { stability = next; },
    cancel(reason) {
      context.__reason = reason;
      const value = vm.runInContext("solveService.cancel(globalThis.__reason)", context);
      delete context.__reason;
      return value;
    },
    status() { return vm.runInContext("solveService.status()", context); },
  };
}

function request(mode, revision, marker) {
  return {
    mode,
    stateRevision: revision,
    budget: 200,
    stateSnapshot: { mode, solveBudget: 200, marker },
  };
}
function workerResponse(worker, body, messageIndex = 0) {
  const sent = worker.messages[messageIndex];
  return {
    reqId: sent.reqId,
    generation: sent.generation === undefined ? sent.reqId : sent.generation,
    mode: sent.mode,
    stateRevision: sent.stateRevision,
    ...body,
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("a Credits completion cannot paint after the accepted state enters Manual", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("credits", 1, "A"), result => painted.push(result.marker));
  const workerA = harness.workers[0];

  harness.setCurrent("manual", 2);
  workerA.emitMessage(workerResponse(workerA, { res: { mode: "credits", marker: "A" } }));

  assert.deepEqual(painted, []);
  assert.equal(harness.elements.solveOverlay.hidden, true);
});

test("a superseded Worker's late error cannot take over the newer request", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("credits", 1, "A"), result => painted.push(result.marker || result.mode));
  const workerA = harness.workers[0];
  harness.callRequest(request("items", 2, "B"), result => painted.push(result.marker || result.mode));
  const workerB = harness.workers[1];

  workerA.emitError("late A failure");
  harness.flushTimers();

  assert.deepEqual(painted, []);
  assert.equal(harness.elements.solveOverlay.hidden, false);
  workerB.emitMessage(workerResponse(workerB, { res: { mode: "items", marker: "B" } }));
  assert.deepEqual(painted, ["B"]);
  assert.equal(harness.elements.solveOverlay.hidden, true);
});

test("cancel invalidates the callback, clears fallback work, and terminates only the owned Worker", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("credits", 1, "A"), result => painted.push(result.marker));
  const worker = harness.workers[0];

  const cancelled = harness.cancel("entering Manual");
  worker.emitMessage(workerResponse(worker, { res: { mode: "credits", marker: "A" } }));
  harness.flushTimers();

  assert.equal(worker.terminated, true);
  assert.deepEqual(painted, []);
  assert.equal(cancelled.generation, 2);
  assert.equal(cancelled.active, false);
  assert.equal(harness.elements.solveOverlay.hidden, true);
});

test("an owned Worker failure preserves the generation and callback through synchronous fallback", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("items", 1, "A"), result => painted.push(result.mode));
  const worker = harness.workers[0];
  const generation = worker.messages[0].generation;

  worker.emitError("load failed");
  const failed = harness.status();
  assert.equal(failed.generation, generation);
  assert.equal(failed.active, true);
  assert.equal(failed.fallbackActive, true);
  assert.equal(harness.elements.solveFallback.hidden, false);
  assert.match(harness.elements.solveFallback.textContent, /slower fallback/i);

  harness.flushTimers();
  assert.deepEqual(painted, ["sync-fallback"]);
  assert.equal(harness.status().generation, generation);
  assert.equal(harness.elements.solveOverlay.hidden, true);
});

test("Worker retry cooldown is bounded and a later healthy solve clears fallback status", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("items", 1, "A"), result => painted.push(result.mode));
  harness.workers[0].emitError("first failure");
  harness.flushTimers();

  harness.callRequest(request("items", 2, "B"), result => painted.push(result.mode));
  assert.equal(harness.workers.length, 1, "cooldown must not immediately respawn a failing Worker");
  harness.flushTimers();
  harness.advance(5_000);

  harness.callRequest(request("items", 3, "C"), result => painted.push(result.marker));
  const recovered = harness.workers[1];
  recovered.emitMessage(workerResponse(recovered, { res: { mode: "items", marker: "C" } }));

  assert.deepEqual(painted, ["sync-fallback", "sync-fallback", "C"]);
  assert.equal(harness.status().workerFailures, 0);
  assert.equal(harness.status().fallbackActive, false);
  assert.equal(harness.elements.solveFallback.hidden, true);
});

test("a completed idle Worker is reused with the current stability snapshot", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("items", 1, "A"), result => painted.push(result.marker));
  const worker = harness.workers[0];
  worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: "A" } }));

  harness.setStability({ remembered: ["line-2"] });
  harness.callRequest(request("items", 2, "B"), result => painted.push(result.marker));

  assert.equal(harness.workers.length, 1);
  assert.equal(worker.terminated, false);
  assert.deepEqual(worker.messages[1].stab, { remembered: ["line-2"] });

  worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: "A-late" } }, 0));
  assert.deepEqual(painted, ["A"]);
  assert.equal(harness.elements.solveOverlay.hidden, false);
  worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: "B" } }, 1));
  assert.deepEqual(painted, ["A", "B"]);
});

test("a response whose echoed mode or revision disagrees cannot paint the current request", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("items", 7, "A"), result => painted.push(result.marker || result.mode));
  const worker = harness.workers[0];

  worker.emitMessage(workerResponse(worker, {
    mode: "credits",
    stateRevision: 6,
    res: { mode: "credits", marker: "wrong-response" },
  }));

  assert.deepEqual(painted, []);
  harness.flushTimers();
  assert.deepEqual(painted, ["sync-fallback"]);
  assert.equal(worker.terminated, true);
  assert.equal(harness.elements.solveOverlay.hidden, true);
});

test("superseding active synchronous fallback clears its timer and callback", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("items", 1, "A"), result => painted.push(result.mode));
  harness.workers[0].emitError("A failed");
  harness.callRequest(request("manual", 2, "B"), result => painted.push(result.mode));
  harness.flushTimers();

  assert.deepEqual(painted, ["sync-fallback"]);
  assert.equal(harness.status().generation, 2);
});

function stateHarness() {
  const store = new Map();
  const context = {
    console,
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); },
    },
  };
  vm.createContext(context);
  for (const file of ["js/core.js", "js/fields.js", "js/state.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  return {
    api(expression) { return vm.runInContext(expression, context); },
    mutate(callback) {
      context.__mutator = callback;
      const value = vm.runInContext("mutateState(globalThis.__mutator)", context);
      delete context.__mutator;
      return value;
    },
  };
}

test("the mutation hook advances revision immediately while persistence does not advance it again", () => {
  const harness = stateHarness();
  const before = harness.api("stateRevision");
  harness.mutate(state => { state.mode = "credits"; });
  assert.equal(harness.api("stateRevision"), before + 1);
  assert.equal(harness.api("S.mode"), "credits");

  assert.equal(harness.api("save()"), true);
  assert.equal(harness.api("stateRevision"), before + 1);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}`);
    console.error(`     ${error && error.stack || error}`);
  }
}

if (failed) {
  console.error(`\n${failed}/${tests.length} solve lifecycle tests failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${tests.length} solve lifecycle tests passed`);
}
