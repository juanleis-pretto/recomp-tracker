import { parseD, dow, fmtShort } from "./util.js";

/* dependency-free SVG charts */
export function lineChart(series, opts={}){
  // series: [{pts:[[dateStr,val]], color, r, width, dashed}]
  const W=opts.w||560, H=opts.h||180, P={l:34,r:8,t:10,b:20};
  const all = series.flatMap(s=>s.pts);
  if (!all.length) return `<div class="center">No data yet</div>`;
  const xs = all.map(p=>parseD(p[0]).getTime()), ys = all.map(p=>p[1]);
  let x0=Math.min(...xs), x1=Math.max(...xs); if(x0===x1){x0-=864e5;x1+=864e5;}
  let y0=Math.min(...ys), y1=Math.max(...ys);
  const padY=(y1-y0)*0.12||1; y0-=padY; y1+=padY;
  if (opts.yline!=null){ y0=Math.min(y0,opts.yline-padY); y1=Math.max(y1,opts.yline+padY); }
  const X=t=>P.l+(t-x0)/(x1-x0)*(W-P.l-P.r), Y=v=>H-P.b-(v-y0)/(y1-y0)*(H-P.t-P.b);
  let g="";
  for(let i=0;i<=3;i++){ const v=y0+(y1-y0)*i/3, y=Y(v);
    g+=`<line x1="${P.l}" y1="${y}" x2="${W-P.r}" y2="${y}" stroke="#2b3442" stroke-width="1"/>
        <text x="${P.l-5}" y="${y+4}" text-anchor="end" font-size="10" fill="#5a6675">${(Math.round(v*10)/10)}</text>`; }
  const uniq=[...new Set(all.map(p=>p[0]))].sort();
  for (const dd of [uniq[0], uniq[Math.floor(uniq.length/2)], uniq[uniq.length-1]]){
    const x=X(parseD(dd).getTime());
    g+=`<text x="${x}" y="${H-5}" text-anchor="middle" font-size="10" fill="#5a6675">${fmtShort(dd)}</text>`;
  }
  if (opts.yline!=null)
    g+=`<line x1="${P.l}" y1="${Y(opts.yline)}" x2="${W-P.r}" y2="${Y(opts.yline)}" stroke="${opts.ylineColor||'#e3b341'}" stroke-dasharray="4 4" stroke-width="1"/>`;
  for (const s of series){
    const pts=s.pts.slice().sort((a,b)=>a[0]<b[0]?-1:1);
    const path=pts.map((p,i)=>(i?"L":"M")+X(parseD(p[0]).getTime()).toFixed(1)+" "+Y(p[1]).toFixed(1)).join(" ");
    if (pts.length>1) g+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.width||2}" ${s.dashed?'stroke-dasharray="5 4"':''} stroke-linejoin="round"/>`;
    if (s.r) for(const p of pts) g+=`<circle cx="${X(parseD(p[0]).getTime()).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${s.r}" fill="${s.color}"/>`;
  }
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}</svg></div>`;
}

export function barChart(days, vals, opts={}){
  const W=560, H=150, P={l:34,r:8,t:8,b:18};
  const nums=vals.filter(v=>v!=null);
  if(!nums.length) return `<div class="center">No data yet</div>`;
  let y1=Math.max(...nums, opts.target||0)*1.1;
  const bw=(W-P.l-P.r)/days.length;
  const Y=v=>H-P.b-(v/y1)*(H-P.t-P.b);
  let g="";
  for(let i=0;i<days.length;i++){
    const v=vals[i]; if(v==null) continue;
    const cheat = opts.cheatDow!=null && dow(days[i])===opts.cheatDow;
    let col = "#4da3ff";
    if (opts.floorMode==="below" && v<opts.target) col="#f85149";
    if (opts.floorMode==="above" && v>opts.target*1.05) col="#f85149";
    if (opts.floorMode==="below" && v>=opts.target) col="#3fb950";
    if (cheat) col="#bc8cff";
    const x=P.l+i*bw, y=Y(v);
    g+=`<rect x="${(x+1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1,bw-2).toFixed(1)}" height="${(H-P.b-y).toFixed(1)}" fill="${col}" rx="1"/>`;
  }
  if(opts.target) g+=`<line x1="${P.l}" y1="${Y(opts.target)}" x2="${W-P.r}" y2="${Y(opts.target)}" stroke="#e3b341" stroke-dasharray="4 4"/>
    <text x="${P.l-5}" y="${Y(opts.target)+4}" text-anchor="end" font-size="10" fill="#e3b341">${opts.target}</text>`;
  g+=`<text x="${P.l}" y="${H-4}" font-size="10" fill="#5a6675">${fmtShort(days[0])}</text>
      <text x="${W-P.r}" y="${H-4}" text-anchor="end" font-size="10" fill="#5a6675">${fmtShort(days[days.length-1])}</text>`;
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}</svg></div>`;
}
