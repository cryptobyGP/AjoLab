/* AjoLabs front end: sign-in (Privy), landing demo, portfolio, circle pages. */
const appEl=$("#app");
const DAY=86400000;
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const CYC={7:"weekly",14:"every 2 weeks",30:"monthly"};
const FEE=0.01;
const PG='<img class="pg" src="/paga-logo.jpg" alt="">';

/* ---------- toast + sheet ---------- */
function toast(msg){const t=$("#toast"); t.textContent=msg; t.classList.add("on"); clearTimeout(toast.t); toast.t=setTimeout(()=>t.classList.remove("on"),3600);}
function sheet(html,onMount){ $("#sheetIn").innerHTML=html; $("#sheet").classList.add("on"); if(onMount) onMount($("#sheetIn")); }
function closeSheet(){ $("#sheet").classList.remove("on"); }
$("#sheet").addEventListener("click",e=>{ if(e.target.id==="sheet"||e.target.closest("[data-close]")) closeSheet(); });

/* ---------- auth (Privy, with a demo fallback) ---------- */
let CONFIG={}, ME=null, TOKEN_FN=null, EMAIL="";
const b64u=s=>btoa(unescape(encodeURIComponent(s))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const Auth={ready:false,authenticated:false,login:null,logout:null,token:null,email:""};

async function startPrivy(appId){
  const [React,DOM,P]=await Promise.all([
    import("https://esm.sh/react@18.3.1"),
    import("https://esm.sh/react-dom@18.3.1/client?deps=react@18.3.1"),
    import("https://esm.sh/@privy-io/react-auth@2?deps=react@18.3.1,react-dom@18.3.1")
  ]);
  const h=(React.default||React).createElement, {PrivyProvider,usePrivy}=P;
  function Bridge(){
    const p=usePrivy();
    Auth.ready=p.ready; Auth.authenticated=p.authenticated;
    Auth.login=o=>p.login(o); Auth.logout=()=>p.logout();
    Auth.token=()=>p.getAccessToken();
    Auth.email=(p.user&&((p.user.email&&p.user.email.address)||(p.user.google&&p.user.google.email)))||"";
    window.dispatchEvent(new Event("ajoauth"));
    return null;
  }
  const root=(DOM.default||DOM).createRoot?(DOM.default||DOM):DOM;
  const el=document.createElement("div"); document.body.appendChild(el);
  root.createRoot(el).render(h(PrivyProvider,{appId,config:{loginMethods:["google","email"],appearance:{theme:"dark",accentColor:"#3FD68B"}}},h(Bridge)));
}

function demoToken(){ const e=localStorage.getItem("ajo_demo_email"); return e?"demo."+b64u(e):null; }
async function getToken(){
  if(CONFIG.privyAppId){ if(Auth.authenticated&&Auth.token) return Auth.token(); return null; }
  return demoToken();
}
async function api(path,opts){
  opts=opts||{}; const t=await getToken(); const headers={"Content-Type":"application/json"};
  if(t) headers.Authorization="Bearer "+t;
  const em=CONFIG.privyAppId?Auth.email:(localStorage.getItem("ajo_demo_email")||""); if(em) headers["x-user-email"]=em;
  const r=await fetch(path,{method:opts.body!==undefined?"POST":(opts.method||"GET"),headers,body:opts.body!==undefined?JSON.stringify(opts.body):undefined});
  const d=await r.json().catch(()=>({}));
  if(r.status===401){ showWelcome(); throw new Error(d.error||"Please sign in"); }
  if(!r.ok) throw new Error(d.error||"Something went wrong");
  return d;
}

const welcome=$("#welcome"),splash=$("#splash");
const SESSION=()=>{try{return localStorage.getItem("ajo_session")==="1";}catch(e){return false;}};
const setSession=v=>{try{v?localStorage.setItem("ajo_session","1"):localStorage.removeItem("ajo_session");}catch(e){}};
function showSplash(){ splash.classList.add("on"); document.body.classList.add("locked"); clearTimeout(showSplash.t); showSplash.t=setTimeout(()=>{ if(!ME){ hideSplash(); showWelcome(); } },15000); }
function hideSplash(){ splash.classList.remove("on"); clearTimeout(showSplash.t); }
let pending=null;
function showWelcome(){ hideSplash(); welcome.classList.add("on"); document.body.classList.add("locked"); }
function hideWelcome(){ welcome.classList.remove("on"); document.body.classList.remove("locked"); }
function werr(m){ $("#wErr").textContent=m||""; }
const EMAILRX=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;

$("#wGoogle").onclick=()=>{
  werr("");
  if(CONFIG.privyAppId||PRIVY_STARTED){ if(!Auth.ready||!Auth.login){ pending={t:"google"}; $("#wGoogle").classList.add("busy"); return werr("Opening Google sign-in..."); } Auth.login({loginMethods:["google"]}); }
  else werr("Google sign-in needs Privy to be set up. For now use your email.");
};
$("#wContinue").onclick=async()=>{
  werr(""); const e=$("#wEmail").value.trim().toLowerCase();
  if(!EMAILRX.test(e)) return werr("Enter a valid email address.");
  if(CONFIG.privyAppId||PRIVY_STARTED){
    if(!Auth.ready||!Auth.login){ pending={t:"email",e}; $("#wContinue").classList.add("busy"); return werr("Sending your sign-in code..."); }
    Auth.login({loginMethods:["email"],prefill:{type:"email",value:e}});
  } else { localStorage.setItem("ajo_demo_email",e); await enter(); }
};
$("#wEmail").addEventListener("keydown",e=>{ if(e.key==="Enter") $("#wContinue").click(); });
window.addEventListener("ajoauth",()=>{
  if(!Auth.ready) return;
  if(Auth.authenticated){ if(!ME&&!entering){ pending=null; enter(); } return; }
  // Privy finished loading and there is no saved session
  if(!ME){ hideSplash(); if(!welcome.classList.contains("on")) showWelcome(); setSession(false); }
  if(pending&&Auth.login){ const p=pending; pending=null; werr(""); $("#wGoogle").classList.remove("busy"); $("#wContinue").classList.remove("busy"); if(p.t==="google") Auth.login({loginMethods:["google"]}); else Auth.login({loginMethods:["email"],prefill:{type:"email",value:p.e}}); }
});

let entering=false;
async function enter(){
  entering=true;
  try{
    ME=await api("/api/me"); hideWelcome(); hideSplash(); setSession(true); seenInit();
    const j=new URLSearchParams(location.search).get("join"), ap=new URLSearchParams(location.search).get("approve");
    if(!ME.name) await setupSheet();
    if(ap){ history.replaceState(null,"",location.pathname); await refresh(); approveSheet(ap); }
    if(j){ history.replaceState(null,"",location.pathname); openApp("join"); $("#jCode").value=j; lookup(); }
    await refresh();
  }catch(e){ if(!/sign in/i.test(e.message)) werr(e.message); }
  entering=false;
}
function signOut(){
  localStorage.removeItem("ajo_demo_email"); setSession(false); ME=null; circles=[]; cur=null; closeApp();
  if(CONFIG.privyAppId&&Auth.logout) Auth.logout();
  showWelcome();
}
$("#signOut").onclick=signOut;

function setupSheet(){
  return new Promise(res=>{
    sheet('<h2>Your details</h2><p class="alede">Your name shows to the people in your circles. Your phone number is used for Paga payments.</p>'+
      '<label for="sName" style="margin-top:6px">Full name</label><input id="sName" maxlength="40" autocomplete="name">'+
      '<label for="sPhone">Phone number</label><input id="sPhone" inputmode="tel" placeholder="08012345678" autocomplete="tel">'+
      '<div class="err" id="sErr" style="color:var(--bad);font-size:14px;margin-top:10px"></div>'+
      '<button class="pill block abtn" id="sSave">Save and continue</button>',
    root=>{
      $("#sSave").onclick=async()=>{
        const name=$("#sName").value.trim(), phone=$("#sPhone").value.trim();
        if(name.length<2) return $("#sErr").textContent="Enter your name.";
        if(!/^\+?\d{10,14}$/.test(phone.replace(/\s/g,""))) return $("#sErr").textContent="Enter a valid phone number.";
        try{ ME=await api("/api/me",{body:{name,phone}}); closeSheet(); res(); }catch(e){ $("#sErr").textContent=e.message; }
      };
    });
  });
}

/* ---------- hero demo: watch a round ---------- */
const demo={size:5,amt:5000,members:NAMES.slice(0,5),round:1,paid:new Set(),late:new Set(),active:true,done:false};
const heroOrbit=new Orbit($("#heroCanvas"),()=>demo,()=>!appEl.classList.contains("on"));
const CAPS={
 1:"Everyone pays the same amount each round, through Paga. The money goes into the circle's pot, not to a person.",
 2:"The pot fills as members pay. It only pays out once everyone has paid, and a missed payment is covered by the deposit and holdback.",
 3:"The whole pot, minus the small fee, goes to this round's member. Nobody has to approve it.",
 4:"The circle turns and the next member is up. This repeats until everyone has had their turn."
};
let demoStep=1,dTimers=[],dAuto=true,dResume=null;
const demoSeg=seg($("#demoTabs"),[{v:"1",l:"Pay in"},{v:"2",l:"Pot fills"},{v:"3",l:"Payout"},{v:"4",l:"Next turn"}],()=>demoStep,v=>setDemo(+v,true),"tabs");
const dLater=(fn,ms)=>dTimers.push(setTimeout(fn,ms));
function setDemo(k,fromUser){
  if(fromUser){dAuto=false;clearTimeout(dResume);dResume=setTimeout(()=>{dAuto=true;},15000);}
  dTimers.forEach(clearTimeout);dTimers=[];
  const prev=demoStep;demoStep=k;$("#demoCap").textContent=CAPS[k];demoSeg.render();
  if(k===1){demo.paid=new Set();[0,1,2].forEach((i,j)=>dLater(()=>demo.paid.add(i),350+j*450));}
  else if(k===2){[0,1,2].forEach(i=>demo.paid.add(i));[3,4].forEach((i,j)=>dLater(()=>demo.paid.add(i),400+j*450));}
  else if(k===3){demo.paid=new Set([0,1,2,3,4]);dLater(()=>heroOrbit.payout(),250);}
  else if(k===4){demo.paid=new Set();if(prev!==4)demo.round=demo.round%demo.size+1;}
}
setDemo(1,false);
setInterval(()=>{
  if(!dAuto||document.hidden||appEl.classList.contains("on")) return;
  const r=$("#heroCanvas").getBoundingClientRect(); if(!r.width||r.bottom<0||r.top>innerHeight) return;
  setDemo(demoStep%4+1,false);
},4800);

/* ---------- app shell ---------- */
const PAGES=["portfolio","circle","create","join"];
let page="portfolio";
const navSeg=seg($("#navSeg"),[{v:"portfolio",l:"Portfolio"},{v:"circle",l:"Circle"},{v:"create",l:"Create"},{v:"join",l:"Join"}],()=>page,v=>showPage(v),"group");
const appMenu=$("#appMenu"),appMenuBtn=$("#appMenuBtn");
const setAppMenu=o=>{appMenu.classList.toggle("open",o);appMenuBtn.setAttribute("aria-expanded",o);};
appMenuBtn.onclick=()=>setAppMenu(!appMenu.classList.contains("open"));
function showPage(id){
  page=id; PAGES.forEach(p=>$("#p-"+p).classList.toggle("on",p===id));
  appMenu.querySelectorAll("[data-page]").forEach(b=>{if(b.dataset.page===id)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});
  navSeg.render(); setAppMenu(false);
  if(id==="portfolio") renderPortfolio();
  if(id==="circle") renderCircle();
  if(id==="create") renderSum();
  $("#appmain").scrollTop=0; requestAnimationFrame(placeAll);
}
function openApp(id){
  if(!ME){ showWelcome(); return; }
  setMenu(false); appEl.classList.add("on"); appEl.setAttribute("aria-hidden","false"); document.body.classList.add("locked"); showPage(id||"portfolio");
}
function closeApp(){appEl.classList.remove("on");appEl.setAttribute("aria-hidden","true");document.body.classList.remove("locked");setAppMenu(false);closeSheet();}
document.addEventListener("click",e=>{const o=e.target.closest("[data-open]");if(o)openApp(o.dataset.open);});
appEl.addEventListener("click",e=>{const g=e.target.closest("[data-page]");if(g)showPage(g.dataset.page);});
$("#closeApp").onclick=closeApp; $("#backSite").onclick=closeApp;
$("#appLogo").onclick=e=>{e.preventDefault();closeApp();};
$("#walletPill").onclick=()=>showPage("portfolio");
$("#refreshBtn").onclick=()=>refresh(true);
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if($("#sheet").classList.contains("on"))closeSheet();else if(appEl.classList.contains("on")){if(appMenu.classList.contains("open"))setAppMenu(false);else closeApp();}else setMenu(false);}});

