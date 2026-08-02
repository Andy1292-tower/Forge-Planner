"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const context = vm.createContext({ console, performance: { now: () => 0 }, setTimeout, clearTimeout });
for (const file of ["js/catalog.js", "js/core.js", "js/fields.js", "js/state.js", "js/dom.js"]) {
  const filename = path.join(ROOT, file);
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
}
const api = expression => vm.runInContext(expression, context);
const parse = (rule, raw, options) => api("parseFieldDraft")(rule, raw, options);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("exports the pure parser, validator, formatter, and attribute API", () => {
  for (const name of ["validateFieldValue", "parseFieldDraft", "formatFieldValue", "formatMillisecondsAsSeconds", "fieldInputAttributes"]) {
    assert.equal(api(`typeof ${name}`), "function", `${name} must be exported`);
  }
});

test("creates deterministic collision-free DOM tokens for distinct input strings", () => {
  const token = api("fieldDomToken");
  const values = [
    "ProjectA", "projecta", "Project A", "Project-A", "Project_A", "Project/A",
    "", "field", "é", "e\u0301", "😀", "\ud83d",
  ];
  const tokens = values.map(token);
  assert.equal(new Set(tokens).size, values.length, "every distinct string must own a distinct DOM token");
  values.forEach((value, index) => {
    assert.equal(token(value), tokens[index], `${JSON.stringify(value)} must be deterministic`);
    assert.match(tokens[index], /^[A-Za-z][A-Za-z0-9_-]*$/, `${JSON.stringify(value)} must remain selector-safe`);
  });
});

test("owns distinct numeric descriptors and the complete persisted ranges", () => {
  const schema = api("FIELD_SCHEMA");
  const expected = {
    lineSpeed: [1e-6, 1e9, false], turbo: [0, 1e6, false], maxTurbo: [0, 1e6, false],
    dupe: [0, 100, false], margin: [0, 20, false], solveBudget: [200, 60000, false],
    baseTime: [1e-6, 1e15, false], baseTimeRev: [0, 12, false],
    recipeCost: [0, 1e100, true], sellPrice: [0, 1e100, true],
    forgie: [0, 1e100, true], minedIncome: [0, 1e100, true],
    inventory: [0, 1e100, true], projectQuantity: [0, 1e100, true],
    targetWeight: [1, 9, false], projectIndex: [1, 1e6, false],
    projectPriority: [1, 1e6, true], calibrationSpeed: [1e-6, 1e9, false],
    calibrationSeconds: [1e-6, 1e15, false],
  };
  for (const [name, [min, max, allowBlank]] of Object.entries(expected)) {
    assert.ok(schema[name], `missing FIELD_SCHEMA.${name}`);
    assert.equal(schema[name].min, min, `${name}.min`);
    assert.equal(schema[name].max, max, `${name}.max`);
    assert.equal(schema[name].allowBlank, allowBlank, `${name}.allowBlank`);
  }
  assert.notStrictEqual(schema.sellPrice, schema.forgie);
  assert.notStrictEqual(schema.inventory, schema.projectQuantity);
  assert.equal(schema.baseTimeRev.defaultValue, 2, "save schema changes must not change the base-time revision");
});

test("fresh and reset state presents a 10-second solve budget", () => {
  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.equal(api("defaults().solveBudget"), 10000);
  assert.equal(api("normalize(defaults()).solveBudget"), 10000);
  assert.equal(api("FIELD_SCHEMA.solveBudget.defaultValue"), 10000);
  assert.match(index, /id="solveBudget"[^>]*aria-valuetext="10 s"/);
});

test("parses required and optional blank drafts without fallback coercion", () => {
  const required = api("FIELD_SCHEMA.lineSpeed");
  const optional = api("FIELD_SCHEMA.sellPrice");
  assert.deepEqual(parse(required, ""), {
    status: "invalid", message: "Enter line speed from 0.000001 to 1000000000.",
  });
  assert.deepEqual(parse(optional, "  "), { status: "blank", value: null });
  assert.deepEqual(parse(required, "", { badInput: true }), {
    status: "incomplete", message: "Finish entering line speed from 0.000001 to 1000000000.",
  });
});

test("parses decimal exponents and readable trailing decimals, but preserves partial edits", () => {
  const rule = api("FIELD_SCHEMA.lineSpeed");
  assert.deepEqual(parse(rule, "1.25e3"), { status: "valid", value: 1250 });
  assert.deepEqual(parse(rule, "2."), { status: "valid", value: 2 });
  for (const raw of ["+", "-", ".", "1e", "1e+", "1e-"]) {
    const result = parse(rule, raw);
    assert.equal(result.status, "incomplete", `${raw} should remain an incomplete draft`);
  }
});

