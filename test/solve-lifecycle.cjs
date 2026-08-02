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

function lifecycleHarness(options = {}) {
  const workers = [];
  const timers = new Map();
  const storage = options.storage || new Map();
  const elements = {
    solveOverlay: new FakeElement(),
    solveFallback: new FakeElement(),
    results: new FakeElement(),
    solveStat: new FakeElement(),
  };
  let nextTimer = 1;
  let now = options.now === undefined ? 1_000 : options.now;
  let stability = { remembered: ["line-1"] };

  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.messages = [];
      this.terminated = false;
      this.releaseCalls = 0;
      workers.push(this);
    }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    __forgeRelease() { this.releaseCalls += 1; }
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
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
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
    mutateCurrent(mutator) {
      context.__mutator = mutator;
      vm.runInContext("globalThis.__mutator(S); stateRevision += 1", context);
      delete context.__mutator;
    },
    flushTimers() {
      while (timers.size) {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach(callback => callback());
      }
    },
    advance(ms) { now += ms; },
    storage,
    setStability(next) { stability = next; },
    cancel(reason) {
      context.__reason = reason;
      const value = vm.runInContext("solveService.cancel(globalThis.__reason)", context);
      delete context.__reason;
      return value;
    },
    setWorkerFactory(factory) {
      context.__factory = factory;
      const value = vm.runInContext("solveService.setWorkerFactory(globalThis.__factory)", context);
      delete context.__factory;
      return value;
    },
    snapshot(state) {
      context.__state = state;
      const value = JSON.parse(vm.runInContext("JSON.stringify(solveStateSnapshot(globalThis.__state))", context));
      delete context.__state;
      return value;
    },
    key(state) {
      context.__state = state;
      const value = vm.runInContext("solveStateKey(globalThis.__state)", context);
      delete context.__state;
      return value;
    },
    status() { return vm.runInContext("solveService.status()", context); },
  };
}

