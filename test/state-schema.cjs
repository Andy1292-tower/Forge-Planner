"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const context = vm.createContext({
  console,
  performance: { now: () => 0 },
  setTimeout,
  clearTimeout,
});

for (const file of ["js/catalog.js", "js/core.js", "js/fields.js", "js/state.js"]) {
  const filename = path.join(ROOT, file);
  try {
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  } catch (error) {
    context.__stateLoadError = error;
    break;
  }
}

function api(expression) {
  if (context.__stateLoadError) throw context.__stateLoadError;
  return vm.runInContext(expression, context);
}

function currentState() {
  const state = api("normalize(defaults())");
  state.schemaVersion = api("CURRENT_SCHEMA_VERSION");
  state.baseTimeRev = 2;
  return state;
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "state", name), "utf8"));
}

function storageWith(entries = {}, failSet) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (failSet && failSet(key, String(value))) throw new Error("storage write failed");
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
    value(key) { return values.has(key) ? values.get(key) : null; },
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("exports a current schema and pure field descriptors", () => {
  assert.equal(api("CURRENT_SCHEMA_VERSION"), 2);
  const schema = api("FIELD_SCHEMA");
  assert.equal(schema.dupe.type, "number");
  assert.equal(schema.dupe.min, 0);
  assert.equal(schema.dupe.max, 100);
  assert.equal(schema.projectName.type, "string");
  assert.equal(schema.projectName.maxLength, 256);
  assert.equal(schema.id.maxLength, 64);
  assert.equal(schema.timestamp.type, "number");
  assert.equal(schema.timestamp.allowBlank, true);
  assert.deepEqual(Array.from(schema.projectStability.values), ["prefer-current", "reoptimize"]);
});

test("v2 requires an exact Project line-job policy", () => {
  const missing = currentState();
  delete missing.projectStability;
  let result = api("validateAndMigrate")(missing);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /projectStability.*required/i);

  const invalid = currentState();
  invalid.projectStability = "fastest";
  result = api("validateAndMigrate")(invalid);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /projectStability.*supported values/i);

  const valid = currentState();
  valid.projectStability = "reoptimize";
  result = api("validateAndMigrate")(valid);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.state.projectStability, "reoptimize");
});

test("strict v1 migration defaults Project line jobs without weakening old required fields", () => {
  const v1 = currentState();
  v1.schemaVersion = 1;
  delete v1.projectStability;
  let result = api("validateAndMigrate")(v1);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.sourceVersion, 1);
  assert.equal(result.state.schemaVersion, 2);
  assert.equal(result.state.projectStability, "prefer-current");

  delete v1.targets;
  result = api("validateAndMigrate")(v1);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /targets.*required/i);
});

test("legacy duplicate project IDs migrate deterministically while v2 duplicates are rejected", () => {
  const project = id => ({
    id, name: "Same name", on: true, prio: null, from: 1, to: 1, done: 0,
    levels: [{ costs: [] }],
  });
  const legacy = currentState();
  legacy.schemaVersion = 1;
  delete legacy.projectStability;
  legacy.projects = [project("repeat"), project("repeat"), project("legacy-project-2")];
  const first = api("validateAndMigrate")(legacy);
  const second = api("validateAndMigrate")(legacy);
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  const ids = first.state.projects.map(entry => entry.id);
  assert.equal(ids[0], "repeat");
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, second.state.projects.map(entry => entry.id));

  const current = currentState();
  current.projectStability = "prefer-current";
  current.projects = [project("repeat"), project("repeat")];
  const rejected = api("validateAndMigrate")(current);
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join(" "), /projects\[1\]\.id.*unique/i);
});

test("rejects unsafe imported IDs and a non-numeric plan start", () => {
  const candidate = currentState();
  candidate.projects = [{
    id: "unsafe project id", name: "Project", on: true, prio: null,
    from: 1, to: 1, done: 0, levels: [{ costs: [] }],
  }];
  candidate.manualSaved = [{ id: "x\"><img", name: "Setup", config: candidate.manual.map(entry => ({ ...entry })) }];
  candidate.manualActiveId = "x\"><img";
  candidate.planStart = "now";

  const result = api("validateAndMigrate")(candidate);

  assert.equal(result.ok, false);
  const errors = result.errors.join(" ");
  assert.match(errors, /projects\[0\]\.id.*safe ID format/i);
  assert.match(errors, /manualSaved\[0\]\.id.*safe ID format/i);
  assert.match(errors, /manualActiveId.*safe ID format/i);
  assert.match(errors, /planStart.*finite number/i);
});

