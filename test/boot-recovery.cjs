"use strict";

/* The recovery script is the one thing standing between a reader and a page that paints but
 * cannot run, so what it costs everyone else is pinned here as tightly as what it fixes: a
 * healthy load must issue no request at all, and a reload must happen only when the host is
 * demonstrably serving a different release than the one this page was cut from. */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const BOOT_SOURCE = fs.readFileSync(path.join(root, "js", "boot.js"), "utf8");
const STAMP = "a1b2c3d4e5f60718";
const OTHER_STAMP = "0f1e2d3c4b5a6978";
const PLACEHOLDER = "__FORGE_BUILD_ID__";

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// The recovery runs off a promise chain a resource error cannot await, so the harness steps
// to the next macrotask and lets every microtask queued behind it drain first.
function settle() {
  return new Promise(resolve => setImmediate(resolve));
}

function fakeResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

/* A page whose stamp, storage, network, and reloads are all under the test's control, so
 * "issues no request" and "reloads once" are assertions rather than guesses. */
function pageHarness(options = {}) {
  const stamp = options.stamp === undefined ? STAMP : options.stamp;
  const answers = options.answers || [];
  const requests = [];
  const capture = [];
  const counts = { reloads: 0 };
  const store = new Map();

  const storage = options.storageThrows
    ? { getItem() { throw new Error("storage is unavailable"); }, setItem() { throw new Error("storage is unavailable"); } }
    : {
        getItem(key) { return store.has(key) ? store.get(key) : null; },
        setItem(key, value) { store.set(key, String(value)); },
      };

  const context = {
    console,
    JSON,
    location: { reload() { counts.reloads += 1; } },
    sessionStorage: storage,
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
    },
  };
  context.window = {
    addEventListener(type, handler, useCapture) {
      capture.push({ type, handler, useCapture });
    },
  };

  vm.createContext(context);
  vm.runInContext(BOOT_SOURCE, context, { filename: "js/boot.js" });

  return {
    requests,
    counts,
    listeners: capture,
    // Fires a resource failure the way the browser does: on the capture phase, at the element.
    async fail(tagName) {
      const entry = capture.find(item => item.type === "error");
      assert.ok(entry, "expected an error listener to be registered");
      entry.handler({ target: tagName === null ? context.window : { tagName } });
      await settle();
    },
  };
}

test("a page whose assets all arrive listens once and asks the host nothing", async () => {
  const page = pageHarness();
  assert.equal(page.requests.length, 0);
  assert.equal(page.counts.reloads, 0);
  const errorListeners = page.listeners.filter(item => item.type === "error");
  assert.equal(errorListeners.length, 1, "the page should carry exactly one recovery listener");
  assert.equal(errorListeners[0].useCapture, true, "resource failures only surface on the capture phase");
});

test("a bundle that is gone from a newer release reloads the page onto it", async () => {
  const page = pageHarness({ answers: [fakeResponse(200, { build: OTHER_STAMP })] });
  await page.fail("SCRIPT");
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, "version.json");
  assert.equal(page.requests[0].init.cache, "no-cache");
  assert.equal(page.counts.reloads, 1);
});

test("a stylesheet that is gone recovers on the same terms as the bundle", async () => {
  const page = pageHarness({ answers: [fakeResponse(200, { build: OTHER_STAMP })] });
  await page.fail("LINK");
  assert.equal(page.counts.reloads, 1);
});

test("a missing asset on the release the host is serving is left alone, not looped", async () => {
  const page = pageHarness({ answers: [fakeResponse(200, { build: STAMP })] });
  await page.fail("SCRIPT");
  assert.equal(page.requests.length, 1, "the host is still worth one question");
  assert.equal(page.counts.reloads, 0, "a reload would fetch the same dead page again");
});

test("one dead release is escaped once per tab, however many assets fail", async () => {
  const page = pageHarness({ answers: [fakeResponse(200, { build: OTHER_STAMP })] });
  await page.fail("SCRIPT");
  await page.fail("LINK");
  await page.fail("SCRIPT");
  assert.equal(page.counts.reloads, 1);
  assert.equal(page.requests.length, 1, "the answer to the first question settles the rest");
});

test("a page that goes stale again later can still recover", async () => {
  const first = pageHarness({ answers: [fakeResponse(200, { build: OTHER_STAMP })] });
  await first.fail("SCRIPT");
  assert.equal(first.counts.reloads, 1);

  // Same tab, same storage contents, but the reload landed on a different release.
  const second = pageHarness({ stamp: OTHER_STAMP, answers: [fakeResponse(200, { build: STAMP })] });
  await second.fail("SCRIPT");
  assert.equal(second.counts.reloads, 1, "the guard is keyed to the stamp being escaped");
});

test("an image that fails leaves a working page unspent", async () => {
  const page = pageHarness({ answers: [fakeResponse(200, { build: OTHER_STAMP })] });
  await page.fail("IMG");
  assert.equal(page.requests.length, 0);
  assert.equal(page.counts.reloads, 0);
});

test("a scripting error is not a resource failure and buys nothing", async () => {
  const page = pageHarness({ answers: [fakeResponse(200, { build: OTHER_STAMP })] });
  await page.fail(null);
  assert.equal(page.requests.length, 0);
  assert.equal(page.counts.reloads, 0);
});

test("an unbuilt source tree never listens and never asks", async () => {
  const page = pageHarness({ stamp: PLACEHOLDER });
  assert.equal(page.listeners.length, 0);
  assert.equal(page.requests.length, 0);
});

test("a page with no stamp at all stays inert", async () => {
  const page = pageHarness({ stamp: null });
  assert.equal(page.listeners.length, 0);
  assert.equal(page.requests.length, 0);
});

test("a host with no version.json to serve is answered once and never reloaded", async () => {
  const page = pageHarness({ answers: [fakeResponse(404, null)] });
  await page.fail("SCRIPT");
  assert.equal(page.requests.length, 1);
  assert.equal(page.counts.reloads, 0);
});

test("an unreadable release id is not a reason to reload", async () => {
  const page = pageHarness({ answers: [fakeResponse(200, { build: "not-a-release-id" })] });
  await page.fail("SCRIPT");
  assert.equal(page.counts.reloads, 0);
});

test("a network that fails the check throws nothing at the page", async () => {
  const page = pageHarness({ answers: [new Error("offline")] });
  await page.fail("SCRIPT");
  assert.equal(page.counts.reloads, 0);
});

test("storage the reader has switched off costs the guard, not the recovery", async () => {
  const page = pageHarness({ storageThrows: true, answers: [fakeResponse(200, { build: OTHER_STAMP })] });
  await page.fail("SCRIPT");
  assert.equal(page.counts.reloads, 1);
});

async function main() {
  for (const entry of tests) {
    await entry.fn();
    process.stdout.write(`PASS ${entry.name}\n`);
  }
  process.stdout.write(`${tests.length} boot recovery tests passed\n`);
}

main().catch(error => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
});
