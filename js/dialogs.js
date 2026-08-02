"use strict";

const dialogController=(()=>{
  const stack=[];
  const focusableSelector='a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
  const top=()=>stack[stack.length-1]||null;
  const focusables=panel=>[...panel.querySelectorAll(focusableSelector)].filter(el=>
    !el.disabled&&!el.hidden&&el.getAttribute("aria-hidden")!=="true"&&el.getClientRects().length>0
  );
  function syncBackground(){
    const active=top();
    document.body.classList.toggle("dialog-open",!!active);
    [...document.body.children].forEach(child=>{child.inert=!!active&&child!==active.root;});
  }
  function resetScroll(entry){
    entry.root.scrollTop=0;
    const body=entry.panel.querySelector("[data-dialog-body]");
    if(body)body.scrollTop=0;
  }
  function moveFocus(entry){
    const initial=typeof entry.initialFocus==="function"?entry.initialFocus():entry.initialFocus;
    (initial||focusables(entry.panel)[0]||entry.panel).focus();
  }
  function restoreFocus(entry){
    const underlying=top(),restore=entry.invoker;
    entry.invoker=null;
    if(underlying)moveFocus(underlying);
    else if(restore&&restore.isConnected&&typeof restore.focus==="function")restore.focus();
    else if(entry.invokerId){const replacement=document.getElementById(entry.invokerId);if(replacement)replacement.focus();}
    entry.invokerId=null;
  }
  function open(entry,invoker){
    if(stack.includes(entry))return;
    entry.invoker=invoker||document.activeElement||entry.opener;
    entry.invokerId=entry.invoker&&entry.invoker.id||null;
    entry.root.hidden=false;
    stack.push(entry);
    syncBackground();
    resetScroll(entry);
    let completed=false;
    try{
      if(entry.onOpen)entry.onOpen();
      resetScroll(entry);
      moveFocus(entry);
      completed=true;
    }finally{
      if(!completed){stack.pop();entry.root.hidden=true;syncBackground();restoreFocus(entry);}
    }
  }
  function close(entry){
    if(top()!==entry)return;
    stack.pop();
    entry.root.hidden=true;
    try{if(entry.onClose)entry.onClose();}
    finally{syncBackground();restoreFocus(entry);}
  }
  document.addEventListener("keydown",event=>{
    const entry=top();
    if(!entry)return;
    if(event.key==="Escape"){event.preventDefault();close(entry);return;}
    if(event.key!=="Tab")return;
    const controls=focusables(entry.panel);
    if(!controls.length){event.preventDefault();entry.panel.focus();return;}
    const first=controls[0],last=controls[controls.length-1],active=document.activeElement;
    if(event.shiftKey&&(active===first||!controls.includes(active))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(active===last||!controls.includes(active))){event.preventDefault();first.focus();}
  });
  function register({root,panel,opener,initialFocus,onOpen,onClose}){
    const entry={root,panel,opener,initialFocus,onOpen,onClose,invoker:null,invokerId:null};
    if(!panel.hasAttribute("tabindex"))panel.tabIndex=-1;
    if(opener)opener.addEventListener("click",event=>open(entry,event.currentTarget));
    root.addEventListener("click",event=>{
      if(event.target===root||event.target.closest("[data-dialog-close]"))close(entry);
    });
    return {open:invoker=>open(entry,invoker),close:()=>close(entry),root,panel};
  }
  return {register};
})();
