"use strict";

/* Offline crafting in Project plan.
 *
 * Offline, every crafting line stops and Lil' Forgie makes twice his online rate, raised by the
 * Forgie upgrade offline boost at +0.5% a level. Mined income keeps coming in at half rate. With
 * "Consider offline crafting" ticked, the plan is checked last for a stretch away in front of any
 * phase that finishes it sooner; a stretch has to save OFFLINE_MIN_SAVING_FRAC of the online plan's
 * time to be used. Overclock, nested under it, banks time away at the conversion rate up to the cap
 * and runs everything at x2 once the player is back.
 *
 * Usage: node test/offline-crafting.cjs */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const context = vm.createContext({
  console,
  performance: { now: () => 0 },
  setTimeout,
  clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
});
for (const file of ["js/decimal.js", "js/catalog.js", "js/ledgers.js", "js/core.js", "js/fields.js", "js/state.js",
  "js/project-schedule.js", "js/solver.js"]) {
  const filename = path.join(ROOT, file);
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
}
const api = expression => vm.runInContext(expression, context);
const setState = api("(state)=>{S=state;}");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const close = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

// One slow line, so Lil' Forgie's Bricks can out-produce it once he is doubled.
function factory(options = {}) {
  const state = api("defaults")();
  state.dupe = 0;state.mode = "project";state.solveBudget = 2000;
  state.lines = options.lines || [{ max: 4, spx: 1, turbo: 0 }, { max: 4, spx: 1, turbo: 0 }];
  state.projects = options.projects || [{ id: "a", name: "Brick Yard", catId: "", on: true, from: 1, to: 1, done: 0, prio: null,
    levels: [{ costs: [{ item: "Bricks", qty: 5000 }] }] }];
  state.forgie.Bricks = options.forgieBricks == null ? 200 : options.forgieBricks;
  state.projectSeq = options.seq !== false;
  state.projLineMode = options.lineMode || "split";
  state.projectOffline = options.offline !== false;
  state.projectOverclock = !!options.overclock;
  state.forgieOfflineBoost = options.boost == null ? 14 : options.boost;
  state.ocMaxLevel = options.ocMax || 0;state.ocRateLevel = options.ocRate || 0;state.ocStoredMin = options.stored || 0;
  api("normalize")(state);api("syncManual")(state);
  return state;
}
function plan(options) {
  setState(factory(options));
  return api("optimize")();
}
const kinds = res => res.executionPhases.map(ph => ph.kind);

test("Lil' Forgie makes twice his online rate offline, plus 0.5% a boost level", () => {
  const mult = level => api("offlineForgieMult")({ forgieOfflineBoost: level });
  assert.equal(mult(0), 2);
  close(mult(14), 2.14, 1e-12, "level 14 is 1.07 on top of the doubling");
  close(mult(20), 2.2, 1e-12, "level 20 is the top");
  close(mult(25), 2.2, 1e-12, "a level past 20 counts as 20");
});

test("the Overclocking upgrades read the way the game's screen shows them", () => {
  close(api("overclockCapHours")({ ocMaxLevel: 85 }), 11.75, 1e-12, "level 85 stores 11:45:00");
  close(api("overclockCapHours")({ ocMaxLevel: 0 }), 280 / 60, 1e-12, "level 0 stores 4:40:00");
  close(api("overclockRatePerHour")({ ocRateLevel: 13 }), 28 / 60, 1e-12, "level 13 converts 28m an hour away");
  close(api("overclockRatePerHour")({ ocRateLevel: 15 }), 30 / 60, 1e-12, "level 15 converts 30m an hour away");
  close(api("overclockStoredHours")({ ocMaxLevel: 0, ocStoredMin: 600 }), 280 / 60, 1e-12, "stored past the cap counts as the cap");
});

test("Overclock is spent as soon as the player is online, and time away refills it to the cap", () => {
  const timeline = api("overclockTimeline");
  const oc = { cap: 4, rate: 0.5 };
  let clock = timeline([{ kind: "project", eta: 10 }], oc, 3);
  close(clock.wall, 7, 1e-12, "3h at x2 covers 6h of crafting");
  close(clock.used, 3, 1e-12, "all 3h are spent");
  clock = timeline([{ kind: "project", eta: 2 }], oc, 3);
  close(clock.wall, 1, 1e-12, "a short phase only spends half its game time");
  close(clock.bank, 2, 1e-12, "the rest stays banked");
  clock = timeline([{ kind: "offline", eta: 10 }, { kind: "project", eta: 10 }], oc, 0);
  close(clock.steps[0].bank, 4, 1e-12, "10h away at 30m an hour fills to the 4h cap, not 5h");
  close(clock.wall, 16, 1e-12, "the time away counts in full; the 4h at x2 saves 4h");
  clock = timeline([{ kind: "project", eta: 10 }], null, 3);
  close(clock.wall, 10, 1e-12, "without Overclock game time is real time");
});

