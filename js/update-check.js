"use strict";
/* ---------- NEW BUILD NOTICE ----------
 * Every asset this page runs on is content-hashed and immutable, so a tab left open keeps
 * running the build it started with no matter what ships afterwards. The build stamps a
 * release id into the page's forge-build meta and writes the same id to version.json, so a
 * mismatch means a newer deployment is live and a reload will pick it up.
 *
 * Hosting bills requests, not bytes, so the poll is deliberately stingy:
 *   - nothing on load — the stamp already identifies the running build;
 *   - nothing while the tab is hidden, which is where a forgotten tab spends its life;
 *   - at most one request per UPDATE_CHECK_INTERVAL_MS, never two in flight;
 *   - nothing at all once an update is found, or once the host proves it serves no
 *     version.json (a 404 is a permanent answer, not a blip).
 * version.json is a few dozen bytes served must-revalidate, so each check is one
 * conditional request answered 304 with an empty body. A tab left open all day costs
 * a couple of dozen requests and no meaningful transfer.
 */

const UPDATE_STAMP_SHAPE=/^[0-9a-f]{16}$/;
// Document-relative on purpose: the release also serves from the /Forge-Planner subpath mount.
const UPDATE_VERSION_URL="version.json";
const UPDATE_CHECK_INTERVAL_MS=30*60*1000;
// Consecutive failures (offline, flaky link) back off instead of retrying on the normal cadence.
const UPDATE_RETRY_BACKOFF_MS=[5*60*1000,15*60*1000,60*60*1000];

const updateState={stamp:"",timer:null,nextCheckAt:0,failures:0,checking:false,stopped:false,found:false};

// Written by scripts/build-static.cjs. An unbuilt source tree keeps the placeholder, which
// fails the shape test below and leaves the whole check inert for local development.
function updateBuildStamp(){
  const meta=document.querySelector('meta[name="forge-build"]');
  const stamp=meta?meta.getAttribute("content")||"":"";
  return UPDATE_STAMP_SHAPE.test(stamp)?stamp:"";
}

function updateClearTimer(){
  if(updateState.timer===null)return;
  clearTimeout(updateState.timer);
  updateState.timer=null;
}

// Rearmed on every visibility change, so a hidden tab holds no pending timer and a tab that
// comes back after hours checks as soon as it is eligible instead of on the next tick.
function updateArm(){
  updateClearTimer();
  if(updateState.stopped||updateState.checking)return;
  if(document.visibilityState==="hidden")return;
  const delay=Math.max(0,updateState.nextCheckAt-Date.now());
  updateState.timer=setTimeout(()=>{updateState.timer=null;updateRunCheck();},delay);
}

function updateStop(){
  updateState.stopped=true;
  updateClearTimer();
}

function updateDefer(waitMs){
  updateState.nextCheckAt=Date.now()+waitMs;
  updateArm();
}

// Resolves to the deployed build id, "" when the host has no version.json to serve, or
// throws so the caller can back off. Kept separate from the scheduling so the request
// shape stays obvious: no credentials, and a revalidation the CDN can answer 304.
async function updateFetchBuild(){
  const response=await fetch(UPDATE_VERSION_URL,{cache:"no-cache",credentials:"omit",headers:{Accept:"application/json"}});
  if(response.status===404)return "";
  if(!response.ok)throw new Error("version.json request failed: "+response.status);
  const data=await response.json();
  const build=data&&typeof data.build==="string"?data.build:"";
  if(!UPDATE_STAMP_SHAPE.test(build))throw new Error("version.json carries no usable build id");
  return build;
}

async function updateRunCheck(){
  if(updateState.stopped||updateState.checking)return false;
  if(document.visibilityState==="hidden"){updateArm();return false;}
  updateState.checking=true;
  let build;
  try{
    build=await updateFetchBuild();
  }catch(error){
    updateState.checking=false;
    updateState.failures+=1;
    updateDefer(UPDATE_RETRY_BACKOFF_MS[Math.min(updateState.failures-1,UPDATE_RETRY_BACKOFF_MS.length-1)]);
    return false;
  }
  updateState.checking=false;
  updateState.failures=0;
  if(build===""){updateStop();return false;}
  if(build===updateState.stamp){updateDefer(UPDATE_CHECK_INTERVAL_MS);return false;}
  updateState.found=true;
  // The answer cannot change back, so stop spending requests on a question already settled.
  updateStop();
  updateShowNotice();
  return true;
}

function updateShowNotice(){
  const bar=document.getElementById("updateBar");
  if(bar)bar.hidden=false;
}

function updateHideNotice(){
  const bar=document.getElementById("updateBar");
  if(bar)bar.hidden=true;
}

// The reload is always the reader's choice. Their build lives in local storage and the
// newest edit may still be sitting in the persist debounce, so flush before leaving.
function updateReloadNow(){
  if(typeof flushPersist==="function")flushPersist();
  location.reload();
}

function startUpdateCheck(){
  const reload=document.getElementById("updateReload");
  if(reload)reload.addEventListener("click",updateReloadNow);
  const dismiss=document.getElementById("updateDismiss");
  if(dismiss)dismiss.addEventListener("click",updateHideNotice);
  updateState.stamp=updateBuildStamp();
  if(!updateState.stamp||typeof fetch!=="function")return false;
  updateState.nextCheckAt=Date.now()+UPDATE_CHECK_INTERVAL_MS;
  document.addEventListener("visibilitychange",updateArm);
  updateArm();
  return true;
}

startUpdateCheck();
