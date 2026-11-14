const $=s=>document.querySelector(s);
const $$=s=>Array.from(document.querySelectorAll(s));
const REDUCE=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const NAMES=["You","Ada","Tunde","Ngozi","Emem","Bisi","Kemi","Uche","Efe","Imo"];
const fmt=n=>"\u20A6"+Number(n).toLocaleString("en-NG");
const short=n=>n>=1e6?"\u20A6"+(n/1e6).toFixed(n%1e6?1:0)+"M":n>=1e5?"\u20A6"+Math.round(n/1e3)+"k":"\u20A6"+Number(n).toLocaleString("en-NG");
const FONT='"Helvetica Neue","Segoe UI",system-ui,sans-serif';

/* ---------- segmented control with a sliding pill ---------- */
const segs=[];
function seg(el,opts,get,set,mode){
  const o={el,opts,get,set,mode:mode||"group",first:true};
  el.setAttribute("role",o.mode==="tabs"?"tablist":"group");
  o.place=function(){
    const ind=el.querySelector(".ind"), b=el.querySelector('button[data-v][aria-pressed="true"],button[data-v][aria-selected="true"]');
    if(!ind||!b||!b.offsetWidth) return;
    if(o.first){ind.style.transition="none";}
    ind.style.width=b.offsetWidth+"px";
    ind.style.transform="translateX("+b.offsetLeft+"px)";
    if(o.first){void ind.offsetWidth; ind.style.transition=""; o.first=false;}
  };
  o.render=function(){
    const cur=String(get());
    el.innerHTML='<span class="ind" aria-hidden="true"></span>'+opts.map(x=>{
      const on=String(x.v)===cur;
      return '<button type="button" data-v="'+x.v+'" '+(o.mode==="tabs"?'role="tab" aria-selected="'+on+'"':'aria-pressed="'+on+'"')+'>'+x.l+'</button>';
    }).join("");
    o.place();
  };
  el.addEventListener("click",e=>{
    const b=e.target.closest("button[data-v]"); if(!b) return;
    set(b.dataset.v); o.render();
  });
  segs.push(o); o.render();
  return o;
}
function placeAll(){segs.forEach(o=>o.place());}
window.addEventListener("resize",placeAll);

