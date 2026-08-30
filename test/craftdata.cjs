"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
const fs=require("fs"),path=require("path");
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={getElementById:()=>({innerHTML:"",textContent:""})};
globalThis.performance={now:()=>0};
const core=fs.readFileSync(path.join(__dirname,"..","js","core.js"),"utf8");
const solver=fs.readFileSync(path.join(__dirname,"..","js","solver.js"),"utf8");
const runner=`
(function(){
  let fail=0;
  // Quantities are Decimals now (sell prices, mined incomes, recipe costs, inventory), so equality
  // has to be by value: Object.is on two Decimal instances compares identities and never matches.
  const same=(got,want)=>(got instanceof Decimal||want instanceof Decimal)
    ?(toDec(got)!==null&&toDec(want)!==null&&toDec(got).eq(toDec(want)))
    :Object.is(got,want);
  const eq=(name,got,want)=>{const ok=same(got,want);console.log((ok?"ok   ":"FAIL ")+name+" ["+got+" vs "+want+"]");if(!ok)fail++;};
  const near=(name,got,want)=>{const ok=Math.abs(got-want)<=1e-9*Math.max(1,Math.abs(want));console.log((ok?"ok   ":"FAIL ")+name+" ["+got+" vs "+want+"]");if(!ok)fail++;};
  const d=defaults();S=d;
  eq("8192 tier",LEVELS[LEVELS.length-2],8192);
  eq("16384 tier",LEVELS[LEVELS.length-1],16384);
  eq("16384 display",compressionLabel(16384),"16.38k×");
  eq("1× is level 0",compressionLevel(1),0);
  eq("64× is level 6",compressionLevel(64),6);
  eq("16384× is the top level",compressionLevel(16384),LEVELS.length-1);
  eq("every tier maps to its index",LEVELS.every((L,i)=>compressionLevel(L)===i),true);
  eq("default Worthless Rocks income is blank",d.minedIncome.Rocks?.resourcesTradingPerSec,null);
  eq("default Vespium Resources & Trading income is blank",d.minedIncome.Vespium?.resourcesTradingPerSec,null);
  eq("the retired Vespium rig source is not in the default shape",Object.prototype.hasOwnProperty.call(d.minedIncome.Vespium,"rigPerMin"),false);
  eq("default Hydracite Resources & Trading income is blank",d.minedIncome.Hydracite?.resourcesTradingPerSec,null);
  eq("default Worthless Rocks text is blank",d.minedIncomeText.Rocks?.resourcesTradingPerSec,"");
  eq("default Vespium Resources & Trading text is blank",d.minedIncomeText.Vespium?.resourcesTradingPerSec,"");
  eq("default Hydracite Resources & Trading text is blank",d.minedIncomeText.Hydracite?.resourcesTradingPerSec,"");
  const sourceState={minedIncome:{
    Rocks:{resourcesTradingPerSec:5},
    Vespium:{resourcesTradingPerSec:3},
    Hydracite:{resourcesTradingPerSec:4}
  }};
  // A mined budget is a Decimal (a late-game Vespium income is ~1e100/hr), so compare its value.
  const budget=(resource)=>minedBudgetHr(resource,sourceState).toNumber();
  eq("Vespium seconds aggregate to an hourly budget",budget("Vespium"),10800);
  eq("Hydracite seconds aggregate to an hourly budget",budget("Hydracite"),14400);
  eq("Worthless Rocks seconds aggregate to an hourly budget",budget("Rocks"),18000);
  eq("unknown mined resources have no budget",budget("Ingots"),0);
  eq("battery yield 1x",typeof craftYield==="function"?craftYield("Batteries",1):undefined,5);
  eq("battery yield 2x",typeof craftYield==="function"?craftYield("Batteries",2):undefined,10);
  eq("battery yield 4x",typeof craftYield==="function"?craftYield("Batteries",4):undefined,20);
  eq("ordinary recipe yield remains compression",typeof craftYield==="function"?craftYield("Wire",4):undefined,4);
  eq("reinforced bricks 1x",d.prodCost["Reinforced Concrete"].Bricks[1].toNumber(),10000);
  eq("reinforced concrete 1x",d.prodCost["Reinforced Concrete"].Concrete[1].toNumber(),100000);
  eq("reinforced frames 1x",d.prodCost["Reinforced Concrete"].Frames[1].toNumber(),700);
  eq("battery wire 1x",d.prodCost.Batteries.Wire[1].toNumber(),500);
  eq("battery gel 1x",d.prodCost.Batteries.Gel[1].toNumber(),100000);
  eq("battery hydracite 1x",minedCost("Batteries",1).Hydracite,5000000000000);
  eq("reinforced bricks 8192x",d.prodCost["Reinforced Concrete"].Bricks[8192].toNumber(),15943230000);
  eq("battery hydracite 16384x",minedCost("Batteries",16384).Hydracite,23914845000000000000);
  near("reinforced base time",d.baseTime["Reinforced Concrete"],355531.88);
  near("battery base time",d.baseTime.Batteries,1034274.56);
  near("reinforced time 8192x",craftTime("Reinforced Concrete",8192),69193439.15005371);
  near("battery time 16384x",craftTime("Batteries",16384),301935007.2002344);
  LEVELS.forEach((L,i)=>{
    near("reinforced cost scale "+L,d.prodCost["Reinforced Concrete"].Bricks[L],10000*Math.pow(3,i));
    near("battery ordinary cost scale "+L,d.prodCost.Batteries.Gel[L],100000*Math.pow(3,i));
    near("battery mined cost scale "+L,minedCost("Batteries",L).Hydracite,5e12*Math.pow(3,i));
    near("reinforced time scale "+L,craftTime("Reinforced Concrete",L),355531.88*Math.pow(1.5,i));
    near("battery time scale "+L,craftTime("Batteries",L),1034274.56*Math.pow(1.5,i));
  });
  setMinedIncome("Rocks","resourcesTradingPerSec","7.25qu");
  setMinedIncome("Vespium","resourcesTradingPerSec","3");
  setMinedIncome("Hydracite","resourcesTradingPerSec","-1");
  eq("game notation parsed into the selected source",S.minedIncome.Rocks?.resourcesTradingPerSec,7.25e18);
  eq("second mined source parsed independently",S.minedIncome.Vespium?.resourcesTradingPerSec,3);
  eq("negative mined income is off",S.minedIncome.Hydracite?.resourcesTradingPerSec,null);
  eq("sibling source edit leaves Worthless Rocks intact",S.minedIncome.Rocks?.resourcesTradingPerSec,7.25e18);
  const legacy=defaults();delete legacy.minedIncome;delete legacy.minedIncomeText;
  legacy.gelVesp=7250000000000000000;legacy.gelVespText="7.25qu";
  legacy.baseTime.Wire=12345;legacy.prodCost.Wire.Gel[4]=999;
  normalize(legacy);
  // The legacy scalar was the rig figure, read per minute; it survives as the per-second source it
  // is now entered in, so the same Vespium/hr budget comes back out.
  eq("legacy vesp value carries over at the same hourly budget",minedBudgetHr("Vespium",legacy).toString(),"435000000000000000000");
  eq("legacy per-minute text is not shown against a per-second field",legacy.minedIncomeText.Vespium?.resourcesTradingPerSec==="7.25qu",false);
  eq("custom base time preserved",legacy.baseTime.Wire,12345);
  eq("custom recipe cost preserved",legacy.prodCost.Wire.Gel[4],999);
  eq("new Hydracite source blank",legacy.minedIncome.Hydracite?.resourcesTradingPerSec,null);
  eq("legacy numeric removed",Object.prototype.hasOwnProperty.call(legacy,"gelVesp"),false);
  eq("legacy text removed",Object.prototype.hasOwnProperty.call(legacy,"gelVespText"),false);
  if(fail)process.exitCode=1;
})();`;
eval(core+"\n"+solver+"\n"+runner);
