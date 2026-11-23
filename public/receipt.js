/* Receipts as an image or a PDF. Drawn in the browser on a canvas, so nothing is sent anywhere and no library is needed. */
const RC_LOGO='<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4DE19B"/><stop offset="1" stop-color="#27BA77"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><circle cx="32" cy="32" r="17" fill="none" stroke="#0B0F0D" stroke-opacity=".35" stroke-width="1.5"/><circle cx="32" cy="15" r="6" fill="#0B0F0D"/><circle cx="46.7" cy="23.5" r="4.2" fill="#0B0F0D"/><circle cx="46.7" cy="40.5" r="4.2" fill="#0B0F0D"/><circle cx="32" cy="49" r="4.2" fill="#0B0F0D"/><circle cx="17.3" cy="40.5" r="4.2" fill="#0B0F0D"/><circle cx="17.3" cy="23.5" r="4.2" fill="#0B0F0D"/></svg>';

// Break text into lines that fit a width. Very long words (like references) are split by letter.
function rcWrap(ctx,text,maxW){
  const out=[]; let line="";
  for(const w of String(text).split(" ")){
    let word=w;
    while(ctx.measureText(word).width>maxW){
      let i=word.length; while(i>1&&ctx.measureText(word.slice(0,i)).width>maxW) i--;
      if(line){ out.push(line); line=""; }
      out.push(word.slice(0,i)); word=word.slice(i);
    }
    const t=line?line+" "+word:word;
    if(ctx.measureText(t).width>maxW&&line){ out.push(line); line=word; } else line=t;
  }
  if(line) out.push(line);
  return out;
}

async function receiptCanvas(r){
  try{ await document.fonts.ready; }catch(e){}
  const FONT='"Poppins","Helvetica Neue",Arial,sans-serif', W=1080, P=80, IW=W-2*P, LH=54, RH=48;
  const ok=/^(successful|success|received)$/i.test(r.status||"Successful");
  const rows=[["Receipt",r.id],["Date",new Date(r.at).toLocaleString("en-NG",{dateStyle:"medium",timeStyle:"short"})],r.circleName&&["Circle",r.circleName],["Reference",r.reference||r.id],["Status",r.status||"Successful"]].filter(Boolean);
  const cv=document.createElement("canvas"), ctx=cv.getContext("2d");
  ctx.font="400 38px "+FONT; const sum=rcWrap(ctx,r.summary||"",IW);
  ctx.font="500 34px "+FONT; const vals=rows.map(x=>rcWrap(ctx,x[1],IW-300));
  const note=(ctx.font="400 28px "+FONT,rcWrap(ctx,"Test money. AjoLabs runs on Paga's sandbox, so this is a record of a test transaction, not proof of a real bank transfer.",IW));
  // work out the height first, then draw
  let H=P+110+70+96+62;                       // header, status pill, title
  if(r.amount!=null) H+=124;                  // big amount
  H+=64+sum.length*LH+24;                     // summary
  vals.forEach(v=>{ H+=44+Math.max(1,v.length)*RH; });
  H+=30+note.length*40+36+P-50;
  cv.width=W; cv.height=H;
  ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,W,H); ctx.fillStyle="#3fd68b"; ctx.fillRect(0,0,W,14);
  const logo=await new Promise(res=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>res(null); i.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(RC_LOGO); });
  if(logo) ctx.drawImage(logo,P,P+10,96,96);
  ctx.fillStyle="#0b1a12"; ctx.font="600 48px "+FONT; ctx.fillText("AjoLabs",P+120,P+78);
  let y=P+110+70;
  const label=ok?"Successful":(r.status||"Pending"); ctx.font="600 30px "+FONT; const pw=ctx.measureText(label).width+56;
  ctx.fillStyle=ok?"#e3f8ec":"#fdecec"; ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(P,y-46,pw,64,32); else ctx.rect(P,y-46,pw,64); ctx.fill();
  ctx.fillStyle=ok?"#0a7a3d":"#b42318"; ctx.fillText(label,P+28,y-3);
  y+=96; ctx.fillStyle="#0b1a12"; ctx.font="600 62px "+FONT; ctx.fillText(r.title,P,y);
  if(r.amount!=null){ y+=124; ctx.font="700 110px "+FONT; ctx.fillText(money(r.amount),P,y); }
  y+=64; ctx.fillStyle="#5b6b63"; ctx.font="400 38px "+FONT; sum.forEach(l=>{ ctx.fillText(l,P,y); y+=LH; });
  y+=24-RH+RH;                                // gap before the table
  rows.forEach((x,i)=>{
    ctx.strokeStyle="#e7ece9"; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(P,y-6); ctx.lineTo(W-P,y-6); ctx.stroke();
    y+=RH-4; ctx.fillStyle="#7b8a82"; ctx.font="400 32px "+FONT; ctx.fillText(x[0],P,y);
    ctx.fillStyle="#0b1a12"; ctx.font="500 34px "+FONT; ctx.textAlign="right";
    vals[i].forEach((l,k)=>ctx.fillText(l,W-P,y+k*RH)); ctx.textAlign="left";
    y+=(Math.max(1,vals[i].length)-1)*RH+40;
  });
  ctx.strokeStyle="#e7ece9"; ctx.beginPath(); ctx.moveTo(P,y-6); ctx.lineTo(W-P,y-6); ctx.stroke();
  y+=36; ctx.fillStyle="#7b8a82"; ctx.font="400 28px "+FONT; note.forEach(l=>{ ctx.fillText(l,P,y); y+=40; });
  ctx.fillStyle="#1f9d63"; ctx.font="600 30px "+FONT; ctx.fillText("ajolab.onrender.com",P,y+10);
  return cv;
}

