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
  const stabilityWrites = [];

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
    // Kept as a tripwire, not a contract: the payload URL is shared for the page's lifetime, so
    // every releaseCalls assertion below expects zero. A build that revives a per-Worker release
    // would revoke the URL every later Worker is constructed from.
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
    // Recorded, not ignored: the snapshot a fan-out adopts is shard 0's, so which shard wrote it is
    // the observable difference between placing a fragment and guessing where it came from.
    setLineStability(next) { stabilityWrites.push(JSON.parse(JSON.stringify(next))); },
    // Absent unless a test asks for it: the pool cap is derived from the core count, and a page that
    // reports none is a page of one slot.
    navigator: options.hardwareConcurrency === undefined
      ? undefined
      : { hardwareConcurrency: options.hardwareConcurrency },
    optimize: options.optimize || (() => ({ mode: "sync-fallback" })),
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
    let source = fs.readFileSync(servicePath, "utf8");
    /* The pool default is a source constant, so the only way to test what the switch does once it
     * flips is to flip it. The literal must stay exact: a rename here has to fail rather than
     * silently stop substituting and leave the default-on tests asserting the default-off page. */
    if (options.poolDefaultOn === true) {
      const before = "const POOL_DEFAULT_ON=false;";
      assert.ok(source.includes(before), "the pool default constant must keep its declared form");
      source = source.replace(before, "const POOL_DEFAULT_ON=true;");
    }
    vm.runInContext(source, context, { filename: servicePath });
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
    stabilityWrites() { return stabilityWrites.slice(); },
    cancel(reason) {
      context.__reason = reason;
      const value = vm.runInContext("solveService.cancel(globalThis.__reason)", context);
      delete context.__reason;
      return value;
    },
    dispose(reason) {
      context.__reason = reason;
      const value = vm.runInContext("solveService.dispose(globalThis.__reason)", context);
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

function visibleText(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  return String(node.textContent || "") + (node.children || []).map(visibleText).join("");
}

function resultErrorHarness() {
  const elements = { results: new FakeElement(), solveStat: new FakeElement() };
  const context = {
    console,
    document: {
      getElementById(id) { return elements[id] || null; },
      createTextNode(text) { return { textContent: String(text), children: [] }; },
    },
    domElement(_tag, _className, text) { const el = new FakeElement();el.textContent = text || "";return el; },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "js", "results.js"), "utf8"), context, {
    filename: "results-error-renderer.js",
  });
  return {
    show(error) {
      context.__error = error;
      vm.runInContext("solveError(globalThis.__error)", context);
      delete context.__error;
      return visibleText(elements.results);
    },
    status() { return elements.solveStat.textContent; },
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

// The pool switch is read once at load, so it has to be in storage before the service is evaluated.
function poolFlagHarness(value, options = {}) {
  const storage = options.storage || new Map();
  storage.set("forgePlannerSolverPool", value);
  return lifecycleHarness({ ...options, storage });
}
function pooledHarness(options = {}) { return poolFlagHarness("on", options); }

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
    // Echoed the way js/solver.worker.v2.js echoes it: the descriptor it was handed, or null when
    // it was handed none. A reply that names no shard is a reply the merge cannot place.
    shard: sent.shard ? { index: sent.shard.index, count: sent.shard.count } : null,
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
    minedIncome: {
      Vespium: { rigPerMin: 7, resourcesTradingPerSec: 0 },
      Hydracite: { resourcesTradingPerSec: 11 },
    },
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

function creditsState(overrides = {}) {
  return maxItemsState({
    mode: "credits",
    targets: { Frames: { on: false, w: 9 } },
    sellPrice: { Frames: 123 },
    ...overrides,
  });
}

function cachedCreditsResult(marker = "cached") {
  const plan = [{ line: 1, max: 64, spx: 1, dup: 12.4, sp: 1, dp: 1.124,
    job: { kind: "produce", res: "Frames", lvl: 1, ct: 1, prod: [[0, 1]], cons: [] } }];
  const balance = [{ res: "Frames", prod: 12, forgie: 3, cons: 0 }];
  return {
    mode: "credits", marker, empty: false, issues: [], ranking: [{
      item: "Frames", kind: "product", out: 12, price: 123, credits: 1476,
      plan, balance, minedUsage: [], gelReserved: null, resIndex: { Frames: 0 },
      feasible: true, usesMargin: false, capped: true, evaluated: true, ms: 42,
    }],
    bestItem: "Frames", credits: 1476, objective: 1476, plan, balance,
    minedUsage: [], gelReserved: null, resIndex: { Frames: 0 }, tol: 0,
    usesMargin: false, feasible: true, capped: true, allCandidatesEvaluated: true,
    deadlineReached: true, searchExhaustive: false, ms: 42,
  };
}

function primeItemsCache(storage, state = maxItemsState(), now = 1_000) {
  const harness = lifecycleHarness({ storage, now });
  harness.callRequest({ mode: "items", stateRevision: 1, budget: state.solveBudget, stateSnapshot: state }, () => {});
  assert.equal(harness.workers.length, 1, "the priming solve must be a fresh Worker solve");
  harness.workers[0].emitMessage(workerResponse(harness.workers[0], { res: cachedItemsResult("primed") }));
  return harness;
}

function primeCreditsCache(storage, state = creditsState(), now = 1_000) {
  const harness = lifecycleHarness({ storage, now });
  harness.callRequest({ mode: "credits", stateRevision: 1, budget: state.solveBudget, stateSnapshot: state }, () => {});
  assert.equal(harness.workers.length, 1, "the priming Credits solve must be a fresh Worker solve");
  harness.workers[0].emitMessage(workerResponse(harness.workers[0], { res: cachedCreditsResult("primed") }));
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

test("an unchanged completed Credits comparison is reused after the service is recreated", () => {
  const storage = new Map();
  const state = creditsState();
  primeCreditsCache(storage, state);
  assert.ok(storage.size > 0, "a successful capped Credits result must be persisted for daily reuse");

  const harness = lifecycleHarness({ storage });
  const delivered = [];
  harness.callRequest({ mode: "credits", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state },
    (result, error, metadata) => delivered.push({ result, error, metadata }));

  assert.equal(harness.workers.length, 0, "an exact Credits cache hit must not create a Worker");
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].result.marker, "primed");
  assert.equal(delivered[0].error, null);
  assert.deepEqual(delivered[0].metadata, { cached: true, savedAt: 1_000 });
});

test("Credits cache tracks sell prices but ignores Items-only target choices", () => {
  const targetStorage = new Map();
  const original = creditsState();
  primeCreditsCache(targetStorage, original);
  const targetOnly = creditsState({ targets: { Wire: { on: true, w: 99 } } });
  const targetHarness = lifecycleHarness({ storage: targetStorage });
  targetHarness.callRequest({ mode: "credits", stateRevision: 2, budget: targetOnly.solveBudget, stateSnapshot: targetOnly }, () => {});
  assert.equal(targetHarness.workers.length, 0, "Items-only target choices must not invalidate a Credits result");

  const priceStorage = new Map();
  primeCreditsCache(priceStorage, original);
  const repriced = creditsState({ sellPrice: { Frames: 456 } });
  const priceHarness = lifecycleHarness({ storage: priceStorage });
  priceHarness.callRequest({ mode: "credits", stateRevision: 2, budget: repriced.solveBudget, stateSnapshot: repriced }, () => {});
  assert.equal(priceHarness.workers.length, 1, "a sell-price change must dispatch a fresh Credits solve");
});

test("an incomplete Credits comparison is never persisted for daily reuse", () => {
  const storage = new Map();
  const state = creditsState({ sellPrice: { Frames: 123, Wire: 1 } });
  const harness = lifecycleHarness({ storage });
  harness.callRequest({ mode: "credits", stateRevision: 1, budget: state.solveBudget, stateSnapshot: state }, () => {});
  const incomplete = cachedCreditsResult("incomplete");
  incomplete.allCandidatesEvaluated = false;
  incomplete.ranking.push({
    item: "Wire", kind: "product", out: 0, price: 1, credits: 0,
    plan: null, balance: null, minedUsage: [], gelReserved: null, resIndex: {},
    feasible: false, usesMargin: false, capped: false, evaluated: false, ms: 0,
  });
  harness.workers[0].emitMessage(workerResponse(harness.workers[0], { res: incomplete }));

  assert.equal(storage.size, 0, "a comparison with unevaluated priced items must not be cached for 24 hours");
});