test("parses game commas, suffix case, and exponents while distinguishing partial suffixes", () => {
  const rule = api("FIELD_SCHEMA.projectQuantity");
  assert.deepEqual(parse(rule, "1,234.5"), { status: "valid", value: 1234.5 });
  assert.deepEqual(parse(rule, "2.5QA"), { status: "valid", value: 2.5e15 });
  assert.deepEqual(parse(rule, "1.3e6"), { status: "valid", value: 1.3e6 });
  for (const raw of ["1q", "1s"]) assert.equal(parse(rule, raw).status, "incomplete");
  assert.equal(parse(rule, "1qq").status, "invalid");
  assert.equal(parse(rule, "1wat").status, "invalid");
});

test("rejects game-number drafts that cannot fit their persisted display text", () => {
  const rule = api("FIELD_SCHEMA.sellPrice");
  const tooLongButNumeric = "0".repeat(128) + "1";
  assert.equal(parse(rule, tooLongButNumeric).status, "invalid");
  assert.equal(api("fieldInputAttributes")(rule).maxlength, "128");
});

test("rejects syntax, negative, fractional integer, range, and overflow failures", () => {
  assert.equal(parse(api("FIELD_SCHEMA.lineSpeed"), "abc").status, "invalid");
  assert.equal(parse(api("FIELD_SCHEMA.sellPrice"), "-1").status, "invalid");
  assert.equal(parse(api("FIELD_SCHEMA.targetWeight"), "1.5").status, "invalid");
  assert.equal(parse(api("FIELD_SCHEMA.dupe"), "100.01").status, "invalid");
  assert.equal(parse(api("FIELD_SCHEMA.solveBudget"), "60001").status, "invalid");
  assert.equal(parse(api("FIELD_SCHEMA.projectQuantity"), "1e309").status, "invalid");
});

test("validates values through the same rule boundary used by parsing and state", () => {
  const validate = api("validateFieldValue");
  assert.deepEqual(validate(api("FIELD_SCHEMA.dupe"), 100), { valid: true, value: 100 });
  assert.equal(validate(api("FIELD_SCHEMA.dupe"), 101).valid, false);
  assert.equal(validate(api("FIELD_SCHEMA.targetWeight"), 1.25).valid, false);
  assert.deepEqual(validate(api("FIELD_SCHEMA.sellPrice"), null), { valid: true, value: null });
  assert.equal(validate(api("FIELD_SCHEMA.lineSpeed"), null).valid, false);
  const dynamic = api("({...FIELD_SCHEMA.projectIndex,max:3,label:'project ending level'})");
  assert.deepEqual(validate(dynamic, 3), { valid: true, value: 3 });
  assert.equal(validate(dynamic, 4).valid, false);
});

test("formats accepted values and derives matching HTML input attributes", () => {
  const format = api("formatFieldValue");
  const attrs = api("fieldInputAttributes");
  assert.equal(format(api("FIELD_SCHEMA.lineSpeed"), 1250), "1250");
  assert.equal(format(api("FIELD_SCHEMA.sellPrice"), 2.5e15), "2.5qa");
  assert.equal(format(api("FIELD_SCHEMA.sellPrice"), 1e-6), "0.000001",
    "feedback must not round a still-active tiny value down to zero");
  assert.equal(format(api("FIELD_SCHEMA.sellPrice"), 123456789), "123456789",
    "feedback must fall back to an exact decimal when compact notation changes the value");
  assert.equal(format(api("FIELD_SCHEMA.sellPrice"), null), "");
  assert.deepEqual({ ...attrs(api("FIELD_SCHEMA.dupe")) }, {
    min: "0", max: "100", step: "any", inputmode: "decimal",
  });
  assert.deepEqual({ ...attrs(api("FIELD_SCHEMA.targetWeight")) }, {
    min: "1", max: "9", step: "1", inputmode: "numeric",
  });
  assert.deepEqual({ ...attrs(api("FIELD_SCHEMA.sellPrice")) }, {
    min: "0", max: "1e+100", step: "any", inputmode: "decimal", maxlength: "128",
  });
});

test("formats integer milliseconds as exact trimmed seconds", () => {
  const format = api("formatMillisecondsAsSeconds");
  const rule = api("FIELD_SCHEMA.solveBudget");
  assert.equal(format(rule, 200), "0.2 s");
  assert.equal(format(rule, 1000), "1 s");
  assert.equal(format(rule, 2340), "2.34 s");
  assert.equal(format(rule, 2345), "2.345 s");
  assert.equal(format(rule, 60000), "60 s");
  assert.equal(format(rule, 2345.5), "");
  assert.equal(format(rule, 60001), "");
});

