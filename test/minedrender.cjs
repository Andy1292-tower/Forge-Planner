"use strict";
/* Player-facing mined-resource rendering regressions from the final review. */
const fs=require("fs"),path=require("path");

class El{
  constructor(){this.innerHTML="";this.textContent="";this.value="";this.hidden=false;this.dataset={};this.children=[];this.className="";this.style={};
    this.attributes={};this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};}
  addEventListener(){} setAttribute(name,value){this.attributes[name]=String(value);} appendChild(x){this.children.push(x);return x;} append(...xs){this.children.push(...xs);} prepend(x){this.children.unshift(x);} replaceChildren(...xs){this.children=xs;} querySelector(){return null;}
}
const els={};
globalThis.document={
  activeElement:null,
  getElementById:id=>(els[id]||(els[id]=new El())),
  createElement:()=>new El(),
  querySelectorAll:()=>[]
};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.performance={now:()=>0};
const src=["core.js","fields.js","dom.js","project-schedule.js","solver.js","results.js","manual.js","render.js"]
  .map(f=>fs.readFileSync(path.join(__dirname,"..","js",f),"utf8")).join("\n;\n");

const runner=`
(function(){
  let fail=0;const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};

  S=defaults();S.dupe=0;S.maxTurbo=0;
  S.lines=Array.from({length:6},(_,i)=>({max:512,spx:50-i,turbo:0}));
  ["100n","1d","1e36"].forEach(income=>{
    setMinedIncome("Vespium","rigPerMin",income);
    document.getElementById("minedVespiumSummary").textContent="Gel/hr capacity: 0";
    document.getElementById("minedGelLoadout").innerHTML="income too low";
    let hugeBudgetError=null;
    try{renderMinedResources();}catch(error){hugeBudgetError=error;}
    const hugeCapacity=document.getElementById("minedVespiumSummary").textContent;
    const hugeLoadout=document.getElementById("minedGelLoadout").innerHTML;
    check(income+" Rig income renders a multi-line Gel capacity without overflowing",
      !hugeBudgetError&&hugeCapacity==="Gel/hr capacity: 4.27k"&&
        !hugeLoadout.includes("income too low")&&hugeLoadout.includes("#6")&&hugeLoadout.includes("512×"),
      "error="+(hugeBudgetError&&hugeBudgetError.message)+", capacity="+hugeCapacity+", loadout="+hugeLoadout);
  });

  const exactBudget=4498594189315839;
  S=defaults();S.dupe=0;S.maxTurbo=0;
  const counterLines=[{max:1,spx:6,turbo:0},{max:1,spx:4,turbo:0},{max:1,spx:4,turbo:0}];
  S.lines=counterLines.concat(Array.from({length:9},()=>({max:1,spx:100,turbo:0})));
  S.minedIncome.Vespium.rigPerMin=exactBudget/60;S.minedIncomeText.Vespium.rigPerMin=String(exactBudget/60);
  const renderExact=gelLoadout,renderSeed=gelSeedLoadout;
  let renderExactCalls=0,renderSeedCalls=0;
  gelLoadout=function(){renderExactCalls++;return renderExact.apply(null,arguments);};
  gelSeedLoadout=function(){renderSeedCalls++;return renderSeed.apply(null,arguments);};
  renderMinedResources();
  const minedInput=document.getElementById("minedVespiumRig");
  check("mined inputs receive descriptor-derived range and draft limits",
    minedInput.attributes.min==="0"&&minedInput.attributes.max==="1e+100"&&minedInput.attributes.maxlength==="128"&&minedInput.attributes.inputmode==="decimal",
    JSON.stringify(minedInput.attributes));
  let capacity=document.getElementById("minedVespiumSummary").textContent;
  let loadout=document.getElementById("minedGelLoadout").innerHTML;
  check("12-line UI branches to exact before doing seed work",renderExactCalls===1&&renderSeedCalls===0,
    "exact="+renderExactCalls+", seed="+renderSeedCalls);
  check("12-or-fewer line UI keeps exact capacity language",capacity.startsWith("Gel/hr capacity: 9")&&
    loadout.includes("sustain up to")&&loadout.includes("Best loadout"),capacity+" | "+loadout);
  check("exact UI renders both medium physical lines",loadout.includes("#2")&&loadout.includes("#3")&&!loadout.includes("#1</td>"),loadout);

  S.lines=S.lines.concat({max:1,spx:100,turbo:0});
  renderExactCalls=0;renderSeedCalls=0;
  gelLoadout=function(){renderExactCalls++;throw new Error("large UI must branch before exact work");};
  let largeRenderError=null;try{renderMinedResources();}catch(error){largeRenderError=error;}
  capacity=document.getElementById("minedVespiumSummary").textContent;
  loadout=document.getElementById("minedGelLoadout").innerHTML;
  check("13-line UI branches to bounded seed before exact work",!largeRenderError&&renderExactCalls===0&&renderSeedCalls===1,
    "error="+(largeRenderError&&largeRenderError.message)+", exact="+renderExactCalls+", seed="+renderSeedCalls);
  check("over-12 line UI labels bounded capacity as estimated",capacity==="Estimated capacity: 6.75 Gel/hr"&&
    loadout.includes("Estimated capacity")&&loadout.includes("Best found loadout"),capacity+" | "+loadout);
  check("over-12 line UI makes no exact maximum claim",!loadout.includes("sustain up to")&&!loadout.includes("maximum")&&
    !loadout.includes("Best loadout")&&!loadout.includes("the rest is profit")&&!loadout.includes("raise a line's cap"),loadout);
  S.lines=counterLines.concat(Array.from({length:61},()=>({max:1,spx:100,turbo:0})));
  renderExactCalls=0;renderSeedCalls=0;largeRenderError=null;
  try{renderMinedResources();}catch(error){largeRenderError=error;}
  check("64-line compatible UI stays bounded without exact work",!largeRenderError&&renderExactCalls===0&&renderSeedCalls===1,
    "error="+(largeRenderError&&largeRenderError.message)+", exact="+renderExactCalls+", seed="+renderSeedCalls);
  gelLoadout=renderExact;gelSeedLoadout=renderSeed;

  S=defaults();S.mode="items";S.dupe=50;S.lines=[{max:1,spx:1,turbo:0}];
  PRODUCTS.forEach(p=>S.targets[p]={on:p==="Gel",w:1});S.minedIncome.Vespium.rigPerMin=1e30;
  let result=optimize(),el=new El(),stat=new El();renderSolveResult(result,el,stat);
  const gelLine=result.plan.find(p=>p.job&&p.job.res==="Gel"),itemRocks=1e23/3201*3600;
  check("items Gel plan row renders real Rocks consumption",el.innerHTML.includes(disp(itemRocks)+" Rocks"),el.innerHTML);
  check("Rocks usage summary labels the cost informational",el.innerHTML.includes("Rocks/hr (informational)"),el.innerHTML);
  const idleNote=idleLinesNote([{line:2,job:{kind:"idle"}}],result.minedUsage);
  check("informational Rocks is not described as a solver budget",idleNote.includes("Gel / Vespium")&&!idleNote.includes("Gel / Rocks"),idleNote);

  S=defaults();S.mode="project";S.dupe=50;S.lines=Array.from({length:5},(_,i)=>({max:i<2?16:4,spx:10-i,turbo:0}));
  S.minedIncome.Vespium.rigPerMin=1e30;S.projects=[{id:"gel",name:"Gel render",catId:"",on:true,from:1,to:1,done:0,prio:null,
    levels:[{costs:[{item:"Gel",qty:100}]}]}];
  result=optimize();const phase=result.phases[0];let projectRocks=0;
  phase.plan.forEach(p=>(p.entries||[]).forEach(e=>{if(e.item!=="Gel")return;const tier=Math.log2(e.lvl),t=3201*Math.pow(1.5,tier),cost=1e23*Math.pow(3,tier);
    projectRocks+=(cost/t)*Math.min(p.sp,t)*(e.frac||0)*3600;}));
  const projectHtml=lineAssignTableHtml(phase.plan);
  check("project Gel plan row renders real Rocks consumption",projectHtml.includes(disp(projectRocks)+" Rocks")||phase.plan.some(p=>(p.entries||[]).some(e=>{
    if(e.item!=="Gel")return false;const tier=Math.log2(e.lvl),t=3201*Math.pow(1.5,tier),cost=1e23*Math.pow(3,tier),rocks=(cost/t)*Math.min(p.sp,t)*(e.frac||0)*3600;
    return projectHtml.includes(disp(rocks)+" Rocks");})),projectHtml);

  S=defaults();S.dupe=0;S.lines=[{max:1,spx:1,turbo:0},{max:1,spx:1,turbo:0}];
  S.manual=[{job:"Gel",lvl:1,sell:false},{job:"Ingots",lvl:1,sell:false}];syncManual(S);
  S.minedIncome.Vespium.rigPerMin=1e15;S.forgie.Ingots=123;
  el=new El();stat=new El();renderManual(el,stat);
  check("Manual gives mined income its own column",el.innerHTML.includes('<th class="num">Mined income</th>'),el.innerHTML);
  check("Manual keeps Forgie in Passive",el.innerHTML.includes('<th class="num">Passive</th>')&&el.innerHTML.includes(disp(123)),el.innerHTML);
  check("Manual no longer labels mined income as a line arrow",!el.innerHTML.includes("income →"),el.innerHTML);
  S.minedIncome.Vespium.rigPerMin=0;el=new El();stat=new El();renderManual(el,stat);
  check("Manual keeps the mined-income column at zero income",el.innerHTML.includes('<th class="num">Mined income</th>'),el.innerHTML);

  S=defaults();S.dupe=0;S.maxTurbo=0;S.lines=[{max:1,spx:1,turbo:0}];
  S.manual=[{job:"Batteries",lvl:1,sell:false}];syncManual(S);
  S.minedIncome.Vespium.rigPerMin=1e100;S.minedIncome.Hydracite.resourcesTradingPerSec=1e100;
  const manualBattery=manualResult(),batteryJob=manualBattery.plan[0].job,batterySeconds=1034274.56;
  check("Manual Battery output uses the five-unit base batch",
    Math.abs(batteryJob.prod[0][1]-5/batterySeconds)<1e-18,
    "rate="+batteryJob.prod[0][1]+", expected="+(5/batterySeconds));
  const wireIndex=manualBattery.resIndex.Wire,gelIndex=manualBattery.resIndex.Gel;
  check("Manual Battery inputs remain one craft-cycle cost",
    Math.abs(batteryJob.cons.find(row=>row[0]===wireIndex)[1]-500/batterySeconds)<1e-18&&
    Math.abs(batteryJob.cons.find(row=>row[0]===gelIndex)[1]-100000/batterySeconds)<1e-18,
    JSON.stringify(batteryJob.cons));
  el=new El();stat=new El();renderManual(el,stat);
  check("Manual renders the corrected Battery batch output",el.innerHTML.includes(disp(5/batterySeconds*3600)),el.innerHTML);

  const gelCard=prodCard("Gel").innerHTML;
  check("Gel copy says it is crafted on a line",/crafted on a crafter line/i.test(gelCard),gelCard);
  check("Gel copy names Vespium and informational Rocks",/Vespium/.test(gelCard)&&/Rocks/.test(gelCard),gelCard);
  check("Gel copy removes obsolete free-not-crafted claim",!/free, not crafted/i.test(gelCard),gelCard);
  if(fail)process.exitCode=1;
})();`;

eval(src+"\n"+runner);