/* ---------- data ---------- */
let circles=[],cur=null,curId=null,seen=null,busy=false;
function seenInit(){ seen=new Set((ME&&ME.notes||[]).map(n=>n.id)); }
async function refresh(manual){
  if(!ME||busy) return; busy=true;
  try{
    ME=await api("/api/me"); circles=await api("/api/circles");
    if(curId) cur=circles.find(c=>c.id===curId)||cur;
    (ME.notes||[]).forEach(n=>{ if(seen&&!seen.has(n.id)){ seen.add(n.id); if(/Payout received|Holdback released|Deposit returned/.test(n.title)) toast(n.title+": "+n.text); } });
    if(appEl.classList.contains("on")){ if(page==="portfolio")renderPortfolio(); if(page==="circle")renderCircle(); }
    if(manual) toast("Up to date");
  }catch(e){ if(manual) toast(e.message); }
  busy=false;
}
setInterval(()=>{ if(ME&&!document.hidden&&appEl.classList.contains("on")&&!$("#sheet").classList.contains("on")) refresh(); },5000);

/* ---------- portfolio ---------- */
const money=n=>fmt(n);
function circleRow(c){
  const tag=c.status==="filling"?"Filling up":c.status==="deposits"?"Deposits":c.status==="completed"?"Finished":"Round "+c.round+" of "+c.maxMembers;
  return '<li class="li" data-circle="'+c.id+'" style="cursor:pointer"><span>'+esc(c.name)+'<small>'+(c.goal&&GOAL_LABEL[c.goal]?GOAL_LABEL[c.goal]+', ':'')+money(c.amount)+' '+CYC[c.cycleDays]+', '+c.members.length+'/'+c.maxMembers+' members</small></span><span class="tags"><span class="ctag '+(c.status==="active"?"next":"wait")+'">'+tag+'</span></span></li>';
}
function renderPortfolio(){
  if(!ME) return;
  $("#pfBal").textContent=money(ME.wallet); renderMandate(); renderWallet();
  $("#pfNote").textContent=ME.wallet>0?"Ready to send to your bank.":"Fund it from your Paga account number. Payouts land here too.";
  $("#pfWithdraw").disabled=!(ME.wallet>=100);
  $("#circlesBody").innerHTML=circles.length?'<ul style="padding:0">'+circles.map(circleRow).join("")+'</ul>':'<p class="empty">No circles yet. Start one or join with an invite link.</p>';
  // next payout: the receiver amount for the next circle where this user has not been paid yet
  let next=0,note="Paid to your balance once everyone has paid.";
  for(const c of circles){
    const me=c.members.find(m=>m.you); if(!me||c.status==="completed") continue;
    const N=c.maxMembers,pot=c.amount*N,fee=Math.floor(pot*FEE); let hb;
    if(c.status==="active"&&c.receiver===me.name&&c.members[c.round-1].you){ next=c.receiverNet; note=esc(c.name)+": it is your turn now."; break; }
    if(c.status==="active"&&me.slot<c.round) continue;
    hb=Math.floor(c.amount*(N-me.slot)*me.tierPct/100); const est=pot-fee-hb;
    if(!next||est>next){ next=est; note=esc(c.name)+", round "+me.slot+". Holdback "+me.tierPct+"% of what you still owe."; }
  }
  $("#pfNext").textContent=money(next); $("#pfNextNote").innerHTML=note;
  renderHome();
  const notes=ME.notes||[];
  $("#noteBody").innerHTML=notes.length?notes.slice(0,6).map(n=>'<div class="nrow '+(n.read?"":"new")+'" '+(n.receipt?' data-rc="'+n.receipt+'"':'')+'><b>'+esc(n.title)+'</b><small>'+esc(n.text)+' '+ago(n.at)+'</small></div>').join(""):'<p class="empty">Nothing yet. You will see payments and payouts here.</p>';
  const rcs=ME.receipts||[];
  $("#rcBody").innerHTML=rcs.length?rcs.slice(0,8).map(r=>'<div class="nrow" data-rc="'+r.id+'"><div class="row"><b>'+esc(r.title)+'</b><span>'+(r.amount!=null?money(r.amount):"")+'</span></div><small>'+(r.circleName?esc(r.circleName)+", ":"")+ago(r.at)+'</small></div>').join(""):'<p class="empty">Receipts for every payment and transfer will show here.</p>';
  const aj=ME.ajo||{score:null,level:"New",onTime:0,late:0};
  $("#recScore").textContent=aj.score==null?"New":aj.score+" · "+aj.level;
  $("#recScoreNote").textContent=aj.score==null?"Builds as you pay on time":aj.onTime+" on time, "+aj.late+" late";
  $("#recFin").textContent=ME.finished; $("#recDef").textContent=ME.defaults; $("#recHb").textContent=ME.tier.pct+"%";
  $("#acctBody").innerHTML='<ul style="padding:0"><li class="li"><span>Name<small>'+esc(ME.name||"-")+'</small></span></li><li class="li"><span>Email<small>'+esc(ME.email&&!ME.email.startsWith("demo:")?ME.email:"-")+'</small></span></li><li class="li"><span>Phone<small>'+esc(ME.phone||"-")+'</small></span></li><li class="li"><span>Bank<small>'+(ME.bank?esc(ME.bank.name)+" ending "+esc(ME.bank.account.slice(-4)):"Not added yet")+'</small></span><button class="pill outline sm" id="editBank" style="padding:8px 14px;font-size:14px">'+(ME.bank?"Change":"Add")+'</button></li><li class="li"><span>Appearance</span><div class="themeseg" id="themeSeg">'+["light","dark","auto"].map(t=>'<button data-t="'+t+'" aria-pressed="'+(themePref()===t)+'">'+t[0].toUpperCase()+t.slice(1)+'</button>').join("")+'</div></li><li class="li"><span>Chat connector<small>'+(ME.connector?"On. Claude can read your circles.":"Let Claude read your circles and prepare payments you approve.")+'</small></span><button class="pill outline sm" id="connBtn" style="width:auto;padding:9px 16px">'+(ME.connector?"Manage":"Set up")+'</button></li></ul>';
  $("#connBtn").onclick=connectorSheet;
  $$("#themeSeg button").forEach(b=>b.onclick=()=>{ setTheme(b.dataset.t); $$("#themeSeg button").forEach(x=>x.setAttribute("aria-pressed",x===b)); });
  const eb=$("#editBank"); if(eb) eb.onclick=()=>bankSheet();
  if(ME.notes&&ME.notes.some(n=>!n.read)&&page==="portfolio") api("/api/me/read",{body:{}}).then(m=>{ME.notes=m.notes.map(n=>({...n,read:false}));}).catch(()=>{});
}
/* ---------- proof on Solana: each payment and payout is also written to Solana devnet, where nobody can edit it ---------- */
function proofCard(c){
  const p=c.proof; if(!p||!p.total) return "";
  const names={started:"Circle started",payment:"Payment",payout:"Payout",missed:"Missed payment",completed:"Circle completed"};
  const rows=p.last.map(e=>{
    const tag=e.sig?'<a href="https://explorer.solana.com/tx/'+encodeURIComponent(e.sig)+'?cluster=devnet" style="text-decoration:underline" target="_blank" rel="noopener">'+(e.ok?"Confirmed":"Sent")+'</a>':"<span>"+(p.live?"Pending":"Saved")+"</span>";
    return '<li class="li" style="font-size:14px"><span>'+(names[e.kind]||esc(e.kind))+(e.round?", round "+e.round:"")+'<small>'+ago(e.at)+" · "+esc(e.hash)+'</small></span><span class="tags">'+tag+"</span></li>"; }).join("");
  return '<div class="pcard" style="margin:12px 0 0"><div class="pb"><h5>Proof on Solana</h5><p style="font-size:13px">Every payment and payout is also recorded on Solana (test network), where nobody can change it. '+p.confirmed+" of "+p.total+" confirmed"+(p.valid?"":". Record check failed")+'.</p><ul style="padding:0">'+rows+'</ul><p style="font-size:13px;margin-top:8px"><a href="/api/proof/'+esc(c.id)+'" style="text-decoration:underline" target="_blank" rel="noopener">View the full record</a></p></div></div>'; }