test("real time inside a phase runs at x2 until its Overclock is spent", () => {
  const phases = [{ kind: "project", eta: 10, overclock: 3, wallEta: 7 }, { kind: "project", eta: 4, overclock: 0, wallEta: 4 }];
  const wall = t => api("planWallTime")(phases, t);
  close(wall(4), 2, 1e-12, "inside the x2 stretch");
  close(wall(6), 3, 1e-12, "where the x2 stretch ends");
  close(wall(10), 7, 1e-12, "the end of the phase");
  close(wall(12), 9, 1e-12, "the next phase runs at x1");
});

test("the replay runs an offline phase with idle lines, Lil' Forgie boosted and Hydracite banked at half rate", () => {
  const context = {
    ordinaryResources: api("[...ALLITEMS]"), minedResources: ["Vespium", "Hydracite"], minedStockResources: ["Hydracite"],
    informationalResources: ["Rocks"], forgieRates: { Bricks: 100 }, minedIncomeRates: { Hydracite: 50 }
  };
  const away = { kind: "offline", name: "Offline", eta: 10, plan: [], demandSub: {}, forgieScale: 2.14, minedScale: 0.5 };
  const replay = api("replayProjectSchedule")([away], { Bricks: 7, Hydracite: 3 }, context);
  assert.equal(replay.ok, true, replay.firstFailure && replay.firstFailure.message);
  close(replay.finalInventory.Bricks, 7 + 2140, 1e-9, "10h at 2.14 x 100 Bricks/hr");
  close(replay.finalInventory.Hydracite, 3 + 250, 1e-9, "10h at half of 50 Hydracite/hr");
  const bad = api("replayProjectSchedule")([Object.assign({}, away, { demandSub: { Bricks: 1 } })], {}, context);
  assert.equal(bad.ok, false, "an offline phase cannot complete a project");
});

test("a Forgie-heavy project goes offline, and the plan says how long and what it saves", () => {
  const online = plan({ offline: false });
  const res = plan({});
  assert.equal(online.offline, undefined, "an unticked box leaves the plan as it always was");
  assert.equal(res.feasible, true);
  assert.equal(res.scheduleValidation.ok, true, "the plan with its stretch passes exact replay");
  assert.deepEqual(kinds(res).slice(0, 1), ["offline"], "the stretch comes before the phase it speeds up");
  assert.equal(res.offline.stretches.length, 1);
  assert.equal(res.offline.stretches[0].before, "Brick Yard");
  close(res.offline.onlineEta, online.eta, 1e-9, "the note compares against the plan that stays online");
  assert.ok(res.eta <= online.eta * (1 - api("OFFLINE_MIN_SAVING_FRAC")) + 1e-9,
    `going offline saves at least the threshold: ${res.eta} vs ${online.eta}`);
  close(res.eta, res.offline.awayHours + res.executionPhases.filter(ph => ph.kind !== "offline").reduce((s, ph) => s + ph.eta, 0),
    1e-9, "the total counts the time away");
  const away = res.executionPhases[0];
  close(away.forgieScale, 2.14, 1e-12, "Lil' Forgie runs at his boosted offline rate");
  assert.equal(away.plan.length, 0, "no line works while the player is away");
});

test("one at a time, only the phase that gains gets a stretch", () => {
  const projects = [
    { id: "a", name: "Brick Yard", catId: "", on: true, from: 1, to: 1, done: 0, prio: 1, levels: [{ costs: [{ item: "Bricks", qty: 5000 }] }] },
    { id: "b", name: "Plate Shop", catId: "", on: true, from: 1, to: 1, done: 0, prio: 2, levels: [{ costs: [{ item: "Plates", qty: 3000 }] }] }];
  const online = plan({ projects, offline: false });
  const res = plan({ projects });
  assert.equal(res.scheduleValidation.ok, true);
  assert.deepEqual(res.offline.stretches.map(st => st.before), ["Brick Yard"],
    "Lil' Forgie makes no Plates, so going offline cannot help the Plate Shop");
  const plates = res.executionPhases.find(ph => ph.kind === "project" && ph.name === "Plate Shop");
  assert.ok(plates.plan.some(line => line.entries.length), "the second project is crafted online");
  assert.ok(res.eta < online.eta, `${res.eta} vs ${online.eta}`);
});

