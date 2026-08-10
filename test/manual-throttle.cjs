"use strict";
/* Manual-mode sustained (throttled) rates.
 *
 * A line only crafts while it holds materials, so an input that can't keep up doesn't leave the
 * balance negative forever — it idles the lines downstream of it. manualResult() solves a duty
 * cycle per line and reports what the setup actually sustains alongside the flat-out plan.
 *
 * Verifies:
 *  - a starved line's duty cycle is supply/demand, and its sustained output scales with it;
 *  - a setup whose inputs balance exactly is not thrown off the flat-out rate by rounding;
 *  - shares of one short pool are max-min fair: a line capped by a different input hands its
 *    unusable share back instead of hoarding it (the case naive proportional splitting gets wrong);
 *  - a starved consumer leaves its other inputs in genuine surplus;
 *  - throttling propagates down a two-deep chain (the supply feedback pass);
 *  - a mined-income budget throttles its craft the same way an item input does;
 *  - credits price the sustained surplus, not the flat-out one;
 *  - the readout names the shortfall and shows sustained beside flat-out.
 *
 * Usage: node test/manual-throttle.cjs
 */
const fs = require("fs");
const path = require("path");

class El {
  constructor(){this.innerHTML="";this.textContent="";this.value="";this.children=[];this.style={};this.attributes={};}
  setAttribute(name,value){this.attributes[name]=String(value);}
  appendChild(x){this.children.push(x);return x;}
  replaceChildren(...xs){this.children=xs;}
}
const els = {};
globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = {
  getElementById: id => (els[id] || (els[id] = new El())),
  createElement: () => new El(),
  querySelectorAll: () => []
};

