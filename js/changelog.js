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
  {version:"2026.10.25",date:"2026-10-25",groups:{
    Added:[
      "Exclude ledgers beyond #, in What fits in a time limit. Enter a ledger number and the search leaves out every ledger numbered past it. A Must finish ledger card is held to that number too, and the answer says where it stops.",
      "Exclude from the search, in What fits in a time limit. Tick the ledger cards, or projects when Ledgers and projects is on, that the search should leave alone. A card you exclude comes off Must finish, and Use this selection leaves it as it is."],
    Changed:["What fits in a time limit has a Pick from switch at the top, set to Just ledgers, so the search picks only from your ledger cards. Choose Ledgers and projects to have it pick from your projects too, as it did before. If a project you haven't finished unlocks a material a ledger needs, Just ledgers stops that character's ledgers there and names the project they wait on. Use this selection leaves anything outside the search, your projects included, as it is."]}},
  {version:"2026.10.24.7",date:"2026-10-24",groups:{
    Changed:["Finance Center, Jade Refinery, Hospital Wing, Off-Rock Mining Operation, Tokenium Mining Center, Vespium Drill Hub, Rig Parts Production Facility and All Round Giga-Scanner now go up to Lv 54 in the catalog. Lv 49–54 costs are estimated on the same curve as the estimated levels below them, and each project's catalog note shows its estimated range. A project already in your list keeps its end level; raise it to plan the new levels."]}},
  {version:"2026.10.24.6",date:"2026-10-24",groups:{
    Changed:["List what else finishes, in What fits in a time limit, now builds on the answer one step at a time. Each row adds one more project level or ledger to the plan above it and shows how many that plan finishes and how long it takes, so the last row is the most you can finish inside the extra hours."]}},
  {version:"2026.10.24.5",date:"2026-10-24",groups:{
    Changed:["What fits in a time limit picks from every project and ledger in your list, ticked or not, and carries each ledger on into the character's following ledgers, so it finds the most you can finish rather than the most of what you ticked. Must finish keeps a project to what its card asks for. Use this selection ticks what the answer takes, unticks the rest, and sets each one's end level or Include next to match."],
    Fixed:["Past the limit showed nothing once everything you had ticked fit. It now always says what it found, and lists anything that would also fit inside your limit."]}},
  {version:"2026.10.24.4",date:"2026-10-24",groups:{
    Added:["Past the limit, in What fits in a time limit. Tick Show the next thing past the limit to see the next project level or ledger you would finish and how long the plan takes with it, when that is within 12 hours of your limit. Tick List what else finishes to choose how many extra hours to look through and see every next step that lands inside them, each with its plan time."]}},
  {version:"2026.10.24.3",date:"2026-10-24",groups:{
    Fixed:["Selling again could say a plan used none of your stock of an item, and that you could only sell it once the whole plan finished, when a crafter kept making that item after the plan had enough. It now tells you to keep everything the plan needs, counting what you already hold, and gives the time the plan has made the rest; anything made after that is spare."]}},
  {version:"2026.10.24.2",date:"2026-10-24",groups:{
    Added:[
      "Include next, on a ledger card. Enter how many of the character's following ledgers to plan along with the one they are on, and Project plan crafts them together in one run. Turned in moves the whole run on by one ledger. What fits in a time limit counts each included ledger, and Use this selection sets Include next to the ones that fit.",
      "Must finish, in What fits in a time limit. Add the projects or ledgers that have to be in the answer and the search fits everything else around them. If they can't finish in time on their own, it tells you how long they take."
    ],
    Changed:[
      "Ledgers are numbered as the game numbers them, by their order code: CGMC-741e-344 is #344.",
      "The ledger list stops at #370 for now, the furthest anyone has reached. A card that was past it switches to Not listed and keeps its items."
    ],
    Removed:["Caylris En Divalone's ledger card. None of their ledgers ask for anything the planner crafts."]}},
  {version:"2026.10.24",date:"2026-10-24",groups:{
    Added:[
      "Ledgers, in Projects+Prices → Projects. Each character who posts ledgers on the Exchange has a card: pick the ledger they are on and its craftable items go into your Project plan, with any mined resources or potions it also asks for listed beside them. Turned in moves the card to the next ledger. For a ledger the planner doesn't have yet, choose Not listed and type its items in.",
      "Batch projects that share an order number. With one at a time on and the new box ticked, projects with the same order number are crafted together as one project.",
      "What fits in a time limit, in Project plan. Enter the hours you have and press Find what fits: it looks for the most levels of your ticked projects and ledgers that finish in time, checks the best set as a full plan, and lists what finishes and when. Use this selection then unticks the rest. It is a heavy solve, so it only runs when you press the button, for up to the search time you pick, and spreads across several CPU cores where your device has them.",
      "Selling again, in Project plan. It names the item Max credits/hr would sell on your factory, when your plan stops using it, how many to keep on hand until then, and the credits/hr it earns once the plan is done. Pick another priced item from its list to see the same for that one. Sell price edits now mark a Project plan out of date too."
    ],
    Changed:[
      "The Projects tab is split into Catalog, Ledgers and Custom.",
      "A project's order is picked from a list of 1 to 10. With the list selected, typing a number picks it.",
      "Editing Lil' Forgie rates, inventory, sell prices, projects, mined income, Infusion Upgrades or base craft times no longer re-plans while you type. The plan is marked out of date, and Resimulate updates it once you are done. Manual still updates as you go."
    ]}},
  {version:"2026.10.22",date:"2026-10-22",groups:{
    Fixed:["Max items/hr could miss a better line assignment your crafters can already run, and find it only after a crafter was upgraded to a cap the better plan doesn't use."]}},
  {version:"2026.10.11",date:"2026-10-11",groups:{
    Added:["Copy for Discord, in the Game loadout code window. It copies the code inside a Discord code block, ready to paste into a message."]}},
  {version:"2026.10.09",date:"2026-10-09",groups:{
    Added:[
      "Game loadout codes. Max items/hr, Max credits/hr, Manual and every Project plan step have a Game code button that gives you a code for the game's loadout screen. Set the loadout's name and icon before you copy it. A Project step where crafters switch jobs partway through gets one code per switch, labelled with the time to load it.",
      "Import game code, in Manual. Paste a code from the game and it becomes your Manual setup, crafter 1 on line 1. If the code runs a crafter above that line's cap, or uses more crafters than you have lines, the planner lists the changes to your crafter lines and asks before making them. Tick the box to keep the loadout as a saved setup."
    ],
    Changed:[
      "Keep your crafter lines in the game's crafter order. Game codes put crafter 1 on line 1, so the order of the lines now matters.",
      "Base craft times are the game's own recipe timers: Bits 6s, Concrete 9s, Ingots 10s, Plates 30s, Rods 45s, Glass 90s, Bricks 120s, Frames 300s, Gel 3,200s, Wire 5,400s, Reinforced Concrete 355,000s and Batteries 1,034,000s. Your save picks them up the next time it loads, replacing any base time you had calibrated by hand.",
      "Bug reports include your save, so the problem can be loaded exactly as you had it. Sending without an account posts the save with the report. Posting with a GitHub account downloads it as forge-build.json for you to drag into the issue. Once posted, the save is public. Catalog submissions and feature requests still send only what you type."
    ],
    Fixed:[
      "The planner fits a phone screen instead of zooming out and cutting off the right edge of every card and dialog.",
      "With Expansion Essentials VII ticked, Bricks at 2× and above were costed up to a quarter short on Concrete, so a plan with Bricks lines could show Concrete in surplus while the game ran it at a loss. Bricks now cost what the game charges at every compression level.",
      "Post with my GitHub account opened the issue, then said your browser had blocked the new tab."
    ]}},
  {version:"2026.09.22",date:"2026-09-22",groups:{
    Added:[
      "Compression levels 15 and 16 — 32.77k× and 65.54k×. Set a crafter's cap to either and the planner costs, times and schedules the tier like every one below it; the cost table under Crafting stats runs up to them too.",
      "Infusion Upgrades, from the new button on the top bar. Tick the ones you have bought and the planner works from them. Expansion Essentials VII halves every crafting cost — materials, the Vespium behind Gel and the Hydracite behind Batteries — rounding each cost up and never below 1. Dupe Day lets the dupe % field go past 100%, where a crafter starts rolling a third copy instead of a second, then a fourth."
    ],
    Changed:[
      "Recipe costs under Crafting stats are shown rather than entered. They are the game's own cost curve and now follow your Infusion Upgrades, so there is nothing left to keep in step by hand. Base times are still yours to set, and the calibration tool is unchanged.",
      "Any recipe costs you had typed over are replaced by the game's figures."
    ]}},
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
