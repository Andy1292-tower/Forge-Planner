"use strict";
/* Fit in time (Node): which ticked levels optimizeFit finishes inside a time limit, how it treats
 * level chains, ledgers and unlock gates, the shard merge that picks the winner, and the Worker
 * protocol's "fit" task.
 *
 * The solves run on a frozen clock. Every set here is small enough for the exhaustive path, which
 * finishes on its own, so each answer is the best set there is and the assertions are exact.
 *
 * Usage: node test/fit-in-time.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SOURCES = ["js/decimal.js", "js/catalog.js", "js/ledgers.js", "js/core.js", "js/fields.js", "js/state.js",
  "js/project-schedule.js", "js/solver.js"];

function realm(extra) {
  const context = vm.createContext(Object.assign({
    console, performance: { now: () => 0 }, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => null },
  }, extra || {}));
  return context;
}
const page = realm();
for (const file of [...SOURCES, "js/solve-service.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), page, { filename: file });
}

const LINES = [
  { max: 4, spx: 5.0, turbo: 0 }, { max: 4, spx: 4.5, turbo: 0 }, { max: 4, spx: 4.0, turbo: 0 },
  { max: 2, spx: 3.5, turbo: 0 }, { max: 2, spx: 3.0, turbo: 0 }, { max: 2, spx: 2.5, turbo: 0 },
];
function P(id, name, levels, extra) {
  return Object.assign({ id, name, on: true, prio: null, from: 1, to: levels.length, done: 0,
    levels: levels.map(costs => ({ costs: costs.map(([item, qty]) => ({ item, qty })) })) }, extra || {});
}
function fit(projects, hours) {
  page.__setup = { lines: LINES, projects, hours };
  const out = vm.runInContext(`(function(){
    const s=defaults();s.dupe=0;s.margin=0;s.mode="project";
    s.lines=JSON.parse(JSON.stringify(globalThis.__setup.lines));
    s.projects=JSON.parse(JSON.stringify(globalThis.__setup.projects));
    s.fitHours=globalThis.__setup.hours;
    normalize(s);syncManual(s);S=s;
    return JSON.parse(JSON.stringify(optimizeFit({now:()=>0})));
  })()`, page);
  delete page.__setup;
  return out;
}
const row = (res, id) => res.selection.find(r => r.id === id);

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const A = P("a", "A", [[["Glass", 2000]]]);
const B = P("b", "B", [[["Plates", 2000]]]);
const C = P("c", "C", [[["Glass", 1000000]]]);

test("with time for everything, everything fits and the full plan check agrees", () => {
  const res = fit([A, B, C], 100000);
  assert.equal(res.count, 3);
  assert.equal(res.verified, true);
  assert.equal(res.exhaustive, true);
  assert.ok(res.eta > 0 && res.eta <= 100000);
  assert.ok(res.selection.every(r => r.taken === r.remaining && r.finish !== null));
});

test("a limit that holds two of three keeps the two and leaves the one that would run over", () => {
  const ab = fit([A, B], 100000);
  assert.equal(ab.count, 2);
  const hours = ab.eta * 1.001;
  const res = fit([A, B, C], hours);
  assert.equal(res.count, 2, JSON.stringify(res.selection));
  assert.deepEqual(res.selection.map(r => r.taken), [1, 1, 0]);
  assert.equal(res.verified, true);
  assert.ok(res.eta <= hours, `${res.eta} <= ${hours}`);
});

test("a limit nothing fits in reports nothing, checked", () => {
  const res = fit([C], 0.1);
  assert.equal(res.count, 0);
  assert.equal(res.verified, true);
  assert.equal(res.eta, 0);
  assert.equal(row(res, "c").taken, 0);
});

test("a project's levels are taken in order, and a partial fit names the level it reaches", () => {
  const level = [["Glass", 3000]];
  const two = fit([P("d", "D", [level, level])], 100000);
  const res = fit([P("d", "D", [level, level, level], { from: 1, to: 3 })], two.eta * 1.001);
  const d = row(res, "d");
  assert.equal(d.taken, 2);
  assert.equal(d.remaining, 3);
  assert.equal(d.fromLevel, 1);
  assert.equal(d.toLevel, 2);
});

test("levels already marked done are not offered again", () => {
  const level = [["Glass", 3000]];
  const res = fit([P("d", "D", [level, level, level], { done: 2 })], 100000);
  const d = row(res, "d");
  assert.equal(d.remaining, 1);
  assert.equal(d.fromLevel, 3);
  assert.equal(d.toLevel, 3);
});

test("a ledger counts once, and a ledger with nothing to craft is not offered", () => {
  const ledger = P("l1", "Tank", [[]], { ledgerId: "tank-timmerson", ledgerNo: 1 });        // Concrete 250
  const mined = P("l2", "Caylris", [[]], { ledgerId: "caylris-en-divalone", ledgerNo: 1 });  // Ardranite only
  const res = fit([ledger, mined], 100000);
  assert.deepEqual(res.selection.map(r => r.id), ["l1"]);
  assert.equal(row(res, "l1").ledger, true);
  assert.equal(res.count, 1);
});

test("a level using an unlocked material only counts once the in-list unlock is taken whole", () => {
  // The catalog supplies Frame Factory's own costs; it unlocks Frames.
  const factory = P("ff", "Frame Factory", [[]], { catId: "frame-factory" });
  const user = P("fr", "Frames user", [[["Frames", 30]]]);
  const alone = fit([user], 100000);
  const both = fit([factory, user], 100000);
  assert.equal(both.count, 2);
  assert.ok(alone.eta >= 0.1 && alone.eta * 2 < both.eta, `the factory dominates: ${alone.eta} vs ${both.eta}`);
  // Room for the Frames user on its own, not for the factory it waits on.
  const res = fit([factory, user], alone.eta * 1.001);
  assert.equal(row(res, "fr").taken, 0, JSON.stringify(res.selection));
  assert.equal(row(res, "ff").taken, 0);
  assert.equal(res.count, 0);
});

test("past the exhaustive size the search stops on its own and still checks its answer", () => {
  const chain = item => Array.from({ length: 6 }, (_, k) => [[item, 500 * (k + 1)]]);
  const projects = ["Glass", "Plates", "Bricks", "Rods"].map((item, i) => P("h" + i, item + " chain", chain(item)));
  const everything = fit(projects, 100000);
  const res = fit(projects, everything.eta * 0.4);
  assert.equal(res.exhaustive, false, "7^4 sets is past the exhaustive limit");
  assert.equal(res.verified, true);
  assert.ok(res.count > 0 && res.count < 24, String(res.count));
  assert.ok(res.eta <= everything.eta * 0.4);
  res.selection.forEach(r => assert.ok(r.taken >= 0 && r.taken <= r.remaining));
});

test("the shard merge keeps a checked answer, then the most finished, then the shortest", () => {
  const merge = entries => JSON.parse(JSON.stringify(vm.runInContext("mergeShardResults", page)(
    "project", entries.map((res, index) => ({ shard: { index, count: entries.length }, res })), "fit")));
  const base = { task: "fit", rank: 0, tried: 5, ms: 10 };
  const picked = merge([
    Object.assign({}, base, { count: 4, verified: false, eta: null, estimateEta: 1 }),
    Object.assign({}, base, { count: 3, verified: true, eta: 5 }),
    Object.assign({}, base, { count: 3, verified: true, eta: 4, ms: 30, deadlineReached: true }),
  ]);
  assert.equal(picked.count, 3);
  assert.equal(picked.eta, 4);
  assert.equal(picked.tried, 15, "combinations tried add up across shards");
  assert.equal(picked.shards, 3);
  assert.equal(picked.deadlineReached, true);
  assert.equal(picked.ms, 30);
});

test("the Worker runs the fit task on the fit search time and refuses anything else", () => {
  const posted = [];
  const worker = realm({ self: { postMessage: message => posted.push(JSON.parse(JSON.stringify(message))) } });
  worker.importScripts = (...files) => files.forEach(file =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", file), "utf8"), worker, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "solver.worker.v2.js"), "utf8"), worker);
  const state = JSON.parse(vm.runInContext(`(function(){const s=normalize(defaults());s.mode="project";
    s.schemaVersion=CURRENT_SCHEMA_VERSION;s.baseTimeRev=3;s.fitHours=100000;
    s.projects=[{id:"a",name:"A",on:true,prio:null,from:1,to:1,done:0,levels:[{costs:[{item:"Glass",qty:"200"}]}]}];
    return JSON.stringify(s);})()`, worker));
  const send = message => worker.self.onmessage({ data: Object.assign({ reqId: 1, generation: 1, mode: "project",
    stateRevision: 0, state }, message) });

  send({ budget: state.fitBudget, task: "fit" });
  assert.equal(posted[0].error, undefined, posted[0].error && posted[0].error.message);
  assert.equal(posted[0].res.task, "fit");
  assert.equal(posted[0].res.count, 1);

  send({ budget: state.solveBudget, task: "fit" });
  assert.match(posted[1].error.message, /budget does not match/);
  send({ budget: state.fitBudget, task: "plan" });
  assert.match(posted[2].error.message, /task is unknown/);
  send({ budget: state.solveBudget });
  assert.equal(posted[3].res.mode, "project", "an ordinary Project request is unchanged");
  assert.equal(posted[3].res.task, undefined);
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn();console.log(`ok - ${name}`); }
  catch (error) { failed++;console.log(`not ok - ${name}`);console.log(error && error.stack || error); }
}
console.log(failed ? `${failed} fit-in-time test(s) failed` : `${tests.length} fit-in-time tests passed`);
if (failed) process.exit(1);
