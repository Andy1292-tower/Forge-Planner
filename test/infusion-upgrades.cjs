"use strict";

/* Infusion Upgrades — Expansion Essentials VII and Dupe Day.
 *
 * EE7 halves every crafting cost, floored at 1 and rounded up, across the nine products the game
 * shipped it with. Dupe Day does not change any arithmetic at all: it lifts the ceiling off the
 * duplication field, and dupeMult() was already linear past 100%. Both default off.
 *
 * The recipe table is derived from these flags rather than typed. The ceiling and the floor act on
 * each input's 1x cost, and compression scales the rounded figure, so an odd 1x cost carries its
 * extra half unit up through every level. */

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
for (const file of ["js/decimal.js", "js/catalog.js", "js/core.js", "js/fields.js", "js/state.js"]) {
  const filename = path.join(ROOT, file);
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
}
const api = expression => vm.runInContext(expression, context);
const call = (name, ...args) => api(name)(...args);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const LEVELS = api("LEVELS");
const PRODUCTS = api("PRODUCTS");
const RECIPE = api("RECIPE");
const EE7_PRODUCTS = api("EE7_PRODUCTS");
const costs = flags => call("derivedProdCost", { infusion: flags });
const cost = (table, product, input, level) => table[product][input][level].toString();

test("both upgrades default to off — nothing changes until the player ticks a box", () => {
  const state = call("defaults");
  assert.deepEqual(state.infusion, { ee7: false, dupeDay: false });
});

test("EE7 halves a cost, rounding up and never dropping below 1", () => {
  const base = costs({ ee7: false });
  const ee7 = costs({ ee7: true });
  // Glass is 2 Bits at 1x: an exact halving.
  assert.equal(cost(base, "Glass", "Bits", 1), "2");
  assert.equal(cost(ee7, "Glass", "Bits", 1), "1");
  // Bricks are 3 Concrete at 1x: 1.5 rounds up to 2, it does not round to nearest.
  assert.equal(cost(base, "Bricks", "Concrete", 1), "3");
  assert.equal(cost(ee7, "Bricks", "Concrete", 1), "2");
  // A cost already at the floor stays there rather than going to zero.
  assert.equal(call("halveCraftingCost", 1).toString(), "1");
  assert.equal(call("halveCraftingCost", 2).toString(), "1");
  assert.equal(call("halveCraftingCost", 3).toString(), "2");
});

test("the round-up lands on the 1x cost, and compression scales the rounded figure", () => {
  /* Bricks are 3 Concrete at 1x, which EE7 rounds up to 2. Every compression level then costs
     3x the level below it, so Bricks at 1024x are 2 * 3^10 = 118098 Concrete, not
     ceil(177147 / 2) = 88574. */
  const base = costs({ ee7: false });
  const ee7 = costs({ ee7: true });
  assert.equal(cost(base, "Bricks", "Concrete", 2), "9");
  assert.equal(cost(ee7, "Bricks", "Concrete", 2), "6");
  assert.equal(cost(base, "Bricks", "Concrete", 512), "59049");
  assert.equal(cost(ee7, "Bricks", "Concrete", 512), "39366");
  assert.equal(cost(base, "Bricks", "Concrete", 1024), "177147");
  assert.equal(cost(ee7, "Bricks", "Concrete", 1024), "118098");
  assert.equal(cost(base, "Bricks", "Concrete", 65536), "129140163");
  assert.equal(cost(ee7, "Bricks", "Concrete", 65536), "86093442");
  // An even cost halves exactly, at any size.
  assert.equal(cost(base, "Plates", "Ingots", 16384), "9565938");
  assert.equal(cost(ee7, "Plates", "Ingots", 16384), "4782969");
  assert.equal(cost(base, "Plates", "Ingots", 65536), "86093442");
  assert.equal(cost(ee7, "Plates", "Ingots", 65536), "43046721");
});