function ago(t){const s=Math.floor((Date.now()-t)/1000); if(s<60)return"just now"; if(s<3600)return Math.floor(s/60)+" min ago"; if(s<86400)return Math.floor(s/3600)+" h ago"; return new Date(t).toLocaleDateString([],{day:"numeric",month:"short"});}
$("#circlesBody").addEventListener("click",e=>{const r=e.target.closest("[data-circle]"); if(r) openCircle(r.dataset.circle);});
document.addEventListener("click",e=>{ const r=e.target.closest("[data-rc]"); if(r&&appEl.contains(r)) receiptSheet(r.dataset.rc); });

function receiptSheet(id){
  const r=(ME.receipts||[]).find(x=>x.id===id); if(!r) return;
  const rows=[["Receipt",r.id],["Date",new Date(r.at).toLocaleString()],r.circleName&&["Circle",r.circleName],r.amount!=null&&["Amount",money(r.amount)],["Reference",r.reference||r.id],["Status",r.status]].filter(Boolean);
  sheet('<h2>'+esc(r.title)+'</h2><p class="alede">'+esc(r.summary)+'</p><div class="card">'+rows.map((x,i)=>'<div class="row" style="'+(i?"margin-top:10px":"")+'"><span>'+esc(x[0])+'</span><b style="word-break:break-all;text-align:right">'+esc(x[1])+'</b></div>').join("")+'</div>'+(rcCanShare()?'<button class="pill block abtn" id="rcShare">Share receipt</button><button class="pill outline block abtn" id="rcImg">Save as image</button>':'<button class="pill block abtn" id="rcImg">Save as image</button>')+'<button class="pill outline block abtn" id="rcPdf">Save as PDF</button><button class="pill outline block abtn" data-close>Done</button>',
   ()=>{ if($("#rcShare")) $("#rcShare").onclick=()=>rcSave(r,"share"); $("#rcImg").onclick=()=>rcSave(r,"image"); $("#rcPdf").onclick=()=>rcSave(r,"pdf"); });
}

async function bankSheet(then){
  let BANKS=[]; try{ BANKS=(await api("/api/banks")).map(b=>[b.id,b.name]); }catch(e){ return toast(e.message); }
  sheet('<h2>Bank account</h2><p class="alede">Payouts you send out go to this account through Paga.</p>'+
    '<label for="bBank" style="margin-top:6px">Bank</label><select id="bBank">'+BANKS.map(b=>'<option value="'+b[0]+'"'+(ME.bank&&ME.bank.code===b[0]?" selected":"")+'>'+b[1]+'</option>').join("")+'</select>'+
    '<label for="bAcc">Account number</label><input id="bAcc" inputmode="numeric" maxlength="10" placeholder="10 digits" value="'+(ME.bank?esc(ME.bank.account):"")+'">'+
    '<div id="bErr" style="color:var(--bad);font-size:14px;margin-top:10px"></div><button class="pill block abtn" id="bSave">Save account</button><button class="pill outline block abtn" data-close>Cancel</button>',
  ()=>{ $("#bSave").onclick=async()=>{
    const sel=$("#bBank"); try{
      ME=await api("/api/me",{body:{bank:{code:sel.value,name:sel.options[sel.selectedIndex].text,account:$("#bAcc").value.trim()}}}); closeSheet(); renderPortfolio(); toast("Bank account saved"); if(then) then();
    }catch(e){ $("#bErr").textContent=e.message; } }; });
}
const PLANE='<svg class="wdplane" viewBox="0 0 120 100" aria-hidden="true"><path d="M8 52 112 6 80 94 58 62z" fill="#1FA85F"/><path d="M58 62 112 6 66 70z" fill="#0E6B3A"/><path d="M58 62 66 70 60 90z" fill="#0A0C0E"/><path d="M4 70h18M12 82h14M2 58h12" stroke="#1FA85F" stroke-width="3" stroke-linecap="round" class="wdlines"/></svg>';
const BADGE='<svg class="wdbadge" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6l11 8 13-2 6 12 12 6-2 13 8 11-8 11 2 13-12 6-6 12-13-2-11 8-11-8-13 2-6-12-12-6 2-13-8-11 8-11-2-13 12-6 6-12 13 2z" fill="#1FA85F" transform="translate(2 4)" opacity=".28"/><path d="M50 4l11 8 13-2 6 12 12 6-2 13 8 11-8 11 2 13-12 6-6 12-13-2-11 8-11-8-13 2-6-12-12-6 2-13-8-11 8-11-2-13 12-6 6-12 13 2z" fill="#1FA85F"/><path d="M30 52l14 14 27-30" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
$("#pfWithdraw").onclick=()=>{
  if(!ME.bank) return bankSheet(()=>$("#pfWithdraw").click());
  const chips=[500,1000,2000,5000,10000,20000].filter(v=>v<=ME.wallet);
  sheet('<h2>Transfer to bank</h2><p class="alede">Sent through '+PG+'Paga to '+esc(ME.bank.name)+' ending '+esc(ME.bank.account.slice(-4))+'.</p><div class="card"><div class="row"><span>Available</span><b>'+money(ME.wallet)+'</b></div></div>'+
    '<label for="wAmt" style="margin-top:0">Enter amount (₦)</label><input id="wAmt" type="number" inputmode="numeric" value="'+ME.wallet+'" min="100" max="'+ME.wallet+'">'+
    (chips.length?'<div class="amtchips">'+chips.map(v=>'<button type="button" data-v="'+v+'">'+money(v)+'</button>').join("")+'</div>':'')+
    '<div id="wErr2" style="color:var(--bad);font-size:14px;margin-top:10px"></div><button class="pill block abtn" id="wGo">Send to my bank</button><button class="pill outline block abtn" data-close>Cancel</button>',
  ()=>{ $$(".amtchips button").forEach(b=>b.onclick=()=>{ $("#wAmt").value=b.dataset.v; });
    $("#wGo").onclick=async()=>{ const amt=+$("#wAmt").value; if(!(amt>=100)) return $("#wErr2").textContent="Minimum transfer is ₦100";
    if(amt>ME.wallet) return $("#wErr2").textContent="That is more than your balance";
    const otp=await askOtp("withdraw"); if(!otp) return;
    sheet('<div class="wdview">'+PLANE+'<h3>Processing...</h3><p>Your transfer is processing</p></div>');
    const t0=Date.now();
    try{
      const m=await api("/api/withdraw",{body:{amount:amt,otp}});
      const wait=Math.max(0,1600-(Date.now()-t0)); await new Promise(r=>setTimeout(r,wait));
      ME=m; renderPortfolio(); seenSync();
      sheet('<div class="wdview">'+BADGE+'<h3>Success!</h3><p>'+money(amt)+' is on its way to your bank. Your receipt is saved.</p><button class="pill block abtn wdok" id="wdDone">Nice one!</button></div>',()=>{ $("#wdDone").onclick=closeSheet; });
    }catch(e){
      sheet('<div class="wdview"><h3>Transfer did not go through</h3><p>'+esc(e.message)+'</p><button class="pill block abtn" id="wdRetry">Try again</button><button class="pill outline block abtn" data-close>Close</button></div>',()=>{ $("#wdRetry").onclick=()=>$("#pfWithdraw").click(); });
    } }; });
};
// Ask for a 6-digit code sent to the user's email. Resolves with the code, or null if cancelled.
function askOtp(purpose){
  return new Promise(async res=>{
    let r; try{ r=await api("/api/otp/send",{body:{purpose}}); }catch(e){ toast(e.message); return res(null); }
    const where=r.sent?"We emailed a 6-digit code to <b>"+esc(r.email)+"</b>.":"Test mode: your code is <b>"+esc(r.testCode||"")+"</b>.";
    sheet('<h2>Enter your code</h2><p class="alede">'+where+' It expires in 10 minutes. If you do not see it, check Spam.</p><input id="oCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" style="letter-spacing:6px;font-size:22px;text-align:center"><div id="oErr" style="color:var(--bad);font-size:14px;margin-top:10px"></div><button class="pill block abtn" id="oGo">Confirm</button><button class="pill outline block abtn" id="oCancel">Cancel</button>',()=>{
      const inp=$("#oCode"); inp.focus();
      const go=()=>{ const v=inp.value.trim(); if(!/^\d{6}$/.test(v)) return $("#oErr").textContent="Enter the 6 digits"; closeSheet(); res(v); };
      $("#oGo").onclick=go; inp.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); }); $("#oCancel").onclick=()=>{ closeSheet(); res(null); };
    });
  });
}
function seenSync(){ (ME.notes||[]).forEach(n=>seen&&seen.add(n.id)); }