test("a Credits cache record must match every priced item and its current price", () => {
  const cases = [
    {
      label: "missing priced item",
      state: creditsState({ sellPrice: { Frames: 123, Wire: 1 } }),
      result: cachedCreditsResult("missing-wire"),
    },
    {
      label: "stale candidate price",
      state: creditsState({ sellPrice: { Frames: 456 } }),
      result: cachedCreditsResult("stale-price"),
    },
  ];

  for (const { label, state, result } of cases) {
    const storage = new Map();
    const priming = lifecycleHarness({ storage });
    priming.callRequest({ mode: "credits", stateRevision: 1, budget: state.solveBudget, stateSnapshot: state }, () => {});
    priming.workers[0].emitMessage(workerResponse(priming.workers[0], { res: result }));

    const reuse = lifecycleHarness({ storage });
    reuse.callRequest({ mode: "credits", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state }, () => {});
    assert.equal(reuse.workers.length, 1, `${label} must fail open to a fresh Worker solve`);
  }
});

test("a cached result whose mode disagrees with its condition key fails open", () => {
  const storage = new Map();
  const state = creditsState();
  primeCreditsCache(storage, state);
  const [storageKey, raw] = [...storage.entries()][0];
  const tampered = JSON.parse(raw);
  tampered.entries[0].result = cachedItemsResult("wrong-mode");
  storage.set(storageKey, JSON.stringify(tampered));

  const harness = lifecycleHarness({ storage });
  harness.callRequest({ mode: "credits", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state }, () => {});
  assert.equal(harness.workers.length, 1, "cross-mode cache corruption must dispatch a fresh Worker solve");
});

test("forceFresh bypasses and replaces a Credits daily-cache record", () => {
  const storage = new Map();
  const state = creditsState();
  primeCreditsCache(storage, state);

  const forced = lifecycleHarness({ storage, now: 2_000 });
  forced.callRequest({ mode: "credits", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state, forceFresh: true }, () => {});
  assert.equal(forced.workers.length, 1, "forceFresh must bypass the Credits cache once");
  forced.workers[0].emitMessage(workerResponse(forced.workers[0], { res: cachedCreditsResult("fresh-credits") }));

  const afterForced = lifecycleHarness({ storage, now: 2_000 });
  const delivered = [];
  afterForced.callRequest({ mode: "credits", stateRevision: 3, budget: state.solveBudget, stateSnapshot: state },
    result => delivered.push(result.marker));
  assert.equal(afterForced.workers.length, 0, "the forced Credits result must replace the prior cache record");
  assert.deepEqual(delivered, ["fresh-credits"]);
});

test("forceFresh removes the prior Credits record when the fresh comparison is incomplete", () => {
  const storage = new Map();
  const state = creditsState();
  primeCreditsCache(storage, state);

  const forced = lifecycleHarness({ storage, now: 2_000 });
  forced.callRequest({ mode: "credits", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state, forceFresh: true }, () => {});
  const incomplete = cachedCreditsResult("incomplete-refresh");
  incomplete.allCandidatesEvaluated = false;
  forced.workers[0].emitMessage(workerResponse(forced.workers[0], { res: incomplete }));

  const afterForced = lifecycleHarness({ storage, now: 2_000 });
  afterForced.callRequest({ mode: "credits", stateRevision: 3, budget: state.solveBudget, stateSnapshot: state }, () => {});
  assert.equal(afterForced.workers.length, 1, "an incomplete forced solve must not expose the older cache record again");
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
    ["line turbo", state => ({ ...state, lines: [{ ...state.lines[0], turbo: 1 }] })],
    ["max Turbo", state => ({ ...state, maxTurbo: 1 })],
    ["duplication", state => ({ ...state, dupe: 25 })],
    ["margin", state => ({ ...state, margin: 0.1 })],
    ["exact solve budget", state => ({ ...state, solveBudget: 201 })],
    ["target enabled state", state => ({ ...state, targets: { Frames: { on: false, w: 1 } } })],
    ["target weight", state => ({ ...state, targets: { Frames: { on: true, w: 2 } } })],
    ["base time", state => ({ ...state, baseTime: { Frames: 309 } })],
    ["production cost", state => ({ ...state, prodCost: { Frames: { Rods: { 1: 3 } } } })],
    ["Lil' Forgie production", state => ({ ...state, forgie: { Frames: 4 } })],
    ["Vespium Rig income", state => ({ ...state, minedIncome: {
      Vespium: { ...state.minedIncome.Vespium, rigPerMin: 8 },
      Hydracite: { ...state.minedIncome.Hydracite },
    } })],
    ["Vespium Resources and Trading income", state => ({ ...state, minedIncome: {
      Vespium: { ...state.minedIncome.Vespium, resourcesTradingPerSec: 1 },
      Hydracite: { ...state.minedIncome.Hydracite },
    } })],
    ["Hydracite Resources and Trading income", state => ({ ...state, minedIncome: {
      Vespium: { ...state.minedIncome.Vespium },
      Hydracite: { resourcesTradingPerSec: 12 },
    } })],
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
  const expired = lifecycleHarness({ storage, now: 1_000 + 24 * 60 * 60 * 1_000 });
  expired.callRequest({ mode: "items", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state }, () => {});
  assert.equal(expired.workers.length, 1, "a record exactly 24 hours old must dispatch a Worker");
});

test("daily cache version 4 rejects version 3 bytes and keys each raw mined source", () => {
  const storage = new Map();
  const original = maxItemsState({ minedIncome: {
    Vespium: { rigPerMin: 2, resourcesTradingPerSec: 3 },
    Hydracite: { resourcesTradingPerSec: 4 },
  } });
  primeItemsCache(storage, original);
  const cacheKey = [...storage.keys()][0];
  const persisted = JSON.parse(storage.get(cacheKey));
  assert.equal(persisted.version, 4);
  assert.ok(persisted.entries.every(entry => entry.version === 4));

  const stale = JSON.parse(JSON.stringify(persisted));
  stale.version = 3;
  stale.entries.forEach(entry => { entry.version = 3; });
  storage.set(cacheKey, JSON.stringify(stale));
  const staleHarness = lifecycleHarness({ storage });
  staleHarness.callRequest({ mode: "items", stateRevision: 2, budget: original.solveBudget, stateSnapshot: original }, () => {});
  assert.equal(staleHarness.workers.length, 1, "a version-3 cache predates the mix mode and must not satisfy an Items solve");

  const equalAggregateStorage = new Map();
  primeItemsCache(equalAggregateStorage, original);
  const equalAggregate = maxItemsState({ minedIncome: {
    Vespium: { rigPerMin: 182, resourcesTradingPerSec: 0 },
    Hydracite: { resourcesTradingPerSec: 4 },
  } });
  const equalAggregateHarness = lifecycleHarness({ storage: equalAggregateStorage });
  equalAggregateHarness.callRequest({ mode: "items", stateRevision: 2, budget: equalAggregate.solveBudget, stateSnapshot: equalAggregate }, () => {});
  assert.equal(equalAggregateHarness.workers.length, 1,
    "equal hourly Vespium totals from different raw sources must have distinct cache identity");
});

test("mode isolation, forceFresh, and malformed daily-cache bytes fail open to a Worker", () => {
  for (const mode of ["credits", "project"]) {
    const storage = new Map();
    primeItemsCache(storage);
    assert.ok(storage.size > 0, `${mode} coverage requires a persisted Items cache record`);
    const state = maxItemsState({ mode });
    const harness = lifecycleHarness({ storage });
    harness.callRequest({ mode, stateRevision: 1, budget: state.solveBudget, stateSnapshot: state }, () => {});
    assert.equal(harness.workers.length, 1, `${mode} must never use an Items-mode cache record`);
  }

  const freshStorage = new Map();
  const state = maxItemsState();
  primeItemsCache(freshStorage, state);
  assert.ok(freshStorage.size > 0, "forceFresh coverage requires a persisted cache record");
  const forceFresh = lifecycleHarness({ storage: freshStorage, now: 2_000 });
  forceFresh.callRequest({ mode: "items", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state, forceFresh: true }, () => {});
  assert.equal(forceFresh.workers.length, 1, "forceFresh must bypass the daily cache once");
  forceFresh.workers[0].emitMessage(workerResponse(forceFresh.workers[0], { res: cachedItemsResult("fresh") }));
  const afterForceFresh = lifecycleHarness({ storage: freshStorage, now: 2_000 });
  const refreshed = [];
  afterForceFresh.callRequest({ mode: "items", stateRevision: 3, budget: state.solveBudget, stateSnapshot: state },
    result => refreshed.push(result.marker));
  assert.equal(afterForceFresh.workers.length, 0, "the forced fresh result must replace the existing cache record");
  assert.deepEqual(refreshed, ["fresh"]);

  const malformedStorage = new Map();
  primeItemsCache(malformedStorage, state);
  assert.ok(malformedStorage.size > 0, "malformed-byte coverage requires a persisted cache record");
  for (const key of malformedStorage.keys()) malformedStorage.set(key, "not valid cache JSON");
  const malformed = lifecycleHarness({ storage: malformedStorage });
  malformed.callRequest({ mode: "items", stateRevision: 2, budget: state.solveBudget, stateSnapshot: state }, () => {});
  assert.equal(malformed.workers.length, 1, "malformed cache bytes must silently dispatch a Worker");
});

