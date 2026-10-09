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
for (const file of ["js/decimal.js", "js/catalog.js", "js/core.js", "js/fields.js", "js/state.js", "js/project-schedule.js",
  "js/solver.js", "js/loadout-code.js"]) {
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

/* ---- builds → crafter slots ---- */

const line = max => ({ max, spx: 1, turbo: 0 });

test("Manual setup: idle and unknown jobs are empty, and levels are held to the line cap", () => {
  const st = { lines: [line(512), line(128), line(64), line(32)],
    manual: [{ job: "Ingots", lvl: 512 }, { job: "Idle", lvl: 128 }, { job: "Pipes", lvl: 64 }, { job: "Wire", lvl: 512 }] };
  assert.deepEqual(plain(call("manualLoadoutSlots", st)),
    [{ item: "Ingots", lvl: 512 }, null, null, { item: "Wire", lvl: 32 }]);
});

test("Items/Credits plan: read over the current lines; idle, missing, unknown and extra rows are empty", () => {
  const plan = [{ job: { kind: "craft", res: "Frames", lvl: 16 } }, { job: { kind: "idle", res: null, lvl: null } }, null,
    { job: { kind: "craft", res: "OldItem", lvl: 1 } }, { job: { kind: "produce", res: "Bits", lvl: 2 } }];
  assert.deepEqual(plain(call("planLoadoutSlots", plan, [line(16), line(16), line(16), line(16)])),
    [{ item: "Frames", lvl: 16 }, null, null, null]);
});

const boundary = (phaseIndex, phaseTime, active) => ({ kind: "switch", phaseIndex, phaseTime, active });
const projectRes = (phases, boundaries, ok = true) => ({ feasible: true, lpFeasible: true, executionPhases: phases,
  scheduleValidation: { ok, boundaries } });

test("Project step: one loadout per stretch in which no crafter changes job", () => {
  const phases = [{ kind: "warmup", eta: 1, plan: [{ line: 1, entries: [] }, { line: 2, entries: [] }] },
    { kind: "project", eta: 5, plan: [{ line: 1, entries: [] }, { line: 2, entries: [] }, { line: 3, entries: [] }] }];
  const a = { line: 1, item: "Ingots", lvl: 512 }, b = { line: 2, item: "Rods", lvl: 64 }, c = { line: 2, item: "Frames", lvl: 16 };
  const res = projectRes(phases, [{ kind: "phase-start", phaseIndex: 1, phaseTime: 0 }, boundary(0, 1, [a]),
    boundary(1, 2, [a, b]), boundary(1, 3, [a, b]), boundary(1, 4, [a, c]), boundary(1, 5, [a]),
    { kind: "completion", phaseIndex: 1, phaseTime: 5 }]);
  assert.deepEqual(plain(call("projectStepLoadouts", res, 0)),
    [{ start: 0, end: 1, slots: [{ item: "Ingots", lvl: 512 }, null] }]);
  assert.deepEqual(plain(call("projectStepLoadouts", res, 1)).map(l => [l.start, l.end, l.slots.map(s => s && s.item)]), [
    [0, 3, ["Ingots", "Rods", null]], [3, 4, ["Ingots", "Frames", null]], [4, 5, ["Ingots", null, null]]]);
});

test("Project step: blocked plans, prerequisites and all-idle steps have no loadouts", () => {
  const phases = [{ kind: "prerequisite", eta: 0, plan: [] }, { kind: "project", eta: 1, plan: [{ line: 1, entries: [] }] }];
  const idle = [boundary(1, 1, [])], busy = [boundary(1, 1, [{ line: 1, item: "Bits", lvl: 1 }])];
  assert.deepEqual(plain(call("projectStepLoadouts", projectRes(phases, busy), 0)), []);
  assert.deepEqual(plain(call("projectStepLoadouts", projectRes(phases, idle), 1)), []);
  assert.deepEqual(plain(call("projectStepLoadouts", projectRes(phases, busy, false), 1)), []);
  assert.deepEqual(plain(call("projectStepLoadouts", { ...projectRes(phases, busy), lpFeasible: false }, 1)), []);
  assert.deepEqual(plain(call("projectStepLoadouts", { ...projectRes(phases, busy), feasible: false }, 1)), []);
  assert.equal(call("projectStepLoadouts", projectRes(phases, busy), 1).length, 1);
  assert.deepEqual(plain(call("projectStepLoadouts", null, 0)), []);
});

test("Project step: a stretch too short to run one craft is folded into its neighbour, not given a code", () => {
  const phases = [{ kind: "project", eta: 3, plan: [{ line: 1, entries: [] }, { line: 2, entries: [] }] }];
  const a = { line: 1, item: "Bits", lvl: 1 }, b = { line: 2, item: "Glass", lvl: 1 }, sliver = 1e-11;
  const at = (...stretches) => plain(call("projectStepLoadouts", projectRes(phases,
    stretches.map(([end, active]) => boundary(0, end, active))), 0)).map(l => [l.start, l.end, l.slots.map(s => s && s.item)]);
  // A line finishing a rounding error before the step does leaves a sliver at the end.
  assert.deepEqual(at([3 - sliver, [a, b]], [3, [a]]), [[0, 3, ["Bits", "Glass"]]]);
  // Between two stretches running the same jobs, the sliver goes and the two become one loadout.
  assert.deepEqual(at([1, [a, b]], [1 + sliver, [a]], [3, [a, b]]), [[0, 3, ["Bits", "Glass"]]]);
  // At the very start, the next stretch takes its place from time zero.
  assert.deepEqual(at([sliver, [b]], [2, [a]], [3, [a, b]]), [[0, 2, ["Bits", null]], [2, 3, ["Bits", "Glass"]]]);
  // Half a second is still too short; two seconds is a stretch.
  assert.equal(at([1, [a]], [1 + 0.5 / 3600, [b]], [3, [a]]).length, 1);
  assert.equal(at([1, [a]], [1 + 2 / 3600, [b]], [3, [a]]).length, 3);
  // A step shorter than a craft keeps what it has rather than losing every code.
  const brief = [{ kind: "warmup", eta: sliver, plan: [{ line: 1, entries: [] }] }];
  assert.equal(call("projectStepLoadouts", projectRes(brief, [boundary(0, sliver, [a])]), 0).length, 1);
});

test("Project step: only the eight crafters a game code holds decide where one loadout ends", () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({ line: i + 1, entries: [] }));
  const phases = [{ kind: "project", eta: 3, plan: nine }];
  const crafters = Array.from({ length: 8 }, (_, i) => ({ line: i + 1, item: "Ingots", lvl: 512 }));
  const res = projectRes(phases, [boundary(0, 1, [...crafters, { line: 9, item: "Plates", lvl: 4 }]),
    boundary(0, 2, [...crafters, { line: 9, item: "Rods", lvl: 4 }]), boundary(0, 3, [{ line: 9, item: "Rods", lvl: 4 }])]);
  const loadouts = plain(call("projectStepLoadouts", res, 0));
  // A job change on line 9 alone is no new loadout, and a stretch where only line 9 works has no
  // crafter to load.
  assert.deepEqual(loadouts.map(l => [l.start, l.end]), [[0, 2]]);
  const model = call("projectLoadoutExport", res, 0, 0);
  assert.equal(model.name, "Step 1");
  assert.deepEqual(plain(model.omittedLines), [9], "the export still says line 9 is left out");
});

