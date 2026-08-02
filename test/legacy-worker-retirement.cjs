"use strict";

const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const { once } = require("events");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function assertRetiredWorker(workerPath) {
  const posted = [];
  const imported = [];
  const context = {
    importScripts(...scripts) { imported.push(...scripts); },
    self: { postMessage(message) { posted.push(message); } },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(workerPath, "utf8"), context, { filename: workerPath });

  assert.equal(typeof context.self.onmessage, "function");
  assert.throws(() => context.self.onmessage({
    data: { reqId: 1, state: { mode: "items" }, budget: 200, stab: {} },
  }), /refresh/i);
  assert.deepEqual(imported, [], "the retired endpoint must not fan out into dependency requests");
  assert.deepEqual(posted, [], "caught Worker errors would let legacy tabs retry indefinitely");
}

test("the retired original Worker URL raises an uncaught error without dependencies", () => {
  assertRetiredWorker(path.join(root, "js", "solver.worker.js"));
});

test("the frozen v2 compatibility Worker is functional and self-contained", () => {
  const source = fs.readFileSync(path.join(root, "compat", "solver.worker.v2.js"), "utf8");
  assert.match(source, /validateWorkerState/);
  assert.match(source, /const res = optimize\(\)/);
  assert.doesNotMatch(source, /importScripts\s*\(/);
});

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 5_000);
    child.stdout.on("data", chunk => {
      output += chunk;
      if (!output.includes("Serving Forge Planner")) return;
      clearTimeout(timeout);
      resolve();
    });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => {
      if (code === null || output.includes("Serving Forge Planner")) return;
      clearTimeout(timeout);
      reject(new Error(`server exited ${code}: ${output}`));
    });
  });
}

function head(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: pathname, method: "HEAD" }, response => {
      response.resume();
      resolve(response);
    });
    request.once("error", reject);
    request.end();
  });
}

test("the generated release gives hashed assets and both stable Worker endpoints immutable caching", async () => {
  const port = 43_000 + (process.pid % 10_000);
  const child = spawn(process.execPath, [path.join(root, "test", "serve-built.cjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);
    const response = await head(port, "/js/solver.worker.js");
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.match(String(response.headers["content-security-policy"] || ""), /worker-src 'self' blob:/);
    assert.equal(response.headers["x-content-type-options"], "nosniff");

    const v2Response = await head(port, "/js/solver.worker.v2.js");
    assert.equal(v2Response.statusCode, 200);
    assert.equal(v2Response.headers["cache-control"], "public, max-age=31536000, immutable");

    const indexResponse = await head(port, "/");
    assert.equal(indexResponse.statusCode, 200);
    assert.equal(indexResponse.headers["cache-control"], "public, max-age=0, must-revalidate");
    assert.doesNotMatch(indexResponse.headers["cache-control"], /immutable/);

    const html = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
    const appMatch = html.match(/src="(\/static\/app\.[0-9a-f]{16}\.js)"/);
    assert.ok(appMatch, "the built page must identify its hashed app bundle");
    const appResponse = await head(port, appMatch[1]);
    assert.equal(appResponse.statusCode, 200);
    assert.equal(appResponse.headers["cache-control"], "public, max-age=31536000, immutable");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  }
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
  else console.log(`${tests.length} legacy Worker retirement tests passed`);
})();
