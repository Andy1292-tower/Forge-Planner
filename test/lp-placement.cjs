"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* A plan that fits the current line caps is found at those caps (Node).
 *
 * Raising a line's compression cap only adds jobs; every plan the lower cap allowed is still there.
 * So when the higher-cap solve returns a plan that runs the raised line no higher than the old cap,
 * that plan was available to the lower-cap solve, and the lower-cap solve may not report less.
 *
 * On the reporter's factory it reported 410.6 Reinforced Concrete/hr with Line 6 at 512x and
 * 448.28/hr with Line 6 at 1024x, where the 1024x plan runs Line 6 on Bricks at 512x (issue #182).
 * The two plans differ on four lines at once: Reinforced Concrete moves from Line 2 onto the fastest
 * line, Line 2 produces Concrete, Line 6 doubles its Bricks and Line 7 takes over Frames. Every
 * one- and two-line step between them is infeasible or scores lower.
 *
 * The LP relaxation runs Lines 1, 3, 4 and 5 entirely on Reinforced Concrete. Holding the lines the
 * relaxation puts wholly on a checked output and enumerating the rest exactly reaches the 448.28
 * plan at either cap.
 *
 * Pinned here:
 *   - the property: Line 6 at 512x is not below Line 6 at 1024x when the 1024x plan fits 512x;
 *   - the reported factory reaches the 448.28 plan at 512x, at two Frames supplies that missed it;
 *   - the answer stays under its own LP ceiling.
 *
 * The reporter's screenshots show the Concrete, Ingots, Bricks and Reinforced Concrete supplies; the
 * Frames, Plates and Rods rows are cropped. Frames at 150,000/hr reproduces both reported rates and
 * both reported assignments exactly; Plates and Rods do not change either result anywhere from
 * 600k to 3m/hr.
 *
 * Sibling of single-output-restart.cjs (issue #164) and feeder-plateau.cjs (issue #134).
 *
 * Usage: node test/lp-placement.cjs
 */
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

globalThis.performance = performance;
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const ROOT = path.join(__dirname, "..");
const src = ["js/decimal.js", "js/core.js", "js/fields.js", "js/project-schedule.js", "js/solver.js"]
  .map(file => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");

const FIXTURE = JSON.stringify(
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "state", "lp-placement.json"), "utf8")));

// The 1024x plan's rate: Lines 1, 3, 4 and 5 on Reinforced Concrete at 1x plus 59.54/hr passive.
const REACHABLE_RC_HR = 448.28;

const runner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const rate=n=>Number(n).toFixed(2);
  const RC="Reinforced Concrete";

  const fixture=JSON.parse(${JSON.stringify(FIXTURE)});
  const solve=(line6Max,frames)=>{
    S=Object.assign(defaults(),JSON.parse(JSON.stringify(fixture)));
    S.lines[5].max=line6Max;
    if(frames!=null)S.forgie.Frames=String(frames);
    normalize(S);syncManual(S);
    _soloMaxCache={key:"",values:{}};
    return optimize();
  };
  const layout=r=>(r.plan||[]).map(p=>p.job&&p.job.kind!=="idle"?p.job.res+" "+p.job.lvl+"x":"Idle").join(", ");

  const at512=solve(512),at1024=solve(1024);
  const line6=(at1024.plan||[])[5],line6Lvl=line6&&line6.job&&line6.job.lvl||0;

  /* ---- the property: a higher cap the plan does not use cannot be what finds it ---- */
  check("the 1024x plan runs Line 6 within the 512x cap",
    line6Lvl<=512,"Line 6: "+(line6&&line6.job?line6.job.kind+" "+line6.job.res+" "+line6Lvl+"x":"none"));
  check("Line 6 at 512x is not below Line 6 at 1024x",
    (at512.out[RC]||0)>=(at1024.out[RC]||0)-1e-6,
    "512x="+rate(at512.out[RC]||0)+"/hr  1024x="+rate(at1024.out[RC]||0)+"/hr");

  /* ---- the symptom: the reported factory reaches the 448.28 plan at its current caps ---- */
  for(const frames of [150000,152000]){
    const r=frames===150000?at512:solve(512,frames);
    check("Line 6 at 512x reaches the 448.28 plan with Frames supply "+frames+"/hr",
      (r.out[RC]||0)>=${REACHABLE_RC_HR},
      "RC="+rate(r.out[RC]||0)+"/hr  floor=${REACHABLE_RC_HR}  (410.60 before)  plan: "+layout(r));
  }

  /* ---- and it is still a legal answer ---- */
  check("the reported rate stays under its own LP ceiling",
    !Number.isFinite(at512.bound)||at512.objective<=at512.bound*(1+1e-6),
    "objective="+rate(at512.objective)+" bound="+(at512.bound==null?"null":rate(at512.bound)));

  return fail;
})()
`;

const failures = eval(src + "\n" + runner);
console.log("");
console.log(failures ? (failures + " LP placement test(s) failed") : "all LP placement tests passed");
process.exit(failures ? 1 : 0);