test("default icon: the build's own item when it has one, else the most-run item, ties to the lowest line", () => {
  const s = (...items) => items.map(item => item && { item, lvl: 1 });
  assert.equal(call("loadoutDefaultIcon", s("Bits", "Wire"), "Batteries"), 6);
  assert.equal(call("loadoutDefaultIcon", s("Bits", "Wire", "Wire"), undefined), 11);
  assert.equal(call("loadoutDefaultIcon", s("Rods", "Plates", "Plates", "Rods"), undefined), 9);
  assert.equal(call("loadoutDefaultIcon", s(null, null), undefined), 0);
  assert.equal(call("loadoutDefaultIcon", s("Gel"), "Rocks"), 4, "a mined winner has no icon of its own");
});

test("export defaults per source, and busy lines past eight are reported", () => {
  const lines = Array.from({ length: 10 }, () => line(16));
  const plan = lines.map((_, i) => ({ job: i === 9 || i < 2 ? { kind: "craft", res: "Wire", lvl: 16 } : { kind: "idle" } }));
  const items = call("planLoadoutExport", { mode: "items", targets: ["Wire"], plan }, lines);
  assert.equal(items.name, "Max Wire");
  assert.equal(items.icon, 11);
  assert.equal(items.slots.length, 8);
  assert.deepEqual(plain(items.omittedLines), [10]);
  assert.equal(call("planLoadoutExport", { mode: "items", targets: ["Wire", "Rods"], plan }, lines).name, "Max items");
  assert.equal(call("planLoadoutExport", { mode: "items", targets: ["Reinforced Concrete"], plan }, lines).name, "Max Reinforced C");
  const credits = call("planLoadoutExport", { mode: "credits", bestItem: "Batteries", plan }, lines);
  assert.equal(credits.name, "Max credits");
  assert.equal(credits.icon, 6);
  const st = { lines: [line(512)], manual: [{ job: "Ingots", lvl: 512 }],
    manualSaved: [{ id: "p1", name: "My-Setup", config: [] }], manualActiveId: "p1" };
  assert.equal(call("manualLoadoutExport", st).name, "My Setup");
  assert.equal(call("manualLoadoutExport", { ...st, manualActiveId: null }).name, "Manual");
  assert.equal(call("manualLoadoutExport", { ...st, manualSaved: [{ id: "p1", name: " - ", config: [] }] }).name, "Manual");
});