test("the dispatched request message carries exactly the single-Worker protocol keys", () => {
  // The pool kill switch is only literal if a defaulted page dispatches byte-identical work: any
  // shard descriptor or pool field leaking into this key set is a behavior change, not a switch.
  const harness = lifecycleHarness();
  harness.callRequest(request("items", 1, "A"), () => {});
  assert.equal(harness.workers.length, 1);
  assert.deepEqual(
    Object.keys(harness.workers[0].messages[0]).sort(),
    ["budget", "generation", "mode", "reqId", "stab", "state", "stateRevision"]
  );
  const status = harness.status();
  assert.equal(status.poolEnabled, false);
  assert.equal(status.poolSize, 1);
  assert.equal(status.poolBusy, 1);
  assert.equal(status.poolConstructions, 1);
  assert.equal(status.workerOwned, true);
  assert.equal(status.workerBusy, true);
});

test("a shard descriptor adds one wire field and nothing else", () => {
  const harness = lifecycleHarness();
  harness.callRequest({ ...request("items", 1, "A"), shard: { index: 1, count: 3 } }, () => {});
  const sent = harness.workers[0].messages[0];
  assert.deepEqual(
    Object.keys(sent).sort(),
    ["budget", "generation", "mode", "reqId", "shard", "stab", "state", "stateRevision"]
  );
  assert.deepEqual(sent.shard, { index: 1, count: 3 });
  assert.equal(sent.reqId, sent.generation, "a shard must not be smuggled through the request id");
  assert.equal(sent.budget, 200, "and must not carry a budget of its own");

  // An explicitly empty descriptor is the absent case, not a third state on the wire.
  harness.callRequest({ ...request("items", 2, "B"), shard: null }, () => {});
  assert.deepEqual(
    Object.keys(harness.workers[harness.workers.length - 1].messages[0]).sort(),
    ["budget", "generation", "mode", "reqId", "stab", "state", "stateRevision"]
  );
});

/* ---- the Credits fan-out ---- */

// A priced catalog on the dispatched state is what makes the fan-out worth more than one Worker; the
// service sizes the fan-out on it so a pool never out-numbers the work.
function creditsRequest(revision, priced = 8) {
  const sellPrice = {};
  for (let index = 0; index < priced; index += 1) sellPrice["Item" + index] = index + 1;
  return {
    mode: "credits", stateRevision: revision, budget: 200,
    stateSnapshot: { mode: "credits", solveBudget: 200, sellPrice },
  };
}
function creditsFragment(index, count, overrides = {}) {
  return {
    empty: false, mode: "credits", issues: [], ranking: [], bestItem: null, credits: 0, objective: 0,
    plan: [], balance: [], minedUsage: [], resIndex: {}, tol: 0, usesMargin: false, feasible: false,
    capped: false, allCandidatesEvaluated: true, deadlineReached: false, searchExhaustive: true,
    ms: 10, shardEcho: index + "/" + count, ...overrides,
  };
}

test("a Credits request on a pooled page fans out one shard per slot and delivers once", () => {
  const harness = pooledHarness({ hardwareConcurrency: 5 });   // cap = min(4, cores-1) = 4
  const delivered = [];
  harness.callRequest(creditsRequest(1), (result, error) => delivered.push({ result, error }));

  assert.equal(harness.workers.length, 4, "the fan-out fills the pool");
  const descriptors = harness.workers.map(worker => worker.messages[0].shard);
  assert.deepEqual(descriptors, [
    { index: 0, count: 4 }, { index: 1, count: 4 }, { index: 2, count: 4 }, { index: 3, count: 4 },
  ], "each slot is told which of how many it owns, and nothing else");
  for (const worker of harness.workers) {
    assert.equal(worker.messages[0].reqId, worker.messages[0].generation,
      "a shard must not be smuggled through the request id");
    assert.equal(worker.messages[0].budget, 200, "and must not carry a budget of its own");
  }

  // Partial arrivals deliver nothing: a merge over a fragment of the catalog would rank against
  // candidates it never saw and report a completeness it cannot know.
  for (let index = 0; index < 3; index += 1) {
    harness.workers[index].emitMessage(workerResponse(harness.workers[index], { res: creditsFragment(index, 4) }));
    assert.equal(delivered.length, 0, "delivered after only " + (index + 1) + " of 4 shards");
  }
  harness.workers[3].emitMessage(workerResponse(harness.workers[3], { res: creditsFragment(3, 4) }));
  assert.equal(delivered.length, 1, "the last shard delivers exactly once");
  assert.equal(delivered[0].error, null);
  assert.equal(delivered[0].result.mode, "credits");
});

test("the fan-out is sized by the work, not by the pool", () => {
  // Three priced items and four slots: a fourth shard would be handed an empty catalog and the
  // request would pay a Worker round trip for a fragment with nothing in it.
  const harness = pooledHarness({ hardwareConcurrency: 5 });
  harness.callRequest(creditsRequest(1, 3), () => {});
  assert.equal(harness.workers.length, 3);
  assert.deepEqual(harness.workers.map(worker => worker.messages[0].shard.count), [3, 3, 3]);

  // Items is a single search, so it stays whole however many slots are free.
  const items = pooledHarness({ hardwareConcurrency: 5 });
  items.callRequest(request("items", 1, "A"), () => {});
  assert.equal(items.workers.length, 1);
  assert.equal(items.workers[0].messages[0].shard, undefined, "an unsharded request sends no descriptor");
});

test("a defaulted page never fans out", () => {
  // The kill switch is only a rollback if a defaulted page dispatches the byte-identical single
  // message for the mode that fans out hardest.
  const harness = lifecycleHarness();
  harness.callRequest(creditsRequest(1), () => {});
  assert.equal(harness.workers.length, 1);
  assert.deepEqual(
    Object.keys(harness.workers[0].messages[0]).sort(),
    ["budget", "generation", "mode", "reqId", "stab", "state", "stateRevision"]
  );
});

test("a failed shard fails the request rather than hanging it", () => {
  /* Rung 1 of the ladder says a slot failure reassigns its shard to a healthy slot. That is not
   * implemented: the request degrades to the synchronous fallback exactly as an unsharded one does.
   * Slower than a reassignment, never wrong — and never a request that waits forever for a shard
   * that is not coming. */
  const harness = pooledHarness({ hardwareConcurrency: 5, optimize: () => ({ mode: "sync-fallback" }) });
  const delivered = [];
  harness.callRequest(creditsRequest(1), (result, error) => delivered.push({ result, error }));
  assert.equal(harness.workers.length, 4);

  harness.workers[0].emitMessage(workerResponse(harness.workers[0], { res: creditsFragment(0, 4) }));
  harness.workers[1].emitMessage(workerResponse(harness.workers[1], { error: { message: "shard died" } }));
  assert.equal(delivered.length, 1, "the failing shard ends the request");
  assert.equal(delivered[0].error.message, "shard died");

  // And the fragments it collected are dropped: a later straggler must not resurrect a merge.
  harness.workers[2].emitMessage(workerResponse(harness.workers[2], { res: creditsFragment(2, 4) }));
  harness.workers[3].emitMessage(workerResponse(harness.workers[3], { res: creditsFragment(3, 4) }));
  assert.equal(delivered.length, 1, "a straggler must not deliver a second time");
});

