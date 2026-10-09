"use strict";

/* Game loadout codes — the text the game's crafter screen exports for a loadout, and reads back.
 *
 *   name-icon-c1-c2-c3-c4-c5-c6-c7-c8      ingots-7-adaj-adaj-adah-adag-adaf-adae-aaaa-aaaa
 *
 * Each crafter is a two-character recipe id then a two-character compression level. The game dev's
 * example above is the fixture everything else hangs off: six crafters on Vespium Ingots at levels
 * 9, 9, 7, 6, 5 and 4. Crafter k is planner line k, in every direction. */

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
for (const file of ["js/decimal.js", "js/catalog.js", "js/core.js", "js/fields.js", "js/state.js", "js/loadout-code.js"]) {
  const filename = path.join(ROOT, file);
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
}
const api = expression => vm.runInContext(expression, context);
const call = (name, ...args) => api(name)(...args);
// Objects built inside the vm carry its prototypes, which deepEqual tells apart from literals here.
const plain = value => JSON.parse(JSON.stringify(value));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const EXAMPLE = "ingots-7-adaj-adaj-adah-adag-adaf-adae-aaaa-aaaa";

/* ---- the code itself ---- */

test("the game dev's example decodes to six Ingots crafters and re-encodes byte for byte", () => {
  const parsed = call("parseLoadoutCode", EXAMPLE);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, "ingots");
  assert.equal(parsed.icon, 7);
  assert.deepEqual(plain(parsed.slots),
    [512, 512, 128, 64, 32, 16].map(lvl => ({ item: "Ingots", lvl })).concat([null, null]));
  assert.deepEqual(plain(parsed.unmodelled), []);
  assert.equal(call("encodeLoadoutCode", { name: "ingots", icon: 7, slots: parsed.slots }), EXAMPLE);
});

test("recipe ids and icons are the game's, entry by entry", () => {
  assert.deepEqual(plain(api("LOADOUT_RECIPE_IDS")), {
    Bits: 1, Concrete: 2, Ingots: 3, Plates: 4, Rods: 5, Glass: 6, Bricks: 7, Gel: 8,
    Batteries: 9, "Reinforced Concrete": 10, Wire: 11, Frames: 12
  });
  assert.deepEqual(plain(api("LOADOUT_ICONS")), ["Bits", "Concrete", "Glass", "Bricks", "Gel",
    "Reinforced Concrete", "Batteries", "Ingots", "Plates", "Rods", "Frames", "Wire"]);
  for (const item of api("ALLITEMS")) {
    assert.ok(api("LOADOUT_RECIPE_IDS")[item] > 0, item + " has a recipe id");
    assert.ok(api("LOADOUT_ICONS").includes(item), item + " has an icon");
  }
});

test("every planner item at every planner level round-trips", () => {
  for (const item of api("ALLITEMS")) for (const lvl of api("LEVELS")) {
    const code = call("encodeLoadoutCode", { name: "x", icon: 0, slots: [{ item, lvl }] });
    assert.deepEqual(plain(call("parseLoadoutCode", code).slots[0]), { item, lvl }, item + "@" + lvl);
  }
});

test("level 0 is 1×, and only a zero recipe makes a crafter empty", () => {
  const slots = call("parseLoadoutCode", "x-0-adaa-aaaj-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa").slots;
  assert.deepEqual(plain(slots[0]), { item: "Ingots", lvl: 1 });
  assert.equal(slots[1], null);
});

test("a hyphenated name, padding whitespace and spaced separators still parse", () => {
  const parsed = call("parseLoadoutCode", "  my-ingots - 7 -adaj-adaj-adah-adag-adaf-adae-aaaa-aaaa\n");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.name, "my-ingots ");
  assert.equal(parsed.icon, 7);
  assert.equal(plain(parsed.slots).filter(Boolean).length, 6);
});

test("malformed codes are rejected with a reason", () => {
  for (const [text, pattern] of [
    ["", /Paste/],
    ["hello", /name, an icon number and 8 crafters/],
    ["x-7-adaj-adaj-adaj", /8 crafters/],
    ["x-q-adaj-adaj-adah-adag-adaf-adae-aaaa-aaaa", /icon/],
    ["x-7-adaj-adaj-adah-adag-adaf-adae-aaaa-aaa", /Crafter 8/],
    ["x-7-ad!j-adaj-adah-adag-adaf-adae-aaaa-aaaa", /Crafter 1/],
    ["x".repeat(300), /too long/],
    ["a-7-adaj-adaj-adah-adag-adaf-adae-aaaa-aaaab-11-alae-alae-alae-alae-aaaa-aaaa-aaaa-aaaa", /more than one loadout code/],
    ["a-7-adaj-adaj-adah-adag-adaf-adae-aaaa-aaaa b-11-alae-alae-alae-alae-aaaa-aaaa-aaaa-aaaa", /more than one loadout code/]
  ]) {
    const parsed = call("parseLoadoutCode", text);
    assert.equal(parsed.ok, false, JSON.stringify(text));
    assert.match(parsed.error, pattern, JSON.stringify(text));
  }
});

test("recipes and levels the planner does not model become empty crafters, each reported", () => {
  const parsed = call("parseLoadoutCode", "x-0-anaj-auaj-baaj-adar-adba-adaj-aaaa-aaaa");
  assert.equal(parsed.ok, true);
  assert.deepEqual(plain(parsed.slots), [null, null, null, null, null, { item: "Ingots", lvl: 512 }, null, null]);
  assert.deepEqual(plain(parsed.unmodelled), [
    { crafter: 1, kind: "recipe", recipe: 13, label: "Pipes", level: null },
    { crafter: 2, kind: "recipe", recipe: 20, label: null, level: null },
    { crafter: 3, kind: "recipe", recipe: null, label: null, level: null },
    { crafter: 4, kind: "level", recipe: 3, label: null, level: 17 },
    { crafter: 5, kind: "level", recipe: 3, label: null, level: null }
  ]);
});

test("names lose hyphens and control characters and are cut to 16 without splitting a character", () => {
  assert.equal(call("loadoutName", "Max-Wire"), "Max Wire");
  assert.equal(call("loadoutName", " a\u0007b \t c "), "ab c");
  assert.equal(call("loadoutName", "Reinforced Concrete"), "Reinforced Concr");
  assert.equal(call("loadoutName", "a".repeat(15) + "\u{1F600}"), "a".repeat(15));
  assert.equal(call("loadoutName", null), "");
});

test("encoding pads to eight crafters, ignores extras, and repairs a blank name or a bad icon", () => {
  assert.equal(call("encodeLoadoutCode", { name: " - ", icon: 99, slots: [] }),
    "Loadout-0-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa");
  const nine = Array.from({ length: 9 }, () => ({ item: "Wire", lvl: 2 }));
  assert.equal(call("encodeLoadoutCode", { name: "w", icon: 11, slots: nine }), "w-11-" + Array(8).fill("alab").join("-"));
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log(`ok - ${name}`); }
  catch (error) { failed++; console.error(`not ok - ${name}`); console.error(error.stack || error); }
}
if (failed) {
  console.error(`\n${failed} loadout-code test(s) failed`);
  process.exitCode = 1;
} else console.log(`\n${tests.length} loadout-code tests passed`);
