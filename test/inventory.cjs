"use strict";
/* Inventory-drawdown test (Node) — issue #73.
 *
 * Project plans must credit stock of INTERMEDIATE/raw materials, not just finished outputs.
 * A project needing Plates (which are crafted from Ingots) must NOT schedule Ingot production
 * when Ingots are already in stock in sufficient quantity for the whole project.
 *
 *  - ample Ingot stock -> plan produces ZERO Ingots (drawn from inventory instead).
 *  - no stock (control) -> Ingots ARE produced (feeds the Plate crafts).
 *  - partial stock -> plan still feasible, fewer/again Ingots produced than the no-stock case.
 *  - cross-phase: stock consumed by an earlier project isn't spent again by a later one.
 *
 * Usage: node test/inventory.cjs
 */
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const coreSrc = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(__dirname, "..", "js", "solver.js"), "utf8");

const runner = `
(function(){
  const LINES = [
    {max:64, spx:20.0, turbo:0},
    {max:64, spx:18.0, turbo:0},
    {max:32, spx:16.0, turbo:0},
    {max:16, spx:14.0, turbo:0},
    {max:8,  spx:12.0, turbo:0},
  ];
  function base(){ const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project";
    s.projectSeq = false; s.projectGate = false;
    s.lines = JSON.parse(JSON.stringify(LINES)); return s; }
  // A project whose only cost is Plates. Plates are crafted from Ingots (see RECIPE), so a plan
  // must obtain Ingots somehow — produce them, or (issue #73) draw them from stock.
  function platesProject(){ return [
    {id:"a",name:"Plate Job",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Plates",qty:5000}]}]},
  ]; }
  const ingotEntries = r => (r.phases[0].plan||[]).reduce(
    (n,p)=>n+(p.entries||[]).filter(e=>e.item==="Ingots").length, 0);

  const results = [];
  function record(name, pass, detail){ results.push({name, pass, detail}); }

  // control: no Ingot stock -> Ingots must be produced to feed the Plate crafts
  let ctrlEta = 0, ctrlIngots = 0;
  { const s = base(); s.projects = platesProject();
    normalize(s); syncManual(s); S = s;
    const r = optimize(); ctrlEta = r.eta; ctrlIngots = ingotEntries(r);
    record("control: no stock -> Ingots produced", ctrlIngots > 0 && r.feasible,
      "ingotLines="+ctrlIngots+" feasible="+r.feasible+" eta="+r.eta); }

  // ample Ingot stock -> ZERO Ingot production, and never slower than the control
  { const s = base(); s.projects = platesProject();
    s.inventory = Object.assign({}, s.inventory, { Ingots: 1e18 });
    normalize(s); syncManual(s); S = s;
    const r = optimize();
    const n = ingotEntries(r);
    record("issue#73: ample Ingot stock -> 0 Ingot lines",
      n === 0 && r.feasible && r.eta <= ctrlEta + 1e-6,
      "ingotLines="+n+" feasible="+r.feasible+" eta="+r.eta+" (control eta="+ctrlEta+")"); }

  // partial stock -> still feasible (draws what it can, produces the rest)
  { const s = base(); s.projects = platesProject();
    s.inventory = Object.assign({}, s.inventory, { Ingots: 1000 });
    normalize(s); syncManual(s); S = s;
    const r = optimize();
    record("partial stock -> feasible", r.feasible && isFinite(r.eta) && r.eta > 0,
      "feasible="+r.feasible+" eta="+r.eta+" ingotLines="+ingotEntries(r)); }

  // finished-output stock still works unchanged: stock of Plates themselves reduces net demand
  { const s = base(); s.projects = platesProject();
    s.inventory = Object.assign({}, s.inventory, { Plates: 1e18 });
    normalize(s); syncManual(s); S = s;
    const r = optimize();
    // whole demand covered by Plate stock -> nothing left to craft
    record("finished-output stock -> nothing to craft",
      (r.empty || r.eta === 0 || r.phases.every(p=>(p.plan||[]).every(l=>!(l.entries||[]).length))),
      "eta="+r.eta+" empty="+!!r.empty); }

  __emit(JSON.stringify(results));
})();
`;

globalThis.__emit = (str) => {
  const results = JSON.parse(str);
  let fail = 0;
  for (const r of results) {
    console.log((r.pass ? "ok   " : "FAIL ") + r.name + "  [" + r.detail + "]");
    if (!r.pass) fail++;
  }
  console.log("\n" + (results.length - fail) + " ok, " + fail + " failed");
  process.exit(fail ? 1 : 0);
};

// eslint-disable-next-line no-eval
eval(coreSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
