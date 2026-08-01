# Mined Resources and New Craftables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Reinforced Concrete, Batteries, independent Vespium/Hydracite income constraints, a unified Mined Resources modal, and 8192×/16.4k× compression support across every Forge Planner mode.

**Architecture:** Extend the existing central item tables, then replace Gel-only mined-resource branches with descriptor-driven helpers shared by the main thread and solver worker. Keep Vespium and Hydracite as separate external resources with separate hard constraints; Batteries also consumes the normal Wire and Gel balances. Preserve the existing Gel search seeds and expose generic mined-usage results to project, Manual, and rendered UI consumers.

**Tech Stack:** Static HTML/CSS, vanilla JavaScript, Web Worker, Node.js CommonJS regression harnesses, in-app Browser QA.

## Global Constraints

- Reinforced Concrete at 1× costs exactly 10,000 Bricks, 100,000 Concrete, and 700 Frames; base craft time is exactly 355,531.88 seconds.
- Batteries at 1× costs exactly 500 Wire, 100,000 Gel, and 5,000,000,000,000 Hydracite; base craft time is exactly 1,034,274.56 seconds.
- Material costs scale by `3^log2(compression)` and craft times scale by `1.5^log2(compression)`.
- Add exact compression values `8192` and `16384`; display `16384` as `16.4k×` without rounding the stored value.
- Vespium income can fund only Gel. Hydracite income can fund only Batteries. They are never pooled, converted, aliased, or substituted.
- Batteries must satisfy Wire, Gel, and Hydracite simultaneously in every mode.
- Vespium and Hydracite are hard caps; the may-work margin cannot permit either budget to run short.
- Preserve existing calibrated state, Gel UI behavior, solver seeds, Web Worker responsiveness, one-second craft floor, duplication rules, and pre-produced Bits behavior.
- Do not infer new project unlock relationships.
- Keep all implementation and delivery in `feature/mined-resources-and-new-crafts` and one pull request.
- Do not mention Codex, AI, or model assistance in commits, branch descriptions, or pull-request text.

---

## File Structure

- `js/core.js`: authoritative compression levels, product/recipe data, mined-craft descriptors, formatting helpers, default state, and legacy migration.
- `js/solver.js`: independent mined-resource constraints, Battery job construction, search feasibility, project LP integration, blockers, and generic mined-usage result data.
- `js/manual.js`: direct Manual-mode ordinary and mined consumption plus separate income balances.
- `js/results.js`: generic mined-usage notices, exact blocker messages, line consumption, and compression labels.
- `js/render.js`: line/recipe compression labels and Mined Resources modal content rendering.
- `js/events.js`: modal open/close/input behavior, compression reference rendering, and project step-plan wording/order.
- `index.html`: header button and consolidated modal markup; removal of the old Gel card and Gel-only cost modal.
- `css/styles.css`: responsive mined-resource cards, tables, summaries, and removal of obsolete Gel-card styles.
- `README.md`: current craftables, mined resources, and compression ceiling.
- `test/craftdata.cjs`: exact data, scaling, display label, and save-migration regression tests.
- `test/minedsolver.cjs`: items/credits independent-budget and hard-cap tests.
- `test/minedmodes.cjs`: project and Manual full-pipeline tests.
- `test/minedui.cjs`: renderer/view-model behavior using the real core, solver, and render code.
- `test/check-classifier.cjs`: regression test for strict `noGel` parity classification.
- `test/check.cjs`: corrected Gel scenario classification.
- `test/scale.cjs`: add combined Gel/Battery scale telemetry.

---

### Task 0: Make the Existing Parity Gate Honest

**Files:**
- Create: `test/check-classifier.cjs`
- Modify: `test/check.cjs`

**Interfaces:**
- Produces: strict parity classification for `.noGel.` scenarios before any product behavior changes.

- [ ] **Step 1: Write the failing parity-classifier regression test**

Create `test/check-classifier.cjs` using `spawnSync` and temporary JSON files. The golden/current pair must use key `items.single.noGel.L5`, keep the objective equal, and deliberately change the plan. Assert that `test/check.cjs` exits non-zero:

```js
"use strict";
const fs=require("fs"),os=require("os"),path=require("path"),{spawnSync}=require("child_process");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"forge-check-"));
const key="items.single.noGel.L5";
const base={mode:"items",feasible:true,capped:false,objective:10,plan:[{line:1,job:"Frames@1"}]};
const changed={...base,plan:[{line:1,job:"Bricks@1"}]};
const gold=path.join(dir,"gold.json"),cur=path.join(dir,"cur.json");
fs.writeFileSync(gold,JSON.stringify({[key]:base}));fs.writeFileSync(cur,JSON.stringify({[key]:changed}));
const run=spawnSync(process.execPath,[path.join(__dirname,"check.cjs"),gold,cur],{encoding:"utf8"});
const ok=run.status!==0;
console.log((ok?"ok   ":"FAIL ")+"noGel plan changes are strict [exit="+run.status+"]");
if(!ok)process.exitCode=1;
```

- [ ] **Step 2: Run the classifier test and verify RED**

Run: `node test/check-classifier.cjs`

Expected: failure because `/gel/i` incorrectly classifies `noGel` as a relaxed Gel scenario.

- [ ] **Step 3: Correct the classifier and verify the existing baseline**

In `test/check.cjs`, replace the classifier with:

```js
const isGel=/\.gel\./i.test(k);
```

Run:

```bash
node test/check-classifier.cjs
node test/parity.cjs > /tmp/forge-parity-task0.json
node test/check.cjs test/golden.json /tmp/forge-parity-task0.json
```

Expected: classifier passes and the unchanged baseline still reports zero parity failures.

- [ ] **Step 4: Commit Task 0**

```bash
git add test/check-classifier.cjs test/check.cjs
git commit -m "Make non-Gel parity checks strict"
```

---

### Task 1: Core Craft Data, Compression, and Safe State Migration

**Files:**
- Create: `test/craftdata.cjs`
- Modify: `js/core.js`
- Modify: `js/render.js`
- Modify: `test/parity.cjs`
- Modify: `test/scale.cjs`

**Interfaces:**
- Produces: `compressionLabel(level: number): string`.
- Produces: `MINED_CRAFTS`, keyed by craftable name, with `resource`, `baseCosts`, and `informationalCosts` fields.
- Produces: `MINED_RESOURCES: string[]`.
- Produces: `minedCost(item: string, level: number): Record<string, number>`.
- Produces: `isMinedResource(resource: string): boolean`.
- Produces: `minedBudgetHr(resource: string): number`.
- Produces: `setMinedIncome(resource: string, text: string): void`.
- Produces persisted `S.minedIncome` and `S.minedIncomeText` maps.

