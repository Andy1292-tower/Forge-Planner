"use strict";
/* Unlock-gating toggle test (Node).
 *
 * Verifies the `projectGate` flag in project mode:
 *  - gate ON  (default): a project that unlocks Frames + a project that needs Frames
 *    are split into 2 unlock waves.
 *  - gate OFF: the same list collapses into a single combined phase.
 *  - normalize() defaults a missing projectGate to true (legacy saves unchanged).
 *
 * Usage: node test/gate.cjs
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
  function base(){ const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project"; s.projectSeq = false;
    s.lines = JSON.parse(JSON.stringify(LINES)); return s; }
  // frame-factory unlocks Frames; the consumer's costs include Frames -> a real gating edge.
  function gatedProjects(){ return [
    {id:"a",name:"Frame Factory",catId:"frame-factory",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Glass",qty:80}]}]},
    {id:"b",name:"Consumer",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Frames",qty:60}]}]},
  ]; }

  const results = [];
  function record(name, pass, detail){ results.push({name, pass, detail}); }

  // gate ON -> 2 unlock waves
  { const s = base(); s.projectGate = true; s.projects = gatedProjects();
    normalize(s); syncManual(s); S = s;
    const r = optimize();
    record("gate ON -> 2 waves", r.phases.length === 2 && r.waved === true && !r.single,
      "phases="+r.phases.length+" waved="+r.waved+" single="+!!r.single); }

  // gate OFF -> 1 combined phase
  { const s = base(); s.projectGate = false; s.projects = gatedProjects();
    normalize(s); syncManual(s); S = s;
    const r = optimize();
    const summed = ALLITEMS.reduce((a,it)=>a+((r.phases[0].demandSub&&r.phases[0].demandSub[it])||0),0);
    record("gate OFF -> 1 phase", r.phases.length === 1 && r.single === true && !r.waved && isFinite(r.eta) && r.eta > 0,
      "phases="+r.phases.length+" single="+!!r.single+" waved="+r.waved+" eta="+r.eta);
    record("gate OFF -> demand summed", summed > 0, "sumDemand="+summed); }

  // normalize defaults missing projectGate to true
  { const s = base(); delete s.projectGate; s.projects = gatedProjects();
    normalize(s);
    record("normalize defaults gate=true", s.projectGate === true, "projectGate="+s.projectGate); }

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
