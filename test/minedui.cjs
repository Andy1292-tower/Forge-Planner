"use strict";
const fs=require("fs"),path=require("path");
class El{
  constructor(){this.innerHTML="";this.textContent="";this.value="";this.hidden=false;this.dataset={};this.children=[];
    this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};}
  addEventListener(){} setAttribute(){} appendChild(x){this.children.push(x);return x;} prepend(x){this.children.unshift(x);} querySelector(){return null;}
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
const src=["core.js","fields.js","dom.js","solver.js","render.js"].map(f=>fs.readFileSync(path.join(__dirname,"..","js",f),"utf8")).join("\n");
const runner=`
(function(){
  let fail=0;const check=(n,ok,d)=>{console.log((ok?"ok   ":"FAIL ")+n+" ["+d+"]");if(!ok)fail++;};
  S=defaults();S.minedIncome.Vespium=7.25e18;S.minedIncomeText.Vespium="7.25qu";
  S.minedIncome.Hydracite=3e9;S.minedIncomeText.Hydracite="3b";
  renderMinedResources();
  const gelSummary=document.getElementById("minedVespiumSummary");
  check("vesp input preserved",document.getElementById("minedVespium").value==="7.25qu",document.getElementById("minedVespium").value);
  check("hydra input preserved",document.getElementById("minedHydracite").value==="3b",document.getElementById("minedHydracite").value);
  check("gel summary rendered",/Gel\\/hr/.test(gelSummary.textContent||gelSummary.innerHTML),gelSummary.textContent||gelSummary.innerHTML);
  check("hydra table names only hydra",/Hydracite/.test(document.getElementById("minedHydraciteCosts").innerHTML)&&!/Vespium/.test(document.getElementById("minedHydraciteCosts").innerHTML),document.getElementById("minedHydraciteCosts").innerHTML);
  check("cost table labels 16.4k",/16\\.4k×/.test(document.getElementById("minedHydraciteCosts").innerHTML),document.getElementById("minedHydraciteCosts").innerHTML);
  setMinedIncome("Hydracite","4b");
  check("hydra edit does not change vesp",S.minedIncome.Vespium===7.25e18&&S.minedIncome.Hydracite===4e9,JSON.stringify(S.minedIncome));
  if(fail)process.exitCode=1;
})();`;
eval(src+"\n"+runner);
