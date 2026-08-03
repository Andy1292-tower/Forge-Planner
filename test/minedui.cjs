"use strict";
const fs=require("fs"),path=require("path");
const indexHtml=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
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
  S=defaults();
  S.minedIncome={Vespium:{rigPerMin:2,resourcesTradingPerSec:3},Hydracite:{resourcesTradingPerSec:4}};
  S.minedIncomeText={Vespium:{rigPerMin:"2",resourcesTradingPerSec:"3"},Hydracite:{resourcesTradingPerSec:"4"}};
  renderMinedResources();
  const gelSummary=document.getElementById("minedVespiumSummary");
  check("three source controls use the approved player-facing units",
    /<label for="minedVespiumRig">Vespium Rig production \\(\\/min\\)<\\/label>/.test(indexHtml)&&
    /<label for="minedVespiumTrading">Mined Vespium \\(\\/sec\\)<\\/label>/.test(indexHtml)&&
    /<label for="minedHydraciteTrading">Mined Hydracite \\(\\/sec\\)<\\/label>/.test(indexHtml),
    "rig="+indexHtml.includes("minedVespiumRig")+", vespTrading="+indexHtml.includes("minedVespiumTrading")+", hydraTrading="+indexHtml.includes("minedHydraciteTrading"));
  check("vesp Rig draft is preserved",document.getElementById("minedVespiumRig").value==="2",document.getElementById("minedVespiumRig").value);
  check("mined Vespium draft is preserved",document.getElementById("minedVespiumTrading").value==="3",document.getElementById("minedVespiumTrading").value);
  check("mined Hydracite draft is preserved",document.getElementById("minedHydraciteTrading").value==="4",document.getElementById("minedHydraciteTrading").value);
  const breakdown=document.getElementById("minedVespiumBreakdown").textContent;
  check("vesp summary exposes the additive source conversion",breakdown.includes("120")&&breakdown.includes("10.8k")&&breakdown.includes("10.92k"),breakdown);
  const hydraSummary=document.getElementById("minedHydraciteSummary").textContent;
  check("hydra summary converts per second to an hourly total",hydraSummary.includes("4")&&hydraSummary.includes("14.4k"),hydraSummary);
  check("gel summary uses the combined hourly budget",/Gel\\/hr/.test(gelSummary.textContent||gelSummary.innerHTML),gelSummary.textContent||gelSummary.innerHTML);
  check("hydra table names only hydra",/Hydracite/.test(document.getElementById("minedHydraciteCosts").innerHTML)&&!/Vespium/.test(document.getElementById("minedHydraciteCosts").innerHTML),document.getElementById("minedHydraciteCosts").innerHTML);
  check("cost table labels the numeric top tier 16.38k",/16\\.38k×/.test(document.getElementById("minedHydraciteCosts").innerHTML),document.getElementById("minedHydraciteCosts").innerHTML);
  S.lines=[{max:16384,spx:1,turbo:0}];renderLines();
  const lineMarkup=document.getElementById("lines").children[0].innerHTML;
  check("top-tier option keeps numeric state behind the display label",/value="16384"[^>]*>16\\.38k×<\\/option>/.test(lineMarkup),lineMarkup);
  check("line-cap help names the numeric top tier consistently",/1×–16\\.38k×/.test(TIPS.max),TIPS.max);
  check("the cap picker is captioned with the level it corresponds to",/class="line-lvl[^"]*"[^>]*>level 14</.test(lineMarkup),lineMarkup);
  check("the level caption describes the picker for screen readers",/aria-describedby="linesCapHelp field-line-0-level"/.test(lineMarkup),lineMarkup);
  check("unselected options tag their level for the open list",/value="64"[^>]*>64× lv6<\\/option>/.test(lineMarkup),lineMarkup);
  check("the selected option stays bare so the closed control cannot show a level",/value="16384" selected>16\\.38k×<\\/option>/.test(lineMarkup),lineMarkup);
  // 12 characters is what this column absorbs for free; a longer tag takes pixels off speed and turbo
  check("no option label outgrows the column's free width",[...lineMarkup.matchAll(/<option[^>]*>([^<]*)<\\/option>/g)].every(m=>m[1].length<=12),lineMarkup);
  const batteryCard=prodCard("Batteries").innerHTML;
  check("Battery recipe copy explains batch output and per-craft costs",/5 × compression/.test(batteryCard)&&/costs? (?:below )?(?:remain|are) per craft/i.test(batteryCard),batteryCard);
  check("Hydracite card discloses the Battery batch",/Batteries[^<]*5 × compression|5 × compression[^<]*Batteries/.test(indexHtml),"batch copy="+indexHtml.includes("5 × compression"));
  check("recipe guidance does not claim compression is every craft's output",
    /Most crafts output the compression amount; Batteries output 5 × compression\./.test(indexHtml)&&!/Compression level = units produced per cycle/.test(indexHtml),
    "corrected="+indexHtml.includes("Most crafts output the compression amount")+", stale="+indexHtml.includes("Compression level = units produced per cycle"));
  if(fail)process.exitCode=1;
})();`;
eval(src+"\n"+runner);