test("accepts a complete current state into a fresh object", () => {
  const candidate = currentState();
  candidate.lines[0].spx = 77.7;
  candidate.unknownRoot = "discard me";
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.sourceVersion, 2);
  assert.equal(result.state.lines[0].spx, 77.7);
  assert.equal(Object.hasOwn(result.state, "unknownRoot"), false);
  assert.notStrictEqual(result.state, candidate);
  assert.notStrictEqual(result.state.lines, candidate.lines);
  assert.equal(candidate.unknownRoot, "discard me");
});

for (const [label, candidate] of [
  ["JSON number", 1],
  ["JSON string", "save"],
  ["JSON boolean", true],
  ["JSON null", null],
  ["JSON array", []],
]) {
  test(`rejects a ${label} root`, () => {
    const result = api("validateAndMigrate")(candidate);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /plain object/i);
  });
}

test("rejects wrong nested container types", () => {
  const candidate = currentState();
  candidate.lines = {};
  candidate.prodCost = [];
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /lines/i);
  assert.match(result.errors.join(" "), /prodCost/i);
});

test("rejects missing fields from a versioned current save", () => {
  const candidate = currentState();
  delete candidate.targets;
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /targets.*required/i);
});

test("rejects missing nested fields from a versioned current save", () => {
  const candidate = currentState();
  candidate.projects = [{ id: "p1", on: true, from: 1, to: 1, done: 0, prio: null, levels: [{ costs: [] }] }];
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /projects\[0\]\.name.*required/i);
});

test("rejects a truncated unversioned save instead of guessing its shape", () => {
  const candidate = fixture("legacy-per-line-dupe.json");
  delete candidate.baseTime;
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, false);
});

test("rejects malformed targets", () => {
  const candidate = currentState();
  candidate.targets.Frames = { on: "yes", w: 99 };
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /targets\.Frames\.on/i);
  assert.match(result.errors.join(" "), /targets\.Frames\.w/i);
});

test("rejects a current project range with from after to instead of silently rewriting it", () => {
  const candidate = currentState();
  candidate.projects = [{
    id: "bad-range", name: "Bad range", on: true, prio: null,
    from: 2, to: 1, done: 0,
    levels: [{ costs: [] }, { costs: [] }],
  }];

  const result = api("validateAndMigrate")(candidate);

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /projects\[0\].*from.*to/i);
});

test("rejects unknown line and Manual compression levels", () => {
  const candidate = currentState();
  candidate.lines[0].max = 3;
  candidate.manual = [{ job: "Frames", lvl: 3, sell: false }];
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /lines\[0\]\.max/i);
  assert.match(result.errors.join(" "), /manual\[0\]\.lvl/i);
});

test("rejects a current Manual level above its line cap instead of silently clamping it", () => {
  const candidate = currentState();
  candidate.lines[0].max = 1;
  candidate.manual[0].lvl = 2;

  const result = api("validateAndMigrate")(candidate);

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /manual\[0\]\.lvl.*line cap/i);
});

test("rejects negative and non-finite-like numeric values", () => {
  const candidate = currentState();
  candidate.maxTurbo = -1;
  candidate.baseTime.Ingots = "Infinity";
  candidate.sellPrice.Frames = -5;
  candidate.inventory.Ingots = 1e101;
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /maxTurbo/i);
  assert.match(result.errors.join(" "), /baseTime\.Ingots/i);
  assert.match(result.errors.join(" "), /sellPrice\.Frames/i);
  assert.match(result.errors.join(" "), /inventory\.Ingots/i);
});

