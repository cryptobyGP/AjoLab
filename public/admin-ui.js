// Owner dashboard (read-only). Shown only when the server says this account is an admin.
(function(){
  const N=n=>"₦"+Number(n||0).toLocaleString("en-NG"), T=t=>new Date(t).toLocaleString("en-NG",{timeZone:"Africa/Lagos",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
  const css='#adm{position:fixed;inset:0;z-index:90;background:var(--bg);color:var(--text);overflow:auto;padding:max(16px,env(safe-area-inset-top)) 16px 40px;display:none}#adm.on{display:block}#adm .in{max-width:900px;margin:0 auto}'+
  '#adm h1{font-size:24px;margin:6px 0 2px}#adm h3{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:26px 0 10px}#adm .sub{color:var(--soft);font-size:13px}'+
  '#adm .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}#adm .k{background:var(--panel);border:1px solid var(--line1);border-radius:16px;padding:14px}#adm .k b{display:block;font-size:22px;margin-top:4px}#adm .k span{font-size:12px;color:var(--soft)}'+
  '#adm .box{background:var(--panel);border:1px solid var(--line1);border-radius:16px;padding:14px;margin-bottom:10px}#adm .row{display:flex;gap:10px;justify-content:space-between;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line1);font-size:14px}#adm .row:first-child{border-top:0}'+
  '#adm .row small{display:block;color:var(--dim);font-size:12px;margin-top:2px;word-break:break-all}#adm .tag{font-size:11px;font-weight:700;padding:3px 8px;border-radius:99px;white-space:nowrap}#adm .high{background:#E5484D;color:#fff}#adm .mid{background:#F5A524;color:#1b1200}#adm .low{background:var(--s3);color:var(--soft)}'+
  '#adm input{width:100%;box-sizing:border-box;padding:13px 14px;border-radius:12px;border:1px solid var(--line2);background:var(--s1);color:var(--text);font-size:15px}#adm .bar{display:flex;align-items:flex-end;gap:2px;height:70px}#adm .bar i{flex:1;background:var(--green);border-radius:2px 2px 0 0;min-height:2px;opacity:.9}'+
  '#adm .x{position:sticky;top:0;float:right;border:1px solid var(--line2);background:var(--s1);color:var(--text);border-radius:99px;padding:8px 14px;font-size:14px}#adm .ok{color:var(--green)}#adm a{color:var(--mint)}#adm pre{white-space:pre-wrap;word-break:break-all;font-size:12px;color:var(--soft);margin:6px 0 0}';
  function bars(arr,days){const m=Math.max(1,...arr);return '<div class="bar" title="last 30 days">'+arr.map((v,i)=>'<i style="height:'+Math.round(v/m*100)+'%" title="'+days[i]+': '+v.toLocaleString()+'"></i>').join("")+'</div>';}
  function chart(label,arr,days,money){const tot=arr.reduce((a,b)=>a+b,0);return '<div class="box"><div class="row" style="border:0;padding:0 0 8px"><span>'+label+'</span><b>'+(money?N(tot):tot)+'</b></div>'+bars(arr,days)+'</div>';}
  function mount(){ if(document.getElementById("adm")) return; const st=document.createElement("style"); st.textContent=css; document.head.appendChild(st); const d=document.createElement("div"); d.id="adm"; document.body.appendChild(d); }
  async function open(){
    mount(); const el=document.getElementById("adm"); el.classList.add("on"); el.innerHTML='<div class="in"><p class="sub">Loading…</p></div>';
    try{
      const o=await api("/api/admin/overview"), s=o.series, m=o.money, c=o.circles.byStatus;
      const k=(l,v)=>'<div class="k"><span>'+l+'</span><b>'+v+'</b></div>';
      el.innerHTML='<div class="in"><button class="x" id="admX">Close</button><h1>AjoLabs dashboard</h1><div class="sub">Read-only · updated '+T(o.at)+' · Paga '+esc(o.mode)+' · data on '+esc(o.storage)+'</div>'+
      '<h3>Overview</h3><div class="grid">'+k("Users",o.users.total)+k("New this week",o.users.new7)+k("Circles",o.circles.total)+k("Seats taken",o.circles.members)+k("With wallet",o.users.withWallet)+k("Chat connector",o.users.withConnector)+'</div>'+
      '<div class="sub" style="margin-top:8px">Circles: '+(Object.keys(c).map(x=>c[x]+" "+x).join(" · ")||"none yet")+'</div>'+
      '<h3>Money (test money)</h3><div class="grid">'+k("Fees earned",N(m.fees))+k("User balances",N(m.balances))+k("Deposits held",N(m.deposits))+k("Default pools",N(m.pools))+k("Funded in",N(m.funded))+k("Sent to banks",N(m.withdrawn))+k("Paid into circles",N(m.paidIn))+k("Paid out",N(m.paidOut))+'</div>'+
      '<div class="sub" style="margin-top:8px">Totals come from receipts (the last 200 per user).</div>'+
      '<h3>Problems ('+o.problems.length+')</h3><div class="box">'+(o.problems.length?o.problems.map(p=>'<div class="row"><span>'+esc(p.text)+'<small>'+esc(p.area)+(p.ref?' · '+esc(p.ref):'')+'</small></span><span class="tag '+p.level+'">'+p.level+'</span></div>').join(""):'<span class="ok">Nothing wrong right now.</span>')+'</div>'+
      '<h3>Last 30 days</h3>'+chart("New users",s.users,s.days)+chart("New circles",s.circles,s.days)+chart("Money funded",s.funded,s.days,1)+chart("Paid into circles",s.payments,s.days,1)+chart("Sent to banks",s.withdrawn,s.days,1)+chart("Fees earned",s.fees,s.days,1)+chart("Failed items",s.failed,s.days)+
      '<h3>Solana proof</h3><div class="box"><div class="row"><span>Records<small>'+o.proof.confirmed+' of '+o.proof.total+' confirmed on devnet</small></span><span class="tag '+(o.proof.brokenChains?'high':'low')+'">'+(o.proof.brokenChains?o.proof.brokenChains+' broken':'chains ok')+'</span></div></div>'+
      '<h3>Latest activity</h3><div class="box">'+(o.recent.map(r=>'<div class="row"><span>'+esc(r.title)+' · '+esc(r.who)+'<small>'+T(r.at)+(r.circle?' · '+esc(r.circle):'')+' · '+esc(r.id)+'</small></span><b>'+(r.amount?N(r.amount):'')+'</b></div>').join("")||'<span class="sub">Nothing yet.</span>')+'</div>'+
      '<h3>Trace anything</h3><input id="admQ" placeholder="Receipt id, reference, circle id, email, name, wallet or Solana signature" autocomplete="off"><div id="admR" style="margin-top:12px"></div></div>';
      document.getElementById("admX").onclick=()=>el.classList.remove("on");
      let tm; document.getElementById("admQ").oninput=e=>{clearTimeout(tm);tm=setTimeout(()=>trace(e.target.value),350);};
    }catch(e){ el.innerHTML='<div class="in"><button class="x" id="admX">Close</button><p>'+esc(e.message)+'</p></div>'; document.getElementById("admX").onclick=()=>el.classList.remove("on"); }
  }
  async function trace(q){
    const out=document.getElementById("admR"); if(q.trim().length<3){out.innerHTML="";return;}
    try{
      const r=await api("/api/admin/trace?q="+encodeURIComponent(q)), none=!(r.users.length+r.circles.length+r.receipts.length+r.refs.length+r.chain.length); let h="";
      if(none) h='<p class="sub">No match.</p>';
      if(r.users.length) h+='<h3>People</h3><div class="box">'+r.users.map(u=>'<div class="row"><span>'+esc(u.name||"(no name)")+' · '+esc(u.email||"")+'<small>'+esc(u.uid)+' · joined '+T(u.created)+(u.bank?' · bank '+esc(u.bank.name)+' '+esc(u.bank.account):'')+(u.wallet?' · wallet '+esc(u.wallet):'')+'</small>'+u.recent.map(x=>'<small>'+T(x.at)+' · '+esc(x.title)+' · '+(x.amount?N(x.amount):'')+' · '+esc(x.status)+' · '+esc(x.id)+'</small>').join("")+'</span><b>'+N(u.balance)+'</b></div>').join("")+'</div>';
      if(r.circles.length) h+='<h3>Circles</h3>'+r.circles.map(c=>'<div class="box"><div class="row" style="border:0;padding-top:0"><span><b>'+esc(c.name)+'</b><small>'+esc(c.id)+' · '+esc(c.status)+' · round '+c.round+' · '+N(c.amount)+' each · pool '+N(c.pool)+'</small></span><span class="tag '+(c.chainValid?'low':'high')+'">'+(c.chainValid?'chain ok':'chain broken')+'</span></div>'+c.members.map(m=>'<div class="row"><span>'+m.slot+'. '+esc(m.name)+'<small>'+(m.deposit?'deposit in':'no deposit')+' · '+(m.paid?'paid this round':'not paid')+(m.defaulted?' · defaulted':'')+(m.auto?' · auto-pay':'')+'</small></span></div>').join("")+'<pre>'+c.ledger.map(l=>T(l.at)+"  "+esc(l.text)).join("\n")+'</pre></div>').join("");
      if(r.receipts.length) h+='<h3>Receipts</h3><div class="box">'+r.receipts.map(x=>'<div class="row"><span>'+esc(x.title)+' · '+esc(x.who)+'<small>'+T(x.at)+' · '+esc(x.id)+' · ref '+esc(x.reference||"-")+' · '+esc(x.status)+(x.fee?' · fee '+N(x.fee):'')+'</small><small>'+esc(x.summary||"")+'</small></span><b>'+(x.amount?N(x.amount):'')+'</b></div>').join("")+'</div>';
      if(r.refs.length) h+='<h3>References</h3><div class="box">'+r.refs.map(x=>'<div class="row"><span>'+esc(x.ref)+'<small>'+esc(JSON.stringify({...x,ref:undefined}))+'</small></span></div>').join("")+'</div>';
      if(r.chain.length) h+='<h3>Solana records</h3><div class="box">'+r.chain.map(x=>'<div class="row"><span>'+esc(x.circleName)+' #'+x.seq+' · '+esc(x.kind)+'<small>'+T(x.at)+' · '+esc(x.hash)+'</small>'+(x.explorer?'<small><a target="_blank" rel="noopener" href="'+esc(x.explorer)+'">View on Solana</a></small>':'<small>not written yet</small>')+'</span><span class="tag '+(x.ok?'low':'mid')+'">'+(x.ok?'confirmed':'waiting')+'</span></div>').join("")+'</div>';
      out.innerHTML=h;
    }catch(e){ out.innerHTML='<p class="sub">'+esc(e.message)+'</p>'; }
  }
  window.adminHook=async function(){
    const ul=document.querySelector("#acctBody ul"); if(!ul||ul.dataset.adm) return; ul.dataset.adm="1";
    try{
      const me=await api("/api/admin/me");
      const li=document.createElement("li"); li.className="li";
      if(me.admin){ li.innerHTML='<span>Owner dashboard<small>See how AjoLabs is doing and trace any transaction.</small></span><button class="pill outline sm" style="width:auto;padding:9px 16px">Open</button>'; li.querySelector("button").onclick=open; }
      else { li.innerHTML='<span>Account ID<small style="word-break:break-all">'+esc(me.uid)+'</small></span>'; }
      ul.appendChild(li);
    }catch(e){}
  };
})();
