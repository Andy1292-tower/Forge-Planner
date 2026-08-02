"use strict";
/* Stock-drawdown risk test (Node) — issue #80.
 *
 * The #73 fix let a project plan credit an intermediate's leftover stock as free supply instead
 * of crafting it. Left uncapped, a chronic (if small) per-hour shortfall between an item's real
 * supply (Forgie + crafting) and its consumption got entirely papered over by draining 100% of
 * on-hand stock, with zero lines ever assigned to replenish it — a plan that reads as "feasible"
 * and shows no Ingot crafters, yet depends on Ingot stock that will run out.
 *
 *  - chronic shortfall + finite stock -> flagged atRisk (no crafters, plan drains the stock).
 *  - ample/ample-looking stock (issue #73's case) -> NOT flagged; a comfortable buffer that's
 *    barely touched is healthy, not risky.
 *  - no stock at all, chronic shortfall -> infeasible/short rate, not silently "feasible".
 *
 * Usage: node test/stockrisk.cjs
 */
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const coreSrc = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");
const projectSrc = fs.readFileSync(path.join(__dirname, "..", "js", "project-schedule.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(__dirname, "..", "js", "solver.js"), "utf8");

const runner = `
(function(){
  const LINES = [
    {max:256, spx:20.0, turbo:0},
    {max:128, spx:18.0, turbo:0},
  ];
  // Rods (a direct project cost) recipe-consumes only Ingots — mirrors the reporter's
  // Rods<-Ingots chain in issue #80 without needing Gel/Wire in the mix.
  function base(){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project";
    s.lines = JSON.parse(JSON.stringify(LINES));
    s.projects = [{id:"a",name:"P",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Rods",qty:2000000}]}]}];
    return s;
  }
  const ingotLines = r => (r.plan||[]).filter(p=>(p.entries||[]).some(e=>e.item==="Ingots")).length;
  const results = [];
  function record(name, pass, detail){ results.push({name, pass, detail}); }

  // Forgie supplies Ingots just under what full-tilt Rod crafting needs -> a persistent, if
  // tiny, per-hour shortfall. A finite Ingot/Rod stock covers it for the whole modeled phase.
  { const s = base(); s.forgie.Ingots = 700000;
    s.inventory = Object.assign({}, s.inventory, {Ingots:1000, Rods:90000});
    normalize(s); syncManual(s); S = s;
    const res = optimize(); const ph = res.phases[0];
    record("issue#80: chronic shortfall + finite stock -> flagged atRisk",
      ph.feasible && ph.atRisk && ph.atRisk.indexOf("Ingots")>=0 && ingotLines(ph)===0,
      "feasible="+ph.feasible+" atRisk="+JSON.stringify(ph.atRisk)+" ingotLines="+ingotLines(ph)); }

  // Same chronic shortfall, but Ingot stock (the feeder, not the Rods target itself) is
  // effectively unlimited (issue #73's case) -> the draw is a vanishing fraction of what's on
  // hand, so it's healthy, not risky.
  { const s = base(); s.forgie.Ingots = 700000;
    s.inventory = Object.assign({}, s.inventory, {Ingots:1e18});
    normalize(s); syncManual(s); S = s;
    const res = optimize(); const ph = res.phases[0];
    record("ample stock -> NOT flagged atRisk",
      ph.feasible && (!ph.atRisk || ph.atRisk.length===0),
      "feasible="+ph.feasible+" atRisk="+JSON.stringify(ph.atRisk)); }

  // No stock cushion at all: with nothing to credit, the LP simply throttles Rod output to
  // match Forgie's Ingot supply exactly — no shortfall, no stock draw, nothing to flag. Confirms
  // the flag only fires when a real stock-financed gap exists, not on every zero-Ingot-line plan.
  { const s = base(); s.forgie.Ingots = 700000;
    normalize(s); syncManual(s); S = s;
    const res = optimize(); const ph = res.phases[0];
    const b = (ph.balance||[]).find(x=>x.res==="Ingots");
    record("no stock -> no shortfall, not flagged",
      ph.feasible && (!b || b.stock<=1e-6) && (!ph.atRisk || ph.atRisk.length===0),
      "feasible="+ph.feasible+" stock="+(b&&b.stock)+" atRisk="+JSON.stringify(ph.atRisk)); }

  __emit(JSON.stringify(results));
})();
`;

globalThis.__emit = (str) => {
  const rows = JSON.parse(str);
  let fail = 0;
  rows.forEach(({name, pass, detail}) => {
    console.log((pass ? "ok   " : "FAIL ") + name + "  [" + detail + "]");
    if (!pass) fail++;
  });
  console.log("\n" + (rows.length - fail) + " ok, " + fail + " failed");
  if (fail) process.exitCode = 1;
};

eval(coreSrc + "\n;\n" + projectSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
