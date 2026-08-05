"use strict";
/* ---------- ISSUE REPORTING ---------- */
/* Two submit paths share one form. Reporters with a GitHub account open a prefilled
 * issue they own, so replies reach them; reporters without one post through
 * /api/report-issue, which signs the submission through and labels it `community`.
 *
 * Neither path touches planner state. Only what is typed into this form is sent, which
 * keeps the page's promise that saved builds stay in the browser. */

const REPORT_REPO="Andy1292-tower/Forge-Planner";
const REPORT_ENDPOINT="/api/report-issue";
// Long prefills break at proxies and in older browsers well before GitHub complains.
const REPORT_PREFILL_LIMIT=6000;
const REPORT_KIND_LABEL={bug:"bug",project:"catalog",feature:"enhancement"};
const REPORT_MIN={title:5,body:20};
const REPORT_MAX={title:120,body:4000,contact:120};

const reportState={token:null,minWaitMs:0,fetchedAt:0,pending:false,available:null,sent:false};
let reportDialog=null;

function reportEl(id){return document.getElementById(id);}

function reportValues(){
  const kindEl=reportEl("reportKind");
  return {
    kind:kindEl?kindEl.value:"bug",
    title:(reportEl("reportTitle").value||"").trim(),
    body:(reportEl("reportBody").value||"").trim(),
    contact:(reportEl("reportContact").value||"").trim(),
    website:(reportEl("reportWebsite").value||"").trim(),
  };
}

function reportSay(message,tone){
  const status=reportEl("reportStatus");
  if(!status)return;
  status.textContent=message||"";
  status.classList.toggle("is-bad",tone==="bad");
  status.classList.toggle("is-good",tone==="good");
}

function reportSayLink(message,url,linkText){
  const status=reportEl("reportStatus");
  if(!status)return;
  status.textContent=message+" ";
  status.classList.remove("is-bad");
  status.classList.add("is-good");
  const link=document.createElement("a");
  link.href=url;link.target="_blank";link.rel="noopener";link.textContent=linkText;
  status.appendChild(link);
}

/* Mirrors the server limits so a reporter is told what is wrong before anything is sent,
 * and so the GitHub path gets the same floor. The server revalidates regardless. */
function reportProblem(values){
  if(!REPORT_KIND_LABEL[values.kind])return "Choose what kind of report this is.";
  if(values.title.length<REPORT_MIN.title)return "Give the report a title of at least 5 characters.";
  if(values.title.length>REPORT_MAX.title)return "Keep the title under 120 characters.";
  if(values.body.length<REPORT_MIN.body)return "Add at least 20 characters of detail.";
  if(values.body.length>REPORT_MAX.body)return "Keep the details under 4000 characters.";
  if(values.contact.length>REPORT_MAX.contact)return "Keep the contact under 120 characters.";
  return null;
}

function reportBusy(busy){
  ["reportGithub","reportAnon"].forEach(id=>{
    const button=reportEl(id);
    if(button)button.disabled=busy||(id==="reportAnon"&&reportState.available===false);
  });
}

/* ---------- path A: the reporter has a GitHub account ---------- */

function reportGithubUrl(values){
  const base=`https://github.com/${REPORT_REPO}/issues/new`;
  // No `community` label here: an account-authored issue is attributable, and that
  // label exists to mark submissions nobody has verified.
  const query=`labels=${encodeURIComponent(REPORT_KIND_LABEL[values.kind])}`+
    `&title=${encodeURIComponent(values.title)}`+
    `&body=${encodeURIComponent(values.body)}`;
  const full=`${base}?${query}`;
  if(full.length<=REPORT_PREFILL_LIMIT)return {url:full,truncated:false};
  // Too long to carry in a URL. Send the title only rather than a silently cut body.
  return {url:`${base}?labels=${encodeURIComponent(REPORT_KIND_LABEL[values.kind])}&title=${encodeURIComponent(values.title)}`,truncated:true};
}

function reportCopy(text){
  try{
    if(!navigator.clipboard||!navigator.clipboard.writeText)return Promise.resolve(false);
    return navigator.clipboard.writeText(text).then(()=>true,()=>false);
  }catch(error){return Promise.resolve(false);}
}

function reportViaGithub(){
  const values=reportValues();
  const problem=reportProblem(values);
  if(problem){reportSay(problem,"bad");return;}
  const target=reportGithubUrl(values);
  /* A full 35-level cost list is the common catalog submission and encodes well past
   * what a URL carries, so the details go to the clipboard rather than being cut. The
   * write is started from this click, which is the gesture the clipboard API requires. */
  const copying=target.truncated?reportCopy(values.body):null;
  const opened=window.open(target.url,"_blank","noopener");
  if(!opened){reportSay("Your browser blocked the new tab. Allow pop-ups for this page and try again.","bad");return;}
  if(target.truncated){
    Promise.resolve(copying).then(copied=>{
      reportSay(copied
        ?"Opened GitHub with the title filled in. Your details were too long for a link, so they were copied — paste them into the issue body."
        :"Opened GitHub with the title filled in. Your details were too long for a link, so copy them from the box above into the issue body.","bad");
    });
    return;
  }
  reportSay("Opened a prefilled issue on GitHub. Press Create to post it under your account.","good");
}