/* ---------- create ---------- */
const draft={size:5,cycle:7,goal:null};
const sizeSeg=seg($("#sizeSeg"),[3,4,5,6,8,10].map(n=>({v:n,l:String(n)})),()=>draft.size,v=>{draft.size=+v;renderSum();});
const cycSeg=seg($("#cycSeg"),[{v:7,l:"Weekly"},{v:14,l:"2 weeks"},{v:30,l:"Monthly"}],()=>draft.cycle,v=>{draft.cycle=+v;renderSum();});
/* goal templates: one tap fills the form. The amounts are only suggestions. */
const GOALS=[
 {id:"rent",label:"Rent",name:"Rent Circle",amount:20000,size:6,cycle:30,hint:"Monthly rounds, so each person gets a big lump sum toward rent."},
 {id:"school",label:"School fees",name:"School Fees Circle",amount:10000,size:5,cycle:30,hint:"Monthly rounds, so each person has fees ready when a term starts."},
 {id:"detty",label:"Detty December",name:"Detty December",amount:5000,size:5,cycle:7,hint:"Five weekly rounds, so everyone gets a pot before the December rush."},
 {id:"business",label:"Business stock",name:"Business Stock Circle",amount:10000,size:5,cycle:14,hint:"Every 2 weeks, to restock or buy equipment."},
 {id:"owambe",label:"Owambe and events",name:"Owambe Fund",amount:5000,size:6,cycle:14,hint:"Every 2 weeks, for aso ebi, gifts and event costs."},
 {id:"emergency",label:"Emergency fund",name:"Emergency Fund",amount:3000,size:5,cycle:7,hint:"Small weekly amounts, so a pot is ready when life happens."}
];
const GOAL_LABEL=Object.fromEntries(GOALS.map(g=>[g.id,g.label]));
function renderGoals(){
  $("#tplRow").innerHTML=GOALS.map(g=>'<button type="button" class="tpl" data-g="'+g.id+'" aria-pressed="'+(draft.goal===g.id)+'">'+g.label+'</button>').join("");
  const g=GOALS.find(x=>x.id===draft.goal);
  $("#tplNote").textContent=g?g.hint+" The amount is only a suggestion, so change anything you like.":"Pick a goal to fill in the details, or set your own below.";
}
$("#tplRow").addEventListener("click",e=>{
  const b=e.target.closest("button[data-g]"); if(!b) return;
  if(draft.goal===b.dataset.g){ draft.goal=null; renderGoals(); return; }          // tap again to clear
  const g=GOALS.find(x=>x.id===b.dataset.g); draft.goal=g.id;
  $("#cName").value=g.name; $("#cAmt").value=g.amount; draft.size=g.size; draft.cycle=g.cycle;
  sizeSeg.render(); cycSeg.render(); renderSum(); renderGoals();
});
renderGoals();
$("#cAmt").addEventListener("input",renderSum);
function renderSum(){
  const a=Math.max(0,+$("#cAmt").value||0),pot=a*draft.size,fee=Math.floor(pot*FEE);
  $("#sum").innerHTML=draft.size+' members pay '+money(a)+' '+CYC[draft.cycle]+'. The pot is '+money(pot)+'. A '+money(fee)+' fee is taken at each payout. Each member pays a '+money(a)+' deposit first, returned at the end. The circle starts when every seat is taken, in the order people join, so you receive first.';
}
$("#createBtn").onclick=async()=>{
  const b=$("#createBtn"); b.disabled=true;
  try{ const c=await api("/api/circles",{body:{name:$("#cName").value,amount:+$("#cAmt").value,maxMembers:draft.size,cycleDays:draft.cycle,goal:draft.goal||undefined}}); draft.goal=null; renderGoals(); await refresh(); openCircle(c.id); toast("Circle created. Share the invite link."); }
  catch(e){ toast(e.message); } b.disabled=false;
};

/* ---------- join ---------- */
function codeOf(v){ v=v.trim(); const m=v.match(/join=(\w+)/); return m?m[1]:v; }
let jid=null;
async function lookup(){
  const code=codeOf($("#jCode").value); if(!code) return toast("Paste an invite link or code");
  try{
    const c=await api("/api/preview/"+code); jid=c.id; const pot=c.amount*c.maxMembers;
    $("#jTitle").textContent="You're invited"; $("#jLede").textContent="Check the rules, then join.";
    $("#jFind").style.display="none"; const el=$("#jCard"); el.style.display="block";
    const full=c.status!=="filling", mine=circles.some(x=>x.id===c.id);
    el.innerHTML='<div class="card"><div class="big">'+esc(c.name)+'</div><div class="muted" style="margin-top:6px">'+(c.goal&&GOAL_LABEL[c.goal]?esc(GOAL_LABEL[c.goal])+', ':'')+c.maxMembers+' members, '+CYC[c.cycleDays]+', invite only</div><hr style="border:0;border-top:1px solid #262B30;margin:14px 0">'+
      '<div class="row"><span>You pay each round</span><b>'+money(c.amount)+'</b></div><div class="row" style="margin-top:10px"><span>Pot per round</span><b>'+money(pot)+'</b></div><div class="row" style="margin-top:10px"><span>Upfront deposit</span><b>'+money(c.amount)+'</b></div><div class="row" style="margin-top:10px"><span>Holdback when you receive</span><b>'+ME.tier.pct+'% of what you owe</b></div><div class="row" style="margin-top:10px"><span>Seats taken</span><b>'+c.joined+'/'+c.maxMembers+'</b></div></div>'+
      '<div class="summary" style="margin-top:0">You put down a '+money(c.amount)+' deposit before round 1. When you receive the pot, part of what you still owe is held back and released as you keep paying. Both come back if you never default.</div>'+
      (mine?'<button class="pill block abtn" id="jOpen">Open this circle</button>':full?'<p class="note">This circle is already full.</p>':'<button class="pill block abtn" id="jGo">Join this circle</button>');
    const g=$("#jGo"); if(g) g.onclick=async()=>{ g.disabled=true; try{ await api("/api/circles/"+jid+"/join",{body:{}}); await refresh(); openCircle(jid); toast("You joined "+c.name); }catch(e){ toast(e.message); g.disabled=false; } };
    const o=$("#jOpen"); if(o) o.onclick=()=>openCircle(jid);
  }catch(e){ toast(e.message==="circle not found"?"No circle with that code":e.message); }
}
$("#jLook").onclick=lookup;

