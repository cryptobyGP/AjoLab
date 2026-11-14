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

const welcome=$("#welcome");
function showWelcome(){ welcome.classList.add("on"); document.body.classList.add("locked"); }
function hideWelcome(){ welcome.classList.remove("on"); document.body.classList.remove("locked"); }
function werr(m){ $("#wErr").textContent=m||""; }
const EMAILRX=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;

$("#wGoogle").onclick=()=>{
  werr("");
  if(CONFIG.privyAppId){ if(!Auth.ready||!Auth.login) return werr("Sign-in is still loading. Try again in a moment."); Auth.login({loginMethods:["google"]}); }
  else werr("Google sign-in needs Privy to be set up. For now use your email.");
};
$("#wContinue").onclick=async()=>{
  werr(""); const e=$("#wEmail").value.trim().toLowerCase();
  if(!EMAILRX.test(e)) return werr("Enter a valid email address.");
  if(CONFIG.privyAppId){
    if(!Auth.ready||!Auth.login) return werr("Sign-in is still loading. Try again in a moment.");
    Auth.login({loginMethods:["email"],prefill:{type:"email",value:e}});
  } else { localStorage.setItem("ajo_demo_email",e); await enter(); }
};
$("#wEmail").addEventListener("keydown",e=>{ if(e.key==="Enter") $("#wContinue").click(); });
window.addEventListener("ajoauth",()=>{ if(CONFIG.privyAppId&&Auth.ready&&Auth.authenticated&&!ME&&!entering) enter(); });

let entering=false;
async function enter(){
  entering=true;
  try{
    ME=await api("/api/me"); hideWelcome(); seenInit();
    const j=new URLSearchParams(location.search).get("join");
    if(!ME.name) await setupSheet();
    if(j){ history.replaceState(null,"",location.pathname); openApp("join"); $("#jCode").value=j; lookup(); }
    await refresh();
  }catch(e){ if(!/sign in/i.test(e.message)) werr(e.message); }
  entering=false;
}
function signOut(){
  localStorage.removeItem("ajo_demo_email"); ME=null; circles=[]; cur=null; closeApp();
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
  return '<li class="li" data-circle="'+c.id+'" style="cursor:pointer"><span>'+esc(c.name)+'<small>'+money(c.amount)+' '+CYC[c.cycleDays]+', '+c.members.length+'/'+c.maxMembers+' members</small></span><span class="tags"><span class="ctag '+(c.status==="active"?"next":"wait")+'">'+tag+'</span></span></li>';
}
function renderPortfolio(){
  if(!ME) return;
  $("#pfBal").textContent=money(ME.wallet);
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
  const notes=ME.notes||[];
  $("#noteBody").innerHTML=notes.length?notes.slice(0,6).map(n=>'<div class="nrow '+(n.read?"":"new")+'" data-rc="'+n.receipt+'"><b>'+esc(n.title)+'</b><small>'+esc(n.text)+' '+ago(n.at)+'</small></div>').join(""):'<p class="empty">Nothing yet. You will see payments and payouts here.</p>';
  const rcs=ME.receipts||[];
  $("#rcBody").innerHTML=rcs.length?rcs.slice(0,8).map(r=>'<div class="nrow" data-rc="'+r.id+'"><div class="row"><b>'+esc(r.title)+'</b><span>'+(r.amount!=null?money(r.amount):"")+'</span></div><small>'+(r.circleName?esc(r.circleName)+", ":"")+ago(r.at)+'</small></div>').join(""):'<p class="empty">Receipts for every payment and transfer will show here.</p>';
  $("#recFin").textContent=ME.finished; $("#recDef").textContent=ME.defaults; $("#recHb").textContent=ME.tier.pct+"%";
  $("#acctBody").innerHTML='<ul style="padding:0"><li class="li"><span>Name<small>'+esc(ME.name||"-")+'</small></span></li><li class="li"><span>Email<small>'+esc(ME.email&&!ME.email.startsWith("demo:")?ME.email:"-")+'</small></span></li><li class="li"><span>Phone<small>'+esc(ME.phone||"-")+'</small></span></li><li class="li"><span>Bank<small>'+(ME.bank?esc(ME.bank.name)+" ending "+esc(ME.bank.account.slice(-4)):"Not added yet")+'</small></span><button class="pill outline sm" id="editBank" style="padding:8px 14px;font-size:14px">'+(ME.bank?"Change":"Add")+'</button></li></ul>';
  const eb=$("#editBank"); if(eb) eb.onclick=()=>bankSheet();
  if(ME.notes&&ME.notes.some(n=>!n.read)&&page==="portfolio") api("/api/me/read",{body:{}}).then(m=>{ME.notes=m.notes.map(n=>({...n,read:false}));}).catch(()=>{});
}
function ago(t){const s=Math.floor((Date.now()-t)/1000); if(s<60)return"just now"; if(s<3600)return Math.floor(s/60)+" min ago"; if(s<86400)return Math.floor(s/3600)+" h ago"; return new Date(t).toLocaleDateString([],{day:"numeric",month:"short"});}
$("#circlesBody").addEventListener("click",e=>{const r=e.target.closest("[data-circle]"); if(r) openCircle(r.dataset.circle);});
document.addEventListener("click",e=>{ const r=e.target.closest("[data-rc]"); if(r&&appEl.contains(r)) receiptSheet(r.dataset.rc); });

