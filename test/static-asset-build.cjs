"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const { buildStaticSite, buildWorkerPayload } = require("../scripts/build-static.cjs");

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function sha16(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function walk(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => {
      const relative = path.posix.join(prefix, entry.name);
      return entry.isDirectory() ? walk(path.join(directory, entry.name), relative) : [relative];
    })
    .sort();
}

function snapshot(directory) {
  return new Map(walk(directory).map(relative => [
    relative,
    fs.readFileSync(path.join(directory, ...relative.split("/"))),
  ]));
}

function staticFiles(directory) {
  return walk(path.join(directory, "static"));
}

function findOne(directory, pattern) {
  const matches = staticFiles(directory).filter(file => pattern.test(file));
  assert.equal(matches.length, 1, `expected one ${pattern}, got ${matches.join(", ")}`);
  return matches[0];
}

function generatedApp(directory) {
  const appName = findOne(directory, /^app\.[0-9a-f]{16}\.js$/);
  return fs.readFileSync(path.join(directory, "static", appName), "utf8");
}

function generatedWorkerLifecycleSource(app) {
  const catalogBoundary = app.indexOf(`\n;\n${fs.readFileSync(path.join(root, "js", "catalog.js"), "utf8")}`);
  assert.ok(catalogBoundary > 0, "generated app must retain the registered page-script boundary");
  const serviceAnchor = app.indexOf("const solveService=(()=>{");
  assert.ok(serviceAnchor > catalogBoundary, "generated app must include solveService");
  const serviceStart = app.lastIndexOf('"use strict";', serviceAnchor);
  const serviceEnd = app.indexOf("\n;\n", serviceAnchor);
  assert.ok(serviceStart > catalogBoundary && serviceEnd > serviceStart,
    "generated app must retain the solveService module boundary");
  return `${app.slice(0, catalogBoundary)}\n;\n${app.slice(serviceStart, serviceEnd)}`;
}

function copyBuildInputs(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of ["assets", "compat", "css", "js"]) {
    fs.cpSync(path.join(root, entry), path.join(destination, entry), { recursive: true });
  }
  fs.copyFileSync(path.join(root, "index.html"), path.join(destination, "index.html"));
}

function assertLegacyFence(file) {
  const imported = [];
  const posted = [];
  const context = {
    importScripts(...urls) { imported.push(...urls); },
    self: { postMessage(message) { posted.push(message); } },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  assert.equal(typeof context.self.onmessage, "function");
  assert.throws(() => context.self.onmessage({ data: { reqId: 1 } }), /refresh/i);
  assert.deepEqual(imported, [], "a compatibility fence must never import dependencies");
  assert.deepEqual(posted, [], "a caught Worker response would keep a stale tab retrying");
}

test("the generated release is deterministic and content-addressed", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-static-build-"));
  const first = path.join(temporary, "first");
  const second = path.join(temporary, "second");
  buildStaticSite({ sourceRoot: root, outputRoot: first });
  buildStaticSite({ sourceRoot: root, outputRoot: second });

  const firstSnapshot = snapshot(first);
  const secondSnapshot = snapshot(second);
  assert.deepEqual([...firstSnapshot.keys()], [...secondSnapshot.keys()]);
  for (const [relative, bytes] of firstSnapshot) {
    assert.deepEqual(bytes, secondSnapshot.get(relative), `${relative} changed between identical builds`);
  }

  for (const relative of staticFiles(first)) {
    const bytes = fs.readFileSync(path.join(first, "static", relative));
    const match = relative.match(/\.([0-9a-f]{16})\.[^.]+$/);
    assert.ok(match, `${relative} is not content-addressed`);
    assert.equal(match[1], sha16(bytes), `${relative} was not named from its final bytes`);
  }
});

