"use strict";
/* Solver parity / regression harness (Node).
 *
 * Loads core.js + solver.js as-is and runs optimize() across a matrix of
 * modes (items/credits/project) x Gel on/off x 5/7 lines, emitting a canonical
 * JSON summary of each result.
 *
 * Determinism: the solver's branch-and-bound is anytime-capped on wall-clock,
 * which is non-reproducible. We freeze performance.now() to 0 so every solve
 * runs to exhaustion (capped=false) and returns the true optimum. Test
 * instances use small compression caps so exhaustive search stays fast.
 *
 * Usage:
 *   node test/parity.cjs            # print summaries to stdout
 *   node test/parity.cjs > out.json # capture a golden snapshot
 */
const fs = require("fs");
const path = require("path");

// ---- shims: browser globals the solver/core touch ----
globalThis.performance = { now: () => 0 };          // freeze clock -> exhaustive, deterministic
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const coreSrc = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");
const projectSrc = fs.readFileSync(path.join(__dirname, "..", "js", "project-schedule.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(__dirname, "..", "js", "solver.js"), "utf8");

// ---- canonical summary (rounded so float noise doesn't break diffs) ----
function sig(x) {
  if (x == null || !isFinite(x)) return x === undefined ? null : x;
  if (x === 0) return 0;
  const d = Math.ceil(Math.log10(Math.abs(x)));
  const f = Math.pow(10, 6 - d);
  return Math.round(x * f) / f;
}
function summarize(res) {
  if (!res) return { err: "null result" };
  if (res.empty) return { mode: res.mode, empty: true };
  const r = {
    mode: res.mode,
    feasible: !!res.feasible,
    capped: !!res.capped,
    objective: sig(res.objective),
  };
  if (Array.isArray(res.plan)) {
    r.plan = res.plan.filter(Boolean).map(p => {
      if (Array.isArray(p.entries)) { // project-mode plan row (LP, may split)
        return { line: p.line, reserved: !!p.reserved,
          jobs: p.entries.map(e => `${e.item}@${e.lvl}:${sig(e.frac)}`).sort() };
      }
      const j = p.job || {};
      const tag = (j.kind === "craft" || j.kind === "produce") ? `${j.res}@${j.lvl}` : "idle";
      return { line: p.line, reserved: !!p.reserved, job: tag };
    }).sort((a, b) => a.line - b.line);
  }
  if (Array.isArray(res.balance)) {
    r.balance = res.balance
      .map(b => `${b.res}:${sig((b.prod || 0) + (b.forgie || 0) - (b.cons || 0))}`)
      .sort();
  }
  if (res.eta != null) r.eta = sig(res.eta);
  if (res.credits != null) r.credits = sig(res.credits);
  if (res.bestItem !== undefined) r.bestItem = res.bestItem;
  if (Array.isArray(res.unsat)) r.unsat = res.unsat.slice().sort();
  if (Array.isArray(res.phases)) r.phases = res.phases.length;
  if (res.gelReserved) r.gelReserved = { lines: res.gelReserved.lines, outHr: sig(res.gelReserved.outHr) };
  return r;
}

// ---- runner (lives inside the eval scope so it can see S, optimize, defaults, ...) ----
const runner = `
(function(){
  const LINES5 = [
    {max:4, spx:5.0, turbo:0},
    {max:4, spx:4.5, turbo:0},
    {max:2, spx:4.0, turbo:0},
    {max:2, spx:3.5, turbo:0},
    {max:1, spx:3.0, turbo:0},
  ];
  const LINES7 = LINES5.concat([
    {max:4, spx:4.2, turbo:0},
    {max:2, spx:3.8, turbo:0},
  ]);
  const GEL_BUDGET = 5e21; // vespium/min; large enough to forge meaningful Gel at these caps

  function base(){ const s = defaults(); s.dupe = 0; s.margin = 0; return s; }
  function on(s, items){ PRODUCTS.forEach(p => s.targets[p] = {on: items.includes(p), w: 1}); }
  function prices(s, map){ Object.keys(map).forEach(k => s.sellPrice[k] = map[k]); }

  const scenarios = {
    "items.single.noGel":      s => { s.mode="items"; on(s,["Frames"]); },
    "items.multi.noGel":       s => { s.mode="items"; on(s,["Frames","Glass"]); },
    "items.wire.gel":          s => { s.mode="items"; on(s,["Wire"]); s.minedIncome.Vespium.rigPerMin=GEL_BUDGET; },
    "items.multiWire.gel":     s => { s.mode="items"; on(s,["Wire","Rods"]); s.minedIncome.Vespium.rigPerMin=GEL_BUDGET; },
    "credits.noGel":           s => { s.mode="credits"; prices(s,{Frames:10,Glass:3,Rods:1}); },
    "credits.wire.gel":        s => { s.mode="credits"; prices(s,{Wire:50,Rods:1}); s.minedIncome.Vespium.rigPerMin=GEL_BUDGET; },
    "project.frames.noGel":    s => { s.mode="project";
      s.projects=[{id:"a",name:"P",catId:"",on:true,from:1,to:1,done:0,prio:null,
        levels:[{costs:[{item:"Frames",qty:200}]}]}]; },
    "project.wire.gel":        s => { s.mode="project"; s.minedIncome.Vespium.rigPerMin=GEL_BUDGET;
      s.projects=[{id:"a",name:"P",catId:"",on:true,from:1,to:1,done:0,prio:null,
        levels:[{costs:[{item:"Wire",qty:120}]}]}]; },
  };

  const out = {};
  [["5", LINES5], ["7", LINES7]].forEach(([tag, lines]) => {
    Object.keys(scenarios).forEach(name => {
      const s = base();
      s.lines = JSON.parse(JSON.stringify(lines));
      scenarios[name](s);
      normalize(s); syncManual(s);
      S = s;
      let res, err = null;
      try { res = optimize(); } catch(e) { err = e && e.stack || String(e); }
      out[name + ".L" + tag] = err ? { error: err } : __summarize(res);
    });
  });
  __emit(JSON.stringify(out, null, 2));
})();
`;

// bridge: expose summarize + emit into the eval scope via globals
globalThis.__summarize = summarize;
globalThis.__emit = (str) => process.stdout.write(str + "\n");

// direct eval keeps top-level const/let (S, optimize, ...) visible to the appended runner
// eslint-disable-next-line no-eval
eval(coreSrc + "\n;\n" + projectSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
