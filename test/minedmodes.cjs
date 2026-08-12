"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* Project and Manual mode integration for independent mined-resource budgets. */
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const coreSrc = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");
const projectSrc = fs.readFileSync(path.join(__dirname, "..", "js", "project-schedule.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(__dirname, "..", "js", "solver.js"), "utf8");
const manualSrc = fs.readFileSync(path.join(__dirname, "..", "js", "manual.js"), "utf8");

const runner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const setVesp=(s,value)=>{s.minedIncome.Vespium.rigPerMin=value;};
  const setHydraPerMin=(s,value)=>{s.minedIncome.Hydracite.resourcesTradingPerSec=value/60;};
  function project(vesp,hydra){
    const s=defaults();s.mode="project";s.dupe=0;
    s.lines=Array.from({length:6},(_,i)=>({max:i<2?16:4,spx:10,turbo:0}));
    setVesp(s,vesp);setHydraPerMin(s,hydra);
    s.projects=[{id:"battery",name:"Battery test",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Batteries",qty:1}]}]}];
    normalize(s);return s;
  }
  S=project(1e30,0);let r=optimize();
  check("project names hydracite blocker",r.blockedMined&&r.blockedMined.Batteries&&r.blockedMined.Batteries.includes("Hydracite"),JSON.stringify(r.blockedMined));
  S=project(0,1e30);r=optimize();
  check("project names vespium blocker",r.blockedMined&&r.blockedMined.Batteries&&r.blockedMined.Batteries.includes("Vespium"),JSON.stringify(r.blockedMined));
  S=project(1e30,0);
  S.projects=[{id:"mixed",name:"Mixed test",catId:"",on:true,from:1,to:1,done:0,prio:null,
    levels:[{costs:[{item:"Frames",qty:1},{item:"Batteries",qty:1}]}]}];
  r=optimize();
  check("mixed blocked project stays incomplete",r.feasible===false&&r.partial===true&&r.blockedMined&&r.blockedMined.Batteries&&r.blockedMined.Batteries.includes("Hydracite"),"feasible="+r.feasible+", partial="+r.partial);
  check("mixed project keeps an explicitly partial plan",r.rate.Frames>0&&r.eta>0,"frames="+r.rate.Frames+", eta="+r.eta);
  S=project(1e30,1e30);r=optimize();
  const uses=(r.phases[0]&&r.phases[0].minedUsage)||[];
  check("full battery project feasible",r.feasible&&r.eta>0,"eta="+r.eta);
  check("project uses separate ores",uses.some(x=>x.resource==="Vespium")&&uses.some(x=>x.resource==="Hydracite"),JSON.stringify(uses));
  ["Wire","Gel"].forEach(input=>{
    const row=(r.phases[0].balance||[]).find(x=>x.res===input);
    check("project batteries consume "+input,row&&row.cons>0,"cons="+(row&&row.cons));
  });
  const rockUse=uses.find(x=>x.item==="Gel"&&x.resource==="Rocks");
  let expectedRocks=0;
  (r.phases[0].plan||[]).forEach(p=>(p.entries||[]).forEach(e=>{
    if(e.item!=="Gel")return;
    const tier=Math.log2(e.lvl),ct=3201*Math.pow(1.5,tier),cost=1e23*Math.pow(3,tier);
    expectedRocks+=(cost/ct)*Math.min(p.sp,ct)*(e.frac||0)*3600;
  }));
  check("project reports real informational Rocks consumption",rockUse&&Math.abs(rockUse.inputHr-expectedRocks)<=1e-9*Math.max(1,expectedRocks),"use="+(rockUse&&rockUse.inputHr)+", expected="+expectedRocks);

  S=defaults();S.mode="project";S.projLineMode="split";S.dupe=0;
  S.lines=[{max:1,spx:1,turbo:0}];S.forgie.Wire=1e30;S.forgie.Gel=1e30;
  setVesp(S,1e30);S.minedIncome.Hydracite.resourcesTradingPerSec=1e30;
  S.projects=[{id:"battery-five",name:"One Battery craft",catId:"",on:true,from:1,to:1,done:0,prio:null,
    levels:[{costs:[{item:"Batteries",qty:5}]}]}];normalize(S);
  r=optimize();
  const exactPhase=r.phases[0],exactEntry=(exactPhase.plan||[]).flatMap(p=>p.entries||[]).find(e=>e.item==="Batteries");
  const exactWire=(exactPhase.balance||[]).find(x=>x.res==="Wire"),exactGel=(exactPhase.balance||[]).find(x=>x.res==="Gel");
  const exactHydra=(exactPhase.minedUsage||[]).find(x=>x.item==="Batteries"&&x.resource==="Hydracite");
  check("split project completes five Batteries in one physical craft",
    r.feasible&&Math.abs(r.eta-287.2984888888889)<=1e-9,
    "eta="+r.eta+", feasible="+r.feasible);
  check("split project replays corrected Batteries outHr",
    exactEntry&&Math.abs(exactEntry.outHr-0.01740350260572976)<=1e-15&&
      Math.abs((exactPhase.rate.Batteries||0)-0.01740350260572976)<=1e-15,
    "entry="+(exactEntry&&exactEntry.outHr)+", rate="+(exactPhase.rate.Batteries||0));
  check("split project keeps Batteries inputs per physical craft",
    exactWire&&exactGel&&exactHydra&&
      Math.abs(exactWire.cons-1.7403502605729757)<=1e-12&&
      Math.abs(exactGel.cons-348.0700521145951)<=1e-9&&
      Math.abs(exactHydra.inputHr-17403502605.72976)<=1e-5,
    "wire="+(exactWire&&exactWire.cons)+", gel="+(exactGel&&exactGel.cons)+", hydra="+(exactHydra&&exactHydra.inputHr));

  S=project(1e40,1e40);
  S.lines=Array.from({length:5},()=>({max:1,spx:1,turbo:0}));
  S.projects=[{id:"skewed",name:"Skewed mixed project",catId:"",on:true,from:1,to:1,done:0,prio:null,
    levels:[{costs:[{item:"Concrete",qty:1e10},{item:"Batteries",qty:1}]}]}];
  r=optimize();
  const skewPlan=(r.phases[0]&&r.phases[0].plan)||[];
  const skewItems=skewPlan.flatMap(p=>(p.entries||[]).map(e=>e.item));
  const skewUses=(r.phases[0]&&r.phases[0].minedUsage)||[];
  check("skewed mixed project remains feasible",r.feasible&&r.eta>0,"feasible="+r.feasible+", eta="+r.eta);
  check("skewed mixed project keeps executable Battery assignment",skewItems.includes("Batteries"),JSON.stringify(skewPlan));
  check("skewed mixed project keeps executable Gel assignment",skewItems.includes("Gel"),JSON.stringify(skewPlan));
  check("skewed mixed project keeps separate mined usage",skewUses.some(x=>x.item==="Batteries"&&x.resource==="Hydracite")&&skewUses.some(x=>x.item==="Gel"&&x.resource==="Vespium"),JSON.stringify(skewUses));
  S=project(0,0);
  S.projects=[{id:"reinforced",name:"Reinforced test",catId:"",on:true,from:1,to:1,done:0,prio:null,
    levels:[{costs:[{item:"Reinforced Concrete",qty:1}]}]}];
  r=optimize();
  const rcUses=(r.phases[0]&&r.phases[0].minedUsage)||[];
  check("reinforced project needs no mined income",r.feasible&&r.eta>0&&rcUses.length===0,"eta="+r.eta+", uses="+JSON.stringify(rcUses)+", lp="+r.lpFeasible+", failure="+JSON.stringify(r.scheduleValidation&&r.scheduleValidation.firstFailure));
  S=defaults();S.dupe=0;S.lines=Array.from({length:3},()=>({max:1,spx:1,turbo:0}));
  setVesp(S,1e15);setHydraPerMin(S,1e9);
  S.manual=[{job:"Gel",lvl:1,sell:false},{job:"Batteries",lvl:1,sell:false},{job:"Reinforced Concrete",lvl:1,sell:false}];syncManual(S);
  const m=manualResult(),mb=m.minedBalances||[],v=mb.find(x=>x.resource==="Vespium"),h=mb.find(x=>x.resource==="Hydracite");
  check("manual tracks vespium",v&&v.consHr>0,"vesp="+(v&&v.consHr));
  check("manual tracks hydracite",h&&h.consHr>0,"hydra="+(h&&h.consHr));
  // incomeHr is a Decimal (a late-game mined income outgrows a float64), so compare by value.
  check("manual budgets stay distinct",v&&h&&v.incomeHr.eq(6e16)&&h.incomeHr.eq(6e10),JSON.stringify(mb));
  ["Wire","Gel"].forEach(input=>{
    const row=m.balance.find(x=>x.res===input);
    check("manual batteries consume "+input,row&&row.cons>0,"cons="+(row&&row.cons));
  });
  ["Bricks","Concrete","Frames"].forEach(input=>{
    const row=m.balance.find(x=>x.res===input);
    check("manual reinforced consumes "+input,row&&row.cons>0,"cons="+(row&&row.cons));
  });
  if(fail)process.exitCode=1;
})();
`;

eval(coreSrc + "\n;\n" + projectSrc + "\n;\n" + solverSrc + "\n;\n" + manualSrc + "\n;\n" + runner);