function schemaDispatchHarness() {
  const messages = [];
  const elements = {
    solveOverlay: new FakeElement(),
    solveFallback: new FakeElement(),
    results: new FakeElement(),
    solveStat: new FakeElement(),
  };
  class CapturingWorker {
    postMessage(message) { messages.push(message); }
    terminate() {}
  }
  const context = {
    console,
    JSON,
    Math,
    Number,
    Object,
    String,
    Date,
    Worker: CapturingWorker,
    document: { getElementById(id) { return elements[id] || null; } },
    getLineStability() { return {}; },
    setLineStability() {},
    optimize() { return { mode: "items" }; },
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  vm.createContext(context);
  for (const relative of ["js/core.js", "js/fields.js", "js/state.js", "js/solve-service.js"]) {
    const file = path.join(root, relative);
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  }
  vm.runInContext(`
    normalize(S);
    S.schemaVersion = CURRENT_SCHEMA_VERSION;
    S.mode = "project";
    S.planStart = 1000;
    S.projects = [{
      id: "dispatch-project", name: "Dispatch project", on: true, prio: null,
      from: 1, to: 1, done: 0, levels: [{ costs: [{ item: "Frames", qty: 1 }] }], _open: true
    }];
    solveService.request({
      mode: S.mode,
      stateRevision,
      budget: S.solveBudget,
      stateSnapshot: S,
      solveKey: solveStateKey(S)
    }, () => {});
  `, context);
  return {
    messages,
    adoptValidatedClone() {
      return vm.runInContext(`(() => {
        const checked = validateAndMigrate(S);
        if (!checked.ok) return checked;
        _adoptValidatedClone(checked.state);
        return { ok: true, current: solveService.status().current };
      })()`, context);
    },
    validateDispatched() {
      context.__message = messages[0];
      const result = vm.runInContext("validateWorkerState(globalThis.__message.state)", context);
      delete context.__message;
      return result;
    },
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

function maxItemsState(overrides = {}) {
  return {
    mode: "items",
    solveBudget: 200,
    lines: [{ max: 64, spx: 1, turbo: 0 }],
    maxTurbo: 0,
    dupe: 12.4,
    margin: 0,
    targets: { Frames: { on: true, w: 1 } },
    baseTime: { Frames: 308.9 },
    prodCost: { Frames: { Rods: { 1: 2 } } },
    forgie: { Frames: 3 },
    minedIncome: { Vespium: 7, Hydracite: 11 },
    sellPrice: { Frames: 123 },
    projects: [{ id: "p1", done: 0, inventory: { Frames: 99 }, levels: [{ costs: [{ item: "Frames", qty: 4 }] }] }],
    manual: [{ line: 1, job: "Frames" }],
    planStart: 1_000,
    ...overrides,
  };
}

function cachedItemsResult(marker = "cached") {
  // This matches the nonempty Items fields consumed by the real results renderer.
  return {
    mode: "items", marker, capped: true, empty: false, issues: [],
    ms: 42, targets: ["Frames"], out: { Frames: 12 }, rate: { Frames: 1 }, net: { Frames: 12 },
    plan: [{ line: 1, max: 64, spx: 1, dup: 12.4, sp: 1, dp: 1.124,
      job: { kind: "produce", res: "Frames", lvl: 1, ct: 1, prod: [[0, 1]], cons: [] } }],
    balance: [{ res: "Frames", prod: 12, forgie: 3, cons: 0 }],
  };
}

function primeItemsCache(storage, state = maxItemsState(), now = 1_000) {
  const harness = lifecycleHarness({ storage, now });
  harness.callRequest({ mode: "items", stateRevision: 1, budget: state.solveBudget, stateSnapshot: state }, () => {});
  assert.equal(harness.workers.length, 1, "the priming solve must be a fresh Worker solve");
  harness.workers[0].emitMessage(workerResponse(harness.workers[0], { res: cachedItemsResult("primed") }));
  return harness;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("a completed capped Items solve is reused after the service is recreated", () => {
  const storage = new Map();
  const state = maxItemsState();
  primeItemsCache(storage, state);
  assert.ok(storage.size > 0, "a successful capped Items result must be persisted for daily reuse");

  const harness = lifecycleHarness({ storage });
  const delivered = [];
  harness.callRequest({ mode: "items", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state },
    (result, error, metadata) => delivered.push({ result, error, metadata }));

  assert.equal(harness.workers.length, 0, "an exact daily-cache hit must not create a Worker");
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].result.marker, "primed");
  assert.equal(delivered[0].error, null);
  assert.deepEqual(delivered[0].metadata, { cached: true, savedAt: 1_000 });
});

test("Items cache identity excludes sell prices, project/manual state, inventory, and plan start", () => {
  const irrelevantChanges = [
    ["sell price", state => ({ ...state, sellPrice: { Frames: 999999 } })],
    ["project definition", state => ({ ...state, projects: [{ ...state.projects[0], levels: [{ costs: [{ item: "Bits", qty: 999 }] }] }] })],
    ["project inventory", state => ({ ...state, projects: [{ ...state.projects[0], inventory: { Frames: 0 } }] })],
    ["Manual layout", state => ({ ...state, manual: [{ line: 9, job: "Concrete" }] })],
    ["plan start", state => ({ ...state, planStart: 99_999 })],
  ];

  for (const [name, change] of irrelevantChanges) {
    const storage = new Map();
    const original = maxItemsState();
    primeItemsCache(storage, original);
    const harness = lifecycleHarness({ storage });
    const changed = change(original);
    harness.callRequest({ mode: "items", stateRevision: 2, budget: changed.solveBudget, stateSnapshot: changed }, () => {});
    assert.equal(harness.workers.length, 0, `${name} must not invalidate a Max Items cache record`);
  }
});

test("Items cache misses projected input changes and expired records", () => {
  const projectedChanges = [
    ["line speed", state => ({ ...state, lines: [{ ...state.lines[0], spx: 2 }] })],
    ["line max", state => ({ ...state, lines: [{ ...state.lines[0], max: 128 }] })],
    ["target weight", state => ({ ...state, targets: { Frames: { on: true, w: 2 } } })],
    ["Lil' Forgie production", state => ({ ...state, forgie: { Frames: 4 } })],
    ["mined-resource income", state => ({ ...state, minedIncome: { Vespium: 8, Hydracite: 11 } })],
  ];

  for (const [name, change] of projectedChanges) {
    const storage = new Map();
    const original = maxItemsState();
    primeItemsCache(storage, original);
    const harness = lifecycleHarness({ storage });
    const changed = change(original);
    harness.callRequest({ mode: "items", stateRevision: 2, budget: changed.solveBudget, stateSnapshot: changed }, () => {});
    assert.equal(harness.workers.length, 1, `${name} must dispatch a fresh Worker solve`);
  }

  const storage = new Map();
  const state = maxItemsState();
  primeItemsCache(storage, state, 1_000);
  assert.ok(storage.size > 0, "expiry coverage requires a persisted cache record");
  const expired = lifecycleHarness({ storage, now: 1_000 + 24 * 60 * 60 * 1_000 + 1 });
  expired.callRequest({ mode: "items", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state }, () => {});
  assert.equal(expired.workers.length, 1, "a record older than 24 hours must dispatch a Worker");
});

test("non-Items, forceFresh, and malformed daily-cache bytes fail open to a Worker", () => {
  for (const mode of ["credits", "project"]) {
    const storage = new Map();
    const state = maxItemsState({ mode });
    const harness = lifecycleHarness({ storage });
    harness.callRequest({ mode, stateRevision: 1, budget: state.solveBudget, stateSnapshot: state }, () => {});
    assert.equal(harness.workers.length, 1, `${mode} must never use the Items cache`);
  }

  const freshStorage = new Map();
  const state = maxItemsState();
  primeItemsCache(freshStorage, state);
  assert.ok(freshStorage.size > 0, "forceFresh coverage requires a persisted cache record");
  const forceFresh = lifecycleHarness({ storage: freshStorage });
  forceFresh.callRequest({ mode: "items", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state, forceFresh: true }, () => {});
  assert.equal(forceFresh.workers.length, 1, "forceFresh must bypass the daily cache once");

  const malformedStorage = new Map();
  primeItemsCache(malformedStorage, state);
  assert.ok(malformedStorage.size > 0, "malformed-byte coverage requires a persisted cache record");
  for (const key of malformedStorage.keys()) malformedStorage.set(key, "not valid cache JSON");
  const malformed = lifecycleHarness({ storage: malformedStorage });
  malformed.callRequest({ mode: "items", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state }, () => {});
  assert.equal(malformed.workers.length, 1, "malformed cache bytes must silently dispatch a Worker");
});

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
  assert.equal(workerA.releaseCalls, 1);

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
  assert.equal(worker.releaseCalls, 1);
  assert.deepEqual(painted, []);
  assert.equal(cancelled.generation, 2);
  assert.equal(cancelled.active, false);
  assert.equal(harness.elements.solveOverlay.hidden, true);
});