/* ---------- path B: no account ---------- */

async function reportToken(){
  const now=Date.now();
  if(reportState.token&&now-reportState.fetchedAt<60*60*1000)return reportState.token;
  const response=await fetch(REPORT_ENDPOINT,{method:"GET",headers:{Accept:"application/json"}});
  if(!response.ok)throw new Error(`token ${response.status}`);
  const data=await response.json();
  if(!data||typeof data.token!=="string")throw new Error("token malformed");
  reportState.token=data.token;
  reportState.minWaitMs=Number(data.minWaitMs)||0;
  reportState.fetchedAt=now;
  return data.token;
}

/* Fetched when the panel opens rather than on page load, so a visitor who never reports
 * makes no request, and so the token has aged past the server's floor by the time
 * anyone has finished typing. */
async function reportPrepare(){
  if(reportState.pending||reportState.available===false)return;
  reportState.pending=true;
  try{
    await reportToken();
    reportState.available=true;
  }catch(error){
    /* No function is reachable here. That is the normal case for the static preview and
     * the subpath portability mount, so the account path stays usable and only the
     * anonymous button goes away. */
    reportState.available=false;
    const anon=reportEl("reportAnon");
    if(anon){anon.disabled=true;anon.title="Account-free sending is unavailable on this address.";}
    const help=reportEl("reportHelp");
    if(help)help.textContent="Account-free sending is unavailable on this address. Use the GitHub button, which needs no server.";
  }finally{
    reportState.pending=false;
    reportBusy(false);
  }
}

async function reportAnonymously(){
  const values=reportValues();
  const problem=reportProblem(values);
  if(problem){reportSay(problem,"bad");return;}
  if(reportState.sent){reportSay("That report was already sent. Close and reopen this to send another.","bad");return;}

  reportBusy(true);
  reportSay("Sending…");
  try{
    const token=await reportToken();
    const waited=Date.now()-reportState.fetchedAt;
    if(waited<reportState.minWaitMs)await new Promise(resolve=>setTimeout(resolve,reportState.minWaitMs-waited));
    const response=await fetch(REPORT_ENDPOINT,{
      method:"POST",
      headers:{"Content-Type":"application/json",Accept:"application/json"},
      body:JSON.stringify({
        token,kind:values.kind,title:values.title,body:values.body,
        contact:values.contact,website:values.website,
      }),
    });
    const data=await response.json().catch(()=>null);
    if(response.ok&&data&&data.ok&&data.url){
      reportState.sent=true;
      reportState.token=null;
      reportSayLink("Posted. Thank you — it is now issue",data.url,"#"+data.number);
      reportEl("reportTitle").value="";
      reportEl("reportBody").value="";
      reportBusy(false);
      return;
    }
    // A rejected token is usually a stale tab; drop it so a retry fetches a fresh one.
    if(data&&(data.error==="expired"||data.error==="forged"||data.error==="missing"))reportState.token=null;
    reportSay((data&&data.message)||"That could not be sent. Try the GitHub button instead.","bad");
  }catch(error){
    reportSay("That could not be sent from here. Try the GitHub button instead.","bad");
  }
  reportBusy(false);
}

/* Reopening the dialog starts a fresh report. The previous send stays visible until then
 * so its issue link is clickable, and the server's rate limit — not this flag — is what
 * actually bounds how much one person can post. */
function reportOpened(){
  if(reportState.sent){
    reportState.sent=false;
    reportSay("");
    reportEl("reportContact").value="";
  }
  // Fetched on open, so a visitor who never reports makes no request at all.
  reportPrepare();
}

function wireReportForm(){
  const root=reportEl("reportModal");
  const form=reportEl("reportForm");
  if(!root||!form)return;
  /* Same dialog controller as the planner's other modals, so this inherits the focus
   * trap, Escape, backdrop dismissal, and background inerting rather than restating them. */
  reportDialog=dialogController.register({
    root,
    panel:root.querySelector(".modal"),
    opener:reportEl("btnReport"),
    initialFocus:()=>reportEl("reportKind"),
    onOpen:reportOpened,
  });
  form.addEventListener("submit",event=>event.preventDefault());
  const github=reportEl("reportGithub");
  if(github)github.addEventListener("click",reportViaGithub);
  const anon=reportEl("reportAnon");
  if(anon)anon.addEventListener("click",reportAnonymously);
  ["reportTitle","reportBody","reportContact"].forEach(id=>{
    const field=reportEl(id);
    if(field)field.addEventListener("input",()=>{if(!reportState.sent)reportSay("");});
  });
}

// Page scripts load at the end of <body>, so the form is already parsed here.
wireReportForm();