test("the generated page has a closed hashed asset graph and an in-memory Worker", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-static-graph-"));
  buildStaticSite({ sourceRoot: root, outputRoot: temporary });

  assert.deepEqual(walk(temporary), [
    "index.html",
    "js/solver.worker.js",
    "js/solver.worker.v2.js",
    ...staticFiles(temporary).map(file => `static/${file}`),
  ].sort());

  const index = fs.readFileSync(path.join(temporary, "index.html"), "utf8");
  assert.doesNotMatch(index, /(?:src|href)=["'](?:js\/|css\/|assets\/)/);
  assert.doesNotMatch(index, /\/assets\/(?:dupe|speed)\.jpg/);
  assert.match(index, /worker-src 'self' blob:/);

  const indexStaticUrls = [...index.matchAll(/["'(](\/static\/[^"')]+)["')]/g)].map(match => match[1]);
  assert.ok(indexStaticUrls.length >= 4, "the page should reference its app, CSS, favicon, and tooltip image");
  for (const url of indexStaticUrls) {
    assert.ok(fs.existsSync(path.join(temporary, ...url.split("/"))), `${url} is missing from the build`);
  }

  const appName = findOne(temporary, /^app\.[0-9a-f]{16}\.js$/);
  const app = fs.readFileSync(path.join(temporary, "static", appName), "utf8");
  assert.match(app, /__FORGE_SOLVER_WORKER_SOURCE__/);
  assert.match(app, /function replayProjectSchedule\(/,
    "the generated page and embedded Worker must include the pure Project replay helper");
  assert.match(app, /URL\.createObjectURL\(new Blob/);
  assert.match(app, /__forgeCreateSolverWorker\(\)/);
  assert.doesNotMatch(app, /new Worker\(["'][^"']+\.js/);
  assert.doesNotMatch(app, /importScripts\s*\(/);
  assert.doesNotMatch(app, /(?:js\/solver\.worker|\/assets\/speed\.jpg)/);

  const speedName = findOne(temporary, /^speed\.[0-9a-f]{16}\.jpg$/);
  assert.match(app, new RegExp(`/static/${speedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  assertLegacyFence(path.join(temporary, "js", "solver.worker.js"));
  assert.deepEqual(
    fs.readFileSync(path.join(temporary, "js", "solver.worker.js")),
    fs.readFileSync(path.join(root, "js", "solver.worker.js")),
    "the generated oldest-tab fence must preserve its source bytes"
  );
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(path.join(temporary, "js", "solver.worker.js"))).digest("hex"),
    "4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188",
    "the oldest-tab fence must never silently change"
  );
  const legacyV2 = fs.readFileSync(path.join(temporary, "js", "solver.worker.v2.js"), "utf8");
  assert.equal(
    crypto.createHash("sha256").update(legacyV2).digest("hex"),
    "9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2",
    "the immutable v2 compatibility endpoint must never silently change"
  );
  assert.deepEqual(
    fs.readFileSync(path.join(temporary, "js", "solver.worker.v2.js")),
    fs.readFileSync(path.join(root, "compat", "solver.worker.v2.js"))
  );
  assert.match(legacyV2, /validateWorkerState/);
  assert.match(legacyV2, /const res = optimize\(\)/);
  assert.doesNotMatch(legacyV2, /importScripts\s*\(/,
    "the frozen v2 compatibility Worker must be self-contained");
});

test("the current Worker payload registers Project scheduling before the solver", () => {
  const payload = buildWorkerPayload(root);
  const helper = payload.indexOf("function replayProjectSchedule(");
  const solver = payload.indexOf("function optimizeProjectTop(");
  assert.ok(helper >= 0, "current Worker payload omitted project-schedule.js");
  assert.ok(solver > helper, "project-schedule.js must execute before solver.js");
  assert.doesNotMatch(payload, /importScripts\s*\(/);
});

test("early generated Blob Worker termination releases its URL and backstop immediately", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-static-worker-release-"));
  buildStaticSite({ sourceRoot: root, outputRoot: temporary });
  const app = generatedApp(temporary);
  const workers = [];
  const revoked = [];
  const timers = new Map();
  let nextTimer = 1;

  class GeneratedWorker {
    constructor(url) {
      this.url = String(url);
      this.listeners = { message: [], error: [] };
      this.terminated = false;
      workers.push(this);
    }
    addEventListener(type, listener) { this.listeners[type].push(listener); }
    postMessage() {}
    terminate() { this.terminated = true; }
    emit(type) { this.listeners[type].forEach(listener => listener({ type })); }
  }

  const context = {
    console,
    Blob: class GeneratedBlob {},
    URL: {
      createObjectURL() { return `blob:forge-worker-${workers.length + 1}`; },
      revokeObjectURL(url) { revoked.push(String(url)); },
    },
    Worker: GeneratedWorker,
    document: { getElementById() { return null; } },
    S: { mode: "items" },
    stateRevision: 7,
    getLineStability() { return {}; },
    optimize() { return {}; },
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(context);
  vm.runInContext(generatedWorkerLifecycleSource(app), context, { filename: "generated-app-worker-lifecycle.js" });
  context.request = {
    mode: "items",
    stateRevision: 7,
    budget: 200,
    stateSnapshot: { mode: "items" },
  };
  context.done = () => {};
  vm.runInContext("solveService.request(request, done)", context);

  assert.equal(workers.length, 1);
  assert.deepEqual(revoked, []);
  assert.equal(timers.size, 1);
  vm.runInContext('solveService.cancel("page teardown")', context);

  assert.equal(workers[0].terminated, true);
  assert.deepEqual(revoked, ["blob:forge-worker-1"]);
  assert.equal(timers.size, 0, "release must not retain the Blob URL through its backstop timer");
  workers[0].emit("error");
  assert.deepEqual(revoked, ["blob:forge-worker-1"], "release must be idempotent after a late event");
});

test("generated Blob Worker setup failures terminate before one idempotent URL release", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-static-worker-setup-failure-"));
  buildStaticSite({ sourceRoot: root, outputRoot: temporary });
  const app = generatedApp(temporary);
  const scenarios = [
    { stage: "property", terminateThrows: false },
    { stage: "listener", terminateThrows: false },
    { stage: "timer", terminateThrows: false },
    { stage: "listener", terminateThrows: true },
  ];

  for (const scenario of scenarios) {
    const workers = [];
    const revoked = [];
    class SetupFailingWorker {
      constructor(url) {
        this.url = String(url);
        this.listeners = { message: [], error: [] };
        this.terminateCalls = 0;
        if (scenario.stage === "property") {
          Object.defineProperty(this, "__forgeRelease", {
            set() { throw new Error("property setup failed"); },
          });
        }
        workers.push(this);
      }
      addEventListener(type, listener) {
        if (scenario.stage === "listener" && type === "error") {
          throw new Error("listener setup failed");
        }
        this.listeners[type].push(listener);
      }
      terminate() {
        this.terminateCalls += 1;
        if (scenario.terminateThrows) throw new Error("termination cleanup failed");
      }
      emit(type) { this.listeners[type].forEach(listener => listener({ type })); }
    }

    const context = {
      console,
      Blob: class GeneratedBlob {},
      URL: {
        createObjectURL() { return `blob:setup-${scenario.stage}-${scenario.terminateThrows}`; },
        revokeObjectURL(url) { revoked.push(String(url)); },
      },
      Worker: SetupFailingWorker,
      document: { getElementById() { return null; } },
      S: { mode: "items" },
      stateRevision: 0,
      setTimeout() {
        if (scenario.stage === "timer") throw new Error("timer setup failed");
        return 1;
      },
      clearTimeout() {},
    };
    vm.createContext(context);
    vm.runInContext(generatedWorkerLifecycleSource(app), context, {
      filename: `generated-app-worker-${scenario.stage}-failure.js`,
    });

    assert.throws(
      () => vm.runInContext("__forgeCreateSolverWorker()", context),
      new RegExp(`${scenario.stage} setup failed`)
    );
    assert.equal(workers.length, 1);
    assert.equal(workers[0].terminateCalls, 1,
      `${scenario.stage} setup failure must terminate its already-created Worker`);
    assert.deepEqual(revoked, [`blob:setup-${scenario.stage}-${scenario.terminateThrows}`]);
    workers[0].emit("message");
    assert.equal(revoked.length, 1, `${scenario.stage} cleanup must remain idempotent after a late event`);
  }
});

test("a Worker dependency change automatically rotates the app URL", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-static-dependency-"));
  const source = path.join(temporary, "source");
  const before = path.join(temporary, "before");
  const after = path.join(temporary, "after");
  copyBuildInputs(source);

  buildStaticSite({ sourceRoot: source, outputRoot: before });
  fs.appendFileSync(path.join(source, "js", "core.js"), "\n/* build propagation mutation */\n");
  buildStaticSite({ sourceRoot: source, outputRoot: after });

  assert.notEqual(
    findOne(before, /^app\.[0-9a-f]{16}\.js$/),
    findOne(after, /^app\.[0-9a-f]{16}\.js$/),
    "changing Worker/page code must rotate the app URL"
  );
  assert.equal(
    findOne(before, /^styles\.[0-9a-f]{16}\.css$/),
    findOne(after, /^styles\.[0-9a-f]{16}\.css$/),
    "an unrelated stylesheet should keep the same URL"
  );
  assert.notDeepEqual(
    fs.readFileSync(path.join(before, "index.html")),
    fs.readFileSync(path.join(after, "index.html")),
    "the release pointer must update when the app hash changes"
  );
});

test("a Project schedule helper change rotates only the generated app graph", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-static-project-schedule-"));
  const source = path.join(temporary, "source");
  const before = path.join(temporary, "before");
  const after = path.join(temporary, "after");
  copyBuildInputs(source);
  buildStaticSite({ sourceRoot: source, outputRoot: before });
  fs.appendFileSync(path.join(source, "js", "project-schedule.js"), "\n/* project replay propagation mutation */\n");
  buildStaticSite({ sourceRoot: source, outputRoot: after });
  assert.notEqual(findOne(before, /^app\.[0-9a-f]{16}\.js$/),findOne(after, /^app\.[0-9a-f]{16}\.js$/));
  assert.equal(findOne(before, /^styles\.[0-9a-f]{16}\.css$/),findOne(after, /^styles\.[0-9a-f]{16}\.css$/));
  assert.deepEqual(fs.readFileSync(path.join(before,"js","solver.worker.js")),fs.readFileSync(path.join(after,"js","solver.worker.js")));
  assert.deepEqual(fs.readFileSync(path.join(before,"js","solver.worker.v2.js")),fs.readFileSync(path.join(after,"js","solver.worker.v2.js")));
});

test("an untracked CSS asset dependency fails the build instead of shipping a mutable URL", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-static-css-dependency-"));
  const source = path.join(temporary, "source");
  copyBuildInputs(source);
  fs.appendFileSync(path.join(source, "css", "styles.css"), "\n.future{background:url('/assets/future.png')}\n");
  assert.throws(
    () => buildStaticSite({ sourceRoot: source, outputRoot: path.join(temporary, "output") }),
    /add that dependency to the content-hash build graph/
  );
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
  else console.log(`${tests.length} static asset build tests passed`);
})();
