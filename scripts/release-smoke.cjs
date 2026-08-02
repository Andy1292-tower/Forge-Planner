"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { buildStaticSite } = require("./build-static.cjs");

process.env.PORT = "0";
const { createStaticServer } = require("../test/serve-vercel-config.cjs");

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function write(root, relative, contents) {
  const target = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function copyBuildInputs(sourceRoot) {
  fs.mkdirSync(sourceRoot, { recursive: true });
  const projectRoot = path.resolve(__dirname, "..");
  for (const entry of ["assets", "compat", "css", "js"]) {
    fs.cpSync(path.join(projectRoot, entry), path.join(sourceRoot, entry), { recursive: true });
  }
  fs.copyFileSync(path.join(projectRoot, "index.html"), path.join(sourceRoot, "index.html"));
}

function findStatic(releaseRoot, pattern) {
  const matches = fs.readdirSync(path.join(releaseRoot, "static")).filter(name => pattern.test(name));
  assert.equal(matches.length, 1, `expected one ${pattern}, got ${matches.join(", ")}`);
  return `/static/${matches[0]}`;
}

function request(origin, pathname, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(pathname, origin), { method, headers }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.once("error", reject);
    req.end();
  });
}

function waitForAnnouncement(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`serve-built did not announce an origin: ${output}`)), 5_000);
    const finish = (fn, value) => {
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      child.stderr.off("data", onErrorData);
      fn(value);
    };
    const onData = chunk => {
      output += chunk;
      const match = output.match(/Serving Forge Planner .* at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) finish(resolve, match[1]);
    };
    const onErrorData = chunk => { output += chunk; };
    child.stdout.on("data", onData);
    child.stderr.on("data", onErrorData);
    child.once("error", error => finish(reject, error));
    child.once("exit", code => {
      if (!/Serving Forge Planner/.test(output)) finish(reject, new Error(`serve-built exited ${code}: ${output}`));
    });
  });
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code));
    child.kill("SIGTERM");
  });
}