test("cancel after Worker failure clears the accessible fallback status", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("items", 1, "A"), result => painted.push(result.mode));
  harness.workers[0].emitError("load failed");

  assert.equal(harness.status().fallbackActive, true);
  assert.equal(harness.elements.solveFallback.hidden, false);
  const cancelled = harness.cancel("entering Manual");
  harness.flushTimers();

  assert.equal(cancelled.active, false);
  assert.equal(cancelled.fallbackActive, false);
  assert.equal(harness.elements.solveFallback.hidden, true);
  assert.equal(harness.elements.solveFallback.textContent, "");
  assert.equal(harness.elements.solveOverlay.hidden, true);
  assert.deepEqual(painted, []);
});

test("an owned Worker failure preserves the generation and callback through synchronous fallback", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("items", 1, "A"), result => painted.push(result.mode));
  const worker = harness.workers[0];
  const generation = worker.messages[0].generation;

  worker.emitError("load failed");
  const failed = harness.status();
  assert.equal(worker.releaseCalls, 1);
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
  assert.equal(worker.url, "js/solver.worker.v2.js",
    "current tabs must not use the permanently retired legacy Worker URL");
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

test("a completed idle Worker's late error disposes it silently before the next solve", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("items", 1, "A"), result => painted.push(result.marker));
  const worker = harness.workers[0];
  worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: "A" } }));

  assert.deepEqual(painted, ["A"]);
  assert.equal(harness.status().active, false);
  assert.equal(harness.status().workerBusy, false);
  worker.emitError("late failure after delivery");

  const afterError = harness.status();
  assert.equal(afterError.workerOwned, false);
  assert.equal(afterError.workerFailures, 0);
  assert.equal(afterError.retryInMs, 0);
  assert.equal(afterError.fallbackActive, false);
  assert.equal(afterError.active, false);
  assert.equal(worker.terminated, true);
  assert.equal(worker.releaseCalls, 1);
  assert.equal(harness.elements.solveFallback.hidden, true);
  assert.equal(harness.elements.solveOverlay.hidden, true);

  harness.callRequest(request("items", 2, "B"), result => painted.push(result.marker));
  assert.equal(harness.workers.length, 2);
  const replacement = harness.workers[1];
  replacement.emitMessage(workerResponse(replacement, { res: { mode: "items", marker: "B" } }));

  assert.deepEqual(painted, ["A", "B"]);
  assert.equal(harness.status().workerFailures, 0);
  assert.equal(harness.status().fallbackActive, false);
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