test("rejects future versions without guessing", () => {
  const candidate = currentState();
  candidate.schemaVersion = api("CURRENT_SCHEMA_VERSION") + 1;
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, false);
  assert.equal(result.sourceVersion, api("CURRENT_SCHEMA_VERSION") + 1);
  assert.match(result.errors.join(" "), /newer version/i);
});

test("rejects hostile depth and collection counts before normalization", () => {
  const deep = currentState();
  let cursor = deep;
  for (let i = 0; i < api("STATE_LIMITS.maxDepth") + 1; i++) cursor = cursor.deep = {};
  let result = api("validateAndMigrate")(deep);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /depth/i);

  const manyLines = currentState();
  manyLines.lines = Array.from({ length: api("STATE_LIMITS.maxLines") + 1 }, () => ({ max: 1, spx: 1, turbo: 0 }));
  result = api("validateAndMigrate")(manyLines);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /lines.*limit/i);
});

test("rejects project, level, cost, preset, and string limits", () => {
  const limits = api("STATE_LIMITS");
  const candidate = currentState();
  candidate.projects = Array.from({ length: limits.maxProjects + 1 }, (_, i) => ({
    id: `p${i}`, name: "P", on: true, prio: null, from: 1, to: 1, done: 0, levels: [{ costs: [] }],
  }));
  candidate.manualSaved = Array.from({ length: limits.maxPresets + 1 }, (_, i) => ({ id: `m${i}`, name: "M", config: [] }));
  candidate.priceText.Frames = "x".repeat(api("FIELD_SCHEMA.displayText.maxLength") + 1);
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, false);
  const errors = result.errors.join(" ");
  assert.match(errors, /projects.*limit/i);
  assert.match(errors, /manualSaved.*limit/i);
  assert.match(errors, /priceText\.Frames.*length/i);
});

test("parseStoredState returns defaults plus recovery without mutating rejected bytes", () => {
  const raw = "1";
  const result = api("parseStoredState")(raw);
  assert.equal(result.state.mode, "items");
  assert.equal(result.state.schemaVersion, api("CURRENT_SCHEMA_VERSION"));
  assert.equal(result.recovery.raw, raw);
  assert.match(result.recovery.reason, /plain object/i);
});

test("rejects an oversized raw save before JSON parsing", () => {
  const raw = "{" + "x".repeat(api("STATE_LIMITS.maxBytes")) + "}";
  const result = api("parseStoredState")(raw);
  assert.equal(result.recovery.raw, raw);
  assert.match(result.recovery.reason, /too large/i);
});

test("migrates per-line duplication fixture", () => {
  const result = api("validateAndMigrate")(fixture("legacy-per-line-dupe.json"));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.sourceVersion, 0);
  assert.equal(result.state.dupe, 17.25);
  assert.equal(Object.hasOwn(result.state.lines[0], "dup"), false);
});

test("migrates calculated duplication fixture", () => {
  const result = api("validateAndMigrate")(fixture("legacy-calculated-dupe.json"));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.state.dupe, 18);
  assert.equal(Object.hasOwn(result.state, "attrDupe"), false);
  assert.equal(Object.hasOwn(result.state, "trio4"), false);
});

test("preserves the established 60000 ms solve budget when migrating a pre-schema save", () => {
  const candidate = currentState();
  delete candidate.schemaVersion;
  candidate.solveBudget = 60000;

  const result = api("validateAndMigrate")(candidate);

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.state.solveBudget, 60000);
});

test("migrates old base-time defaults but preserves custom calibration", () => {
  const result = api("validateAndMigrate")(fixture("legacy-base-time.json"));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.state.baseTime.Ingots, 10);
  assert.equal(result.state.baseTime.Bits, 6.178);
  assert.equal(result.state.baseTime.Frames, 300.123);
  assert.equal(result.state.baseTimeRev, 2);
});

test("migrates retired Gel reservation fixture without retaining dead controls", () => {
  const result = api("validateAndMigrate")(fixture("legacy-gel-reservation.json"));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.state.lines[0].max, 1024);
  assert.equal(Object.hasOwn(result.state, "gelLines"), false);
  assert.equal(Object.hasOwn(result.state, "gelComp"), false);
  assert.equal(result.state.minedIncome.Vespium, null);
});

