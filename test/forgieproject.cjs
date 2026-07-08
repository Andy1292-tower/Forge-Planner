"use strict";
/* Lil' Forgie stats in project plan (issue #77).
 *
 * The project balance table now breaks out Forgie's passive supply into its own
 * "Passive" column, and a note lists his relevant contribution. Both read the
 * `forgie` field the project scheduler already attaches to each balance row and
 * the passive supply folded into the per-item rate. This verifies that solver
 * contract so the display has correct data to show.
 *
 *  - a project needing Frames, with Forgie making Ingots -> balance row for Ingots
 *    carries forgie>0, and the plan needs strictly fewer Ingot lines than with no Forgie.
 *
 * Usage: node test/forgieproject.cjs
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
    {max:4, spx:5.0, turbo:0},
    {max:4, spx:4.5, turbo:0},
    {max:2, spx:4.0, turbo:0},
    {max:2, spx:3.5, turbo:0},
    {max:1, spx:3.0, turbo:0},
  ];
  function base(forgieIngots){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project";
    s.lines = JSON.parse(JSON.stringify(LINES));
    s.projects = [{id:"a",name:"P",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Frames",qty:200},{item:"Plates",qty:400}]}]}];
    if (forgieIngots) s.forgie.Ingots = forgieIngots;
    normalize(s); syncManual(s);
    return s;
  }
  const results = [];

  S = base(0);
  const noF = optimize();
  const ingotLinesNoF = (noF.plan||[]).filter(p => (p.entries||[]).some(e => e.item === "Ingots")).length;

  S = base(20000);   // heavy passive Ingot supply
  const withF = optimize();
  const bal = (withF.balance||[]).find(b => b.res === "Ingots");
  const ingotLinesWithF = (withF.plan||[]).filter(p => (p.entries||[]).some(e => e.item === "Ingots")).length;

  results.push(["balance carries Forgie for Ingots", !!bal && (bal.forgie||0) > 1e-6,
    "forgie=" + (bal ? bal.forgie : "no-row")]);
  results.push(["Forgie frees Ingot lines", ingotLinesWithF < ingotLinesNoF,
    "withForgie=" + ingotLinesWithF + " noForgie=" + ingotLinesNoF]);
  results.push(["still feasible with Forgie", !!withF.feasible, "feasible=" + withF.feasible]);

  __emit(JSON.stringify(results));
})();
`;

globalThis.__emit = (str) => {
  const rows = JSON.parse(str);
  let fail = 0;
  rows.forEach(([name, ok, detail]) => {
    console.log((ok ? "ok   " : "FAIL ") + name + "  [" + detail + "]");
    if (!ok) fail++;
  });
  console.log("\n" + (rows.length - fail) + " ok, " + fail + " failed");
  if (fail) process.exitCode = 1;
};

eval(coreSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