test("round-trips calibrated boundaries and accepts historical display text independently", () => {
  const validate = api("validateFieldValue");
  for (const [name, values] of Object.entries({
    lineSpeed: [1e-6, 49.38, 1e9], baseTime: [1e-6, 6.178, 1e15],
    solveBudget: [200, 2345, 60000], projectQuantity: [0, 1.234567890123456e99, 1e100],
  })) for (const value of values) {
    const checked = validate(api(`FIELD_SCHEMA.${name}`), value);
    assert.deepEqual(checked, { valid: true, value }, `${name} ${value}`);
  }

  const state = api("normalize(defaults())");
  state.schemaVersion = api("CURRENT_SCHEMA_VERSION");
  state.priceText.Frames = "historical text that never matched its numeric pair";
  state.sellPrice.Frames = 123;
  const result = api("validateAndMigrate")(state);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.state.priceText.Frames, state.priceText.Frames);
  assert.equal(result.state.sellPrice.Frames, 123);
});

test("state value validation rejects every representative numeric boundary transactionally", () => {
  const make = () => {
    const state = api("normalize(defaults())");
    state.schemaVersion = api("CURRENT_SCHEMA_VERSION");
    return state;
  };
  const cases = [
    state => { state.lines[0].spx = 0; },
    state => { state.lines[0].turbo = 1e6 + 1; },
    state => { state.maxTurbo = -1; },
    state => { state.dupe = 100.1; },
    state => { state.margin = 20.1; },
    state => { state.solveBudget = 60000.5; },
    state => { state.baseTime.Ingots = 0; },
    state => { state.prodCost.Glass.Bits[1] = -1; },
    state => { state.sellPrice.Frames = 1e101; },
    state => { state.forgie.Frames = -1; },
    state => { state.minedIncome.Vespium = 1e101; },
    state => { state.inventory.Ingots = -1; },
    state => { state.targets.Frames.w = 1.5; },
  ];
  for (const mutate of cases) {
    const state = make();
    mutate(state);
    const before = JSON.stringify(state);
    const result = api("validateAndMigrate")(state);
    assert.equal(result.ok, false, before);
    assert.equal(JSON.stringify(state), before, "validation must not rewrite rejected input");
  }
});

test("source contracts enforce parse-before-mutation and no invalid solve flush", () => {
  const events = fs.readFileSync(path.join(ROOT, "js/events.js"), "utf8");
  const dom = fs.readFileSync(path.join(ROOT, "js/dom.js"), "utf8");
  const render = fs.readFileSync(path.join(ROOT, "js/render.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css/styles.css"), "utf8");
  assert.match(events, /function commitFieldDraft\([^)]*\)[\s\S]*parseFieldDraft[\s\S]*mutateState/);
  assert.match(events, /function doSolve\(\)\{[^}]*persistNow\(\)===false[^}]*return false/);
  assert.match(events, /aria-invalid[^\n]*true/);
  assert.match(events, /data-pfrom[\s\S]*parseProjectRangeDrafts|parseProjectRangeDrafts[\s\S]*data-pfrom/);
  assert.match(events, /data-spfrom[\s\S]*parseProjectRangeDrafts|parseProjectRangeDrafts[\s\S]*data-spfrom/);
  assert.match(dom, /aria-live["']?,?[\s\S]*polite|setAttribute\(["']aria-live["'],["']polite["']\)/);
  assert.match(dom, /aria-describedby/);
  assert.match(render, /FIELD_SCHEMA\.lineSpeed/);
  for (const rule of ["margin", "targetWeight", "sellPrice", "forgie", "minedIncome", "inventory", "projectQuantity", "projectPriority"]) {
    const handler = new RegExp(`commitFieldDraft\\([^\\n]*FIELD_SCHEMA\\.${rule}[^\\n]*\\);[\\s\\S]{0,240}result\\.committed[^\\n]*save\\(\\)`);
    assert.match(events, handler, `${rule} must persist its accepted value immediately`);
  }
  assert.match(events, /const rule=d\.fld==="baseT"\?FIELD_SCHEMA\.baseTime:FIELD_SCHEMA\.recipeCost;[\s\S]{0,700}result\.committed\)\{save\(\)/,
    "base time and recipe costs must persist accepted values immediately");
  assert.doesNotMatch(css, /\.field-error:empty\s*\{[^}]*display\s*:\s*none/,
    "empty live regions must exist in the accessibility tree before their text changes");
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn();console.log(`ok - ${name}`); }
  catch (error) { failed++;console.error(`not ok - ${name}`);console.error(error.stack || error); }
}
if (failed) {
  console.error(`\n${failed} field-validation test(s) failed`);
  process.exitCode = 1;
} else console.log(`\n${tests.length} field-validation tests passed`);