test("migrates Gel income, project first flag, and fills later compression costs", () => {
  const result = api("validateAndMigrate")(fixture("legacy-gel-vesp-project-first.json"));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.state.minedIncome.Vespium, 7.25e18);
  assert.equal(result.state.minedIncomeText.Vespium, "7.25qu");
  assert.equal(result.state.baseTime.Wire, 12345);
  assert.equal(result.state.prodCost.Wire.Gel[4], 18);
  assert.equal(result.state.prodCost.Wire.Gel[16384], api("defaults().prodCost.Wire.Gel[16384]"));
  assert.equal(result.state.projects[0].prio, 1);
  assert.equal(Object.hasOwn(result.state.projects[0], "first"), false);
});

test("repairs legacy project cursors that old normalize accepted instead of quarantining the build", () => {
  const candidate = currentState();
  delete candidate.schemaVersion;
  candidate.projects = [{
    id: "legacy-range", name: "Legacy range", on: true, prio: null,
    from: 99, to: 0, done: 999,
    levels: [{ costs: [] }, { costs: [] }],
  }, {
    id: "legacy-negative-done", name: "Legacy negative done", on: true, prio: null,
    from: 1, to: 2, done: -4,
    levels: [{ costs: [] }, { costs: [] }],
  }];

  const result = api("validateAndMigrate")(candidate);

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.sourceVersion, 0);
  assert.equal(result.state.projects[0].from, 2);
  assert.equal(result.state.projects[0].to, 2);
  assert.equal(result.state.projects[0].done, 1);
  assert.equal(result.state.projects[1].done, 0);
});

test("valid legacy validation never mutates the attacker-owned fixture", () => {
  const candidate = fixture("legacy-gel-vesp-project-first.json");
  const before = JSON.stringify(candidate);
  const result = api("validateAndMigrate")(candidate);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(JSON.stringify(candidate), before);
});

test("importState is a pure validation boundary", () => {
  const candidate = currentState();
  candidate.lines[0].spx = 88;
  const beforeGlobal = api("S");
  const result = api("importState")(candidate);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.state.lines[0].spx, 88);
  assert.strictEqual(api("S"), beforeGlobal);
});

test("reoptimize survives import, persisted reload, and reset returns prefer-current", () => {
  const storage = storageWith();
  context.localStorage = storage;
  api("commitState")(api("validateAndMigrate")(currentState()).state);

  const candidate = currentState();
  candidate.projectStability = "reoptimize";
  const imported = api("applyImportedState")(candidate, () => {});
  assert.equal(imported.ok, true, JSON.stringify(imported.errors));
  assert.equal(api("S.projectStability"), "reoptimize");
  assert.equal(JSON.parse(storage.value("forgePlannerState_v3")).projectStability, "reoptimize");

  api("commitState")(api("defaults")());
  const reloaded = api("initializeState")(() => {});
  assert.equal(reloaded.recovery, null);
  assert.equal(api("S.projectStability"), "reoptimize");

  api("commitState")(api("defaults")());
  assert.equal(api("S.projectStability"), "prefer-current");
  assert.equal(api("save")(), true);
  assert.equal(JSON.parse(storage.value("forgePlannerState_v3")).projectStability, "prefer-current");

  api("commitState")({});
  const resetReloaded = api("initializeState")(() => {});
  assert.equal(resetReloaded.recovery, null);
  assert.equal(api("S.projectStability"), "prefer-current");
});

test("validates Worker snapshots through the same boundary", () => {
  const candidate = currentState();
  candidate.lines[0].max = 3;
  const result = api("validateWorkerState")(candidate);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /lines\[0\]\.max/i);
});

test("successful boot upgrades the existing key and retains the exact previous-good bytes", () => {
  const legacyRaw = fs.readFileSync(path.join(__dirname, "fixtures", "state", "legacy-per-line-dupe.json"), "utf8");
  const storage = storageWith({ forgePlannerState_v3: legacyRaw });
  context.localStorage = storage;
  const result = api("initializeState")(() => {});
  assert.equal(result.recovery, null);
  assert.equal(storage.value("forgePlannerState_v3_previous_good"), legacyRaw);
  const upgraded = JSON.parse(storage.value("forgePlannerState_v3"));
  assert.equal(upgraded.schemaVersion, 2);
  assert.equal(upgraded.dupe, 17.25);
});

