"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* The planner's tabs are read side by side with the game's own screens, so their SECTIONS and their
 * ITEM ORDER are a contract, not a rendering detail. This pins that contract, the mined incomes the
 * stat block declares, and the two solver consequences of a mined resource being sellable and of
 * held Hydracite being spendable. */
const fs=require("fs"),path=require("path");

class El{
  constructor(tag){this.tag=tag||"div";this.innerHTML="";this.textContent="";this.value="";this.hidden=false;this.dataset={};
    this.children=[];this.className="";this.style={};this.attributes={};
    this.classList={add:()=>{},remove:()=>{},toggle:()=>{}};}
  addEventListener(){}
  setAttribute(name,value){this.attributes[name]=String(value);}
  appendChild(x){this.children.push(x);return x;}
  append(...xs){this.children.push(...xs);}
  prepend(x){this.children.unshift(x);}
  replaceChildren(...xs){this.children=xs;}
  querySelector(){return null;}
  // The renderer builds a name cell out of a tag element plus a bare text node; a plain string
  // stands in for the text node, so a row's visible label is the string its cell carries.
  get text(){return this.children.map(c=>typeof c==="string"?c:(c&&c.text)||"").join("");}
}
const els={};
globalThis.document={
  activeElement:null,
  getElementById:id=>(els[id]||(els[id]=new El())),
  createElement:tag=>new El(tag),
  createTextNode:value=>String(value),
  querySelector:()=>null,
  querySelectorAll:()=>[]
};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.performance={now:()=>0};

const jsDir=path.join(__dirname,"..","js");
const read=f=>fs.readFileSync(path.join(jsDir,f),"utf8");
const base=["decimal.js","core.js","fields.js","dom.js","project-schedule.js","solver.js","render.js"].map(read).join("\n;\n");

/* The row renderers live in events.js beside its top-level DOM wiring, so they are sliced out the
 * way the mined-modal handlers are: by the section comments that bracket them. */
const eventsSrc=read("events.js");
function slice(startMarker,endMarker){
  const start=eventsSrc.indexOf(startMarker);
  const end=eventsSrc.indexOf(endMarker,start);
  if(start<0||end<0)throw new Error("events.js block not found: "+startMarker);
  return eventsSrc.slice(start,end);
}
function extractFunction(name){
  const start=eventsSrc.indexOf("function "+name+"(");
  if(start<0)throw new Error("events.js function not found: "+name);
  const end=eventsSrc.indexOf("\n}",start);
  return eventsSrc.slice(start,end+2);
}
const rowRenderers=[
  slice("/* ---------- sell prices ---------- */","const INPUT_TABS="),
  extractFunction("renderForgie"),
  extractFunction("renderInv")
].join("\n;\n");

const indexHtml=fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");

let fail=0;
const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
const context={console,check,indexHtml,Decimal,JSON,Math,Number,String,Object,Array,Date,isNaN,isFinite,parseFloat,parseInt,
  document:globalThis.document,localStorage:globalThis.localStorage,performance:globalThis.performance,
  setTimeout:()=>0,clearTimeout:()=>{}};