test("root and subpath mounts serve one logical release with root cache headers", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-smoke-"));
  write(temporary, "index.html", "release A");
  const controller = createStaticServer({ staticRoot: temporary, host: "127.0.0.1", port: 0 });

  try {
    const { origin } = await controller.start();
    const root = await request(origin, "/");
    const subpath = await request(origin, "/Forge-Planner/");
    assert.equal(root.status, 200);
    assert.equal(subpath.status, 200);
    assert.equal(root.body.toString("utf8"), "release A");
    assert.equal(subpath.body.toString("utf8"), "release A");
    assert.equal(root.headers["cache-control"], "public, max-age=0, must-revalidate");
    assert.equal(subpath.headers["cache-control"], root.headers["cache-control"]);
  } finally {
    await controller.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("the bare subpath redirects before the root mount can serve it", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-redirect-"));
  write(temporary, "index.html", "release A");
  write(temporary, "Forge-Planner/index.html", "root-mount decoy");
  const controller = createStaticServer({ staticRoot: temporary, host: "127.0.0.1", port: 0 });

  try {
    const { origin } = await controller.start();
    const response = await request(origin, "/Forge-Planner");
    assert.equal(response.status, 308);
    assert.equal(response.headers.location, "/Forge-Planner/");
    assert.equal(response.body.length, 0);
  } finally {
    await controller.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("static routes reject methods other than GET and HEAD", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-method-"));
  write(temporary, "index.html", "release A");
  const controller = createStaticServer({ staticRoot: temporary, host: "127.0.0.1", port: 0 });

  try {
    const { origin } = await controller.start();
    const response = await request(origin, "/", { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.allow, "GET, HEAD");
    assert.equal(response.body.length, 0);
  } finally {
    await controller.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("decoded traversal and symlinks cannot escape the active release root", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-containment-"));
  const release = path.join(temporary, "release");
  write(release, "index.html", "release A");
  write(temporary, "secret.txt", "outside secret");
  fs.mkdirSync(path.join(release, "static"), { recursive: true });
  fs.symlinkSync(path.join(temporary, "secret.txt"), path.join(release, "static", "escape.txt"));
  const controller = createStaticServer({ staticRoot: release, host: "127.0.0.1", port: 0 });

  try {
    const { origin } = await controller.start();
    const traversal = await request(origin, "/Forge-Planner/%2e%2e%2fsecret.txt");
    const symlink = await request(origin, "/static/escape.txt");
    assert.equal(traversal.status, 403);
    assert.equal(symlink.status, 403);
    assert.equal(traversal.body.toString("utf8"), "Forbidden");
    assert.equal(symlink.body.toString("utf8"), "Forbidden");
  } finally {
    await controller.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("GET and HEAD expose identical byte validators and length while HEAD is bodyless", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-head-"));
  write(temporary, "index.html", "release A");
  fs.utimesSync(path.join(temporary, "index.html"), new Date("2026-08-02T12:34:56Z"), new Date("2026-08-02T12:34:56Z"));
  const controller = createStaticServer({ staticRoot: temporary, host: "127.0.0.1", port: 0 });

  try {
    const { origin } = await controller.start();
    const get = await request(origin, "/");
    const head = await request(origin, "/", { method: "HEAD" });
    assert.equal(get.status, 200);
    assert.equal(head.status, 200);
    assert.equal(get.headers.etag, '"8a787ad4dfef4d94cd19f351bf9a112cd73b457f5ebbd440c486cd04a5a84f5e"');
    assert.equal(head.headers.etag, get.headers.etag);
    assert.equal(get.headers["last-modified"], "Sun, 02 Aug 2026 12:34:56 GMT");
    assert.equal(head.headers["last-modified"], get.headers["last-modified"]);
    assert.equal(get.headers["content-length"], "9");
    assert.equal(head.headers["content-length"], "9");
    assert.equal(get.body.toString("utf8"), "release A");
    assert.equal(head.body.length, 0);
  } finally {
    await controller.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("If-None-Match accepts weak, comma-list, and wildcard matches for GET and HEAD", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-etag-"));
  write(temporary, "index.html", "release A");
  fs.utimesSync(path.join(temporary, "index.html"), new Date("2026-08-02T12:34:56Z"), new Date("2026-08-02T12:34:56Z"));
  const controller = createStaticServer({ staticRoot: temporary, host: "127.0.0.1", port: 0 });

  try {
    const { origin } = await controller.start();
    const current = await request(origin, "/");
    const weakList = await request(origin, "/", {
      headers: { "If-None-Match": `"unrelated", W/${current.headers.etag}` },
    });
    const head = await request(origin, "/", {
      method: "HEAD",
      headers: { "If-None-Match": current.headers.etag },
    });
    const wildcard = await request(origin, "/", { headers: { "If-None-Match": "*" } });

    for (const response of [weakList, head, wildcard]) {
      assert.equal(response.status, 304);
      assert.equal(response.body.length, 0);
      assert.equal(response.headers.etag, current.headers.etag);
      assert.equal(response.headers["last-modified"], current.headers["last-modified"]);
      assert.equal(response.headers["cache-control"], "public, max-age=0, must-revalidate");
      assert.equal(response.headers["content-length"], undefined);
    }
  } finally {
    await controller.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("If-None-Match takes precedence over If-Modified-Since for GET and HEAD", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-modified-"));
  write(temporary, "index.html", "release A");
  fs.utimesSync(path.join(temporary, "index.html"), new Date("2026-08-02T12:34:56Z"), new Date("2026-08-02T12:34:56Z"));
  const controller = createStaticServer({ staticRoot: temporary, host: "127.0.0.1", port: 0 });

  try {
    const { origin } = await controller.start();
    const unchanged = await request(origin, "/", {
      headers: { "If-Modified-Since": "Sun, 02 Aug 2026 12:34:56 GMT" },
    });
    const unchangedHead = await request(origin, "/", {
      method: "HEAD",
      headers: { "If-Modified-Since": "Mon, 03 Aug 2026 12:34:56 GMT" },
    });
    const older = await request(origin, "/", {
      headers: { "If-Modified-Since": "Sat, 01 Aug 2026 12:34:56 GMT" },
    });
    const etagPrecedence = await request(origin, "/", {
      headers: {
        "If-None-Match": '"a-different-release"',
        "If-Modified-Since": "Mon, 03 Aug 2026 12:34:56 GMT",
      },
    });

    assert.equal(unchanged.status, 304);
    assert.equal(unchangedHead.status, 304);
    assert.equal(unchanged.body.length, 0);
    assert.equal(unchangedHead.body.length, 0);
    assert.equal(older.status, 200);
    assert.equal(older.body.toString("utf8"), "release A");
    assert.equal(etagPrecedence.status, 200);
    assert.equal(etagPrecedence.body.toString("utf8"), "release A");
  } finally {
    await controller.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("one origin swaps incompatible releases without reusing stale HTML or changing immutable assets", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-swap-"));
  const sourceA = path.join(temporary, "source-a");
  const sourceB = path.join(temporary, "source-b");
  const releaseA = path.join(temporary, "release-a");
  const releaseB = path.join(temporary, "release-b");
  copyBuildInputs(sourceA);
  copyBuildInputs(sourceB);
  fs.appendFileSync(path.join(sourceA, "js", "core.js"), '\n;globalThis.__FORGE_RELEASE_MARKER__="release-A";\n');
  fs.appendFileSync(path.join(sourceB, "js", "core.js"), '\n;globalThis.__FORGE_RELEASE_MARKER__="release-B-incompatible";\n');
  buildStaticSite({ sourceRoot: sourceA, outputRoot: releaseA });
  buildStaticSite({ sourceRoot: sourceB, outputRoot: releaseB });

  const appA = findStatic(releaseA, /^app\.[0-9a-f]{16}\.js$/);
  const appB = findStatic(releaseB, /^app\.[0-9a-f]{16}\.js$/);
  const stylesA = findStatic(releaseA, /^styles\.[0-9a-f]{16}\.css$/);
  const stylesB = findStatic(releaseB, /^styles\.[0-9a-f]{16}\.css$/);
  assert.notEqual(appA, appB);
  assert.equal(stylesA, stylesB);

  const fenceA = fs.readFileSync(path.join(releaseA, "js", "solver.worker.js"));
  const fenceB = fs.readFileSync(path.join(releaseB, "js", "solver.worker.js"));
  const v2A = fs.readFileSync(path.join(releaseA, "js", "solver.worker.v2.js"));
  const v2B = fs.readFileSync(path.join(releaseB, "js", "solver.worker.v2.js"));
  assert.deepEqual(fenceB, fenceA);
  assert.deepEqual(v2B, v2A);
  assert.equal(sha256(fenceA), "4608f23266bc227cfa5b79afb37bbcbebd8bc5a121ddfc68447c68e01cca1188");
  assert.equal(sha256(v2A), "9d8747eea5a5c0c8d88066532eb9c3f51da6ebeb14e803284734405f3bcd1cf2");

  const scope = "release-swap-test";
  const cookie = { Cookie: `forge-test-session=${scope}` };
  const controller = createStaticServer({
    staticRoot: releaseA,
    host: "127.0.0.1",
    port: 0,
    enableRequestMetrics: true,
  });

  try {
    const { origin } = await controller.start();
    const htmlA = await request(origin, "/Forge-Planner/", { headers: cookie });
    const stableA = await request(origin, `/Forge-Planner${stylesA}`, { headers: cookie });
    const workerA = await request(origin, "/js/solver.worker.v2.js", { headers: cookie });
    const workerSubpathA = await request(origin, "/Forge-Planner/js/solver.worker.js", { headers: cookie });
    assert.equal(htmlA.status, 200);
    assert.match(htmlA.body.toString("utf8"), new RegExp(appA.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(htmlA.headers["cache-control"], "public, max-age=0, must-revalidate");
    assert.equal(stableA.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.equal(workerA.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.equal(workerSubpathA.headers["cache-control"], "public, max-age=31536000, immutable");

    const swapped = controller.setStaticRoot(releaseB);
    assert.equal(swapped.previousRoot, fs.realpathSync(releaseA));
    assert.equal(swapped.staticRoot, fs.realpathSync(releaseB));

    const htmlB = await request(origin, "/Forge-Planner/", {
      headers: {
        ...cookie,
        "If-None-Match": htmlA.headers.etag,
        "If-Modified-Since": htmlA.headers["last-modified"],
      },
    });
    assert.equal(htmlB.status, 200);
    assert.notEqual(htmlB.headers.etag, htmlA.headers.etag);
    assert.match(htmlB.body.toString("utf8"), new RegExp(appB.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(htmlB.body.toString("utf8"), new RegExp(appA.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const htmlBNotModified = await request(origin, "/Forge-Planner/", {
      headers: { ...cookie, "If-None-Match": htmlB.headers.etag },
    });
    const stableBNotModified = await request(origin, `/Forge-Planner${stylesA}`, {
      headers: { ...cookie, "If-None-Match": stableA.headers.etag },
    });
    const workerBNotModified = await request(origin, "/js/solver.worker.v2.js", {
      headers: { ...cookie, "If-None-Match": workerA.headers.etag },
    });
    assert.equal(htmlBNotModified.status, 304);
    assert.equal(stableBNotModified.status, 304);
    assert.equal(workerBNotModified.status, 304);

    const metrics = controller.requestMetrics(scope);
    assert.equal(metrics.counts["/Forge-Planner/"], 3);
    assert.equal(metrics.counts[`/Forge-Planner${stylesA}`], 2);
    assert.equal(metrics.counts["/js/solver.worker.v2.js"], 2);
    assert.ok(metrics.log.some(entry => entry.pathname === "/Forge-Planner/"
      && entry.logicalPathname === "/" && entry.mountPath === "/Forge-Planner" && entry.status === 200));
    assert.ok(metrics.log.some(entry => entry.pathname === "/Forge-Planner/"
      && entry.logicalPathname === "/" && entry.status === 304));
  } finally {
    await controller.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("metrics endpoints expose scoped actual paths and statuses without recording themselves", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-release-metrics-"));
  write(temporary, "index.html", "release A");
  const scope = "isolated-metrics";
  const headers = { Cookie: `forge-test-session=${scope}` };
  const controller = createStaticServer({
    staticRoot: temporary,
    host: "127.0.0.1",
    port: 0,
    enableRequestMetrics: true,
  });

  try {
    const { origin } = await controller.start();
    await request(origin, "/Forge-Planner/", { headers });
    const countsResponse = await request(origin, "/__test/request-counts", { headers });
    const logResponse = await request(origin, "/__test/request-log", { headers });
    assert.equal(countsResponse.status, 200);
    assert.equal(logResponse.status, 200);
    assert.deepEqual(JSON.parse(countsResponse.body.toString("utf8")), { "/Forge-Planner/": 1 });
    assert.deepEqual(JSON.parse(logResponse.body.toString("utf8")), [{
      sequence: 1,
      method: "GET",
      pathname: "/Forge-Planner/",
      logicalPathname: "/",
      mountPath: "/Forge-Planner",
      status: 200,
    }]);
  } finally {
    await controller.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("serve-built starts the reusable server and closes cleanly on SIGTERM", async () => {
  const projectRoot = path.resolve(__dirname, "..");
  const child = spawn(process.execPath, [path.join(projectRoot, "test", "serve-built.cjs")], {
    cwd: projectRoot,
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    const origin = await waitForAnnouncement(child);
    const response = await request(origin, "/Forge-Planner/");
    assert.equal(response.status, 200);
    assert.match(response.headers.etag, /^"[0-9a-f]{64}"$/);
  } finally {
    const code = await stopChild(child);
    assert.equal(code, 0);
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
  else console.log(`${tests.length} release smoke test(s) passed`);
})();