test("rejected boot bytes stay untouched while defaults render and quarantine remains downloadable", () => {
  const storage = storageWith({ forgePlannerState_v3: "1" });
  context.localStorage = storage;
  let renderedMode = null;
  const result = api("initializeState")(() => { renderedMode = api("S.mode"); });
  assert.equal(renderedMode, "items");
  assert.equal(result.recovery.raw, "1");
  assert.equal(storage.value("forgePlannerState_v3"), "1");
  assert.equal(storage.value("forgePlannerState_v3_rejected"), "1");
});

test("first-render failure rolls stored state back to defaults without changing persisted bytes", () => {
  const candidate = currentState();
  candidate.lines[0].spx = 91;
  const raw = JSON.stringify(candidate);
  const storage = storageWith({ forgePlannerState_v3: raw });
  context.localStorage = storage;
  let calls = 0;
  const result = api("initializeState")(() => {
    calls++;
    if (calls === 1) throw new Error("candidate render failed");
  });
  assert.equal(calls, 2);
  assert.match(result.recovery.reason, /candidate render failed/);
  assert.equal(api("S.lines[0].spx"), 49.38);
  assert.equal(storage.value("forgePlannerState_v3"), raw);
});

test("failed import render restores the previous global state and exact persisted bytes", () => {
  const previous = currentState();
  const previousRaw = JSON.stringify(previous);
  const storage = storageWith({ forgePlannerState_v3: previousRaw });
  context.localStorage = storage;
  api("commitState")(api("validateAndMigrate")(previous).state);
  const candidate = currentState();
  candidate.lines[0].spx = 99;
  let calls = 0;
  const result = api("applyImportedState")(candidate, () => {
    calls++;
    if (calls === 1) throw new Error("render failed");
  });
  assert.equal(result.ok, false);
  assert.equal(calls, 2);
  assert.equal(api("S.lines[0].spx"), 49.38);
  assert.equal(storage.value("forgePlannerState_v3"), previousRaw);
});

test("failed import render restores bytes even if the renderer saved before throwing", () => {
  const previous = currentState();
  const previousRaw = JSON.stringify(previous);
  const oldBackup = "original-backup";
  const storage = storageWith({
    forgePlannerState_v3: previousRaw,
    forgePlannerState_v3_previous_good: oldBackup,
  });
  context.localStorage = storage;
  api("commitState")(api("validateAndMigrate")(previous).state);
  const candidate = currentState();
  candidate.lines[0].spx = 100.5;
  let calls = 0;
  const result = api("applyImportedState")(candidate, () => {
    calls++;
    if (calls === 1) {
      assert.equal(api("save")(), true);
      throw new Error("renderer failed after saving");
    }
  });
  assert.equal(result.ok, false);
  assert.equal(storage.value("forgePlannerState_v3"), previousRaw);
  assert.equal(storage.value("forgePlannerState_v3_previous_good"), oldBackup);
});

test("storage failure leaves both current and previous-good keys byte-for-byte unchanged", () => {
  const previous = currentState();
  const previousRaw = JSON.stringify(previous);
  const oldBackup = "older-good-bytes";
  const storage = storageWith({
    forgePlannerState_v3: previousRaw,
    forgePlannerState_v3_previous_good: oldBackup,
  }, key => key === "forgePlannerState_v3");
  context.localStorage = storage;
  api("commitState")(api("validateAndMigrate")(previous).state);
  const candidate = currentState();
  candidate.lines[0].spx = 101;
  const result = api("applyImportedState")(candidate, () => {});
  assert.equal(result.ok, false);
  assert.equal(storage.value("forgePlannerState_v3"), previousRaw);
  assert.equal(storage.value("forgePlannerState_v3_previous_good"), oldBackup);
});

