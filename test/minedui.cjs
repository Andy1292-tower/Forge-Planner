"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
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
  querySelector:()=>null,
  querySelectorAll:()=>[]
};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.performance={now:()=>0};
const src=["decimal.js", "core.js","fields.js","dom.js","solver.js","render.js"].map(f=>fs.readFileSync(path.join(__dirname,"..","js",f),"utf8")).join("\n");
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
  // "Apply max turbo" writes each projected speed into the field it hangs under, so it is offered
  // while a row still carries a projection and dead when the table already reads its own numbers.
  const maxTurboBtn=()=>document.getElementById("btnMaxTurbo");
  S.maxTurbo=250;S.lines=[{max:512,spx:49.38,turbo:0},{max:512,spx:60,turbo:250},{max:512,spx:42.87,turbo:0}];renderLines();
  check("the max-turbo button is live while a line still shows a projection",maxTurboBtn().disabled===false,"disabled="+maxTurboBtn().disabled);
  // 42.87 projects to 150.045. The note promises what the button will write, so both round it down —
  // test/solve-lifecycle.cjs holds the rewritten field to the number promised here.
  const projMarkup=document.getElementById("lines").children[document.getElementById("lines").children.length-1].innerHTML;
  check("the projection note promises exactly what the button writes",/→ ×150\\.04</.test(projMarkup)&&!/150\\.05/.test(projMarkup),(projMarkup.match(/→ ×[\\d.,]+/g)||[]).join(" "));
  S.lines=[{max:512,spx:172.83,turbo:250},{max:512,spx:60,turbo:250}];renderLines();
  check("the max-turbo button goes dead once every line reads its own projection",maxTurboBtn().disabled===true,"disabled="+maxTurboBtn().disabled);
  S.lines[0].turbo=100;refreshLineNotes();
  check("a line typed back below the cap revives the button without a table rebuild",maxTurboBtn().disabled===false,"disabled="+maxTurboBtn().disabled);
  check("the card offers the button beside Add line",/id="btnMaxTurbo"/.test(indexHtml)&&/class="line-actions"/.test(indexHtml),"markup="+indexHtml.includes("btnMaxTurbo"));
  const batteryCard=prodCard("Batteries").innerHTML;
  check("Battery recipe copy explains batch output and per-craft costs",/5 × compression/.test(batteryCard)&&/costs? (?:below )?(?:remain|are) per craft/i.test(batteryCard),batteryCard);
  check("Hydracite card discloses the Battery batch",/Batteries[^<]*5 × compression|5 × compression[^<]*Batteries/.test(indexHtml),"batch copy="+indexHtml.includes("5 × compression"));
  check("recipe guidance does not claim compression is every craft's output",
    /Most crafts output the compression amount; Batteries output 5 × compression\./.test(indexHtml)&&!/Compression level = units produced per cycle/.test(indexHtml),
    "corrected="+indexHtml.includes("Most crafts output the compression amount")+", stale="+indexHtml.includes("Compression level = units produced per cycle"));
  if(fail)process.exitCode=1;
})();`;
eval(src+"\n"+runner);
