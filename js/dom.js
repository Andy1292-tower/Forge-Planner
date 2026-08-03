"use strict";

function domElement(tag,className,text){
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(text!==undefined)element.textContent=String(text);
  return element;
}

function domTextInput(dataName,dataValue,value,options={}){
  const input=document.createElement("input");
  input.type="text";
  input.dataset[dataName]=String(dataValue);
  input.placeholder=options.placeholder||"";
  if(options.inputMode)input.inputMode=options.inputMode;
  if(options.accessibleName)input.setAttribute("aria-label",options.accessibleName);
  if(options.rule)applyFieldInputAttributes(input,options.rule,options.attributes);
  if(options.errorId)input.dataset.fieldError=options.errorId;
  input.value=String(value==null?"":value);
  return input;
}

function fieldDomToken(value){
  if(value==null)return "n";
  const source=String(value);
  let token="s";
  /* Fixed-width UTF-16 hex is lossless for every JavaScript string while keeping the
   * result safe in an HTML id and a CSS selector. Case and punctuation must never
   * collapse because each generated feedback id has exactly one owning input. */
  for(let i=0;i<source.length;i++)token+=source.charCodeAt(i).toString(16).padStart(4,"0");
  return token;
}
function domFieldError(id,className=""){
  const error=domElement("div",`field-error${className?" "+className:""}`);
  error.id=id;
  error.setAttribute("aria-live","polite");
  error.setAttribute("aria-atomic","true");
  return error;
}
function applyFieldInputAttributes(input,rule,overrides){
  const attrs=fieldInputAttributes(rule,overrides);
  Object.entries(attrs).forEach(([name,value])=>input.setAttribute(name,value));
  return input;
}
function htmlFieldInputAttributes(rule,overrides){
  return Object.entries(fieldInputAttributes(rule,overrides))
    .map(([name,value])=>`${name}="${htmlAttribute(value)}"`).join(" ");
}
function _describedByTokens(input){
  return (input.getAttribute("aria-describedby")||"").split(/\s+/).filter(Boolean);
}
function fieldErrorForInput(input){
  const id=input&&input.dataset&&input.dataset.fieldError;
  return id?document.getElementById(id):null;
}
function updateFieldFeedback(input,error,rule,result,previousValue){
  if(!input||!error)return;
  const invalid=result.status==="invalid"||result.status==="incomplete";
  const tokens=_describedByTokens(input).filter(token=>token!==error.id);
  if(invalid){
    input.setAttribute("aria-invalid","true");
    tokens.push(error.id);
    const prior=formatFieldValue(rule,previousValue);
    error.textContent=`${result.message} The previous value (${prior===""?"blank":prior}) is still active.`;
  }else{
    input.removeAttribute("aria-invalid");
    error.textContent="";
  }
  if(tokens.length)input.setAttribute("aria-describedby",tokens.join(" "));
  else input.removeAttribute("aria-describedby");
}

function markTableScroller(element,label){
  if(!element)return;
  element.classList.add("table-scroll");
  element.setAttribute("aria-label",label);
  if(!element.querySelector(":scope > .table-scroll-hint")){
    const hint=domElement("div","table-scroll-hint","Scroll horizontally to see all columns →");
    hint.setAttribute("aria-hidden","true");
    element.prepend(hint);
  }
  queueTableScrollSync();
}
// Scrollers are built detached and inserted by the caller, so this element usually
// isn't in the document yet and can't be measured. Defer one pass over the live DOM
// instead of measuring the node we were handed.
// A timer rather than requestAnimationFrame: rAF is suspended while the tab is in the
// background, so a solve that finishes there would leave every hint stale until the
// next resize. Reading scrollWidth forces the layout we need anyway.
let _scrollSyncTimer=null;
function queueTableScrollSync(){
  if(_scrollSyncTimer!==null)return;
  _scrollSyncTimer=setTimeout(()=>{_scrollSyncTimer=null;syncAllTableScrollHints();},0);
}
// A table that fits shouldn't claim to scroll, and shouldn't be a tab stop either —
// announcing "scrollable region" on a table with nothing to scroll teaches people to
// ignore the message on the tables that really do overflow.
function syncTableScrollHint(element){
  if(!element||!element.isConnected)return;
  const overflowing=element.scrollWidth>element.clientWidth+1;
  const hint=element.querySelector(":scope > .table-scroll-hint");
  if(hint)hint.hidden=!overflowing;
  if(overflowing){
    element.setAttribute("role","region");
    element.setAttribute("aria-describedby","tableScrollHelp");
    element.tabIndex=0;
  }else{
    element.removeAttribute("role");
    element.removeAttribute("aria-describedby");
    element.removeAttribute("tabindex");
  }
}
function syncAllTableScrollHints(){
  if(typeof document==="undefined")return;
  document.querySelectorAll(".table-scroll").forEach(syncTableScrollHint);
}
if(typeof window!=="undefined")window.addEventListener("resize",syncAllTableScrollHints);

// Tooltips open upward by default. Near the top of a scrolling panel that puts the
// bubble outside the scroll container, where it is clipped and covers whatever sits
// above the field. Measure the room actually available just before it shows and flip
// it below the button when it will not fit. Measured with visibility:hidden so the
// bubble is laid out but never painted in the wrong place first.
function placeTip(tip){
  if(!tip||typeof getComputedStyle!=="function")return;
  const bubble=tip.querySelector(".tip-text");if(!bubble)return;
  tip.classList.remove("tip-below");
  const inline=bubble.getAttribute("style");
  bubble.style.cssText="display:block;visibility:hidden;opacity:0;transition:none";
  const bubbleBox=bubble.getBoundingClientRect(),tipBox=tip.getBoundingClientRect();
  if(inline===null)bubble.removeAttribute("style");else bubble.setAttribute("style",inline);
  // nearest scrolling ancestor clips the bubble; fall back to the viewport
  const viewportBottom=(typeof window!=="undefined"&&window.innerHeight)||0;
  let ceiling=0,floor=viewportBottom;
  for(let el=tip.parentElement;el;el=el.parentElement){
    const overflowY=getComputedStyle(el).overflowY;
    if(overflowY==="auto"||overflowY==="scroll"){
      const box=el.getBoundingClientRect();
      ceiling=Math.max(ceiling,box.top);floor=Math.min(floor,box.bottom);break;
    }
  }
  const needed=bubbleBox.height+12;
  const roomAbove=tipBox.top-Math.max(ceiling,0);
  const roomBelow=floor-tipBox.bottom;
  // Flip only when below is actually the better side — a tip near the bottom of a short
  // panel has no room either way, and moving it down would only trade one clip for another.
  if(roomAbove<needed&&roomBelow>roomAbove)tip.classList.add("tip-below");
}
// Guarded on addEventListener, not just document: the node test harness supplies a
// minimal document stub without it.
if(typeof document!=="undefined"&&typeof document.addEventListener==="function"){
  // pointerover/focusin rather than mouseenter: both bubble, so one listener covers
  // every tip including those rendered later.
  const place=event=>{
    const tip=event.target&&event.target.closest&&event.target.closest(".tip");
    if(tip)placeTip(tip);
  };
  document.addEventListener("pointerover",place,true);
  document.addEventListener("focusin",place,true);
}

function domOption(value,label,selected){
  const option=document.createElement("option");
  option.value=String(value==null?"":value);
  option.textContent=String(label==null?"":label);
  option.selected=!!selected;
  return option;
}

function htmlText(value){
  return String(value==null?"":value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

function htmlAttribute(value){
  return htmlText(value)
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#39;");
}
