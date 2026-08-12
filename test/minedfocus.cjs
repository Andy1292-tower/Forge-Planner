"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* Real mined-modal event handlers: focus entry, confinement, and restoration. */
const fs=require("fs"),path=require("path");

class Target{
  constructor(id){this.id=id;this.hidden=false;this.dataset={};this.listeners={};this.disabled=false;this.tabIndex=0;this.isConnected=true;}
  addEventListener(type,fn){(this.listeners[type]||(this.listeners[type]=[])).push(fn);}
  dispatch(type,props={}){const e=Object.assign({type,target:this,currentTarget:this,key:"",shiftKey:false,defaultPrevented:false,
    preventDefault(){this.defaultPrevented=true;}},props);(this.listeners[type]||[]).forEach(fn=>fn(e));return e;}
  focus(){document.activeElement=this;}
  hasAttribute(){return false;}
  getAttribute(){return null;}
  getClientRects(){return [this];}
  querySelector(){return null;}
  querySelectorAll(){return [];}
}
const btn=new Target("btnMined"),close=new Target("minedClose"),done=new Target("minedDone");
const vespRig=new Target("minedVespiumRig"),vespTrading=new Target("minedVespiumTrading");
const hydraTrading=new Target("minedHydraciteTrading"),dialog=new Target("minedDialog");
vespRig.dataset.minedResource="Vespium";vespRig.dataset.minedSource="rigPerMin";
vespTrading.dataset.minedResource="Vespium";vespTrading.dataset.minedSource="resourcesTradingPerSec";
hydraTrading.dataset.minedResource="Hydracite";hydraTrading.dataset.minedSource="resourcesTradingPerSec";
const modal=new Target("minedModal");modal.hidden=true;
const focusables=[close,vespRig,vespTrading,hydraTrading,done];
modal.querySelector=sel=>sel.includes("[role=\"dialog\"]")||sel.includes("[role='dialog']")?dialog:null;
modal.querySelectorAll=()=>focusables;
dialog.querySelectorAll=()=>focusables;
close.closest=done.closest=sel=>sel==="[data-dialog-close]"?close:null;
const els={btnMined:btn,minedModal:modal,minedClose:close,minedDone:done,
  minedVespiumRig:vespRig,minedVespiumTrading:vespTrading,minedHydraciteTrading:hydraTrading};
const doc=new Target("document");doc.activeElement=null;doc.getElementById=id=>els[id]||new Target(id);
doc.querySelector=sel=>sel==="#minedModal .modal"?dialog:null;
doc.body={children:[],classList:{toggle(){}}};
globalThis.document=doc;
globalThis.renderMinedResources=()=>{};
globalThis.setMinedIncome=()=>{};
globalThis.scheduleSolve=()=>{};

const dialogs=fs.readFileSync(path.join(__dirname,"..","js","dialogs.js"),"utf8");
const src=fs.readFileSync(path.join(__dirname,"..","js","events.js"),"utf8");
const start=src.indexOf("/* ---------- mined resources modal ---------- */");
const end=src.indexOf("/* ---------- settings modal",start);
if(start<0||end<0)throw new Error("mined modal event block not found");
eval(dialogs+"\n"+src.slice(start,end));

let fail=0;const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
function open(){btn.focus();btn.dispatch("click");}
function expectRestore(name,closeAction){open();closeAction();check(name,modal.hidden&&document.activeElement===btn,"hidden="+modal.hidden+", focus="+(document.activeElement&&document.activeElement.id));}

open();
check("opening Mined resources focuses Vespium Rig income",document.activeElement===vespRig,"focus="+(document.activeElement&&document.activeElement.id));
done.focus();let ev=doc.dispatch("keydown",{key:"Tab"});
check("Tab wraps within Mined resources",ev.defaultPrevented&&document.activeElement===close,"focus="+(document.activeElement&&document.activeElement.id));
close.focus();ev=doc.dispatch("keydown",{key:"Tab",shiftKey:true});
check("Shift+Tab wraps within Mined resources",ev.defaultPrevented&&document.activeElement===done,"focus="+(document.activeElement&&document.activeElement.id));

expectRestore("Close restores focus to the invoker",()=>{close.focus();modal.dispatch("click",{target:close});});
expectRestore("Done restores focus to the invoker",()=>{done.focus();modal.dispatch("click",{target:done});});
expectRestore("backdrop restores focus to the invoker",()=>{vespTrading.focus();modal.dispatch("click",{target:modal});});
expectRestore("Escape restores focus to the invoker",()=>{hydraTrading.focus();doc.dispatch("keydown",{key:"Escape"});});
if(fail)process.exitCode=1;
