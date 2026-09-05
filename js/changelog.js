"use strict";
/* ---------- RELEASE NOTES ----------
 * Newest first. Every release the site serves is one deployment, so a version is the day it
 * shipped: YYYY.MM.DD, with a trailing counter only if a day ever ships twice. The build reads
 * CHANGELOG[0].version and writes it into version.json beside the build id, which is what lets an
 * open tab name the release it is being offered rather than just announcing that one exists.
 *
 * The list starts at 2026.08.05, the release that introduced the update notice — the first one any
 * reader was told about. Entries are what a player can see change; work with no visible effect is
 * left out rather than padded in.
 */
const CHANGELOG=[
  {version:"2026.09.04",date:"2026-09-04",groups:{
    Added:["What's new: the release notes for every version, opened from the update notice or from the footer. Entries you have not read yet are marked the first time you open them."],
    Fixed:["Max items/hr under-reported a single checked output. Checking one output could return less of it than checking the same output alongside another the factory already covered for free."]}},
  {version:"2026.08.30",date:"2026-08-30",groups:{
    Changed:[
      "Mined income is one per-second figure, matching the game's own stat block. The Vespium rig field is gone — the per-second stat already counts the rigs, so filling in both double-counted them. A saved rig figure carries over at the same hourly income.",
      "Sell prices, Lil' Forgie and Inventory list their items in the order and sections the game uses."
    ],
    Added:[
      "Worthless Rocks takes an income and a sell price. Rocks and Vespium are ranked in Max credits/hr alongside the crafted items, and either can win.",
      "A project plan can spend held Hydracite on top of its income, so a phase finishes sooner while the stock lasts."
    ]}},
  {version:"2026.08.29",date:"2026-08-29",groups:{
    Fixed:["Project plans that came back empty on some mined-income and Lil' Forgie combinations."]}},
  {version:"2026.08.19",date:"2026-08-19",groups:{
    Fixed:[
      "Complete 1 at a time no longer carries a shortfall out of one phase and into the next, which left later phases unbuildable.",
      "Max items/hr raises a line to the largest craft it can run for free instead of leaving it wherever the search last set it."
    ]}},
  {version:"2026.08.15",date:"2026-08-15",groups:{
    Added:["An Apply max turbo button for the crafter lines."],
    Fixed:[
      "Line switching no longer comes out slower than Set & forget — it now also weighs the plan that never switches.",
      "Tokenium Scanner Lv 3 costs."
    ]}},
  {version:"2026.08.13",date:"2026-08-13",groups:{
    Fixed:["Share target mode failed every solve after the first until the page was reloaded."]}},
  {version:"2026.08.12",date:"2026-08-12",groups:{
    Changed:["Project level presses apply together instead of redrawing the plan on every press."],
    Fixed:["Quantities past 1e100 are held exactly instead of overflowing."]}},
  {version:"2026.08.11",date:"2026-08-11",groups:{
    Added:["The eight long projects run out to Lv 48."],
    Fixed:["Max items/hr reported less of an output when fewer outputs were checked."]}},
  {version:"2026.08.10",date:"2026-08-10",groups:{
    Added:["Links back to the GitHub repository from the footer and the report dialog."],
    Changed:[
      "Manual mode reports what a setup actually makes when an input runs short, instead of pricing every line as if it crafted nonstop.",
      "Biochemical Laboratory and Tower of Chad move onto the beta costs, and Biochemical Laboratory Lv 4 is read from the game."
    ]}},
  {version:"2026.08.09",date:"2026-08-09",groups:{
    Fixed:["A project phase that simply ran out of its share of the solve time was reported as an impossible factory."]}},
  {version:"2026.08.08",date:"2026-08-08",groups:{
    Fixed:[
      "Set & forget plans no longer leave a line producing something no recipe uses.",
      "Ticking an output in Project mode no longer spends the whole solve budget on a result the project plan cannot read."
    ]}},
  {version:"2026.08.07",date:"2026-08-07",groups:{
    Added:[
      "Saved output sets for the Max items/hr checkboxes, and an Uncheck all control.",
      "Share of max: ask for each output as a share of what it could make on its own, alongside the ratio sliders.",
      "Items results say how far a bounded plan sits from the proven ceiling."
    ],
    Changed:["Ticking projects in and out batches behind one Resimulate instead of solving on every click."]}},
  {version:"2026.08.06",date:"2026-08-06",groups:{
    Added:["Biochemical Laboratory Lv 2 read from the game; Lv 3–5 re-estimated from it."],
    Changed:["The crafter lines table gives the speed field the room its numbers need."],
    Fixed:["A page left open past a new release recovers instead of failing to load."]}},
  {version:"2026.08.05",date:"2026-08-05",groups:{
    Added:["A notice when a new version is live, with a refresh that keeps your saved planner state."]}}
];

const CHANGELOG_GROUP_ORDER=["Added","Changed","Fixed","Removed"];
// The notes are authored above, but they are still written into innerHTML, so they are escaped
// on the way out rather than trusted for being local.
const changelogEsc=text=>String(text).replace(/[&<>"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[ch]));
const CHANGELOG_SEEN_KEY="forge.changelog.seen";
const changelogVersion=()=>CHANGELOG.length?CHANGELOG[0].version:"";

/* The reader's own build is CHANGELOG[0].version, so "new to you" is everything above the version
 * they last opened these notes on. Storage the reader has switched off costs the marker, not the
 * notes. */
function changelogSeenVersion(){
  try{return localStorage.getItem(CHANGELOG_SEEN_KEY)||"";}catch(error){return "";}
}
function changelogMarkSeen(){
  try{localStorage.setItem(CHANGELOG_SEEN_KEY,changelogVersion());}catch(error){}
}

function renderChangelog(){
  const seen=changelogSeenVersion();
  const body=document.getElementById("changelogBody");
  if(!body)return;
  body.innerHTML=CHANGELOG.map(entry=>{
    const fresh=seen&&entry.version>seen;
    const groups=CHANGELOG_GROUP_ORDER.filter(name=>entry.groups[name]&&entry.groups[name].length).map(name=>
      '<h5 class="cl-group">'+name+'</h5><ul class="cl-list">'+
      entry.groups[name].map(line=>"<li>"+changelogEsc(line)+"</li>").join("")+"</ul>").join("");
    return '<section class="cl-release">'+
      '<h4 class="cl-version">'+changelogEsc(entry.version)+
      '<span class="cl-date">'+changelogEsc(entry.date)+"</span>"+
      (fresh?'<span class="cl-new">New</span>':"")+"</h4>"+groups+"</section>";
  }).join("");
  changelogMarkSeen();
}

const changelogDialog=dialogController.register({
  root:document.getElementById("changelogModal"),
  panel:document.querySelector("#changelogModal .modal"),
  opener:document.getElementById("btnChangelog"),
  initialFocus:()=>document.getElementById("changelogClose"),
  onOpen:renderChangelog
});