test("a supersede clears the fragments the previous generation had collected", () => {
  const harness = pooledHarness({ hardwareConcurrency: 5 });
  const delivered = [];
  harness.callRequest(creditsRequest(1), (result, error) => delivered.push({ result, error }));
  const first = harness.workers.slice();
  first[0].emitMessage(workerResponse(first[0], { res: creditsFragment(0, 4) }));

  harness.callRequest(creditsRequest(2), (result, error) => delivered.push({ result, error }));
  /* The second generation is not a contiguous tail of the worker list: shard 0 already delivered, so
   * its slot was idle and is reused rather than rebuilt. Address the dispatch by its message. */
  const second = [];
  harness.workers.forEach(worker => {
    worker.messages.forEach((message, messageIndex) => {
      if (message.generation === 2) second.push({ worker, messageIndex, shard: message.shard });
    });
  });
  assert.equal(second.length, 4, "the supersede must dispatch its own full fan-out");
  // Every fragment of the second generation arrives; the stale one from the first must not count
  // toward it, or the merge delivers a ranking assembled from two different factories.
  second.forEach(({ worker, messageIndex, shard }) => {
    worker.emitMessage(workerResponse(worker, { res: creditsFragment(shard.index, shard.count) }, messageIndex));
  });
  assert.equal(delivered.length, 1, "exactly one delivery, from the current generation");
});

/* A fan-out reuses idle slots, so the Workers carrying one generation are not a contiguous tail of
 * the construction order. Address a dispatch by the message that carries it. */
function dispatchesFor(harness, generation) {
  const dispatched = [];
  harness.workers.forEach(worker => {
    worker.messages.forEach((message, messageIndex) => {
      if (message.generation === generation) dispatched.push({ worker, messageIndex, shard: message.shard || null });
    });
  });
  return dispatched;
}

test("a pooled fan-out cannot construct past what the ledger accounts for", () => {
  /* The shape N7 exists for, which the items-mode dying-Worker tests cannot reach: one request is
   * four constructions, not one. A ledger consulted once per request approves on the idle slot the
   * survivor left behind and never sees the three Workers the fan-out rebuilds behind it. */
  const harness = pooledHarness({ hardwareConcurrency: 5 });   // cap = ceiling = min(4, cores-1) = 4
  const allowance = 4 + 4;   // POOL_CEILING + POOL_CONSTRUCTION_GRACE, with no termination paying in
  const delivered = [];
  for (let revision = 1; revision <= 20; revision += 1) {
    harness.callRequest(creditsRequest(revision), (result, error) => delivered.push({ result, error }));
    const dispatched = dispatchesFor(harness, harness.status().generation);
    dispatched.forEach(({ worker, messageIndex, shard }) => {
      worker.emitMessage(workerResponse(worker,
        { res: creditsFragment(shard ? shard.index : 0, shard ? shard.count : 1) }, messageIndex));
    });
    // Every Worker dies after delivering except one, so the next request rebuilds the rest.
    dispatched.slice(1).forEach(({ worker }) => worker.emitError("died after delivering"));
    harness.flushTimers();
  }

  const status = harness.status();
  assert.ok(status.poolConstructions <= allowance,
    `the fan-out constructed ${status.poolConstructions} Workers against an allowance of ${allowance}`);
  assert.equal(status.poolConstructions, allowance, "and stops exactly at it rather than short of it");
  assert.equal(harness.workers.length, allowance);
  assert.equal(status.poolTripped, true, "a Worker that cannot survive its own delivery trips the pool");
  assert.equal(status.workerFailures, 0, "refusing to build rates no Worker and arms no cooldown");
  assert.equal(delivered.length, 20, "every request is answered exactly once, by a shard or the fallback");
});

test("a double-posting shard cannot complete a fan-out with a shard still missing", () => {
  // The merge's precondition is that each shard replied at most once. Nothing enforced it, so a
  // repeat filled the last entry and the merge delivered a comparison one slice short.
  const harness = pooledHarness({ hardwareConcurrency: 5 });
  const delivered = [];
  harness.callRequest(creditsRequest(1), (result, error) => delivered.push({ result, error }));
  assert.equal(harness.workers.length, 4);
  const fragment = index => creditsFragment(index, 4, { issues: ["shard " + index] });

  harness.workers[0].emitMessage(workerResponse(harness.workers[0], { res: fragment(0) }));
  harness.workers[1].emitMessage(workerResponse(harness.workers[1], { res: fragment(1) }));
  harness.workers[1].emitMessage(workerResponse(harness.workers[1],
    { res: creditsFragment(1, 4, { issues: ["shard 1 again"], ms: 99 }) }));
  harness.workers[3].emitMessage(workerResponse(harness.workers[3], { res: fragment(3) }));
  assert.equal(delivered.length, 0, "four fragments from three shards is not a complete comparison");

  harness.workers[2].emitMessage(workerResponse(harness.workers[2], { res: fragment(2) }));
  assert.equal(delivered.length, 1, "the shard that had not answered completes it");
  assert.deepEqual(delivered[0].result.issues, ["shard 0", "shard 1", "shard 2", "shard 3"]);
  assert.equal(delivered[0].result.ms, 10, "a dropped repeat contributes nothing to the merged result");
});

test("a shard whose echoed descriptor is unreadable is dropped, not read as shard 0", () => {
  /* Coercing an unusable echo to 0 takes a slice the merge already holds and hands it shard 0's
   * privileges — the line stability snapshot the whole page then remembers. */
  const harness = pooledHarness({ hardwareConcurrency: 5 });
  const delivered = [];
  harness.callRequest(creditsRequest(1), (result, error) => delivered.push({ result, error }));
  const fragment = index => creditsFragment(index, 4, { issues: ["shard " + index] });

  harness.workers[0].emitMessage(workerResponse(harness.workers[0],
    { res: creditsFragment(0, 4, { issues: ["shard 0"], __stab: { remembered: ["line-1"] } }) }));
  assert.deepEqual(harness.stabilityWrites(), [{ remembered: ["line-1"] }], "shard 0 owns the stability snapshot");

  harness.workers[1].emitMessage(workerResponse(harness.workers[1], {
    shard: { index: "1", count: 4 },
    res: creditsFragment(1, 4, { issues: ["garbled"], __stab: { remembered: ["line-9"] } }),
  }));
  assert.deepEqual(harness.stabilityWrites(), [{ remembered: ["line-1"] }],
    "a fragment the service cannot place must not rewrite line stability");
  assert.equal(delivered.length, 0);

  harness.workers[1].emitMessage(workerResponse(harness.workers[1], { res: fragment(1) }));
  harness.workers[2].emitMessage(workerResponse(harness.workers[2], { res: fragment(2) }));
  harness.workers[3].emitMessage(workerResponse(harness.workers[3], { res: fragment(3) }));
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].result.issues, ["shard 0", "shard 1", "shard 2", "shard 3"],
    "the merge is the four fragments, and the unreadable echo is not one of them");
});

// A factory that builds two Workers and then throws, so a four-way fan-out dies halfway through
// its dispatch loop with two shards already flying.
function halfDispatchedFanOut() {
  const harness = pooledHarness({ hardwareConcurrency: 5 });
  const built = [];
  harness.setWorkerFactory(() => {
    if (built.length === 2) throw new Error("Worker construction failed");
    const worker = {
      messages: [], terminated: false,
      postMessage(message) { this.messages.push(message); },
      terminate() { this.terminated = true; },
    };
    built.push(worker);
    return worker;
  });
  return { harness, built };
}

test("a fan-out that fails mid-dispatch never delivers one shard as the whole comparison", () => {
  /* The shards already flying outlive the throw and the callback is still armed, so a fragment that
   * beats the 0 ms fallback timer passes every gate. The pending record has to survive the throw:
   * it can no longer reach its count, which is what keeps the fallback the thing that delivers. */
  const { harness, built } = halfDispatchedFanOut();
  const delivered = [];
  harness.callRequest(creditsRequest(1), (result, error) => delivered.push({ result, error }));
  assert.equal(built.length, 2, "two shards of four were dispatched before construction failed");

  built[0].onmessage({ data: workerResponse(built[0], { res: creditsFragment(0, 4) }) });
  assert.equal(delivered.length, 0, "a 1-of-4 ranking is not the comparison");

  harness.flushTimers();
  assert.equal(delivered.length, 1, "the synchronous fallback answers the request");
  assert.equal(delivered[0].error, null);
  assert.equal(delivered[0].result.mode, "sync-fallback");
});