const runner=`
(function(){
  // Read a rendered list back as the reader sees it: "# Heading" for a section, "item" for a row.
  const readRows=box=>box.children.map(node=>
    node.className.indexOf("price-grp")===0?"# "+node.textContent
      :node.className==="price-row"?node.children[0].text:null).filter(v=>v!==null);
  const rowKeys=box=>box.children.filter(n=>n.className==="price-row")
    .map(n=>n.children[1].dataset.price||n.children[1].dataset.forgie||n.children[1].dataset.inv);
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

  S=normalize(defaults());

  /* ---- plan item 3: Sell prices is Mined, then Silicate craftables, then Vespium craftables ---- */
  renderPrices();
  const priceRows=readRows(document.getElementById("priceRows"));
  const expectedPrices=[
    "# Mined","Worthless Rocks","Vespium",
    "# Silicate craftables","Bits","Concrete","Glass","Bricks","Reinforced Concrete","Gel","Batteries",
    "# Vespium craftables","Ingots","Plates","Rods","Frames","Wire"
  ];
  check("Sell prices renders the three in-game sections in order",same(priceRows,expectedPrices),priceRows.join(" | "));
  check("Sell prices keeps internal keys behind the display names",
    rowKeys(document.getElementById("priceRows")).indexOf("Rocks")===0,
    rowKeys(document.getElementById("priceRows")).slice(0,2).join(","));
  check("every priceable item gets exactly one row",
    rowKeys(document.getElementById("priceRows")).length===PRICEABLE_ITEMS.length,
    rowKeys(document.getElementById("priceRows")).length+" vs "+PRICEABLE_ITEMS.length);

  /* ---- plan item 5: Lil' Forgie is one flat list, no sections ---- */
  renderForgie();
  const forgieRows=readRows(document.getElementById("forgieRows"));
  const expectedForgie=["Bits","Concrete","Glass","Bricks","Ingots","Plates","Rods","Frames","Gel","Wire","Reinforced Concrete","Batteries"];
  check("Lil' Forgie renders one flat list in game order",same(forgieRows,expectedForgie),forgieRows.join(" | "));
  check("Lil' Forgie carries no section headings",forgieRows.every(row=>row.indexOf("# ")!==0),forgieRows.join(" | "));

  /* ---- plan item 6: Inventory mirrors the craftable sections, mined stock last ---- */
  renderInv();
  const invRows=readRows(document.getElementById("invRows"));
  const expectedInv=[
    "# Silicate craftables","Bits","Concrete","Glass","Bricks","Reinforced Concrete","Gel","Batteries",
    "# Vespium craftables","Ingots","Plates","Rods","Frames","Wire",
    "# Mined","Worthless Rocks","Vespium","Hydracite"
  ];
  check("Inventory mirrors the Sell prices sections with mined stock at the bottom",same(invRows,expectedInv),invRows.join(" | "));
  check("Inventory records Hydracite",rowKeys(document.getElementById("invRows")).indexOf("Hydracite")>=0,
    rowKeys(document.getElementById("invRows")).join(","));

  /* ---- plan items 1 and 2: the mined incomes the stat block declares ---- */
  check("Worthless Rocks has a per-second income source",
    !!(MINED_INCOME_SOURCES.Rocks&&MINED_INCOME_SOURCES.Rocks.resourcesTradingPerSec),
    JSON.stringify(Object.keys(MINED_INCOME_SOURCES.Rocks||{})));
  check("every mined income uses the one per-second model",
    MINED_INCOME_RESOURCES.every(r=>same(Object.keys(MINED_INCOME_SOURCES[r]),["resourcesTradingPerSec"])),
    MINED_INCOME_RESOURCES.map(r=>r+":"+Object.keys(MINED_INCOME_SOURCES[r]).join("+")).join(" "));
  check("Rocks is never a budgeted craft input",
    MINED_RESOURCES.indexOf("Rocks")<0&&!isMinedResource("Rocks"),MINED_RESOURCES.join(","));

  /* ---- plan item 4: the max-credits readout is income/hr x price ---- */
  S=normalize(defaults());
  setMinedIncome("Rocks","resourcesTradingPerSec","10");
  S.sellPrice.Rocks=parseGameNum("3");
  renderMinedResources();
  const rocksReadout=document.getElementById("minedRocksSummary").textContent;
  // 10/sec is 36000/hr; at 3 credits a unit that is 108000 credits/hr.
  check("the mined card reads out production rate x price per unit",
    rocksReadout.indexOf(disp(108000))>=0&&rocksReadout.indexOf("max credits/hr")>=0,rocksReadout);

  /* ---- plan item 4: Rocks and Vespium rank against the crafted items ---- */
  S=normalize(defaults());
  S.mode="credits";S.solveBudget=1500;S.dupe=0;S.maxTurbo=0;
  S.lines=[{max:64,spx:20,turbo:0},{max:64,spx:18,turbo:0}];
  setMinedIncome("Rocks","resourcesTradingPerSec","1e12");
  setMinedIncome("Vespium","resourcesTradingPerSec","1000");
  S.sellPrice.Rocks=parseGameNum("100");
  S.sellPrice.Vespium=parseGameNum("2");
  S.sellPrice.Ingots=parseGameNum("1");
  const ranked=optimize();
  const byItem={};(ranked.ranking||[]).forEach(c=>byItem[c.item]=c);
  check("a priced mined resource joins the Credits ranking",
    !!byItem.Rocks&&!!byItem.Vespium&&!!byItem.Ingots,
    (ranked.ranking||[]).map(c=>c.item).join(","));
  check("a mined candidate earns its income rate times its price",
    !!byItem.Rocks&&toDec0(byItem.Rocks.credits).eq(toDec0(minedBudgetHr("Rocks")).times(100)),
    byItem.Rocks&&String(byItem.Rocks.credits));
  check("a mined resource can win the comparison outright",
    ranked.bestItem==="Rocks",ranked.bestItem+" @ "+String(ranked.credits));
  check("a mined winner reports its own rate as its output",
    !!byItem.Rocks&&Math.abs(byItem.Rocks.out-supplyRate(minedBudgetHr("Rocks")))<1e-6,
    byItem.Rocks&&String(byItem.Rocks.out));
  // An unpriced mined resource must not appear at all, exactly as an unpriced item does not.
  S.sellPrice.Vespium=null;
  check("an unpriced mined resource stays out of the ranking",
    (optimize().ranking||[]).every(c=>c.item!=="Vespium"),
    (optimize().ranking||[]).map(c=>c.item).join(","));

  /* ---- plan item 6: held Hydracite is spent to finish a Battery project sooner ----
     The Battery recipe's other inputs are stocked outright, so the only thing this plan has to wait
     for is Hydracite. That is what makes the comparison mean what it says: any change in ETA is the
     mined bank, not a line or a feeder moving. */
  const batteryPlan=hydracite=>{
    S=normalize(defaults());
    S.mode="project";S.dupe=0;S.margin=0;S.maxTurbo=0;S.projectSeq=false;S.projectGate=false;
    S.lines=[{max:1,spx:60,turbo:0},{max:1,spx:60,turbo:0}];
    setMinedIncome("Vespium","resourcesTradingPerSec","1e14");
    setMinedIncome("Hydracite","resourcesTradingPerSec","1e3");
    S.inventory.Wire=toDec("1e9");S.inventory.Gel=toDec("1e9");
    S.inventory.Hydracite=toDec(hydracite);
    S.projects=[{id:"bat",name:"Batteries",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Batteries",qty:toDec(200)}]}]}];
    return optimize();
  };
  const withoutStock=batteryPlan(0),withStock=batteryPlan("1e15");
  check("a Battery project is feasible on Hydracite income alone",
    withoutStock.feasible===true&&withoutStock.eta>0,
    "feasible="+withoutStock.feasible+", eta="+withoutStock.eta);
  check("held Hydracite finishes the same Battery project sooner",
    withStock.feasible===true&&withStock.eta>0&&withStock.eta<withoutStock.eta,
    "withStock="+withStock.eta+", withoutStock="+withoutStock.eta);
  // Stock is a quantity, not a rate: it can only ever be spent once, so it must not be able to
  // stand in for an income the plan does not have at all when the demand outlasts it.
  const stockOnly=(()=>{
    const run=batteryPlan("1e15");
    setMinedIncome("Hydracite","resourcesTradingPerSec","");
    S.inventory.Hydracite=toDec("1e15");
    return optimize();
  })();
  check("held Hydracite alone can still craft Batteries with no Hydracite income",
    stockOnly.feasible===true&&stockOnly.eta>0,"feasible="+stockOnly.feasible+", eta="+stockOnly.eta);
  check("only Hydracite stock is spendable — Vespium and Rocks stock are recorded, not drawn",
    SPENDABLE_MINED_STOCK.indexOf("Hydracite")>=0&&SPENDABLE_MINED_STOCK.indexOf("Vespium")<0&&
      SPENDABLE_MINED_STOCK.indexOf("Rocks")<0,
    SPENDABLE_MINED_STOCK.join(","));

  /* ---- plan item 2: no surface still offers the retired rig ---- */
  check("no markup, state shape, or renderer still offers the Vespium rig",
    indexHtml.indexOf("rigPerMin")<0&&indexHtml.indexOf("minedVespiumRig")<0&&
      !Object.prototype.hasOwnProperty.call(normalize(defaults()).minedIncome.Vespium,"rigPerMin"),
    "html="+(indexHtml.indexOf("rigPerMin")<0)+", state="+
      Object.keys(normalize(defaults()).minedIncome.Vespium).join(","));

})()`;

const vm=require("vm");
vm.createContext(context);
vm.runInContext(base+"\n;\n"+rowRenderers,context);
vm.runInContext(runner,context);
if(fail){console.log(fail+" game-alignment check(s) failed");process.exitCode=1;}
else console.log("all game-alignment checks passed");
