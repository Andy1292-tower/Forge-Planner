"use strict";

/* The new-build notice spends a reader's bandwidth and the host's request budget on every
 * check, so both halves of it are pinned here: the build must stamp a release id the page
 * and version.json agree on, and the page must ask about it as rarely as the design claims —
 * never on load, never while hidden, never twice at once, and never again once answered. */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const { buildStaticSite } = require("../scripts/build-static.cjs");
const UPDATE_SOURCE = fs.readFileSync(path.join(root, "js", "update-check.js"), "utf8");
const MINUTE = 60 * 1000;
const STAMP = "a1b2c3d4e5f60718";
const OTHER_STAMP = "0f1e2d3c4b5a6978";

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// The module fires its checks from a timer callback that cannot return a promise, so the
// harness steps to the next macrotask instead; every microtask queued behind it drains first.
function settleMicrotasks() {
  return new Promise(resolve => setImmediate(resolve));
}

function fakeButton() {
  return {
    handlers: [],
    addEventListener(_type, handler) { this.handlers.push(handler); },
    click() { for (const handler of this.handlers) handler(); },
  };
}

function fakeResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

/* A page whose clock, timers, visibility, and network are all under the test's control, so
 * "issues no request" and "waits 30 minutes" are assertions rather than guesses. */
function pageHarness(options = {}) {
  const stamp = options.stamp === undefined ? STAMP : options.stamp;
  const answers = options.answers || [];
  const requests = [];
  const timers = new Map();
  const listeners = new Map();
  const bar = { hidden: true };
  const buttons = { updateReload: fakeButton(), updateDismiss: fakeButton() };
  const counts = { reloads: 0, flushes: 0 };
  let nextTimer = 1;
  let now = 1_000_000;
  let visibility = options.visibility || "visible";

  const context = {
    console,
    JSON,
    Math,
    Date: { now() { return now; } },
    location: { reload() { counts.reloads += 1; } },
    flushPersist() { counts.flushes += 1; return true; },
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url, init) {
      requests.push({ url, init });
      const answer = answers[Math.min(requests.length - 1, answers.length - 1)];
      if (answer === undefined) throw new Error("the harness was given no answer for this request");
      if (answer instanceof Error) throw answer;
      return answer;
    },
    document: {
      querySelector(selector) {
        if (selector !== 'meta[name="forge-build"]' || stamp === null) return null;
        return { getAttribute: () => stamp };
      },
      getElementById(id) { return id === "updateBar" ? bar : (buttons[id] || null); },
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
      },
      get visibilityState() { return visibility; },
    },
  };

  vm.createContext(context);
  vm.runInContext(UPDATE_SOURCE, context, { filename: "js/update-check.js" });

  function armed() {
    assert.ok(timers.size <= 1, `expected at most one armed timer, found ${timers.size}`);
    const entry = [...timers.values()][0];
    return entry ? entry.delay : null;
  }

  return {
    requests,
    bar,
    buttons,
    counts,
    armed,
    state() { return vm.runInContext("updateState", context); },
    advance(ms) { now += ms; },
    setVisibility(next) {
      visibility = next;
      for (const handler of listeners.get("visibilitychange") || []) handler();
    },
    settle: settleMicrotasks,
    // Fires the armed timer and resolves once the check it starts has settled.
    async fire() {
      const entry = [...timers.entries()][0];
      assert.ok(entry, "expected an armed timer to fire");
      timers.delete(entry[0]);
      entry[1].callback();
      await settleMicrotasks();
    },
  };
}

function copyBuildInputs(sourceRoot) {
  fs.mkdirSync(sourceRoot, { recursive: true });
  for (const entry of ["assets", "compat", "css", "js"]) {
    fs.cpSync(path.join(root, entry), path.join(sourceRoot, entry), { recursive: true });
  }
  fs.copyFileSync(path.join(root, "index.html"), path.join(sourceRoot, "index.html"));
}