test("EE7 covers every product and every compression level", () => {
  const base = costs({ ee7: false });
  const ee7 = costs({ ee7: true });
  const Decimal = api("Decimal");
  for (const product of PRODUCTS) {
    for (const input of RECIPE[product].inputs) {
      const unit = Decimal.max(1, Decimal(cost(base, product, input, 1)).div(2).ceil());
      for (const level of LEVELS) {
        const want = unit.times(Math.pow(3, Math.log2(level)));
        assert.equal(cost(ee7, product, input, level), want.toString(),
          `${product}/${input} at ${level}x`);
      }
    }
  }
});

test("the EE7 product list is frozen and does not silently track PRODUCTS", () => {
  assert.ok(Object.isFrozen(EE7_PRODUCTS), "EE7_PRODUCTS must be frozen");
  assert.deepEqual([...EE7_PRODUCTS].sort(), [...PRODUCTS].sort(),
    "today's products are all covered");
  assert.ok(!api("EE7_PRODUCTS === PRODUCTS"),
    "a product added to PRODUCTS later must not join the discount by itself");
});

test("deriving the table does not mutate the base curve", () => {
  const first = costs({ ee7: true });
  const second = costs({ ee7: false });
  assert.equal(cost(first, "Glass", "Bits", 1), "1");
  assert.equal(cost(second, "Glass", "Bits", 1), "2", "the untouched curve must survive a derive");
});

test("EE7 halves the mined costs behind Gel and Batteries", () => {
  const baseGel = call("minedCost", "Gel", 1, {});
  const ee7Gel = call("minedCost", "Gel", 1, { infusion: { ee7: true } });
  assert.equal(ee7Gel.Vespium, baseGel.Vespium / 2, "Vespium per Gel craft halves");
  assert.equal(ee7Gel.Rocks, baseGel.Rocks / 2, "the informational Rocks cost halves too");
  const baseBatt = call("minedCost", "Batteries", 65536, {});
  const ee7Batt = call("minedCost", "Batteries", 65536, { infusion: { ee7: true } });
  assert.equal(ee7Batt.Hydracite, baseBatt.Hydracite / 2, "Hydracite per Battery craft halves");
  assert.equal(typeof ee7Batt.Hydracite, "number", "mined costs stay float");
});

test("normalize derives the recipe table and discards whatever a save carried", () => {
  const state = call("defaults");
  state.prodCost = { Glass: { Bits: { 1: api("Decimal")(999) } } };
  state.infusion = { ee7: true, dupeDay: false };
  call("normalize", state);
  assert.equal(state.prodCost.Glass.Bits[1].toString(), "1",
    "a hand-typed cost is replaced by the derived one");
  assert.equal(state.prodCost.Plates.Ingots[512].toString(), "19683");
  for (const product of PRODUCTS) {
    for (const input of RECIPE[product].inputs) {
      for (const level of LEVELS) {
        assert.ok(state.prodCost[product][input][level] != null,
          `derived table is complete: ${product}/${input} at ${level}x`);
      }
    }
  }
});

test("normalize repairs a missing or malformed infusion block", () => {
  for (const bad of [undefined, null, "yes", [], { ee7: "true" }]) {
    const state = call("defaults");
    state.infusion = bad;
    call("normalize", state);
    assert.deepEqual(state.infusion, { ee7: false, dupeDay: false },
      `infusion: ${JSON.stringify(bad)} must normalize to both off`);
  }
  const on = call("defaults");
  on.infusion = { ee7: true, dupeDay: true };
  call("normalize", on);
  assert.deepEqual(on.infusion, { ee7: true, dupeDay: true });
});

test("dupeRule swaps the ceiling on Dupe Day, and only the ceiling", () => {
  const capped = call("dupeRule", { infusion: { dupeDay: false } });
  const uncapped = call("dupeRule", { infusion: { dupeDay: true } });
  assert.equal(capped.max, 100);
  assert.equal(uncapped.max, 1e6);
  assert.equal(capped.min, uncapped.min, "the floor is unchanged");
  assert.equal(capped.type, uncapped.type);
  assert.equal(call("dupeRule", {}).max, 100, "no flags means the capped rule");
  assert.equal(call("dupeRule", undefined).max, 100, "no state means the capped rule");
});