test("accepts every numeric descriptor boundary including an exact 60000 ms budget", () => {
  const candidate = currentState();
  candidate.lines[0] = { max: 16384, spx: 1e-6, turbo: 1e6 };
  candidate.maxTurbo = 1e6;
  candidate.dupe = 100;
  candidate.margin = 20;
  candidate.solveBudget = 60000;
  candidate.baseTime.Ingots = 1e-6;
  candidate.prodCost.Glass.Bits[1] = 1e100;
  candidate.sellPrice.Frames = 1e100;
  candidate.forgie.Frames = 0;
  candidate.minedIncome.Vespium = 1e100;
  candidate.inventory.Ingots = 0;
  candidate.targets.Frames.w = 9;
  candidate.projects = [{
    id: "numeric-boundaries", name: "Numeric boundaries", on: true, prio: 1e6,
    from: 1, to: 2, done: 2,
    levels: [{ costs: [{ item: "Frames", qty: 0 }] }, { costs: [{ item: "Glass", qty: 1e100 }] }],
  }];
  candidate.manual[0].lvl = 16384;

  const result = api("validateAndMigrate")(candidate);

  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.state.solveBudget, 60000);
  assert.equal(result.state.lines[0].spx, 1e-6);
  assert.equal(result.state.projects[0].levels[1].costs[0].qty, 1e100);
});

test("rejects representative numeric values beyond every live field family", () => {
  const cases = [
    ["line speed", state => { state.lines[0].spx = 1e-7; }],
    ["line turbo", state => { state.lines[0].turbo = 1e6 + 1; }],
    ["max turbo", state => { state.maxTurbo = 1e6 + 1; }],
    ["dupe", state => { state.dupe = 101; }],
    ["margin", state => { state.margin = 21; }],
    ["solve budget integer", state => { state.solveBudget = 2345.5; }],
    ["base time", state => { state.baseTime.Ingots = 0; }],
    ["recipe", state => { state.prodCost.Glass.Bits[1] = 1e101; }],
    ["price", state => { state.sellPrice.Frames = -1; }],
    ["Forgie", state => { state.forgie.Frames = 1e101; }],
    ["mined", state => { state.minedIncome.Hydracite = -1; }],
    ["inventory", state => { state.inventory.Ingots = 1e101; }],
    ["target", state => { state.targets.Frames.w = 1.5; }],
  ];
  for (const [label, mutate] of cases) {
    const candidate = currentState();
    mutate(candidate);
    const before = JSON.stringify(candidate);
    const result = api("validateAndMigrate")(candidate);
    assert.equal(result.ok, false, label);
    assert.equal(JSON.stringify(candidate), before, `${label} rejection mutated caller bytes`);
  }
});

test("invalid numeric import is transactional while historical display text stays independent", () => {
  const previous = currentState();
  previous.priceText.Frames = "old UI text can differ from 12.5";
  previous.sellPrice.Frames = 12.5;
  const previousRaw = JSON.stringify(previous);
  const storage = storageWith({ forgePlannerState_v3: previousRaw });
  context.localStorage = storage;
  api("commitState")(api("validateAndMigrate")(previous).state);

  const accepted = api("validateAndMigrate")(previous);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.errors));
  assert.equal(accepted.state.priceText.Frames, previous.priceText.Frames);
  assert.equal(accepted.state.sellPrice.Frames, 12.5);

  const invalid = currentState();
  invalid.solveBudget = 60001;
  invalid.projects = [{ id: "invalid-qty", name: "Invalid", on: true, prio: null, from: 1, to: 1, done: 0,
    levels: [{ costs: [{ item: "Frames", qty: -1 }] }] }];
  const result = api("applyImportedState")(invalid, () => {});
  assert.equal(result.ok, false);
  assert.equal(storage.value("forgePlannerState_v3"), previousRaw);
  assert.equal(api("S.sellPrice.Frames"), 12.5);
});

test("stateRevision changes only through the single commit hook", () => {
  const before = api("stateRevision");
  api("commitState")(api("validateAndMigrate")(currentState()).state);
  assert.equal(api("stateRevision"), before + 1);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}`);
    console.error(`     ${error && error.message || error}`);
  }
}

if (failed) {
  console.error(`\n${failed}/${tests.length} state-schema tests failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${tests.length} state-schema tests passed`);
}