test("a mid-dispatch construction failure charges no healthy slot", () => {
  // The failure belongs to a Worker that was never built. Charging rung 1 to whichever slot the
  // previous iteration left behind terminates a Worker that is still solving its own shard.
  const { harness, built } = halfDispatchedFanOut();
  harness.callRequest(creditsRequest(1), () => {});

  assert.equal(built.length, 2);
  assert.equal(built[1].terminated, false, "the last dispatched slot must not be dropped for a construction that threw");
  assert.equal(built[0].terminated, false);
  const status = harness.status();
  assert.equal(status.poolSlotFailures, 0, "rung 1 names a slot, and a construction that threw produced none");
  assert.equal(status.workerFailures, 1, "a factory that throws still rates the Worker mechanism");
  assert.ok(status.retryInMs > 0);
});

test("an unusable shard descriptor is refused before it costs a Worker round trip", () => {
  const harness = lifecycleHarness();
  const refused = [
    2, "1/3", [1, 3], { index: 1 }, { count: 3 }, { index: 1, count: 3, budget: 50 },
    { index: 3, count: 3 }, { index: -1, count: 3 }, { index: 0.5, count: 3 }, { index: 0, count: 0 },
  ];
  for (const shard of refused) {
    assert.throws(
      () => harness.callRequest({ ...request("items", 1, "A"), shard }, () => {}),
      /shard must be \{index,count\}/,
      `${JSON.stringify(shard)} must be refused`
    );
  }
  assert.equal(harness.workers.length, 0, "a caller's bad descriptor must not build a Worker to reject it");
});

test("every construction under a supersede storm is paid for by terminating busy work", () => {
  /* Counting terminations of any kind would make this a tautology: each request either reuses an
   * idle slot or terminates one and constructs, so "constructions <= 1 + terminations" holds even
   * when a broken Worker drives unbounded churn. The bound only says something if it counts the
   * terminations that abandoned work in flight. */
  const storm = lifecycleHarness();
  let busyTerminations = 0;
  for (let revision = 1; revision <= 12; revision += 1) {
    const busyBefore = storm.status().poolBusy;
    const terminatedBefore = storm.workers.filter(worker => worker.terminated).length;
    storm.callRequest(request("items", revision, `S${revision}`), () => {});
    const terminated = storm.workers.filter(worker => worker.terminated).length - terminatedBefore;
    assert.ok(terminated <= busyBefore, "a request may only terminate Workers that were busy");
    busyTerminations += terminated;
  }
  const stormStatus = storm.status();
  assert.equal(storm.workers.length, 12, "each supersede kills busy work and must respawn for the new one");
  assert.equal(stormStatus.poolConstructions, storm.workers.length);
  assert.equal(busyTerminations, 11);
  assert.ok(stormStatus.poolConstructions <= 1 + busyTerminations,
    "constructions must not exceed the pool cap plus its busy terminations");
  assert.equal(stormStatus.poolSize, 1);

  const idle = lifecycleHarness();
  for (let revision = 1; revision <= 12; revision += 1) {
    idle.callRequest(request("items", revision, `I${revision}`), () => {});
    const worker = idle.workers[0];
    worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: `I${revision}` } }, revision - 1));
  }
  assert.equal(idle.workers.length, 1, "a pool that is idle between solves is reused, never churned");
  assert.equal(idle.status().poolConstructions, 1);
});

test("a Worker that dies after every delivery stops being rebuilt without ever being rated", () => {
  /* The idle late-error branch still rates nothing: a late error with no request behind it lost no
   * work, so counting it against the Worker mechanism would arm a backoff and surface the fallback
   * notice for a solve that succeeded. What it costs instead is a construction, and the pool's
   * allowance is what makes that finite. */
  const harness = lifecycleHarness();
  let busyTerminations = 0;
  for (let revision = 1; revision <= 40; revision += 1) {
    const before = harness.workers.length;
    harness.callRequest(request("items", revision, `X${revision}`), () => {});
    if (harness.workers.length === before) continue;
    const worker = harness.workers[harness.workers.length - 1];
    worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: `X${revision}` } }));
    const busyBefore = harness.status().poolBusy;
    worker.emitError("died after delivering");
    if (busyBefore > 0) busyTerminations += 1;
  }
  const status = harness.status();
  assert.equal(busyTerminations, 0, "nothing this Worker did ever abandoned work in flight");
  assert.equal(harness.workers.length, 5, "the ledger stops paying for a Worker that cannot survive delivery");
  assert.equal(status.poolConstructions, 5);
  assert.equal(status.poolUnratedDisposals, 5);
  assert.equal(status.workerFailures, 0, "the idle disposal path rates nothing");
  assert.equal(status.retryInMs, 0, "and arms no backoff");
  assert.equal(status.poolTripped, true);
  assert.equal(status.fallbackActive, true, "solving continues on the main thread, which the notice now states truthfully");
  assert.equal(harness.elements.solveFallback.hidden, false);

  /* The same Worker on a pooled page. poolEnabled reading false means something only here — on the
   * page above the switch was off before the first solve — so this is what shows the tripwire turns
   * the pool off rather than the switch having been off all along. */
  const pooled = pooledHarness({ hardwareConcurrency: 8 });
  assert.equal(pooled.status().poolEnabled, true);
  for (let revision = 1; revision <= 40; revision += 1) {
    const before = pooled.workers.length;
    pooled.callRequest(request("items", revision, `Y${revision}`), () => {});
    if (pooled.workers.length === before) continue;
    const worker = pooled.workers[pooled.workers.length - 1];
    worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: `Y${revision}` } }));
    worker.emitError("died after delivering");
  }
  const pooledStatus = pooled.status();
  assert.equal(pooled.workers.length, 8, "four slots buy four more rebuilds than one slot does, not unlimited ones");
  assert.equal(pooledStatus.poolUnratedDisposals, 8);
  assert.equal(pooledStatus.workerFailures, 0);
  assert.equal(pooledStatus.poolTripped, true);
  assert.equal(pooledStatus.poolEnabled, false);
});

test("fifty-five supersedes on a pooled page pay for every construction", () => {
  const storm = pooledHarness({ hardwareConcurrency: 8 });
  assert.equal(storm.status().poolEnabled, true);
  let busyTerminations = 0;
  for (let revision = 1; revision <= 55; revision += 1) {
    const busyBefore = storm.status().poolBusy;
    const terminatedBefore = storm.workers.filter(worker => worker.terminated).length;
    storm.callRequest(request("items", revision, `P${revision}`), () => {});
    const terminated = storm.workers.filter(worker => worker.terminated).length - terminatedBefore;
    assert.ok(terminated <= busyBefore, "a request may only terminate Workers that were busy");
    busyTerminations += terminated;
  }
  const status = storm.status();
  assert.equal(busyTerminations, 54);
  assert.equal(status.poolConstructions, 55);
  assert.ok(status.poolConstructions <= 4 + busyTerminations,
    "constructions must not exceed the pool cap plus its busy terminations");
  assert.equal(status.poolUnratedDisposals, 0);
  assert.equal(status.poolTripped, false, "ordinary supersede churn settles its own bill");
  assert.equal(status.poolSize, 1);
});

test("a Manual toggle loop constructs nothing pooled, and trips nothing unpooled", () => {
  const pooled = pooledHarness({ hardwareConcurrency: 8 });
  pooled.callRequest(request("items", 1, "A"), () => {});
  pooled.workers[0].emitMessage(workerResponse(pooled.workers[0], { res: { mode: "items", marker: "A" } }));
  for (let round = 1; round <= 25; round += 1) {
    pooled.cancel("Manual mode renders synchronously");
    pooled.callRequest(request("items", round + 1, `T${round}`), () => {});
    pooled.workers[0].emitMessage(
      workerResponse(pooled.workers[0], { res: { mode: "items", marker: `T${round}` } }, round));
  }
  assert.equal(pooled.workers.length, 1, "an idle Worker survives every toggle");
  assert.equal(pooled.status().poolConstructions, 1);
  assert.equal(pooled.status().poolTripped, false);

  /* The same loop with the pool off rebuilds a Worker every round, because cancel() disposes idle
   * Workers there. That churn is the page's own instruction and pays for itself; if it did not, the
   * tripwire would fire on ordinary Manual-mode use and take the background solver with it. */
  const unpooled = lifecycleHarness();
  for (let round = 1; round <= 25; round += 1) {
    unpooled.callRequest(request("items", round, `U${round}`), () => {});
    const worker = unpooled.workers[unpooled.workers.length - 1];
    worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: `U${round}` } }));
    unpooled.cancel("Manual mode renders synchronously");
  }
  assert.equal(unpooled.workers.length, 25);
  assert.equal(unpooled.status().poolConstructions, 25);
  assert.equal(unpooled.status().poolUnratedDisposals, 0);
  assert.equal(unpooled.status().poolTripped, false);
});