function receiptSheet(id){
  const r=(ME.receipts||[]).find(x=>x.id===id); if(!r) return;
  const rows=[["Receipt",r.id],["Date",new Date(r.at).toLocaleString()],r.circleName&&["Circle",r.circleName],r.amount!=null&&["Amount",money(r.amount)],["Reference",r.reference||r.id],["Status",r.status]].filter(Boolean);
  sheet('<h2>'+esc(r.title)+'</h2><p class="alede">'+esc(r.summary)+'</p><div class="card">'+rows.map((x,i)=>'<div class="row" style="'+(i?"margin-top:10px":"")+'"><span>'+esc(x[0])+'</span><b style="word-break:break-all;text-align:right">'+esc(x[1])+'</b></div>').join("")+'</div><button class="pill block abtn" data-close>Done</button>');
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
$("#pfWithdraw").onclick=()=>{
  if(!ME.bank) return bankSheet(()=>$("#pfWithdraw").click());
  sheet('<h2>Transfer to bank</h2><p class="alede">Sent through '+PG+'Paga to '+esc(ME.bank.name)+' ending '+esc(ME.bank.account.slice(-4))+'.</p><div class="card"><div class="row"><span>Available</span><b>'+money(ME.wallet)+'</b></div></div>'+
    '<label for="wAmt" style="margin-top:0">Amount (₦)</label><input id="wAmt" type="number" inputmode="numeric" value="'+ME.wallet+'" min="100" max="'+ME.wallet+'">'+
    '<div id="wErr2" style="color:var(--bad);font-size:14px;margin-top:10px"></div><button class="pill block abtn" id="wGo">Send to my bank</button><button class="pill outline block abtn" data-close>Cancel</button>',
  ()=>{ $("#wGo").onclick=async()=>{ const b=$("#wGo"); b.disabled=true; b.textContent="Sending...";
    try{ const amt=+$("#wAmt").value; ME=await api("/api/withdraw",{body:{amount:amt}}); closeSheet(); renderPortfolio(); toast(money(amt)+" is on its way to your bank. Receipt saved."); seenSync(); }
    catch(e){ $("#wErr2").textContent=e.message; b.disabled=false; b.textContent="Send to my bank"; } }; });
};
function seenSync(){ (ME.notes||[]).forEach(n=>seen&&seen.add(n.id)); }

/* ---------- create ---------- */
const draft={size:5,cycle:7};
seg($("#sizeSeg"),[3,4,5,6,8,10].map(n=>({v:n,l:String(n)})),()=>draft.size,v=>{draft.size=+v;renderSum();});
seg($("#cycSeg"),[{v:7,l:"Weekly"},{v:14,l:"2 weeks"},{v:30,l:"Monthly"}],()=>draft.cycle,v=>{draft.cycle=+v;renderSum();});
$("#cAmt").addEventListener("input",renderSum);
function renderSum(){
  const a=Math.max(0,+$("#cAmt").value||0),pot=a*draft.size,fee=Math.floor(pot*FEE);
  $("#sum").innerHTML=draft.size+' members pay '+money(a)+' '+CYC[draft.cycle]+'. The pot is '+money(pot)+'. A '+money(fee)+' fee is taken at each payout. Each member pays a '+money(a)+' deposit first, returned at the end. The circle starts when every seat is taken, in the order people join, so you receive first.';
}
$("#createBtn").onclick=async()=>{
  const b=$("#createBtn"); b.disabled=true;
  try{ const c=await api("/api/circles",{body:{name:$("#cName").value,amount:+$("#cAmt").value,maxMembers:draft.size,cycleDays:draft.cycle}}); await refresh(); openCircle(c.id); toast("Circle created. Share the invite link."); }
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
    el.innerHTML='<div class="card"><div class="big">'+esc(c.name)+'</div><div class="muted" style="margin-top:6px">'+c.maxMembers+' members, '+CYC[c.cycleDays]+', invite only</div><hr style="border:0;border-top:1px solid #262B30;margin:14px 0">'+
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
    if(c.status==="filling") h+='<button class="pill block abtn" id="shareBtn">Copy private invite link</button>'+(MOCK?'<button class="pill outline block abtn" id="fillBtn">Demo: fill the seats</button>':"");
    else if(c.status==="deposits"){ h+='<button class="pill block abtn" id="depBtn" '+(me.deposit?"disabled":"")+'>'+(me.deposit?"Your deposit is paid":"Pay "+money(c.amount)+" deposit")+'</button>'+(MOCK?'<button class="pill outline block abtn sm" id="othersBtn">Demo: others pay</button>':""); }
    else if(c.status==="completed") h+='<button class="pill block abtn" data-page="create">Start a new circle</button>';
    else {
      h+='<button class="pill block abtn" id="payBtn" '+(me.paid?"disabled":"")+'>'+(me.paid?"You have paid this round":"Pay "+money(c.amount))+'</button>';
      if(c.members.some(m=>!m.paid)) h+='<button class="pill block abtn" id="settleBtn" '+(c.canSettle?"":"disabled")+' style="background:var(--pillgreen);color:var(--mint)">'+(c.canSettle?"Run settlement (anyone can)":"Settlement opens after the grace period")+'</button>';
      if(MOCK){ h+='<button class="pill outline block abtn sm" id="othersBtn">Demo: others pay</button>';
        const t=c.members.find(m=>!m.you&&!m.paid&&m.slot!==c.round); if(t&&c.round===1&&n>=4) h+='<button class="pill outline block abtn sm" id="missBtn">Demo: '+esc(t.name)+' will not pay this round</button>';
        h+='<button class="pill outline block abtn sm" id="skipBtn">Demo: skip past the deadline and grace</button>'; }
    }
    el.innerHTML=h; bindPay();
  } else if(cTab==="members"){
    el.innerHTML='<div class="pcard" style="margin:0"><div class="pb" style="padding:8px 22px"><ul style="padding:0">'+c.members.map(m=>{
      let tags=""; if(c.status==="active"){ tags+=m.paid?'<span class="ctag paid">Paid</span>':'<span class="ctag wait">Waiting</span>'; if(m.slot===c.round) tags='<span class="ctag next">Receives</span>'+tags; }
      if(m.defaulted) tags+='<span class="ctag late">Default mark</span>'; else if(c.status==="deposits"&&m.deposit) tags+='<span class="ctag paid">Deposit in</span>';
      return '<li class="li"><span>'+m.slot+'. '+esc(m.name)+(m.you?" (you)":"")+'<small>'+esc(m.tierLabel)+', holdback '+m.tierPct+'%</small></span><span class="tags">'+tags+'</span></li>'; }).join("")+'</ul></div></div>';
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
      '<div class="pcard" style="margin:12px 0 0"><div class="pb"><h5>Activity</h5><ul style="padding:0">'+c.ledger.slice(-8).reverse().map(l=>'<li class="li" style="font-size:14px"><span>'+esc(l.text)+'<small>'+ago(l.at)+'</small></span></li>').join("")+'</ul></div></div>';
  }
}
let MOCK=false;
async function act(fn,msg){ try{ await fn(); await refresh(); if(msg) toast(msg); renderCircle(); }catch(e){ toast(e.message); } }
function bindPay(){
  const c=cur,B=id=>$("#"+id);
  if(B("shareBtn")) B("shareBtn").onclick=()=>{ const u=location.origin+"/?join="+c.id; (navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(u):Promise.reject()).then(()=>toast("Invite link copied. Only people with it can join."),()=>sheet('<h2>Invite link</h2><p class="alede">Copy this link and send it.</p><div class="card" style="word-break:break-all">'+esc(u)+'</div><button class="pill block abtn" data-close>Done</button>')); };
  if(B("fillBtn")) B("fillBtn").onclick=()=>act(()=>api("/api/dev/fill",{body:{id:c.id}}),"Sample members joined");
  if(B("depBtn")) B("depBtn").onclick=()=>pay("deposit");
  if(B("payBtn")) B("payBtn").onclick=()=>pay("pay");
  if(B("othersBtn")) B("othersBtn").onclick=()=>act(()=>api("/api/dev/pay-others",{body:{id:c.id}}),"Others have paid");
  if(B("missBtn")) B("missBtn").onclick=()=>{ const t=c.members.find(m=>!m.you&&!m.paid&&m.slot!==c.round); act(()=>api("/api/dev/pay-others",{body:{id:c.id,except:t.slot}}),t.name+" has not paid"); };
  if(B("skipBtn")) B("skipBtn").onclick=()=>act(()=>api("/api/dev/skip-time",{body:{id:c.id}}),"Clock moved past the deadline and grace");
  if(B("settleBtn")) B("settleBtn").onclick=()=>act(()=>api("/api/circles/"+c.id+"/settle",{body:{}}),"Settlement ran. Default mark added.");
}
async function fundSheet(need){
  let acc;
  try{ acc=(await api("/api/account",{body:{}})).account; }catch(e){ return toast(e.message); }
  sheet('<h2>Fund your balance</h2><p class="alede">'+(need?"You need "+money(need)+" more. ":"")+'Send naira from any bank app to your own '+PG+'Paga account below. It shows in your balance once Paga confirms it.</p>'+
    '<div class="card"><div class="row"><span>Account number</span><b id="fAcc" style="font-size:22px;letter-spacing:1px">'+esc(acc.number)+'</b></div><div class="row" style="margin-top:10px"><span>Bank</span><b>'+esc(acc.bank)+'</b></div><div class="row" style="margin-top:10px"><span>Account name</span><b>'+esc(acc.name)+'</b></div></div>'+
    '<button class="pill block abtn" id="fCopy">Copy account number</button>'+
    (MOCK?'<label for="fAmt">Demo: pretend a transfer arrived (₦)</label><input id="fAmt" type="number" inputmode="numeric" value="'+(need||5000)+'"><button class="pill outline block abtn" id="fDemo">Add to my balance</button>':"")+
    '<button class="pill outline block abtn" data-close>Close</button>',
  ()=>{
    $("#fCopy").onclick=()=>{ (navigator.clipboard?navigator.clipboard.writeText(acc.number):Promise.reject()).then(()=>toast("Account number copied"),()=>toast("Long-press the number to copy")); };
    const d=$("#fDemo"); if(d) d.onclick=async()=>{ try{ ME=await api("/api/dev/simulate-fund",{body:{amount:+$("#fAmt").value}}); seenSync(); closeSheet(); renderPortfolio(); if(cur&&appEl.classList.contains("on")&&page==="circle")renderPanel(); toast("Balance funded. Receipt saved."); }catch(e){ toast(e.message); } };
  });
}
$("#pfFund").onclick=()=>fundSheet();
function pay(kind){
  const c=cur,me=c.members.find(m=>m.you),what=kind==="deposit"?"Deposit":"Round "+c.round+" payment";
  if(ME.wallet<c.amount) return fundSheet(c.amount-ME.wallet);
  sheet('<h2>Pay from your balance</h2><p class="alede">Your balance pays this. No checkout needed.</p><div class="card"><div class="row"><span>'+what+'</span><b>'+money(c.amount)+'</b></div><div class="row" style="margin-top:10px"><span>To</span><b>'+esc(c.name)+'</b></div><div class="row" style="margin-top:10px"><span>Your balance</span><b>'+money(ME.wallet)+' → '+money(ME.wallet-c.amount)+'</b></div></div><button class="pill block abtn" id="pgOk">Pay '+money(c.amount)+'</button><button class="pill outline block abtn" data-close>Cancel</button>',
    ()=>{ $("#pgOk").onclick=async()=>{ const b=$("#pgOk"); b.disabled=true; try{ await api("/api/circles/"+c.id+"/"+(kind==="deposit"?"deposit":"pay")+"/"+me.id,{body:{}}); closeSheet(); await refresh(); seenSync(); renderCircle(); toast("Paid. Receipt saved."); }catch(e){ toast(e.message); b.disabled=false; } }; });
}

/* ---------- boot ---------- */
(async function(){
  try{ CONFIG=await (await fetch("/api/config")).json(); }catch(e){ CONFIG={demoLogin:true}; }
  MOCK=CONFIG.mode==="mock";
  if(CONFIG.privyAppId) startPrivy(CONFIG.privyAppId).catch(()=>werr("Sign-in could not load. Check your connection and refresh."));
  else $("#wDemo").style.display="block";
  renderSum();
  const j=new URLSearchParams(location.search).get("join");
  if(CONFIG.privyAppId){ showWelcome(); }          // Privy restores a saved session and fires "ajoauth"
  else if(demoToken()){ await enter(); }
  else showWelcome();
  if(j&&!ME) $("#wErr").textContent="";
})();
