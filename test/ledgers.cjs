"use strict";
/* Ledgers (Node): the generated character data, the CSV generator, how a ledger project is saved and
 * normalized, and how Project plan reads it.
 *
 * Usage: node test/ledgers.cjs
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { parse, render, DISABLED, MAX_LEDGER_NUMBER } = require("../scripts/ledgers-from-csv.cjs");

const ROOT = path.join(__dirname, "..");
const PAGE = ["js/decimal.js", "js/catalog.js", "js/ledgers.js", "js/core.js", "js/fields.js", "js/state.js",
  "js/project-schedule.js", "js/solver.js"];

function realm(files) {
  const context = vm.createContext({
    console, performance: { now: () => 0 }, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { getElementById: () => ({ innerHTML: "", textContent: "" }) },
  });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  return context;
}
const page = realm(PAGE);
// The solver Worker loads core.js without the page-only data files.
const worker = realm(PAGE.filter(file => file !== "js/ledgers.js" && file !== "js/catalog.js"));
const run = (context, source) => vm.runInContext(source, context);

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function savedState(context, projects) {
  const state = JSON.parse(run(context, "JSON.stringify(normalize(defaults()))"));
  state.schemaVersion = run(context, "CURRENT_SCHEMA_VERSION");
  state.baseTimeRev = 3;
  state.projects = projects;
  return state;
}
function ledgerProject(overrides) {
  return Object.assign({ id: "ledger1", name: "x", on: true, prio: null, from: 1, to: 1, done: 0,
    ledgerId: "tank-timmerson", ledgerNo: 14, levels: [{ costs: [] }] }, overrides);
}
function validate(context, state) {
  context.__candidate = state;
  const result = run(context, "(function(){const r=validateAndMigrate(globalThis.__candidate);" +
    "return JSON.parse(JSON.stringify({ok:r.ok,errors:r.errors,state:r.state}));})()");
  delete context.__candidate;
  return result;
}

test("the ledger data names every character once, in the game's A–Z order", () => {
  const characters = JSON.parse(run(page, "JSON.stringify(LEDGER_CHARACTERS)"));
  const names = characters.map(c => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.equal(new Set(characters.map(c => c.ledgerId)).size, characters.length);
  assert.equal(characters.length, 10);
  for (const character of characters) {
    assert.ok(!DISABLED.has(character.ledgerId), `${character.name} is switched off in the generator`);
    assert.ok(fs.existsSync(path.join(ROOT, character.portrait)), `${character.name} has a portrait`);
    assert.ok(character.ledgers.length > 0);
  }
});

test("every ledger is either a craftable the planner schedules or a listed other cost", () => {
  const items = JSON.parse(run(page, "JSON.stringify(ALLITEMS)"));
  const codes = new Set();
  const characters = JSON.parse(run(page, "JSON.stringify(LEDGER_CHARACTERS)"));
  for (const character of characters) {
    character.ledgers.forEach((ledger, index) => {
      assert.match(ledger.code, /^CGMC-741e-\d{3}$/, `${character.name} #${index + 1}`);
      assert.ok(!codes.has(ledger.code), `${ledger.code} is unique`);
      codes.add(ledger.code);
      assert.ok(ledger.costs.length + ledger.other.length > 0, `${character.name} #${index + 1} asks for something`);
      for (const cost of ledger.costs) {
        assert.ok(items.includes(cost.item), `${cost.item} is a planner item`);
        assert.equal(run(page, `toDec(${JSON.stringify(cost.qty)}).gt(DEC_ZERO)`), true, `${cost.item} ${cost.qty}`);
      }
      for (const cost of ledger.other) {
        assert.ok(!items.includes(cost.item), `${cost.item} is not something the planner crafts`);
        assert.equal(run(page, `toDec(${JSON.stringify(cost.qty)}).gt(DEC_ZERO)`), true, `${cost.item} ${cost.qty}`);
      }
    });
  }
});

test("no ledger past the cutoff ships, commented-out characters included", () => {
  assert.equal(MAX_LEDGER_NUMBER, 370);
  const source = fs.readFileSync(path.join(ROOT, "js", "ledgers.js"), "utf8");
  const numbers = [...source.matchAll(/CGMC-741e-(\d+)/g)].map(match => Number(match[1]));
  assert.ok(numbers.length > 0);
  assert.ok(numbers.every(n => n <= MAX_LEDGER_NUMBER), `highest shipped: ${Math.max(...numbers)}`);
  assert.ok(numbers.includes(MAX_LEDGER_NUMBER), "the cutoff itself is kept");
});

test("characters switched off in the generator stay in the data file as comments", () => {
  const source = fs.readFileSync(path.join(ROOT, "js", "ledgers.js"), "utf8");
  for (const id of DISABLED) {
    assert.match(source, new RegExp(`^  // \\{ledgerId:"${id}",`, "m"), `${id} is commented out`);
    assert.ok(fs.existsSync(path.join(ROOT, "assets", `ledger-${id}.webp`)), `${id} keeps its portrait for when it is turned on`);
  }
});

test("the generator maps the game's material names and refuses anything it does not know", () => {
  const header = "ledger_number,order_code,character,character_name,character_ledger_number,material_count," +
    "material_1,amount_1,material_2,amount_2,material_3,amount_3,material_4,amount_4";
  const csv = rows => [header, ...rows].join("\n");
  const characters = parse(csv([
    "2,CGMC-741e-002,Bee,Bee,2,2,VespiumWire,40,Scorchium,2e16,,,,",
    "1,CGMC-741e-001,Bee,Bee,1,1,LowGradeGel,50,,,,,,",
    "3,CGMC-741e-003,Ann,Ann,1,1,IndustrialBits,325,,,,,,",
  ]));
  assert.deepEqual(characters.map(c => c.name), ["Ann", "Bee"]);
  assert.deepEqual(characters[1].ledgers.map(l => l.code), ["CGMC-741e-001", "CGMC-741e-002"]);
  assert.deepEqual(characters[1].ledgers[1].costs, [{ item: "Wire", qty: "40" }]);
  assert.deepEqual(characters[1].ledgers[1].other, [{ item: "Scorchium", qty: "2e16" }]);
  assert.throws(() => parse(csv(["1,CGMC-741e-001,Ann,Ann,1,1,Unobtainium,5,,,,,,"])), /unknown material "Unobtainium"/);
  assert.throws(() => parse(csv(["1,CGMC-741e-001,Ann,Ann,2,1,IndustrialBits,5,,,,,,"])), /ledger 1 is missing/);
  const cut = parse(csv(["370,CGMC-741e-370,Ann,Ann,1,1,IndustrialBits,5,,,,,,", "371,CGMC-741e-371,Ann,Ann,2,1,IndustrialBits,9,,,,,,"]));
  assert.deepEqual(cut[0].ledgers.map(l => l.code), ["CGMC-741e-370"], "a ledger past the cutoff is left out");
  assert.throws(() => parse(csv(["371,CGMC-741e-371,Ann,Ann,1,1,IndustrialBits,5,,,,,,", "5,CGMC-741e-005,Ann,Ann,2,1,IndustrialBits,9,,,,,,"])),
    /ledger 1 is missing/, "a cut that would leave a hole stops the run");
  const written = render(parse(csv(["1,CGMC-741e-001,Gerbo,Gerbo,1,1,Vespium,200,,,,,,"])));
  assert.match(written, /^  \/\/ \{ledgerId:"gerbo"/m, "a DISABLED character is written commented out");
});

test("a saved ledger takes its costs from the data, whatever the save carried", () => {
  const result = validate(page, savedState(page, [ledgerProject({ levels: [{ costs: [{ item: "Bits", qty: "1" }] }] })]));
  assert.equal(result.ok, true, result.errors && result.errors.join("; "));
  const p = result.state.projects[0];
  assert.equal(p.name, "Tank Timmerson ledger #143", "named by the order code, CGMC-741e-143");
  assert.equal(p.ledgerNo, 14);
  assert.deepEqual(p.levels[0].costs, [{ item: "Plates", qty: "300000" }, { item: "Gel", qty: "10000" }]);
});

test("a ledger's number is the trailing digits of its order code", () => {
  assert.equal(run(page, 'ledgerNumber({code:"CGMC-741e-344"})'), 344);
  assert.equal(run(page, 'ledgerNumber({code:"CGMC-741e-028"})'), 28);
  assert.equal(run(page, "ledgerNumber(null)"), null);
});

test("Include next plans the following ledgers as further levels, in order", () => {
  // Tank Timmerson #14, #15 and #16 are CGMC-741e-143 (Plates, Gel), -144 (Vespium only) and -160 (Ingots).
  const result = validate(page, savedState(page, [ledgerProject({ ledgerAhead: 2 })]));
  assert.equal(result.ok, true, result.errors && result.errors.join("; "));
  const p = result.state.projects[0];
  assert.equal(p.name, "Tank Timmerson ledgers #143–#160");
  assert.equal(p.ledgerAhead, 2);
  assert.equal(p.from, 1);
  assert.equal(p.to, 3);
  assert.deepEqual(p.levels.map(level => level.costs), [
    [{ item: "Plates", qty: "300000" }, { item: "Gel", qty: "10000" }], [], [{ item: "Ingots", qty: "1000000000" }]]);
});

test("Include next stops at the last ledger the data has, and does nothing for typed-in items", () => {
  const near = validate(page, savedState(page, [ledgerProject({ ledgerNo: 30, ledgerAhead: 5 })]));
  assert.equal(near.ok, true, near.errors && near.errors.join("; "));
  assert.equal(near.state.projects[0].levels.length, 2, "Tank Timmerson's listed ledgers end at #31 (CGMC-741e-369)");
  const typed = validate(page, savedState(page, [ledgerProject({ ledgerNo: null, ledgerAhead: 3,
    levels: [{ costs: [{ item: "Rods", qty: "5" }] }] })]));
  assert.equal(typed.ok, true, typed.errors && typed.errors.join("; "));
  assert.equal(typed.state.projects[0].levels.length, 1);
  assert.equal(typed.state.projects[0].to, 1);
});

test("Include next only saves on a ledger, as a whole number up to 1000", () => {
  const stray = validate(page, savedState(page, [{ id: "c1", name: "Custom", on: true, prio: null, from: 1, to: 1, done: 0,
    ledgerAhead: 2, levels: [{ costs: [] }] }]));
  assert.equal(stray.ok, false);
  assert.ok(stray.errors.some(error => /ledgerAhead is only valid on a ledger/.test(error)), stray.errors.join("; "));
  for (const bad of [1001, -1, 1.5]) {
    const result = validate(page, savedState(page, [ledgerProject({ ledgerAhead: bad })]));
    assert.equal(result.ok, false, String(bad));
  }
});

test("a ledger the data does not have keeps its typed-in items", () => {
  const typed = [{ item: "Rods", qty: "1000" }];
  for (const ledgerNo of [null, 999]) {
    const result = validate(page, savedState(page, [ledgerProject({ ledgerNo, levels: [{ costs: typed }] })]));
    assert.equal(result.ok, true, result.errors && result.errors.join("; "));
    const p = result.state.projects[0];
    assert.equal(p.ledgerNo, null, `ledger ${ledgerNo}`);
    assert.equal(p.name, "Tank Timmerson ledger");
    assert.deepEqual(p.levels[0].costs, typed);
  }
});

test("the save boundary rejects a second card for one character and stray ledger fields", () => {
  const twice = validate(page, savedState(page, [ledgerProject(), ledgerProject({ id: "ledger2" })]));
  assert.equal(twice.ok, false);
  assert.ok(twice.errors.some(error => /ledgerId must be unique/.test(error)), twice.errors.join("; "));

  const stray = validate(page, savedState(page, [{ id: "c1", name: "Custom", on: true, prio: null, from: 1, to: 1, done: 0,
    ledgerNo: 3, levels: [{ costs: [] }] }]));
  assert.equal(stray.ok, false);
  assert.ok(stray.errors.some(error => /ledgerNo is only valid on a ledger/.test(error)), stray.errors.join("; "));

  const both = validate(page, savedState(page, [ledgerProject({ catId: "frame-factory" })]));
  assert.equal(both.ok, false);
  assert.ok(both.errors.some(error => /must not be set on a catalog project/.test(error)), both.errors.join("; "));
});

test("a version 6 save opens unchanged under version 7", () => {
  const state = savedState(page, [{ id: "c1", name: "Custom", on: true, prio: 2, from: 1, to: 1, done: 0,
    levels: [{ costs: [{ item: "Glass", qty: "5" }] }] }]);
  state.schemaVersion = 6;
  const result = validate(page, state);
  assert.equal(result.ok, true, result.errors && result.errors.join("; "));
  assert.equal(result.state.schemaVersion, 7);
  assert.deepEqual(result.state.projects[0].levels[0].costs, [{ item: "Glass", qty: "5" }]);
  assert.equal(result.state.projects[0].ledgerId, undefined);
});

test("the solver Worker, which has no ledger data, keeps a ledger exactly as the page sent it", () => {
  const sent = [{ item: "Plates", qty: "300000" }, { item: "Gel", qty: "10000" }];
  const result = validate(worker, savedState(worker, [ledgerProject({ name: "Tank Timmerson ledger #14", levels: [{ costs: sent }] })]));
  assert.equal(result.ok, true, result.errors && result.errors.join("; "));
  const p = result.state.projects[0];
  assert.equal(p.ledgerNo, 14);
  assert.equal(p.name, "Tank Timmerson ledger #14");
  assert.deepEqual(p.levels[0].costs, sent);
});

test("Project plan crafts every included ledger's items together", () => {
  page.__projects = [ledgerProject({ id: "tank", ledgerAhead: 2 })];
  const demand = JSON.parse(run(page, "(function(){S=normalize(defaults());S.projects=globalThis.__projects;normalize(S);" +
    "const d=projectDemand();return JSON.stringify({names:d.perProject.map(p=>p.name),plates:String(d.gross.Plates)," +
    "ingots:String(d.gross.Ingots),gel:String(d.gross.Gel)});})()"));
  delete page.__projects;
  assert.deepEqual(demand.names, ["Tank Timmerson ledgers #143–#160"]);
  assert.equal(demand.plates, "300000");
  assert.equal(demand.gel, "10000");
  assert.equal(demand.ingots, "1000000000");
});

test("Project plan skips a ledger with nothing to craft and plans the rest", () => {
  // Tank Timmerson #15 asks only for Vespium; #14 asks for Plates and Gel.
  page.__projects = [
    ledgerProject({ id: "tank", ledgerNo: 15 }),
    ledgerProject({ id: "puri", ledgerId: "puri-puri", ledgerNo: 5 }),
    { id: "empty", name: "Empty custom", on: true, prio: null, from: 1, to: 1, done: 0, levels: [{ costs: [] }] },
  ];
  const demand = JSON.parse(run(page, "(function(){S=normalize(defaults());S.projects=globalThis.__projects;normalize(S);" +
    "const d=projectDemand();return JSON.stringify({ids:d.perProject.map(p=>p.id),names:d.perProject.map(p=>p.name)," +
    "plates:String(d.gross.Plates)});})()"));
  delete page.__projects;
  assert.deepEqual(demand.ids, ["puri", "empty"], "the mined-only ledger has no phase; a custom project is unchanged");
  assert.deepEqual(demand.names, ["Puri Puri ledger #108", "Empty custom"]);
  assert.equal(demand.plates, "27500");
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn();console.log(`ok - ${name}`); }
  catch (error) { failed++;console.log(`not ok - ${name}`);console.log(error && error.stack || error); }
}
console.log(failed ? `${failed} ledger test(s) failed` : `${tests.length} ledger tests passed`);
if (failed) process.exit(1);
