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
  assert.equal(Object.prototype.hasOwnProperty.call(worker.messages[0].state, "planStart"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(worker.messages[0].state.projects[0], "_open"), false);

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

test("the dispatched solve snapshot removes only documented display state", () => {
  const harness = lifecycleHarness();
  const original = {
    mode: "project",
    planStart: 1_000,
    projects: [{ id: "p1", _open: true, done: 2, levels: [{ costs: [{ item: "Frames", qty: 3 }] }] }],
    nested: { keep: true },
  };
  assert.deepEqual(harness.snapshot(original), {
    mode: "project",
    projects: [{ id: "p1", done: 2, levels: [{ costs: [{ item: "Frames", qty: 3 }] }] }],
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

function schedulerHarness() {
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
  const documentListeners = new Map();
  const windowListeners = new Map();
  const context = {
    console,
    stateRevision: 1,
    S: { mode: "items" },
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
    save() { saves += 1;lifecycle.push("save");context.localStorage.setItem("test-state", JSON.stringify(context.S));return true; },
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
    legacySave() { return context.save(); },
    scheduleSolve() { vm.runInContext("scheduleSolve()", context); },
    persistNow() { return vm.runInContext("persistNow()", context); },
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