/* ---------- circle ---------- */
let cTab="pay";
const cTabSeg=seg($("#cTabs"),[{v:"pay",l:"Pay"},{v:"members",l:"Members"},{v:"payouts",l:"Payouts"},{v:"protect",l:"Protection"}],()=>cTab,v=>{cTab=v;renderPanel();},"tabs");
function orbitState(c){
  if(!c) return {size:5,members:[],paid:new Set(),late:new Set(),round:1,active:false,done:false,amt:0,empty:true};
  const paid=new Set(),late=new Set(); c.members.forEach((m,i)=>{ if(m.paid) paid.add(i); else if(c.canSettle) late.add(i); });
  return {size:c.maxMembers,members:c.members.map(m=>m.name),paid,late,round:c.round,active:c.status==="active",done:c.status==="completed",amt:c.amount};
}
new Orbit($("#appCanvas"),()=>orbitState(cur),()=>appEl.classList.contains("on")&&page==="circle");
async function openCircle(id){ curId=id; cur=circles.find(c=>c.id===id)||await api("/api/circles/"+id); if(!circles.find(c=>c.id===id)) circles.push(cur); showPage("circle"); }
function fmtDur(ms){ if(ms<0)ms=0; const s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),x=s%60,p=v=>String(v).padStart(2,"0"); return(d>0?d+"d ":"")+p(h)+"h "+p(m)+"m "+p(x)+"s"; }
const fmtDate=ms=>new Date(ms).toLocaleString([],{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});
let skew=0;
function renderTimer(){
  const el=$("#cTimer"),c=cur; if(!c){el.style.display="none";return;}
  el.style.display="block"; el.className="timer";
  if(c.status==="filling"){ el.innerHTML='<div class="tl">Countdown</div><div class="tv">Not started</div><div class="ts">The circle starts when every seat is taken. Then everyone pays a deposit, and round 1 opens.</div>'; return; }
  if(c.status==="deposits"){ el.innerHTML='<div class="tl">Deposits</div><div class="tv">Waiting for deposits</div><div class="ts">'+c.members.filter(m=>m.deposit).length+' of '+c.members.length+' deposits paid. Round 1 opens when all are in.</div>'; return; }
  if(c.status==="completed"){ el.innerHTML='<div class="tl">Countdown</div><div class="tv">Complete</div><div class="ts">All '+c.maxMembers+' payouts are done.</div>'; return; }
  const now=c.now+(Date.now()-fetchedAt), dl=c.deadline, ge=c.graceEnd;
  if(now<dl){
    if(c.round===1){ el.innerHTML='<div class="tl">Round 1 of '+c.maxMembers+'</div><div class="tv">'+fmtDur(dl-now)+'</div><div class="ts">'+c.members.filter(m=>m.paid).length+' of '+c.members.length+' have paid. The first payout runs as soon as everyone has paid. Funding window ends '+fmtDate(dl)+'.</div>'; return; }
    const left=dl-now,pct=Math.min(100,Math.max(0,(1-left/(c.cycleDays*DAY))*100)); if(left<DAY/2) el.classList.add("warn");
    el.innerHTML='<div class="tl">Round '+c.round+' of '+c.maxMembers+', deadline in</div><div class="tv">'+fmtDur(left)+'</div><div class="ts">Deadline: '+fmtDate(dl)+'</div><div class="bar"><i style="width:'+pct.toFixed(1)+'%"></i></div>'; return;
  }
  el.classList.add("warn");
  el.innerHTML=now<ge?'<div class="tl">Grace period</div><div class="tv">'+fmtDur(ge-now)+'</div><div class="ts">Anyone who has not paid can still pay. After this, anyone can run settlement.</div>':'<div class="tl">'+(c.round===1?"Funding window ended":"Grace period ended")+'</div><div class="tv">Settlement open</div><div class="ts">Anyone in the circle can run settlement for members who have not paid.</div>';
}
let fetchedAt=Date.now();
setInterval(()=>{ if(appEl.classList.contains("on")&&page==="circle") renderTimer(); },1000);
function renderCircle(){
  const c=cur; fetchedAt=Date.now();
  $("#cTitle").textContent=c?c.name:"Circle";
  $("#cKicker").textContent=c?"Circle"+(c.goal&&GOAL_LABEL[c.goal]?" · "+GOAL_LABEL[c.goal]:""):"Circle";
  { const bb=$("#cBars"); if(!c){ bb.innerHTML=""; } else { const N=c.maxMembers,cr=c.status==="active"?c.round:c.status==="completed"?N+1:0; bb.style.gridTemplateColumns="repeat("+N+",minmax(0,1fr))"; bb.innerHTML=Array.from({length:N},(_,i)=>'<i class="'+(i<cr-1?"done":i===cr-1?"now":"")+'"></i>').join(""); } }
  $("#cStatus").textContent=!c?"Empty":c.status==="filling"?"Filling up":c.status==="deposits"?"Deposits":c.status==="completed"?"Finished":"Round "+c.round+" of "+c.maxMembers;
  let l="Start or join a circle, then come back here to watch it.";
  if(c){ const left=c.maxMembers-c.members.length;
    if(c.status==="filling") l=left+" seat"+(left===1?"":"s")+" still open. The circle starts when every seat is taken, so nobody pays into an empty group.";
    else if(c.status==="deposits") l="All seats are taken. Everyone pays a "+money(c.amount)+" deposit to start. It comes back at the end.";
    else if(c.status==="completed") l="Everyone has been paid. Deposits went back to members who did not default. This circle is complete.";
    else if(c.canSettle) l="Someone has not paid. Anyone can run settlement now.";
    else l=(c.members[c.round-1].you?"It is your turn to receive ":esc(c.receiver)+" receives ")+money(c.receiverNet)+" this round, once everyone has paid."; }
  $("#cLede").innerHTML=l; cTabSeg.render(); renderPanel(); renderTimer();
}
function renderPanel(){
  const c=cur,el=$("#cPanel");
  if(!c){ el.innerHTML='<div class="card center"><div class="muted" style="font-size:15px">No circle yet. Start one and invite people you trust.</div></div><button class="pill block abtn" data-page="create">Start a circle</button>'; return; }
  const n=c.maxMembers,pot=c.amount*n,me=c.members.find(m=>m.you),paidN=c.members.filter(m=>m.paid).length;
  if(cTab==="pay"){
    let h='<div class="tiles"><div class="tile"><div class="k">'+(c.status==="active"?"Pot this round":"Pot per round")+'</div><div class="v">'+short(pot)+'</div></div><div class="tile"><div class="k">'+(c.status==="active"?"Paid":"Seats")+'</div><div class="v">'+(c.status==="active"?paidN+"/"+n:c.members.length+"/"+n)+'</div></div><div class="tile"><div class="k">Receives</div><div class="v">'+esc(c.status==="active"?c.receiver:"-")+'</div></div></div>';
    if(c.status==="filling") h+='<button class="pill block abtn" id="waBtn">Share on WhatsApp</button><button class="pill outline block abtn" id="shareBtn">Copy private invite link</button>'+(MOCK?'<button class="pill outline block abtn" id="fillBtn">Demo: fill the seats</button>':"");
    else if(c.status==="deposits"){ h+='<button class="pill block abtn" id="depBtn" '+(me.deposit?"disabled":"")+'>'+(me.deposit?"Your deposit is paid":"Pay "+money(c.amount)+" deposit")+'</button>'+(MOCK?'<button class="pill outline block abtn sm" id="othersBtn">Demo: others pay</button>':""); }
    else if(c.status==="completed") h+='<button class="pill block abtn" data-page="create">Start a new circle</button>';
    else {
      h+='<button class="pill block abtn" id="payBtn" '+(me.paid?"disabled":"")+'>'+(me.paid?"You have paid this round":"Pay "+money(c.amount))+'</button>';
      if(c.members.some(m=>!m.paid)) h+='<button class="pill block abtn" id="settleBtn" '+(c.canSettle?"":"disabled")+' style="background:var(--pillgreen);color:var(--mint)">'+(c.canSettle?"Run settlement (anyone can)":"Settlement opens after the grace period")+'</button>';
      h+='<button class="pill outline block abtn sm" id="nudgeBtn">Nudge unpaid members on WhatsApp</button>';
      if(MOCK){ h+='<button class="pill outline block abtn sm" id="othersBtn">Demo: others pay</button>';
        const t=c.members.find(m=>!m.you&&!m.paid&&m.slot!==c.round); if(t&&c.round===1&&n>=4) h+='<button class="pill outline block abtn sm" id="missBtn">Demo: '+esc(t.name)+' will not pay this round</button>';
        h+='<button class="pill outline block abtn sm" id="skipBtn">Demo: skip past the deadline and grace</button>'; }
    }
    if(me&&(c.status==="deposits"||c.status==="active")) h+='<div class="card" style="margin-top:12px"><div class="row"><span><b>Auto-pay</b><br><span class="muted" style="font-size:13px">'+PG+'Paga pulls from your balance when a payment is due</span></span><button class="pill sm abtn" id="autoBtn" style="'+(me.auto?"":"background:transparent;border:1px solid var(--line);color:inherit")+'">'+(me.auto?"On":"Off")+'</button></div></div>';
    el.innerHTML=h; bindPay();
  } else if(cTab==="members"){
    el.innerHTML='<div class="pcard" style="margin:0"><div class="pb" style="padding:8px 22px"><ul style="padding:0">'+c.members.map(m=>{
      let tags=""; if(c.status==="active"){ tags+=m.paid?'<span class="ctag paid">Paid</span>':'<span class="ctag wait">Waiting</span>'; if(m.slot===c.round) tags='<span class="ctag next">Receives</span>'+tags; }
      if(m.defaulted) tags+='<span class="ctag late">Default mark</span>'; else if(c.status==="deposits"&&m.deposit) tags+='<span class="ctag paid">Deposit in</span>';
      return '<li class="li"><span>'+m.slot+'. '+esc(m.name)+(m.you?" (you)":"")+'<small>'+(m.ajoLevel&&m.ajoLevel!=="New"?esc(m.ajoLevel)+" · ":"")+esc(m.tierLabel)+', holdback '+m.tierPct+'%</small></span><span class="tags">'+tags+'</span></li>'; }).join("")+'</ul></div></div>';
  } else if(cTab==="payouts"){
    const fee=Math.floor(pot*FEE); let rows="";
    for(let q=1;q<=n;q++){ const m=c.members[q-1],done=c.status==="completed"||(c.status==="active"&&q<c.round),now=c.status==="active"&&q===c.round;
      const hb=m?Math.floor(c.amount*(n-q)*m.tierPct/100):0, net=now?c.receiverNet:pot-fee-hb;
      rows+='<li class="li"><span>Round '+q+'<small>'+(m?esc(m.name)+", holdback "+m.tierPct+"%":"Open seat")+'</small></span><span class="tags"><b style="font-weight:500;margin-right:8px">'+money(net)+'</b>'+(done?'<span class="ctag paid">Paid out</span>':now?'<span class="ctag next">Up now</span>':'<span class="ctag wait">Waiting</span>')+'</span></li>'; }
    el.innerHTML='<p class="muted" style="margin:0 0 10px">A 1% fee ('+money(fee)+') is taken from each payout. A holdback is also kept back and released as the receiver keeps paying. Payouts land in the receiver\'s AjoLabs balance.</p><div class="pcard" style="margin:0"><div class="pb" style="padding:8px 22px"><ul style="padding:0">'+rows+'</ul></div></div>';
  } else {
    const locked=c.members.reduce((x,m)=>x+m.deposit+m.hb,0);
    el.innerHTML='<div class="pcard" style="margin:0"><div class="pb"><h5>'+money(locked)+' protecting this circle</h5><p>Every member put down a deposit. When someone receives the pot, a holdback is kept and released as they keep paying. If someone stops paying, settlement uses the holdback first, then the deposit, then the default pool.</p></div><div class="pb" style="padding-top:0"><ul style="padding:0">'+
      c.members.map(m=>'<li class="li"><span>'+esc(m.name)+'<small>Deposit '+money(m.deposit)+', holdback '+money(m.hb)+'</small></span><span class="tags">'+(m.defaulted?'<span class="ctag late">Default mark</span>':c.status==="completed"?'<span class="ctag paid">Returned</span>':'<span class="ctag wait">Locked</span>')+'</span></li>').join("")+
      '</ul></div></div><div class="pcard" style="margin:12px 0 0"><div class="pb"><h5>Default pool: '+money(c.pool)+'</h5><p>Funded by 25% of payout fees. It covers any gap left after a member\'s holdback and deposit. If it runs short, that round\'s payout is reduced.</p></div></div>'+
      proofCard(c)+'<div class="pcard" style="margin:12px 0 0"><div class="pb"><h5>Activity</h5><ul style="padding:0">'+c.ledger.slice(-8).reverse().map(l=>'<li class="li" style="font-size:14px"><span>'+esc(l.text)+'<small>'+ago(l.at)+'</small></span></li>').join("")+'</ul></div></div>';
  }
}
let MOCK=false;
async function act(fn,msg){ try{ await fn(); await refresh(); if(msg) toast(msg); renderCircle(); }catch(e){ toast(e.message); } }
function bindPay(){
  const c=cur,B=id=>$("#"+id);
  if(B("waBtn")) B("waBtn").onclick=()=>{ const u=location.origin+"/?join="+c.id; const m='Join my Ajo circle "'+c.name+'" on AjoLabs. Private and protected, with payments through Paga: '+u; window.open("https://wa.me/?text="+encodeURIComponent(m),"_blank","noopener"); };
  if(B("shareBtn")) B("shareBtn").onclick=()=>{ const u=location.origin+"/?join="+c.id; (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(u):Promise.reject()).then(()=>toast("Invite link copied. Only people with it can join."),()=>sheet('<h2>Invite link</h2><p class="alede">Copy this link and send it.</p><div class="card" style="word-break:break-all">'+esc(u)+'</div><button class="pill block abtn" data-close>Done</button>')); };
  if(B("fillBtn")) B("fillBtn").onclick=()=>act(()=>api("/api/dev/fill",{body:{id:c.id}}),"Sample members joined");
  if(B("depBtn")) B("depBtn").onclick=()=>pay("deposit");
  if(B("payBtn")) B("payBtn").onclick=()=>pay("pay");
  if(B("nudgeBtn")) B("nudgeBtn").onclick=()=>{ const who=c.members.filter(m=>!m.paid).map(m=>m.name).join(", "); const d=new Date(c.deadline).toLocaleString("en-NG",{weekday:"short",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}); const msg='Reminder for our Ajo circle "'+c.name+'" on AjoLabs. Round '+c.round+' is waiting on: '+who+'. Deadline: '+d+'. Pay here: '+location.origin+"/?join="+c.id; window.open("https://wa.me/?text="+encodeURIComponent(msg),"_blank","noopener"); };
  if(B("autoBtn")) B("autoBtn").onclick=()=>act(async()=>{ const me=c.members.find(m=>m.you); const r=await api("/api/circles/"+c.id+"/autopay",{body:{on:!me.auto}}); try{ME=await api("/api/me");}catch(e){} return r; },"Auto-pay updated");
  if(B("othersBtn")) B("othersBtn").onclick=()=>act(()=>api("/api/dev/pay-others",{body:{id:c.id}}),"Others have paid");
  if(B("missBtn")) B("missBtn").onclick=()=>{ const t=c.members.find(m=>!m.you&&!m.paid&&m.slot!==c.round); act(()=>api("/api/dev/pay-others",{body:{id:c.id,except:t.slot}}),t.name+" has not paid"); };
  if(B("skipBtn")) B("skipBtn").onclick=()=>act(()=>api("/api/dev/skip-time",{body:{id:c.id}}),"Clock moved past the deadline and grace");
  if(B("settleBtn")) B("settleBtn").onclick=()=>act(()=>api("/api/circles/"+c.id+"/settle",{body:{}}),"Settlement ran. Default mark added.");
}
function wireDemo(){
  const d=$("#fDemo"); if(d) d.onclick=async()=>{ try{ ME=await api("/api/dev/simulate-fund",{body:{amount:+$("#fAmt").value}}); seenSync(); closeSheet(); renderPortfolio(); if(cur&&appEl.classList.contains("on")&&page==="circle")renderPanel(); toast("Balance funded. Receipt saved."); }catch(e){ toast(e.message); } };
}
async function checkout(){
  const b=$("#cPay"); b.disabled=true; b.textContent="Opening Paga...";
  try{ const r=await api("/api/checkout",{body:{amount:+$("#cAmt").value}}); if(r.checkoutUrl) location.href=r.checkoutUrl; else { sheet('<h2>Check your email or SMS</h2><p class="alede">Paga has sent your payment link. Open it, pay, and your balance updates here when the payment is confirmed. It can take a minute.</p><p class="alede" style="margin-top:10px">Not there? Check your spam folder.</p>'); b.disabled=false; b.textContent="Pay with Paga Checkout"; } }
  catch(e){ toast(e.message); b.disabled=false; b.textContent="Pay with Paga Checkout"; }
}
async function fundSheet(need){
  if(CONFIG.topup===undefined){ try{ const c=await (await fetch("/api/config")).json(); if(c&&c.mode){ CONFIG=c; MOCK=c.mode==="mock"; } }catch(e){} }   // the page may have loaded while the server was waking up
  let acc,accErr;
  try{ acc=(await api("/api/account",{body:{}})).account; }catch(e){ accErr=e.message; acc=null; }
  const chk='<label for="cAmt">Amount (₦)</label><input id="cAmt" type="number" inputmode="numeric" value="'+(need||5000)+'"><button class="pill block abtn" id="cPay">Pay with '+PG+'Paga Checkout</button>';
  if(!acc){ return sheet('<h2>Fund your balance</h2><p class="alede">Your Paga account number is not ready ('+esc(accErr)+'). You can still fund with checkout.</p>'+chk+(MOCK||CONFIG.topup?'<label for="fAmt">Test money (sandbox only, no real naira)</label><input id="fAmt" type="number" inputmode="numeric" value="'+(need||5000)+'"><button class="pill outline block abtn" id="fDemo">Add test money</button>':"")+(ME.sol?'<button class="pill outline block abtn" id="fWal">Fund with Solana wallet</button>':"")+'<button class="pill outline block abtn" data-close>Close</button>',()=>{ $("#cPay").onclick=checkout; wireDemo(); if($("#fWal")) $("#fWal").onclick=walletFundSheet; }); }
  sheet('<h2>Fund your balance</h2><p class="alede">'+(need?"You need "+money(need)+" more. ":"")+'Send naira from any bank app to your own '+PG+'Paga account below. It shows in your balance once Paga confirms it.</p>'+
    '<div class="card"><div class="row"><span>Account number</span><b id="fAcc" style="font-size:22px;letter-spacing:1px">'+esc(acc.number)+'</b></div><div class="row" style="margin-top:10px"><span>Bank</span><b>'+esc(acc.bank)+'</b></div><div class="row" style="margin-top:10px"><span>Account name</span><b>'+esc(acc.name)+'</b></div></div>'+
    '<button class="pill block abtn" id="fCopy">Copy account number</button>'+'<p class="alede" style="margin-top:14px">Or pay by card or transfer on Paga Checkout:</p>'+chk+
    (MOCK||CONFIG.topup?'<label for="fAmt">Test money (sandbox only, no real naira)</label><input id="fAmt" type="number" inputmode="numeric" value="'+(need||5000)+'"><button class="pill outline block abtn" id="fDemo">Add test money</button>':"")+
    (ME.sol?'<button class="pill outline block abtn" id="fWal">Fund with Solana wallet</button>':"")+
    '<button class="pill outline block abtn" data-close>Close</button>',
  ()=>{
    $("#cPay").onclick=checkout; if($("#fWal")) $("#fWal").onclick=walletFundSheet;
    $("#fCopy").onclick=()=>{ (navigator.clipboard?navigator.clipboard.writeText(acc.number):Promise.reject()).then(()=>toast("Account number copied"),()=>toast("Long-press the number to copy")); };
    wireDemo();
  });
}
$("#pfFund").onclick=()=>fundSheet();
/* ---------- Solana wallet (Phantom, devnet) ---------- */
function walletProv(){ return (window.phantom&&window.phantom.solana&&window.phantom.solana.isPhantom)?window.phantom.solana:(window.solana&&window.solana.isPhantom?window.solana:(window.braveSolana||null)); }
const usd=n=>"$"+Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
async function loadUsd(){ const box=$("#pfUsd"); if(!box) return; if(!ME||!ME.sol){ box.style.display="none"; return; } box.style.display="";
  try{ const b=await api("/api/wallet/balances"); $("#pfUsdTot").textContent=usd(b.totalUsd); $("#pfUsdDet").textContent=b.usdc.toFixed(2)+" USDC · "+b.sol.toFixed(3)+" SOL (≈"+usd(b.solUsd)+")"; }
  catch(e){ $("#pfUsdTot").textContent="—"; $("#pfUsdDet").textContent="Could not read the wallet. Tap refresh."; } }
