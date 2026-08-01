"use strict";
/* Project and Manual mode integration for independent mined-resource budgets. */
const fs = require("fs");
const path = require("path");

globalThis.performance = { now: () => 0 };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "" }) };

const coreSrc = fs.readFileSync(path.join(__dirname, "..", "js", "core.js"), "utf8");
const solverSrc = fs.readFileSync(path.join(__dirname, "..", "js", "solver.js"), "utf8");
const manualSrc = fs.readFileSync(path.join(__dirname, "..", "js", "manual.js"), "utf8");

const runner = `
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  function project(vesp,hydra){
    const s=defaults();s.mode="project";s.dupe=0;
    s.lines=Array.from({length:6},(_,i)=>({max:i<2?16:4,spx:10,turbo:0}));
    s.minedIncome.Vespium=vesp;s.minedIncome.Hydracite=hydra;
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
  S=project(0,0);
  S.projects=[{id:"reinforced",name:"Reinforced test",catId:"",on:true,from:1,to:1,done:0,prio:null,
    levels:[{costs:[{item:"Reinforced Concrete",qty:1}]}]}];
  r=optimize();
  const rcUses=(r.phases[0]&&r.phases[0].minedUsage)||[];
  check("reinforced project needs no mined income",r.feasible&&r.eta>0&&rcUses.length===0,"eta="+r.eta+", uses="+JSON.stringify(rcUses));
  S=defaults();S.dupe=0;S.lines=Array.from({length:3},()=>({max:1,spx:1,turbo:0}));
  S.minedIncome.Vespium=1e15;S.minedIncome.Hydracite=1e9;
  S.manual=[{job:"Gel",lvl:1,sell:false},{job:"Batteries",lvl:1,sell:false},{job:"Reinforced Concrete",lvl:1,sell:false}];syncManual(S);
  const m=manualResult(),mb=m.minedBalances||[],v=mb.find(x=>x.resource==="Vespium"),h=mb.find(x=>x.resource==="Hydracite");
  check("manual tracks vespium",v&&v.consHr>0,"vesp="+(v&&v.consHr));
  check("manual tracks hydracite",h&&h.consHr>0,"hydra="+(h&&h.consHr));
  check("manual budgets stay distinct",v&&h&&v.incomeHr===6e16&&h.incomeHr===6e10,JSON.stringify(mb));
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

eval(coreSrc + "\n;\n" + solverSrc + "\n;\n" + manualSrc + "\n;\n" + runner);