test("project export names each step, and numbers the codes within a step", () => {
  const phases = [{ kind: "project", eta: 2, plan: [{ line: 1, entries: [] }] }, { kind: "project", eta: 2, plan: [{ line: 1, entries: [] }] }];
  const res = projectRes(phases, [boundary(0, 2, [{ line: 1, item: "Bits", lvl: 1 }]),
    boundary(1, 1, [{ line: 1, item: "Bits", lvl: 1 }]), boundary(1, 2, [{ line: 1, item: "Glass", lvl: 1 }])]);
  assert.equal(call("projectLoadoutExport", res, 0, 0).name, "Step 1");
  assert.equal(call("projectLoadoutExport", res, 1, 1).name, "Step 2.2");
  assert.equal(call("projectLoadoutExport", res, 1, 1).start, 1);
  assert.equal(call("projectLoadoutExport", res, 1, 1).end, 2);
  assert.equal(call("projectLoadoutExport", res, 1, 5), null);
});

// A real solve, round-tripped through JSON as the Worker hands it back: each step's loadouts tile
// the step, carry exactly the jobs the replay ran, and survive the trip through a code.
const solveProject = lineMode => plain(api(`(()=>{
  const s=defaults();s.dupe=0;s.margin=0;s.mode="project";s.projLineMode=${JSON.stringify(lineMode)};
  s.projectSeq=true;s.projectGate=false;
  s.lines=[{max:4,spx:5,turbo:0},{max:4,spx:4.5,turbo:0},{max:2,spx:4,turbo:0},{max:2,spx:3.5,turbo:0}];
  Object.assign(s.forgie,{Concrete:5e3,Ingots:5e3,Bits:5e3});
  const project=(id,name,costs,prio)=>({id,name,catId:"",on:true,from:1,to:1,done:0,prio,
    levels:[{costs:costs.map(c=>({item:c[0],qty:c[1]}))}]});
  s.projects=[project("a","Frames run",[["Frames",400],["Glass",900]],1),project("b","Brick run",[["Bricks",900],["Rods",300]],2)];
  normalize(s);syncManual(s);S=s;
  return optimize();
})()`));