$("#pfUsdRef").onclick=loadUsd;
const SOL_LOGO='<svg class="tk" viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="slg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945FF"/><stop offset="1" stop-color="#14F195"/></linearGradient></defs><circle cx="20" cy="20" r="20" fill="#0d0d12"/><path d="M11 25.2c.2-.2.5-.3.8-.3h18.4c.5 0 .8.6.4 1l-3.2 3.2c-.2.2-.5.3-.8.3H8.2c-.5 0-.8-.6-.4-1zM11 10.8c.2-.2.5-.3.8-.3h18.4c.5 0 .8.6.4 1l-3.2 3.2c-.2.2-.5.3-.8.3H8.2c-.5 0-.8-.6-.4-1zM27.800 17.900c-.2-.2-.5-.3-.8-.3H8.600c-.5 0-.8.6-.4 1l3.200 3.200c.2.2.5.3.8.3h18.400c.5 0 .8-.6.4-1z" fill="url(#slg)"/></svg>';
const USDC_LOGO='<svg class="tk" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="20" fill="#2775CA"/><path d="M20.600 28.600v-1.800c2.200-.3 3.600-1.500 3.600-3.300 0-2.200-1.700-2.900-4-3.500-1.500-.4-2-.7-2-1.400 0-.6.600-1.100 1.600-1.100 1.100 0 1.800.4 2.200 1.300l1.900-.9c-.6-1.200-1.700-2-3.200-2.200v-1.700h-1.900v1.700c-2 .3-3.300 1.600-3.300 3.200 0 2.100 1.600 2.800 3.900 3.400 1.700.5 2.100.8 2.100 1.500 0 .7-.7 1.200-1.800 1.200-1.300 0-2.200-.6-2.600-1.700l-2 .9c.6 1.500 1.800 2.300 3.500 2.600v1.800z" fill="#fff"/><path d="M12.200 20c0-3.700 2.400-6.900 5.800-8v-2.100c-4.500 1.200-7.800 5.200-7.800 10.100s3.300 8.900 7.800 10.100V28c-3.400-1.100-5.800-4.300-5.800-8zm15.600 0c0 3.700-2.400 6.900-5.800 8v2.100c4.500-1.200 7.800-5.200 7.800-10.100s-3.300-8.900-7.800-10.100V12c3.400 1.100 5.800 4.300 5.800 8z" fill="#fff"/></svg>';
const TOK={SOL:{logo:SOL_LOGO,name:"SOL"},USDC:{logo:USDC_LOGO,name:"USDC"}};
// Send SOL or USDC (devnet) from the connected wallet to AjoLabs. The server checks it on Solana and adds the naira to your balance.
async function solPay(cfg,token,amount,status){
  const prov=walletProv(); if(!prov) throw new Error("Open AjoLabs in your wallet browser (Phantom or Brave Wallet) to pay.");
  if(!ME.sol) throw new Error("Connect your Solana wallet first (Portfolio > Connect Solana wallet).");
  status("Approve in your wallet...");
  const W=await import("https://esm.sh/@solana/web3.js@1.95.3");
  await prov.connect(); const from=prov.publicKey||(await prov.connect()).publicKey;
  if(from.toString()!==ME.sol.address) throw new Error("Use the wallet you connected: "+ME.sol.address.slice(0,4)+"..."+ME.sol.address.slice(-4));
  const conn=new W.Connection("https://api.devnet.solana.com","confirmed"), tx=new W.Transaction(), to=new W.PublicKey(cfg.treasury);
  if(token==="USDC"){
    const T=await import("https://esm.sh/@solana/spl-token@0.4.8?deps=@solana/web3.js@1.95.3");
    const mint=new W.PublicKey(cfg.usdcMint), src=T.getAssociatedTokenAddressSync(mint,from), dst=T.getAssociatedTokenAddressSync(mint,to,true);
    tx.add(T.createAssociatedTokenAccountIdempotentInstruction(from,dst,to,mint), T.createTransferCheckedInstruction(src,mint,dst,from,Math.round(amount*1e6),6));
  } else tx.add(W.SystemProgram.transfer({fromPubkey:from,toPubkey:to,lamports:Math.round(amount*1e9)}));
  tx.feePayer=from; tx.recentBlockhash=(await conn.getLatestBlockhash()).blockhash;
  let signature;
  if(prov.signTransaction){ const signed=await prov.signTransaction(tx); signature=await conn.sendRawTransaction(signed.serialize(),{skipPreflight:false}); }
  else { const sent=await prov.signAndSendTransaction(tx); signature=sent.signature||sent; }
  status("Confirming on Solana...");
  for(let i=0;i<30;i++){ const r=await api("/api/wallet/fund",{body:{signature}}); if(!r.pending){ ME=r.me; return r.naira; } await new Promise(z=>setTimeout(z,2000)); }
  throw new Error("Still confirming. Check your balance in a minute.");
}
const solErr=e=>/reject|denied|cancel/i.test(e.message||"")?"Wallet request cancelled":(/insufficient|0x1|debit an account|could not find account|invalid account/i.test(e.message||"")?"Not enough devnet funds in this wallet. Free test SOL: faucet.solana.com. Free test USDC: faucet.circle.com (choose Solana Devnet).":(e.message||"Wallet payment failed"));
async function walletFundSheet(){
  let cfg; try{ cfg=await api("/api/wallet/config"); }catch(e){ return toast(e.message); }
  if(!cfg.treasury) return toast("Wallet payments are not switched on yet");
  let tok="USDC"; const rate=t=>t==="USDC"?cfg.ngnPerUsd:cfg.solUsd*cfg.ngnPerUsd;
  sheet('<h2>Fund with wallet</h2><p class="alede">Send devnet test money from your connected wallet. It becomes naira in your balance at a fixed demo rate.</p><div class="toks" id="sTok"><button data-t="USDC" aria-pressed="true">'+USDC_LOGO+'<span>USDC</span></button><button data-t="SOL" aria-pressed="false">'+SOL_LOGO+'<span>SOL</span></button></div><label for="sAmt" id="sLbl">Amount (USDC)</label><input id="sAmt" type="number" inputmode="decimal" step="0.01" value="5"><p class="muted" id="sEst" style="font-size:13px;margin:6px 0 0"></p><div id="sErr" style="color:var(--bad);font-size:14px;margin-top:10px"></div><button class="pill block abtn" id="sGo">Pay from my wallet</button><button class="pill outline block abtn" data-close>Cancel</button>',()=>{
    const est=()=>{ $("#sLbl").textContent="Amount ("+tok+")"; $("#sEst").textContent="1 "+tok+" = "+money(rate(tok))+" (demo rate). You will get about "+money(Math.floor((+$("#sAmt").value||0)*rate(tok))); }; est(); $("#sAmt").oninput=est;
    $$("#sTok button").forEach(b=>b.onclick=()=>{ tok=b.dataset.t; $$("#sTok button").forEach(x=>x.setAttribute("aria-pressed",x===b)); $("#sAmt").value=tok==="USDC"?5:0.1; est(); });
    $("#sGo").onclick=async()=>{ const b=$("#sGo"), err=$("#sErr"); err.textContent=""; const amt=+$("#sAmt").value; if(!(amt>0)) return err.textContent="Enter an amount";
      b.disabled=true;
      try{ const n=await solPay(cfg,tok,amt,t=>b.textContent=t); closeSheet(); renderPortfolio(); seenSync(); toast(money(n)+" added from your wallet"); }
      catch(e){ err.textContent=solErr(e); b.disabled=false; b.textContent="Pay from my wallet"; } }; });
}
function renderWallet(){ const t=$("#pfWalletTxt"); if(!t||!ME) return; const w=ME.sol; if(w){ if(!renderWallet.done||renderWallet.done!==w.address){ renderWallet.done=w.address; loadUsd(); } } else { renderWallet.done=null; loadUsd(); }
  t.innerHTML=w?'<span style="color:var(--mint)">&#9679;</span> '+esc(w.address.slice(0,4))+"..."+esc(w.address.slice(-4))+' · devnet':"Connect Solana wallet"; }
