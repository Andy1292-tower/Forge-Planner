"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* Quantities have no magnitude ceiling — issue #142.
 *
 * A player reported that a Battery sell value above e100 would not go in. The cap was real, but the
 * cap was not the whole problem: this is an incremental game, so every player-facing quantity grows
 * without bound, and float64 stops at 1.797e308 whatever the cap says. Worse, the DERIVED value
 * overflows first — credits = out x price went to Infinity while the price was still finite, and an
 * Infinity ranks, sorts and prints as an em-dash rather than raising anything.
 *
 * So the guarantees under test are:
 *
 *   1. the reported case, and everything past it, parses;
 *   2. no solve turns a finite input into a non-finite output, at any price magnitude;
 *   3. an ordinary number survives the round trip EXACTLY — the trap that ruled out
 *      break_infinity.js, which renders 123456789 as 123456788.99999999;
 *   4. a quantity survives every boundary it crosses: save, Worker, daily solve cache, display;
 *   5. a v4 save (quantities as floats) migrates to v5 (quantities as canonical strings);
 *   6. a free supply larger than the factory could ever consume does not change the plan.
 *
 * Usage: node test/unbounded-quantities.cjs
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { virtualClock } = require("./virtual-clock.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCES = [
  "js/decimal.js", "js/catalog.js", "js/core.js", "js/fields.js",
  "js/state.js", "js/project-schedule.js", "js/solver.js",
];

function realm() {
  const context = vm.createContext({
    console,
    performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
    setTimeout, clearTimeout,
  });
  for (const file of SOURCES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
  }
  return context;
}

const context = realm();
const api = expression => vm.runInContext(expression, context);
const Dec = api("Decimal");

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "ok   " : "FAIL ") + name + (detail ? "  [" + detail + "]" : ""));
  if (!ok) failures++;
}

/* ---- 1. the reported case, and past it ---------------------------------------------------- */

{
  const parse = api("parseFieldDraft");
  const rule = api("FIELD_SCHEMA").sellPrice;
  // 1e100 was the old ceiling: it parsed, and the very next representable value did not.
  const cases = ["1e100", "1.5e100", "1e101", "3e120", "2.35e400", "1e5000", "9.9e9999"];
  const parsed = cases.map(raw => ({ raw, result: parse(rule, raw) }));
  check("every magnitude the old cap rejected now parses",
    parsed.every(entry => entry.result.status === "valid"),
    parsed.map(e => e.raw + "=" + e.result.status).join(" "));
  check("a parsed quantity keeps its exact magnitude",
    parsed.every(entry => String(entry.result.value) === new Dec(entry.raw).toString()),
    parsed.map(e => String(e.result.value)).slice(-3).join(" "));
  check("the rule states no upper bound rather than naming one it does not enforce",
    rule.max === undefined && !/to 1e/.test(parse(rule, "-1").message),
    parse(rule, "-1").message);
  // What still bounds the field: length, sign, and being a number at all.
  check("a quantity is still bounded by draft length, sign and syntax",
    parse(rule, "1".repeat(129)).status === "invalid" &&
    parse(rule, "-1").status === "invalid" &&
    parse(rule, "lots").status === "invalid" &&
    parse(rule, "0").status === "valid",
    "maxDraftLength=" + rule.maxDraftLength);
}

/* ---- 2. no finite input becomes a non-finite output ---------------------------------------- */

// Walk a solve result and report anything that is not a finite number and not a readable quantity.
function nonFinite(value, at, found, depth) {
  if (found.length > 6 || (depth || 0) > 8) return found;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) found.push(at + "=" + value);
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  if (value instanceof Dec) {
    if (!value.isFinite() || value.isNaN()) found.push(at + "=" + String(value));
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, i) => nonFinite(entry, at + "[" + i + "]", found, (depth || 0) + 1));
    return found;
  }
  for (const key of Object.keys(value)) nonFinite(value[key], at + "." + key, found, (depth || 0) + 1);
  return found;
}

