"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const { buildStaticSite, buildWorkerPayload } = require("../scripts/build-static.cjs");
const ANALYTICS_SIGNATURE = /(?:\/_vercel\/(?:insights|speed-insights)|va\.vercel-scripts\.com|vercelAnalytics)/i;
const ROOT_RELATIVE_OWNED_URL = /["'`(=]\/(?:static|assets|js|css)\//;
const EXPECTED_WORKER_FACTORY = `function __forgeCreateSolverWorker(){
  const objectUrl=URL.createObjectURL(new Blob([__FORGE_SOLVER_WORKER_SOURCE__],{type:"text/javascript"}));
  let created=null;
  let release=null;
  try{
    created=new Worker(objectUrl);
    let released=false;
    let releaseTimer=null;
    release=()=>{
      if(released)return;
      released=true;
      if(releaseTimer!==null){clearTimeout(releaseTimer);releaseTimer=null;}
      URL.revokeObjectURL(objectUrl);
    };
    created.__forgeRelease=release;
    if(typeof created.addEventListener==="function"){
      created.addEventListener("message",release,{once:true});
      created.addEventListener("error",release,{once:true});
      releaseTimer=setTimeout(release,60000);
    }else releaseTimer=setTimeout(release,0);
    return created;
  }catch(error){
    if(created)try{created.terminate();}catch(cleanupError){}
    if(release){
      try{release();}catch(cleanupError){try{URL.revokeObjectURL(objectUrl);}catch(revokeError){}}
    }else try{URL.revokeObjectURL(objectUrl);}catch(cleanupError){}
    throw error;
  }
}`;

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

function generatedWorkerFactory(app) {
  const start = app.indexOf("function __forgeCreateSolverWorker(){");
  const end = app.indexOf("\n}\n\n;\n", start);
  assert.ok(start >= 0 && end > start, "generated app must retain the exact Worker factory boundary");
  return app.slice(start, end + 2);
}

function assertUrlResolvesAtMount(directory, url, mount) {
  assert.doesNotMatch(url, /^\//, `${url} must be document-relative`);
  const resolved = new URL(url, `https://forge.invalid${mount}`);
  assert.equal(resolved.pathname, `${mount}${url}`, `${url} escaped the ${mount} mount`);
  const emittedPath = resolved.pathname.slice(mount.length);
  assert.ok(
    fs.existsSync(path.join(directory, ...emittedPath.split("/"))),
    `${url} resolved to missing ${resolved.pathname}`
  );
}

function assertStylesheetRelativeUrlResolvesAtMount(directory, url, stylesheetUrl, mount) {
  assert.doesNotMatch(url, /^\//, `${url} must remain mount-relative`);
  const resolved = new URL(url, `https://forge.invalid${mount}${stylesheetUrl}`);
  const emittedPath = resolved.pathname.slice(mount.length);
  assert.ok(
    fs.existsSync(path.join(directory, ...emittedPath.split("/"))),
    `${url} from ${stylesheetUrl} resolved to missing ${resolved.pathname}`
  );
}

function tooltipCustomPropertyUrl(source, label) {
  const matches = [...source.matchAll(/--tip-img:url\('([^']+)'\)/g)];
  assert.equal(matches.length, 1, `${label} must emit one tooltip custom-property URL`);
  return matches[0][1];
}

function assetNames(directory) {
  return {
    app: findOne(directory, /^app\.[0-9a-f]{16}\.js$/),
    styles: findOne(directory, /^styles\.[0-9a-f]{16}\.css$/),
    favicon: findOne(directory, /^favicon\.[0-9a-f]{16}\.png$/),
    dupe: findOne(directory, /^dupe\.[0-9a-f]{16}\.jpg$/),
    speed: findOne(directory, /^speed\.[0-9a-f]{16}\.jpg$/),
  };
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
  assert.doesNotMatch(index, ROOT_RELATIVE_OWNED_URL);
  assert.doesNotMatch(index, ANALYTICS_SIGNATURE);
  assert.match(index, /worker-src 'self' blob:/);

  const indexStaticUrls = [...index.matchAll(/["'(](static\/[^"')]+)["')]/g)].map(match => match[1]);
  assert.ok(indexStaticUrls.length >= 4, "the page should reference its app, CSS, favicon, and tooltip image");
  for (const url of indexStaticUrls) {
    assertUrlResolvesAtMount(temporary, url, "/");
    assertUrlResolvesAtMount(temporary, url, "/Forge-Planner/");
  }

  const appName = findOne(temporary, /^app\.[0-9a-f]{16}\.js$/);
  const app = fs.readFileSync(path.join(temporary, "static", appName), "utf8");
  assert.match(app, /__FORGE_SOLVER_WORKER_SOURCE__/);
  assert.match(app, /function replayProjectSchedule\(/,
    "the generated page and embedded Worker must include the pure Project replay helper");
  assert.match(app, /URL\.createObjectURL\(new Blob/);
  assert.match(app, /__forgeCreateSolverWorker\(\)/);
  assert.equal(generatedWorkerFactory(app), EXPECTED_WORKER_FACTORY,
    "the base-path repair must not alter the current Worker factory or its cleanup contract");
  assert.equal((app.match(/new Worker\(objectUrl\)/g) || []).length, 1,
    "the generated app must retain exactly one Blob Worker constructor");
  assert.equal((app.match(/created\.__forgeRelease=release/g) || []).length, 1,
    "the generated app must retain exactly one release hook");
  assert.doesNotMatch(app, /new Worker\(["'][^"']+\.js/);
  assert.doesNotMatch(app, /importScripts\s*\(/);
  assert.doesNotMatch(app, /(?:js\/solver\.worker|\/assets\/speed\.jpg)/);
  assert.doesNotMatch(app, ROOT_RELATIVE_OWNED_URL);
  assert.doesNotMatch(app, ANALYTICS_SIGNATURE);

  const stylesName = findOne(temporary, /^styles\.[0-9a-f]{16}\.css$/);
  const stylesheetUrl = `static/${stylesName}`;
  const dupeName = findOne(temporary, /^dupe\.[0-9a-f]{16}\.jpg$/);
  const speedName = findOne(temporary, /^speed\.[0-9a-f]{16}\.jpg$/);
  const dupeUrl = tooltipCustomPropertyUrl(index, "the generated HTML");
  const speedUrl = tooltipCustomPropertyUrl(app, "the generated app");
  assert.equal(dupeUrl, `../static/${dupeName}`);
  assert.equal(speedUrl, `../static/${speedName}`);
  for (const mount of ["/", "/Forge-Planner/"]) {
    assertStylesheetRelativeUrlResolvesAtMount(temporary, dupeUrl, stylesheetUrl, mount);
    assertStylesheetRelativeUrlResolvesAtMount(temporary, speedUrl, stylesheetUrl, mount);
  }

  for (const relative of walk(temporary).filter(file => /\.(?:html|css|js)$/.test(file))) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(temporary, ...relative.split("/")), "utf8"),
      ANALYTICS_SIGNATURE,
      `${relative} must not emit a Vercel Analytics bootstrap or endpoint`
    );
  }

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

test("owned source tooltip URLs are document-relative", () => {
  for (const relative of ["index.html", "js/render.js"]) {
    const source = fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
    assert.doesNotMatch(source, ROOT_RELATIVE_OWNED_URL, `${relative} contains a root-relative owned URL`);
  }
});

test("CSS, favicon, dupe, and speed inputs rotate only their dependent hashed graph", () => {
  const cases = [
    {
      label: "CSS",
      relative: "css/styles.css",
      mutation: "\n/* independent stylesheet rotation */\n",
      rotated: ["styles"],
    },
    {
      label: "favicon",
      relative: "assets/favicon.png",
      mutation: Buffer.from("independent-favicon-rotation"),
      rotated: ["favicon"],
    },
    {
      label: "dupe tooltip",
      relative: "assets/dupe.jpg",
      mutation: Buffer.from("independent-dupe-rotation"),
      rotated: ["dupe"],
    },
    {
      label: "speed tooltip",
      relative: "assets/speed.jpg",
      mutation: Buffer.from("independent-speed-rotation"),
      rotated: ["speed", "app"],
    },
  ];

  for (const entry of cases) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-static-independent-"));
    const source = path.join(temporary, "source");
    const before = path.join(temporary, "before");
    const after = path.join(temporary, "after");
    copyBuildInputs(source);
    buildStaticSite({ sourceRoot: source, outputRoot: before });
    fs.appendFileSync(path.join(source, ...entry.relative.split("/")), entry.mutation);
    buildStaticSite({ sourceRoot: source, outputRoot: after });

    const beforeNames = assetNames(before);
    const afterNames = assetNames(after);
    for (const kind of Object.keys(beforeNames)) {
      const message = `${entry.label} mutation ${entry.rotated.includes(kind) ? "must" : "must not"} rotate ${kind}`;
      if (entry.rotated.includes(kind)) assert.notEqual(afterNames[kind], beforeNames[kind], message);
      else assert.equal(afterNames[kind], beforeNames[kind], message);
    }
    assert.notDeepEqual(
      fs.readFileSync(path.join(after, "index.html")),
      fs.readFileSync(path.join(before, "index.html")),
      `${entry.label} mutation must update the release pointer`
    );
  }
});

test("the current Worker payload registers Project scheduling before the solver", () => {
  const payload = buildWorkerPayload(root);
  const helper = payload.indexOf("function replayProjectSchedule(");
  const solver = payload.indexOf("function optimizeProjectTop(");
  assert.ok(helper >= 0, "current Worker payload omitted project-schedule.js");
  assert.ok(solver > helper, "project-schedule.js must execute before solver.js");
  assert.match(payload, /function parseFieldDraft\(/,
    "the generated current Worker must embed the shared numeric parser");
  assert.match(payload, /function validateFieldValue\(/,
    "the generated current Worker must embed the shared numeric value validator");
  assert.match(payload, /max:60000/,
    "the generated current Worker must retain the 60-second descriptor ceiling");
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

test("a js/solver.js change rotates the app while permanent Worker endpoints stay frozen", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-static-dependency-"));
  const source = path.join(temporary, "source");
  const before = path.join(temporary, "before");
  const after = path.join(temporary, "after");
  copyBuildInputs(source);

  buildStaticSite({ sourceRoot: source, outputRoot: before });
  fs.appendFileSync(path.join(source, "js", "solver.js"), "\n/* solver build propagation mutation */\n");
  buildStaticSite({ sourceRoot: source, outputRoot: after });

  assert.notEqual(
    findOne(before, /^app\.[0-9a-f]{16}\.js$/),
    findOne(after, /^app\.[0-9a-f]{16}\.js$/),
    "changing the current solver must rotate the generated app URL"
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
  for (const endpoint of ["solver.worker.js", "solver.worker.v2.js"]) {
    assert.deepEqual(
      fs.readFileSync(path.join(before, "js", endpoint)),
      fs.readFileSync(path.join(after, "js", endpoint)),
      `${endpoint} must not be regenerated from a current solver change`
    );
  }
  assert.deepEqual(
    fs.readFileSync(path.join(after, "js", "solver.worker.js")),
    fs.readFileSync(path.join(root, "js", "solver.worker.js")),
    "the original compatibility fence must retain its registered bytes"
  );
  assert.deepEqual(
    fs.readFileSync(path.join(after, "js", "solver.worker.v2.js")),
    fs.readFileSync(path.join(root, "compat", "solver.worker.v2.js")),
    "the immutable v2 endpoint must retain its registered bytes"
  );
});

test("a shared fields.js change rotates the generated app and embedded Worker only", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-static-fields-"));
  const source = path.join(temporary, "source");
  const before = path.join(temporary, "before");
  const after = path.join(temporary, "after");
  copyBuildInputs(source);

  const workerBefore = buildWorkerPayload(source);
  buildStaticSite({ sourceRoot: source, outputRoot: before });
  fs.appendFileSync(path.join(source, "js", "fields.js"), "\n/* shared field propagation mutation */\n");
  const workerAfter = buildWorkerPayload(source);
  buildStaticSite({ sourceRoot: source, outputRoot: after });

  assert.notEqual(workerAfter, workerBefore, "the generated current Worker payload must include fields.js");
  assert.notEqual(
    findOne(before, /^app\.[0-9a-f]{16}\.js$/),
    findOne(after, /^app\.[0-9a-f]{16}\.js$/),
    "changing the shared validation boundary must rotate the generated app URL"
  );
  for (const endpoint of ["solver.worker.js", "solver.worker.v2.js"]) {
    assert.deepEqual(
      fs.readFileSync(path.join(before, "js", endpoint)),
      fs.readFileSync(path.join(after, "js", endpoint)),
      `${endpoint} must remain frozen when fields.js changes`
    );
  }
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