test("Set & forget plans take a stretch the same way", () => {
  const res = plan({ lineMode: "static" });
  assert.equal(res.scheduleValidation.ok, true);
  assert.equal(res.offline.stretches.length, 1);
  assert.ok(res.eta < res.offline.onlineEta);
});

test("a stretch that saves less than the threshold is left out, and the plan stays as it was", () => {
  // At 40 Bricks/hr the lines out-make the extra Lil' Forgie gets offline.
  const online = plan({ forgieBricks: 40, offline: false });
  const res = plan({ forgieBricks: 40 });
  assert.equal(res.offline.considered, true);
  assert.equal(res.offline.stretches.length, 0);
  assert.ok(!kinds(res).includes("offline"));
  close(res.eta, online.eta, 1e-9, "no stretch means the online plan, unchanged");
});

test("Overclock earned offline runs the phase after it at x2", () => {
  const plain = plan({});
  const res = plan({ overclock: true, ocMax: 85, ocRate: 13, stored: 5 });
  assert.equal(res.scheduleValidation.ok, true);
  assert.equal(res.offline.overclock, true);
  assert.ok(res.offline.overclockUsed > 0, "the plan spends Overclock");
  assert.ok(res.eta < res.gameEta, `real time ${res.eta} is shorter than game time ${res.gameEta}`);
  assert.ok(res.eta < plain.eta, `Overclock shortens the offline plan: ${res.eta} vs ${plain.eta}`);
  const away = res.executionPhases.find(ph => ph.kind === "offline");
  close(away.overclockBank, Math.min(11.75, 5 / 60 + away.eta * 28 / 60), 1e-9, "the stretch banks 28m an hour on top of what was stored");
  const total = res.executionPhases.reduce((sum, ph) => sum + ph.wallEta, 0);
  close(total, res.eta, 1e-9, "every step's real time adds up to the total");
});

test("stored Overclock is spent from the start even when no stretch qualifies", () => {
  // Lil' Forgie makes nothing, so time away only earns Overclock — 28m for every hour lost.
  const res = plan({ forgieBricks: 0, overclock: true, ocMax: 85, ocRate: 13, stored: 60 });
  assert.equal(res.offline.stretches.length, 0);
  close(res.offline.overclockUsed, 1, 1e-9, "the hour stored is spent");
  close(res.gameEta - res.eta, 1, 1e-9, "an hour of Overclock saves an hour");
});

test("saves keep the offline settings, and reject levels the game does not have", () => {
  const state = api("normalize(defaults())");
  state.schemaVersion = api("CURRENT_SCHEMA_VERSION");state.baseTimeRev = 3;
  Object.assign(state, { projectOffline: true, projectOverclock: true, forgieOfflineBoost: 14, ocMaxLevel: 85, ocRateLevel: 13, ocStoredMin: 300 });
  const kept = api("validateAndMigrate")(JSON.parse(JSON.stringify(state)));
  assert.equal(kept.ok, true, kept.errors && kept.errors.join("; "));
  ["projectOffline", "projectOverclock", "forgieOfflineBoost", "ocMaxLevel", "ocRateLevel", "ocStoredMin"]
    .forEach(key => assert.deepEqual(kept.state[key], state[key], key));
  const absent = JSON.parse(JSON.stringify(state));
  ["projectOffline", "projectOverclock", "forgieOfflineBoost", "ocMaxLevel", "ocRateLevel", "ocStoredMin"].forEach(key => delete absent[key]);
  const older = api("validateAndMigrate")(absent);
  assert.equal(older.ok, true, "a save from before offline crafting still loads");
  assert.equal(older.state.projectOffline, false);
  assert.equal(older.state.forgieOfflineBoost, 0);
  const bad = JSON.parse(JSON.stringify(state));bad.forgieOfflineBoost = 21;
  const rejected = api("validateAndMigrate")(bad);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some(error => /forgieOfflineBoost/.test(error)), rejected.errors.join("; "));
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn();console.log(`ok - ${name}`); }
  catch (error) { failed++;console.error(`not ok - ${name}`);console.error(error.stack || error); }
}
if (failed) {
  console.error(`\n${failed} offline-crafting test(s) failed`);
  process.exitCode = 1;
} else console.log(`\n${tests.length} offline-crafting tests passed`);
