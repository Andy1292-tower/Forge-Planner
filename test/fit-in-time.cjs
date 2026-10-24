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
function fit(projects, hours, forced, past) {
  page.__setup = { lines: LINES, projects, hours, forced: forced || [], past: past || {} };
  const out = vm.runInContext(`(function(){
    const s=defaults();s.dupe=0;s.margin=0;s.mode="project";
    s.lines=JSON.parse(JSON.stringify(globalThis.__setup.lines));
    s.projects=JSON.parse(JSON.stringify(globalThis.__setup.projects));
    s.fitHours=globalThis.__setup.hours;s.fitForced=globalThis.__setup.forced.slice();
    Object.assign(s,globalThis.__setup.past);
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
  const mined = P("l2", "Clank", [[]], { ledgerId: "clank", ledgerNo: 14 });                  // Scorchium only
  const res = fit([ledger, mined], 100000);
  assert.deepEqual(res.selection.map(r => r.id), ["l1"]);
  assert.equal(row(res, "l1").ledger, true);
  assert.equal(res.count, 1);
});

test("a level with nothing to craft keeps its place in its chain but finishes nothing", () => {
  // The middle level stands in for a ledger that only asks for mined resources.
  const res = fit([P("t", "Run", [[["Glass", 200]], [], [["Glass", 200]]])], 100000);
  const t = row(res, "t");
  assert.equal(t.remaining, 3);
  assert.equal(t.taken, 3);
  assert.equal(t.finished, 2);
  assert.equal(res.count, 2);
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

test("a must-finish project is in the answer even where leaving it out would finish more", () => {
  const c = fit([C], 100000);
  const hours = c.eta * 1.001;
  const free = fit([A, B, C], fit([A, B], 100000).eta * 1.001);
  assert.equal(row(free, "c").taken, 0, "unforced, the big project is the one left out");
  const res = fit([A, B, C], hours, ["c"]);
  assert.equal(row(res, "c").taken, 1);
  assert.equal(row(res, "c").required, "chosen");
  assert.equal(row(res, "a").required, null);
  assert.equal(res.verified, true);
  assert.ok(res.eta <= hours, `${res.eta} <= ${hours}`);
  assert.equal(res.forcedOver, null);
});

test("must-finish projects that cannot make the limit on their own are reported with their real time", () => {
  const c = fit([C], 100000);
  const res = fit([A, B, C], c.eta * 0.5, ["c"]);
  assert.ok(res.forcedOver, JSON.stringify(res));
  assert.ok(Math.abs(res.forcedOver.real - c.eta) < 1e-6 * c.eta, `${res.forcedOver.real} vs ${c.eta}`);
  assert.equal(res.verified, false);
  assert.equal(row(res, "c").taken, 1);
});

test("a must-finish project brings the in-list unlock it waits on", () => {
  const factory = P("ff", "Frame Factory", [[]], { catId: "frame-factory" });
  const user = P("fr", "Frames user", [[["Frames", 30]]]);
  const res = fit([factory, user, A], 100000, ["fr"]);
  assert.equal(row(res, "fr").required, "chosen");
  assert.equal(row(res, "ff").required, "unlock");
  assert.equal(row(res, "ff").taken, 1);
});

test("the must-finish list saves as project ids, keeps only projects still listed, and never moves a plan", () => {
  const out = JSON.parse(vm.runInContext(`(function(){
    const s=normalize(defaults());s.schemaVersion=CURRENT_SCHEMA_VERSION;s.baseTimeRev=3;s.mode="project";
    s.projects=[{id:"a",name:"A",on:true,prio:null,from:1,to:1,done:0,levels:[{costs:[]}]}];
    s.fitForced=["a","gone","a"];
    const kept=validateAndMigrate(JSON.parse(JSON.stringify(s)));
    const bad=validateAndMigrate(Object.assign(JSON.parse(JSON.stringify(s)),{fitForced:"a"}));
    const other=JSON.parse(JSON.stringify(s));other.fitForced=[];
    return JSON.stringify({ok:kept.ok,forced:kept.state.fitForced,badOk:bad.ok,sameKey:solveStateKey(s)===solveStateKey(other)});
  })()`, page));
  assert.equal(out.ok, true);
  assert.deepEqual(out.forced, ["a"]);
  assert.equal(out.badOk, false);
  assert.equal(out.sameKey, true, "the must-finish list is a question for the search, not a plan input");
});

const D = P("d", "D", [[["Glass", 3000]]]);

test("the next thing past the limit is the quickest one more step, checked as a full plan", () => {
  const ab = fit([A, B], 100000), abd = fit([A, B, D], 100000), abc = fit([A, B, C], 100000);
  const hours = ab.eta * 1.001;
  assert.ok(abd.eta < abc.eta, "D is the quicker addition");
  const res = fit([A, B, C, D], hours, [], { fitNext: true });
  assert.deepEqual(res.selection.map(r => r.taken), [1, 1, 0, 0], "the answer itself is unchanged");
  assert.equal(res.next.status, "found");
  assert.equal(res.next.id, "d");
  assert.equal(res.next.checked, true);
  assert.ok(Math.abs(res.next.eta - abd.eta) < 1e-6 * abd.eta, `${res.next.eta} vs ${abd.eta}`);
  assert.ok(Math.abs(res.next.over - (abd.eta - hours)) < 1e-9);
  assert.equal(res.extra, null, "the extra-hours list is off");
});

test("with extra hours, every next step inside them is listed with its plan time", () => {
  const ab = fit([A, B], 100000), abd = fit([A, B, D], 100000), abc = fit([A, B, C], 100000);
  const hours = ab.eta * 1.001;
  const wide = fit([A, B, C, D], hours, [], { fitExtra: true, fitExtraHours: 1000 });
  assert.equal(wide.extra.hours, 1000);
  assert.deepEqual(wide.extra.items.map(item => item.id), ["d", "c"], "quickest first");
  assert.ok(wide.extra.items.every(item => item.checked));
  assert.ok(Math.abs(wide.extra.items[1].eta - abc.eta) < 1e-6 * abc.eta);
  assert.equal(wide.next, null, "the single next step is off");
  const narrow = fit([A, B, C, D], hours, [], { fitExtra: true, fitExtraHours: Math.max(0.5, (abd.eta - hours) * 1.5) });
  assert.ok(narrow.extra.items.every(item => item.eta <= hours + narrow.extra.hours));
  assert.ok(!narrow.extra.items.some(item => item.id === "c") || abc.eta <= hours + narrow.extra.hours);
});

test("past the limit says when nothing is left, and when nothing lands inside the window", () => {
  const all = fit([A, B], 100000, [], { fitNext: true, fitExtra: true, fitExtraHours: 5 });
  assert.equal(all.next.status, "all");
  assert.equal(all.extra.status, "all");
  // Sized from C's own time, so this project alone takes about 20 hours on these lines.
  const c = fit([C], 100000), far = P("e", "E", [[["Glass", Math.round(1000000 * 20 / c.eta)]]]);
  const e = fit([far], 100000);
  assert.ok(e.eta > 12.6, `E takes ${e.eta}`);
  const none = fit([far], 0.1, [], { fitNext: true, fitExtra: true, fitExtraHours: 0.5 });
  assert.equal(none.count, 0);
  assert.equal(none.next.status, "none");
  assert.deepEqual(none.extra.items, []);
  assert.equal(none.extra.status, "listed");
});

test("the past-the-limit settings save on their own and never move a plan", () => {
  const out = JSON.parse(vm.runInContext(`(function(){
    const s=normalize(defaults());s.schemaVersion=CURRENT_SCHEMA_VERSION;s.baseTimeRev=3;
    const on=Object.assign(JSON.parse(JSON.stringify(s)),{fitNext:true,fitExtra:true,fitExtraHours:6});
    const kept=validateAndMigrate(on),bad=validateAndMigrate(Object.assign(JSON.parse(JSON.stringify(s)),{fitExtraHours:2000}));
    return JSON.stringify({ok:kept.ok,next:kept.state.fitNext,extra:kept.state.fitExtra,hours:kept.state.fitExtraHours,
      defaults:[s.fitNext,s.fitExtra,s.fitExtraHours],badOk:bad.ok,sameKey:solveStateKey(on)===solveStateKey(s)});
  })()`, page));
  assert.deepEqual(out, { ok: true, next: true, extra: true, hours: 6, defaults: [false, false, 12], badOk: false, sameKey: true });
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