{
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test/perf/fixtures/lategame-7line.json"), "utf8"));
  // The reference save already carries a Battery price of 2.35e96 and a Vespium income of 1e99.
  // Scaling the prices is what used to push `out x price` through the float64 ceiling.
  for (const exponent of [0, 300, 1000, 5000]) {
    const state = JSON.parse(JSON.stringify(fixture));
    state.mode = "credits";
    state.solveBudget = 400;
    context.__FIXTURE = state;
    context.__EXP = exponent;
    vm.runInContext(`
      S = normalize(__FIXTURE);
      if (__EXP > 0) Object.keys(S.sellPrice).forEach(item => {
        if (S.sellPrice[item]) S.sellPrice[item] = S.sellPrice[item].times(new Decimal("1e" + __EXP));
      });
    `, context);
    /* On the virtual clock, so the ranking this asserts is a function of the fixture and not of how
     * much search the machine got through in 400 real ms. Run on the wall clock it passes alone and
     * fails with the suite in parallel: Credits is anytime, and a starved refinement settles on a
     * different winner. The magnitudes under test here do not depend on the budget at all. */
    const clock = virtualClock();
    const result = api("optimize")({ now: clock.now, onCheckpoint: clock.onCheckpoint });
    const bad = nonFinite(result, "res", [], 0);
    const credits = result.credits;
    check("prices x1e" + exponent + ": the solve produces no non-finite value",
      bad.length === 0, bad.join(" ") || "clean");
    check("prices x1e" + exponent + ": credits stay an exact quantity, not Infinity",
      credits instanceof Dec && credits.isFinite() && credits.gt(0),
      String(credits));
    check("prices x1e" + exponent + ": the winner is still Batteries and the ranking still orders",
      result.bestItem === "Batteries" &&
      result.ranking.slice(0, 3).every((entry, i, rows) => i === 0 || rows[i - 1].credits.gte(entry.credits)),
      (result.ranking || []).slice(0, 3).map(r => r.item + "=" + api("disp")(r.credits)).join(" "));
  }
}

/* ---- 3. exactness on ordinary values -------------------------------------------------------- */

{
  const parse = api("parseFieldDraft");
  const format = api("formatFieldValue");
  const rule = api("FIELD_SCHEMA").sellPrice;
  /* These are the values that ruled out break_infinity.js. It stores {mantissa, exponent} as two
   * floats, so 123456789 comes back as 123456788.99999999 — its own source notes the round trip
   * "starts failing at 800002". A planner shows players the number they typed. */
  const exact = ["1", "116", "800002", "123456789", "999999999999999", "1234.5", "0.000001"];
  const trips = exact.map(raw => ({ raw, back: String(parse(rule, raw).value) }));
  check("an ordinary number survives parsing byte for byte",
    trips.every(t => t.back === t.raw),
    trips.filter(t => t.back !== t.raw).map(t => t.raw + "->" + t.back).join(" ") || "all exact");
  check("an ordinary number survives redisplay byte for byte",
    exact.every(raw => {
      const shown = format(rule, parse(rule, raw).value);
      return String(parse(rule, shown).value) === raw;
    }),
    exact.map(raw => format(rule, parse(rule, raw).value)).join(" "));
  // Game suffixes are exact too: 500d was 4.9999999999999995e35 while quantities were floats.
  check("a game suffix resolves exactly",
    String(parse(rule, "500d").value) === new Dec("5e35").toString() &&
    String(parse(rule, "2.5qa").value) === "2500000000000000",
    String(parse(rule, "500d").value));
}

/* ---- 4. every boundary a quantity crosses --------------------------------------------------- */

