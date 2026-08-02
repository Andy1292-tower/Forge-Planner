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
  input.value=String(value==null?"":value);
  return input;
}

function markTableScroller(element,label){
  if(!element)return;
  element.classList.add("table-scroll");
  element.setAttribute("role","region");
  element.setAttribute("aria-label",label);
  element.setAttribute("aria-describedby","tableScrollHelp");
  element.tabIndex=0;
  if(!element.querySelector(":scope > .table-scroll-hint")){
    const hint=domElement("div","table-scroll-hint","Scroll horizontally to see all columns →");
    hint.setAttribute("aria-hidden","true");
    element.prepend(hint);
  }
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