function releaseFacts(releaseRoot) {
  const index = fs.readFileSync(path.join(releaseRoot, "index.html"), "utf8");
  const stamp = index.match(/<meta name="forge-build" content="([^"]*)">/);
  assert.ok(stamp, "the generated page carries no forge-build stamp");
  return {
    stamp: stamp[1],
    version: JSON.parse(fs.readFileSync(path.join(releaseRoot, "version.json"), "utf8")),
    app: fs.readdirSync(path.join(releaseRoot, "static")).find(name => /^app\.[0-9a-f]{16}\.js$/.test(name)),
    styles: fs.readdirSync(path.join(releaseRoot, "static")).find(name => /^styles\.[0-9a-f]{16}\.css$/.test(name)),
  };
}

function buildPair(mutate) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "forge-update-check-"));
  const source = path.join(temporary, "source");
  const before = path.join(temporary, "before");
  const after = path.join(temporary, "after");
  copyBuildInputs(source);
  buildStaticSite({ sourceRoot: source, outputRoot: before });
  mutate(source);
  buildStaticSite({ sourceRoot: source, outputRoot: after });
  try {
    return { before: releaseFacts(before), after: releaseFacts(after) };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

test("a freshly loaded tab costs no request, because the page already names its build", () => {
  const page = pageHarness();
  assert.deepEqual(page.requests, []);
  assert.equal(page.armed(), 30 * MINUTE, "the first check must wait a full interval");
  assert.equal(page.state().stamp, STAMP);
  assert.equal(page.bar.hidden, true);
});

test("a hidden tab holds no timer and wakes to one when it comes back", () => {
  const page = pageHarness({ visibility: "hidden" });
  assert.equal(page.armed(), null, "a hidden tab must not hold a pending check");
  assert.deepEqual(page.requests, []);

  page.setVisibility("visible");
  assert.equal(page.armed(), 30 * MINUTE);

  page.setVisibility("hidden");
  assert.equal(page.armed(), null, "hiding the tab must drop the pending check");
});

test("a tab hidden past its interval checks the moment it is looked at again", () => {
  const page = pageHarness({ visibility: "hidden", answers: [fakeResponse(200, { build: STAMP })] });
  page.advance(8 * 60 * MINUTE);
  page.setVisibility("visible");
  assert.equal(page.armed(), 0, "an overdue check must not wait another interval");
  assert.deepEqual(page.requests, []);
});

test("a matching deployment revalidates one small file and asks again an interval later", async () => {
  const page = pageHarness({ answers: [fakeResponse(200, { build: STAMP })] });
  await page.fire();

  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, "version.json", "the URL must stay document-relative for the subpath mount");
  assert.equal(page.requests[0].init.cache, "no-cache", "the check must revalidate so the CDN can answer 304");
  assert.equal(page.requests[0].init.credentials, "omit");
  assert.equal(page.bar.hidden, true);
  assert.equal(page.armed(), 30 * MINUTE);
  assert.equal(page.state().stopped, false);
});

test("a newer deployment shows the notice once and then stops spending requests", async () => {
  const page = pageHarness({ answers: [fakeResponse(200, { build: OTHER_STAMP })] });
  await page.fire();

  assert.equal(page.bar.hidden, false, "a newer build must surface the notice");
  assert.equal(page.state().found, true);
  assert.equal(page.armed(), null, "a settled answer must not keep polling");

  page.setVisibility("hidden");
  page.setVisibility("visible");
  assert.equal(page.armed(), null, "returning to a notified tab must not restart the poll");
  assert.equal(page.requests.length, 1);
});

test("a host that serves no version.json is answered once and never asked again", async () => {
  const page = pageHarness({ answers: [fakeResponse(404, null)] });
  await page.fire();

  assert.equal(page.requests.length, 1);
  assert.equal(page.state().stopped, true, "a 404 is a permanent answer, not a blip");
  assert.equal(page.armed(), null);
  assert.equal(page.bar.hidden, true, "a missing version file must never be read as an update");

  page.setVisibility("hidden");
  page.setVisibility("visible");
  assert.equal(page.requests.length, 1);
});