$("#pfWallet").onclick=async()=>{
  if(ME&&ME.sol){ return sheet('<h2>Solana wallet</h2><p class="alede">Connected on <b>devnet</b> (test network).</p><div class="card"><div class="row"><span>Address</span><b style="font-size:12px;word-break:break-all;text-align:right">'+esc(ME.sol.address)+'</b></div></div><button class="pill outline block abtn" id="wOff">Disconnect wallet</button><button class="pill block abtn" data-close>Close</button>',()=>{ $("#wOff").onclick=async()=>{ try{ ME=await api("/api/wallet",{body:{unlink:true}}); closeSheet(); renderPortfolio(); toast("Wallet disconnected"); }catch(e){ toast(e.message); } }; }); }
  const prov=walletProv();
  if(!prov){ const here=encodeURIComponent(location.origin); return sheet('<h2>Connect a Solana wallet</h2><p class="alede">No wallet found in this browser. Open AjoLabs inside the <b>Phantom</b> app browser to connect.</p><a class="pill block abtn" style="text-align:center;text-decoration:none" href="https://phantom.app/ul/browse/'+here+'?ref='+here+'">Open in Phantom</a><button class="pill outline block abtn" data-close>Close</button>'); }
  try{
    const r=await prov.connect(); const address=r.publicKey.toString();
    const message="AjoLabs: link wallet "+address+" to my account at "+Date.now();
    const sig=await prov.signMessage(new TextEncoder().encode(message),"utf8");
    let bin=""; new Uint8Array(sig.signature||sig).forEach(b=>bin+=String.fromCharCode(b));
    ME=await api("/api/wallet",{body:{address,message,signature:btoa(bin)}}); renderPortfolio(); seenSync(); toast("Wallet connected (devnet)");
  }catch(e){ toast(/reject|denied|cancel/i.test(e.message||"")?"Wallet request cancelled":(e.message||"Could not connect wallet")); }
};
function renderMandate(){ const b=$("#pfMandate"),t=$("#pfMandateTxt"); if(!b||!ME) return; const m=ME.mandate;
  t.innerHTML=!m?PG+"Connect bank (direct debit)":m.status==="APPROVED"?PG+"Direct debit on"+(m.bank?" · "+esc(m.bank):""):m.status==="REJECTED"?PG+"Bank declined. Try again":PG+"Waiting for your bank...";
  b.disabled=!!(m&&m.status==="APPROVED"); }
$("#pfMandate").onclick=async()=>{ const m=ME&&ME.mandate; if(m&&m.status==="APPROVED") return;
  const otp=await askOtp("mandate"); if(!otp) return;
  try{ const r=await api("/api/mandate",{body:{otp}}); if(r.checkoutUrl) location.href=r.checkoutUrl; }catch(e){ toast(e.message); } };
function pay(kind){
  const c=cur,me=c.members.find(m=>m.you),what=kind==="deposit"?"Deposit":"Round "+c.round+" payment";
  if(ME.wallet<c.amount) return fundSheet(c.amount-ME.wallet);
  sheet('<h2>Pay from your balance</h2><p class="alede">Your balance pays this. No checkout needed.</p><div class="card"><div class="row"><span>'+what+'</span><b>'+money(c.amount)+'</b></div><div class="row" style="margin-top:10px"><span>To</span><b>'+esc(c.name)+'</b></div><div class="row" style="margin-top:10px"><span>Your balance</span><b>'+money(ME.wallet)+' → '+money(ME.wallet-c.amount)+'</b></div></div><button class="pill block abtn" id="pgOk">Pay '+money(c.amount)+'</button><button class="pill outline block abtn" data-close>Cancel</button>',
    ()=>{ $("#pgOk").onclick=async()=>{ const b=$("#pgOk"); b.disabled=true; try{ await api("/api/circles/"+c.id+"/"+(kind==="deposit"?"deposit":"pay")+"/"+me.id,{body:{}}); closeSheet(); await refresh(); seenSync(); renderCircle(); toast("Paid. Receipt saved."); }catch(e){ toast(e.message); b.disabled=false; } }; });
}

/* ---------- boot ---------- */
let PRIVY_STARTED=false;
function bootPrivy(id){ if(PRIVY_STARTED||!id) return; PRIVY_STARTED=true; startPrivy(id).catch(()=>{ PRIVY_STARTED=false; hideSplash(); showWelcome(); werr("Sign-in could not load. Check your connection and refresh."); }); }
(async function(){
  let cached={}; try{ cached=JSON.parse(localStorage.getItem("ajo_cfg")||"{}"); }catch(e){}
  if(window.__PRIVY) cached={privyAppId:window.__PRIVY};
  if(cached.privyAppId){ CONFIG=cached; bootPrivy(cached.privyAppId); if(SESSION()) showSplash(); else showWelcome(); }   // start sign-in right away, before the server answers
  try{ const c=await (await fetch("/api/config")).json(); CONFIG=c; try{ localStorage.setItem("ajo_cfg",JSON.stringify({privyAppId:c.privyAppId})); }catch(e){} }catch(e){ if(!CONFIG.privyAppId) CONFIG={demoLogin:true}; }
  MOCK=CONFIG.mode==="mock";
  renderSum();
  if(CONFIG.privyAppId){ bootPrivy(CONFIG.privyAppId); if(!cached.privyAppId){ if(SESSION()) showSplash(); else showWelcome(); } }
  else { $("#wDemo").style.display="block"; if(demoToken()) await enter(); else showWelcome(); }
})();