test("display-only Project mutations keep an in-flight solve authoritative", () => {
  const harness = lifecycleHarness();
  const painted = [];
  const options = {
    mode: "project",
    stateRevision: 1,
    budget: 200,
    stateSnapshot: {
      mode: "project",
      solveBudget: 200,
      planStart: 1_000,
      projects: [{ id: "p1", name: "Alpha", _open: false, levels: [{ costs: [] }] }],
    },
  };
  harness.callRequest(options, result => painted.push(result.marker));
  const worker = harness.workers[0];
  assert.equal(worker.messages[0].state.planStart, 1_000);
  assert.equal(worker.messages[0].state.projects[0]._open, false);

  harness.mutateCurrent(state => {
    state.planStart = 2_000;
    state.projects[0]._open = true;
  });
  assert.equal(harness.status().current, true);
  worker.emitMessage(workerResponse(worker, { res: { mode: "project", marker: "accepted" } }));

  assert.deepEqual(painted, ["accepted"]);
  assert.equal(harness.status().active, false);
  assert.equal(worker.terminated, false);
});

test("the real Worker boundary receives a complete schema-valid solve snapshot", () => {
  // Break caught: using the solve-key projection as the dispatch payload strips required persisted fields.
  const harness = schemaDispatchHarness();
  assert.equal(harness.messages.length, 1);
  const dispatched = harness.messages[0].state;
  assert.equal(dispatched.planStart, 1_000);
  assert.equal(dispatched.projects[0]._open, true);
  const checked = harness.validateDispatched();
  assert.equal(checked.ok, true, checked.errors && checked.errors.join("; "));
});

test("adopting a schema-equivalent validated clone keeps the initial solve authoritative", () => {
  // Startup renders once, then persistence adopts validation's fresh clone. Object insertion order
  // is not solver state and must not make that already-dispatched request stale.
  const harness = schemaDispatchHarness();
  const adopted = harness.adoptValidatedClone();
  assert.equal(adopted.ok, true, adopted.errors && adopted.errors.join("; "));
  assert.equal(adopted.current, true);
});

test("solve equivalence ignores object insertion order but preserves array order", () => {
  const harness = lifecycleHarness();
  const first = {
    mode: "project",
    nested: { alpha: 1, beta: 2 },
    projects: [
      { id: "p1", _open: false, levels: [{ costs: [{ item: "Frames", qty: 1 }] }] },
      { id: "p2", _open: true, levels: [{ costs: [{ item: "Bricks", qty: 2 }] }] },
    ],
  };
  const reorderedObjects = {
    projects: [
      { levels: [{ costs: [{ qty: 1, item: "Frames" }] }], _open: true, id: "p1" },
      { levels: [{ costs: [{ qty: 2, item: "Bricks" }] }], id: "p2", _open: false },
    ],
    nested: { beta: 2, alpha: 1 },
    mode: "project",
  };
  const reorderedProjects = {
    mode: "project",
    nested: { alpha: 1, beta: 2 },
    projects: [...first.projects].reverse(),
  };

  assert.equal(harness.key(first), harness.key(reorderedObjects));
  assert.notEqual(harness.key(first), harness.key(reorderedProjects));
});

test("the dispatched solve snapshot preserves complete accepted state", () => {
  const harness = lifecycleHarness();
  const original = {
    mode: "project",
    planStart: 1_000,
    projects: [{ id: "p1", _open: true, done: 2, levels: [{ costs: [{ item: "Frames", qty: 3 }] }] }],
    nested: { keep: true },
  };
  assert.deepEqual(harness.snapshot(original), {
    mode: "project",
    planStart: 1_000,
    projects: [{ id: "p1", _open: true, done: 2, levels: [{ costs: [{ item: "Frames", qty: 3 }] }] }],
    nested: { keep: true },
  });
  assert.equal(original.planStart, 1_000, "snapshotting must not mutate accepted state");
  assert.equal(original.projects[0]._open, true);
});

test("a solver-relevant mutation rejects an in-flight solve even when mode is unchanged", () => {
  const harness = lifecycleHarness();
  const painted = [];
  const options = request("project", 1, "before");
  harness.callRequest(options, result => painted.push(result.marker));
  const worker = harness.workers[0];

  harness.mutateCurrent(state => { state.marker = "after"; });
  assert.equal(harness.status().current, false);
  worker.emitMessage(workerResponse(worker, { res: { mode: "project", marker: "stale" } }));

  assert.deepEqual(painted, []);
  assert.equal(worker.terminated, true);
  assert.equal(harness.status().active, false);
});

