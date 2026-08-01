"use strict";
/* Independent mined-resource budgets in the integer items/credits solver. */
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const coreSrc = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(__dirname, "..", "js", "solver.js"), "utf8");

const runner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const consumes=(res,input)=>!!(res.balance||[]).find(x=>x.res===input&&x.cons>0);
  function base(){
    const s=defaults();s.dupe=0;s.margin=0;s.mode="items";
    s.lines=[{max:1,spx:1,turbo:0}];
    PRODUCTS.forEach(p=>s.targets[p]={on:p==="Batteries",w:1});
    s.forgie.Wire=1e12;s.forgie.Gel=1e12;
    s.minedIncome.Vespium=0;s.minedIncome.Hydracite=0;
    normalize(s);return s;
  }
  S=base();S.minedIncome.Vespium=1e30;
  let r=optimize();
  check("vespium cannot replace hydracite",!r.feasible||!(r.out.Batteries>0),"out="+(r.out.Batteries||0));
  S=base();S.minedIncome.Hydracite=300000000;
  r=optimize();
  const hu=(r.minedUsage||[]).find(x=>x.resource==="Hydracite");
  check("hydracite enables batteries",r.feasible&&(r.out.Batteries||0)>0,"out="+(r.out.Batteries||0));
  check("hydra use stays under income",hu&&hu.inputHr<=S.minedIncome.Hydracite*60+1,"use="+(hu&&hu.inputHr));
  S=base();S.lines=Array.from({length:2},()=>({max:1,spx:1,turbo:0}));
  S.forgie.Gel=347;S.minedIncome.Vespium=1e13;S.minedIncome.Hydracite=300000000;
  r=optimize();
  const fullUses=r.minedUsage||[];
  check("items battery pipeline uses both ores",r.feasible&&fullUses.some(x=>x.resource==="Vespium")&&fullUses.some(x=>x.resource==="Hydracite"),JSON.stringify(fullUses));
  check("items batteries consume wire and gel",consumes(r,"Wire")&&consumes(r,"Gel"),JSON.stringify(r.balance));
  S=base();S.margin=20;S.minedIncome.Hydracite=246549620.24783823;
  r=optimize();
  check("margin cannot borrow hydracite",!r.feasible||!(r.out.Batteries>0),"out="+(r.out.Batteries||0));
  S=base();S.margin=20;S.forgie.Gel=0;PRODUCTS.forEach(p=>S.targets[p].on=p==="Gel");
  S.minedIncome.Vespium=7966260543580.132;
  r=optimize();
  check("margin cannot borrow vespium",!r.feasible||!(r.out.Gel>0),"out="+(r.out.Gel||0));
  S=base();S.mode="credits";PRODUCTS.forEach(p=>S.targets[p].on=false);
  S.lines=Array.from({length:2},()=>({max:1,spx:1,turbo:0}));S.forgie.Gel=347;
  S.sellPrice.Batteries=10;S.minedIncome.Vespium=1e13;S.minedIncome.Hydracite=300000000;
  r=optimize();
  check("credits can select batteries",r.feasible&&r.bestItem==="Batteries","best="+r.bestItem);
  check("credits battery pipeline uses both ores",(r.minedUsage||[]).some(x=>x.resource==="Vespium")&&(r.minedUsage||[]).some(x=>x.resource==="Hydracite"),JSON.stringify(r.minedUsage));
  check("credits batteries consume wire and gel",consumes(r,"Wire")&&consumes(r,"Gel"),JSON.stringify(r.balance));
  S=base();PRODUCTS.forEach(p=>S.targets[p].on=p==="Reinforced Concrete");
  S.forgie.Bricks=1e12;S.forgie.Concrete=1e12;S.forgie.Frames=1e12;
  r=optimize();
  check("items can make reinforced concrete",r.feasible&&(r.out["Reinforced Concrete"]||0)>0,"out="+(r.out["Reinforced Concrete"]||0));
  S=base();S.mode="credits";PRODUCTS.forEach(p=>S.targets[p].on=false);
  [...RAWS,...PRODUCTS].forEach(p=>S.sellPrice[p]=null);S.sellPrice["Reinforced Concrete"]=10;
  S.forgie.Bricks=1e12;S.forgie.Concrete=1e12;S.forgie.Frames=1e12;
  r=optimize();
  check("credits can select reinforced concrete",r.feasible&&r.bestItem==="Reinforced Concrete","best="+r.bestItem);
  S=base();S.minedIncome.Hydracite=300000000;
  const direct=optimize(),directOut=direct.out.Batteries||0;
  S=JSON.parse(JSON.stringify(S));r=optimize();
  check("worker-cloned mined maps preserve result",Math.abs((r.out.Batteries||0)-directOut)<1e-9,"direct="+directOut+", clone="+(r.out.Batteries||0));
  if(fail)process.exitCode=1;
})();
`;

eval(coreSrc + "\n;\n" + solverSrc + "\n;\n" + runner);