- [ ] **Step 1: Write the failing craft-data and migration test**

Create `test/craftdata.cjs` using the existing Node/eval harness pattern. Use literal, hand-derived expectations:

```js
"use strict";
const fs=require("fs"),path=require("path");
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.document={getElementById:()=>({innerHTML:"",textContent:""})};
globalThis.performance={now:()=>0};
const core=fs.readFileSync(path.join(__dirname,"..","js","core.js"),"utf8");
const solver=fs.readFileSync(path.join(__dirname,"..","js","solver.js"),"utf8");
const runner=`
(function(){
  let fail=0;
  const eq=(name,got,want)=>{const ok=Object.is(got,want);console.log((ok?"ok   ":"FAIL ")+name+" ["+got+" vs "+want+"]");if(!ok)fail++;};
  const near=(name,got,want)=>{const ok=Math.abs(got-want)<=1e-9*Math.max(1,Math.abs(want));console.log((ok?"ok   ":"FAIL ")+name+" ["+got+" vs "+want+"]");if(!ok)fail++;};
  const d=defaults();S=d;
  eq("8192 tier",LEVELS[LEVELS.length-2],8192);
  eq("16384 tier",LEVELS[LEVELS.length-1],16384);
  eq("16384 display",compressionLabel(16384),"16.4k×");
  eq("reinforced bricks 1x",d.prodCost["Reinforced Concrete"].Bricks[1],10000);
  eq("reinforced concrete 1x",d.prodCost["Reinforced Concrete"].Concrete[1],100000);
  eq("reinforced frames 1x",d.prodCost["Reinforced Concrete"].Frames[1],700);
  eq("battery wire 1x",d.prodCost.Batteries.Wire[1],500);
  eq("battery gel 1x",d.prodCost.Batteries.Gel[1],100000);
  eq("battery hydracite 1x",minedCost("Batteries",1).Hydracite,5000000000000);
  eq("reinforced bricks 8192x",d.prodCost["Reinforced Concrete"].Bricks[8192],15943230000);
  eq("battery hydracite 16384x",minedCost("Batteries",16384).Hydracite,23914845000000000000);
  near("reinforced base time",d.baseTime["Reinforced Concrete"],355531.88);
  near("battery base time",d.baseTime.Batteries,1034274.56);
  near("reinforced time 8192x",craftTime("Reinforced Concrete",8192),69193439.15005371);
  near("battery time 16384x",craftTime("Batteries",16384),301935007.2002344);
  LEVELS.forEach((L,i)=>{
    near("reinforced cost scale "+L,d.prodCost["Reinforced Concrete"].Bricks[L],10000*Math.pow(3,i));
    near("battery ordinary cost scale "+L,d.prodCost.Batteries.Gel[L],100000*Math.pow(3,i));
    near("battery mined cost scale "+L,minedCost("Batteries",L).Hydracite,5e12*Math.pow(3,i));
    near("reinforced time scale "+L,craftTime("Reinforced Concrete",L),355531.88*Math.pow(1.5,i));
    near("battery time scale "+L,craftTime("Batteries",L),1034274.56*Math.pow(1.5,i));
  });
  setMinedIncome("Vespium","7.25qu");setMinedIncome("Hydracite","-1");
  eq("game notation parsed independently",S.minedIncome.Vespium,7.25e18);
  eq("negative mined income is off",S.minedIncome.Hydracite,null);
  eq("hydracite edit leaves vespium intact",S.minedIncome.Vespium,7.25e18);
  const legacy=defaults();delete legacy.minedIncome;delete legacy.minedIncomeText;
  legacy.gelVesp=7250000000000000000;legacy.gelVespText="7.25qu";
  legacy.baseTime.Wire=12345;legacy.prodCost.Wire.Gel[4]=999;
  normalize(legacy);
  eq("legacy vesp value",legacy.minedIncome.Vespium,7250000000000000000);
  eq("legacy vesp text",legacy.minedIncomeText.Vespium,"7.25qu");
  eq("custom base time preserved",legacy.baseTime.Wire,12345);
  eq("custom recipe cost preserved",legacy.prodCost.Wire.Gel[4],999);
  eq("new hydracite blank",legacy.minedIncome.Hydracite,null);
  eq("temporary numeric alias mirrored",legacy.gelVesp,7250000000000000000);
  eq("temporary text alias mirrored",legacy.gelVespText,"7.25qu");
  if(fail)process.exitCode=1;
})();`;
eval(core+"\n"+solver+"\n"+runner);
```

- [ ] **Step 2: Run the test and verify the correct RED failure**

Run: `node test/craftdata.cjs`

Expected: non-zero exit because `compressionLabel`, the new products, and the mined-resource model do not yet exist. Fix test syntax only if it errors before reaching those missing behaviors.

- [ ] **Step 3: Implement central data and helpers in `js/core.js`**

Make these exact structural changes:

```js
const LEVELS=[1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384];
const PRODUCTS=["Glass","Bricks","Plates","Rods","Frames","Gel","Wire","Reinforced Concrete","Batteries"];
const RECIPE={
  Glass:{inputs:["Bits"]},Bricks:{inputs:["Concrete"]},Plates:{inputs:["Ingots"]},
  Rods:{inputs:["Ingots"]},Frames:{inputs:["Plates","Rods"]},Gel:{inputs:[]},
  Wire:{inputs:["Gel","Rods"]},
  "Reinforced Concrete":{inputs:["Bricks","Concrete","Frames"]},
  Batteries:{inputs:["Wire","Gel"]}
};
const MINED_CRAFTS={
  Gel:{resource:"Vespium",baseCosts:{Vespium:5e14},informationalCosts:{Rocks:1e23}},
  Batteries:{resource:"Hydracite",baseCosts:{Hydracite:5e12},informationalCosts:{}}
};
const MINED_RESOURCES=["Vespium","Hydracite"];
function compressionLabel(L){return Number(L)===16384?"16.4k×":String(L)+"×";}
function minedCost(item,L){
  const cfg=MINED_CRAFTS[item],out={};if(!cfg)return out;
  const mult=Math.pow(3,Math.log2(L));
  Object.entries({...cfg.informationalCosts,...cfg.baseCosts}).forEach(([r,v])=>out[r]=v*mult);
  return out;
}
function isMinedResource(r){return MINED_RESOURCES.includes(r);}
function minedBudgetHr(r){return Math.max(0,num(S.minedIncome&&S.minedIncome[r])||0)*60;}
function setMinedIncome(r,text){
  if(!MINED_RESOURCES.includes(r))return;
  S.minedIncomeText[r]=String(text==null?"":text);
  const v=parseGameNum(text);S.minedIncome[r]=v!=null&&v>=0?v:null;
  if(r==="Vespium"){
    S.gelVesp=S.minedIncome.Vespium;
    S.gelVespText=S.minedIncomeText.Vespium;
  }
}
```

