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

test("the retired Worker URL raises an uncaught error for a legacy solve request", () => {
  const posted = [];
  const imported = [];
  const context = {
    importScripts(...scripts) { imported.push(...scripts); },
    self: { postMessage(message) { posted.push(message); } },
  };
  vm.createContext(context);
  const workerPath = path.join(root, "js", "solver.worker.js");
  vm.runInContext(fs.readFileSync(workerPath, "utf8"), context, { filename: workerPath });

  assert.equal(typeof context.self.onmessage, "function");
  assert.throws(() => context.self.onmessage({
    data: { reqId: 1, state: { mode: "items" }, budget: 200, stab: {} },
  }), /refresh/i);
  assert.deepEqual(imported, [], "the retired endpoint must not fan out into dependency requests");
  assert.deepEqual(posted, [], "caught Worker errors would let legacy tabs retry indefinitely");
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

test("the retired Worker URL is cached permanently by the browser", async () => {
  const port = 43_000 + (process.pid % 10_000);
  const child = spawn(process.execPath, [path.join(root, "test", "serve-vercel-config.cjs")], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForServer(child);
    const response = await head(port, "/js/solver.worker.js");
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.match(String(response.headers["content-security-policy"] || ""), /worker-src 'self'/);
    assert.equal(response.headers["x-content-type-options"], "nosniff");

    const currentResponse = await head(port, "/js/solver.worker.v2.js");
    assert.equal(currentResponse.statusCode, 200);
    assert.equal(currentResponse.headers["cache-control"], "no-store",
      "the immutable retirement rule must not spill onto the current Worker");
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
