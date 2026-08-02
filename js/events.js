"use strict";
/* ---------- EVENTS ---------- */
let renderT;
let persistT=null;
let persistedRevision=-1;
function stateMatchesPersisted(){
  try{return typeof localStorage!=="undefined"&&localStorage.getItem(LSKEY)===JSON.stringify(S);}
  catch(error){return false;}
}
function persistNow(){
  if(persistT!==null){clearTimeout(persistT);persistT=null;}
  const revision=stateRevision;
  if(persistedRevision===revision||stateMatchesPersisted()){persistedRevision=revision;return true;}
  const persisted=save();
  if(persisted!==false)persistedRevision=revision;
  return persisted;
}
function schedulePersist(){
  if(persistedRevision===stateRevision||stateMatchesPersisted()){
    persistedRevision=stateRevision;
    if(persistT!==null){clearTimeout(persistT);persistT=null;}
    return;
  }
  if(persistT!==null)clearTimeout(persistT);
  persistT=setTimeout(()=>{persistT=null;persistNow();},100);
}
function flushPersist(){
  if(persistT===null)return true;
  clearTimeout(persistT);persistT=null;
  return persistNow();
}
function hasInvalidFieldDraft(){
  return [...document.querySelectorAll('[aria-invalid="true"]')].some(input=>input.offsetParent!==null);
}
function doSolve(){
  renderT=null;
  if(hasInvalidFieldDraft())return false;
  if(persistNow()===false)return false;
  renderResults();return true;
}
// Debounce the (potentially heavy) re-solve: while typing, wait until the user pauses;
// leaving a field, pressing Enter, or making a selection flushes it immediately. State is
// still captured on every keystroke (handlers update S synchronously), so nothing is lost.
function scheduleSolve(){schedulePersist();clearTimeout(renderT);renderT=setTimeout(doSolve,500);}
function flushSolve(){if(renderT){clearTimeout(renderT);doSolve();}}
document.addEventListener("change",e=>{if(e.target&&e.target.matches&&e.target.matches("input,select")&&e.target.getAttribute("aria-invalid")!=="true")flushSolve();});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target&&e.target.matches&&e.target.matches("input")&&e.target.getAttribute("aria-invalid")!=="true")flushSolve();});

function readFieldDraft(input,rule){
  return parseFieldDraft(rule,input.value,{badInput:!!(input.validity&&input.validity.badInput)});
}
/* The parser is deliberately above the only mutateState call in this helper. Invalid and
 * incomplete drafts update DOM feedback only; they never enter S or persistence. */
function commitFieldDraft(input,rule,previousValue,mutator){
  const parsed=parseFieldDraft(rule,input.value,{badInput:!!(input.validity&&input.validity.badInput)});
  const error=fieldErrorForInput(input);
  updateFieldFeedback(input,error,rule,parsed,previousValue);
  if(parsed.status!=="valid"&&parsed.status!=="blank")return {...parsed,committed:false};
  const raw=parsed.status==="blank"?"":input.value;
  mutateState(st=>mutator(st,parsed.value,raw));
  return {...parsed,raw,committed:true};
}

// Crafter-line edits can drive a heavy re-solve (credits mode runs ~1s+), and people
// typically batch many speed/turbo changes before checking output. So rather than
// auto-solving on every keystroke, those edits just persist (save) and mark the shown
// results stale; the user clicks Resimulate — or presses Enter in a line field — to
// recompute once. Any actual repaint (resimulate, mode switch, …) clears the stale UI.
function showStale(on){
  const bar=document.getElementById("staleBar");if(bar)bar.hidden=!on;
  const res=document.getElementById("results");if(res)res.classList.toggle("stale",on);
}
function clearStaleUI(){showStale(false);}
function markStale(){clearTimeout(renderT);renderT=null;persistNow();showStale(true);}
function resimulate(){doSolve();}   // doSolve→renderResults repaints and clears the stale UI
document.getElementById("btnResim").addEventListener("click",resimulate);

document.getElementById("lines").addEventListener("change",e=>{
  const li=e.target.dataset.line;
  if(li!==undefined){mutateState(st=>{st.lines[+li].max=+e.target.value;});markStale();}
});
document.getElementById("lines").addEventListener("input",e=>{
  const si=e.target.dataset.spx, ti=e.target.dataset.turbo;
  if(si!==undefined){const result=commitFieldDraft(e.target,FIELD_SCHEMA.lineSpeed,S.lines[+si].spx,(st,value)=>{st.lines[+si].spx=value;});if(result.committed){refreshLineNotes();markStale();}}
  if(ti!==undefined){const result=commitFieldDraft(e.target,FIELD_SCHEMA.turbo,S.lines[+ti].turbo,(st,value)=>{st.lines[+ti].turbo=value;});if(result.committed){refreshLineNotes();markStale();}}
});
document.getElementById("lines").addEventListener("keydown",e=>{
  if(e.key==="Enter"){e.preventDefault();if(e.target.getAttribute("aria-invalid")!=="true")resimulate();}
});
document.getElementById("lines").addEventListener("click",e=>{
  const d=e.target.dataset.del;
  if(d!==undefined&&S.lines.length>1){mutateState(st=>{st.lines.splice(+d,1);st.manual.splice(+d,1);syncManual(st);});renderLines();markStale();}
});
document.getElementById("btnAddLine").addEventListener("click",()=>{
  mutateState(st=>{st.lines.push({max:512,spx:1,turbo:0});syncManual(st);});renderLines();markStale();
});

document.getElementById("margin").addEventListener("input",e=>{
  const result=commitFieldDraft(e.target,FIELD_SCHEMA.margin,S.margin,(st,value)=>{st.margin=value;});
  if(result.committed){document.getElementById("marginv").textContent=fmt(S.margin,1)+"%";save();scheduleSolve();}
});

document.getElementById("maxTurbo").addEventListener("input",e=>{
  const result=commitFieldDraft(e.target,FIELD_SCHEMA.maxTurbo,S.maxTurbo,(st,value)=>{st.maxTurbo=value;});
  if(result.committed){refreshLineNotes();markStale();}
});
document.getElementById("dupe").addEventListener("input",e=>{
  const result=commitFieldDraft(e.target,FIELD_SCHEMA.dupe,S.dupe,(st,value)=>{st.dupe=value;});
  if(result.committed)markStale();
});

document.getElementById("targets").addEventListener("change",e=>{
  const tg=e.target.dataset.tg;
  if(tg){mutateState(st=>{st.targets[tg].on=e.target.checked;});renderTargets();scheduleSolve();}
});
document.getElementById("targets").addEventListener("input",e=>{
  const w=e.target.dataset.w;
  if(w){const result=commitFieldDraft(e.target,FIELD_SCHEMA.targetWeight,S.targets[w].w,(st,value)=>{st.targets[w].w=value;});if(result.committed){e.target.parentElement.querySelector(".pv").textContent=String(result.value);save();scheduleSolve();}}
});

document.getElementById("recipes").addEventListener("input",e=>{
  const d=e.target.dataset;if(!d.res)return;
  const rule=d.fld==="baseT"?FIELD_SCHEMA.baseTime:FIELD_SCHEMA.recipeCost;
  const previous=d.fld==="baseT"?S.baseTime[d.res]:S.prodCost[d.res][d.in][+d.lv];
  const result=commitFieldDraft(e.target,rule,previous,(st,value)=>{
    if(d.fld==="baseT")st.baseTime[d.res]=value;
    else st.prodCost[d.res][d.in][+d.lv]=value;
  });
  if(result.committed){save();scheduleSolve();}
});

/* export / import / reset */
const stateRecovery=document.getElementById("stateRecovery");
const stateRecoveryReason=document.getElementById("stateRecoveryReason");
const stateRecoveryDownload=document.getElementById("stateRecoveryDownload");
let _recoveryDownload=null;
function showStateRecovery(raw,reason,file){
  if(typeof raw==="string")quarantineRejectedState(raw,reason);
  _recoveryDownload=file||((typeof raw==="string")?new Blob([raw],{type:"application/json"}):null);
  if(stateRecoveryDownload)stateRecoveryDownload.disabled=!_recoveryDownload;
  if(stateRecoveryReason)stateRecoveryReason.textContent=String(reason||"The planner started with safe defaults. Your rejected save was kept unchanged.");
  if(stateRecovery){stateRecovery.hidden=false;stateRecovery.focus();}
}
function dismissStateRecovery(restoreFocus=true){
  if(stateRecovery)stateRecovery.hidden=true;
  if(restoreFocus){const button=document.getElementById("btnImport");if(button)button.focus();}
}
stateRecoveryDownload.addEventListener("click",()=>{
  if(!_recoveryDownload)return;
  const url=URL.createObjectURL(_recoveryDownload),a=document.createElement("a");
  a.href=url;a.download="forge-planner-rejected-save.json";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
});
document.getElementById("stateRecoveryImport").addEventListener("click",()=>document.getElementById("fileImport").click());
document.getElementById("stateRecoveryDismiss").addEventListener("click",()=>dismissStateRecovery(true));