{
  const typed = "2.35e400";
  vm.runInContext(`
    S = normalize(defaults());
    S.mode = "credits";
    setMinedIncome("Vespium", "rigPerMin", "1e99");
    S.priceText.Batteries = ${JSON.stringify(typed)};
    S.sellPrice.Batteries = parseGameNum(${JSON.stringify(typed)});
    // Price something the default factory can actually make, so the credits below are a real number
    // past the float64 ceiling rather than the zero an unmakeable item would leave.
    S.sellPrice.Ingots = parseGameNum("5e305");
    S.schemaVersion = CURRENT_SCHEMA_VERSION;
  `, context);

  const saved = api("validateAndMigrate")(api("S"));
  check("the save accepts a quantity past the float64 ceiling",
    saved.ok, (saved.errors || []).join("; ") || "ok");
  check("the save is schema v5 and writes the quantity as its canonical string",
    saved.state.schemaVersion === 5 && saved.state.sellPrice.Batteries instanceof Dec,
    "schema=" + saved.state.schemaVersion);

  // localStorage: JSON is the wire, and decimal.js supplies toJSON.
  const wire = JSON.parse(JSON.stringify(saved.state));
  check("JSON carries the quantity as a string, not as library internals",
    wire.sellPrice.Batteries === "2.35e+400",
    JSON.stringify(wire.sellPrice.Batteries));
  const reloaded = api("validateAndMigrate")(wire);
  check("reloading revives it as an exact quantity",
    reloaded.ok && reloaded.state.sellPrice.Batteries.eq(new Dec(typed)),
    String(reloaded.state && reloaded.state.sellPrice.Batteries));
  check("the typed text is preserved beside the value",
    reloaded.state.priceText.Batteries === typed, reloaded.state.priceText.Batteries);

  /* The Worker: a decimal.js instance owns a `constructor` property, so structuredClone REJECTS it.
   * That is why js/solver.worker.v2.js serialises before posting — assert the reason, so nobody
   * "simplifies" the serialisation away and gets a DataCloneError only in a real browser. */
  let cloneFailed = false;
  try { structuredClone({ q: new Dec(typed) }); } catch (error) { cloneFailed = true; }
  check("a raw Decimal cannot cross structuredClone, so the Worker must serialise",
    cloneFailed, cloneFailed ? "structuredClone rejects it" : "clone unexpectedly succeeded");
  const workerSource = fs.readFileSync(path.join(ROOT, "js", "solver.worker.v2.js"), "utf8");
  check("the Worker serialises its result before postMessage",
    /JSON\.parse\(JSON\.stringify\(res\)\)/.test(workerSource) &&
    /postMessage\(\{[^}]*res: payload/.test(workerSource),
    "solver.worker.v2.js");
  check("the Worker imports the quantity type ahead of everything that uses it",
    /importScripts\("decimal\.js",\s*"core\.js"/.test(workerSource), "importScripts order");

  // The daily solve cache round-trips the result through JSON as well.
  const result = api("optimize")();
  const cached = JSON.parse(JSON.stringify(result));
  // The value has to be past the float64 ceiling for this to test anything: 5e305 x an Ingot rate
  // is exactly the product that used to become Infinity on the way to the readout.
  check("the cache scenario actually exceeds the float64 ceiling",
    result.credits instanceof Dec && result.credits.gt(new Dec("1.8e308")),
    String(result.credits));
  check("a solve result survives the daily cache's JSON round trip",
    api("toDec")(cached.credits) !== null && api("toDec")(cached.credits).eq(result.credits),
    String(cached.credits));
  check("display reads a cached quantity without an em-dash",
    api("disp")(cached.credits) !== "—" && api("disp")(cached.credits) === api("disp")(result.credits),
    api("disp")(cached.credits));
}

/* ---- 5. v4 -> v5 migration ------------------------------------------------------------------ */

{
  const legacy = JSON.parse(JSON.stringify(JSON.parse(JSON.stringify(api("validateAndMigrate")(api("normalize(defaults())")).state))));
  legacy.schemaVersion = 4;
  // v4 stored quantities as floats.
  legacy.sellPrice.Frames = 1.25e30;
  legacy.priceText.Frames = "1.25n";
  legacy.forgie.Ingots = 345500000;
  legacy.inventory.Bits = 1390000000;
  legacy.minedIncome.Vespium.rigPerMin = 1e99;
  Object.keys(legacy.prodCost).forEach(product => Object.keys(legacy.prodCost[product]).forEach(input =>
    Object.keys(legacy.prodCost[product][input]).forEach(level => {
      legacy.prodCost[product][input][level] = Number(legacy.prodCost[product][input][level]);
    })));

  const migrated = api("validateAndMigrate")(legacy);
  check("a v4 save migrates without error", migrated.ok, (migrated.errors || []).slice(0, 4).join("; ") || "ok");
  check("v4 migrates to v5", migrated.state.schemaVersion === 5, String(migrated.state.schemaVersion));
  check("v4 float quantities become exact quantities",
    migrated.state.sellPrice.Frames.eq(new Dec("1.25e30")) &&
    migrated.state.forgie.Ingots.eq(345500000) &&
    migrated.state.inventory.Bits.eq(1390000000) &&
    migrated.state.minedIncome.Vespium.rigPerMin.eq(new Dec("1e99")),
    String(migrated.state.sellPrice.Frames));
  check("v4 display text is carried across untouched",
    migrated.state.priceText.Frames === "1.25n", migrated.state.priceText.Frames);
}

/* ---- 6. a supply nothing can consume does not change the plan -------------------------------- */

{
  /* The reference save's Vespium income is 6.0e100/hr against a factory that could burn at most
   * ~4.8e23/hr. solveCore caps a free supply at that consumption ceiling before it reaches the
   * Float64Arrays the search evaluates in — the cap is only sound if it cannot bind, so raising the
   * income far beyond it must leave the plan identical. */
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "test/perf/fixtures/lategame-7line.json"), "utf8"));
  const solveWith = income => {
    const state = JSON.parse(JSON.stringify(fixture));
    state.mode = "items";
    state.solveBudget = 400;
    state.minedIncome.Vespium.rigPerMin = income;
    context.__FIXTURE = state;
    vm.runInContext("S = normalize(__FIXTURE);", context);
    const result = api("optimize")();
    return { objective: result.objective, out: JSON.stringify(result.out) };
  };
  const atCap = solveWith("1e99");
  const wayOver = solveWith("1e300");
  const absurd = solveWith("1e2000");
  check("a supply beyond what the factory can consume leaves the objective unchanged",
    atCap.objective === wayOver.objective && atCap.objective === absurd.objective,
    [atCap.objective, wayOver.objective, absurd.objective].join(" | "));
  check("...and leaves the outputs unchanged",
    atCap.out === wayOver.out && atCap.out === absurd.out,
    atCap.out === wayOver.out ? "identical" : atCap.out + " vs " + wayOver.out);
}