const src = ["core.js", "fields.js", "dom.js", "project-schedule.js", "solver.js", "results.js", "manual.js"]
  .map(f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8")).join("\n;\n");

const runner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const near=(a,b)=>Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
  const close=(name,actual,expected)=>check(name,near(actual,expected),"got "+actual+", expected "+expected);

  // Every line: 1× speed, no turbo, no duplication, level 1, and a one-second base craft. That
  // makes each line 3600 crafts/hr, so an input costing N per craft draws N*3600/hr — the whole
  // suite's arithmetic is readable off the recipe costs.
  function rig(jobs){
    const s=defaults();
    s.dupe=0;s.maxTurbo=0;s.mode="manual";
    ALLITEMS.forEach(it=>{s.baseTime[it]=1;});
    s.lines=jobs.map(()=>({max:1,spx:1,turbo:0}));
    s.manual=jobs.map(job=>({job,lvl:1,sell:false}));
    return s;
  }
  const cost=(s,product,input,v)=>{s.prodCost[product][input][1]=v;};
  const dutyOf=(r,line)=>r.plan[line].duty;

  // ---- a starved line runs at supply/demand ----
  S=rig(["Ingots","Plates"]);cost(S,"Plates","Ingots",4);syncManual(S);
  let r=manualResult();
  close("starved line duty is supply over demand",dutyOf(r,1),0.25);
  close("feeder line stays flat out",dutyOf(r,0),1);
  close("sustained output scales with the duty cycle",r.sustained.lineProd.Plates,900);
  close("the short input is fully consumed, not overdrawn",r.sustained.out.Ingots,0);
  close("flat-out plan still reports the raw shortfall",r.out.Ingots,-10800);
  check("shortfall is flagged",r.throttled===true,"throttled="+r.throttled);

  // ---- an exactly-fed setup is not nudged off 1 by the solve's own rounding ----
  S=rig(["Ingots","Plates"]);cost(S,"Plates","Ingots",1);syncManual(S);
  r=manualResult();
  check("exactly-fed line runs flat out",dutyOf(r,1)===1,"duty="+dutyOf(r,1));
  check("exactly-fed setup is not flagged as short",r.throttled===false,"throttled="+r.throttled);
  close("exactly-fed input has no sustained surplus",r.sustained.out.Ingots,0);
  close("exactly-fed output matches the flat-out rate",r.sustained.out.Plates,3600);

  // ---- max-min fair shares: Frames is Plates-capped, so Wire gets the Rods it can't use ----
  // The Rods line is fed its 7200 Ingots/hr and makes 3600 Rods/hr. Frames and Wire each want all
  // of it, but Frames is held to 25% by its Plates supply, so it only draws 900 — leaving 2700
  // (75% of a line) for Wire. Splitting the pool in proportion to headline demand instead would
  // strand Wire at 50%.
  S=rig(["Rods","Frames","Wire"]);
  cost(S,"Frames","Plates",1);cost(S,"Frames","Rods",1);
  cost(S,"Wire","Gel",1);cost(S,"Wire","Rods",1);
  S.forgie.Ingots=7200;S.forgie.Plates=900;S.forgie.Gel=1e12;syncManual(S);
  r=manualResult();
  close("line capped by another input takes only what it can use",dutyOf(r,1),0.25);
  close("the unused share goes to the other consumer",dutyOf(r,2),0.75);
  close("the shared pool is fully allocated",r.sustained.out.Rods,0);
  close("sustained Wire output follows its share",r.sustained.lineProd.Wire,2700);

  // ---- a starved consumer leaves its other inputs in real surplus ----
  S=rig(["Rods","Frames"]);
  cost(S,"Frames","Plates",1);cost(S,"Frames","Rods",1);
  S.forgie.Ingots=7200;S.forgie.Plates=900;syncManual(S);
  r=manualResult();
  close("Plates-capped Frames line",dutyOf(r,1),0.25);
  close("flat-out plan shows Rods exactly consumed",r.out.Rods,0);
  close("sustained plan shows the Rods the starved line never eats",r.sustained.out.Rods,2700);

  // ---- throttling propagates down a two-deep chain ----
  // Ingots 3600/hr feed a Rods line wanting 7200 (50%), whose 1800 Rods/hr then feed a Wire line
  // wanting 3600 (50% in turn). Only the supply feedback pass catches the second step.
  S=rig(["Ingots","Rods","Wire"]);
  cost(S,"Rods","Ingots",2);cost(S,"Wire","Rods",1);cost(S,"Wire","Gel",1);
  S.forgie.Gel=1e12;syncManual(S);
  r=manualResult();
  close("first stage halves",dutyOf(r,1),0.5);
  close("second stage halves again",dutyOf(r,2),0.5);
  close("mid-chain resource ends fully consumed",r.sustained.out.Rods,0);
  close("end of chain sustains a quarter of nameplate",r.sustained.lineProd.Wire,1800);

  // ---- a mined-income budget throttles its craft like any other input ----
  // Gel costs 5e14 Vespium per craft, so a flat-out line burns 1.8e18/hr. Half that income halves
  // the line. (rigPerMin is per minute — 1.5e16/min is 9e17/hr.)
  S=rig(["Gel"]);S.minedIncome.Vespium.rigPerMin=1.5e16;syncManual(S);
  r=manualResult();
  close("mined income throttles the craft",dutyOf(r,0),0.5);
  close("sustained Gel follows the budget",r.sustained.lineProd.Gel,1800);
  const vesp=(r.minedBalances||[]).find(x=>x.resource==="Vespium");
  close("mined row keeps the flat-out burn",vesp&&vesp.consHr,1.8e18);
  close("mined row reports what is actually spent",vesp&&vesp.consActualHr,9e17);

  // ---- idle lines are not starved lines ----
  S=rig(["Ingots","Idle"]);syncManual(S);
  r=manualResult();
  check("idle line is not counted as throttled",r.throttled===false&&dutyOf(r,1)===1,
    "throttled="+r.throttled+", duty="+dutyOf(r,1));

  // ---- credits price the sustained surplus ----
  S=rig(["Ingots","Plates"]);cost(S,"Plates","Ingots",4);
  S.manual[1].sell=true;S.sellPrice.Plates=2;syncManual(S);
  r=manualResult();
  close("credits use the sustained surplus",r.totalCredits,1800);
  close("the flat-out surplus is kept for context",r.creditRows[0].surplusFull,3600);

  // ---- readout ----
  S=rig(["Ingots","Plates"]);cost(S,"Plates","Ingots",4);syncManual(S);
  let el=new El(),stat=new El();renderManual(el,stat);
  check("readout names the shortfall",/Running short/.test(el.innerHTML),el.innerHTML.slice(0,300));
  check("readout gives the duty cycle",el.innerHTML.includes("runs 25% of the time"),el.innerHTML.slice(0,300));
  check("readout shows sustained beside flat out",
    el.innerHTML.includes(">"+disp(900))&&el.innerHTML.includes("of "+disp(3600)),
    "sustained="+disp(900)+", flat out="+disp(3600));
  check("readout marks the balance table as the flat-out picture",
    el.innerHTML.includes("every line flat out"),el.innerHTML.slice(0,300));

  S=rig(["Ingots","Plates"]);cost(S,"Plates","Ingots",1);syncManual(S);
  el=new El();stat=new El();renderManual(el,stat);
  check("a setup that keeps up says nothing about running short",!/Running short/.test(el.innerHTML),
    el.innerHTML.slice(0,300));
  check("a setup that keeps up leaves the line table unqualified",
    !el.innerHTML.includes("of the time")&&!el.innerHTML.includes("(flat out)"),el.innerHTML.slice(0,300));

  if(fail)process.exitCode=1;
})();
`;

eval(src + "\n" + runner);