document.getElementById("btnExport").addEventListener("click",()=>{
  const result=validateAndMigrate(S);
  if(!result.ok){showStateRecovery(null,"The current build contains a value that cannot be exported safely: "+result.errors.join("; "));return;}
  const blob=new Blob([JSON.stringify(result.state,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download="forge-build.json";a.click();URL.revokeObjectURL(a.href);
});
document.getElementById("btnImport").addEventListener("click",()=>document.getElementById("fileImport").click());
document.getElementById("fileImport").addEventListener("change",e=>{
  const f=e.target.files[0];if(!f)return;
  e.target.value="";
  if(f.size>STATE_LIMITS.maxBytes){
    showStateRecovery(null,"That import is too large to open safely. Your current build was not changed.",f);
    return;
  }
  const r=new FileReader();
  r.onload=()=>{
    const raw=String(r.result==null?"":r.result);let candidate;
    try{candidate=JSON.parse(raw);}catch(error){showStateRecovery(raw,"Could not read that file because it is not valid JSON.",f);return;}
    solveService.cancel("Import is replacing accepted state");
    const result=applyImportedState(candidate,renderAll,()=>solveService.cancel("Import rollback is restoring accepted state"));
    if(!result.ok){showStateRecovery(raw,result.errors.join("; "),f);return;}
    dismissStateRecovery(false);flashSaved();
  };
  r.onerror=()=>showStateRecovery(null,"Could not read that file. Your current build was not changed.",f);
  r.readAsText(f);
});
document.getElementById("btnReset").addEventListener("click",()=>{
  if(confirm("Reset everything to defaults? This clears your entered stats."))
    {solveService.cancel("Reset is replacing accepted state");commitState(defaults());renderAll();save();dismissStateRecovery(false);}
});

/* ---------- mode switch ---------- */
function renderModeSwitch(){
  document.querySelectorAll("#modesw button").forEach(b=>{
    const selected=b.dataset.mode===(S.mode||"items");
    b.classList.toggle("on",selected);
    b.setAttribute("aria-pressed",selected?"true":"false");
  });
}
document.getElementById("modesw").addEventListener("click",e=>{
  const m=e.target.dataset.mode;if(!m||m===S.mode)return;
  mutateState(st=>{st.mode=m;});renderModeSwitch();save();renderResults();
});

/* ---------- sell prices ---------- */
function itemTypeTag(it){
  const kind=KIND[it]==="raw"?["raw","raw"]:KIND[it]==="fin"?["fin","assembly"]:["pr","craft"];
  return domElement("span","ty "+kind[0],kind[1]);
}
function renderItemValueRows(box,textMap,numberMap,dataName,placeholder,rule){
  const nodes=[];
  const addGroup=(label,items,first)=>{
    nodes.push(domElement("div","price-grp"+(first?" first":""),label));
    items.forEach(it=>{
      const row=domElement("div","price-row");
      const name=domElement("div","pnm");
      name.append(itemTypeTag(it),document.createTextNode(it));
      const value=numberMap[it];
      const text=textMap[it]!=null?textMap[it]:(value!=null?formatGameNum(value,4):"");
      const accessibleName=dataName==="price"?`${it} sell price per unit`
        :dataName==="forgie"?`${it} Lil' Forgie production per hour`
        :`${it} current inventory`;
      const errorId=`field-${fieldDomToken(dataName)}-${fieldDomToken(it)}-error`;
      row.append(name,domTextInput(dataName,it,text,{placeholder,inputMode:rule.inputMode,accessibleName,rule,errorId}),domFieldError(errorId));
      nodes.push(row);
    });
  };
  addGroup("Finished & crafted",PRODUCTS,true);
  addGroup("Raw materials",RAWS,false);
  box.replaceChildren(...nodes);
}
function renderPrices(){
  const box=document.getElementById("priceRows");
  renderItemValueRows(box,S.priceText,S.sellPrice,"price","—",FIELD_SCHEMA.sellPrice);
}
const priceDialog=dialogController.register({root:document.getElementById("priceModal"),panel:document.querySelector("#priceModal .modal"),opener:document.getElementById("btnPrices"),initialFocus:()=>document.querySelector("#priceRows input"),onOpen:renderPrices});
function openPrices(invoker){priceDialog.open(invoker);}
function closePrices(){priceDialog.close();}
document.getElementById("priceClear").addEventListener("click",()=>{
  if(!confirm("Clear all sell prices?"))return;
  mutateState(st=>{[...RAWS,...PRODUCTS].forEach(it=>{st.sellPrice[it]=null;st.priceText[it]="";});});
  renderPrices();save();scheduleSolve();
});
document.getElementById("priceRows").addEventListener("input",e=>{
  const it=e.target.dataset.price;if(!it)return;
  const result=commitFieldDraft(e.target,FIELD_SCHEMA.sellPrice,S.sellPrice[it],(st,value,raw)=>{st.priceText[it]=raw;st.sellPrice[it]=value;});
  if(result.committed){save();scheduleSolve();}
});

/* ---------- Lil' Forgie supply modal ---------- */
function renderForgie(){
  const box=document.getElementById("forgieRows");
  renderItemValueRows(box,S.forgieText,S.forgie,"forgie","—",FIELD_SCHEMA.forgie);
}
const forgieDialog=dialogController.register({root:document.getElementById("forgieModal"),panel:document.querySelector("#forgieModal .modal"),opener:document.getElementById("btnForgie"),initialFocus:()=>document.querySelector("#forgieRows input"),onOpen:renderForgie});
function openForgie(invoker){forgieDialog.open(invoker);}
function closeForgie(){forgieDialog.close();}
document.getElementById("forgieClear").addEventListener("click",()=>{
  if(!confirm("Clear all Lil' Forgie supply rates?"))return;
  mutateState(st=>{[...RAWS,...PRODUCTS].forEach(it=>{st.forgie[it]=null;st.forgieText[it]="";});});
  renderForgie();save();scheduleSolve();
});
document.getElementById("forgieRows").addEventListener("input",e=>{
  const it=e.target.dataset.forgie;if(!it)return;
  const result=commitFieldDraft(e.target,FIELD_SCHEMA.forgie,S.forgie[it],(st,value,raw)=>{st.forgieText[it]=raw;st.forgie[it]=value;});
  if(result.committed){save();scheduleSolve();}
});

/* ---------- mined resources modal ---------- */
const btnMined=document.getElementById("btnMined");
const minedDialog=dialogController.register({root:document.getElementById("minedModal"),panel:document.querySelector("#minedModal .modal"),opener:btnMined,initialFocus:()=>document.getElementById("minedVespium"),onOpen:renderMinedResources});
function openMined(invoker){minedDialog.open(invoker);}
function closeMined(){minedDialog.close();}
document.getElementById("minedModal").addEventListener("input",e=>{
  const resource=e.target.dataset.minedIncome;if(!resource)return;
  const result=commitFieldDraft(e.target,FIELD_SCHEMA.minedIncome,S.minedIncome[resource],(st,value,raw)=>{st.minedIncomeText[resource]=raw;st.minedIncome[resource]=value;});
  if(result.committed){save();renderMinedResources();scheduleSolve();}
});

/* ---------- settings modal (max solve time) ---------- */
const solveBudgetInput=document.getElementById("solveBudget");
const solveBudgetVal=document.getElementById("solveBudgetVal");
function fmtBudget(ms){return formatMillisecondsAsSeconds(FIELD_SCHEMA.solveBudget,ms);}
const STANDARD_SOLVE_BUDGET_STOPS=Object.freeze([200,500,1000,2000,3000,5000,8000,10000,15000,20000,30000,45000,60000]);
let solveBudgetSessionStops=[];
function budgetStopsFor(value){
  const rule=FIELD_SCHEMA.solveBudget,checked=validateFieldValue(rule,value);
  const values=[rule.min,...STANDARD_SOLVE_BUDGET_STOPS.filter(stop=>stop>=rule.min&&stop<=rule.max),rule.max];
  if(checked.valid)values.push(checked.value);
  solveBudgetSessionStops=[...new Set([...solveBudgetSessionStops,...values])].sort((a,b)=>a-b);
  return solveBudgetSessionStops;
}
function syncBudgetUI(){
  const ms=clampFieldValue(FIELD_SCHEMA.solveBudget,S.solveBudget);
  const stops=budgetStopsFor(ms),index=stops.indexOf(ms);
  if(solveBudgetInput){solveBudgetInput.min="0";solveBudgetInput.max=String(stops.length-1);solveBudgetInput.step="1";solveBudgetInput.value=String(index);solveBudgetInput.setAttribute("aria-valuetext",fmtBudget(ms));}
  if(solveBudgetVal)solveBudgetVal.textContent=fmtBudget(ms);
}
const settingsDialog=dialogController.register({root:document.getElementById("settingsModal"),panel:document.querySelector("#settingsModal .modal"),opener:document.getElementById("btnSettings"),initialFocus:solveBudgetInput,onOpen:syncBudgetUI});
function openSettings(invoker){settingsDialog.open(invoker);}
function closeSettings(){settingsDialog.close();}
if(solveBudgetInput)solveBudgetInput.addEventListener("input",()=>{
  const index=Number(solveBudgetInput.value),value=solveBudgetSessionStops[index];
  const checked=validateFieldValue(FIELD_SCHEMA.solveBudget,value);if(!checked.valid)return;
  mutateState(st=>{st.solveBudget=checked.value;});
  const text=fmtBudget(S.solveBudget);solveBudgetInput.setAttribute("aria-valuetext",text);
  if(solveBudgetVal)solveBudgetVal.textContent=text;save();});

/* ---------- collapsible crafting-data panel ---------- */
function setRecipesOpen(open){
  document.getElementById("recipeBody").hidden=!open;
  document.getElementById("recipeToggle").setAttribute("aria-expanded",open?"true":"false");
}
document.getElementById("recipeToggle").addEventListener("click",()=>setRecipesOpen(document.getElementById("recipeBody").hidden));
document.getElementById("btnRecipes").addEventListener("click",()=>{setRecipesOpen(true);document.querySelector(".rsec").scrollIntoView({behavior:"smooth",block:"start"});});

/* ---------- "add sell prices" attention nudge ---------- */
const pricePoke=document.createElement("div");
pricePoke.className="poke";pricePoke.hidden=true;pricePoke.textContent="↑ Enter your sell prices";
document.querySelector(".tools").appendChild(pricePoke);
function positionPoke(){
  const b=document.getElementById("btnPrices");
  pricePoke.style.left=(b.offsetLeft+b.offsetWidth/2)+"px";
  pricePoke.style.top=(b.offsetTop+b.offsetHeight+9)+"px";
}
function setPricePoke(on){
  document.getElementById("btnPrices").classList.toggle("poke-on",on);
  if(on){positionPoke();pricePoke.hidden=false;}else pricePoke.hidden=true;
}
window.addEventListener("resize",()=>{if(!pricePoke.hidden)positionPoke();});

function initCalib(){
  const it=document.getElementById("cbItem"), cp=document.getElementById("cbComp");
  if(it.options.length===0){
    [...RAWS,...PRODUCTS].forEach(n=>it.add(new Option(n,n)));
    LEVELS.forEach(L=>cp.add(new Option(compressionLabel(L)+" (level "+Math.round(Math.log2(L))+")",L)));
    it.value="Ingots"; cp.value="512";
  }
  const out=document.getElementById("cbOut"), apply=document.getElementById("cbApply");
  const speedInput=document.getElementById("cbSpeed"),secondsInput=document.getElementById("cbSec");
  applyFieldInputAttributes(speedInput,FIELD_SCHEMA.calibrationSpeed);
  applyFieldInputAttributes(secondsInput,FIELD_SCHEMA.calibrationSeconds);
  let computed=null;
  function recalc(showFeedback=false){
    const item=it.value,L=+cp.value;
    const speedDraft=readFieldDraft(speedInput,FIELD_SCHEMA.calibrationSpeed);
    const secondsDraft=readFieldDraft(secondsInput,FIELD_SCHEMA.calibrationSeconds);
    if(showFeedback){
      updateFieldFeedback(speedInput,fieldErrorForInput(speedInput),FIELD_SCHEMA.calibrationSpeed,speedDraft,null);
      updateFieldFeedback(secondsInput,fieldErrorForInput(secondsInput),FIELD_SCHEMA.calibrationSeconds,secondsDraft,null);
    }
    const spd=speedDraft.status==="valid"?speedDraft.value:null,sec=secondsDraft.status==="valid"?secondsDraft.value:null;
    const cur=num(S.baseTime[item])||1, mult=Math.pow(1.5,Math.log2(L));
    const predict=cur*mult/(spd||1);
    if(spd!=null&&sec!=null){
      const candidate=sec*spd/mult,accepted=validateFieldValue(FIELD_SCHEMA.baseTime,candidate);
      computed=accepted.valid?accepted.value:null;
      if(computed==null){apply.disabled=true;out.textContent="Those values calculate a base time outside the supported range.";return;}
      out.innerHTML=`base time = ${fmt(sec,2)} × ${fmt(spd,2)} ÷ ${fmt(mult,2)} = <b style="color:var(--amber)">${fmt(computed,2)}s</b><br>`+
        `currently set for ${item}: ${fmt(cur,2)}s &nbsp;·&nbsp; which predicts a ${fmt(predict,2)}s craft at these settings`+
        (Math.abs(predict-sec)/sec>0.15?` <span class="calib-warning">— off by ${fmt(Math.abs(predict-sec)/sec*100,0)}%, worth setting</span>`:` <span style="color:#6c9">— matches, base looks right</span>`);
      apply.disabled=false;
    }else{
      computed=null;apply.disabled=true;
      out.innerHTML=spd>0?`current ${item} base (${fmt(cur,2)}s) predicts a <b>${fmt(predict,2)}s</b> craft at ${compressionLabel(L)} / ×${fmt(spd,2)}. Enter the real craft seconds to compare.`:`Enter that unit's speed × and a craft time to compute or verify.`;
    }
  }
  ["cbItem","cbComp"].forEach(id=>document.getElementById(id).addEventListener("input",()=>recalc(false)));
  [speedInput,secondsInput].forEach(input=>input.addEventListener("input",()=>recalc(true)));
  apply.addEventListener("click",()=>{
    if(computed==null)return;
    mutateState(st=>{st.baseTime[it.value]=computed;}); save(); renderRecipes(); renderResults(); recalc();
  });
  recalc();
}
function renderAll(){
  renderModeSwitch();
  renderLines();renderTargets();renderMinedResources();renderRecipes();renderResults();
  const margin=document.getElementById("margin"),maxTurbo=document.getElementById("maxTurbo"),dupe=document.getElementById("dupe");
  applyFieldInputAttributes(margin,FIELD_SCHEMA.margin,{step:0.5});
  applyFieldInputAttributes(maxTurbo,FIELD_SCHEMA.maxTurbo);
  applyFieldInputAttributes(dupe,FIELD_SCHEMA.dupe);
  margin.value=String(S.margin??FIELD_SCHEMA.margin.defaultValue);
  document.getElementById("marginv").textContent=fmt(S.margin??FIELD_SCHEMA.margin.defaultValue,1)+"%";
  maxTurbo.value=String(S.maxTurbo??FIELD_SCHEMA.maxTurbo.defaultValue);
  dupe.value=String(S.dupe??FIELD_SCHEMA.dupe.defaultValue);
}
const initialState=initializeState(renderAll);
initCalib();
document.getElementById("saveind").textContent="auto-saves locally";
if(initialState.recovery)showStateRecovery(initialState.recovery.raw,initialState.recovery.reason);
function costRow(pi,li,ci,c){
  const projectName=(S.projects[pi]&&S.projects[pi].name)||`Project ${pi+1}`;
  const opts=ALLITEMS.map(it=>`<option value="${it}" ${it===c.item?"selected":""}>${it}</option>`).join("");
  const txt=(c.qty!=null&&isFinite(c.qty))?formatGameNum(c.qty,4):"";
  const errorId=`field-project-${fieldDomToken(S.projects[pi]&&S.projects[pi].id||pi)}-quantity-${li}-${ci}-error`;
  return `<div class="cost-row">
    <select data-citem="${pi}_${li}_${ci}" aria-label="${htmlAttribute(projectName)} level ${li+1} item ${ci+1}">${opts}</select>
    <span class="field-stack cost-qty"><input type="text" ${htmlFieldInputAttributes(FIELD_SCHEMA.projectQuantity)} placeholder="qty" value="${txt}" data-cqty="${pi}_${li}_${ci}" data-field-error="${errorId}" aria-label="${htmlAttribute(projectName)} level ${li+1} ${htmlAttribute(c.item)} quantity"><span class="field-error" id="${errorId}" aria-live="polite" aria-atomic="true"></span></span>
    <button class="iconbtn" data-cdel="${pi}_${li}_${ci}" title="Remove item" aria-label="Remove ${htmlAttribute(c.item)} from ${htmlAttribute(projectName)} level ${li+1}">×</button>
  </div>`;
}
// Read-only cost lines for one level of a catalog project (non-zero costs only).
function catLevelView(L){
  const parts=(L.costs||[]).filter(c=>c.qty).map(c=>`${htmlText(c.item)} <b class="mono">${formatGameNum(c.qty,2)}</b>`);
  return parts.length?parts.join(' <span style="color:var(--ink3)">·</span> '):'<span style="color:var(--ink3)">free</span>';
}
// Compact +1/−1 level-completion stepper for a shopping-list card (issue #87 item 3). Uses the same
// projSpan/projDone clamps as the tracker and step modal, so completion stays consistent everywhere.
function projStepper(p,pi){
  const {span}=projSpan(p),done=projDone(p);
  return `<span class="lvl-step" title="Levels completed — increment as you finish them">
    <button class="iconbtn" data-psdec="${pi}" ${done<=0?"disabled":""} title="Mark one fewer level done" aria-label="Mark one fewer ${htmlAttribute(p.name)} level complete">−</button>
    <span class="mono proj-mini" title="levels completed">${done}/${span}</span>
    <button class="iconbtn" data-psinc="${pi}" ${done>=span?"disabled":""} title="Mark one more level done" aria-label="Mark one more ${htmlAttribute(p.name)} level complete">+</button>
  </span>`;
}
function projectFieldIds(p,scope="project"){
  const base=`field-${scope}-${fieldDomToken(p&&p.id)}`;
  return {from:`${base}-from-error`,to:`${base}-to-error`,priority:`${base}-priority-error`};
}
function projectRangeRule(p,endpoint){
  const count=Math.max(1,(p&&p.levels||[]).length);
  return fieldRuleWithBounds(FIELD_SCHEMA.projectIndex,{max:count,label:`${p&&p.name||"Project"} ${endpoint==="from"?"starting":"ending"} level`});
}
function parseProjectRangeDrafts(fromInput,toInput,p){
  const fromRule=projectRangeRule(p,"from"),toRule=projectRangeRule(p,"to");
  let from=readFieldDraft(fromInput,fromRule),to=readFieldDraft(toInput,toRule);
  const fromSyntax=from.status==="valid",toSyntax=to.status==="valid";
  if(fromSyntax&&toSyntax&&from.value>to.value){
    const fromValue=from.value,toValue=to.value;
    from={status:"invalid",message:`Enter a starting level no higher than ending level ${toValue}.`};
    to={status:"invalid",message:`Enter an ending level at least as high as starting level ${fromValue}.`};
  }
  updateFieldFeedback(fromInput,fieldErrorForInput(fromInput),fromRule,from,p.from);
  updateFieldFeedback(toInput,fieldErrorForInput(toInput),toRule,to,p.to);
  return {valid:from.status==="valid"&&to.status==="valid",from:from.value,to:to.value};
}
function commitProjectRangeDrafts(fromInput,toInput,p){
  const parsed=parseProjectRangeDrafts(fromInput,toInput,p);
  if(!parsed.valid)return {...parsed,committed:false};
  if(p.from!==parsed.from||p.to!==parsed.to)mutateState(()=>{
    p.from=parsed.from;p.to=parsed.to;
    p.done=Math.max(0,Math.min(parsed.to-parsed.from+1,Math.floor(num(p.done)||0)));
  });
  return {...parsed,committed:true};
}
// Compact card for a catalog-sourced project: name is a fixed label, costs are
// read-only, user only controls on/off, level range, "1st", and remove. Reuses
// the same data-* hooks as the editable card so existing handlers apply.
function compactProjCard(p,pi){
  const lv=p.levels||[];
  const view=lv.map((L,li)=>`<div class="cat-lvl"><span class="cat-lvl-n">Lv ${li+1}</span><span>${catLevelView(L)}</span></div>`).join("");
  const desc=p.description?`<span class="cat-card-desc">${htmlText(p.description)}</span>`:"";
  const single=lv.length<=1;
  const ids=projectFieldIds(p);
  const fromRule=projectRangeRule(p,"from"),toRule=projectRangeRule(p,"to");
  const range=single
    ? `<span class="proj-lvls one">1 level</span>`
    : `<span class="proj-lvls">lv <input type="number" ${htmlFieldInputAttributes(fromRule)} data-pfrom="${pi}" value="${p.from||1}" data-field-error="${ids.from}" aria-label="${htmlAttribute(p.name)} starting level"> → <input type="number" ${htmlFieldInputAttributes(toRule)} data-pto="${pi}" value="${p.to||lv.length}" data-field-error="${ids.to}" aria-label="${htmlAttribute(p.name)} ending level"></span>`;
  const bodyId=`projectBody${pi}`;
  const disclosureLabel=`${p._open?"Hide":"Show"} level costs for ${htmlAttribute(p.name)}`;
  return `<div class="proj cat-card ${p._open?"open":""}" data-pi="${pi}">
    <div class="proj-h">
      <button type="button" class="pchev" data-ptoggle="${pi}" title="${disclosureLabel}" aria-label="${disclosureLabel}" aria-expanded="${p._open?"true":"false"}" aria-controls="${bodyId}">▸</button>
      <input type="checkbox" data-pon="${pi}" ${p.on?"checked":""} title="Include in schedule" aria-label="Include ${htmlAttribute(p.name)} in schedule">
      <span class="pname-static">${htmlText(p.name)}${desc}</span>
      <div class="proj-tools">
        <label class="proj-prio" title="Manual order — type 1, 2, 3… to set the sequence; blank lets the planner pick. Material unlocks are always ordered first."><input type="number" class="pprio" ${htmlFieldInputAttributes(FIELD_SCHEMA.projectPriority)} data-pprio="${pi}" value="${p.prio!=null?p.prio:""}" placeholder="–" data-field-error="${ids.priority}" aria-label="${htmlAttribute(p.name)} schedule order">order</label>
        ${range}
        ${projStepper(p,pi)}
        <button class="iconbtn" data-pdel="${pi}" title="Remove from list" aria-label="Remove ${htmlAttribute(p.name)} from shopping list">×</button>
        <div class="proj-field-errors">${single?"":`<div class="field-error" id="${ids.from}" aria-live="polite" aria-atomic="true"></div><div class="field-error" id="${ids.to}" aria-live="polite" aria-atomic="true"></div>`}<div class="field-error" id="${ids.priority}" aria-live="polite" aria-atomic="true"></div></div>
      </div>
    </div>
    <div class="proj-b" id="${bodyId}"><div class="cat-lvls">${view}</div></div>
  </div>`;
}
function projCard(p,pi){
  if(p.catId)return compactProjCard(p,pi);
  const lv=p.levels||[];
  const lvlHtml=lv.map((L,li)=>{
    const rows=(L.costs||[]).map((c,ci)=>costRow(pi,li,ci,c)).join("");
    return `<div class="lvl-card">
      <div class="lvl-h"><span>Level ${li+1}</span><button type="button" class="lvl-del" data-pdellvl="${pi}" data-li="${li}" title="Delete level" aria-label="Delete ${htmlAttribute(p.name)} level ${li+1}">✕ remove</button></div>
      ${rows||'<div class="proj-mini" style="margin-bottom:5px">No items — add one.</div>'}
      <button class="btn ghost proj-add-lvl" data-paddcost="${pi}" data-li="${li}">+ item</button>
    </div>`;
  }).join("");
  const bodyId=`projectBody${pi}`;
  const disclosureLabel=`${p._open?"Hide":"Show"} level costs for ${htmlAttribute(p.name)}`;
  const ids=projectFieldIds(p),fromRule=projectRangeRule(p,"from"),toRule=projectRangeRule(p,"to");
  return `<div class="proj ${p._open?"open":""}" data-pi="${pi}">
    <div class="proj-h">
      <button type="button" class="pchev" data-ptoggle="${pi}" aria-label="${disclosureLabel}" aria-expanded="${p._open?"true":"false"}" aria-controls="${bodyId}">▸</button>
      <input type="checkbox" data-pon="${pi}" ${p.on?"checked":""} title="Include in schedule" aria-label="Include ${htmlAttribute(p.name)} in schedule">
      <input type="text" class="pname" data-pname="${pi}" value="${htmlAttribute(p.name)}" placeholder="Project name" aria-label="Project name">
      <div class="proj-tools">
        <label class="proj-prio" title="Manual order — type 1, 2, 3… to set the sequence; blank lets the planner pick. Material unlocks are always ordered first."><input type="number" class="pprio" ${htmlFieldInputAttributes(FIELD_SCHEMA.projectPriority)} data-pprio="${pi}" value="${p.prio!=null?p.prio:""}" placeholder="–" data-field-error="${ids.priority}" aria-label="${htmlAttribute(p.name)} schedule order">order</label>
        <span class="proj-lvls">lv <input type="number" ${htmlFieldInputAttributes(fromRule)} data-pfrom="${pi}" value="${p.from||1}" data-field-error="${ids.from}" aria-label="${htmlAttribute(p.name)} starting level"> → <input type="number" ${htmlFieldInputAttributes(toRule)} data-pto="${pi}" value="${p.to||lv.length||1}" data-field-error="${ids.to}" aria-label="${htmlAttribute(p.name)} ending level"></span>
        ${projStepper(p,pi)}
        <button class="iconbtn" data-pdup="${pi}" title="Duplicate" aria-label="Duplicate ${htmlAttribute(p.name)}" style="font-size:13px">⧉</button>
        <button class="iconbtn" data-pdel="${pi}" title="Delete project" aria-label="Delete ${htmlAttribute(p.name)}">×</button>
        <div class="proj-field-errors"><div class="field-error" id="${ids.from}" aria-live="polite" aria-atomic="true"></div><div class="field-error" id="${ids.to}" aria-live="polite" aria-atomic="true"></div><div class="field-error" id="${ids.priority}" aria-live="polite" aria-atomic="true"></div></div>
      </div>
    </div>
    <div class="proj-b" id="${bodyId}">
      ${lvlHtml}
      <button class="btn ghost proj-add-lvl" data-paddlvl="${pi}" style="margin-top:2px" aria-label="Add level to ${htmlAttribute(p.name)}">+ level</button>
    </div>
  </div>`;
}
function renderInv(){
  const box=document.getElementById("invRows");
  renderItemValueRows(box,S.inventoryText,S.inventory,"inv","0",FIELD_SCHEMA.inventory);
}
function setProjectStabilityPolicy(value){
  if(value!=="prefer-current"&&value!=="reoptimize")return false;
  mutateState(st=>{st.projectStability=value;});save();doSolve();return true;
}
function renderProjects(){
  const box=document.getElementById("projList");
  box.innerHTML=S.projects.length?S.projects.map((p,pi)=>projCard(p,pi)).join("")
    :`<div class="proj-mini" style="padding:6px 2px">No projects yet — add one to start building a schedule.</div>`;
  const st=document.getElementById("projSeqToggle");if(st)st.checked=S.projectSeq!==false;
  const gt=document.getElementById("projGateToggle");if(gt){gt.checked=S.projectGate===false;gt.disabled=S.projectSeq!==false;gt.closest(".seq-toggle").classList.toggle("disabled",gt.disabled);}
  const stability=document.getElementById("projectStability");if(stability)stability.value=S.projectStability==="reoptimize"?"reoptimize":"prefer-current";
  renderInv();
  if(typeof renderCatalog==="function")renderCatalog();
}
document.getElementById("projSeqToggle").addEventListener("change",e=>{mutateState(st=>{st.projectSeq=e.target.checked;});renderProjects();save();scheduleSolve();});
document.getElementById("projGateToggle").addEventListener("change",e=>{mutateState(st=>{st.projectGate=!e.target.checked;});save();scheduleSolve();});
document.getElementById("projectStability").addEventListener("change",e=>{setProjectStabilityPolicy(e.target.value);});

/* ---------- project catalog (static, read-only source list) ---------- */
const CATALOG=(typeof PROJECT_CATALOG!=="undefined"&&Array.isArray(PROJECT_CATALOG))?PROJECT_CATALOG:[];
let catQuery="";
const projectHasCat=catId=>(S.projects||[]).some(p=>p.catId===catId);
function addCatalogProject(catId){
  const src=CATALOG.find(c=>c.catId===catId);
  if(!src||projectHasCat(catId))return;
  mutateState(st=>{st.projects.push({
      id:newId(),catId:src.catId,name:src.name,description:src.description||"",
      on:true,prio:null,from:1,to:src.levels.length||1,done:0,
      levels:JSON.parse(JSON.stringify(src.levels)),_open:false
    });
  });
  renderProjects();renderCatalog();save();scheduleSolve();
}
function renderCatalog(){
  const list=document.getElementById("catList");if(!list)return;
  const q=catQuery.trim().toLowerCase();
  const items=CATALOG.filter(c=>!q||c.name.toLowerCase().includes(q)||(c.description||"").toLowerCase().includes(q));
  const added=CATALOG.filter(c=>projectHasCat(c.catId)).length;
  const cc=document.getElementById("catCount");if(cc)cc.textContent=`${added}/${CATALOG.length} added`;
  list.innerHTML=items.length?items.map(c=>{
    const has=projectHasCat(c.catId);
    const lvls=c.levels.length;
    const meta=`${lvls} level${lvls===1?"":"s"}${c.description?" · "+htmlText(c.description):""}`;
    return `<div class="cat-row${has?" added":""}">
      <div class="cat-row-info"><span class="cat-row-name">${htmlText(c.name)}</span><span class="cat-row-meta">${meta}</span></div>
      <button class="btn ${has?"ghost":"primary"} cat-add" data-cat-add="${htmlAttribute(c.catId)}" aria-label="${has?"Added":"Add"} ${htmlAttribute(c.name)}${has?"":" to shopping list"}" ${has?"disabled":""}>${has?"Added":"Add"}</button>
    </div>`;
  }).join(""):`<div class="proj-mini" style="padding:6px 2px">No matching projects.</div>`;
}
const catListEl=document.getElementById("catList");
if(catListEl)catListEl.addEventListener("click",e=>{
  const btn=e.target.closest("[data-cat-add]");if(!btn||btn.disabled)return;
  addCatalogProject(btn.getAttribute("data-cat-add"));
});
const catSearchEl=document.getElementById("catSearch");
if(catSearchEl)catSearchEl.addEventListener("input",e=>{catQuery=e.target.value;renderCatalog();});

const projectsDialog=dialogController.register({root:document.getElementById("projModal"),panel:document.querySelector("#projModal .modal"),opener:document.getElementById("btnProjects"),initialFocus:()=>document.getElementById("projSeqToggle"),onOpen:()=>{renderProjects();renderCatalog();}});
function openProjects(invoker){projectsDialog.open(invoker);}
function closeProjects(){projectsDialog.close();}
document.getElementById("projAdd").addEventListener("click",()=>{
  mutateState(st=>{st.projects.push({id:newId(),name:"New project",on:true,prio:null,from:1,to:1,done:0,levels:[{costs:[]}],_open:true});});
  renderProjects();save();scheduleSolve();
});
document.getElementById("projClear").addEventListener("click",()=>{
  if(!(S.projects||[]).length)return;
  if(!confirm("Remove all projects from the shopping list? This clears every added catalog project and custom project."))return;
  mutateState(st=>{st.projects=[];});
  renderProjects();save();scheduleSolve();
});
document.getElementById("projInvClear").addEventListener("click",()=>{
  if(!confirm("Clear all inventory amounts?"))return;
  mutateState(st=>{ALLITEMS.forEach(it=>{st.inventory[it]=null;st.inventoryText[it]="";});});
  renderInv();save();scheduleSolve();
});
document.getElementById("projList").addEventListener("click",e=>{
  const t=e.target,g=a=>t.getAttribute(a);
  let v;
  if((v=g("data-ptoggle"))!=null){mutateState(st=>{st.projects[+v]._open=!st.projects[+v]._open;});schedulePersist();renderProjects();const disclosure=document.querySelector(`[data-ptoggle="${v}"]`);if(disclosure)disclosure.focus();return;}
  if((v=g("data-pdel"))!=null){if(confirm("Delete this project?")){mutateState(st=>{st.projects.splice(+v,1);});renderProjects();save();scheduleSolve();}return;}
  if((v=g("data-pdup"))!=null){mutateState(st=>{const c=JSON.parse(JSON.stringify(st.projects[+v]));c.id=newId();c.name=(c.name||"Project")+" copy";c._open=true;st.projects.splice(+v+1,0,c);});renderProjects();save();scheduleSolve();return;}
  if((v=g("data-paddlvl"))!=null){mutateState(st=>{const p=st.projects[+v];p.levels.push({costs:[]});p.to=p.levels.length;});renderProjects();save();scheduleSolve();return;}
  if((v=g("data-pdellvl"))!=null){const pi=+v,li=+g("data-li");mutateState(st=>{const p=st.projects[pi];p.levels.splice(li,1);if(p.levels.length===0)p.levels.push({costs:[]});if(p.to>p.levels.length)p.to=p.levels.length;if(p.from>p.levels.length)p.from=p.levels.length;});renderProjects();save();scheduleSolve();return;}
  if((v=g("data-paddcost"))!=null){const pi=+v,li=+g("data-li");mutateState(st=>{st.projects[pi].levels[li].costs.push({item:PRODUCTS[0],qty:null});});renderProjects();save();scheduleSolve();return;}
  if((v=g("data-cdel"))!=null){const[pi,li,ci]=v.split("_").map(Number);mutateState(st=>{st.projects[pi].levels[li].costs.splice(ci,1);});renderProjects();save();scheduleSolve();return;}
  // +1/−1 level completion on a shopping-list card (issue #87 item 3) — clamped to the from→to span.
  if((v=g("data-psinc"))!=null||(v=g("data-psdec"))!=null){const inc=g("data-psinc")!=null,p=S.projects[+v];if(!p)return;mutateState(()=>{const {span}=projSpan(p);p.done=Math.max(0,Math.min(span,projDone(p)+(inc?1:-1)));});renderProjects();save();scheduleSolve();return;}
});
document.getElementById("projList").addEventListener("input",e=>{
  const t=e.target,g=a=>t.getAttribute(a);let v;
  if((v=g("data-pname"))!=null){
    mutateState(st=>{st.projects[+v].name=t.value;});
    const disclosure=t.closest(".proj").querySelector("[data-ptoggle]");
    if(disclosure){const label=`${S.projects[+v]._open?"Hide":"Show"} level costs for ${t.value.trim()||"untitled project"}`;disclosure.setAttribute("aria-label",label);disclosure.title=label;}
    save();scheduleSolve();return;
  }
  if((v=g("data-pfrom"))!=null||(v=g("data-pto"))!=null){
    const pi=+v,p=S.projects[pi],card=t.closest(".proj");if(!p||!card)return;
    const fromInput=card.querySelector(`[data-pfrom="${pi}"]`),toInput=card.querySelector(`[data-pto="${pi}"]`);
    if(!fromInput||!toInput)return;
    const result=commitProjectRangeDrafts(fromInput,toInput,p);
    if(result.committed){save();scheduleSolve();}return;
  }
  if((v=g("data-pprio"))!=null){const pi=+v,p=S.projects[pi];if(!p)return;const result=commitFieldDraft(t,FIELD_SCHEMA.projectPriority,p.prio,(st,value)=>{st.projects[pi].prio=value;});if(result.committed){save();scheduleSolve();}return;}
  if((v=g("data-cqty"))!=null){const[pi,li,ci]=v.split("_").map(Number),cost=S.projects[pi].levels[li].costs[ci];const result=commitFieldDraft(t,FIELD_SCHEMA.projectQuantity,cost.qty,(st,value)=>{st.projects[pi].levels[li].costs[ci].qty=value;});if(result.committed){save();scheduleSolve();}return;}
});
document.getElementById("projList").addEventListener("change",e=>{
  const t=e.target,g=a=>t.getAttribute(a);let v;
  if((v=g("data-pon"))!=null){mutateState(st=>{st.projects[+v].on=t.checked;});save();scheduleSolve();return;}
  if((v=g("data-citem"))!=null){const[pi,li,ci]=v.split("_").map(Number);mutateState(st=>{st.projects[pi].levels[li].costs[ci].item=t.value;});save();scheduleSolve();return;}
});
document.getElementById("invRows").addEventListener("input",e=>{
  const it=e.target.getAttribute("data-inv");if(!it)return;
  const result=commitFieldDraft(e.target,FIELD_SCHEMA.inventory,S.inventory[it],(st,value,raw)=>{st.inventoryText[it]=raw;st.inventory[it]=value;});
  if(result.committed){save();scheduleSolve();}
});

/* ---------- Progress tracker modal ---------- */
// Levels completed for a project, clamped to its from→to span (non-destructive).
function projSpan(p){const n=(p.levels||[]).length;const from=Math.max(1,Math.min(n||1,Math.floor(num(p.from)||1)));const to=Math.max(from,Math.min(n,Math.floor(num(p.to)||n)));return {from,to,span:to-from+1};}
function projDone(p){const {span}=projSpan(p);return Math.max(0,Math.min(span,Math.floor(num(p.done)||0)));}
function renderProgress(){
  const list=document.getElementById("progList");
  const sum=document.getElementById("progSummary");
  if(!list||!sum)return;
  const active=(S.projects||[]).filter(p=>p.on&&(p.levels||[]).length);
  if(!active.length){
    sum.innerHTML="";
    list.innerHTML=`<div class="notice info">No active projects. Open <b>Shopping list</b>, add or tick on a project, then track its level progress here.</div>`;
    return;
  }
  let totalLv=0,doneLv=0;
  active.forEach(p=>{const {span}=projSpan(p);totalLv+=span;doneLv+=projDone(p);});
  const currentKey=solveStateKey(S);
  const current=_lastProjectRes&&_lastProjectKey===currentKey;
  const status=solveService.status();
  const updating=!current&&(renderT!=null||(status.active&&status.current&&status.mode==="project"));
  const res=current?_lastProjectRes:null;
  const remLv=totalLv-doneLv;
  const pct=totalLv?Math.round(doneLv/totalLv*100):0;
  const etaTxt=(res&&!res.empty&&remLv>0)?fmtDuration(res.eta):(remLv>0?(updating?"updating…":"out of date — Resimulate"):"all done 🎉");
  sum.innerHTML=`
    <div class="prog-bar-wrap"><div class="prog-bar" style="width:${pct}%"></div></div>
    <div class="prog-metrics">
      <div class="prog-metric"><div class="pm-v">${doneLv}/${totalLv}</div><div class="pm-l">levels done</div></div>
      <div class="prog-metric"><div class="pm-v">${remLv}</div><div class="pm-l">levels left</div></div>
      <div class="prog-metric"><div class="pm-v">${etaTxt}</div><div class="pm-l">time remaining</div></div>
    </div>${res&&!res.empty&&!res.feasible&&remLv>0?`<div class="notice warn" style="margin:10px 0 0;font-size:11.5px">Plan isn't fully sustainable with current lines — see the main panel for blocked items.</div>`:""}`;
  list.innerHTML=active.map(p=>{
    const {from,to,span}=projSpan(p);
    const done=projDone(p);
    const complete=done>=span;
    const chips=[];
    for(let L=from;L<=to;L++){
      const idx=L-from, isDone=idx<done, isNext=idx===done;
      const projectName=p.name||"Project";
      const chipLabel=isDone?`Undo ${projectName} level ${L} completion`:`Mark ${projectName} completed through level ${L}`;
      chips.push(`<button class="prog-lvl${isDone?" done":""}${isNext?" next":""}" data-pid="${htmlAttribute(p.id)}" data-lvl="${L}" aria-label="${htmlAttribute(chipLabel)}" title="${htmlAttribute(chipLabel)}"><span class="pl-box"></span>Lv ${L}</button>`);
    }
    const desc=p.description?`<span class="prog-desc">${htmlText(p.description)}</span>`:"";
    return `<div class="prog-proj${complete?" complete":""}">
      <div class="prog-proj-h">
        <div class="prog-proj-name">${htmlText(p.name||"Project")}${complete?' <span class="pill craft" style="font-size:9px">done</span>':""}${desc}</div>
        <div class="prog-proj-meta"><span class="mono">${done}/${span}</span>${done>0?`<button class="prog-reset" data-preset="${htmlAttribute(p.id)}" aria-label="Reset ${htmlAttribute(p.name||"Project")} progress" title="Reset ${htmlAttribute(p.name||"Project")} progress">reset</button>`:""}</div>
      </div>
      <div class="prog-lvls">${chips.join("")}</div>
    </div>`;
  }).join("");
}
function setProjDone(pid,newDone){
  const p=(S.projects||[]).find(x=>x.id===pid);if(!p)return;
  const {span}=projSpan(p);
  mutateState(()=>{p.done=Math.max(0,Math.min(span,Math.floor(newDone)));});
  persistNow();scheduleSolve();renderProgress();
}
const progressDialog=dialogController.register({root:document.getElementById("progModal"),panel:document.querySelector("#progModal .modal"),opener:null,initialFocus:()=>document.getElementById("progDone"),onOpen:renderProgress});
function openProgress(invoker){progressDialog.open(invoker);}
function closeProgress(){progressDialog.close();}
document.getElementById("progList").addEventListener("click",e=>{
  const reset=e.target.closest("[data-preset]");
  if(reset){setProjDone(reset.getAttribute("data-preset"),0);return;}
  const chip=e.target.closest(".prog-lvl");
  if(chip){
    const pid=chip.getAttribute("data-pid"),L=+chip.getAttribute("data-lvl");
    const p=(S.projects||[]).find(x=>x.id===pid);if(!p)return;
    const {from}=projSpan(p),idx=L-from,done=projDone(p);
    setProjDone(pid,done===idx+1?idx:idx+1);   // click the last-done level to undo it, any other to complete through it
  }
});
document.getElementById("progResetAll").addEventListener("click",()=>{
  if(!(S.projects||[]).some(p=>projDone(p)>0))return;
  if(!confirm("Reset completed-level progress on all projects?"))return;
  mutateState(st=>{(st.projects||[]).forEach(p=>{p.done=0;});});
  persistNow();scheduleSolve();renderProgress();
});

/* ---------- Step-by-step plan modal ---------- */
function itemTier(it,seen){
  if(RAWS.includes(it)||it===GEL)return 0;
  seen=seen||new Set();if(seen.has(it))return 0;seen.add(it);
  const deps=(RECIPE[it]&&RECIPE[it].inputs||[]).filter(k=>RAWS.includes(k)||PRODUCTS.includes(k));
  return deps.length?1+Math.max(...deps.map(k=>itemTier(k,new Set(seen)))):1;
}
// Issue #69: let the user set a project complete or change its levels without leaving this page.
// Reuses the same fields the Shopping list & Progress tracker edit (on / from / to / done), so all
// three views stay in sync. Completion = every level in the from→to span checked off (done=span).
function stepsProjControls(){
  const active=(S.projects||[]).filter(p=>(p.levels||[]).length);
  if(!active.length)return "";
  const rows=active.map(p=>{
    const {from,to,span}=projSpan(p),done=projDone(p),complete=done>=span;
    const name=p.name||"Project";
    const badge=complete?' <span class="pill craft" style="font-size:9px">done</span>':"";
    const ids=projectFieldIds(p,"inline-project"),fromRule=projectRangeRule(p,"from"),toRule=projectRangeRule(p,"to");
    return `<div class="proj-inline-row">
      <input type="checkbox" data-spon="${htmlAttribute(p.id)}" ${p.on?"checked":""} aria-label="Include ${htmlAttribute(name)} in the plan" title="Include ${htmlAttribute(name)} in the plan">
      <span style="flex:1 1 130px;min-width:110px;${complete?"color:var(--ink3)":""}">${htmlText(name)}${badge}</span>
      <span class="proj-mini proj-inline-range">lv <input type="number" ${htmlFieldInputAttributes(fromRule)} data-spfrom="${htmlAttribute(p.id)}" value="${from}" data-field-error="${ids.from}" aria-label="${htmlAttribute(name)} starting level"> → <input type="number" ${htmlFieldInputAttributes(toRule)} data-spto="${htmlAttribute(p.id)}" value="${to}" data-field-error="${ids.to}" aria-label="${htmlAttribute(name)} ending level"></span>
      <span class="lvl-step" title="Mark levels done one at a time">
        <button class="iconbtn" data-spdec="${htmlAttribute(p.id)}" ${done<=0?"disabled":""} aria-label="Mark one fewer ${htmlAttribute(name)} level done" title="Mark one fewer ${htmlAttribute(name)} level done">−</button>
        <span class="mono proj-mini" title="levels completed">${done}/${span}</span>
        <button class="iconbtn" data-spinc="${htmlAttribute(p.id)}" ${done>=span?"disabled":""} aria-label="Mark one more ${htmlAttribute(name)} level done" title="Mark one more ${htmlAttribute(name)} level done">+</button>
      </span>
      <button class="btn ghost" style="padding:2px 9px;font-size:11px" data-spcomplete="${htmlAttribute(p.id)}" aria-label="${complete?"Reopen":"Mark"} ${htmlAttribute(name)} ${complete?"project":"complete"}">${complete?"Reopen":"Mark complete"}</button>
      <div class="proj-inline-errors"><div class="field-error" id="${ids.from}" aria-live="polite" aria-atomic="true"></div><div class="field-error" id="${ids.to}" aria-live="polite" aria-atomic="true"></div></div>
    </div>`;
  }).join("");
  // Rows only — the caller (renderProjectResults) wraps these in a collapsible <details> panel.
  return rows;
}
// Build the step-by-step plan HTML — the main Project-mode panel (was a modal body). Pure: returns the
// intro + phase cards for a solved project result and lets renderProjectResults own the DOM and the
// surrounding controls. Returns "" when there's no plan yet.
function stepPlanHtml(res){
  if(!res||res.empty||!res.phases||!res.phases.length)return "";
  const valid=!!(res.feasible&&res.lpFeasible&&res.scheduleValidation&&res.scheduleValidation.ok),execution=res.executionPhases||[];
  let h=valid
    ?`<p class="help" style="margin:0 0 12px">Follow the prerequisite, warm-up, and project phases <b>in order</b>. Every line switch and stock figure comes from the executable replay. Total ≈ <b>${fmtDuration(res.eta)}</b>. <span style="color:var(--ink3)">Clock times count from the <b>plan start</b> above.</span></p>`
    :`<div class="notice warn"><b>No executable run instructions are available.</b> The analytical LP breakdown is retained below for diagnosis, but it must not be followed as a schedule.</div>`;
  if(!valid)return h;
  const _ps=(S.planStart!=null&&isFinite(S.planStart))?new Date(S.planStart):null;
  const now=(_ps&&!isNaN(_ps.getTime()))?_ps:new Date();
  const fmtClock=h=>{
    if(!isFinite(h)||h<0)return "";
    const d=new Date(now.getTime()+h*3600000);
    let t=d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
    const dayDiff=Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-new Date(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
    if(dayDiff>0)t+=` (${d.toLocaleDateString([],{month:"short",day:"numeric"})})`;   // show the actual date when it lands on a later day, not "+Nd"
    return t;
  };
  let phaseStart=0;
  const allBoundaries=res.scheduleValidation.boundaries||[];
  execution.forEach((ph,i)=>{
    const pStart=phaseStart; phaseStart+=ph.eta||0;
    const lines=(ph.plan||[]).filter(p=>p.entries&&p.entries.length).map(p=>({
      line:p.line,max:p.max,
      segs:p.entries
    }));
    h+=`<div class="step-phase">`;
    const label=ph.kind==="prerequisite"?"External prerequisite":ph.kind==="warmup"?"Warm-up":htmlText(ph.name||"Project phase");
    h+=`<div class="step-h"><span class="step-n">${i+1}</span> <b>${label}</b> <span class="proj-mini">${ph.eta>0?"· "+fmtDuration(ph.eta)+" · complete by ":"· before crafting begins"}</span>${ph.eta>0?'<span class="step-clock">~'+fmtClock(pStart+(ph.eta||0))+'</span>':""}</div>`;
    if(ph.kind==="prerequisite"){
      const supply=Object.entries(ph.externalSupply||{}).map(([resource,amount])=>{const current=(ph.invStart&&ph.invStart[resource])||0;
        const total=(ph.prerequisiteDemand&&ph.prerequisiteDemand[resource])||current+amount;
        return `Pre-produce <b>${disp(amount)} more ${htmlText(resource)}</b> (<b>${disp(total)} total</b>; <b>${disp(current)} currently on hand</b>)`;}).join(" and ");
      h+=`<div class="notice info" style="font-size:11px;margin:4px 0 6px">${supply} before starting. Same-phase production cannot satisfy this prerequisite.</div></div>`;return;
    }
    if(!lines.length){h+=`<div class="proj-mini" style="padding:2px 0">No line activity.</div></div>`;return;}
    const onHandAt=(item,elapsed)=>{const matches=allBoundaries.filter(b=>b.phaseIndex===i&&b.kind==="switch"&&Math.abs((b.phaseTime||0)-elapsed)<1e-7);
      const boundary=matches[matches.length-1];return boundary&&boundary.inventory?boundary.inventory[item]:null;};
    h+=`<ol class="step-list">`;
    lines.forEach(L=>{
      const parts=L.segs.map(s=>{
        const elapsed=s.end;
        const at=fmtClock(pStart+elapsed);
        const tag=at?` <span class="proj-mini">· until </span><span class="step-clock">~${at}</span>`:"";
        const onHand=onHandAt(s.item,elapsed),stock=onHand!=null?` <span class="proj-mini">· <b>${disp(onHand)}</b> on hand</span>`:"";
        const verb=RAWS.includes(s.item)?"produce":"craft";
        const cfg=MINED_CRAFTS[s.item],mined=cfg?` <span class="proj-mini">· uses ${cfg.resource} income</span>`:"";
        return `${verb} <b>${s.item}</b> @${compressionLabel(s.lvl)}${s.frac>=0.999?" (whole phase)":` for ~${fmtDuration(s.frac*ph.eta)}`}${mined}${tag}${stock}`;
      });
      const segHtml=parts.map((p,idx)=>`<div class="step-seg">${idx===0?'<span class="step-then">→</span>':'<span class="step-then">then</span>'} ${p}</div>`).join('');
      h+=`<li><span class="mono" style="color:var(--amber)">Line #${L.line}</span> <span class="proj-mini">(${compressionLabel(L.max)} cap)</span>${segHtml}</li>`;
    });
    h+=`</ol>${minedUsageNote(ph.minedUsage||[])}</div>`;
  });
  return h;
}
// ── Plan-start + inline project controls, now living in the Project-mode panel (#results) ──
// The step plan and its controls used to be a modal; promoting them into #results means every edit
// re-renders the plan in place. #results is rebuilt on each solve, so all of this is delegated.
// S.planStart (issue #87 item 1) is epoch ms, or null for a live "now" — a display anchor only; the
// schedule's durations are elapsed-hours from the solver and don't depend on it. It's seeded once, the
// first time a real plan exists, in renderProjectResults (results.js).
const stepsProj=pid=>(S.projects||[]).find(x=>x.id===pid);
// Repaint the project panel from the cached result WITHOUT re-solving — for changes that only move the
// display anchor (plan start / "Now"), not the plan itself.
function repaintProject(){
  if(S.mode!=="project")return;
  const el=document.getElementById("results"),stat=document.getElementById("solveStat");
  if(el&&_lastProjectRes)renderProjectResults(_lastProjectRes,el,stat);
}
document.getElementById("results").addEventListener("input",e=>{
  const t=e.target;if(!t||!t.getAttribute)return;let v;
  // Parse the two visible endpoints as one draft transaction. Either correction can make both
  // drafts valid; only then are both accepted together, without rebuilding the focused row.
  if((v=t.getAttribute("data-spfrom"))!=null||(v=t.getAttribute("data-spto"))!=null){
    const p=stepsProj(v),row=t.closest(".proj-inline-row");if(!p||!row)return;
    const fromInput=row.querySelector("[data-spfrom]"),toInput=row.querySelector("[data-spto]");
    if(!fromInput||!toInput)return;
    const result=commitProjectRangeDrafts(fromInput,toInput,p);if(result.committed)save();return;
  }
});
document.getElementById("results").addEventListener("change",e=>{
  const t=e.target;if(!t||!t.getAttribute)return;let v;
  // Plan-start anchor: display-only, so repaint from cache (no solve).
  if(t.id==="spStart"){const val=t.value,ms=val?new Date(val).getTime():null;if(!val||!isNaN(ms))mutateState(st=>{st.planStart=ms;});save();repaintProject();return;}
  // Inline project controls — same fields as Shopping list / Track progress, kept in sync. These change
  // demand, so re-solve; doSolve() rebuilds #results (and thus the plan) right away.
  if((v=t.getAttribute("data-spon"))!=null){const p=stepsProj(v);if(p){mutateState(()=>{p.on=t.checked;});save();doSolve();}return;}
  if((v=t.getAttribute("data-spfrom"))!=null||(v=t.getAttribute("data-spto"))!=null){
    const p=stepsProj(v),row=t.closest(".proj-inline-row");if(!p||!row)return;
    const fromInput=row.querySelector("[data-spfrom]"),toInput=row.querySelector("[data-spto]");
    if(!fromInput||!toInput)return;
    const result=commitProjectRangeDrafts(fromInput,toInput,p);if(result.committed)doSolve();return;
  }
  // Manual-mode dropdowns also live inside #results (re-rendered each change)
  if(t.id==="manualPreset"){if(t.value)loadManualPreset(t.value);return;}
  const ri=t.getAttribute("data-mres");
  if(ri!=null){const i=+ri;if(S.manual[i])mutateState(st=>{st.manual[i].job=t.value;if(st.manual[i].lvl>st.lines[i].max)st.manual[i].lvl=st.lines[i].max;});save();renderResults();return;}
  const lv=t.getAttribute("data-mlvl");
  if(lv!=null){const i=+lv;if(S.manual[i])mutateState(st=>{st.manual[i].lvl=+t.value;});save();renderResults();return;}
  const sl=t.getAttribute("data-msell");
  if(sl!=null){const i=+sl;if(S.manual[i])mutateState(st=>{st.manual[i].sell=t.checked;});save();renderResults();return;}
});
document.getElementById("results").addEventListener("click",e=>{
  const cl=sel=>e.target.closest&&e.target.closest(sel);
  if(cl("#btnProgress")){openProgress(cl("#btnProgress"));return;}
  // Plan-start "Now" — re-anchor the clock to the current moment (display only).
  if(cl("#spNow")){mutateState(st=>{st.planStart=Date.now();});save();repaintProject();return;}
  const stabilityAction=cl("[data-project-stability]");
  if(stabilityAction){setProjectStabilityPolicy(stabilityAction.getAttribute("data-project-stability"));return;}
  // Persist a disclosure's open state across the next re-render. The native <details> toggle still
  // fires; at click time .open is the pre-toggle state, so the new state is its inverse.
  const sm=cl("summary[data-paneltoggle]");
  if(sm){const k=sm.getAttribute("data-paneltoggle"),willOpen=!(sm.parentElement&&sm.parentElement.open);
    if(k==="adjust")_projAdjustOpen=willOpen;else if(k==="breakdown")_breakdownOpen=willOpen;return;}
  // Granular +1/−1 level completion (issue #87 item 3) — clamped to the from→to span, reusing the
  // projSpan/projDone helpers the tracker and solver read, so every view stays in sync.
  const inc=cl("[data-spinc]"),dec=cl("[data-spdec]");
  if(inc||dec){const p=stepsProj((inc||dec).getAttribute(inc?"data-spinc":"data-spdec"));if(!p)return;
    mutateState(()=>{const {span}=projSpan(p);p.done=Math.max(0,Math.min(span,projDone(p)+(inc?1:-1)));});save();doSolve();return;}
  const cbtn=cl("[data-spcomplete]");
  if(cbtn){const p=stepsProj(cbtn.getAttribute("data-spcomplete"));if(!p)return;
    mutateState(()=>{const {span}=projSpan(p);p.done=projDone(p)>=span?0:span;});save();doSolve();return;}   // toggle done/reopen
  if(cl("#btnCopyManual")){copyPlanToManual(_lastItemsCreditsRes);return;}
  if(cl("#manualUpdate")){if(S.manualActiveId)updateManualPreset(S.manualActiveId);return;}
  if(cl("#manualSaveNew")){const name=(prompt("Name this setup:","")||"").trim();if(name)saveManualPreset(name);return;}
  if(cl("#manualDelPreset")){const sel=document.getElementById("manualPreset");const id=(sel&&sel.value)||S.manualActiveId;if(id&&confirm("Delete this saved setup?"))deleteManualPreset(id);return;}
});

document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flushPersist();});
window.addEventListener("pagehide",()=>{
  flushPersist();
  if(renderT!=null){clearTimeout(renderT);renderT=null;}
  solveService.cancel("Page teardown");
});
