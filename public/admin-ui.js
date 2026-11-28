// Owner dashboard (read-only). Shown only when the server says this account is an admin.
(function(){
  const N=n=>"₦"+Number(n||0).toLocaleString("en-NG"), T=t=>new Date(t).toLocaleString("en-NG",{timeZone:"Africa/Lagos",day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
  const css='#adm{position:fixed;inset:0;z-index:90;background:var(--bg);color:var(--text);overflow:auto;padding:max(16px,env(safe-area-inset-top)) 16px 40px;display:none}#adm.on{display:block}#adm .in{max-width:900px;margin:0 auto}'+
  '#adm h1{font-size:30px;font-weight:300;letter-spacing:-.03em;margin:6px 0 4px}#adm h3{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:26px 0 10px}#adm .sub{color:var(--soft);font-size:13px}'+
  '#adm .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}#adm .k{background:var(--panel);border:1px solid var(--line1);border-radius:16px;padding:14px}#adm .k b{display:block;font-size:26px;font-weight:300;letter-spacing:-.03em;line-height:1.1;margin-top:6px}#adm .k span{font-size:12px;color:var(--soft)}'+
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
      '<h3>Payout wallet</h3><div class="box"><div class="row"><span>Sends SOL to users who withdraw to their wallet<small>'+esc(o.payoutWallet.address||o.payoutWallet.error||"")+'</small></span><b>'+(o.payoutWallet.sol||0).toFixed(3)+' SOL<br>'+(o.payoutWallet.usdc||0).toFixed(2)+' USDC</b></div><div class="sub">Devnet only. If it runs low, send devnet SOL (faucet.solana.com) or devnet USDC (faucet.circle.com) to the address above.</div></div>'+
      '<h3>Problems ('+o.problems.length+')</h3><div class="box">'+(o.problems.length?o.problems.map(p=>'<div class="row"><span>'+esc(p.text)+'<small>'+esc(p.area)+(p.ref?' · '+esc(p.ref):'')+'</small></span><span class="tag '+p.level+'">'+p.level+'</span></div>').join(""):'<span class="ok">Nothing wrong right now.</span>')+'</div>'+
      '<h3>Clean up</h3><div class="box" id="admEmp"><span class="sub">Checking…</span></div>'+
      '<h3>Analytics</h3><div class="box" id="admAn"></div>'+
      '<h3>Solana proof</h3><div class="box"><div class="row"><span>Records<small>'+o.proof.confirmed+' of '+o.proof.total+' confirmed on devnet</small></span><span class="tag '+(o.proof.brokenChains?'high':'low')+'">'+(o.proof.brokenChains?o.proof.brokenChains+' broken':'chains ok')+'</span></div></div>'+
      '<h3>Latest activity</h3><div class="box">'+(o.recent.map(r=>'<div class="row"><span>'+esc(r.title)+' · '+esc(r.who)+'<small>'+T(r.at)+(r.circle?' · '+esc(r.circle):'')+' · '+esc(r.id)+'</small></span><b>'+(r.amount?N(r.amount):'')+'</b></div>').join("")||'<span class="sub">Nothing yet.</span>')+'</div>'+
      '<h3>Trace anything</h3><input id="admQ" placeholder="Receipt id, reference, circle id, email, name, wallet or Solana signature" autocomplete="off"><div id="admR" style="margin-top:12px"></div></div>';
      document.getElementById("admX").onclick=()=>el.classList.remove("on");
      loadEmpties(); analytics();
      let tm; document.getElementById("admQ").oninput=e=>{clearTimeout(tm);tm=setTimeout(()=>trace(e.target.value),350);};
    }catch(e){ el.innerHTML='<div class="in"><button class="x" id="admX">Close</button><p>'+esc(e.message)+'</p></div>'; document.getElementById("admX").onclick=()=>el.classList.remove("on"); }
  }
  const pref=(k,d)=>{try{return localStorage.getItem(k)||d;}catch(e){return d;}}, setPref=(k,v)=>{try{localStorage.setItem(k,v);}catch(e){}};
  const METRICS=[["users","Users",0],["circles","Circles",0],["funded","Funded in",1],["payments","Paid into circles",1],["payouts","Paid out",1],["withdrawn","Sent to banks",1],["fees","Fees",1],["failed","Failed",0]];
  function draw(vals,labels,style,money){
    const W=640,H=200,L=8,R=8,Tp=14,B=22,pw=W-L-R,ph=H-Tp-B,mx=Math.max(1,...vals),n=vals.length,x=i=>L+(n===1?pw/2:i*pw/(n-1)),y=v=>Tp+ph-v/mx*ph;
    let g='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+(Tp+ph)+'" y2="'+(Tp+ph)+'" stroke="var(--line2)"/><line x1="'+L+'" x2="'+(W-R)+'" y1="'+Tp+'" y2="'+Tp+'" stroke="var(--line1)" stroke-dasharray="3 4"/><text x="'+L+'" y="'+(Tp-3)+'" font-size="10" fill="var(--dim)">'+(money?N(mx):mx)+'</text>';
    if(style==="bar"){ const bw=Math.max(2,pw/n*.7); vals.forEach((v,i)=>{ const cx=L+(i+.5)*pw/n; g+='<rect x="'+(cx-bw/2)+'" y="'+y(v)+'" width="'+bw+'" height="'+Math.max(1,Tp+ph-y(v))+'" rx="2" fill="var(--green)" opacity=".9"><title>'+labels[i]+': '+(money?N(v):v)+'</title></rect>'; }); }
    else { const pts=vals.map((v,i)=>x(i)+","+y(v)).join(" "); g+='<polygon points="'+x(0)+","+(Tp+ph)+" "+pts+" "+x(n-1)+","+(Tp+ph)+'" fill="var(--green)" opacity=".12"/><polyline points="'+pts+'" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'+(n<=40?vals.map((v,i)=>'<circle cx="'+x(i)+'" cy="'+y(v)+'" r="3.5" fill="var(--green)"><title>'+labels[i]+': '+(money?N(v):v)+'</title></circle>').join(""):""); }
    const step=Math.max(1,Math.ceil(n/6)); labels.forEach((l,i)=>{ if(i%step===0||i===n-1){ const cx=style==="bar"?L+(i+.5)*pw/n:x(i); g+='<text x="'+cx+'" y="'+(H-6)+'" font-size="10" text-anchor="middle" fill="var(--dim)">'+l+'</text>'; } });
    return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="chart" style="display:block">'+g+'</svg>';
  }
  async function analytics(){
    const box=document.getElementById("admAn"); if(!box) return;
    let range=pref("adm-range","7d"), style=pref("adm-style","bar"), met=pref("adm-met","funded"), data=null;
    const seg=(items,cur,k)=>'<div class="themeseg" style="margin:0">'+items.map(i=>'<button data-'+k+'="'+i[0]+'" aria-pressed="'+(cur===i[0])+'">'+i[1]+'</button>').join("")+'</div>';
    async function load(){ box.style.opacity=.6; try{ data=await api("/api/admin/series?range="+range); }catch(e){ box.innerHTML='<span class="sub">'+esc(e.message)+'</span>'; return; } box.style.opacity=1; paint(); }
    function paint(){
      const m=METRICS.find(x=>x[0]===met)||METRICS[0], tot=data.totals;
      box.innerHTML='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">'+seg([["1d","1 day"],["7d","1 week"],["30d","30 days"],["all","All"]],range,"r")+seg([["bar","Bars"],["line","Line"]],style,"s")+'</div>'+
        '<div class="grid" style="margin-bottom:12px">'+METRICS.map(x=>'<button class="k" data-m="'+x[0]+'" style="text-align:left;color:inherit;font:inherit;cursor:pointer;'+(x[0]===m[0]?'border-color:var(--green)':'')+'"><span>'+x[1]+'</span><b style="font-size:20px">'+(x[2]?N(tot[x[0]]):tot[x[0]].toLocaleString())+'</b></button>').join("")+'</div>'+
        '<div class="row" style="border:0;padding:0 0 6px"><span><b>'+m[1]+'</b><small>per '+data.unit+' · Lagos time</small></span></div>'+draw(data.m[m[0]],data.labels,style,m[2]);
      box.querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{range=b.dataset.r;setPref("adm-range",range);load();});
      box.querySelectorAll("[data-s]").forEach(b=>b.onclick=()=>{style=b.dataset.s;setPref("adm-style",style);paint();});
      box.querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>{met=b.dataset.m;setPref("adm-met",met);paint();});
    }
    load();
  }
  async function loadEmpties(){
    const b=document.getElementById("admEmp"); if(!b) return;
    try{
      const l=await api("/api/admin/empties");
      if(!l.length){ b.innerHTML='<span class="ok">No empty circles. All clean.</span>'; return; }
      b.innerHTML='<div class="sub" style="margin-bottom:8px">'+l.length+' empty circle(s): only the creator inside, no money, nothing on Solana.</div>'+l.map(c=>'<div class="row"><span>'+esc(c.name)+'<small>'+esc(c.id)+' · '+esc(c.owner)+' · '+T(c.created)+'</small></span></div>').join("")+'<button class="x" id="admDel" style="position:static;float:none;margin-top:10px;width:100%">Delete these '+l.length+'</button>';
      const btn=document.getElementById("admDel"); let armed=false;
      btn.onclick=async()=>{ if(!armed){ armed=true; btn.textContent="Tap again to delete for good"; setTimeout(()=>{ armed=false; btn.textContent="Delete these "+l.length; },5000); return; }
        btn.disabled=true; try{ const r=await api("/api/admin/cleanup",{body:{ids:l.map(c=>c.id)}}); toast("Deleted "+r.deleted); }catch(e){ toast(e.message); } open(); };
    }catch(e){ b.innerHTML='<span class="sub">'+esc(e.message)+'</span>'; }
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