/* ---------- light / dark / auto ---------- */
function themePref(){ try{ return localStorage.getItem("ajo-theme")||"dark"; }catch(e){ return "dark"; } }
function applyTheme(){
  const p=themePref(), d=p==="auto"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;
  document.documentElement.setAttribute("data-theme",d);
  const m=document.querySelector('meta[name="theme-color"]'); if(m) m.content=d==="light"?"#F4F6F5":"#111316";
}
function setTheme(t){ try{ localStorage.setItem("ajo-theme",t); }catch(e){} applyTheme(); }
try{ matchMedia("(prefers-color-scheme: light)").addEventListener("change",()=>{ if(themePref()==="auto") applyTheme(); }); }catch(e){}
applyTheme();

/* ---------- Portfolio home: greeting, active circle, tiles, proof strip ---------- */
function renderHome(){
  const hr=new Date(new Date().toLocaleString("en-US",{timeZone:"Africa/Lagos"})).getHours();
  const first=(ME.name||"").trim().split(/\s+/)[0];
  $("#helloSub").textContent=(hr<12?"Good morning":hr<17?"Good afternoon":"Good evening")+(first?", "+first:"");
  const mine=circles.filter(c=>c.members.some(m=>m.you));
  const act=mine.find(c=>c.status==="active")||mine.find(c=>c.status==="deposits")||mine.find(c=>c.status==="filling");
  $("#helloH").textContent=act&&act.status==="active"?"Your circles are on track.":mine.length?"Your circle is getting ready.":"Start saving together.";
  const el=$("#activeCard");
  if(!act){ el.innerHTML=""; }
  else{
    const N=act.maxMembers, cur=act.status==="active"?act.round:0;
    const tag=act.status==="active"?"Round "+act.round+" of "+N:act.status==="deposits"?"Deposits":"Filling up";
    const bars=Array.from({length:N},(_,i)=>'<i class="'+(i<cur-1?"done":i===cur-1?"now":"")+'"></i>').join("");
    const me=act.members.find(m=>m.you);
    const line=act.status==="active"?'<span>Next payout: <b>'+esc(act.receiver||"")+'</b></span><span><b>'+money(act.receiverNet||0)+'</b></span>':'<span>'+act.members.length+' of '+N+' members joined</span><span><b>'+money(act.amount)+'</b> each round</span>';
    el.innerHTML='<div class="pcard activec" data-circle="'+act.id+'" role="button" tabindex="0"><div class="acTop"><div><small>Active circle'+(act.goal&&GOAL_LABEL[act.goal]?" · "+GOAL_LABEL[act.goal]:"")+'</small><h4>'+esc(act.name)+'</h4></div><span class="acTag">'+tag+'</span></div><div class="acBars" style="grid-template-columns:repeat('+N+',minmax(0,1fr))">'+bars+'</div><div class="acLine">'+line+'</div><button class="pill block mintbtn" data-circle="'+act.id+'">Open circle</button></div>';
  }
  const aj=ME.ajo||{score:null,level:"New"};
  $("#tileScoreN").textContent=aj.score==null?"New":aj.score; $("#tileScoreL").textContent=aj.score==null?"Ajo Score":aj.level;
  let tot=0,ok=0; for(const c of mine){ if(c.proof){ tot+=c.proof.total; ok+=c.proof.confirmed; } }
  const ps=$("#proofStrip"); ps.hidden=!tot; if(tot) ps.innerHTML='<span class="dot"></span><span>'+tot+' record'+(tot===1?"":"s")+' saved on Solana. '+(ok===tot?"All confirmed.":ok+" confirmed.")+'</span>';
}
$("#tileRc").onclick=()=>{ const e=$("#rcBody"); if(e) e.scrollIntoView({behavior:"smooth",block:"center"}); };
$("#tileScore").onclick=()=>{ const e=$("#recScore"); if(e) e.scrollIntoView({behavior:"smooth",block:"center"}); };
$("#activeCard").addEventListener("click",e=>{ const r=e.target.closest("[data-circle]"); if(r) openCircle(r.dataset.circle); });

/* ---------- chat connector: a private link that lets Claude read your circles (read only) ---------- */
function connectorSheet(){
  const on=!!ME.connector;
  sheet('<h2>Chat connector</h2><p class="alede">Make a private link, add it to Claude as a custom connector, then ask things like "who gets paid next in my circle?". It can read your circles and prepare a payment, but it can never pay. You approve every payment yourself here in AjoLabs.</p>'+
    '<div id="cnOut"></div><button class="pill block abtn" id="cnMake">'+(on?"Make a new link":"Make my link")+'</button>'+(on?'<button class="pill outline block abtn" id="cnOff">Turn off</button>':'')+'<button class="pill outline block abtn" data-close>Close</button>',
  ()=>{
    $("#cnMake").onclick=async()=>{ try{ const r=await api("/api/connector",{body:{}}); ME.connector=true; const url=location.origin+"/mcp/"+r.token;
      $("#cnOut").innerHTML='<div class="card"><div style="font-size:13px;color:var(--soft);margin-bottom:8px">Your private link. It is shown once. Anyone with it can read your circles, so keep it to yourself.</div><div id="cnUrl" style="word-break:break-all;font-size:13px;user-select:all">'+esc(url)+'</div></div><button class="pill block abtn" id="cnCopy">Copy link</button>';
      $("#cnCopy").onclick=()=>{ (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(url):Promise.reject()).then(()=>toast("Link copied"),()=>toast("Press and hold the link to copy it")); };
      $("#cnMake").style.display="none"; renderPortfolio(); }catch(e){ toast(e.message); } };
    if($("#cnOff")) $("#cnOff").onclick=async()=>{ try{ await api("/api/connector",{body:{revoke:true}}); ME.connector=false; closeSheet(); renderPortfolio(); toast("Connector turned off"); }catch(e){ toast(e.message); } };
  });
}

/* ---------- approve a payment that Claude prepared ---------- */
async function approveSheet(id){
  let d; try{ d=await api("/api/approve/"+encodeURIComponent(id)); }catch(e){ return sheet('<div class="wdview"><h3>Cannot open this payment</h3><p>'+esc(e.message)+'</p><button class="pill block abtn" data-close>Close</button></div>'); }
  const what=d.kind==="deposit"?"Deposit":"Round payment", short=d.balance<d.amount;
  sheet('<h2>Approve this payment</h2><p class="alede">Claude prepared this for you. Nothing is paid until you tap Approve.</p><div class="card"><div class="row"><span>'+what+'</span><b>'+money(d.amount)+'</b></div><div class="row" style="margin-top:10px"><span>Circle</span><b>'+esc(d.circle)+'</b></div><div class="row" style="margin-top:10px"><span>Your balance</span><b>'+money(d.balance)+'</b></div></div>'+
    (short?'<p class="muted" style="margin-top:10px">Your balance is short by '+money(d.amount-d.balance)+'. Fund it first, then ask Claude again.</p>':'')+
    '<div id="apErr" style="color:var(--bad);font-size:14px;margin-top:10px"></div><button class="pill block abtn" id="apOk" '+(short?"disabled":"")+'>Approve and pay '+money(d.amount)+'</button><div class="orline"><span>or pay in Solana</span></div><div class="toks big" id="apTok"><button data-t="USDC">'+USDC_LOGO+'<span>Pay with USDC</span></button><button data-t="SOL">'+SOL_LOGO+'<span>Pay with SOL</span></button></div><p class="muted" style="font-size:12px;margin:8px 0 0">Devnet test money from your connected wallet. Demo rate: 1 USDC = '+money(1500)+'.</p><button class="pill outline block abtn" data-close>Cancel</button>',
  ()=>{
    $$("#apTok button").forEach(bt=>bt.onclick=async()=>{ const err=$("#apErr"); err.textContent=""; const t=bt.dataset.t; $$("#apTok button").forEach(x=>x.disabled=true);
      try{ const cfg=await api("/api/wallet/config"); if(!cfg.treasury) throw new Error("Wallet payments are not switched on yet");
        const need=d.amount, per=t==="USDC"?cfg.ngnPerUsd:cfg.solUsd*cfg.ngnPerUsd, units=t==="USDC"?Math.ceil(need/per*100)/100:Math.ceil(need/per*1e4)/1e4;
        await solPay(cfg,t,units,s=>{ bt.querySelector("span").textContent=s; });
        bt.querySelector("span").textContent="Paying the circle..."; ME=await api("/api/approve/"+encodeURIComponent(id),{body:{}}); await refresh(); seenSync(); renderPortfolio();
        sheet('<div class="wdview">'+BADGE+'<h3>Paid with '+t+'</h3><p>'+money(d.amount)+' sent to '+esc(d.circle)+'. Your receipt is saved.</p><button class="pill block abtn wdok" id="apDone2">Nice one!</button></div>',()=>{ $("#apDone2").onclick=closeSheet; });
      }catch(e){ err.textContent=solErr(e); $$("#apTok button").forEach(x=>x.disabled=false); bt.querySelector("span").textContent="Pay with "+t; } }); $("#apOk").onclick=async()=>{ const b=$("#apOk"); b.disabled=true; b.textContent="Paying..."; try{ ME=await api("/api/approve/"+encodeURIComponent(id),{body:{}}); await refresh(); seenSync(); renderPortfolio();
      sheet('<div class="wdview">'+BADGE+'<h3>Paid</h3><p>'+money(d.amount)+' sent to '+esc(d.circle)+'. Your receipt is saved.</p><button class="pill block abtn wdok" id="apDone">Nice one!</button></div>',()=>{ $("#apDone").onclick=closeSheet; });
    }catch(e){ $("#apErr").textContent=e.message; b.disabled=false; b.textContent="Approve and pay "+money(d.amount); } }; });
}