test("duplication above 100% is the plain average multiplier, needing no new arithmetic", () => {
  const multiplierAt = percent => {
    context.__probe = { dupe: percent, infusion: { ee7: false, dupeDay: true } };
    return vm.runInContext("S = __probe, dupeMult()", context);
  };
  // 100% is every craft duplicating. 150% is half the crafts rolling a third copy and half a
  // second, which averages 2.5 — the same 1 + chance/100 the planner already used.
  assert.equal(multiplierAt(0), 1);
  assert.equal(multiplierAt(100), 2);
  assert.equal(multiplierAt(150), 2.5);
  assert.equal(multiplierAt(240), 3.4);
});

test("a save may hold duplication above 100% only with Dupe Day on", () => {
  const saveWith = (dupe, infusion) => {
    const state = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/state/legacy-base-time.json"), "utf8"));
    state.dupe = dupe;
    state.infusion = infusion;
    return call("importState", state);
  };
  const off = saveWith(140, { ee7: false, dupeDay: false });
  assert.equal(off.ok, false, "140% must be rejected while Dupe Day is off");
  assert.ok(off.errors.some(error => /dupe/i.test(error)), `errors name the field: ${off.errors}`);

  const on = saveWith(140, { ee7: false, dupeDay: true });
  assert.equal(on.ok, true, `140% must be accepted with Dupe Day on: ${on.errors}`);
  assert.equal(on.state.dupe, 140);
  assert.deepEqual(on.state.infusion, { ee7: false, dupeDay: true });
});

test("turning Dupe Day off pulls an out-of-range duplication back to the ceiling", () => {
  const state = call("defaults");
  state.dupe = 140;
  state.infusion = { ee7: false, dupeDay: false };
  call("normalize", state);
  assert.equal(state.dupe, 100,
    "a value that outlived the upgrade must come back inside the ceiling, not sit there unsavable");
});

test("infusion survives a save round-trip, and its absence means off", () => {
  const legacy = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/state/legacy-base-time.json"), "utf8"));
  const loaded = call("importState", legacy);
  assert.equal(loaded.ok, true, `legacy save must still load: ${loaded.errors}`);
  assert.deepEqual(loaded.state.infusion, { ee7: false, dupeDay: false },
    "a save written before Infusion Upgrades existed reads as both off");
  assert.equal(loaded.state.prodCost.Glass.Bits[1].toString(), "2",
    "and its recipe costs come back as the derived curve");
});

test("the solve caches notice a flag flipping", () => {
  const solveService = fs.readFileSync(path.join(ROOT, "js/solve-service.js"), "utf8");
  const solver = fs.readFileSync(path.join(ROOT, "js/solver.js"), "utf8");
  assert.match(solveService, /infusion:\s*source\.infusion/,
    "dailySolveConditionKey must include the upgrade flags");
  assert.match(solver, /infusion:\s*src\.infusion/,
    "soloMaxKey must include the upgrade flags");
});

test("nothing writes a recipe cost back into state any more", () => {
  const render = fs.readFileSync(path.join(ROOT, "js/render.js"), "utf8");
  const state = fs.readFileSync(path.join(ROOT, "js/state.js"), "utf8");
  assert.doesNotMatch(render, /data-fld="cost"/,
    "the recipe grid renders values, not inputs");
  assert.doesNotMatch(state, /out\.prodCost\[/,
    "imports must not seed the derived table");
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn();console.log(`ok - ${name}`); }
  catch (error) { failed++;console.error(`not ok - ${name}`);console.error(error.stack || error); }
}
if (failed) {
  console.error(`\n${failed} infusion-upgrades test(s) failed`);
  process.exitCode = 1;
} else console.log(`\n${tests.length} infusion-upgrades tests passed`);
