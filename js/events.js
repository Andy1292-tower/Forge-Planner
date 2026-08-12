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
  if(stateMatchesPersisted()){persistedRevision=revision;return true;}
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
// Controls inside #results mutate the accepted state immediately, but the matching result must not
// repaint unless those exact bytes also pass validation and persist. On rejection, restore the last
// accepted/persisted state and put the still-visible control back in sync with it.
function commitResultMutation(mutator,syncControls){
  const previous=solveStateSnapshot(S);
  mutateState(mutator);
  if(persistNow()===false){
    commitState(previous);
    // persistNow() cancels any older debounce before trying this write. The restored snapshot may
    // still contain an earlier accepted edit that has not reached storage yet, so recreate that
    // pending persistence instead of pretending the restored revision is already durable.
    if(stateMatchesPersisted())persistedRevision=stateRevision;
    else{persistedRevision=-1;schedulePersist();}
    if(typeof syncControls==="function")syncControls(false);
    return false;
  }
  if(typeof syncControls==="function")syncControls(true);
  renderResults();
  return true;
}
function hasInvalidFieldDraft(){
  return [...document.querySelectorAll('[aria-invalid="true"]')].some(input=>input.offsetParent!==null);
}
function doSolve(options){
  renderT=null;
  if(hasInvalidFieldDraft())return false;
  if(persistNow()===false)return false;
  renderResults(options);return true;
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
// typically batch many speed/turbo changes before checking output. Ticking projects on and off
// is the same shape of edit — unticking four projects should cost one solve, not four. So rather
// than auto-solving on every change, those edits just persist (save) and mark the shown
// results stale; the user clicks Resimulate — or presses Enter in a line field — to
// recompute once. Any actual repaint (resimulate, mode switch, …) clears the stale UI.
// The bar names what was changed, so a plan left stale is still legible after a tab switch;
// batching two kinds of edit before resimulating names both.
const STALE_CAUSES={lines:"crafter line inputs",projects:"project selection"};
const staleCauses=new Set();
function showStale(){
  const on=staleCauses.size>0;
  const bar=document.getElementById("staleBar");
  if(bar){
    const msg=bar.querySelector&&bar.querySelector(".stale-msg");
    if(msg&&on)msg.textContent=`Plan out of date — ${[...staleCauses].map(c=>STALE_CAUSES[c]).join(" and ")} changed. Press Resimulate to update it.`;
    bar.hidden=!on;
  }
  const res=document.getElementById("results");if(res)res.classList.toggle("stale",on);
}
function clearStaleUI(){staleCauses.clear();showStale();}
function markStale(cause){clearTimeout(renderT);renderT=null;persistNow();staleCauses.add(STALE_CAUSES[cause]?cause:"lines");showStale();}
// Ticking a project in or out of the schedule, from either place that offers the tick. Only Project
// plan reads the selection, so anywhere else this is a quiet edit — raising a "plan out of date" bar
// over a Max items plan the tick cannot affect would be a false alarm.
function commitProjectInclusion(mutator){
  mutateState(mutator);
  if(S.mode==="project")markStale("projects");else save();
}
// The mirror of the above, for the Outputs card. Nothing in it is read by every mode, and the card
// is not mode-gated, so without a guard a tick would spend the whole solve budget re-deriving a plan
// that cannot read it. The edit still saves — it just isn't a reason to re-solve.
//   Checked outputs, weights/shares, mix mode: Max items alone (optimizeInner's items branch).
//     Credits ranks one dedicated plan per priced item and ignores the checkboxes, Project derives
//     its demand from the shopping list, and Manual evaluates the lines you set.
//   May-work margin: Max items and Credits, the two that reach solveCore's tolerance. Project pins
//     it at zero (tolOverride) and Manual reports concrete balances instead.
function solveForOutputMix(){if(S.mode==="items")scheduleSolve();}
function solveForMargin(){if(S.mode==="items"||S.mode==="credits")scheduleSolve();}
function commitLineStructureEdit(mutator,renderLineControls){
  // Manual has no expensive solver to defer. Repaint it immediately so its editable rows and
  // compression choices cannot lag behind the accepted line list while Manual is already active.
  // The shared transaction also restores the line controls when persistence rejects the edit.
  if(S.mode==="manual")return commitResultMutation(mutator,accepted=>{if(renderLineControls||!accepted)renderLines();});
  mutateState(mutator);if(renderLineControls)renderLines();markStale();return true;
}
function resimulate(){doSolve({forceFresh:true});}   // explicit refresh replaces today's Items/Credits cache once
document.getElementById("btnResim").addEventListener("click",resimulate);

document.getElementById("lines").addEventListener("change",e=>{
  const li=e.target.dataset.line;
  // The line controls are deliberately not rebuilt here, so the level note under the
  // picker has to be repainted by hand to follow the cap the user just chose.
  if(li!==undefined&&commitLineStructureEdit(st=>{st.lines[+li].max=+e.target.value;syncManual(st);},false))refreshLineNotes();
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
  if(d!==undefined&&S.lines.length>1)commitLineStructureEdit(st=>{st.lines.splice(+d,1);st.manual.splice(+d,1);syncManual(st);},true);
});
document.getElementById("btnAddLine").addEventListener("click",()=>{
  commitLineStructureEdit(st=>{st.lines.push({max:512,spx:1,turbo:0});syncManual(st);},true);
});

document.getElementById("margin").addEventListener("input",e=>{
  const result=commitFieldDraft(e.target,FIELD_SCHEMA.margin,S.margin,(st,value)=>{st.margin=value;});
  if(result.committed){document.getElementById("marginv").textContent=fmt(S.margin,1)+"%";save();solveForMargin();}
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
  if(tg){mutateState(st=>{st.targets[tg].on=e.target.checked;});renderTargets();save();solveForOutputMix();}
});
document.getElementById("targets").addEventListener("input",e=>{
  const w=e.target.dataset.w;
  if(w){const result=commitFieldDraft(e.target,FIELD_SCHEMA.targetWeight,S.targets[w].w,(st,value)=>{st.targets[w].w=value;});if(result.committed){e.target.parentElement.querySelector(".pv").textContent=String(result.value);save();solveForOutputMix();}}
  const share=e.target.dataset.share;
  if(share){
    const result=commitFieldDraft(e.target,FIELD_SCHEMA.targetShare,targetShareOf(S.targets[share]),(st,value)=>{st.targets[share].share=value;});
    if(result.committed){e.target.parentElement.querySelector(".pv").textContent=result.value+"%";save();solveForOutputMix();}
  }
});
// Switching mode re-reads a different number off every checked output, so it is a solve input, not
// a display toggle. Both numbers are kept, so switching back restores what was there.
document.getElementById("targetModeSw").addEventListener("click",e=>{
  const button=e.target.closest&&e.target.closest("button");if(!button)return;
  const mode=button.dataset.targetmode;
  if(mode!=="ratio"&&mode!=="share")return;
  if(S.targetMode===mode)return;
  mutateState(st=>{st.targetMode=mode;});
  renderTargets();
  const replacement=document.querySelector(`#targetModeSw button[data-targetmode="${mode}"]`);
  if(replacement)replacement.focus();
  save();solveForOutputMix();
});

/* ---------- saved output sets ---------- */
// Every one of these rewrites the checkbox list, which renderTargets() rebuilds from scratch —
// so the control the user is operating is destroyed mid-interaction. Restore focus to the
// replacement by id, or a keyboard user is dropped back to the top of the page after each edit.
function commitTargetPresetEdit(mutator,focusId,resolve){
  mutateState(mutator);
  renderTargets();
  // Uncheck all disables itself the moment nothing is checked, so fall back to the set picker
  // rather than leaving focus on a dead control.
  const replacement=document.getElementById(focusId);
  const focusTarget=replacement&&!replacement.disabled?replacement:document.getElementById("targetPreset");
  if(focusTarget)focusTarget.focus();
  if(resolve){save();solveForOutputMix();}else schedulePersist();
}
function saveTargetPreset(name){
  commitTargetPresetEdit(st=>{
    const id=newId();
    if(!Array.isArray(st.targetSaved))st.targetSaved=[];
    st.targetSaved.push({id,name,mode:st.targetMode,config:targetPresetConfig(st)});
    st.targetActiveId=id;
  },"targetPreset",false);
}
function loadTargetPreset(id){
  const preset=(S.targetSaved||[]).find(p=>p.id===id);if(!preset)return;
  commitTargetPresetEdit(st=>{applyTargetPresetConfig(st,preset.config,preset.mode);st.targetActiveId=id;},"targetPreset",true);
}
// Overwrite a saved set with the currently checked outputs (keeps its id and name).
function updateTargetPreset(id){
  if(!(S.targetSaved||[]).some(p=>p.id===id))return;
  commitTargetPresetEdit(st=>{
    const preset=st.targetSaved.find(p=>p.id===id);
    preset.config=targetPresetConfig(st);preset.mode=st.targetMode;
    st.targetActiveId=id;
  },"targetPreset",false);
}
function deleteTargetPreset(id){
  commitTargetPresetEdit(st=>{
    st.targetSaved=(st.targetSaved||[]).filter(p=>p.id!==id);
    if(st.targetActiveId===id)st.targetActiveId=null;
  },"targetPreset",false);
}
function uncheckAllTargets(){
  // Clearing leaves the loaded set selected so "Update" still names something; the set itself
  // is only rewritten when the user asks for it.
  commitTargetPresetEdit(st=>applyTargetPresetConfig(st,[]),"targetUncheckAll",true);
}
document.getElementById("targetPresetBar").addEventListener("change",e=>{
  if(e.target.id==="targetPreset"&&e.target.value)loadTargetPreset(e.target.value);
});
document.getElementById("targetPresetBar").addEventListener("click",e=>{
  const button=e.target.closest&&e.target.closest("button");if(!button)return;
  if(button.id==="targetUpdate"){if(S.targetActiveId)updateTargetPreset(S.targetActiveId);return;}
  if(button.id==="targetSaveNew"){const name=(prompt("Name this output set:","")||"").trim();if(name)saveTargetPreset(name);return;}
  if(button.id==="targetDelPreset"){
    const active=(S.targetSaved||[]).find(p=>p.id===S.targetActiveId);
    if(active&&confirm(`Delete the saved output set “${active.name}”?`))deleteTargetPreset(active.id);
    return;
  }
  if(button.id==="targetUncheckAll")uncheckAllTargets();
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
let _recoveryInvoker=null;
let _recoveryInvokerId=null;
let _recoveryImportFallback=false;
function showStateRecovery(raw,reason,file,invoker=document.activeElement,importFallback=false){
  const candidate=invoker&&invoker!==document.body&&invoker!==document.documentElement&&typeof invoker.focus==="function"?invoker:null;
  const insideRecovery=!!(candidate&&stateRecovery&&(candidate===stateRecovery||(typeof stateRecovery.contains==="function"&&stateRecovery.contains(candidate))));
  if(candidate&&!insideRecovery){
    _recoveryInvoker=candidate;
    _recoveryInvokerId=candidate&&candidate.id||null;
    _recoveryImportFallback=false;
  }else if(!stateRecovery||stateRecovery.hidden){
    _recoveryInvoker=null;
    _recoveryInvokerId=null;
    _recoveryImportFallback=!!importFallback;
  }
  if(typeof raw==="string")quarantineRejectedState(raw,reason);
  _recoveryDownload=file||((typeof raw==="string")?new Blob([raw],{type:"application/json"}):null);
  if(stateRecoveryDownload)stateRecoveryDownload.disabled=!_recoveryDownload;
  if(stateRecoveryReason)stateRecoveryReason.textContent=String(reason||"The planner started with safe defaults. Your rejected save was kept unchanged.");
  if(stateRecovery){stateRecovery.hidden=false;stateRecovery.focus();}
}
function dismissStateRecovery(restoreFocus=true){
  const invoker=_recoveryInvoker,invokerId=_recoveryInvokerId,importFallback=_recoveryImportFallback;
  _recoveryInvoker=null;_recoveryInvokerId=null;_recoveryImportFallback=false;
  if(stateRecovery)stateRecovery.hidden=true;
  if(!restoreFocus)return;
  if(invoker&&invoker.isConnected){invoker.focus();return;}
  if(invokerId){const replacement=document.getElementById(invokerId);if(replacement&&typeof replacement.focus==="function"){replacement.focus();return;}}
  if(importFallback){const button=document.getElementById("btnSettings");if(button)button.focus();}
}
function showSettingsRecovery(raw,reason,file){
  const settings=document.getElementById("settingsModal");
  if(settings&&!settings.hidden)closeSettings();
  showStateRecovery(raw,reason,file,document.getElementById("btnSettings"));
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
  if(!result.ok){showSettingsRecovery(null,"The current build contains a value that cannot be exported safely: "+result.errors.join("; "));return;}
  const blob=new Blob([JSON.stringify(result.state,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download="forge-build.json";a.click();URL.revokeObjectURL(a.href);
});
document.getElementById("btnImport").addEventListener("click",()=>document.getElementById("fileImport").click());
document.getElementById("fileImport").addEventListener("change",e=>{
  const f=e.target.files[0];if(!f)return;
  e.target.value="";
  if(f.size>STATE_LIMITS.maxBytes){
    showSettingsRecovery(null,"That import is too large to open safely. Your current build was not changed.",f);
    return;
  }
  const r=new FileReader();
  r.onload=()=>{
    const raw=String(r.result==null?"":r.result);let candidate;
    try{candidate=JSON.parse(raw);}catch(error){showSettingsRecovery(raw,"Could not read that file because it is not valid JSON.",f);return;}
    solveService.cancel("Import is replacing accepted state");
    const result=applyImportedState(candidate,renderAll,()=>solveService.cancel("Import rollback is restoring accepted state"));
    if(!result.ok){showSettingsRecovery(raw,result.errors.join("; "),f);return;}
    dismissStateRecovery(false);flashSaved();
  };
  r.onerror=()=>showSettingsRecovery(null,"Could not read that file. Your current build was not changed.",f);
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
  commitResultMutation(st=>{st.mode=m;},renderModeSwitch);
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
const INPUT_TABS=Object.freeze({
  inventory:{tab:"inputsInventoryTab",panel:"inputsInventoryPanel",clear:"projInvClear",initial:()=>document.querySelector("#invRows input")},
  projects:{tab:"inputsProjectsTab",panel:"inputsProjectsPanel",clear:"projClear",initial:()=>document.getElementById("projSeqToggle")},
  prices:{tab:"inputsPricesTab",panel:"inputsPricesPanel",clear:"priceClear",initial:()=>document.querySelector("#priceRows input")},
});
let activeInputsTab="inventory";
let renderedInputsTab="inventory";
let pendingInputsOpen=null;
function selectInputsTab(name,{focus=false,remember=true}={}){
  const selected=INPUT_TABS[name]?name:"inventory";
  renderedInputsTab=selected;
  if(remember)activeInputsTab=selected;
  Object.entries(INPUT_TABS).forEach(([key,meta])=>{
    const on=key===selected,tab=document.getElementById(meta.tab);
    tab.setAttribute("aria-selected",on?"true":"false");
    tab.tabIndex=on?0:-1;
    document.getElementById(meta.panel).hidden=!on;
    document.getElementById(meta.clear).hidden=!on;
  });
  if(focus)document.getElementById(INPUT_TABS[selected].tab).focus();
}
const inputsDialog=dialogController.register({
  root:document.getElementById("inputsModal"),
  panel:document.querySelector("#inputsModal .modal"),
  opener:null,
  initialFocus:()=>INPUT_TABS[renderedInputsTab].initial()||document.getElementById(INPUT_TABS[renderedInputsTab].tab),
  onOpen:()=>{
    renderInv();renderProjects();renderCatalog();renderPrices();
    const requested=pendingInputsOpen||{name:activeInputsTab,remember:true};
    pendingInputsOpen=null;
    selectInputsTab(requested.name,{remember:requested.remember});
  },
});
function openInputs(invoker,requestedTab,{remember=true}={}){
  pendingInputsOpen={name:INPUT_TABS[requestedTab]?requestedTab:activeInputsTab,remember};
  inputsDialog.open(invoker);
}
function closeInputs(){inputsDialog.close();}
function openPrices(invoker){openInputs(invoker,"prices");}
function closePrices(){closeInputs();}
function openProjects(invoker){openInputs(invoker,"projects");}
function closeProjects(){closeInputs();}
const inputsTabs=document.querySelector(".inputs-tabs");
inputsTabs.addEventListener("click",event=>{
  const tab=event.target.closest('[role="tab"]');if(!tab)return;
  const selected=Object.keys(INPUT_TABS).find(name=>INPUT_TABS[name].tab===tab.id);
  if(selected)selectInputsTab(selected,{focus:true});
});
inputsTabs.addEventListener("keydown",event=>{
  const tab=event.target.closest('[role="tab"]');if(!tab)return;
  const names=Object.keys(INPUT_TABS),current=names.findIndex(name=>INPUT_TABS[name].tab===tab.id);if(current<0)return;
  let next=null;
  if(event.key==="ArrowRight")next=names[(current+1)%names.length];
  else if(event.key==="ArrowLeft")next=names[(current-1+names.length)%names.length];
  else if(event.key==="Home")next=names[0];
  else if(event.key==="End")next=names[names.length-1];
  if(!next)return;
  event.preventDefault();selectInputsTab(next,{focus:true});
});
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
const minedDialog=dialogController.register({root:document.getElementById("minedModal"),panel:document.querySelector("#minedModal .modal"),opener:btnMined,initialFocus:()=>document.getElementById("minedVespiumRig"),onOpen:renderMinedResources});
function openMined(invoker){minedDialog.open(invoker);}
function closeMined(){minedDialog.close();}
document.getElementById("minedModal").addEventListener("input",e=>{
  const resource=e.target.dataset.minedResource,source=e.target.dataset.minedSource;if(!resource||!source)return;
  const result=commitFieldDraft(e.target,FIELD_SCHEMA.minedIncome,S.minedIncome[resource][source],(st,value,raw)=>{st.minedIncomeText[resource][source]=raw;st.minedIncome[resource][source]=value;});
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

/* ---------- input rail state ----------
   Each rail segment reports what it holds, so "Credits needs sell prices" is a
   visible state on the control rather than an animated nudge pointing at it. */
let priceNeeded=false;
function setPriceNeeded(on){
  const next=!!on;
  if(next===priceNeeded)return;
  priceNeeded=next;renderInputState();
}
// How many of a quantity map's entries the player has actually filled in. Reads Decimals, so it
// counts a sell price or a stock of any size rather than throwing on one.
function countSet(map){
  if(!map)return 0;
  return [...RAWS,...PRODUCTS].filter(it=>toDec0(map[it]).gt(DEC_ZERO)).length;
}
function plural(n,word){return n+" "+word+(n===1?"":"s");}
function renderInputState(){
  // `short` is what a narrow segment shows instead of an ellipsised full string;
  // `label` is the accessible name, which always carries the complete state.
  const seg=(id,stateId,filled,html,short,label)=>{
    const button=document.getElementById(id),state=document.getElementById(stateId);
    if(!button||!state)return;
    button.classList.toggle("filled",filled);
    state.innerHTML=html;
    state.setAttribute("data-short",short);
    button.setAttribute("aria-label",label);
  };

  const projects=(S.projects||[]).filter(p=>p.on&&(p.levels||[]).length).length;
  const prices=countSet(S.sellPrice),stock=countSet(S.inventory);
  const parts=[],spoken=[];
  if(projects){parts.push(plural(projects,"project"));spoken.push(plural(projects,"project")+" selected");}
  if(priceNeeded){parts.push('<span class="rail-warn">no sell prices</span>');spoken.push("no sell prices set");}
  else if(prices){parts.push(plural(prices,"price"));spoken.push(plural(prices,"sell price")+" set");}
  if(stock){parts.push(stock+" in stock");spoken.push(plural(stock,"item")+" in inventory");}
  // Two facts is what the segment can hold without wrapping; the rest is one click away.
  seg("btnInputs","stInputs",!!(projects||prices||stock),
    parts.slice(0,2).join(" · ")||"Nothing set",
    priceNeeded?"no sell prices":(projects?plural(projects,"project"):prices?plural(prices,"price"):stock?stock+" in stock":"Nothing set"),
    "Projects and prices — "+(spoken.slice(0,2).join(", ")||"nothing set"));
  document.getElementById("btnInputs").classList.toggle("needs",priceNeeded);

  const forgie=countSet(S.forgie);
  seg("btnForgie","stForgie",forgie>0,
    forgie?plural(forgie,"item")+" supplied":"No supply set",
    forgie?plural(forgie,"item"):"None set",
    "Lil' Forgie supply — "+(forgie?plural(forgie,"item")+" supplied":"nothing set"));

  // via minedBudgetHr so the badge keeps working as income sources are added —
  // each resource now sums several per-source rates rather than holding one number
  const mined=MINED_RESOURCES.filter(r=>minedBudgetHr(r).gt(DEC_ZERO));
  seg("btnMined","stMined",mined.length>0,
    mined.length?mined.join(" · "):"No income set",
    mined.length>1?plural(mined.length,"income"):mined.length?mined[0]:"None set",
    "Mined resources — "+(mined.length?mined.join(" and ")+" income set":"nothing set"));
}
document.getElementById("btnInputs").addEventListener("click",event=>{
  openInputs(event.currentTarget,priceNeeded?"prices":undefined,{remember:!priceNeeded});
});

function initCalib(){
  const it=document.getElementById("cbItem"), cp=document.getElementById("cbComp");
  if(it.options.length===0){
    [...RAWS,...PRODUCTS].forEach(n=>it.add(new Option(n,n)));
    LEVELS.forEach(L=>cp.add(new Option(compressionLabel(L)+" (level "+compressionLevel(L)+")",L)));
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
    commitResultMutation(st=>{st.baseTime[it.value]=computed;},()=>{renderRecipes();recalc();});
  });
  recalc();
}
function renderAll(){
  renderModeSwitch();renderInputState();
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
if(initialState.recovery)showStateRecovery(initialState.recovery.raw,initialState.recovery.reason,null,null,true);
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
function projPrioField(p,pi,errorId){
  const disabled=S.projectSeq===false;
  const title=disabled
    ?"Turn on Complete projects one at a time to set a manual order."
    :"Numbered projects run first in numeric order after required material unlocks. Leave blank to use the planner's estimated order.";
  return `<label class="proj-prio${disabled?" disabled":""}" title="${htmlAttribute(title)}"><input type="number" class="pprio" ${htmlFieldInputAttributes(FIELD_SCHEMA.projectPriority)} data-pprio="${pi}" value="${p.prio!=null?p.prio:""}" placeholder="–" data-field-error="${errorId}" aria-label="${htmlAttribute(p.name)} schedule order"${disabled?" disabled":""}>order</label>`;
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
        ${projPrioField(p,pi,ids.priority)}
        ${range}
        ${projStepper(p,pi)}
        <button class="iconbtn" data-pdel="${pi}" title="Remove from Projects" aria-label="Remove ${htmlAttribute(p.name)} from Projects">×</button>
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
        ${projPrioField(p,pi,ids.priority)}
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
function setProjectLineMode(value){
  const checked=validateFieldValue(FIELD_SCHEMA.projLineMode,value);if(!checked.valid)return false;
  if(checked.value===S.projLineMode)return true;
  mutateState(st=>{st.projLineMode=checked.value;});persistNow();doSolve();return true;
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
      levels:catalogLevelsToState(src.levels),_open:false
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
      <button class="btn ${has?"ghost":"primary"} cat-add" data-cat-add="${htmlAttribute(c.catId)}" aria-label="${has?"Added":"Add"} ${htmlAttribute(c.name)}${has?"":" to Projects"}" ${has?"disabled":""}>${has?"Added":"Add"}</button>
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

document.getElementById("projAdd").addEventListener("click",()=>{
  mutateState(st=>{st.projects.push({id:newId(),name:"New project",on:true,prio:null,from:1,to:1,done:0,levels:[{costs:[]}],_open:true});});
  renderProjects();save();scheduleSolve();
});
document.getElementById("projClear").addEventListener("click",()=>{
  if(!(S.projects||[]).length)return;
  if(!confirm("Remove all projects? This clears every added catalog project and custom project."))return;
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
  // Ticking projects in or out is batched work — accept and persist each tick, then let the
  // Resimulate bar apply the whole batch, rather than re-solving between them.
  if((v=g("data-pon"))!=null){commitProjectInclusion(st=>{st.projects[+v].on=t.checked;});return;}
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
function renderProgressSummary(active){
  const sum=document.getElementById("progSummary");
  if(!sum)return;
  active=active||(S.projects||[]).filter(p=>p.on&&(p.levels||[]).length);
  if(!active.length){sum.innerHTML="";return;}
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
}
function renderProgress(){
  const list=document.getElementById("progList");
  const sum=document.getElementById("progSummary");
  if(!list||!sum)return;
  const active=(S.projects||[]).filter(p=>p.on&&(p.levels||[]).length);
  if(!active.length){
    sum.innerHTML="";
    list.innerHTML=`<div class="notice info">No active projects. Open <b>Projects+Prices</b>, choose <b>Projects</b>, then add or tick on a project before tracking progress here.</div>`;
    return;
  }
  renderProgressSummary(active);
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
function refreshProgressIfOpen(){
  const modal=document.getElementById("progModal");
  if(modal&&!modal.hidden)renderProgressSummary();
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
// Reuses the same fields the Projects tab and Progress tracker edit (on / from / to / done), so all
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
// "Bricks", "Bricks and Concrete", "Bricks, Concrete and Rods" — a readable list of item names.
function itemListText(items){
  const names=(items||[]).map(htmlText);
  if(names.length<2)return names.join("");
  return names.slice(0,-1).join(", ")+" and "+names[names.length-1];
}
// Build the step-by-step plan HTML — the main Project-mode panel (was a modal body). Pure: returns the
// intro + phase cards for a solved project result and lets renderProjectResults own the DOM and the
// surrounding controls. Returns "" when there's no plan yet.
function stepPlanHtml(res){
  if(!res||res.empty||!res.phases||!res.phases.length)return "";
  const valid=!!(res.feasible&&res.lpFeasible&&res.scheduleValidation&&res.scheduleValidation.ok),execution=res.executionPhases||[];
  const staticInstructions=S.projLineMode==="static"
    ?" Within each timed phase, every busy line keeps one job for the whole phase; reset lines only between listed phases. The slowest required item sets that phase's duration."
    :" Every line switch and stock figure comes from the executable replay.";
  let h=valid
    ?`<p class="help" style="margin:0 0 12px">Follow the prerequisite, warm-up, and project phases <b>in order</b>.${staticInstructions} Total ≈ <b>${fmtDuration(res.eta)}</b>. <span style="color:var(--ink3)">Clock times count from the <b>plan start</b> above.</span></p>`
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
    if(ph.idleFill&&(ph.idleFill.lines||[]).length){
      const many=ph.idleFill.lines.length>1;
      h+=`<div class="notice info" style="font-size:11px;margin:4px 0 6px"><b>Spare lines put to work.</b> Line${many?"s":""} ${ph.idleFill.lines.map(line=>"#"+line).join(", ")} ${many?"were":"was"} left with nothing that finishes this phase sooner, so ${many?"they are":"it is"} building more of what it still needs — ${itemListText(ph.idleFill.items)} — out of what the other lines leave spare${ph.idleFill.shortened?", which shortened this phase":". The phase's duration is unchanged"}.</div>`;
    }
    if(ph.lookAhead&&(ph.lookAhead.lines||[]).length)
      h+=`<div class="notice info" style="font-size:11px;margin:4px 0 6px"><b>Banking ahead.</b> Line${ph.lookAhead.lines.length===1?"":"s"} ${ph.lookAhead.lines.map(line=>"#"+line).join(", ")} ${ph.lookAhead.lines.length===1?"has":"have"} nothing to do for this project, so ${ph.lookAhead.lines.length===1?"it is":"they are"} making ${itemListText(ph.lookAhead.items)} for <b>${htmlText(ph.lookAhead.name||"a later project")}</b>. This phase's duration is unchanged.</div>`;
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
      // A filled line is not part of what makes the phase's own clock — say so, or it reads as a
      // stray job (see the notes above the list). Banking names whose materials it is making; a
      // spare line working this phase's list says it is spare, so nobody waits on it.
      const ahead=ph.lookAhead&&(ph.lookAhead.lines||[]).indexOf(L.line)>=0
        ?` <span class="proj-mini">· banking for <b>${htmlText(ph.lookAhead.name||"a later project")}</b></span>`
        :ph.idleFill&&(ph.idleFill.lines||[]).indexOf(L.line)>=0
        ?` <span class="proj-mini">· spare capacity</span>`:"";
      h+=`<li><span class="mono" style="color:var(--amber)">Line #${L.line}</span> <span class="proj-mini">(${compressionLabel(L.max)} cap)</span>${ahead}${segHtml}</li>`;
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
  // Inline project controls — same fields as Projects / Track progress, kept in sync. These change
  // demand, so re-solve; doSolve() rebuilds #results (and thus the plan) right away.
  // Except the on/off tick: solving there would rebuild this very panel under the pointer, one solve
  // per tick, so it only marks the plan stale and the Resimulate bar above applies the batch.
  if((v=t.getAttribute("data-spon"))!=null){const p=stepsProj(v);if(p)commitProjectInclusion(()=>{p.on=t.checked;});return;}
  if((v=t.getAttribute("data-spfrom"))!=null||(v=t.getAttribute("data-spto"))!=null){
    const p=stepsProj(v),row=t.closest(".proj-inline-row");if(!p||!row)return;
    const fromInput=row.querySelector("[data-spfrom]"),toInput=row.querySelector("[data-spto]");
    if(!fromInput||!toInput)return;
    const result=commitProjectRangeDrafts(fromInput,toInput,p);if(result.committed)doSolve();return;
  }
  // Manual-mode dropdowns also live inside #results (re-rendered each change)
  if(t.id==="manualPreset"){if(t.value)loadManualPreset(t.value);return;}
  const ri=t.getAttribute("data-mres");
  if(ri!=null){const i=+ri;if(S.manual[i])commitResultMutation(st=>{st.manual[i].job=t.value;if(st.manual[i].lvl>st.lines[i].max)st.manual[i].lvl=st.lines[i].max;},()=>{t.value=S.manual[i].job;});return;}
  const lv=t.getAttribute("data-mlvl");
  if(lv!=null){const i=+lv;if(S.manual[i])commitResultMutation(st=>{st.manual[i].lvl=+t.value;},()=>{t.value=String(S.manual[i].lvl);});return;}
  const sl=t.getAttribute("data-msell");
  if(sl!=null){const i=+sl;if(S.manual[i])commitResultMutation(st=>{st.manual[i].sell=t.checked;},()=>{t.checked=!!S.manual[i].sell;});return;}
});
document.getElementById("results").addEventListener("click",e=>{
  const cl=sel=>e.target.closest&&e.target.closest(sel);
  if(cl("#btnProgress")){openProgress(cl("#btnProgress"));return;}
  const projectEditor=cl("[data-open-projects]");
  if(projectEditor){openProjects(projectEditor);return;}
  const lineMode=cl("[data-linemode]");
  if(lineMode){setProjectLineMode(lineMode.getAttribute("data-linemode"));return;}
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
  // dispose, not cancel: there is no next request to reuse an idle Worker for, so teardown releases
  // the whole pool whatever the pool switch says.
  solveService.dispose("Page teardown");
});
