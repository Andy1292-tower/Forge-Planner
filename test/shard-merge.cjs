"use strict";
// Decimal is a global in the browser (js/decimal.js loads first); a direct eval() inherits
// this module scope, so binding it here is what makes the evaluated sources resolve it.
const Decimal = require("../js/decimal.js");
/* Sharded solves: the descriptor's route into the solver, the Worker-resident share-ceiling cache,
 * and the main-thread merge.
 *
 * A shard is {index,count} and nothing else, and every mode that fans out has to answer three
 * questions the same way: does one shard of one still produce today's whole-request answer, do the
 * fragments partition the work exactly once, and is the merged result a function of the fragments
 * rather than of the order they arrived in.
 *
 *  - the shard reaches optimize() through a real parameter, not through the direct-source test seam;
 *  - a count of 1, and an unusable descriptor, are the unsharded solve;
 *  - the Credits shards partition the priced catalog round-robin, once each, and their union ranks
 *    exactly as the unsharded run ranks;
 *  - the merge is order-free: every arrival permutation of the same fragments is deep-equal;
 *  - a merged Credits result satisfies dailySolveResultValid, or the mode silently stops being
 *    cacheable and every solve becomes a full-budget solve;
 *  - flags aggregate conservatively — allCandidatesEvaluated AND, searchExhaustive AND,
 *    deadlineReached OR;
 *  - the share-ceiling cache round-trips through an accessor pair, coerces what it is handed, and
 *    scatters across shards;
 *  - its key spells a quantity as a scalar, and the key a real factory produces passes the Worker's
 *    own boundary check rather than being rejected as an oversized state string;
 *  - __solo never reaches the delivered result, because deliver() persists it.
 *
 * Usage: node test/shard-merge.cjs
 */
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

globalThis.performance = performance;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = { getElementById: () => ({ innerHTML: "", textContent: "", hidden: true }) };

const ROOT = path.join(__dirname, "..");
const readSource = file => fs.readFileSync(path.join(ROOT, file), "utf8");
// solve-service is loaded for its free functions only; the IIFE below it builds no Worker without a
// request, so the merge layer is exercised exactly as the main thread holds it.
const src = ["js/decimal.js", "js/core.js", "js/fields.js", "js/state.js", "js/project-schedule.js", "js/solver.js", "js/solve-service.js"]
  .map(readSource).join("\n;\n");

const SERVICE_SOURCE = readSource("js/solve-service.js");
const WORKER_SOURCE = readSource("js/solver.worker.v2.js");

