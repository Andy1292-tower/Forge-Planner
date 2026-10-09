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
});
