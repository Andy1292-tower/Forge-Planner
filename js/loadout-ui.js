"use strict";
/* ---------- Game loadout code windows ----------
   Export: every place the planner draws a build has a Game code button beside it — the Line
   assignment of a Max items / Max credits solve, the Manual setup, and each Project step, one button
   per loadout when crafters change job partway through. The window prefills a name and an icon,
   keeps the code in step with both, and copies it.
   The buttons live inside #results, which is rebuilt on every render, so they are handled here by
   one delegated listener; each has a stable id for the dialog to hand focus back to. */
const loadoutEl=id=>document.getElementById(id);
let loadoutExportModel=null;
const loadoutExportDialog=dialogController.register({root:loadoutEl("loadoutExportModal"),
  panel:document.querySelector("#loadoutExportModal .modal"),opener:null,initialFocus:()=>loadoutEl("loadoutExportCopy")});
function loadoutSay(id,message,tone){
  const status=loadoutEl(id);
  status.textContent=message||"";
  status.classList.toggle("is-bad",tone==="bad");
  status.classList.toggle("is-good",tone==="good");
}
function loadoutNotice(tone,text){
  const note=domElement("div","notice "+tone,text);
  note.style.fontSize="11.5px";
  return note;
}
// canBeStale: a solved plan outlives the inputs it was solved from; the Manual setup never does.
function openLoadoutExport(model,source,invoker,canBeStale){
  loadoutExportModel=model;
  loadoutEl("loadoutExportSource").textContent=source;
  loadoutEl("loadoutExportName").value=model.name;
  const icon=loadoutEl("loadoutExportIcon");
  if(!icon.options.length)LOADOUT_ICONS.forEach((item,index)=>icon.appendChild(domOption(index,item,false)));
  icon.value=String(model.icon);
  const notes=[];
  if(model.omittedLines.length){
    const many=model.omittedLines.length>1;
    notes.push(loadoutNotice("warn",`Line${many?"s":""} ${model.omittedLines.map(n=>"#"+n).join(", ")} ${many?"are":"is"} left out — a game loadout holds ${LOADOUT_SLOTS} crafters.`));
  }
  if(canBeStale&&typeof staleCauses!=="undefined"&&staleCauses.size>0)
    notes.push(loadoutNotice("warn","This plan is out of date: an input changed after it was solved. Press Resimulate first for a code that matches your current factory."));
  loadoutEl("loadoutExportNotes").replaceChildren(...notes);
  refreshLoadoutExportCode();
  loadoutExportDialog.open(invoker);
}
function refreshLoadoutExportCode(){
  if(!loadoutExportModel)return;
  loadoutEl("loadoutExportCode").value=encodeLoadoutCode({name:loadoutName(loadoutEl("loadoutExportName").value)||loadoutExportModel.name,
    icon:Number(loadoutEl("loadoutExportIcon").value),slots:loadoutExportModel.slots});
  loadoutSay("loadoutExportStatus","");
}
/* Started from the click, which is the gesture the clipboard API requires. In-app browsers often
   refuse that API, so a refusal falls back to copying the selected field the older way, and only
   then to asking the player to copy the selection themselves. */
function copyLoadoutCode(){
  const field=loadoutEl("loadoutExportCode");
  let copying;
  try{copying=navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(field.value).then(()=>true,()=>false):Promise.resolve(false);}
  catch(error){copying=Promise.resolve(false);}
  return copying.then(copied=>{
    if(!copied){
      field.focus();field.select();
      try{copied=typeof document.execCommand==="function"&&document.execCommand("copy")===true;}catch(error){copied=false;}
    }
    if(copied){loadoutSay("loadoutExportStatus","Copied — paste it into the game.","good");return;}
    loadoutSay("loadoutExportStatus","Your browser blocked the clipboard. The code is selected: copy it with Ctrl+C (⌘C on a Mac).","bad");
  });
}
loadoutEl("loadoutExportName").addEventListener("input",refreshLoadoutExportCode);
loadoutEl("loadoutExportIcon").addEventListener("change",refreshLoadoutExportCode);
loadoutEl("loadoutExportCopy").addEventListener("click",copyLoadoutCode);
loadoutEl("loadoutExportCode").addEventListener("focus",e=>e.target.select());

function exportPlanLoadout(invoker){
  const res=_lastItemsCreditsRes;if(!res||!Array.isArray(res.plan))return;
  const source=res.mode==="credits"
    ?`The line assignment from your last Max credits/hr solve${res.bestItem?", which sells "+minedDisplayName(res.bestItem):""}.`
    :"The line assignment from your last Max items/hr solve.";
  openLoadoutExport(planLoadoutExport(res,S.lines),source,invoker,true);
}
function exportProjectLoadout(invoker){
  const step=Number(invoker.getAttribute("data-loadout-step")),code=Number(invoker.getAttribute("data-loadout-slice"));
  const model=projectLoadoutExport(_lastProjectRes,step,code);if(!model)return;
  openLoadoutExport(model,(invoker.getAttribute("data-loadout-label")||"Step "+(step+1))+".",invoker,true);
}
function exportManualLoadout(invoker){openLoadoutExport(manualLoadoutExport(S),"Your current Manual setup.",invoker,false);}
document.getElementById("results").addEventListener("click",e=>{
  const cl=sel=>e.target.closest&&e.target.closest(sel);
  const step=cl("[data-loadout-step]");if(step){exportProjectLoadout(step);return;}
  const plan=cl("#btnExportCode");if(plan){exportPlanLoadout(plan);return;}
  const manual=cl("#manualExportCode");if(manual){exportManualLoadout(manual);return;}
  const importCode=cl("#manualImportCode");if(importCode)openLoadoutImport(importCode);
});