const runner = `
(function(){
  let fail=0;
  const check=(name,fn)=>{
    try{fn();console.log("ok   "+name);}
    catch(error){fail++;console.log("FAIL "+name+" ["+error.message+"]");}
  };
  const eq=(a,b,message)=>{if(a!==b)throw new Error((message||"")+" | "+JSON.stringify(a)+" !== "+JSON.stringify(b));};
  const deepEq=(a,b,message)=>{const x=JSON.stringify(a),y=JSON.stringify(b);if(x!==y)throw new Error((message||"")+" | "+x+" !== "+y);};
  const ok=(value,message)=>{if(!value)throw new Error(message||"expected truthy");};

  /* A small priced factory. Enough items that a four-way partition is uneven, few enough that the
   * whole comparison finishes quickly at the floor budget. */
  const PRICED=["Plates","Rods","Frames","Wire","Glass","Bits","Gel"];
  function creditsState(){
    const s=defaults();
    s.mode="credits";s.solveBudget=200;s.margin=0;s.dupe=0;s.maxTurbo=0;
    s.lines=[{max:32,spx:35,turbo:0},{max:16,spx:30,turbo:0},{max:8,spx:25,turbo:0}];
    ALLITEMS.forEach(item=>{s.sellPrice[item]=0;});
    PRICED.forEach((item,index)=>{if(ALLITEMS.includes(item))s.sellPrice[item]=3+index;});
    normalize(s);syncManual(s);
    return s;
  }
  function solveCredits(shard){
    S=JSON.parse(JSON.stringify(creditsState()));
    resetSoloMaxCache();
    return optimize(undefined,shard);
  }
  const pricedCatalog=()=>{const s=creditsState();return ALLITEMS.filter(item=>(s.sellPrice[item]||0)>0);};

  /* ---- the descriptor's route in ---- */

  check("a shard reaches optimize through a real parameter and not through testOptions",()=>{
    // js/solver.js documents testOptions as never posted through the Worker protocol, so routing a
    // production wire field through it would make the direct-source seam load-bearing.
    eq(optimize.length,2,"optimize takes (testOptions, shard)");
    const whole=solveCredits(undefined);
    S=JSON.parse(JSON.stringify(creditsState()));resetSoloMaxCache();
    const throughSeam=optimize({shard:{index:1,count:2}});
    eq(throughSeam.ranking.length,whole.ranking.length,"a shard smuggled through testOptions must have no effect");
  });

  check("a count of 1 and an unusable descriptor are both the whole-request solve",()=>{
    const whole=solveCredits(undefined).ranking.map(c=>c.item);
    deepEq(solveCredits({index:0,count:1}).ranking.map(c=>c.item),whole,"count 1");
    const junk=[null,2,"0/1",[0,1],{index:0},{count:1},{index:1,count:1},{index:-1,count:2},
      {index:0,count:0},{index:0.5,count:2},{index:2,count:2}];
    junk.forEach(shard=>{
      deepEq(solveCredits(shard).ranking.map(c=>c.item),whole,"unusable descriptor "+JSON.stringify(shard));
    });
  });

  /* ---- the partition ---- */

  check("Credits shards partition the priced catalog round-robin, exactly once each",()=>{
    const whole=solveCredits(undefined).ranking.map(c=>c.item);
    const priced=pricedCatalog();
    [2,3,4].forEach(count=>{
      const fragments=[];
      for(let index=0;index<count;index++)fragments.push(solveCredits({index,count}).ranking.map(c=>c.item));
      const union=[].concat.apply([],fragments);
      eq(union.length,whole.length,count+" shards must cover every priced item exactly once");
      deepEq(union.slice().sort(),whole.slice().sort(),count+" shards must cover the same items");
      // Round-robin in catalog order, not contiguous blocks: adjacent catalog entries are the most
      // alike, so blocks would hand one shard every expensive chain solve.
      for(let index=0;index<count;index++){
        deepEq(fragments[index].slice().sort(),priced.filter((item,at)=>at%count===index).sort(),
          "shard "+index+" of "+count+" must own every count-th catalog entry");
      }
    });
  });

  check("an empty slice reports no ranking and does not tell the reader to enter sell prices",()=>{
    // More shards than priced items: the tail owns nothing, and "No sell prices entered" would be a
    // statement about the pool rather than about the factory.
    const priced=pricedCatalog().length;
    const tail=solveCredits({index:priced+1,count:priced+2});
    eq(tail.ranking.length,0,"a shard past the end of the catalog owns nothing");
    ok(!tail.issues.some(issue=>/No sell prices entered/.test(issue)),JSON.stringify(tail.issues));
  });

  /* ---- the merge ---- */

  function permutations(list){
    if(list.length<=1)return [list.slice()];
    const out=[];
    list.forEach((entry,index)=>{
      const rest=list.slice(0,index).concat(list.slice(index+1));
      permutations(rest).forEach(tail=>out.push([entry].concat(tail)));
    });
    return out;
  }
  function fragmentsFor(count){
    const entries=[];
    for(let index=0;index<count;index++)entries.push({shard:{index,count},res:solveCredits({index,count})});
    return entries;
  }

  check("the merge is a function of the fragments and not of their arrival order",()=>{
    [2,3,4].forEach(count=>{
      const entries=fragmentsFor(count);
      const canonical=JSON.stringify(mergeShardResults("credits",entries));
      permutations(entries).forEach(order=>{
        eq(JSON.stringify(mergeShardResults("credits",order)),canonical,
          "arrival order "+order.map(e=>e.shard.index).join(",")+" of "+count+" changed the merge");
      });
    });
  });

  check("the merged ranking is the ranking the unsharded run produces",()=>{
    const whole=solveCredits(undefined);
    [2,3,4].forEach(count=>{
      const merged=mergeShardResults("credits",fragmentsFor(count));
      deepEq(merged.ranking.map(c=>c.item),whole.ranking.map(c=>c.item),count+" shards ranked differently from one");
      eq(merged.bestItem,whole.bestItem,"bestItem");
      // Credits are Decimals: compare the value, not the object identity.
      eq(String(merged.credits),String(whole.credits),"credits");
      eq(String(merged.objective),String(whole.objective),"objective");
      eq(merged.feasible,whole.feasible,"feasible");
    });
  });

  check("a merged Credits result is still cacheable",()=>{
    /* dailySolveResultValid gates the daily cache write and deliver() drops a failing result without
     * a word: a merged result that does not validate turns every Credits solve into a full-budget
     * solve, with nothing anywhere saying why. */
    const conditionKey=dailySolveConditionKey(creditsState());
    const merged=mergeShardResults("credits",fragmentsFor(3));
    eq(merged.allCandidatesEvaluated,true,"the fixture must evaluate every candidate for this to mean anything");
    eq(dailySolveResultValid(JSON.parse(JSON.stringify(merged)),conditionKey),true,
      "ranking="+merged.ranking.length+" allEvaluated="+merged.allCandidatesEvaluated);
  });

  check("completeness ANDs and the clock ORs",()=>{
    const fragment=(index,overrides)=>({
      shard:{index,count:3},
      res:Object.assign({
        empty:false,mode:"credits",issues:[],ranking:[],bestItem:null,credits:0,objective:0,
        plan:[],balance:[],minedUsage:[],resIndex:{},tol:0,usesMargin:false,feasible:false,
        capped:false,allCandidatesEvaluated:true,deadlineReached:false,searchExhaustive:true,ms:10*(index+1)
      },overrides)
    });
    const all=[fragment(0,{}),fragment(1,{}),fragment(2,{})];
    const merged=mergeShardResults("credits",all);
    eq(merged.allCandidatesEvaluated,true,"all evaluated");
    eq(merged.searchExhaustive,true,"all exhaustive");
    eq(merged.deadlineReached,false,"none late");
    eq(merged.ms,30,"the user waited for the slowest shard, not for the sum");
    eq(mergeShardResults("credits",[fragment(0,{}),fragment(1,{allCandidatesEvaluated:false}),fragment(2,{})]).allCandidatesEvaluated,
      false,"one shard that did not finish makes the whole comparison incomplete");
    eq(mergeShardResults("credits",[fragment(0,{}),fragment(1,{}),fragment(2,{searchExhaustive:false})]).searchExhaustive,
      false,"one shard that stopped short makes the search inexhaustive");
    eq(mergeShardResults("credits",[fragment(0,{}),fragment(1,{deadlineReached:true}),fragment(2,{})]).deadlineReached,
      true,"a shard that ran out of clock means the request ran out of clock");
  });

  /* ---- the share-ceiling cache ---- */

  const SHARE_TARGETS=["Plates","Rods","Frames","Gel"];
  function shareState(){
    const s=defaults();
    s.mode="items";s.targetMode="share";s.solveBudget=400;s.margin=0;s.dupe=0;s.maxTurbo=0;
    s.lines=[{max:32,spx:35,turbo:0},{max:16,spx:30,turbo:0},{max:8,spx:25,turbo:0}];
    s.minedIncome.Vespium.rigPerMin=1e30;
    [...RAWS,...PRODUCTS].forEach(item=>{s.targets[item]={on:false,w:1,share:50};});
    SHARE_TARGETS.forEach(item=>{s.targets[item]={on:true,w:1,share:50};});
    normalize(s);syncManual(s);
    return s;
  }
  const solveShare=shard=>{S=JSON.parse(JSON.stringify(shareState()));return optimize(undefined,shard);};

  check("the ceiling cache has an accessor pair and coerces what it is handed",()=>{
    resetSoloMaxCache();
    deepEq(getSoloMaxCache(),{key:"",values:{}},"reset");
    setSoloMaxCache({key:"k",values:{Plates:10,Rods:"3",Bad:NaN,Neg:-1,Str:"x",Inf:Infinity}});
    // A NaN or negative ceiling does not fail where it is read — it multiplies into a weight and the
    // plan is solved against nonsense — so it is dropped at the boundary rather than trusted.
    deepEq(getSoloMaxCache(),{key:"k",values:{Plates:10,Rods:3}},"coercion");
    [null,undefined,5,"k",[],{values:{Plates:1}},{key:"",values:{Plates:1}},{key:7,values:{}}].forEach(junk=>{
      setSoloMaxCache(junk);
      deepEq(getSoloMaxCache(),{key:"",values:{}},"a cache with no usable key must seed nothing: "+JSON.stringify(junk));
    });
  });

  check("the ceiling key is parameterized on the state it describes",()=>{
    const a=shareState(),b=shareState();
    b.lines[0].max=64;
    eq(soloMaxKey(a),soloMaxKey(a),"stable");
    ok(soloMaxKey(a)!==soloMaxKey(b),"a different factory must key differently");
    eq(typeof soloMaxKey(undefined),"string","a missing state must not throw");
  });

  check("a quantity is a scalar in the ceiling key, not a container",()=>{
    /* canonicalShareKey builds JSON by hand and so never reaches Decimal's toJSON. Left to descend
     * into the instance it spells one quantity as that instance's own properties, which pins the key
     * to decimal.js's internal representation and multiplies the length of every quantity it names. */
    const live=normalize(defaults());
    const key=soloMaxKey(live);
    ok(key.indexOf("constructor")<0,"the key must not carry a Decimal's own properties");
    ok(key.indexOf('"d":[')<0,"the key must not carry a Decimal's internal digits");
    // One factory, whether its quantities are live or the canonical strings a round trip leaves
    // behind. Two spellings that keyed differently would recalibrate every ceiling on every solve.
    eq(soloMaxKey(JSON.parse(JSON.stringify(live))),key,"a quantity and its canonical string must key alike");
  });

  check("the ceiling cache a real factory produces survives the Worker's boundary check",()=>{
    /* What the main thread posts back on the second solve is the factory serialized. STATE_LIMITS
     * .maxStringLength bounds text a user typed into a field; a signature is neither, and holding
     * one to it rejected the cache and failed every solve after the first. */
    const warm={key:soloMaxKey(normalize(defaults())),values:{Plates:1234.5,Rods:99}};
    ok(warm.key.length>STATE_LIMITS.maxStringLength,
      "a real factory's key must outgrow the field limit or this proves nothing: "+warm.key.length);
    deepEq(workerCacheErrors(warm,"solo"),[],"the Worker must accept the cache its own solve produced");
    // Bounded still, and structurally checked still: the field limit is the only thing that moved.
    eq(workerCacheErrors({key:"x".repeat(STATE_LIMITS.maxSignatureLength+1),values:{}},"solo").length,1,
      "a signature past the signature cap must still be rejected");
    eq(workerCacheErrors("nope","solo").join("; "),"solo must be a plain object","a non-object must still be rejected");
    const cyclic={key:"k",values:{}};cyclic.values.self=cyclic;
    ok(workerCacheErrors(cyclic,"solo").length>0,"a cycle must still be rejected");
    ok(workerCacheErrors({key:"k",values:{Plates:{get bad(){return 1;}}}},"solo").length>0,
      "an accessor must still be rejected");
  });

  check("a seeded ceiling cache is reused, and a mismatched one is discarded",()=>{
    resetSoloMaxCache();
    const cold=solveShare(undefined);
    const warmed=getSoloMaxCache();
    ok(Object.keys(warmed.values).length>0,"the cold solve must have computed ceilings");

    resetSoloMaxCache();setSoloMaxCache(warmed);
    const warm=solveShare(undefined);
    deepEq(warm.soloMax,cold.soloMax,"a seeded cache must reproduce the ceilings rather than re-derive them");

    // The key check is the correctness net the round trip rests on: ceilings from another factory
    // are discarded and recomputed rather than applied to this one.
    resetSoloMaxCache();
    setSoloMaxCache({key:"not this factory",values:{Plates:1,Rods:1,Frames:1,Gel:1}});
    const mismatched=solveShare(undefined);
    deepEq(mismatched.soloMax,cold.soloMax,"a mismatched key must yield the identical ceilings");
  });

  check("calibration scatters across shards and the union warms the next solve",()=>{
    const count=3,fragments=[];
    for(let index=0;index<count;index++){
      resetSoloMaxCache();
      solveShare({index,count});
      fragments.push({shard:{index,count},res:{__solo:getSoloMaxCache()}});
    }
    const counts=fragments.map(f=>Object.keys(f.res.__solo.values).length);
    ok(counts.every(n=>n<SHARE_TARGETS.length),"each shard must calibrate a slice, not the whole set: "+counts.join(","));
    ok(counts.reduce((a,b)=>a+b,0)===SHARE_TARGETS.length,"the slices must partition the ceilings: "+counts.join(","));
    const union=mergeSoloCaches(fragments);

    resetSoloMaxCache();
    solveShare(undefined);
    const whole=getSoloMaxCache();
    deepEq(Object.keys(union.values).sort(),Object.keys(whole.values).sort(),
      "the union of the shards must be what one unsharded solve computes");
    deepEq(union.values,whole.values,"and the same ceilings");
  });

  check("shards that disagree about the factory seed nothing",()=>{
    const union=mergeSoloCaches([
      {shard:{index:0,count:2},res:{__solo:{key:"a",values:{Plates:1}}}},
      {shard:{index:1,count:2},res:{__solo:{key:"b",values:{Rods:2}}}}
    ]);
    eq(union,null,"two factories' ceilings must not be mixed into one cache");
  });

  /* ---- the delivered result ---- */

  check("the Worker's caches never reach the delivered result",()=>{
    /* deliver() writes the delivered object into the daily solve cache and dailySolveResultValid
     * does not reject unknown keys, so a Worker-resident cache left on the result is persisted and
     * replayed for a day as part of the plan. */
    ok(/delete data\\.res\\.__solo/.test(SERVICE_SOURCE),"__solo must be deleted on the delivery path");
    const deleteAt=SERVICE_SOURCE.indexOf("delete data.res.__solo");
    const deliverAt=SERVICE_SOURCE.indexOf("deliver(data.generation",deleteAt);
    ok(deleteAt>0&&deliverAt>deleteAt,"__solo must be deleted before deliver, not after");
    ok(/res\\.__solo\\s*=\\s*getSoloMaxCache\\(\\)/.test(WORKER_SOURCE),"the Worker must return its ceilings");
    ok(/setSoloMaxCache\\(solo\\s*\\|\\|\\s*null\\)/.test(WORKER_SOURCE),"the Worker must seed from the posted cache");
    ok(/workerCacheErrors\\(solo,"solo"\\)/.test(WORKER_SOURCE),"the Worker must check the posted cache as a cache, not as state");
    ok(/workerCacheErrors\\(stab,"stab"\\)/.test(WORKER_SOURCE),"and the stability cache the same way");
    ok(/optimize\\(undefined,\\s*attributed\\)/.test(WORKER_SOURCE),"the Worker must pass the validated descriptor");
  });

  console.log("");
  console.log(fail?(fail+" shard merge test(s) failed"):"all shard merge tests passed");
  return fail;
})()
`;

const failures = eval(src + "\n" + runner);
process.exit(failures ? 1 : 0);
