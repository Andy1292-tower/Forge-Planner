"use strict";
/* Independent mined-resource budgets in the integer items/credits solver. */
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
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const consumes=(res,input)=>!!(res.balance||[]).find(x=>x.res===input&&x.cons>0);
  const setVesp=(s,value)=>{s.minedIncome.Vespium.rigPerMin=value;};
  const setHydraPerMin=(s,value)=>{s.minedIncome.Hydracite.resourcesTradingPerSec=value/60;};
  function base(){
    const s=defaults();s.dupe=0;s.margin=0;s.mode="items";
    s.lines=[{max:1,spx:1,turbo:0}];
    PRODUCTS.forEach(p=>s.targets[p]={on:p==="Batteries",w:1});
    s.forgie.Wire=1e12;s.forgie.Gel=1e12;
    setVesp(s,0);setHydraPerMin(s,0);
    normalize(s);return s;
  }
  S=base();setVesp(S,1e30);
  let r=optimize();
  check("vespium cannot replace hydracite",!r.feasible||!(r.out.Batteries>0),"out="+(r.out.Batteries||0));
  S=base();setHydraPerMin(S,300000000);
  r=optimize();
  const hu=(r.minedUsage||[]).find(x=>x.resource==="Hydracite");
  const wire=(r.balance||[]).find(x=>x.res==="Wire"),gel=(r.balance||[]).find(x=>x.res==="Gel");
  check("hydracite enables batteries",r.feasible&&(r.out.Batteries||0)>0,"out="+(r.out.Batteries||0));
  check("hydra use stays under income",hu&&hu.inputHr<=minedBudgetHr("Hydracite",S)+1,"use="+(hu&&hu.inputHr));
  check("items Batteries output is five units per physical craft",
    Math.abs((r.out.Batteries||0)-0.01740350260572976)<=1e-15,"out="+(r.out.Batteries||0));
  check("items Batteries keep Wire consumption per craft",
    wire&&Math.abs(wire.cons-1.7403502605729757)<=1e-12,"wire="+(wire&&wire.cons));
  check("items Batteries keep Gel consumption per craft",
    gel&&Math.abs(gel.cons-348.0700521145951)<=1e-9,"gel="+(gel&&gel.cons));
  check("items Batteries keep Hydracite consumption per craft",
    hu&&Math.abs(hu.inputHr-17403502605.72976)<=1e-5,"hydra="+(hu&&hu.inputHr));
  S=base();S.dupe=50;setHydraPerMin(S,300000000);r=optimize();
  const dupWire=(r.balance||[]).find(x=>x.res==="Wire");
  check("items Batteries duplication increases output only",
    Math.abs((r.out.Batteries||0)-0.02610525390859464)<=1e-15&&
      dupWire&&Math.abs(dupWire.cons-1.7403502605729757)<=1e-12,
    "out="+(r.out.Batteries||0)+", wire="+(dupWire&&dupWire.cons));
  S=base();S.lines=Array.from({length:2},()=>({max:1,spx:1,turbo:0}));
  S.forgie.Gel=347;setVesp(S,1e13);setHydraPerMin(S,300000000);
  r=optimize();
  const fullUses=r.minedUsage||[];
  check("items battery pipeline uses both ores",r.feasible&&fullUses.some(x=>x.resource==="Vespium")&&fullUses.some(x=>x.resource==="Hydracite"),JSON.stringify(fullUses));
  check("items batteries consume wire and gel",consumes(r,"Wire")&&consumes(r,"Gel"),JSON.stringify(r.balance));
  S=base();S.margin=20;setHydraPerMin(S,246549620.24783823);
  r=optimize();
  check("margin cannot borrow hydracite",!r.feasible||!(r.out.Batteries>0),"out="+(r.out.Batteries||0));
  S=base();S.margin=20;S.forgie.Gel=0;PRODUCTS.forEach(p=>S.targets[p].on=p==="Gel");
  setVesp(S,7966260543580.132);
  r=optimize();
  check("margin cannot borrow vespium",!r.feasible||!(r.out.Gel>0),"out="+(r.out.Gel||0));
  S=base();S.dupe=50;S.forgie.Gel=0;PRODUCTS.forEach(p=>S.targets[p].on=p==="Gel");
  setVesp(S,1e30);
  r=optimize();
  const gelRow=(r.plan||[]).find(p=>p.job&&p.job.res==="Gel"),rocks=(r.minedUsage||[]).find(x=>x.item==="Gel"&&x.resource==="Rocks");
  const rockExpected=1e23/3201*3600;
  check("items report real informational Rocks consumption",rocks&&Math.abs(rocks.inputHr-rockExpected)<=1e-9*Math.max(1,rockExpected),"use="+(rocks&&rocks.inputHr)+", expected="+rockExpected);
  check("Rocks consumption is not duplicated",rocks&&rocks.outHr>0&&Math.abs(rocks.inputHr/rockExpected-1)<=1e-9,"use="+(rocks&&rocks.inputHr)+", dup="+dupeMult());
  S=base();S.mode="credits";PRODUCTS.forEach(p=>S.targets[p].on=false);
  S.lines=Array.from({length:2},()=>({max:1,spx:1,turbo:0}));S.forgie.Gel=347;
  S.sellPrice.Batteries=10;setVesp(S,1e13);setHydraPerMin(S,300000000);
  r=optimize();
  check("credits can select batteries",r.feasible&&r.bestItem==="Batteries","best="+r.bestItem);
  check("credits battery pipeline uses both ores",(r.minedUsage||[]).some(x=>x.resource==="Vespium")&&(r.minedUsage||[]).some(x=>x.resource==="Hydracite"),JSON.stringify(r.minedUsage));
  check("credits batteries consume wire and gel",consumes(r,"Wire")&&consumes(r,"Gel"),JSON.stringify(r.balance));
  S=base();S.mode="credits";PRODUCTS.forEach(p=>S.targets[p].on=false);
  [...RAWS,...PRODUCTS].forEach(item=>S.sellPrice[item]=null);S.sellPrice.Batteries=10;
  setHydraPerMin(S,300000000);r=optimize();
  const creditBattery=(r.ranking||[]).find(candidate=>candidate.item==="Batteries");
  check("credits Batteries output uses five-unit craft yield",
    creditBattery&&Math.abs(creditBattery.out-0.01740350260572976)<=1e-15,
    "out="+(creditBattery&&creditBattery.out));
  check("credits Batteries revenue uses corrected output",
    creditBattery&&Math.abs(creditBattery.credits-0.1740350260572976)<=1e-15,
    "credits="+(creditBattery&&creditBattery.credits));
  S=base();PRODUCTS.forEach(p=>S.targets[p].on=p==="Reinforced Concrete");
  S.forgie.Bricks=1e12;S.forgie.Concrete=1e12;S.forgie.Frames=1e12;
  r=optimize();
  check("items can make reinforced concrete",r.feasible&&(r.out["Reinforced Concrete"]||0)>0,"out="+(r.out["Reinforced Concrete"]||0));
  S=base();S.mode="credits";PRODUCTS.forEach(p=>S.targets[p].on=false);
  [...RAWS,...PRODUCTS].forEach(p=>S.sellPrice[p]=null);S.sellPrice["Reinforced Concrete"]=10;
  S.forgie.Bricks=1e12;S.forgie.Concrete=1e12;S.forgie.Frames=1e12;
  r=optimize();
  check("credits can select reinforced concrete",r.feasible&&r.bestItem==="Reinforced Concrete","best="+r.bestItem);
  function frozenGelSolve(mode){
    const s=defaults();s.dupe=0;s.maxTurbo=0;s.margin=0;s.mode=mode;
    s.lines=[{max:1,spx:6,turbo:0},{max:1,spx:4,turbo:0},{max:1,spx:4,turbo:0}];
    setVesp(s,4498594189315839/60);
    PRODUCTS.forEach(product=>s.targets[product]={on:mode==="items"&&product==="Gel",w:1});
    [...RAWS,...PRODUCTS].forEach(item=>s.sellPrice[item]=null);
    if(mode==="credits")s.sellPrice.Gel=1;
    normalize(s);syncManual(s);S=s;return optimize();
  }
  const frozenItems=frozenGelSolve("items"),frozenCredits=frozenGelSolve("credits");
  const creditCandidate=(frozenCredits.ranking||[]).find(candidate=>candidate.item==="Gel");
  const itemGel=frozenItems.out.Gel||0,creditGel=creditCandidate&&creditCandidate.out||0;
  check("items keeps the frozen exact Gel optimum",Math.abs(itemGel-8.997188378631677)<=1e-12,"out="+itemGel);
  check("credits keeps Items Gel parity",frozenCredits.bestItem==="Gel"&&Math.abs(creditGel-itemGel)<=1e-12,
    "items="+itemGel+", credits="+creditGel);
  check("frozen Items and Credits stay inside Vespium budget",
    [frozenItems,frozenCredits].every(result=>(result.minedUsage||[])
      .filter(use=>use.resource==="Vespium").reduce((sum,use)=>sum+use.inputHr,0)<=4498594189315839),
    "items="+JSON.stringify(frozenItems.minedUsage)+", credits="+JSON.stringify(frozenCredits.minedUsage));
  S=base();setHydraPerMin(S,300000000);
  const direct=optimize(),directOut=direct.out.Batteries||0;
  S=JSON.parse(JSON.stringify(S));r=optimize();
  check("worker-cloned mined maps preserve result",Math.abs((r.out.Batteries||0)-directOut)<1e-9,"direct="+directOut+", clone="+(r.out.Batteries||0));
  if(fail)process.exitCode=1;
})();
`;

eval(coreSrc + "\n;\n" + projectSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
