"use strict";
/* ---------- MOVED NOTICE ----------
 * Forge Planner's development continues on Chadquarters. The strip above the header says so on
 * every load; this dialog says it once, on the first load that carries it, and the browser keeps a
 * marker that it was shown. With storage switched off the marker is lost and the dialog shows on
 * every load. */
const MOVED_NOTICE_SEEN_KEY="forge.moved.seen";

function movedNoticeSeen(){
  try{return localStorage.getItem(MOVED_NOTICE_SEEN_KEY)==="1";}catch(error){return false;}
}
function movedNoticeMarkSeen(){
  try{localStorage.setItem(MOVED_NOTICE_SEEN_KEY,"1");}catch(error){}
}

const movedDialog=dialogController.register({
  root:document.getElementById("movedModal"),
  panel:document.querySelector("#movedModal .modal"),
  initialFocus:()=>document.getElementById("movedClose"),
  onOpen:movedNoticeMarkSeen
});

// The link opens Chadquarters in a new tab, so this tab is left on the planner with the notice
// already out of the way.
document.getElementById("movedGo").addEventListener("click",()=>movedDialog.close());

if(!movedNoticeSeen())movedDialog.open();