const rcBlob=(cv,type,q)=>new Promise(res=>cv.toBlob(res,type,q));

// A one-page PDF that holds the receipt image (JPEG).
function pdfFromJpeg(jpg,w,h){
  const te=new TextEncoder(), chunks=[], offs=[]; let len=0;
  const put=x=>{ const b=typeof x==="string"?te.encode(x):x; chunks.push(b); len+=b.length; };
  const PW=420, PH=Math.round(PW*h/w*100)/100;
  put("%PDF-1.4\n");
  const o=(n,fn)=>{ offs[n]=len; put(n+" 0 obj\n"); fn(); put("endobj\n"); };
  o(1,()=>put("<< /Type /Catalog /Pages 2 0 R >>\n"));
  o(2,()=>put("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n"));
  o(3,()=>put("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+PW+" "+PH+"] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\n"));
  o(4,()=>{ put("<< /Type /XObject /Subtype /Image /Width "+w+" /Height "+h+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+jpg.length+" >>\nstream\n"); put(jpg); put("\nendstream\n"); });
  const cs="q "+PW+" 0 0 "+PH+" 0 0 cm /Im0 Do Q";
  o(5,()=>put("<< /Length "+cs.length+" >>\nstream\n"+cs+"\nendstream\n"));
  const xr=len; put("xref\n0 6\n0000000000 65535 f \n");
  for(let n=1;n<=5;n++) put(String(offs[n]).padStart(10,"0")+" 00000 n \n");
  put("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+xr+"\n%%EOF");
  return new Blob(chunks,{type:"application/pdf"});
}

function saveBlob(blob,name){ const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); }
const rcName=r=>"AjoLabs-receipt-"+String(r.id).replace(/[^\w-]/g,"");

// kind: "image", "pdf" or "share" (opens the phone's share sheet, or saves the image if sharing is not possible)
async function rcSave(r,kind){
  try{
    const cv=await receiptCanvas(r);
    if(kind==="pdf"){ const jb=await rcBlob(cv,"image/jpeg",0.92); const jpg=new Uint8Array(await jb.arrayBuffer()); saveBlob(pdfFromJpeg(jpg,cv.width,cv.height),rcName(r)+".pdf"); toast("PDF saved"); return; }
    const png=await rcBlob(cv,"image/png");
    if(kind==="share"){
      const f=new File([png],rcName(r)+".png",{type:"image/png"});
      if(navigator.canShare&&navigator.canShare({files:[f]})){ try{ await navigator.share({files:[f],title:r.title,text:r.summary}); return; }catch(e){ if(e&&e.name==="AbortError") return; } }
    }
    saveBlob(png,rcName(r)+".png"); toast(kind==="share"?"Saved. Share it from your gallery.":"Image saved");
  }catch(e){ toast("Could not make the receipt: "+e.message); }
}
const rcCanShare=()=>{ try{ return !!(navigator.canShare&&navigator.canShare({files:[new File(["x"],"a.png",{type:"image/png"})]})); }catch(e){ return false; } };