/* Import: Manual only. The window previews what the code does to the Manual setup and to the crafter
   lines, asks before it changes any line, and commits everything as one edit — lines, setup, the
   optional preset and the switch to Manual — so a rejected save rolls all of it back together. */
let loadoutImportNameEdited=false;
const loadoutImportDialog=dialogController.register({root:loadoutEl("loadoutImportModal"),
  panel:document.querySelector("#loadoutImportModal .modal"),opener:null,initialFocus:()=>loadoutEl("loadoutImportCode"),onOpen:resetLoadoutImport});
function openLoadoutImport(invoker){loadoutImportDialog.open(invoker);}
function resetLoadoutImport(){
  loadoutEl("loadoutImportCode").value="";
  loadoutImportNameEdited=false;
  const full=(S.manualSaved||[]).length>=STATE_LIMITS.maxPresets,save=loadoutEl("loadoutImportSave"),name=loadoutEl("loadoutImportName");
  save.checked=false;save.disabled=full;
  loadoutEl("loadoutImportPresetFull").hidden=!full;
  name.value="";name.disabled=true;
  previewLoadoutImport();
}
function loadoutList(tone,title,items){
  const box=loadoutNotice(tone,"");
  box.appendChild(domElement("b","",title));
  const list=domElement("ul","loadout-list");
  items.forEach(item=>list.appendChild(domElement("li","",item)));
  box.appendChild(list);
  return box;
}
function previewLoadoutImport(){
  const raw=loadoutEl("loadoutImportCode").value,preview=loadoutEl("loadoutImportPreview"),apply=loadoutEl("loadoutImportApply");
  loadoutSay("loadoutImportStatus","");
  if(!raw.trim()){preview.replaceChildren();apply.disabled=true;return;}
  const parsed=parseLoadoutCode(raw);
  if(!parsed.ok){preview.replaceChildren(loadoutNotice("warn",parsed.error));apply.disabled=true;return;}
  const notes=loadoutImportNotes(planLoadoutImport(S,parsed)),parts=[];
  parts.push(notes.jobs.length?loadoutList("info","Manual setup",notes.jobs)
    :loadoutNotice("info",notes.unmodelled.length?"No crafter in this code runs a job the planner models, so every line will be idle."
      :"Every crafter in this code is empty, so every line will be idle."));
  if(notes.lineChanges.length)parts.push(loadoutList("warn","Changes to your crafter lines",notes.lineChanges));
  if(notes.unmodelled.length)parts.push(loadoutList("warn","Not in the planner",notes.unmodelled));
  if(notes.idledLines)parts.push(loadoutNotice("info",notes.idledLines));
  preview.replaceChildren(...parts);
  if(!loadoutImportNameEdited)loadoutEl("loadoutImportName").value=loadoutPresetName(parsed);
  apply.disabled=false;
}
function applyLoadoutImportFromWindow(){
  const parsed=parseLoadoutCode(loadoutEl("loadoutImportCode").value);
  if(!parsed.ok){previewLoadoutImport();return;}
  const plan=planLoadoutImport(S,parsed);
  if(plan.changesLines&&!confirm(loadoutImportConfirmText(plan)))return;
  const save=loadoutEl("loadoutImportSave");
  const presetName=save.checked&&!save.disabled
    ?(loadoutEl("loadoutImportName").value.trim().slice(0,FIELD_SCHEMA.projectName.maxLength)||loadoutPresetName(parsed)):null;
  const accepted=commitResultMutation(st=>{applyLoadoutImport(st,planLoadoutImport(st,parsed),presetName);},
    ()=>{renderLines();if(typeof renderModeSwitch==="function")renderModeSwitch();});
  if(!accepted){loadoutSay("loadoutImportStatus","The planner couldn't save this import, so nothing changed.","bad");return;}
  loadoutImportDialog.close();
  const stat=loadoutEl("solveStat");if(stat)stat.textContent=`Imported “${loadoutPresetName(parsed)}” into Manual.`;
}
loadoutEl("loadoutImportCode").addEventListener("input",previewLoadoutImport);
loadoutEl("loadoutImportCode").addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!loadoutEl("loadoutImportApply").disabled){e.preventDefault();applyLoadoutImportFromWindow();}
});
loadoutEl("loadoutImportSave").addEventListener("change",e=>{
  const name=loadoutEl("loadoutImportName");name.disabled=!e.target.checked;if(e.target.checked)name.focus();
});
loadoutEl("loadoutImportName").addEventListener("input",()=>{loadoutImportNameEdited=true;});
loadoutEl("loadoutImportApply").addEventListener("click",applyLoadoutImportFromWindow);