/* ---- 7. the ways an unbounded quantity can still corrupt a float path ------------------------ */

{
  /* Each of these was a real defect found reviewing this change. They share one shape: a quantity
   * too large for a float64 slipping into a float expression that has no way to say so. */

  // (a) A recipe cost no float can hold makes recipeRate return null, and null * speed * 3600 is 0 —
  //     which would schedule the craft as consuming nothing and hand out free output.
  const rate = api("recipeRate");
  check("an uncountable recipe cost yields null, never a zero rate",
    rate("1e309", 1) === null && rate("1e5000", 1) === null && rate(new Dec("1e400"), 1) === null,
    "1e309 -> " + rate("1e309", 1));
  check("...and a real cost still divides exactly as a float",
    rate(new Dec("478296900000"), 2) === 478296900000 / 2, String(rate(new Dec("478296900000"), 2)));

  vm.runInContext(`
    S = normalize(defaults());
    S.mode = "project";
    S.lines = [{max:64,spx:20,turbo:0},{max:64,spx:18,turbo:0}];
    LEVELS.forEach(L => { S.prodCost.Glass.Bits[L] = parseGameNum("1e400"); });
    S.projects = [{id:"g",name:"Glass job",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Glass",qty:parseGameNum("5000")}]}]}];
    normalize(S); syncManual(S);
  `, context);
  const freeCraft = api("optimize")();
  const glassEntries = ((freeCraft.phases || [])[0] || {}).plan || [];
  const craftsGlass = glassEntries.some(line => (line.entries || []).some(e => e.item === "Glass"));
  check("a craft whose input cost cannot be counted is not scheduled as free",
    !craftsGlass && !freeCraft.feasible,
    "craftsGlass=" + craftsGlass + " feasible=" + freeCraft.feasible);

  // (b) Drawable stock past the float ceiling must not become an infinite LP coefficient.
  const coefficient = api("finiteCoefficient");
  check("an LP coefficient saturates instead of overflowing to Infinity",
    Number.isFinite(coefficient(new Dec("1e400"))) &&
    Number.isFinite(coefficient(new Dec("-1e400"))) &&
    coefficient(new Dec("-1e400")) < 0 && coefficient(new Dec("12.5")) === 12.5,
    coefficient(new Dec("1e400")) + " / " + coefficient(new Dec("-1e400")));

  // (c) A passive-output candidate with a colossal Forgie rate must still rank, not print an em-dash.
  vm.runInContext(`
    S = normalize(defaults());
    S.mode = "credits";
    S.forgie.Glass = parseGameNum("1e400");
    RECIPE.Glass.inputs.forEach(input => LEVELS.forEach(L => { S.prodCost.Glass[input][L] = null; }));
    S.sellPrice.Glass = parseGameNum("1e400");
  `, context);
  const passive = api("optimize")();
  const glass = (passive.ranking || []).find(entry => entry.item === "Glass");
  check("a colossal passive supply still produces finite, displayable credits",
    glass && glass.credits instanceof Dec && glass.credits.isFinite() && glass.credits.gt(0) &&
    api("disp")(glass.credits) !== "—",
    glass ? api("disp")(glass.credits) : "(no Glass candidate)");

  // (d) The supply cap is only sound for a resource nothing produces and nothing can target.
  //     Capping an ordinary item's supply would under-report it as an output.
  const targetOut = supply => {
    context.__SUPPLY = supply;
    vm.runInContext(`
      S = normalize(defaults());
      S.mode = "items";
      S.solveBudget = 400;
      ALLITEMS.forEach(item => { S.targets[item].on = (item === "Rods"); });
      S.forgie.Rods = parseGameNum(__SUPPLY);
    `, context);
    return api("optimize")().out.Rods;
  };
  const modest = targetOut("1000");
  const colossal = targetOut("1e9");
  check("a passive supply of a TARGET is reported in full, not capped at what the factory consumes",
    colossal > modest && colossal >= 1e9,
    "forgie 1e3 -> " + modest + " | forgie 1e9 -> " + colossal);
}

console.log("");
console.log(failures ? failures + " unbounded-quantity test(s) failed" : "all unbounded-quantity tests passed");
process.exit(failures ? 1 : 0);