test("consecutive failures back off and recover without ever giving up", async () => {
  const offline = new Error("network unreachable");
  const page = pageHarness({ answers: [offline, offline, offline, offline, fakeResponse(200, { build: STAMP })] });

  for (const expected of [5 * MINUTE, 15 * MINUTE, 60 * MINUTE, 60 * MINUTE]) {
    await page.fire();
    assert.equal(page.armed(), expected, "a failed check must back off instead of retrying on the normal cadence");
    assert.equal(page.state().stopped, false, "an offline reader must keep the check alive");
  }

  await page.fire();
  assert.equal(page.state().failures, 0, "a recovered check must forget the earlier failures");
  assert.equal(page.armed(), 30 * MINUTE);
});

test("a check already in flight cannot be doubled by tab switching", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  // The fake fetch awaits its answer, so a pending promise holds the request open.
  const page = pageHarness({ answers: [gate] });
  await page.fire();

  page.setVisibility("hidden");
  page.setVisibility("visible");
  page.setVisibility("visible");
  assert.equal(page.armed(), null, "an in-flight check must not arm a second one");
  assert.equal(page.requests.length, 1);

  release(fakeResponse(200, { build: STAMP }));
  await page.settle();
  assert.equal(page.requests.length, 1, "only the settled check may have reached the network");
  assert.equal(page.armed(), 30 * MINUTE);
});

test("Refresh now flushes the pending save before reloading, and Later just hides the notice", async () => {
  const page = pageHarness({ answers: [fakeResponse(200, { build: OTHER_STAMP })] });
  await page.fire();
  assert.equal(page.bar.hidden, false);

  page.buttons.updateDismiss.click();
  assert.equal(page.bar.hidden, true);
  assert.equal(page.counts.reloads, 0, "dismissing must never reload over a reader's work");

  page.buttons.updateReload.click();
  assert.equal(page.counts.flushes, 1, "the newest edit may still be sitting in the persist debounce");
  assert.equal(page.counts.reloads, 1);
});

test("an unstamped source tree never checks", () => {
  for (const stamp of ["__FORGE_BUILD_ID__", "", null, "not-a-build-id"]) {
    const page = pageHarness({ stamp });
    assert.equal(page.armed(), null, `stamp ${JSON.stringify(stamp)} must leave the check inert`);
    assert.deepEqual(page.requests, []);
    page.setVisibility("hidden");
    page.setVisibility("visible");
    assert.deepEqual(page.requests, [], "an inert check must not subscribe to visibility either");
  }
});

test("the release stamps the page and version.json with the same id, reproducibly", () => {
  const { before, after } = buildPair(() => {});
  assert.match(before.stamp, /^[0-9a-f]{16}$/);
  assert.equal(before.version.build, before.stamp, "an open tab compares these two directly");
  assert.equal(after.stamp, before.stamp, "an unchanged tree must not tell readers to reload");
});

test("a stylesheet-only release moves the build id without re-downloading the app bundle", () => {
  const { before, after } = buildPair(source => {
    fs.appendFileSync(path.join(source, "css", "styles.css"), "\n/* update notice styling mutation */\n");
  });
  assert.notEqual(after.stamp, before.stamp, "a visible change readers should reload for must move the id");
  assert.equal(after.version.build, after.stamp);
  assert.notEqual(after.styles, before.styles);
  assert.equal(after.app, before.app, "stamping the page rather than the bundle keeps the app URL cached");
});

test("a script-only release moves the build id", () => {
  const { before, after } = buildPair(source => {
    fs.appendFileSync(path.join(source, "js", "render.js"), "\n/* render mutation */\n");
  });
  assert.notEqual(after.app, before.app);
  assert.notEqual(after.stamp, before.stamp);
  assert.equal(after.version.build, after.stamp);
});

test("version.json is served must-revalidate, so each check is a 304 rather than a download", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const route = (config.headers || []).find(entry => entry.source === "/version.json");
  assert.ok(route, "vercel.json must give version.json a cache policy of its own");
  const cacheControl = route.headers.find(header => header.key === "Cache-Control");
  assert.equal(cacheControl.value, "public, max-age=0, must-revalidate");
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
  else console.log(`${tests.length} update notice tests passed`);
})();
