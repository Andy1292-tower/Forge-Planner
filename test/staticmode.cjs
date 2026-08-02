"use strict";
/* "Set & forget" line mode test (Node).
 *
 * Project mode can schedule a phase two ways (S.projLineMode):
 *   "split"  (default) — the makespan LP, where a line divides its time across jobs.
 *   "static" — one job per line for the WHOLE phase, never switched, chosen so the SLOWEST
 *              demanded item finishes as early as it can.
 *
 * What this pins down:
 *   a) static really is one-job-per-line: no line carries more than one entry, and every entry
 *      is a full-phase entry (frac === 1) — that's what the step plan renders as "(whole phase)".
 *   b) demand weighting works: per-item finish = net demand / rate, and with a 9:1 demand ratio the
 *      slowest and fastest item land within a discreteness tolerance of each other here. That is what
 *      weighting solveCore by net demand buys — it minimises the SLOWEST finish. It does NOT promise
 *      simultaneous finishes in general: the objective never penalises finishing early, so an item
 *      with spare line capacity can finish well ahead of the phase (see the M1 overshoot carry).
 *   c) the default is untouched: normalize() coerces a missing/garbage projLineMode to "split",
 *      and that path still runs the LP (which is free to split a line's time — frac < 1).
 *   d) solvePhaseFor still produces a usable eta in static mode (finite, > 0) — everything
 *      downstream of the schedule reads that.
 *
 * Determinism: performance.now() is frozen to 0 (as in parity.cjs) so the anytime solver runs to
 * exhaustion instead of racing a wall clock. Compression caps are kept small so that stays fast.
 *
 * Usage: node test/staticmode.cjs
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
  // Small caps keep the exhaustive (clock-frozen) search cheap; enough lines that the discrete
  // assignment has room to hit a 9:1 output ratio.
  const LINES = [
    {max:4, spx:5.0, turbo:0},
    {max:4, spx:4.5, turbo:0},
    {max:4, spx:4.0, turbo:0},
    {max:2, spx:3.5, turbo:0},
    {max:2, spx:3.0, turbo:0},
    {max:2, spx:2.5, turbo:0},
  ];
  // 9:1 demand. Absolute sizes don't matter to the schedule — only the ratio does.
  const DEMAND = { Plates: 90000, Glass: 10000 };
  function base(lineMode){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project";
    s.lines = JSON.parse(JSON.stringify(LINES));
    s.projects = [{id:"a",name:"P",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Plates",qty:DEMAND.Plates},{item:"Glass",qty:DEMAND.Glass}]}]}];
    if (lineMode !== undefined) s.projLineMode = lineMode;
    normalize(s); syncManual(s);
    return s;
  }
  // Per-item finish time in hours: what the phase still needs / the rate the plan makes it at.
  function finishes(ph){
    const o = {};
    ALLITEMS.forEach(it => {
      if (((ph.net && ph.net[it]) || 0) > 1e-9 && ((ph.rate && ph.rate[it]) || 0) > 1e-9)
        o[it] = ph.net[it] / ph.rate[it];
    });
    return o;
  }
  const results = [];
  const record = (name, pass, detail) => results.push({name, pass, detail});

  // ---- static ----
  S = base("static");
  const stat = optimize();
  const sp = stat.phases[0];
  const rows = (sp.plan || []).filter(p => p.entries && p.entries.length);
  const maxEntries = Math.max(0, ...(sp.plan || []).map(p => (p.entries || []).length));
  const allWhole = rows.every(p => p.entries.every(e => e.frac === 1));

  record("static: at most one job per line", maxEntries <= 1,
    "maxEntriesOnALine=" + maxEntries + " busyLines=" + rows.length);
  record("static: every entry runs the whole phase (frac===1)", rows.length > 0 && allWhole,
    "entries=" + rows.map(p => "#"+p.line+" "+p.entries.map(e=>e.item+"@"+e.lvl+" frac="+e.frac).join("/")).join(", "));

  // (b) demand weighting keeps the finishes in the same ballpark on this 9:1 case. Discreteness sets
  // the floor: a whole line is the smallest unit of capacity, so the ratio can never be exactly 1.
  // 1.5 leaves room for that without letting a genuinely lopsided plan (one item finishing twice as
  // late as the other) pass. This is a property of THIS case, not a guarantee of the mode.
  const fin = finishes(sp);
  const fv = Object.keys(fin).map(k => fin[k]);
  const spread = fv.length ? Math.max.apply(null, fv) / Math.min.apply(null, fv) : Infinity;
  record("static: demand weighting keeps finishes within a discreteness tolerance (ratio <= 1.5)",
    fv.length >= 2 && spread <= 1.5,
    "spread=" + spread.toFixed(3) + " " + Object.keys(fin).map(k => k+"="+fin[k].toFixed(3)+"h").join(" "));

  // (d) eta is what every downstream readout (phase header, total time, clock) is built from.
  record("static: eta is finite and positive", isFinite(sp.eta) && sp.eta > 0 && isFinite(stat.eta) && stat.eta > 0,
    "phaseEta=" + sp.eta + " totalEta=" + stat.eta + " feasible=" + stat.feasible);
  record("static: phase is feasible", stat.feasible === true && sp.feasible === true,
    "feasible=" + stat.feasible + " infeas=" + JSON.stringify(sp.infeasItems));

  // ---- default / split ----
  { const s = base(); delete s.projLineMode; normalize(s);
    record("normalize: missing projLineMode -> split", s.projLineMode === "split",
      "projLineMode=" + s.projLineMode); }
  { const s = base(); s.projLineMode = "nonsense"; normalize(s);
    record("normalize: garbage projLineMode -> split", s.projLineMode === "split",
      "projLineMode=" + s.projLineMode); }

  S = base(); delete S.projLineMode; normalize(S);
  const split = optimize();
  const xp = split.phases[0];
  const splitRows = (xp.plan || []).filter(p => p.entries && p.entries.length);
  const anyPartial = splitRows.some(p => p.entries.some(e => e.frac < 0.999));
  record("split (default): still solves feasibly", split.feasible === true && isFinite(split.eta) && split.eta > 0,
    "eta=" + split.eta + " feasible=" + split.feasible);
  record("split (default): LP is free to split a line's time (frac < 1)", anyPartial,
    "entries=" + splitRows.map(p => "#"+p.line+" "+p.entries.map(e=>e.item+"@"+e.lvl+":"+e.frac.toFixed(2)).join("/")).join(", "));
  // Set & forget trades speed for not having to babysit the lines, so it must never come out FASTER
  // than the LP that's allowed to split time — that would mean the LP left something on the table.
  record("static is never faster than split", stat.eta >= split.eta - 1e-9,
    "staticEta=" + stat.eta.toFixed(4) + " splitEta=" + split.eta.toFixed(4) +
    " (+" + (100*(stat.eta/split.eta - 1)).toFixed(1) + "%)");

  // ---- margin slider must NOT leak into a static project plan ----
  // solveCore honors S.margin ("may-work" paper shortfalls) for items/credits mode, but project
  // phases are strictly balanced — the splitting LP never reads the slider, so the mode switch must
  // not change that contract (staticSchedule passes tolOverride=0). If it leaked, the shortfall
  // would render as a bogus teal "from stock" row and consumeInv would charge phantom drawdown
  // against inventory carried to later phases.
  { S = base("static"); S.margin = 10; // 10% margin set — must be ignored by the project path
    const m = optimize(); const mp = m.phases[0];
    const worstShort = Math.max(0, ...(mp.balance || []).map(b => b.stock || 0));
    record("static: margin slider ignored (no paper shortfall / phantom stock draw)",
      m.feasible === true && worstShort <= 1e-6,
      "margin=10% worstStockDraw=" + worstShort + " feasible=" + m.feasible); }

  // ---- the structural limit of never switching a line ----
  // A static plan can't time-share, so it needs at least one line per DISTINCT job in the chain.
  // Frames needs five (Ingots, Bits, Plates, Rods, Frames), so four lines is genuinely unbuildable
  // as a static plan even though the splitting LP handles it. It has to report that honestly —
  // infeasible with the items named — not invent a plan or crash. renderProjectResults keys the
  // "needs one line per job" hint off exactly this.
  function framesOn(nLines, lineMode){
    const s = defaults(); s.dupe = 0; s.margin = 0; s.mode = "project"; s.projLineMode = lineMode;
    s.lines = Array.from({length:nLines}, (_,i) => ({max:4, spx:5 - i*0.2, turbo:0}));
    s.projects = [{id:"f",name:"F",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Frames",qty:100}]}]}];
    normalize(s); syncManual(s); S = s;
    return optimize();
  }
  const thin = framesOn(4, "static");
  record("static: too few lines -> honest infeasible, no crash",
    thin.feasible === false && (thin.infeasItems || []).indexOf("Frames") >= 0,
    "feasible=" + thin.feasible + " infeas=" + JSON.stringify(thin.infeasItems));
  const thinSplit = framesOn(4, "split");
  record("split still builds Frames on the same 4 lines (limit is static's, not the factory's)",
    thinSplit.feasible === true, "feasible=" + thinSplit.feasible + " eta=" + thinSplit.eta.toFixed(3));
  const wide = framesOn(6, "static");
  const wideRows = (wide.phases[0].plan || []).filter(p => p.entries && p.entries.length);
  record("static: enough lines -> Frames builds, still one job per line",
    wide.feasible === true && wideRows.every(p => p.entries.length === 1 && p.entries[0].frac === 1),
    "feasible=" + wide.feasible + " eta=" + wide.eta.toFixed(3) +
    " lines=" + wideRows.map(p => p.entries[0].item).join("/"));

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
