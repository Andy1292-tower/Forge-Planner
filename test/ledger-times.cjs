"use strict";
/* Ledger times (Node): which ledger each card is up to, how optimizeLedgerTimes times them, the shard
 * merge, the Worker protocol's "ledgerTimes" task, and what the dialog renders.
 *
 * The solves run on a frozen clock, so a search ends on its own and two solves of one ledger agree.
 *
 * Usage: node test/ledger-times.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SOURCES = ["js/decimal.js", "js/catalog.js", "js/ledgers.js", "js/core.js", "js/fields.js", "js/state.js",
  "js/project-schedule.js", "js/solver.js"];

function realm(extra) {
  return vm.createContext(Object.assign({
    console, performance: { now: () => 0 }, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => null },
  }, extra || {}));
}
const page = realm();
for (const file of [...SOURCES, "js/dom.js", "js/solve-service.js", "js/results.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), page, { filename: file });
}
const run = source => vm.runInContext(source, page);

const LINES = [
  { max: 4, spx: 5.0, turbo: 0 }, { max: 4, spx: 4.5, turbo: 0 }, { max: 4, spx: 4.0, turbo: 0 },
  { max: 2, spx: 3.5, turbo: 0 }, { max: 2, spx: 3.0, turbo: 0 }, { max: 2, spx: 2.5, turbo: 0 },
];
const card = (ledgerId, ledgerNo, extra) => Object.assign({ id: ledgerId, ledgerId, ledgerNo, ledgerAhead: 0, name: "", on: false,
  prio: null, from: 1, to: 1, done: 0, levels: [] }, extra || {});
const PROJECT = { id: "p", name: "Big project", on: true, prio: null, from: 1, to: 1, done: 0,
  levels: [{ costs: [{ item: "Glass", qty: "1000000" }] }] };

function setState(projects, extra) {
  page.__setup = { lines: LINES, projects, extra: extra || {} };
  run(`(function(){
    const s=defaults();s.dupe=0;s.margin=0;s.mode="project";
    s.lines=JSON.parse(JSON.stringify(globalThis.__setup.lines));
    s.projects=JSON.parse(JSON.stringify(globalThis.__setup.projects));
    Object.assign(s,globalThis.__setup.extra);
    normalize(s);syncManual(s);S=s;resetLineStability();
  })()`);
  delete page.__setup;
}
const times = shard => {
  page.__shard = shard || null;
  const out = JSON.parse(run(`JSON.stringify(optimizeLedgerTimes({now:()=>0},globalThis.__shard))`));
  delete page.__shard;
  return out;
};
const upTo = project => {
  page.__p = project;
  const out = JSON.parse(run(`(function(){const p=JSON.parse(JSON.stringify(globalThis.__p));normalizeLedgerProject(p);return JSON.stringify(ledgerUpTo(p));})()`));
  delete page.__p;
  return out;
};

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("a card is up to the ledger its completed count has reached", () => {
  assert.equal(upTo(card("clank", 1)).name, "Clank ledger #6");
  assert.deepEqual(upTo(card("clank", 1)).costs.map(c => c.item), ["Glass"]);
  assert.equal(upTo(card("clank", 2)).name, "Clank ledger #16", "the card's own ledger");
  assert.equal(upTo(card("clank", 1, { ledgerAhead: 2 })).name, "Clank ledger #6", "Include next doesn't widen it");
  assert.equal(upTo(card("clank", 1, { ledgerAhead: 2, done: 1 })).name, "Clank ledger #16");
  assert.equal(upTo(card("clank", 1, { done: 1 })).name, "Clank ledger #16", "a finished card runs on to the next ledger");
  assert.equal(upTo(card("clank", 1, { done: 9 })).name, "Clank ledger #16", "done is held to the card's span");
});

test("a card with nothing left is up to no ledger, and a project is never a row", () => {
  const last = Number(run(`ledgerCharacter("clank").ledgers.length`));
  assert.ok(upTo(card("clank", last)));
  assert.equal(upTo(card("clank", last, { done: 1 })), null);
  const typed = { ledgerNo: null, name: "Clank ledger", levels: [{ costs: [{ item: "Glass", qty: "5" }] }] };
  assert.deepEqual(upTo(card("clank", null, typed)).costs.map(c => c.item), ["Glass"], "typed-in items");
  assert.equal(upTo(card("clank", null, Object.assign({ done: 1 }, typed))), null);
  assert.equal(upTo(PROJECT), null);
});

for (const lineMode of ["split", "static"]) {
  test(`each time is the plan that ledger gets ticked alone, in ${lineMode} mode`, () => {
    const cards = [card("clank", 1), card("donathan-creel", 1, { on: true })];
    setState([PROJECT, ...cards], { projLineMode: lineMode });
    const { rows } = times();
    assert.deepEqual(rows.map(row => row.id), ["clank", "donathan-creel"], "ticked or not, and no project");

    cards.forEach((one, index) => {
      setState([Object.assign({}, one, { on: true })], { projLineMode: lineMode, projectStability: "reoptimize" });
      const alone = JSON.parse(run(`JSON.stringify(optimize({now:()=>0}))`));
      assert.equal(alone.feasible, true);
      assert.ok(alone.eta > 0);
      assert.equal(rows[index].eta, alone.eta, `${one.id} matches its own plan`);
      assert.equal(rows[index].empty, false);
    });
  });
}

test("Include next stays out of the time, and completed ledgers move it on", () => {
  setState([card("clank", 1)]);
  const first = times().rows[0];
  setState([card("clank", 1, { ledgerAhead: 3 })]);
  assert.equal(times().rows[0].eta, first.eta);
  assert.equal(times().rows[0].name, first.name);
  setState([card("clank", 1, { ledgerAhead: 3, done: 1 })]);
  const next = times().rows[0];
  assert.equal(next.name, "Clank ledger #16");
  setState([card("clank", 2)]);
  assert.equal(times().rows[0].eta, next.eta);
});

test("stock on hand counts, and enough of it leaves nothing to wait for", () => {
  setState([card("clank", 1)]);
  const empty = times().rows[0];
  run(`mutateState(st=>{st.inventory.Glass="45";});`);
  const half = times().rows[0];
  assert.ok(half.eta > 0 && half.eta < empty.eta);
  run(`mutateState(st=>{st.inventory.Glass="90";});`);
  const covered = times().rows[0];
  assert.equal(covered.eta, 0);
  assert.equal(covered.empty, false);
  assert.equal(run(`ledgerTimeCellHtml(${JSON.stringify(covered)})`), "Stock covers it");
});

test("a ledger with nothing to craft and one short of mined income say so", () => {
  const nothing = { ledgerNo: null, name: "Clank ledger", levels: [{ costs: [] }] };
  setState([card("clank", null, nothing), card("donathan-creel", 1)]);
  const empty = times().rows[0];
  assert.equal(empty.empty, true);
  assert.equal(empty.eta, null);
  assert.equal(run(`ledgerTimeCellHtml(${JSON.stringify(empty)})`), "Nothing to craft");

  const gelAt = Number(run(`ledgerCharacter("clank").ledgers.findIndex(l=>l.costs.some(c=>c.item==="Gel"))`)) + 1;
  setState([card("clank", gelAt)]);
  const blocked = times().rows[0];
  assert.equal(blocked.eta, null);
  assert.deepEqual(blocked.blocked, ["Vespium"]);
  assert.equal(run(`ledgerTimeCellHtml(${JSON.stringify(blocked)})`), "Needs Vespium income");
});

test("a run leaves the state and the line stability cache as it found them", () => {
  setState([card("clank", 1, { on: true }), PROJECT]);
  run(`setLineStability({kept:{0:["Glass@1"]}});globalThis.__before=S;`);
  const before = run(`JSON.stringify(S)`), stability = run(`JSON.stringify(getLineStability())`);
  times();
  assert.equal(run(`S===globalThis.__before`), true);
  assert.equal(run(`JSON.stringify(S)`), before);
  assert.equal(run(`JSON.stringify(getLineStability())`), stability);
  run(`delete globalThis.__before;`);
});

test("shards split the ledgers between them and merge back in list order", () => {
  setState([card("clank", 1), PROJECT, card("donathan-creel", 1), card("meepa-torani", 1)]);
  const whole = times();
  const parts = [{ index: 0, count: 2 }, { index: 1, count: 2 }].map(shard => ({ shard, res: times(shard) }));
  assert.deepEqual(parts[0].res.rows.map(row => row.id), ["clank", "meepa-torani"]);
  assert.deepEqual(parts[1].res.rows.map(row => row.id), ["donathan-creel"]);
  page.__parts = parts;
  const merged = JSON.parse(run(`JSON.stringify(mergeShardResults("project",globalThis.__parts,"ledgerTimes"))`));
  delete page.__parts;
  assert.deepEqual(merged.rows, whole.rows);
  assert.equal(merged.task, "ledgerTimes");
});

test("the Worker runs the task on the solve budget and refuses it elsewhere", () => {
  const posted = [];
  const worker = realm({ self: { postMessage: message => posted.push(JSON.parse(JSON.stringify(message))) } });
  worker.importScripts = (...files) => files.forEach(file =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", file), "utf8"), worker, { filename: file }));
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", "solver.worker.v2.js"), "utf8"), worker);
  const state = JSON.parse(vm.runInContext(`(function(){const s=normalize(defaults());s.mode="project";
    s.schemaVersion=CURRENT_SCHEMA_VERSION;s.baseTimeRev=3;s.solveBudget=200;
    s.projects=[{id:"clank",name:"",ledgerId:"clank",ledgerNo:1,ledgerAhead:0,on:false,prio:null,from:1,to:1,done:0,levels:[]}];
    normalize(s);return JSON.stringify(s);})()`, worker));
  const send = message => worker.self.onmessage({ data: Object.assign({ reqId: 1, generation: 1, mode: "project",
    stateRevision: 0, state }, message) });

  send({ budget: state.solveBudget, task: "ledgerTimes", stab: { kept: { 0: ["Glass@1"] } } });
  assert.equal(posted[0].error, undefined, posted[0].error && posted[0].error.message);
  assert.equal(posted[0].res.task, "ledgerTimes");
  assert.equal(posted[0].res.rows.length, 1);
  assert.equal(posted[0].res.rows[0].name, "Clank ledger #6");
  assert.ok(posted[0].res.rows[0].eta > 0);
  assert.deepEqual(posted[0].res.__stab, { kept: { 0: ["Glass@1"] } }, "the page's stability cache comes back untouched");

  send({ budget: state.fitBudget, task: "ledgerTimes" });
  assert.match(posted[1].error.message, /budget does not match/);
  send({ budget: state.solveBudget, task: "ledgerTimes", mode: "items" });
  assert.ok(posted[2].error);
});

test("the dialog lists the ledgers you're up to, ticked or not, and no projects", () => {
  setState([card("clank", 1), PROJECT, card("donathan-creel", 1, { on: true, done: 1 })]);
  const html = run(`ledgerTimesListHtml()`);
  assert.match(html, /Clank ledger #6/);
  assert.match(html, /Donathan Creel ledger #\d+/);
  assert.doesNotMatch(html, /Big project/);
  assert.equal((html.match(/<tr>/g) || []).length, 3, "a header and two ledgers");
  assert.equal((html.match(/<td class="num">—<\/td>/g) || []).length, 2, "no times until it has run");
  assert.match(run(`ledgerTimesButtonHtml()`), /id="btnLedgerTimes"/);
});

test("the button goes away with no ledger left to time", () => {
  setState([PROJECT]);
  assert.equal(run(`ledgerTimesButtonHtml()`), "");
  assert.match(run(`ledgerTimesListHtml()`), /No ledgers left to time/);
});

test("a finished run shows its times and marks the ones it stopped searching", () => {
  setState([card("clank", 1), card("donathan-creel", 1)]);
  page.__rows = times().rows;
  page.__rows[1].bounded = true;
  run(`_ledgerTimes={key:ledgerTimesKey(),res:{rows:globalThis.__rows}};`);
  delete page.__rows;
  const html = run(`ledgerTimesListHtml()`);
  assert.equal((html.match(/<td class="num">[^<—]+\*<\/td>/g) || []).length, 1);
  assert.match(html, /A shorter one may exist/);
  assert.doesNotMatch(html, /<td class="num">—<\/td>/);
  assert.equal(run(`ledgerTimesStatusHtml()`), "");
});

test("a tick leaves the answer current, and what a run reads marks it out of date", () => {
  setState([card("clank", 1), card("donathan-creel", 1), PROJECT]);
  run(`_ledgerTimes={key:ledgerTimesKey(),res:{rows:[]}};`);
  const stale = () => /changed after this run/.test(run(`ledgerTimesStatusHtml()`));
  assert.equal(stale(), false);
  run(`mutateState(st=>{st.projects[0].on=true;st.projects[2].on=false;st.projects[2].done=1;st.projectSeq=!st.projectSeq;});`);
  assert.equal(stale(), false, "ticks, a project and the plan's order move no time");
  run(`mutateState(st=>{st.projLineMode="static";});`);
  assert.equal(stale(), true, "the line plan");
  run(`mutateState(st=>{st.projLineMode="split";});`);
  assert.equal(stale(), false);
  run(`mutateState(st=>{st.inventory.Glass="5";});`);
  assert.equal(stale(), true, "inventory");
  run(`mutateState(st=>{st.inventory.Glass=null;st.projects[0].done=1;});`);
  assert.equal(stale(), true, "the ledger a card is up to");
  run(`_ledgerTimes=null;`);
});

test("only the dialog's button starts a run", () => {
  const sources = fs.readdirSync(path.join(ROOT, "js")).filter(file => file.endsWith(".js"))
    .flatMap(file => fs.readFileSync(path.join(ROOT, "js", file), "utf8").split("\n"));
  const uses = sources.filter(line => /\bstartLedgerTimes\b/.test(line));
  assert.equal(uses.length, 2, uses.join("\n"));
  assert.ok(uses.some(line => /^function startLedgerTimes\(\)/.test(line)));
  assert.ok(uses.some(line => /getElementById\("btnLedgerTimesRun"\)\.addEventListener\("click",startLedgerTimes\)/.test(line)));
  const requests = sources.filter(line => /task:"ledgerTimes"/.test(line));
  assert.equal(requests.length, 2, requests.join("\n"));
  assert.ok(requests.some(line => /solveService\.request\(/.test(line)));
  assert.ok(requests.some(line => /^\s*return \{mode:"project",task:"ledgerTimes"/.test(line)), "the rest is the solver's own result");
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn();console.log(`ok - ${name}`); }
  catch (error) { failed++;console.log(`not ok - ${name}`);console.log(error && error.stack || error); }
}
console.log(failed ? `${failed} ledger times test(s) failed` : `${tests.length} ledger times tests passed`);
if (failed) process.exit(1);