/* ---------- Orbit: the circle visual ---------- */
const orbits=[];
function pillPath(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
class Orbit{
  constructor(canvas,getState,isOn){
    this.cv=canvas; this.ctx=canvas.getContext("2d"); this.get=getState; this.isOn=isOn||(()=>true);
    this.off=0; this.fill=0; this.parts=[]; this.bursts=[]; this.shock=-1; this.flash=0; this.pulse=0; this.hover=-1;
    this.S=360; this.cx=180; this.cy=180;
    canvas.addEventListener("pointermove",e=>this.pick(e));
    canvas.addEventListener("pointerdown",e=>this.pick(e));
    canvas.addEventListener("pointerleave",()=>{this.hover=-1;});
    orbits.push(this);
  }
  pos(i,n){const th=-Math.PI/2+(i-this.off)*2*Math.PI/n;return {x:this.cx+118*Math.cos(th),y:this.cy+118*Math.sin(th)};}
  pick(e){
    const r=this.cv.getBoundingClientRect(), x=(e.clientX-r.left)/r.width*this.S, y=(e.clientY-r.top)/r.height*this.S;
    const s=this.get(); let best=-1,bd=1e9;
    for(let i=0;i<s.size;i++){const p=this.pos(i,s.size),d=Math.hypot(p.x-x,p.y-y); if(d<30&&d<bd){bd=d;best=i;}}
    this.hover=best;
  }
  payout(){
    this.shock=0;
    for(let k=0;k<28;k++) this.bursts.push({t:-k*0.035,sp:1.0+Math.random()*.5,j:Math.random()*2-1});
  }
  frame(time,dt){
    const cv=this.cv, r=cv.getBoundingClientRect();
    if(!r.width||r.bottom<0||r.top>innerHeight||!this.isOn()) return;
    const dpr=Math.min(2,window.devicePixelRatio||1), px=Math.round(r.width*dpr);
    if(cv.width!==px){cv.width=px;cv.height=px;}
    const ctx=this.ctx, k=cv.width/this.S, cx=this.cx, cy=this.cy, T=REDUCE?0:time;
    ctx.setTransform(k,0,0,k,0,0); ctx.clearRect(0,0,this.S,this.S);
    ctx.textAlign="center"; ctx.textBaseline="middle";
    const s=this.get(), n=s.size;
    const tOff=s.active?(s.done?n-1:s.round-1):0;
    this.off+=(tOff-this.off)*(REDUCE?1:Math.min(1,dt*3));
    const tFill=s.active?(s.done?1:s.paid.size/n):0;
    this.fill+=(tFill-this.fill)*(REDUCE?1:Math.min(1,dt*2.5));

    // ambient glow
    let g=ctx.createRadialGradient(cx,cy,10,cx,cy,176);
    g.addColorStop(0,"rgba(63,214,139,.16)"); g.addColorStop(1,"rgba(63,214,139,0)");
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,176,0,7); ctx.fill();

    // outer ring: one arc per round, turns with the wheel
    const step=2*Math.PI/n, gap=Math.min(.07,step*.2);
    ctx.lineWidth=7; ctx.lineCap="round";
    for(let q=0;q<n;q++){
      const th=-Math.PI/2+(q-this.off)*step;
      const done=s.active&&(s.done||q<s.round-1), cur=s.active&&!s.done&&q===s.round-1;
      ctx.strokeStyle=done?"rgba(169,239,200,.85)":cur?"rgba(169,239,200,"+(.6+.4*Math.sin(T*3)).toFixed(3)+")":"#262B30";
      ctx.beginPath(); ctx.arc(cx,cy,168,th-step/2+gap,th+step/2-gap); ctx.stroke();
    }

    // orbit track
    ctx.save(); ctx.setLineDash([2,7]); ctx.lineDashOffset=-T*10; ctx.strokeStyle="rgba(255,255,255,.12)"; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.arc(cx,cy,118,0,7); ctx.stroke(); ctx.restore();

    // node positions and tethers
    const P=[]; for(let i=0;i<n;i++) P.push(this.pos(i,n));
    for(let i=0;i<s.members.length&&i<n;i++){
      const p=P[i], paid=s.active&&s.paid.has(i);
      ctx.strokeStyle=paid?"rgba(169,239,200,.30)":"rgba(255,255,255,.07)"; ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(cx+(p.x-cx)*.5,cy+(p.y-cy)*.5); ctx.stroke();
    }

    // contribution particles flow from paid members into the vault
    if(!REDUCE&&s.active&&!s.done){
      for(let i=0;i<s.members.length&&i<n;i++){
        if(s.paid.has(i)&&Math.random()<dt*1.4) this.parts.push({i:i,t:0,sp:.5+Math.random()*.4,o:Math.random()*2-1});
      }
    }
    this.parts=this.parts.filter(q=>{
      q.t+=q.sp*dt;
      if(q.t>=1){this.pulse=Math.min(1,this.pulse+.25);return false;}
      if(q.i>=n) return false;
      const p=P[q.i], ex=cx+(p.x-cx)*.5, ey=cy+(p.y-cy)*.5;
      const mx=(p.x+ex)/2-(ey-p.y)*.18*q.o, my=(p.y+ey)/2+(ex-p.x)*.18*q.o, u=q.t, a=(1-u)*(1-u), b=2*(1-u)*u, c=u*u;
      const x=a*p.x+b*mx+c*ex, y=a*p.y+b*my+c*ey;
      ctx.globalAlpha=Math.sin(Math.PI*u)*.95; ctx.fillStyle="#C8FFE0"; ctx.shadowColor="rgba(169,239,200,.9)"; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.arc(x,y,2.2,0,7); ctx.fill(); ctx.shadowBlur=0; ctx.globalAlpha=1;
      return true;
    });

    // the vault: a glass orb that fills with light as members pay
    this.pulse*=Math.pow(.02,dt); this.flash*=Math.pow(.05,dt);
    const R=54+(REDUCE?0:Math.sin(T*1.6)*1.5)+this.pulse*3;
    ctx.save(); ctx.shadowColor="rgba(63,214,139,"+(.35+.3*this.fill).toFixed(2)+")"; ctx.shadowBlur=36;
    ctx.fillStyle="#0B100D"; ctx.beginPath(); ctx.arc(cx,cy,R,0,7); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx,cy,R-1.5,0,7); ctx.clip();
    const top=cy+R-this.fill*(2*R), amp=(this.fill>.02&&this.fill<.985)?3.2:.6;
    const lg=ctx.createLinearGradient(0,top,0,cy+R); lg.addColorStop(0,"rgba(190,250,215,.95)"); lg.addColorStop(1,"rgba(40,150,100,.9)");
    ctx.fillStyle=lg; ctx.beginPath(); ctx.moveTo(cx-R,cy+R);
    for(let x=-R;x<=R;x+=3) ctx.lineTo(cx+x,top+Math.sin(x*.09+T*2.4)*amp);
    ctx.lineTo(cx+R,cy+R); ctx.closePath(); ctx.fill();
    ctx.globalAlpha=.35; ctx.fillStyle="#E6FFF1"; ctx.beginPath(); ctx.moveTo(cx-R,cy+R);
    for(let x=-R;x<=R;x+=3) ctx.lineTo(cx+x,top+Math.sin(x*.07+T*1.7+1.5)*amp*.75);
    ctx.lineTo(cx+R,cy+R); ctx.closePath(); ctx.fill(); ctx.globalAlpha=1;
    ctx.restore();
    ctx.strokeStyle="rgba(255,255,255,.2)"; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(cx,cy,R,0,7); ctx.stroke();
    ctx.strokeStyle="rgba(255,255,255,.28)"; ctx.lineWidth=2.5; ctx.lineCap="round";
    ctx.beginPath(); ctx.arc(cx,cy,R-7,Math.PI*1.08,Math.PI*1.42); ctx.stroke();

    let l1,l2;
    if(s.empty){l1="AjoLabs";l2="no circle yet";}
    else if(!s.active){l1=s.members.length+"/"+n;l2="seats filled";}
    else if(s.done){l1="Done";l2="everyone paid out";}
    else{l1=short(s.paid.size*s.amt);l2="of "+short(s.amt*n);}
    const dark=this.fill>.55&&s.active&&!s.done;
    ctx.fillStyle=dark?"#06130C":"#F3F5F6"; ctx.font="600 24px "+FONT; ctx.fillText(l1,cx,cy-4);
    ctx.fillStyle=dark?"rgba(6,19,12,.75)":"#9AA3A9"; ctx.font="11px "+FONT; ctx.fillText(l2,cx,cy+17);

    // payout shock ring and light streaming to the recipient
    if(this.shock>=0){
      this.shock+=dt*1.1; const u=this.shock;
      if(u>1) this.shock=-1;
      else{ctx.strokeStyle="rgba(169,239,200,"+((1-u)*.7).toFixed(3)+")"; ctx.lineWidth=3*(1-u)+.5; ctx.beginPath(); ctx.arc(cx,cy,R+u*(168-R),0,7); ctx.stroke();}
    }
    const rp=P[Math.max(0,Math.min(n-1,s.round-1))];
    this.bursts=this.bursts.filter(b=>{
      b.t+=b.sp*dt;
      if(b.t<0) return true;
      if(b.t>=1){this.flash=1;return false;}
      const u=b.t, mx=(cx+rp.x)/2-(rp.y-cy)*.25*b.j, my=(cy+rp.y)/2+(rp.x-cx)*.25*b.j, a=(1-u)*(1-u), bb=2*(1-u)*u, c=u*u;
      const x=a*cx+bb*mx+c*rp.x, y=a*cy+bb*my+c*rp.y;
      ctx.fillStyle="#fff"; ctx.shadowColor="rgba(169,239,200,1)"; ctx.shadowBlur=14; ctx.globalAlpha=.9;
      ctx.beginPath(); ctx.arc(x,y,3,0,7); ctx.fill(); ctx.shadowBlur=0; ctx.globalAlpha=1;
      return true;
    });

    // members
    for(let i=0;i<n;i++){
      const p=P[i], filled=i<s.members.length, paid=s.active&&s.paid.has(i), late=s.active&&s.late.has(i), rec=s.active&&!s.done&&i===s.round-1, rr=rec?25:21;
      if(!filled){
        ctx.setLineDash([3,4]); ctx.strokeStyle="rgba(255,255,255,.3)"; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(p.x,p.y,rr,0,7); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle="rgba(255,255,255,.35)"; ctx.font="300 20px "+FONT; ctx.fillText("+",p.x,p.y+1);
        continue;
      }
      if(rec){
        ctx.strokeStyle="rgba(169,239,200,"+Math.max(0,Math.min(1,.45+.4*Math.sin(T*3)+this.flash*.5)).toFixed(3)+")"; ctx.lineWidth=2.5;
        ctx.beginPath(); ctx.arc(p.x,p.y,rr+7+this.flash*4,0,7); ctx.stroke();
      }
      const gr=ctx.createRadialGradient(p.x-rr*.35,p.y-rr*.4,2,p.x,p.y,rr);
      if(late){gr.addColorStop(0,"#FFD2C9");gr.addColorStop(.45,"#E0705C");gr.addColorStop(1,"#7E2214");}
      else if(paid){gr.addColorStop(0,"#F2FFF8");gr.addColorStop(.4,"#8CF0BE");gr.addColorStop(1,"#2A9566");}
      else{gr.addColorStop(0,"#3A4147");gr.addColorStop(1,"#1A1E22");}
      ctx.shadowColor=paid?"rgba(63,214,139,.55)":"rgba(0,0,0,.5)"; ctx.shadowBlur=paid?16:10;
      ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(p.x,p.y,rr,0,7); ctx.fill(); ctx.shadowBlur=0;
      if(!paid&&!late){ctx.strokeStyle="rgba(255,255,255,.2)"; ctx.lineWidth=1.2; ctx.stroke();}
      ctx.fillStyle=paid?"#04130B":(late?"#fff":"#D5DBDF"); ctx.font="600 "+(rec?15:13)+"px "+FONT;
      ctx.fillText((s.members[i]||"?").charAt(0).toUpperCase(),p.x,p.y+1);
      if(paid){
        const bx=p.x+rr*.72, by=p.y+rr*.72;
        ctx.fillStyle="#0E1113"; ctx.beginPath(); ctx.arc(bx,by,6.5,0,7); ctx.fill();
        ctx.strokeStyle="#A9EFC8"; ctx.lineWidth=1.4; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx-2.6,by+.2); ctx.lineTo(bx-.7,by+2.2); ctx.lineTo(bx+2.8,by-2);
        ctx.lineWidth=1.5; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.stroke();
      }
      if(rec){ctx.fillStyle="#A9EFC8"; ctx.font="600 9px "+FONT; ctx.fillText("RECEIVES",p.x,p.y-rr-13);}
    }

    // hover or tap label
    if(this.hover>=0&&this.hover<n){
      const i=this.hover, p=P[i], has=i<s.members.length, nm=has?s.members[i]:"Open seat", st=[];
      if(has){
        if(!s.active) st.push("seated");
        else{ if(s.late.has(i)) st.push("late"); else if(s.paid.has(i)) st.push("paid"); else st.push("waiting"); if(!s.done&&i===s.round-1) st.push("receives"); }
      }
      const label=nm+(st.length?" - "+st.join(", "):"");
      ctx.font="600 11px "+FONT; const w=ctx.measureText(label).width+20, h=24;
      const x=Math.max(6,Math.min(this.S-w-6,p.x-w/2)), y=(p.y+52>this.S)?p.y-52:p.y+30;
      pillPath(ctx,x,y,w,h,12); ctx.fillStyle="rgba(10,12,14,.96)"; ctx.fill(); ctx.strokeStyle="rgba(255,255,255,.22)"; ctx.lineWidth=1; ctx.stroke();
      ctx.fillStyle="#F3F5F6"; ctx.fillText(label,x+w/2,y+h/2+1);
    }
  }
}
let lastT=performance.now();
function loop(now){
  const dt=Math.min(.05,(now-lastT)/1000); lastT=now;
  for(const o of orbits) o.frame(now/1000,dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ---------- site: header, menu, copy ---------- */
const topEl=$("#top");
window.addEventListener("scroll",()=>topEl.classList.toggle("scrolled",window.scrollY>8),{passive:true});
const menuBtn=$("#menuBtn"), menuSheet=$("#menuSheet");
function setMenu(open){menuSheet.classList.toggle("open",open); menuBtn.setAttribute("aria-expanded",open);}
menuBtn.onclick=()=>setMenu(!menuSheet.classList.contains("open"));
menuSheet.addEventListener("click",e=>{if(e.target.closest("a,button")) setMenu(false);});
document.querySelectorAll("[data-copy]").forEach(b=>b.onclick=()=>{
  const txt=document.getElementById(b.dataset.copy).textContent, lab=b.querySelector("span");
  const done=()=>{lab.textContent="Copied"; setTimeout(()=>{lab.textContent="Copy";},1400);};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done).catch(done);} else done();
});
document.addEventListener("pointermove",e=>{
  const el=e.target&&e.target.closest?e.target.closest(".spot"):null; if(!el) return;
  const r=el.getBoundingClientRect(); el.style.setProperty("--mx",(e.clientX-r.left)+"px"); el.style.setProperty("--my",(e.clientY-r.top)+"px");
});

