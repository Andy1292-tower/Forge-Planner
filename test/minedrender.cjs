"use strict";
/* Player-facing mined-resource rendering regressions from the final review. */
const fs=require("fs"),path=require("path");

class El{
  constructor(){this.innerHTML="";this.textContent="";this.value="";this.hidden=false;this.dataset={};this.children=[];this.className="";}
  addEventListener(){} setAttribute(){} appendChild(x){this.children.push(x);return x;} querySelector(){return null;}
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
const src=["core.js","solver.js","results.js","manual.js","render.js"]
  .map(f=>fs.readFileSync(path.join(__dirname,"..","js",f),"utf8")).join("\n;\n");

const runner=`
(function(){
  let fail=0;const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};

  S=defaults();S.mode="items";S.dupe=50;S.lines=[{max:1,spx:1,turbo:0}];
  PRODUCTS.forEach(p=>S.targets[p]={on:p==="Gel",w:1});S.minedIncome.Vespium=1e30;
  let result=optimize(),el=new El(),stat=new El();renderSolveResult(result,el,stat);
  const gelLine=result.plan.find(p=>p.job&&p.job.res==="Gel"),itemRocks=1e23/3201*3600;
  check("items Gel plan row renders real Rocks consumption",el.innerHTML.includes(disp(itemRocks)+" Rocks"),el.innerHTML);
  check("Rocks usage summary labels the cost informational",el.innerHTML.includes("Rocks/hr (informational)"),el.innerHTML);
  const idleNote=idleLinesNote([{line:2,job:{kind:"idle"}}],result.minedUsage);
  check("informational Rocks is not described as a solver budget",idleNote.includes("Gel / Vespium")&&!idleNote.includes("Gel / Rocks"),idleNote);

  S=defaults();S.mode="project";S.dupe=50;S.lines=Array.from({length:5},(_,i)=>({max:i<2?16:4,spx:10-i,turbo:0}));
  S.minedIncome.Vespium=1e30;S.projects=[{id:"gel",name:"Gel render",catId:"",on:true,from:1,to:1,done:0,prio:null,
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
  S.minedIncome.Vespium=1e15;S.forgie.Ingots=123;
  el=new El();stat=new El();renderManual(el,stat);
  check("Manual gives mined income its own column",el.innerHTML.includes('<th class="num">Mined income</th>'),el.innerHTML);
  check("Manual keeps Forgie in Passive",el.innerHTML.includes('<th class="num">Passive</th>')&&el.innerHTML.includes(disp(123)),el.innerHTML);
  check("Manual no longer labels mined income as a line arrow",!el.innerHTML.includes("income →"),el.innerHTML);
  S.minedIncome.Vespium=0;el=new El();stat=new El();renderManual(el,stat);
  check("Manual keeps the mined-income column at zero income",el.innerHTML.includes('<th class="num">Mined income</th>'),el.innerHTML);

  const gelCard=prodCard("Gel").innerHTML;
  check("Gel copy says it is crafted on a line",/crafted on a crafter line/i.test(gelCard),gelCard);
  check("Gel copy names Vespium and informational Rocks",/Vespium/.test(gelCard)&&/Rocks/.test(gelCard),gelCard);
  check("Gel copy removes obsolete free-not-crafted claim",!/free, not crafted/i.test(gelCard),gelCard);
  if(fail)process.exitCode=1;
})();`;

eval(src+"\n"+runner);
