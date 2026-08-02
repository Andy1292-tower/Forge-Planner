"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const { buildStaticSite } = require("../scripts/build-static.cjs");

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
  assert.match(app, /URL\.createObjectURL\(new Blob/);
  assert.match(app, /__forgeCreateSolverWorker\(\)/);
  assert.doesNotMatch(app, /new Worker\(["'][^"']+\.js/);
  assert.doesNotMatch(app, /importScripts\s*\(/);
  assert.doesNotMatch(app, /(?:js\/solver\.worker|\/assets\/speed\.jpg)/);

  const speedName = findOne(temporary, /^speed\.[0-9a-f]{16}\.jpg$/);
  assert.match(app, new RegExp(`/static/${speedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  assertLegacyFence(path.join(temporary, "js", "solver.worker.js"));
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
