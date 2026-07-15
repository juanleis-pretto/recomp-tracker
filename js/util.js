export const pad = n => String(n).padStart(2,"0");
export const dstr = d => d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
export const today = () => dstr(new Date());
export const parseD = s => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
export const dow = s => parseD(s).getDay();
export const fmtShort = s => parseD(s).toLocaleDateString(undefined,{month:"short",day:"numeric"});
export const fmtLong = s => parseD(s).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"});
export const fmtTime = ts => new Date(ts).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
export const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
export const epley = (w,r) => w * (1 + r/30);
// tolerant numeric parse: "132.5", "132,5", " 132.5 " → 132.5; junk → 0
export const num = v => { const n = parseFloat(String(v).replace(",",".").trim()); return isFinite(n) ? n : 0; };
export const lastNDays = n => { const out=[],d=new Date(); for(let i=n-1;i>=0;i--){const x=new Date(d); x.setDate(d.getDate()-i); out.push(dstr(x));} return out; };
export function toast(msg){
  const t=document.getElementById("toast"); if(!t) return;
  t.textContent=msg; t.classList.add("show");
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove("show"),1600);
}