for (const lineMode of ["split", "static"]) test(`a real ${lineMode} Project plan exports every stretch of every step`, () => {
  const res = solveProject(lineMode);
  assert.ok(res.feasible && res.lpFeasible && res.scheduleValidation.ok, "fixture plan replays");
  let steps = 0, codes = 0;
  res.executionPhases.forEach((phase, i) => {
    const loadouts = plain(call("projectStepLoadouts", res, i));
    if (phase.kind === "prerequisite") { assert.deepEqual(loadouts, [], "prerequisite step " + (i + 1)); return; }
    steps++;
    codes += loadouts.length;
    assert.ok(loadouts.length >= 1, "step " + (i + 1) + " has a loadout");
    if (lineMode === "static") assert.equal(loadouts.length, 1, "Set & forget step " + (i + 1) + " is one loadout");
    assert.equal(loadouts[0].start, 0);
    assert.ok(Math.abs(loadouts[loadouts.length - 1].end - phase.eta) < 1e-9, "the last loadout runs to the end of step " + (i + 1));
    loadouts.forEach((loadout, k) => {
      if (k) assert.equal(loadout.start, loadouts[k - 1].end, "loadouts tile step " + (i + 1));
      const slices = res.scheduleValidation.boundaries.filter(b => b.kind === "switch" && b.phaseIndex === i)
        .map((b, j, all) => ({ ...b, from: j ? all[j - 1].phaseTime : 0 }));
      // Slices shorter than one craft are folded into a neighbour, so only the real ones must match.
      const ran = slices.filter(b => b.phaseTime > loadout.start && b.phaseTime <= loadout.end + 1e-12 &&
        b.phaseTime - b.from >= api("MIN_CRAFT_S") / 3600);
      assert.ok(ran.length >= 1);
      for (const b of ran) {
        const expected = loadout.slots.map(() => null);
        b.active.forEach(job => { expected[job.line - 1] = { item: job.item, lvl: job.lvl }; });
        assert.deepEqual(loadout.slots, expected, `step ${i + 1} at ${b.phaseTime}h`);
      }
      const code = call("encodeLoadoutCode", { name: "x", icon: 0, slots: loadout.slots });
      assert.deepEqual(plain(call("parseLoadoutCode", code).slots).slice(0, loadout.slots.length), loadout.slots);
    });
  });
  assert.ok(steps >= 2, "the fixture has at least two working steps");
  if (lineMode === "split") assert.ok(codes > steps, "Line switching changes jobs partway through a step");
});

/* ---- import ---- */

const parse = code => call("parseLoadoutCode", code);
const factory = maxes => {
  const st = plain(call("defaults"));
  st.lines = maxes.map(line);
  call("syncManual", st);
  return st;
};

test("Add line and an import's new lines start from the same crafter", () => {
  assert.deepEqual(plain(call("newCrafterLine")), { max: 512, spx: 1, turbo: 0 });
  const events = fs.readFileSync(path.join(ROOT, "js/events.js"), "utf8");
  assert.match(events, /st\.lines\.push\(newCrafterLine\(\)\)/, "Add line uses the shared default");
});

test("a code that fits changes no crafter line", () => {
  const st = factory([512, 512, 128, 64, 32, 16]);
  const plan = call("planLoadoutImport", st, parse(EXAMPLE));
  assert.equal(plan.changesLines, false);
  assert.deepEqual(plain(plan.lines), plain(st.lines));
  assert.deepEqual(plain(plan.manual.map(m => m.job)), Array(6).fill("Ingots"));
});

test("a level above a cap raises the cap, and busy crafters past the last line add lines", () => {
  const st = factory([512, 64, 128, 64, 32]);
  const plan = call("planLoadoutImport", st, parse("x-7-adaj-adaj-adah-adag-adaf-aaaa-aaaa-adae"));
  assert.deepEqual(plain(plan.capRaises), [{ line: 2, from: 64, to: 512 }]);
  assert.deepEqual(plain(plan.addedLines),
    [{ line: 6, max: 512, spx: 1 }, { line: 7, max: 512, spx: 1 }, { line: 8, max: 512, spx: 1 }]);
  assert.equal(plan.changesLines, true);
  assert.deepEqual(plain(plan.manual.map(m => m.job)),
    ["Ingots", "Ingots", "Ingots", "Ingots", "Ingots", "Idle", "Idle", "Ingots"]);
  assert.deepEqual(plain(st.lines.map(l => l.max)), [512, 64, 128, 64, 32], "planning leaves state alone");
});

test("an added line keeps the Add line cap unless the code runs it higher", () => {
  const plan = call("planLoadoutImport", factory([16]), parse("x-0-aaaa-abaq-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa"));
  assert.deepEqual(plain(plan.addedLines), [{ line: 2, max: 65536, spx: 1 }]);
  assert.deepEqual(plain(plan.capRaises), []);
});

test("planner lines past eight are set idle, and nothing is left marked for sale", () => {
  const st = factory(Array(10).fill(16));
  st.manual = st.lines.map(() => ({ job: "Bits", lvl: 16, sell: true }));
  const plan = call("planLoadoutImport", st, parse("x-0-abae-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa-aaaa"));
  assert.deepEqual(plain(plan.manual.map(m => m.job)), ["Bits", ...Array(9).fill("Idle")]);
  assert.ok(plan.manual.every(m => m.sell === false));
  assert.match(call("loadoutImportNotes", plan).idledLines, /Lines 9–10/);
  assert.equal(call("loadoutImportNotes", call("planLoadoutImport", factory([16]), parse(EXAMPLE))).idledLines, null);
});