test("one Worker error climbs every rung of the ladder, and a delivery walks back the recoverable ones", () => {
  // Rungs 1 and 2 are the same event while a request owns the whole pool, but they are counted
  // apart so the rung that fired is legible once a request owns several slots.
  const harness = pooledHarness({ hardwareConcurrency: 8 });
  const painted = [];
  harness.callRequest(request("items", 1, "A"), result => painted.push(result.mode));
  harness.workers[0].emitError("load failed");

  const failed = harness.status();
  assert.equal(failed.poolSlotFailures, 1, "rung 1 attributed the failure to the slot");
  assert.equal(failed.poolFailures, 1, "rung 2 fired because dropping it left no slot");
  assert.equal(failed.workerFailures, 1, "rung 3 rated the Worker mechanism");
  assert.ok(failed.retryInMs > 0);
  assert.equal(failed.poolEnabled, false, "a pool with no healthy slot is not a parallel pool");
  assert.equal(failed.poolTripped, false, "a rated failure is a cooldown, not a tripwire");
  harness.flushTimers();
  assert.deepEqual(painted, ["sync-fallback"], "rung 4 solved it on the main thread");

  harness.advance(5_000);
  harness.callRequest(request("items", 2, "B"), result => painted.push(result.marker));
  const recovered = harness.workers[1];
  recovered.emitMessage(workerResponse(recovered, { res: { mode: "items", marker: "B" } }));
  const healthy = harness.status();
  assert.deepEqual(painted, ["sync-fallback", "B"]);
  assert.equal(healthy.workerFailures, 0);
  assert.equal(healthy.poolEnabled, true, "a delivery restores the pool");
  assert.equal(healthy.poolSlotFailures, 1, "the counters record what fired and are not walked back");
  assert.equal(healthy.poolFailures, 1);
});

test("with the pool off, cancel disposes the Worker exactly as the single-Worker service did", () => {
  // The switch is only a rollback if clearing it restores the disposal schedule too: cancel() is
  // reached from every render in Manual mode, and from import, rollback, and reset.
  const harness = lifecycleHarness();
  assert.equal(harness.status().poolEnabled, false);
  harness.callRequest(request("items", 1, "A"), () => {});
  const worker = harness.workers[0];
  worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: "A" } }));

  const cancelled = harness.cancel("Manual mode renders synchronously");
  assert.equal(worker.terminated, true, "an unpooled page releases its Worker on cancel");
  assert.equal(cancelled.workerOwned, false);
  assert.equal(cancelled.poolSize, 0);

  harness.callRequest(request("items", 2, "B"), () => {});
  assert.equal(harness.workers.length, 2, "and constructs a fresh one for the next request");
  assert.equal(harness.status().poolConstructions, 2);
});

test("with the pool on, cancel abandons busy work but keeps an idle Worker for the next request", () => {
  const harness = pooledHarness();
  assert.equal(harness.status().poolEnabled, true);
  harness.callRequest(request("items", 1, "A"), () => {});
  const worker = harness.workers[0];
  worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: "A" } }));

  const cancelled = harness.cancel("Manual mode renders synchronously");
  assert.equal(worker.terminated, false, "an idle Worker has no obsolete work to abandon");
  assert.equal(cancelled.poolSize, 1);
  assert.equal(cancelled.poolBusy, 0);

  harness.callRequest(request("items", 2, "B"), () => {});
  assert.equal(harness.workers.length, 1, "returning from Manual mode must construct nothing");
  assert.equal(harness.status().poolConstructions, 1);
});

test("the pool switch reads on, off, and absent as three distinct states", () => {
  assert.equal(lifecycleHarness().status().poolEnabled, false);
  assert.equal(pooledHarness().status().poolEnabled, true);
  assert.equal(poolFlagHarness("off").status().poolEnabled, false);
  assert.equal(poolFlagHarness("ON").status().poolEnabled, false, "only the exact tokens are honored");
  assert.equal(poolFlagHarness("1").status().poolEnabled, false);

  /* A one-way opt-in reads identically to this while the default is off, and stops being a kill
   * switch the moment the default flips. Flipping it here is what tells the two apart. */
  const flipped = { poolDefaultOn: true };
  assert.equal(lifecycleHarness(flipped).status().poolEnabled, true, "absent takes the default");
  assert.equal(poolFlagHarness("on", flipped).status().poolEnabled, true);
  assert.equal(poolFlagHarness("off", flipped).status().poolEnabled, false,
    "an explicit off must still turn the pool off once the pool is the default");
  assert.equal(poolFlagHarness("nonsense", flipped).status().poolEnabled, true,
    "an unrecognized value is not an off switch");
});