Add the two new `prodCost` entries using the existing `c(base)` helper, add exact base times, classify both as `fin`, and initialize both mined-state maps in `defaults()`.

In `normalize()`, use `Number()` rather than `num()` during startup. Migrate `gelVesp`/`gelVespText` only when the new Vespium fields are absent and validate each mined entry independently. During Tasks 1–3, retain both legacy fields as temporary Vespium mirrors so the existing UI and Gel-specific solver call sites remain functional between commits; `normalize()` and `setMinedIncome("Vespium", ...)` must keep the mirrors synchronized. Task 4 removes the mirrors only after every consumer has moved to the new maps. Let the existing product and level loops backfill the new recipes and compression keys without overwriting populated custom values.

Update every Gel-budget scenario in `test/parity.cjs` and `test/scale.cjs` to assign `s.minedIncome.Vespium=GEL_BUDGET` (or the scenario's equivalent value) rather than relying on `s.gelVesp`. This exercises the new persisted interface while the temporary mirrors protect only production code during the staged migration.

In the existing `#gelBody` input listener in `js/render.js`, replace the two direct legacy assignments with `setMinedIncome("Vespium", e.target.value)`. The old panel remains fully functional until Task 4 replaces its markup, and each edit updates both the authoritative map and its temporary display/solver mirror.

- [ ] **Step 4: Run focused and existing parity tests**

Run:

```bash
node test/craftdata.cjs
node test/parity.cjs > /tmp/forge-parity-task1.json
node test/check.cjs test/golden.json /tmp/forge-parity-task1.json
```

Expected: craft-data test passes; parity reports zero failures.

- [ ] **Step 5: Commit Task 1**

```bash
git add js/core.js js/render.js test/craftdata.cjs test/parity.cjs test/scale.cjs
git commit -m "Add new craft data and compression tiers"
```

---

### Task 2: Independent Mined Budgets in Items and Credits

**Files:**
- Create: `test/minedsolver.cjs`
- Modify: `js/solver.js`

**Interfaces:**
- Consumes: `MINED_CRAFTS`, `MINED_RESOURCES`, `minedCost()`, `minedBudgetHr()`, and `isMinedResource()` from Task 1.
- Produces: `activeMinedResources(products: string[]): string[]`.
- Produces: `minedUsageFromItemPlan(plan, resIndex): Array<{item,resource,lines,outHr,inputHr,perLine}>`.
- Adds `minedUsage` to items and credits results.
- Retains `gelReserved` as a compatibility projection of the Gel/Vespium usage while existing golden fixtures consume it.

- [ ] **Step 1: Write failing independent-budget solver tests**

Create `test/minedsolver.cjs` with the standard core/solver eval harness and this runner:

```js
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  const consumes=(res,input)=>!!(res.balance||[]).find(x=>x.res===input&&x.cons>0);
  function base(){
    const s=defaults();s.dupe=0;s.margin=0;s.mode="items";
    s.lines=[{max:1,spx:1,turbo:0}];
    PRODUCTS.forEach(p=>s.targets[p]={on:p==="Batteries",w:1});
    s.forgie.Wire=1e12;s.forgie.Gel=1e12;
    s.minedIncome.Vespium=0;s.minedIncome.Hydracite=0;
    normalize(s);return s;
  }
  S=base();S.minedIncome.Vespium=1e30;
  let r=optimize();
  check("vespium cannot replace hydracite",!r.feasible||!(r.out.Batteries>0),"out="+(r.out.Batteries||0));
  S=base();S.minedIncome.Hydracite=300000000;
  r=optimize();
  const hu=(r.minedUsage||[]).find(x=>x.resource==="Hydracite");
  check("hydracite enables batteries",r.feasible&&(r.out.Batteries||0)>0,"out="+(r.out.Batteries||0));
  check("hydra use stays under income",hu&&hu.inputHr<=S.minedIncome.Hydracite*60+1,"use="+(hu&&hu.inputHr));
  S=base();S.lines=Array.from({length:2},()=>({max:1,spx:1,turbo:0}));
  S.forgie.Gel=347;S.minedIncome.Vespium=1e13;S.minedIncome.Hydracite=300000000;
  r=optimize();
  const fullUses=r.minedUsage||[];
  check("items battery pipeline uses both ores",r.feasible&&fullUses.some(x=>x.resource==="Vespium")&&fullUses.some(x=>x.resource==="Hydracite"),JSON.stringify(fullUses));
  check("items batteries consume wire and gel",consumes(r,"Wire")&&consumes(r,"Gel"),JSON.stringify(r.balance));
  S=base();S.margin=20;S.minedIncome.Hydracite=246549620.24783823;
  r=optimize();
  check("margin cannot borrow hydracite",!r.feasible||!(r.out.Batteries>0),"out="+(r.out.Batteries||0));
  S=base();S.margin=20;S.forgie.Gel=0;PRODUCTS.forEach(p=>S.targets[p].on=p==="Gel");
  S.minedIncome.Vespium=7966260543580.132;
  r=optimize();
  check("margin cannot borrow vespium",!r.feasible||!(r.out.Gel>0),"out="+(r.out.Gel||0));
  S=base();S.mode="credits";PRODUCTS.forEach(p=>S.targets[p].on=false);
  S.lines=Array.from({length:2},()=>({max:1,spx:1,turbo:0}));S.forgie.Gel=347;
  S.sellPrice.Batteries=10;S.minedIncome.Vespium=1e13;S.minedIncome.Hydracite=300000000;
  r=optimize();
  check("credits can select batteries",r.feasible&&r.bestItem==="Batteries","best="+r.bestItem);
  check("credits battery pipeline uses both ores",(r.minedUsage||[]).some(x=>x.resource==="Vespium")&&(r.minedUsage||[]).some(x=>x.resource==="Hydracite"),JSON.stringify(r.minedUsage));
  check("credits batteries consume wire and gel",consumes(r,"Wire")&&consumes(r,"Gel"),JSON.stringify(r.balance));
  S=base();PRODUCTS.forEach(p=>S.targets[p].on=p==="Reinforced Concrete");
  S.forgie.Bricks=1e12;S.forgie.Concrete=1e12;S.forgie.Frames=1e12;
  r=optimize();
  check("items can make reinforced concrete",r.feasible&&(r.out["Reinforced Concrete"]||0)>0,"out="+(r.out["Reinforced Concrete"]||0));
  S=base();S.mode="credits";PRODUCTS.forEach(p=>S.targets[p].on=false);
  [...RAWS,...PRODUCTS].forEach(p=>S.sellPrice[p]=null);S.sellPrice["Reinforced Concrete"]=10;
  S.forgie.Bricks=1e12;S.forgie.Concrete=1e12;S.forgie.Frames=1e12;
  r=optimize();
  check("credits can select reinforced concrete",r.feasible&&r.bestItem==="Reinforced Concrete","best="+r.bestItem);
  S=base();S.minedIncome.Hydracite=300000000;
  const direct=optimize(),directOut=direct.out.Batteries||0;
  S=JSON.parse(JSON.stringify(S));r=optimize();
  check("worker-cloned mined maps preserve result",Math.abs((r.out.Batteries||0)-directOut)<1e-9,"direct="+directOut+", clone="+(r.out.Batteries||0));
  if(fail)process.exitCode=1;
})();
```

The literals `246549620.24783823` and `7966260543580.132` are 85% of one 1× Battery line's Hydracite/minute burn and one 1× Gel line's Vespium/minute burn at speed 1. Each is deliberately feasible under the old 20% margin rule and infeasible under the required hard cap.

- [ ] **Step 2: Run the test and verify RED behavior**

Run: `node test/minedsolver.cjs`

Expected: failure because Batteries jobs and `minedUsage` are not yet available; the Vespium-only case must not become a false positive.

- [ ] **Step 3: Generalize item/credits job construction and budgets**

In `js/solver.js`:

```js
function activeMinedResources(products){
  return [...new Set(products.map(p=>MINED_CRAFTS[p]&&MINED_CRAFTS[p].resource)
    .filter(r=>r&&minedBudgetHr(r)>0))];
}
```

For every product job, add ordinary `RECIPE` consumption first. If the product has `MINED_CRAFTS[P]`, require that resource to exist in `resIndex`, then append its per-craft cost divided by craft time. This makes Gel a zero-ordinary-input product consuming Vespium and Batteries a two-ordinary-input product consuming Hydracite.

Build `solveCore()` resources as:

```js
const mined=activeMinedResources(relProds);
const resources=[...relRaws,...relProds,...mined];
const baseArr=Float64Array.from(resources.map(r=>
  isMinedResource(r)?minedBudgetHr(r)/3600:forgieHr(r)/3600));
```

Make feasibility resource-aware everywhere `curTol` is used:

```js
const needFrac=r=>isMinedResource(resources[r])?1:(1-curTol);
const feasibleNow=()=>{for(let r=0;r<R;r++)if(produced[r]<consumed[r]*needFrac(r)-1e-7)return false;return true;};
```

Use `needFrac(r)` in leaf feasibility and remaining-production pruning as well. Keep deficit repair strict. Preserve the `resIndex[VESP]` Gel reservation-seed block and `gelLoadout()` helper so high-line-count Gel chains keep their established seeds.

Replace `planFrom()`'s single mined scalar with `minedUsageFromItemPlan()`. Filter all `MINED_RESOURCES` from the normal craftable balance table. Each usage row contains exact input burn derived from the job's resource-indexed consumption; informational Rocks are derived later from `minedCost()` and craft count. Construct the legacy `gelReserved` field from the Gel usage so old parity output remains stable.

Thread `minedUsage` through items results, each credits candidate, and the winning credits result.

Update nearby solver comments and constants so they no longer claim Gel/Vespium is the only mined path or that `gelLoadout()` is display-only; the helper still powers the preserved reservation-style seeds.

- [ ] **Step 4: Run focused, parity, and scale checks**

Run:

```bash
node test/minedsolver.cjs
node test/parity.cjs > /tmp/forge-parity-task2.json
node test/check.cjs test/golden.json /tmp/forge-parity-task2.json
node test/scale.cjs
```

Expected: independent-budget tests pass; existing parity has zero failures; scale harness completes without exceptions.

- [ ] **Step 5: Commit Task 2**

```bash
git add js/solver.js test/minedsolver.cjs
git commit -m "Enforce independent mined resource budgets"
```

---

### Task 3: Project, Manual, and Result-Data Integration

**Files:**
- Create: `test/minedmodes.cjs`
- Modify: `js/solver.js`
- Modify: `js/manual.js`
- Modify: `js/results.js`
- Modify: `js/events.js`

**Interfaces:**
- Consumes: all Task 1 core helpers and Task 2 `minedUsage` shape.
- Produces: `chainMinedBlockers(item: string, seen?: Set<string>): string[]`.
- Adds `blockedMined: Record<string,string[]>` and phase-local `minedUsage` to project results.
- Adds `partial: boolean`; `feasible` remains true only when every demanded item is included and sustainable.
- Adds `minedBalances: Array<{resource,incomeHr,consHr}>` to `manualResult()`.
- Produces: `minedUsageNote(usages): string` in `js/results.js`.

- [ ] **Step 1: Write failing full-pipeline mode tests**

Create `test/minedmodes.cjs`. Load `core.js`, `solver.js`, and `manual.js`, then run these real behaviors:

```js
(function(){
  let fail=0;
  const check=(name,ok,detail)=>{console.log((ok?"ok   ":"FAIL ")+name+" ["+detail+"]");if(!ok)fail++;};
  function project(vesp,hydra){
    const s=defaults();s.mode="project";s.dupe=0;
    s.lines=Array.from({length:6},(_,i)=>({max:i<2?16:4,spx:10,turbo:0}));
    s.minedIncome.Vespium=vesp;s.minedIncome.Hydracite=hydra;
    s.projects=[{id:"battery",name:"Battery test",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Batteries",qty:1}]}]}];
    normalize(s);return s;
  }
  S=project(1e30,0);let r=optimize();
  check("project names hydracite blocker",r.blockedMined&&r.blockedMined.Batteries&&r.blockedMined.Batteries.includes("Hydracite"),JSON.stringify(r.blockedMined));
  S=project(0,1e30);r=optimize();
  check("project names vespium blocker",r.blockedMined&&r.blockedMined.Batteries&&r.blockedMined.Batteries.includes("Vespium"),JSON.stringify(r.blockedMined));
  S=project(1e30,0);
  S.projects=[{id:"mixed",name:"Mixed test",catId:"",on:true,from:1,to:1,done:0,prio:null,
    levels:[{costs:[{item:"Frames",qty:1},{item:"Batteries",qty:1}]}]}];
  r=optimize();
  check("mixed blocked project stays incomplete",r.feasible===false&&r.partial===true&&r.blockedMined&&r.blockedMined.Batteries&&r.blockedMined.Batteries.includes("Hydracite"),"feasible="+r.feasible+", partial="+r.partial);
  check("mixed project keeps an explicitly partial plan",r.rate.Frames>0&&r.eta>0,"frames="+r.rate.Frames+", eta="+r.eta);
  S=project(1e30,1e30);r=optimize();
  const uses=(r.phases[0]&&r.phases[0].minedUsage)||[];
  check("full battery project feasible",r.feasible&&r.eta>0,"eta="+r.eta);
  check("project uses separate ores",uses.some(x=>x.resource==="Vespium")&&uses.some(x=>x.resource==="Hydracite"),JSON.stringify(uses));
  ["Wire","Gel"].forEach(input=>{
    const row=(r.phases[0].balance||[]).find(x=>x.res===input);
    check("project batteries consume "+input,row&&row.cons>0,"cons="+(row&&row.cons));
  });
  S=project(0,0);
  S.projects=[{id:"reinforced",name:"Reinforced test",catId:"",on:true,from:1,to:1,done:0,prio:null,
    levels:[{costs:[{item:"Reinforced Concrete",qty:1}]}]}];
  r=optimize();
  const rcUses=(r.phases[0]&&r.phases[0].minedUsage)||[];
  check("reinforced project needs no mined income",r.feasible&&r.eta>0&&rcUses.length===0,"eta="+r.eta+", uses="+JSON.stringify(rcUses));
  S=defaults();S.dupe=0;S.lines=Array.from({length:3},()=>({max:1,spx:1,turbo:0}));
  S.minedIncome.Vespium=1e15;S.minedIncome.Hydracite=1e9;
  S.manual=[{job:"Gel",lvl:1,sell:false},{job:"Batteries",lvl:1,sell:false},{job:"Reinforced Concrete",lvl:1,sell:false}];syncManual(S);
  const m=manualResult(),mb=m.minedBalances||[],v=mb.find(x=>x.resource==="Vespium"),h=mb.find(x=>x.resource==="Hydracite");
  check("manual tracks vespium",v&&v.consHr>0,"vesp="+(v&&v.consHr));
  check("manual tracks hydracite",h&&h.consHr>0,"hydra="+(h&&h.consHr));
  check("manual budgets stay distinct",v&&h&&v.incomeHr===6e16&&h.incomeHr===6e10,JSON.stringify(mb));
  ["Wire","Gel"].forEach(input=>{
    const row=m.balance.find(x=>x.res===input);
    check("manual batteries consume "+input,row&&row.cons>0,"cons="+(row&&row.cons));
  });
  ["Bricks","Concrete","Frames"].forEach(input=>{
    const row=m.balance.find(x=>x.res===input);
    check("manual reinforced consumes "+input,row&&row.cons>0,"cons="+(row&&row.cons));
  });
  if(fail)process.exitCode=1;
})();
```

- [ ] **Step 2: Run the test and verify RED behavior**

Run: `node test/minedmodes.cjs`

Expected: failure because project blockers/usages and Manual mined balances are still Gel-specific.

- [ ] **Step 3: Generalize project-mode mined constraints and blockers**

Replace `chainNeedsGel()` with:

```js
function chainMinedBlockers(item,seen){
  if(forgieHr(item)>1e-9)return [];
  seen=seen||new Set();if(seen.has(item))return [];seen.add(item);
  const out=[],cfg=MINED_CRAFTS[item];
  if(cfg&&minedBudgetHr(cfg.resource)<=0)out.push(cfg.resource);
  const rec=RECIPE[item];
  (rec&&rec.inputs||[]).forEach(k=>{
    if(PRODUCTS.includes(k))out.push(...chainMinedBlockers(k,new Set(seen)));
  });
  return [...new Set(out)];
}
```

Update `buildScheduleLP()` to supply every mined resource through `minedBudgetHr(it)`. Update `projectSchedule()` to add all active mined resources and use the same generic ordinary-plus-mined job construction as items/credits. Filter all mined resources from the normal balance table.

In `solvePhaseFor()`, build `blockedMined` per demanded item, exclude only blocked targets from the LP, and attach phase-local `minedUsage` derived from the LP entries. A phase with sustainable remaining targets plus blocked targets returns its available line plan with `partial:true` but `feasible:false`; a phase is feasible only when `Object.keys(blockedMined).length===0`, no ordinary target is infeasible, and the LP has positive throughput. Aggregate blocker maps and `partial` at the top level without losing which resource blocked which item. Keep usage on every phase rather than deriving only the first phase's Gel summary.

- [ ] **Step 4: Generalize Manual calculations and rendered result data**

In `manualResult()`, replace `vespCons` with a `minedCons` map. For every configured craft, process normal `RECIPE` inputs and, when a mined descriptor exists, add the descriptor's resource cost at that compression using the line's effective speed. Return:

```js
const minedBalances=MINED_RESOURCES.map(resource=>({
  resource,
  incomeHr:minedBudgetHr(resource),
  consHr:minedCons[resource]||0
})).filter(row=>row.incomeHr>0||row.consHr>0);
```

Update Manual consumption cells to combine ordinary input text with mined input text. Render mined balance rows with an explicit `income →` source label and separate healthy/tight/short calculations.

In `js/results.js`, replace `gelReservedNote()` with `minedUsageNote()` while retaining a small adapter for legacy `gelReserved` data until all call sites use `minedUsage`. Update item/credits lines, project lines, idle explanations, project blockers, demand cells, and zero-use notices to name the exact craft/resource. When `res.partial` is true, render the metric as **Partial plan time** with “currently plannable work only,” and state that the blocked items remain excluded and the ticked projects are not fully finishable. Never label a partial ETA as “Total time to finish all ticked projects.”

In `js/events.js`, replace the hard-coded project step tiers with dependency depth so future recipes also sort correctly:

```js
function itemTier(it,seen){
  if(RAWS.includes(it)||it===GEL)return 0;
  seen=seen||new Set();if(seen.has(it))return 0;seen.add(it);
  const deps=(RECIPE[it]&&RECIPE[it].inputs||[]).filter(k=>RAWS.includes(k)||PRODUCTS.includes(k));
  return deps.length?1+Math.max(...deps.map(k=>itemTier(k,new Set(seen)))):1;
}
```

This places Reinforced Concrete after Bricks/Concrete/Frames and Batteries after Wire/Gel. Replace Gel-only `reserved` and warning wording with `MINED_CRAFTS[item]` and `blockedMined` checks.

- [ ] **Step 5: Run focused and all mode regressions**

Run:

```bash
node test/minedmodes.cjs
node test/gate.cjs
node test/inventory.cjs
node test/forgieproject.cjs
node test/rawtargets.cjs
node test/stockrisk.cjs
node test/stability.cjs
node test/parity.cjs > /tmp/forge-parity-task3.json
node test/check.cjs test/golden.json /tmp/forge-parity-task3.json
```

Expected: every command exits zero.

- [ ] **Step 6: Commit Task 3**

```bash
git add js/solver.js js/manual.js js/results.js js/events.js test/minedmodes.cjs
git commit -m "Integrate mined resources across planner modes"
```

---

### Task 4: Consolidated Mined Resources Modal and Compression Labels

**Files:**
- Create: `test/minedui.cjs`
- Modify: `test/craftdata.cjs`
- Modify: `js/core.js`
- Modify: `index.html`
- Modify: `css/styles.css`
- Modify: `js/render.js`
- Modify: `js/events.js`
- Modify: `js/results.js`
- Modify: `js/manual.js`

**Interfaces:**
- Consumes: `compressionLabel()`, `setMinedIncome()`, `minedCost()`, `minedBudgetHr()`, `MINED_CRAFTS`, and the existing `gelLoadout()`.
- Produces: `renderMinedResources(): void`.
- Produces: `renderMinedCostRows(item: string, targetId: string): void`.
- Uses DOM IDs `btnMined`, `minedModal`, `minedClose`, `minedDone`, `minedVespium`, `minedHydracite`, `minedVespiumSummary`, `minedGelLoadout`, `minedVespiumCosts`, and `minedHydraciteCosts`.

- [ ] **Step 1: Write the failing renderer behavior test**

Create `test/minedui.cjs` with a minimal DOM double that records real renderer outputs rather than asserting on the double itself:

```js
"use strict";
const fs=require("fs"),path=require("path");
class El{
  constructor(){this.innerHTML="";this.textContent="";this.value="";this.hidden=false;this.dataset={};this.children=[];}
  addEventListener(){} setAttribute(){} appendChild(x){this.children.push(x);return x;} querySelector(){return null;}
}
const els={};
globalThis.document={
  activeElement:null,
  getElementById:id=>(els[id]||(els[id]=new El())),
  createElement:()=>new El(),
  querySelectorAll:()=>[]
};
globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
globalThis.performance={now:()=>0};
const src=["core.js","solver.js","render.js"].map(f=>fs.readFileSync(path.join(__dirname,"..","js",f),"utf8")).join("\n");
const runner=`
(function(){
  let fail=0;const check=(n,ok,d)=>{console.log((ok?"ok   ":"FAIL ")+n+" ["+d+"]");if(!ok)fail++;};
  S=defaults();S.minedIncome.Vespium=7.25e18;S.minedIncomeText.Vespium="7.25qu";
  S.minedIncome.Hydracite=3e9;S.minedIncomeText.Hydracite="3b";
  renderMinedResources();
  const gelSummary=document.getElementById("minedVespiumSummary");
  check("vesp input preserved",document.getElementById("minedVespium").value==="7.25qu",document.getElementById("minedVespium").value);
  check("hydra input preserved",document.getElementById("minedHydracite").value==="3b",document.getElementById("minedHydracite").value);
  check("gel summary rendered",/Gel\/hr/.test(gelSummary.textContent||gelSummary.innerHTML),gelSummary.textContent||gelSummary.innerHTML);
  check("hydra table names only hydra",/Hydracite/.test(document.getElementById("minedHydraciteCosts").innerHTML)&&!/Vespium/.test(document.getElementById("minedHydraciteCosts").innerHTML),document.getElementById("minedHydraciteCosts").innerHTML);
  check("cost table labels 16.4k",/16\\.4k×/.test(document.getElementById("minedHydraciteCosts").innerHTML),document.getElementById("minedHydraciteCosts").innerHTML);
  setMinedIncome("Hydracite","4b");
  check("hydra edit does not change vesp",S.minedIncome.Vespium===7.25e18&&S.minedIncome.Hydracite===4e9,JSON.stringify(S.minedIncome));
  if(fail)process.exitCode=1;
})();`;
eval(src+"\n"+runner);
```

Now change the two temporary-alias assertions in `test/craftdata.cjs` to require their final removal:

```js
eq("legacy numeric removed",Object.prototype.hasOwnProperty.call(legacy,"gelVesp"),false);
eq("legacy text removed",Object.prototype.hasOwnProperty.call(legacy,"gelVespText"),false);
```

- [ ] **Step 2: Verify RED in both Node and the real browser**

Run: `node test/minedui.cjs`

Expected: non-zero exit because `renderMinedResources()` and the new modal elements do not exist. `node test/craftdata.cjs` must also fail at this point because the temporary aliases still exist.

Serve the current page: `python3 -m http.server 8000 --bind 127.0.0.1`

Using the Browser plugin, navigate to `http://127.0.0.1:8000/?qa=mined-red` and attempt:

```js
await tab.playwright.getByRole("button", {name:"Mined resources"}).click();
```

Expected: locator failure, proving the user-visible entry point is absent before implementation.

- [ ] **Step 3: Replace the Gel card and cost modal markup**

In `index.html`, remove `gelToggle`, `gelBody`, and `gelCostModal`. Add `<button class="btn primary" id="btnMined">Mined resources</button>` beside the other setup buttons.

Add one `#minedModal` using the existing `.modal-bg` shell. Inside it, create separate Vespium/Gel and Hydracite/Batteries cards with the exact IDs in the Interfaces block. The Hydracite copy must say that actual Batteries production also requires Wire and Gel and must not advertise a Hydracite-only output ceiling.

- [ ] **Step 4: Implement modal rendering and events**

In `js/render.js`, implement `renderMinedResources()` and `renderMinedCostRows()`. Preserve the current `gelLoadout(lineRows(), minedBudgetHr("Vespium"))` summary for Vespium. The Vespium/Gel table shows compression, Rocks/craft, Vespium/craft, real seconds/craft on the fastest eligible line, Rocks/min, and Vespium/min. The Hydracite/Batteries table shows compression, Hydracite/craft, real seconds/craft on the fastest eligible line, and Hydracite/min. For each row, use the fastest current line whose cap reaches the exact level, `craftTime()`, `effSpeed()`, and `minedCost()`; input consumption never uses duplication. If no current line reaches a compression, retain the exact per-craft cost and show an em dash for line-dependent time and per-minute income.

In `js/events.js`, wire:

```js
function openMined(){renderMinedResources();document.getElementById("minedModal").hidden=false;}
function closeMined(){document.getElementById("minedModal").hidden=true;}
```

Use one delegated input listener on `#minedModal` keyed by `data-mined-income`. Call `setMinedIncome(resource, value)`, rerender without stealing focus, and `scheduleSolve()`. Close through close button, Done, backdrop, and Escape.

After every production consumer reads `S.minedIncome`/`S.minedIncomeText`, remove the temporary `gelVesp`/`gelVespText` mirrors from `defaults()`, `normalize()`, and `setMinedIncome()`. Keep only the one-way legacy import in `normalize()`, followed by deletion of the old keys, so a pre-feature save migrates once without maintaining two sources of truth.

Add responsive `.mined-grid`, `.mined-card`, `.mined-table-wrap`, and summary styles in `css/styles.css`; remove `.gel-head`/`.gchev` rules. Keep the modal usable at 375px width with horizontally scrolling tables rather than page overflow.

- [ ] **Step 5: Route every compression display through `compressionLabel()`**

Replace direct `L+"×"`, `${L}×`, and max-cap interpolation in line selectors, Gel loadout, recipe tables, calibration, project steps, results, and Manual mode. Values in `<option value>` remain exact integers.

Update the line-cap tooltip's explicit `4096×` ceiling to `16.4k×`. Update stale copy referring to the “Gel panel,” “Gel lines,” “Gel chains,” or only Wire as a Gel consumer so it names Mined resources and includes Batteries where relevant.

Replace the base-time editor's fixed 70px inline width with a reusable class wide enough to display `1,034,274.56` without hiding most of the value; verify it still fits the recipe cards at mobile width.

- [ ] **Step 6: Run renderer and browser GREEN checks**

Run:

```bash
node test/craftdata.cjs
node test/minedui.cjs
```

Expected: all renderer checks pass.

Reload the same Browser tab and exercise:

```js
await tab.reload();
await tab.playwright.getByRole("button", {name:"Mined resources"}).click();
await tab.playwright.getByLabel("Vespium per minute income").fill("7.25qu");
await tab.playwright.getByLabel("Hydracite per minute income").fill("3b");
```

Expected: both values remain distinct, the Vespium section shows Gel capacity, the Hydracite section shows its own table and full-pipeline warning, `16.4k×` appears, Escape closes the modal, and reopening preserves both values.

- [ ] **Step 7: Commit Task 4**

```bash
git add js/core.js index.html css/styles.css js/render.js js/events.js js/results.js js/manual.js test/craftdata.cjs test/minedui.cjs
git commit -m "Add the mined resources setup modal"
```

---

### Task 5: Regression Strengthening, Scale Coverage, and Documentation

**Files:**
- Modify: `test/scale.cjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: final product and mined-resource behavior from Tasks 1–4.
- Produces: combined Battery/Gel scale telemetry through 12 lines.

- [ ] **Step 1: Add asserting scale scenarios**

Extend `test/scale.cjs` with explicit independent budgets and item, credits, and project Battery scenarios:

```js
const VESP_BUDGET=5e23,HYDRA_BUDGET=5e20;
const setMined=(s,vesp=VESP_BUDGET,hydra=HYDRA_BUDGET)=>{
  s.minedIncome.Vespium=vesp;s.minedIncome.Hydracite=hydra;
};
const prepBattery=(s,hydra=HYDRA_BUDGET)=>{
  setMined(s,VESP_BUDGET,hydra);
  s.forgie.Gel=13500;s.forgie.Wire=1e12;
};
const scen={
  "items.Wire+Gel":s=>{s.mode="items";on(s,["Wire","Frames"]);setMined(s,VESP_BUDGET,0);},
  "credits.Wire+Gel":s=>{s.mode="credits";["Wire","Frames","Rods"].forEach(p=>s.sellPrice[p]=p==="Wire"?5000:10);setMined(s,VESP_BUDGET,0);},
  "project.Wire+Gel":s=>{s.mode="project";setMined(s,VESP_BUDGET,0);
    s.projects=[{id:"wire",name:"Wire scale",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Wire",qty:8000},{item:"Frames",qty:4000}]}]}];},
  "items.Batteries":s=>{s.mode="items";on(s,["Batteries"]);prepBattery(s);},
  "credits.Batteries":s=>{s.mode="credits";s.sellPrice.Batteries=5000;prepBattery(s);},
  "project.Batteries":s=>{s.mode="project";prepBattery(s);
    s.projects=[{id:"battery",name:"Battery scale",catId:"",on:true,from:1,to:1,done:0,prio:null,
      levels:[{costs:[{item:"Batteries",qty:250}]}]}];},
  "items.Batteries.noHydracite":s=>{s.mode="items";on(s,["Batteries"]);prepBattery(s,0);s.minedIncome.Vespium=1e40;}
};
function minedTelemetry(res){
  const rows=res&&Array.isArray(res.minedUsage)?res.minedUsage:
    res&&Array.isArray(res.phases)?res.phases.flatMap(p=>p.minedUsage||[]):[];
  const out={};rows.forEach(x=>out[x.resource]=(out[x.resource]||0)+x.inputHr);return out;
}
```

Before each `out.push()`, derive Battery throughput across all three result shapes:

```js
const rankedBattery=res&&Array.isArray(res.ranking)?res.ranking.find(x=>x.item==="Batteries"):null;
const batteryOut=res&&res.out?(res.out.Batteries||0):rankedBattery?(rankedBattery.out||0):res&&res.rate?(res.rate.Batteries||0):0;
const mined=minedTelemetry(res);
```

Add `batteryOut`, `mined`, `bestItem:res&&res.bestItem`, `budgetVespHr:s.minedIncome.Vespium*60`, and `budgetHydraHr:s.minedIncome.Hydracite*60` to every output row. After all line counts run, make the scale harness an asserting gate:

```js
let scaleFail=false;
const capOk=(used,budget)=>used<=budget+1e-8*Math.max(1,budget);
out.filter(x=>/Batteries$/.test(x.name)).forEach(x=>{
  const creditOk=!/^credits\./.test(x.name)||x.bestItem==="Batteries";
  const ok=!x.err&&x.feasible&&x.obj>0&&x.batteryOut>0&&creditOk&&
    x.mined.Vespium>0&&x.mined.Hydracite>0&&
    capOk(x.mined.Vespium,x.budgetVespHr)&&capOk(x.mined.Hydracite,x.budgetHydraHr);
  __emit((ok?"ok   ":"FAIL ")+x.N+" lines "+x.name+" is feasible and respects both mined caps");
  if(!ok)scaleFail=true;
});
out.filter(x=>x.name==="items.Batteries.noHydracite").forEach(x=>{
  const ok=!x.err&&x.batteryOut<=1e-9&&!(x.mined.Hydracite>0);
  __emit((ok?"ok   ":"FAIL ")+x.N+" lines cannot make Batteries without Hydracite");
  if(!ok)scaleFail=true;
});
if(scaleFail)process.exitCode=1;
```

Print the objective, Battery output, Vespium usage, and Hydracite usage in the table so a scale run proves separation, feasibility, both hard caps, and bounded completion through 12 lines. If the initial `13500` Gel/hr fixture does not leave a positive Gel-crafting remainder at every tested line count, adjust only that fixture to the smallest stable value that keeps each viable scenario positive; do not weaken the assertions.

Finally, run the same viable 12-line Battery state at two solver budgets and assert the deterministic anytime trajectory does not regress:

```js
function batteryBudgetRun(ms){
  const s=base();s.mode="items";s.lines=mkLines(12);on(s,["Batteries"]);prepBattery(s);
  s.solveBudget=ms;normalize(s);syncManual(s);S=s;return optimize();
}
const shortBudget=batteryBudgetRun(400),longBudget=batteryBudgetRun(1600);
const budgetFloor=(shortBudget.objective||0)-1e-8*Math.max(1,shortBudget.objective||0);
const budgetMonotone=(longBudget.objective||0)>=budgetFloor;
__emit((budgetMonotone?"ok   ":"FAIL ")+"Battery objective is non-worsening with more solve time ["+
  (shortBudget.objective||0)+" -> "+(longBudget.objective||0)+"]");
if(!budgetMonotone)process.exitCode=1;
```

Require positive Battery output and both Vespium/Hydracite usage in the 12-line `items.Batteries` row; this guards the preserved Gel reservation seeds on a real combined mined-resource solve rather than accepting a trivially zero objective.

Update `README.md` to list Gel, Wire, Reinforced Concrete, and Batteries; explain Vespium/Hydracite income entry; and state the 1×–16.4k× cap range.

- [ ] **Step 2: Run regression and scale checks**

Run:

```bash
node test/check-classifier.cjs
node test/parity.cjs > /tmp/forge-parity-task5.json
node test/check.cjs test/golden.json /tmp/forge-parity-task5.json
node test/scale.cjs
```

Expected: classifier passes; parity has zero failures; scale output shows no Battery production without Hydracite and completes through 12 lines.

- [ ] **Step 3: Commit Task 5**

```bash
git add test/scale.cjs README.md
git commit -m "Strengthen mined resource regression coverage"
```

---

### Task 6: Full Verification, Review, and Pull Request

**Files:**
- Review all files changed by Tasks 0–5, including this tracked plan and the approved design specification.
- Do not add committed screenshots, traces, browser scripts, or generated reports.

**Interfaces:**
- Consumes: completed implementation and all test harnesses.
- Produces: verified feature branch and one draft pull request targeting `main`.

- [ ] **Step 1: Run syntax and complete automated verification**

Run:

```bash
for f in js/*.js; do node --check "$f" || exit 1; done
node test/craftdata.cjs
node test/minedsolver.cjs
node test/minedmodes.cjs
node test/minedui.cjs
node test/check-classifier.cjs
node test/parity.cjs > /tmp/forge-parity-final.json
node test/check.cjs test/golden.json /tmp/forge-parity-final.json
node test/gate.cjs
node test/inventory.cjs
node test/forgieproject.cjs
node test/rawtargets.cjs
node test/stockrisk.cjs
node test/stability.cjs
node test/scale.cjs
git diff --check
git diff --check main...HEAD
test -z "$(git status --short)"
```

Expected: every command exits zero; parity reports zero failures; the worktree is clean; neither working-tree nor branch diff has whitespace errors.

- [ ] **Step 2: Run rendered Browser QA through the Web Worker path**

Serve: `python3 -m http.server 8000 --bind 127.0.0.1`

Use the Browser plugin at desktop and 375px mobile widths. Verify:

- Page URL/title and meaningful initial DOM.
- No framework overlay, console error, or relevant warning.
- Mined resources opens and closes by button, backdrop, Done, and Escape.
- Vespium and Hydracite accept different game-notation values and survive reload independently.
- Changing Vespium does not change Hydracite, and changing Hydracite does not change Vespium.
- Both new products appear in targets, sell prices, crafting data, project costs/inventory, and Manual assignments.
- Battery results are zero/blocked without Hydracite even when Vespium is enormous.
- A configured full Battery pipeline reports both Vespium and Hydracite usage separately.
- Line caps and every affected results table display `8192×` and `16.4k×` without clipping.
- A solve runs in the worker with the spinner responsive and no synchronous-fallback warning.

Capture screenshots outside the repository for the closed modal, open desktop modal, Battery plan, and mobile modal.

- [ ] **Step 3: Review the complete diff and request code review**

Run:

```bash
git status -sb
git diff main...HEAD --stat
git diff main...HEAD -- js/core.js js/solver.js js/manual.js js/results.js js/render.js js/events.js index.html css/styles.css
```

Use `superpowers:requesting-code-review` or an equivalent independent reviewer. Require explicit review of: independent resource indices, hard-cap handling under margin, old-save migration, project blockers, Gel seed preservation, worker serialization, and UI accessibility. Resolve every actionable finding and rerun the complete verification commands.

- [ ] **Step 4: Recheck upstream and overlapping PR state**

Run:

```bash
git fetch origin main
gh pr view 90 --json state,mergeable,headRefOid,files,url
git rev-list --left-right --count origin/main...HEAD
```

If `origin/main` advanced, integrate it without discarding local commits, resolve overlaps intentionally, and rerun Step 1 and Step 2. Do not merge PR #90 or modify its branch.

- [ ] **Step 5: Push and open the draft pull request**

After confirming `git status --short` is clean:

```bash
git push -u origin feature/mined-resources-and-new-crafts
gh pr create --draft --base main --head feature/mined-resources-and-new-crafts \
  --title "Add mined resources, Batteries, and Reinforced Concrete" \
  --body-file /tmp/forge-mined-resources-pr.md
```

Write `/tmp/forge-mined-resources-pr.md` with real Markdown sections:

- Summary: the two craftables, two independent mined incomes, and new compression tiers.
- Why: game content now requires both new recipes and separate Vespium/Hydracite limits.
- User impact: one Mined Resources modal and complete items/credits/project/Manual support.
- Compatibility: automatic migration of the existing Vespium entry and preservation of calibrated state.
- Verification: exact commands and rendered desktop/mobile flows that passed.

Do not include any AI attribution.

- [ ] **Step 6: Report delivery evidence**

Return the branch name, commit range, PR URL, automated test totals, browser viewports, screenshots, and any remaining risk. Do not claim completion without fresh output from Step 1, Step 2, clean Git status, successful push, and successful PR creation.