test("an applied import is a state the validator accepts, with or without a preset", () => {
  for (const preset of [null, "ingots run"]) {
    const st = factory([512, 64, 128, 64, 32]);
    st.manualSaved = [{ id: "pOld", name: "Old", config: [] }];
    st.manualActiveId = "pOld";
    call("applyLoadoutImport", st, call("planLoadoutImport", st, parse("x-7-adaj-adaj-adah-adag-adaf-aaaa-aaaa-adae")), preset);
    assert.equal(st.mode, "manual");
    assert.equal(st.lines.length, 8);
    assert.equal(st.lines[1].max, 512);
    assert.equal(st.manual.length, 8);
    assert.equal(st.manual[7].job, "Ingots");
    assert.equal(st.manual[5].lvl, 512, "an idle line sits at its cap, as syncManual keeps it");
    if (preset) {
      assert.equal(st.manualSaved.length, 2);
      assert.equal(st.manualSaved[1].name, preset);
      assert.equal(st.manualActiveId, st.manualSaved[1].id);
      assert.deepEqual(plain(st.manualSaved[1].config), plain(st.manual));
    } else {
      assert.equal(st.manualSaved.length, 1);
      assert.equal(st.manualActiveId, null, "the old preset's Update button must not offer to overwrite it");
    }
    const validated = call("validateAndMigrate", plain(st));
    assert.equal(validated.ok, true, (validated.errors || []).join("; "));
  }
});

test("the preview and the confirmation name every change", () => {
  const st = factory([512, 64, 128, 64, 32]);
  const plan = call("planLoadoutImport", st, parse("x-7-adaj-adaj-adah-adag-adaf-anaj-aaaa-adae"));
  const notes = call("loadoutImportNotes", plan);
  assert.deepEqual(plain(notes.jobs.slice(0, 2)), ["Line 1: Ingots 512×", "Line 2: Ingots 512×"]);
  assert.deepEqual(plain(notes.lineChanges), ["Line 2 cap: 64× → 512×",
    "Adds line 6 (cap 512×, speed 1×) — set its real speed under Crafter lines",
    "Adds line 7 (cap 512×, speed 1×) — set its real speed under Crafter lines",
    "Adds line 8 (cap 512×, speed 1×) — set its real speed under Crafter lines"]);
  assert.deepEqual(plain(notes.unmodelled), ["Line 6: Pipes isn't in the planner, so the line is left idle."]);
  const text = call("loadoutImportConfirmText", plan);
  assert.match(text, /^Importing this code changes your crafter lines:/);
  for (const change of notes.lineChanges) assert.ok(text.includes("• " + change), change);
  assert.match(text, /Are you sure\?$/);
  const unknown = call("loadoutImportNotes", call("planLoadoutImport", st, parse("x-0-auaj-adar-adba-aaaa-aaaa-aaaa-aaaa-aaaa")));
  assert.deepEqual(plain(unknown.unmodelled), [
    "Line 1: the game recipe there isn't one the planner knows, so the line is left idle.",
    "Line 2: compression level 17 is above the planner's highest (level 16, 65.54k×), so the line is left idle.",
    "Line 3: its compression level is above the planner's highest (level 16, 65.54k×), so the line is left idle."]);
  // Past the player's last line there is no line to leave idle, and none is added for a crafter
  // the planner cannot run.
  const short = factory([512, 512, 128, 64, 32]);
  const past = call("planLoadoutImport", short, parse("x-7-adaj-adaj-adah-adag-adaf-anaj-adar-aaaa"));
  assert.equal(past.lines.length, 5);
  assert.deepEqual(plain(call("loadoutImportNotes", past).unmodelled), [
    "Crafter 6: Pipes isn't in the planner, and you have no line 6, so it is left out.",
    "Crafter 7: compression level 17 is above the planner's highest (level 16, 65.54k×), and you have no line 7, so it is left out."]);
});

test("an imported preset is named after the loadout, or a plain default", () => {
  assert.equal(call("loadoutPresetName", parse(EXAMPLE)), "ingots");
  assert.equal(call("loadoutPresetName", parse("  -7-adaj-adaj-adah-adag-adaf-adae-aaaa-aaaa")), "Imported loadout");
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