test("page teardown disposes the pool whatever the switch says", () => {
  // pagehide has no next request to reuse an idle Worker for, so it disposes rather than cancels.
  for (const harness of [lifecycleHarness(), pooledHarness()]) {
    harness.callRequest(request("items", 1, "A"), () => {});
    const worker = harness.workers[0];
    worker.emitMessage(workerResponse(worker, { res: { mode: "items", marker: "A" } }));
    const disposed = harness.dispose("Page teardown");
    assert.equal(worker.terminated, true);
    assert.equal(disposed.poolSize, 0);
    assert.equal(disposed.workerOwned, false);
  }
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
  assert.equal(workerA.releaseCalls, 0);

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
  assert.equal(worker.releaseCalls, 0);
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
  assert.equal(worker.releaseCalls, 0);
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

test("synchronous fallback failures use the structured Worker error shape", () => {
  const thrown = new Error("Fallback validation failed");
  thrown.stack = "Error: Fallback validation failed\n    at optimize (solver.js:1:1)";
  const harness = lifecycleHarness({ optimize() { throw thrown; } });
  const delivered = [];
  harness.callRequest(request("items", 1, "A"), (_result, error) => delivered.push(error));
  harness.workers[0].emitError("Worker unavailable");
  harness.flushTimers();

  assert.deepEqual(JSON.parse(JSON.stringify(delivered)), [{
    message: "Fallback validation failed",
    stack: "Error: Fallback validation failed\n    at optimize (solver.js:1:1)",
  }]);
});

test("solver notices prefer useful messages over Chromium and Firefox stack frames", () => {
  const harness = resultErrorHarness();
  const structured = harness.show({
    message: "Worker state rejected: manual[5].lvl exceeds its cap",
    stack: "Error: Worker state rejected\n    at self.onmessage (blob:forge:1:2)",
  });
  assert.match(structured, /Worker state rejected: manual\[5\]\.lvl exceeds its cap/);
  assert.doesNotMatch(structured, /blob:forge/);

  const firefox = harness.show(
    "self.onmessage@blob:https://forge.invalid/worker-id:1:234\n" +
    "Error: Worker state rejected: manual[6].lvl exceeds its cap"
  );
  assert.match(firefox, /Worker state rejected: manual\[6\]\.lvl exceeds its cap/);
  assert.doesNotMatch(firefox, /self\.onmessage@blob:/);

  const chromium = harness.show(
    "Error: Worker state rejected: manual[5].lvl exceeds its cap\n" +
    "    at self.onmessage (blob:https://forge.invalid/worker-id:1:234)"
  );
  assert.match(chromium, /Worker state rejected: manual\[5\]\.lvl exceeds its cap/);
  assert.doesNotMatch(chromium, /blob:https:/);

  const blobOnly = harness.show(
    "self.onmessage@blob:https://forge.invalid/worker-id:1:234\n" +
    "dispatch@blob:https://forge.invalid/worker-id:1:240"
  );
  assert.match(blobOnly, /Unknown solver failure/);
  assert.doesNotMatch(blobOnly, /blob:https:/);
  assert.match(harness.status(), /Solve failed/i);
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
  assert.equal(worker.releaseCalls, 0);
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
  /* Pooled on purpose: with the pool off, cancel() already disposes everything, so this would pass
   * even if setWorkerFactory stopped releasing the pool itself. Only a page that keeps idle Workers
   * across a cancel can show that the factory swap is what disposed them. */
  const harness = pooledHarness();
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
  assert.equal(owned.releaseCalls, 0);

  harness.callRequest(request("items", 2, "controlled"), result => painted.push(result.marker));
  assert.equal(controlled.messages.length, 1);
  assert.deepEqual(painted, ["default"], "the controlled solve remains deliberately pending");
  controlled.onmessage({ data: workerResponse(controlled, { res: { mode: "items", marker: "controlled" } }) });
  assert.deepEqual(painted, ["default", "controlled"]);
  assert.equal(harness.status().solveStateOwned, false,
    "completion must release every request-currentness field with the callback");
});

function lineCapPersistenceHarness() {
  let resultRenders = 0;
  let lineRenders = 0;
  let rejectWrites = false;
  class EventElement extends FakeElement {
    constructor() { super();this.listeners = new Map();this.value = "";this.dataset = {};this.validity = { badInput: false }; }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    emit(type, target = this) {
      const callback = this.listeners.get(type);
      assert.ok(callback, `missing ${type} listener`);
      callback({ target, key: "", preventDefault() {} });
    }
    getAttribute(name) { return this[name] === undefined ? null : this[name]; }
    setAttribute(name, value) { this[name] = String(value); }
    removeAttribute(name) { delete this[name]; }
    matches() { return false; }
  }

  const storage = new Map();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new EventElement());
    return elements.get(id);
  };
  const context = {
    console,
    JSON,
    Math,
    Number,
    Object,
    String,
    Date,
    performance: { now() { return 0; } },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { if (rejectWrites) throw new Error("storage write rejected"); storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    document: {
      activeElement: null,
      visibilityState: "visible",
      getElementById: element,
      querySelectorAll() { return []; },
      addEventListener() {},
      createElement() { return new EventElement(); },
    },
    window: { addEventListener() {} },
    setTimeout() { return 1; },
    clearTimeout() {},
    solveStateSnapshot(state) { return JSON.parse(JSON.stringify(state)); },
    renderResults() { resultRenders += 1; },
    renderLines() { lineRenders += 1; },
    refreshLineNotes() {},
    solveService: { cancel() {} },
  };
  vm.createContext(context);
  for (const file of ["catalog.js", "core.js", "fields.js", "state.js", "dom.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "js", file), "utf8"), context, { filename: file });
  }
  const events = fs.readFileSync(path.join(root, "js", "events.js"), "utf8");
  const boundary = events.indexOf('document.getElementById("margin")');
  assert.ok(boundary > 0, "line editing remains above the margin event boundary");
  vm.runInContext(events.slice(0, boundary), context, { filename: "events-line-cap.js" });
  vm.runInContext("const initial=normalize(defaults());initial.schemaVersion=CURRENT_SCHEMA_VERSION;syncManual(initial);commitState(initial);save();", context);

  return {
    addLine() { element("btnAddLine").emit("click"); },
    removeLine(index) { element("lines").emit("click", { dataset: { del: String(index) } }); },
    changeCap(index, value) { element("lines").emit("change", { dataset: { line: String(index) }, value: String(value) }); },
    inputLine(source, index, value) {
      const target = new EventElement();
      target.dataset[source] = String(index);
      target.value = String(value);
      target["data-field-error"] = `field-line-${index}-${source}-error`;
      element("lines").emit("input", target);
    },
    setMode(mode) { vm.runInContext(`S.mode=${JSON.stringify(mode)}`, context); },
    rejectStorageWrites(on = true) { rejectWrites = on; },
    resultRenders() { return resultRenders; },
    lineRenders() { return lineRenders; },
    state() { return JSON.parse(vm.runInContext("JSON.stringify(S)", context)); },
    stored() {
      const raw = vm.runInContext("localStorage.getItem(LSKEY)", context);
      context.__raw = raw;
      const recovery = vm.runInContext("parseStoredState(globalThis.__raw).recovery", context);
      delete context.__raw;
      return { raw: JSON.parse(raw), recovery };
    },
  };
}

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
  let controlsSynced = 0;
  const lifecycle = [];
  const validateSave = options.validateSave || (() => true);
  const documentListeners = new Map();
  const windowListeners = new Map();
  const saveIndicator = { textContent: "auto-saves locally" };
  const staleMessage = { textContent: "" };
  const staleBar = { hidden: true, querySelector: () => staleMessage };
  const resultsClasses = new Set();
  const resultsElement = { classList: { toggle(name, on) { if (on) resultsClasses.add(name);else resultsClasses.delete(name); } } };
  const context = {
    console,
    stateRevision: 1,
    S: { mode: options.mode || "items", dupe: 25 },
    LSKEY: "test-state",
    localStorage: {
      getItem(key) { return key === "test-state" ? this.raw || null : null; },
      setItem(key, value) { if(key === "test-state")this.raw = String(value); },
    },
    document: {
      querySelectorAll() { return []; },
      getElementById(id) {
        if (id === "saveind") return saveIndicator;
        if (id === "staleBar") return staleBar;
        if (id === "results") return resultsElement;
        return null;
      },
      visibilityState: "visible",
      addEventListener(type, callback) { documentListeners.set(type, callback); },
    },
    window: {
      addEventListener(type, callback) { windowListeners.set(type, callback); },
    },
    save() {
      saves += 1;
      lifecycle.push("save");
      if (!validateSave(context.S)) { saveIndicator.textContent = "invalid value not saved";return false; }
      context.localStorage.setItem("test-state", JSON.stringify(context.S));
      return true;
    },
    mutateState(mutator) { mutator(context.S);context.stateRevision += 1;return context.S; },
    commitState(next) { context.S = next;context.stateRevision += 1;return context.S; },
    solveStateSnapshot(state) { return JSON.parse(JSON.stringify(state)); },
    renderResults() { renders += 1; },
    solveService: {
      request() { requests += 1; },
      // Both release solve ownership, so both count; the lifecycle trace records which entry point
      // ran, because teardown must dispose the pool where a supersede only cancels.
      cancel() { cancels += 1;lifecycle.push("cancel"); },
      dispose() { cancels += 1;lifecycle.push("dispose"); },
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
  // The stale-plan bar sits past the field-draft parser but belongs to the same scheduler: it is what
  // a deferred edit raises instead of solving. Take that block without the DOM wiring after it.
  const staleStart = source.indexOf("const STALE_CAUSES");
  const staleEnd = source.indexOf("function commitLineStructureEdit");
  assert.ok(staleStart > boundary && staleEnd > staleStart, "the deferred-solve block remains isolated above line editing");
  vm.runInContext(source.slice(staleStart, staleEnd), context, { filename: "events-stale.js" });
  const lifecycleStart = source.indexOf('document.addEventListener("visibilitychange"');
  assert.ok(lifecycleStart > boundary, "page lifecycle handlers remain registered at the event boundary");
  vm.runInContext(source.slice(lifecycleStart), context, { filename: "events-page-lifecycle.js" });
  return {
    mutate(mutator) {
      if (typeof mutator === "function") {
        context.__mutator = mutator;
        vm.runInContext("mutateState(globalThis.__mutator)", context);
        delete context.__mutator;
      } else context.stateRevision += 1;
    },
    corruptWithoutRevision(mutator) {
      context.__mutator = mutator;
      vm.runInContext("globalThis.__mutator(S)", context);
      delete context.__mutator;
    },
    legacySave() { return context.save(); },
    scheduleSolve() { vm.runInContext("scheduleSolve()", context); },
    persistNow() { return vm.runInContext("persistNow()", context); },
    doSolve() { return vm.runInContext("doSolve()", context); },
    markStale(cause) { vm.runInContext(`markStale(${JSON.stringify(cause)})`, context); },
    clearStaleUI() { vm.runInContext("clearStaleUI()", context); },
    toggleProject(on) { vm.runInContext(`commitProjectInclusion(st=>{st.projectOn=${on === true};})`, context); },
    staleBar() { return { hidden: staleBar.hidden, message: staleMessage.textContent, dimmed: resultsClasses.has("stale") }; },
    commitResultMutation(mutator) {
      context.__mutator = mutator;
      context.__syncControls = () => { controlsSynced += 1; };
      const value = vm.runInContext(
        "typeof commitResultMutation === 'function' ? commitResultMutation(globalThis.__mutator, globalThis.__syncControls) : null",
        context
      );
      delete context.__mutator;
      delete context.__syncControls;
      return value;
    },
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
    controlsSynced() { return controlsSynced; },
    saveStatus() { return saveIndicator.textContent; },
    state() { return JSON.parse(JSON.stringify(context.S)); },
    lifecycle() { return lifecycle.slice(); },
    revision() { return context.stateRevision; },
    storedState() { return JSON.parse(context.localStorage.raw); },
  };
}

test("line-cap edits clamp Manual state before the complete multi-line build persists", () => {
  const harness = lineCapPersistenceHarness();
  harness.addLine();
  harness.addLine();
  harness.changeCap(5, 64);
  harness.changeCap(6, 32);
  harness.changeCap(0, 256);
  harness.inputLine("spx", 5, 27.5);
  harness.inputLine("turbo", 6, 14);

  const state = harness.state();
  const stored = harness.stored();
  assert.equal(state.lines.length, 7);
  assert.equal(state.manual[5].lvl, 64);
  assert.equal(state.manual[6].lvl, 32);
  assert.equal(state.manual[0].lvl, 256);
  assert.equal(state.lines[5].spx, 27.5);
  assert.equal(state.lines[6].turbo, 14);
  assert.deepEqual(stored.raw.lines, state.lines);
  assert.deepEqual(stored.raw.manual, state.manual);
  assert.equal(stored.recovery, null);
});

test("line structure and cap edits repaint synchronously while Manual mode is already selected", () => {
  const harness = lineCapPersistenceHarness();
  harness.setMode("manual");

  harness.addLine();
  harness.changeCap(5, 64);
  harness.removeLine(5);

  assert.equal(harness.resultRenders(), 3,
    "Manual mode must not leave its editable table at the previous line count or cap");
});

test("a rejected Manual-mode line edit restores accepted state and controls without repainting results", () => {
  const harness = lineCapPersistenceHarness();
  harness.setMode("manual");
  const accepted = harness.state();
  const rendersBefore = harness.lineRenders();
  harness.rejectStorageWrites();

  harness.addLine();

  assert.deepEqual(harness.state(), accepted, "the unsaved sixth line must be rolled back");
  assert.equal(harness.resultRenders(), 0, "results must remain on the last persisted state");
  assert.equal(harness.lineRenders(), rendersBefore + 1, "line controls must be restored from accepted state");
});

test("a rejected manual-preset selection restores the accepted dropdown value", () => {
  const manualSource = fs.readFileSync(path.join(root, "js", "manual.js"), "utf8");
  const select = { value: "attempted" };
  const context = {
    console,
    ALLITEMS: ["Bits"],
    S: {
      lines: [{ max: 1 }],
      manual: [{ job: "Idle", lvl: 1, sell: false }],
      manualSaved: [
        { id: "accepted", config: [{ job: "Idle", lvl: 1, sell: false }] },
        { id: "attempted", config: [{ job: "Bits", lvl: 1, sell: true }] },
      ],
      manualActiveId: "accepted",
    },
    document: { getElementById(id) { return id === "manualPreset" ? select : null; } },
    syncManual() {},
    commitResultMutation(mutator, syncControls) {
      const previous = JSON.parse(JSON.stringify(context.S));
      mutator(context.S);
      context.S = previous;
      if (syncControls) syncControls();
      return false;
    },
  };
  vm.createContext(context);
  vm.runInContext(manualSource, context, { filename: "manual-preset-rollback.js" });
  vm.runInContext('loadManualPreset("attempted")', context);

  assert.equal(context.S.manualActiveId, "accepted");
  assert.equal(select.value, "accepted");
});

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

test("a rejected direct result mutation restores accepted state and controls without repainting", () => {
  const harness = schedulerHarness({
    validateSave(state) { return state.dupe >= 0 && state.dupe <= 100; },
  });
  assert.equal(harness.persistNow(), true);

  const committed = harness.commitResultMutation(state => { state.dupe = 101; });

  assert.equal(committed, false);
  assert.deepEqual(harness.state(), { mode: "items", dupe: 25 });
  assert.deepEqual(harness.storedState(), { mode: "items", dupe: 25 });
  assert.equal(harness.controlsSynced(), 1);
  assert.equal(harness.saveStatus(), "invalid value not saved");
  assert.deepEqual(harness.counts(), { saves: 2, renders: 0, requests: 0, cancels: 0 });
});

test("a rejected direct result mutation retains an earlier valid pending edit for pagehide", () => {
  let rejectNextWrite = false;
  const harness = schedulerHarness({
    validateSave() {
      if (!rejectNextWrite) return true;
      rejectNextWrite = false;
      return false;
    },
  });
  assert.equal(harness.persistNow(), true);
  harness.mutate(state => { state.dupe = 30; });
  harness.scheduleSolve();
  rejectNextWrite = true;

  assert.equal(harness.commitResultMutation(state => { state.mode = "credits"; }), false);
  assert.deepEqual(harness.state(), { mode: "items", dupe: 30 }, "the earlier valid edit remains accepted in memory");
  assert.deepEqual(harness.storedState(), { mode: "items", dupe: 25 }, "the failed transaction did not reach storage");

  harness.pagehide();

  assert.deepEqual(harness.storedState(), { mode: "items", dupe: 30 }, "pagehide flushes the restored pending edit");
  assert.deepEqual(harness.counts(), { saves: 3, renders: 0, requests: 0, cancels: 1 });
});

test("an accepted direct result mutation persists, syncs controls, and renders once", () => {
  const harness = schedulerHarness();
  assert.equal(harness.persistNow(), true);

  const committed = harness.commitResultMutation(state => { state.mode = "credits"; });

  assert.equal(committed, true);
  assert.deepEqual(harness.state(), { mode: "credits", dupe: 25 });
  assert.deepEqual(harness.storedState(), { mode: "credits", dupe: 25 });
  assert.equal(harness.controlsSynced(), 1);
  assert.deepEqual(harness.counts(), { saves: 2, renders: 1, requests: 0, cancels: 0 });
});

test("pagehide flushes persistence, clears delayed solving, then disposes solve ownership", () => {
  const harness = schedulerHarness();
  harness.mutate();
  harness.scheduleSolve();
  harness.pagehide();
  harness.advance(600);

  // dispose, not cancel: teardown has no next request, so it releases the Workers too.
  assert.deepEqual(harness.lifecycle(), ["save", "dispose"]);
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

test("ticking projects on and off costs one deferred solve, not one per tick", () => {
  const harness = schedulerHarness({ mode: "project" });
  harness.toggleProject(false);
  harness.toggleProject(true);
  harness.toggleProject(false);
  harness.advance(600);   // nothing is waiting on a timer: the batch only resolves on Resimulate

  assert.deepEqual(harness.counts(), { saves: 3, renders: 0, requests: 0, cancels: 0 });
  assert.equal(harness.state().projectOn, false, "each tick is accepted immediately");
  assert.equal(harness.storedState().projectOn, false, "each tick persists immediately");
  assert.deepEqual(harness.staleBar(), {
    hidden: false,
    message: "Plan out of date — project selection changed. Press Resimulate to update it.",
    dimmed: true,
  });

  harness.doSolve();   // what Resimulate runs
  assert.deepEqual(harness.counts(), { saves: 3, renders: 1, requests: 0, cancels: 0 });
});

test("a tick outside Project plan persists quietly rather than claiming the shown plan expired", () => {
  // Max items/Credits never read the project selection, so a tick there invalidates nothing.
  const harness = schedulerHarness({ mode: "items" });
  harness.toggleProject(true);
  harness.advance(600);

  assert.deepEqual(harness.counts(), { saves: 1, renders: 0, requests: 0, cancels: 0 });
  assert.equal(harness.state().projectOn, true);
  assert.deepEqual(harness.staleBar(), { hidden: true, message: "", dimmed: false });
});

test("the stale bar names every kind of edit batched into one Resimulate", () => {
  const harness = schedulerHarness({ mode: "project" });
  harness.mutate();
  harness.markStale();            // a crafter-line edit
  assert.equal(harness.staleBar().message,
    "Plan out of date — crafter line inputs changed. Press Resimulate to update it.");

  harness.toggleProject(false);
  assert.equal(harness.staleBar().message,
    "Plan out of date — crafter line inputs and project selection changed. Press Resimulate to update it.");

  // renderResults() clears the bar ahead of every repaint (js/results.js), so one Resimulate
  // discharges both causes rather than leaving the line edit still flagged.
  harness.clearStaleUI();
  assert.deepEqual(harness.staleBar(), {
    hidden: true,
    message: "Plan out of date — crafter line inputs and project selection changed. Press Resimulate to update it.",
    dimmed: false,
  });
  harness.markStale("projects");
  assert.equal(harness.staleBar().message,
    "Plan out of date — project selection changed. Press Resimulate to update it.");
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