test("changing the Worker factory releases the owned Worker before a controlled slow solve", () => {
  const harness = lifecycleHarness();
  const painted = [];
  harness.callRequest(request("items", 1, "default"), result => painted.push(result.marker));
  const owned = harness.workers[0];
  owned.emitMessage(workerResponse(owned, { res: { mode: "items", marker: "default" } }));

  const controlled = {
    messages: [],
    terminated: false,
    postMessage(message) { this.messages.push(message); },
    terminate() { this.terminated = true; },
  };
  harness.setWorkerFactory(() => controlled);
  assert.equal(owned.terminated, true);
  assert.equal(owned.releaseCalls, 1);

  harness.callRequest(request("items", 2, "controlled"), result => painted.push(result.marker));
  assert.equal(controlled.messages.length, 1);
  assert.deepEqual(painted, ["default"], "the controlled solve remains deliberately pending");
  controlled.onmessage({ data: workerResponse(controlled, { res: { mode: "items", marker: "controlled" } }) });
  assert.deepEqual(painted, ["default", "controlled"]);
  assert.equal(harness.status().solveStateOwned, false,
    "completion must release every request-currentness field with the callback");
});

function schedulerHarness(options = {}) {
  const source = fs.readFileSync(path.join(root, "js", "events.js"), "utf8");
  const boundary = source.indexOf("function readFieldDraft");
  assert.ok(boundary > 0, "event scheduler remains isolated above field parsing");
  const timers = new Map();
  let nextTimer = 1;
  let now = 0;
  let saves = 0;
  let renders = 0;
  let requests = 0;
  let cancels = 0;
  const lifecycle = [];
  const validateSave = options.validateSave || (() => true);
  const documentListeners = new Map();
  const windowListeners = new Map();
  const context = {
    console,
    stateRevision: 1,
    S: { mode: "items", dupe: 25 },
    LSKEY: "test-state",
    localStorage: {
      getItem(key) { return key === "test-state" ? this.raw || null : null; },
      setItem(key, value) { if(key === "test-state")this.raw = String(value); },
    },
    document: {
      querySelectorAll() { return []; },
      visibilityState: "visible",
      addEventListener(type, callback) { documentListeners.set(type, callback); },
    },
    window: {
      addEventListener(type, callback) { windowListeners.set(type, callback); },
    },
    save() {
      saves += 1;
      lifecycle.push("save");
      if (!validateSave(context.S)) return false;
      context.localStorage.setItem("test-state", JSON.stringify(context.S));
      return true;
    },
    renderResults() { renders += 1; },
    solveService: {
      request() { requests += 1; },
      cancel() { cancels += 1;lifecycle.push("cancel"); },
    },
    setTimeout(callback, delay = 0) {
      const id = nextTimer++;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(0, boundary), context, { filename: "events-schedulers.js" });
  const lifecycleStart = source.indexOf('document.addEventListener("visibilitychange"');
  assert.ok(lifecycleStart > boundary, "page lifecycle handlers remain registered at the event boundary");
  vm.runInContext(source.slice(lifecycleStart), context, { filename: "events-page-lifecycle.js" });
  return {
    mutate() { context.stateRevision += 1; },
    corruptWithoutRevision(mutator) {
      context.__mutator = mutator;
      vm.runInContext("globalThis.__mutator(S)", context);
      delete context.__mutator;
    },
    legacySave() { return context.save(); },
    scheduleSolve() { vm.runInContext("scheduleSolve()", context); },
    persistNow() { return vm.runInContext("persistNow()", context); },
    doSolve() { return vm.runInContext("doSolve()", context); },
    pagehide() { windowListeners.get("pagehide")(); },
    hide() { context.document.visibilityState = "hidden";documentListeners.get("visibilitychange")(); },
    advance(ms) {
      now += ms;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.due <= now);
        if (!due.length) break;
        due.forEach(([id]) => timers.delete(id));
        due.forEach(([, timer]) => timer.callback());
      }
    },
    counts() { return { saves, renders, requests, cancels }; },
    lifecycle() { return lifecycle.slice(); },
    revision() { return context.stateRevision; },
    storedState() { return JSON.parse(context.localStorage.raw); },
  };
}

test("the persistence debounce saves accepted state before the solve debounce", () => {
  const harness = schedulerHarness();
  harness.mutate();
  harness.scheduleSolve();
  harness.advance(100);

  assert.deepEqual(harness.counts(), { saves: 1, renders: 0, requests: 0, cancels: 0 });
});

test("an immediate persistence flush cancels the delayed duplicate write", () => {
  const harness = schedulerHarness();
  harness.mutate();
  harness.scheduleSolve();
  assert.equal(harness.persistNow(), true);
  harness.advance(100);
  assert.deepEqual(harness.counts(), { saves: 1, renders: 0, requests: 0, cancels: 0 });
  harness.advance(400);
  assert.deepEqual(harness.counts(), { saves: 1, renders: 1, requests: 0, cancels: 0 });
});

test("a direct legacy save is recognized before persistence schedules a duplicate", () => {
  const harness = schedulerHarness();
  harness.mutate();
  assert.equal(harness.legacySave(), true);
  harness.scheduleSolve();
  harness.advance(100);
  assert.deepEqual(harness.counts(), { saves: 1, renders: 0, requests: 0, cancels: 0 });
});

test("doSolve revalidates changed state bytes even when the revision counter is unchanged", () => {
  // Break caught: revision-only persistence dedup lets an out-of-band invalid mutation reach
  // renderResults (and therefore Worker dispatch) without save() validating the current bytes.
  const harness = schedulerHarness({
    validateSave(state) { return state.dupe >= 0 && state.dupe <= 100; },
  });
  assert.equal(harness.persistNow(), true);
  assert.deepEqual(harness.storedState(), { mode: "items", dupe: 25 });
  const persistedRevision = harness.revision();

  harness.corruptWithoutRevision(state => { state.dupe = 101; });
  assert.equal(harness.revision(), persistedRevision);
  assert.equal(harness.doSolve(), false);

  assert.deepEqual(harness.counts(), { saves: 2, renders: 0, requests: 0, cancels: 0 });
  assert.deepEqual(harness.storedState(), { mode: "items", dupe: 25 });
});

test("pagehide flushes persistence, clears delayed solving, then cancels solve ownership", () => {
  const harness = schedulerHarness();
  harness.mutate();
  harness.scheduleSolve();
  harness.pagehide();
  harness.advance(600);

  assert.deepEqual(harness.lifecycle(), ["save", "cancel"]);
  assert.deepEqual(harness.counts(), { saves: 1, renders: 0, requests: 0, cancels: 1 });
});

test("visibility hiding flushes persistence without cancelling or changing scheduled solve work", () => {
  const harness = schedulerHarness();
  harness.mutate();
  harness.scheduleSolve();
  harness.hide();
  assert.deepEqual(harness.counts(), { saves: 1, renders: 0, requests: 0, cancels: 0 });
  harness.advance(500);
  assert.deepEqual(harness.counts(), { saves: 1, renders: 1, requests: 0, cancels: 0 });
});

test("opening Progress never invokes the synchronous Project optimizer", () => {
  const source = fs.readFileSync(path.join(root, "js", "events.js"), "utf8");
  const start = source.indexOf("function projSpan");
  const end = source.indexOf("function setProjDone", start);
  assert.ok(start >= 0 && end > start, "Progress renderer remains extractable for lifecycle coverage");
  const elements = {
    progList: { innerHTML: "" },
    progSummary: { innerHTML: "" },
  };
  let optimizeCalls = 0;
  const state = {
    mode: "project",
    projects: [{ id: "p1", name: "Alpha", on: true, from: 1, to: 1, done: 0, levels: [{ costs: [] }] }],
  };
  const renderProgress = Function(
    "S", "document", "num", "fmtDuration", "htmlAttribute", "htmlText", "optimizeProjectTop",
    "_lastProjectRes", "_lastProjectKey", "solveStateKey", "renderT", "solveService",
    `${source.slice(start, end)};return renderProgress;`
  )(
    state,
    { getElementById(id) { return elements[id] || null; } },
    Number,
    value => `${value}h`,
    String,
    String,
    () => { optimizeCalls += 1; return { mode: "project", empty: false, feasible: true, eta: 3 }; },
    { mode: "project", empty: false, feasible: true, eta: 3 },
    "stale-key",
    value => JSON.stringify(value),
    undefined,
    { status() { return { active: false }; } }
  );

  renderProgress();
  assert.equal(optimizeCalls, 0);
  assert.match(elements.progSummary.innerHTML, /out of date/i);
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
