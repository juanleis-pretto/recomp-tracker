import { CFG, MEAL_LABELS } from "./config.js";
import { DB, Store } from "./store.js";
import { today, parseD, dstr, dow, fmtShort, fmtLong, fmtTime, esc, epley, lastNDays, toast, num } from "./util.js";
import { dayTotals, blocks, newBlock, attachBlock, loggedSets, daySetCount, blockHasContent, dayDone,
         allExercises, allLoggedExercises, exPrescription, exHistory, readyToProgress, bestE1RM } from "./data.js";
import { lineChart, barChart } from "./charts.js";

/* ---------- ui state ---------- */
export const S = { selDate: today(), mealLabel: "Breakfast", addExSel: "", liftSel: CFG.keyLifts[0] };
let render = ()=>{}, go = ()=>{};
export function init(r, g){ render = r; go = g; }

/* ================= LOG (any day) ================= */
export function viewToday(){
  const d = S.selDate, isToday = d===today(), future = d>today();
  const bar = `<div class="card" style="padding:10px 14px"><div class="row">
    <button class="btn small fx" onclick="shiftDay(-1)">‹ prev</button>
    <input type="date" value="${d}" onchange="setDate(this.value)" style="text-align:center">
    <button class="btn small fx" onclick="shiftDay(1)">next ›</button>
  </div>${isToday?"":`<div class="muted" style="margin-top:6px;text-align:center">${future?"Upcoming day — preview only":"Editing a past day"} — <a href="#" style="color:var(--accent)" onclick="setDate('${today()}');return false">back to today</a></div>`}</div>`;
  if (future) return bar + plannedCard(d);
  return bar + (isToday?nags(d):"") + foodCard(d) + workoutCard(d) + bodyCard(d);
}
export function shiftDay(n){ const d=parseD(S.selDate); d.setDate(d.getDate()+n); S.selDate=dstr(d); S.addExSel=""; render(); }
export function setDate(v){ if(v){ S.selDate=v; S.addExSel=""; render(); } }

/* preview of a future day's prescribed session */
function plannedCard(d){
  const sid = CFG.split[dow(d)], s = CFG.sessions[sid];
  const isCheat = dow(d)===CFG.cheatDay;
  let html = `<div class="card"><h2>Planned — ${esc(s.name)}</h2>`;
  if (s.type==="rest") html += `<div class="center">Rest day. Nothing on the calendar.</div>`;
  else if (s.type==="run") html += `<div class="muted">${esc(s.detail)}</div>`;
  else {
    html += s.exercises.map(ex=>{
      const rx = `${ex.sets}×${ex.lo===ex.hi?ex.lo:ex.lo+"–"+ex.hi}${ex.unit?" "+ex.unit:""}${ex.note?" "+ex.note:""}`;
      const h = exHistory(ex.n);
      const last = h.length ? h[h.length-1] : null;
      const rdy = readyToProgress(ex.n);
      return `<div class="li"><div>${esc(ex.n)}<div class="sub">${rx}${last?` · last: ${last.sets.map(x=>`${x.w}×${x.r}`).join(", ")}`:""}</div></div>
        ${rdy?'<span class="badge good">▲ add weight</span>':""}</div>`;
    }).join("");
  }
  html += `</div>`;
  if (isCheat) html += `<div class="card"><h2>Food</h2><div class="muted">Cheat day — breakfast + lunch as normal, skip the snack, restaurant dinner. Part of the plan.</div></div>`;
  return html;
}

function nags(d){
  const dt = parseD(d); let out="";
  if (dt.getDay()===1 && DB.weight[d]==null && !DB.dismissed["w"+d])
    out += `<div class="nag"><span>Monday check-in: log your weight.</span><button class="btn small ghost" onclick="dismiss('w${d}')">Later</button></div>`;
  const monthKey = d.slice(0,7);
  const waistThisMonth = Object.keys(DB.waist).some(k=>k.slice(0,7)===monthKey);
  if (dt.getDate()===1 && !waistThisMonth && !DB.dismissed["m"+monthKey])
    out += `<div class="nag"><span>1st of the month: log waist + progress photo.</span><button class="btn small ghost" onclick="dismiss('m${monthKey}')">Later</button></div>`;
  return out;
}
export function dismiss(k){ DB.dismissed[k]=1; Store.save(); render(); }

/* ---------- food ---------- */
function foodCard(d){
  const meals = DB.meals[d]||[];
  const t = dayTotals(d);
  const T = CFG.targets;
  const pLeft = Math.max(0, T.protein - t.protein);
  const isCheat = dow(d)===CFG.cheatDay;
  const lblChips = MEAL_LABELS.map(l=>`<button class="${l===S.mealLabel?'on':''}"
    onclick="pickLabel('${l}',this)">${l}</button>`).join("");
  const list = meals.map((m,i)=>`<div class="li"><div>${m.label?`<b>${esc(m.label)}</b> — `:""}${esc(m.name)}<div class="sub">${m.cal} cal · ${m.protein}g protein</div></div>
    <button class="del" onclick="delMeal(${i})">✕</button></div>`).join("");
  const calPct = Math.min(100, t.cal/T.cal*100);
  const pPct = Math.min(100, t.protein/T.protein*100);
  return `<div class="card"><h2>Food ${isCheat?'<span class="badge" style="color:var(--cheat);border-color:#5a3f8f">cheat day — restaurant dinner planned</span>':''}</h2>
    <h3 style="margin-top:2px">Add meal</h3>
    <div class="seg" id="lblseg">${lblChips}</div>
    <div class="row"><input id="cmName" placeholder="What was it? (e.g. chipotle bowl)"></div>
    <div class="row" style="margin-top:8px">
      <input id="cmCal" class="num" inputmode="decimal" placeholder="Calories">
      <input id="cmPro" class="num" inputmode="decimal" placeholder="Protein g">
      <button class="btn primary fx" onclick="addCustom()">Add</button></div>
    ${list?`<div class="loggedlist">${list}</div>`:""}
    <div class="tot"><div class="tl"><span>Calories</span><span><b>${t.cal}</b> / ${T.cal}</span></div>
      <div class="bar"><i class="${t.cal>T.cal+60?'over':''}" style="width:${calPct}%"></i></div></div>
    <div class="tot"><div class="tl"><span>Protein</span><span><b>${t.protein}g</b> / ${T.protein}g</span></div>
      <div class="bar"><i class="${t.protein>=T.proteinFloor?'good':''}" style="width:${pPct}%"></i></div>
      <div class="hint">${pLeft>0?pLeft+"g protein left to hit target"+(t.protein>=T.proteinFloor?" (floor of "+T.proteinFloor+"g met ✓)":""):"Protein target hit ✓"}</div></div>
  </div>`;
}
export function pickLabel(l, el){ S.mealLabel=l; if(el) el.parentNode.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b===el)); }
export function addCustom(){
  const n=document.getElementById("cmName").value.trim();
  const c=num(document.getElementById("cmCal").value), p=num(document.getElementById("cmPro").value);
  if(!n||!c){ toast("Name + calories required"); return; }
  (DB.meals[S.selDate]=DB.meals[S.selDate]||[]).push({label:S.mealLabel, name:n, cal:c, protein:p});
  Store.save(); render();
}
export function delMeal(i){ DB.meals[S.selDate].splice(i,1); Store.save(); render(); }

/* ---------- workout (blocks of segments) ---------- */
function workoutCard(d){
  const sid = CFG.split[dow(d)];
  const s = CFG.sessions[sid];
  const arr = blocks(d);
  let html = `<div class="card"><h2>Workout${s.type!=="rest"?` — prescribed: ${esc(s.name)}`:""}</h2>`;
  if (s.type==="rest") html += `<div class="muted" style="margin-bottom:6px">Rest day per the program — but log anything you did anyway.</div>`;

  if (s.type==="lift"){
    html += s.exercises.map(ex=>{
      const done = daySetCount(d, ex.n);
      const rdy = readyToProgress(ex.n);
      const rx = `${ex.sets}×${ex.lo===ex.hi?ex.lo:ex.lo+"–"+ex.hi}${ex.unit?" "+ex.unit:""}${ex.note?" "+ex.note:""}`;
      return `<div class="li" style="cursor:pointer" onclick="selEx('${esc(ex.n)}')">
        <div>${esc(ex.n)}<div class="sub">${rx}${rdy?' · <span style="color:var(--good)">▲ hit top of range last time — add weight</span>':""}</div></div>
        <span class="badge ${done>=ex.sets?'good':''}">${done}/${ex.sets} sets</span></div>`;
    }).join("");
  }
  if (s.type==="run") html += `<div class="muted">${esc(s.detail)}</div>`;

  // ---- add exercise: pick Run or a lift; inputs appear per type ----
  if (s.type==="run" && !S.addExSel) S.addExSel = "__run";
  const opts = `<option value="" ${S.addExSel?"":"selected"} disabled>Choose: run or a lift…</option>
    <option value="__run" ${S.addExSel==="__run"?"selected":""}>🏃 Run</option>
    <optgroup label="Lifts">` +
    allExercises().map(e=>`<option value="${esc(e.n)}" ${e.n===S.addExSel?"selected":""}>${esc(e.n)}</option>`).join("") +
    `</optgroup>`;
  html += `<h3>Add exercise</h3><select onchange="selEx(this.value)">${opts}</select>`;

  const lastB = arr[arr.length-1];
  const joining = lastB && (d!==today() || (Date.now()-(lastB.t1||lastB.t0)) <= CFG.workoutWindowMs);
  const joinTxt = `<div class="muted" style="margin-top:6px">${joining?`→ adds to Workout ${arr.length}${d===today()&&lastB.t0?` (started ${fmtTime(lastB.t0)})`:""} · <a href="#" style="color:var(--accent)" onclick="startNewWorkout();return false">start a new workout instead</a>`:"→ starts a new workout"}</div>`;

  if (S.addExSel === "__run"){
    const runB = arr.find(b=>b.run&&(b.run.dist||b.run.dur||b.run.note));
    const r = (runB&&runB.run)||{};
    html += `<div class="row" style="margin-top:8px">
      <div><label class="fl">Distance (mi)</label><input id="rDist" class="num" inputmode="decimal" value="${r.dist??""}"></div>
      <div><label class="fl">Duration (min)</label><input id="rDur" class="num" inputmode="decimal" value="${r.dur??""}"></div>
      <div><label class="fl">Cal burned</label><input id="rCal" class="num" inputmode="decimal" value="${r.kcal||""}" placeholder="opt."></div></div>
    <label class="fl">Note</label><input id="rNote" value="${esc(r.note??"")}" placeholder="optional">
    <div style="margin-top:10px"><button class="btn primary" onclick="saveRun()">${runB?"Update run":"Save run"}</button></div>
    ${runB?"":joinTxt}`;
  } else if (S.addExSel){
    const selRx = exPrescription(S.addExSel);
    const h = exHistory(S.addExSel, d);
    const last = h.length ? h[h.length-1] : null;
    const nDone = daySetCount(d, S.addExSel);
    const pfW = last ? ((last.sets[Math.min(nDone,last.sets.length-1)]||{}).w ?? "") : "";
    html += `<div class="muted" style="margin:6px 0 2px">${last?`Last time (${fmtShort(last.date)}): ${last.sets.map(x=>`${x.w}×${x.r}`).join(", ")}`:"First time logging this"}${selRx?` · target ${selRx.sets}×${selRx.lo===selRx.hi?selRx.lo:selRx.lo+"–"+selRx.hi}`:""}</div>
    <div class="row" style="margin-top:8px">
      <input id="asW" class="num" inputmode="decimal" placeholder="${CFG.units.weight}" value="${pfW}">
      <input id="asR" class="num" inputmode="numeric" placeholder="${selRx&&selRx.unit==='sec'?'sec':'reps'}">
      <button class="btn primary fx" onclick="addSet()">Add set</button></div>
    ${joinTxt}`;
  }

  // logged workouts for the day
  arr.forEach((b,bi)=>{
    if (!blockHasContent(b) && !b.done) return;
    const timeTxt = b.t0 && dstr(new Date(b.t0))===d ? ` · ${fmtTime(b.t0)}${b.t1&&b.t1-b.t0>60e3?"–"+fmtTime(b.t1):""}` : "";
    let rows = Object.entries(b.sets||{}).map(([n,setsArr])=>{
      const ss = setsArr.filter(x=>x.w>0||x.r>0); if(!ss.length) return "";
      return `<div class="li"><div><b>${esc(n)}</b><div class="sub">${ss.map(x=>`${x.w}×${x.r}`).join(", ")}</div></div>
        <button class="del" title="remove last set" onclick="delLastSet('${b.id}','${esc(n)}')">⌫</button></div>`;
    }).join("");
    if (b.run&&(b.run.dist||b.run.dur)) rows += `<div class="li"><div><b>Run</b><div class="sub">${b.run.dist||"?"} mi / ${b.run.dur||"?"} min${b.run.kcal?` · ${b.run.kcal} cal`:""}${b.run.note?" — "+esc(b.run.note):""}</div></div></div>`;
    html += `<h3 style="display:flex;justify-content:space-between;align-items:center">Workout ${bi+1}${timeTxt}
      <button class="btn small ${b.done?'done':''}" onclick="toggleDone('${b.id}')">${b.done?"✓ done":"mark done"}</button></h3>
    <div class="loggedlist" style="margin-top:0">${rows}</div>`;
  });
  html += `</div>`;
  return html;
}
export function selEx(n){ S.addExSel=n; render(); const el=document.getElementById("asW"); if(el) el.focus(); }
export function addSet(){
  if(!S.addExSel){ toast("Pick an exercise first"); return; }
  const wv=num(document.getElementById("asW").value), rv=num(document.getElementById("asR").value);
  if(!rv){ toast("Enter reps"); return; }
  const b = attachBlock(S.selDate, S._forceNew); S._forceNew=false;
  (b.sets[S.addExSel]=b.sets[S.addExSel]||[]).push({w:wv, r:rv});
  Store.save(); render();
}
export function startNewWorkout(){ S._forceNew=true; toast("Next set starts a new workout"); render(); }
export function delLastSet(bid, n){
  const b = blocks(S.selDate).find(x=>x.id===bid);
  if(b&&b.sets[n]){ b.sets[n].pop(); if(!b.sets[n].length) delete b.sets[n]; Store.save(); render(); }
}
export function saveRun(){
  const dist=num(document.getElementById("rDist").value);
  const dur=num(document.getElementById("rDur").value);
  const note=document.getElementById("rNote").value.trim();
  const kcal=num(document.getElementById("rCal").value);
  if(!dist && !dur){ toast("Enter distance or duration"); return; }
  const arr = blocks(S.selDate);
  let b = arr.find(x=>x.run&&(x.run.dist||x.run.dur||x.run.note));
  if(!b){ b = attachBlock(S.selDate, S._forceNew); S._forceNew=false; }
  b.run = { dist, dur, note, kcal };
  b.t1 = Date.now();
  Store.save(); render(); toast("Run saved");
}
export function toggleDone(bid){
  let b = blocks(S.selDate).find(x=>x.id===bid);
  if(!b) b = attachBlock(S.selDate);
  b.done = !b.done; Store.save(); render();
}

/* ---------- body ---------- */
function bodyCard(d){
  const wt=DB.weight[d], wa=DB.waist[d], ph=DB.photos[d];
  const stat = (v,unit) => v!=null
    ? `<div class="hint" style="color:var(--good)">✓ ${v} ${unit} saved for ${fmtShort(d)} — enter a new value to overwrite, or save blank to clear</div>`
    : `<div class="hint">Not logged for this day</div>`;
  return `<div class="card"><h2>Body</h2>
    <label class="fl">Weight (${CFG.units.weight})</label>
    <div class="row">
      <input id="bWt" class="num" inputmode="decimal" value="${wt??""}" placeholder="—">
      <button class="btn primary fx" onclick="saveBody('weight','bWt')">${wt!=null?"Update":"Save weight"}</button></div>
    ${stat(wt, CFG.units.weight)}
    <label class="fl">Waist (${CFG.units.waist}) — monthly</label>
    <div class="row">
      <input id="bWa" class="num" inputmode="decimal" value="${wa??""}" placeholder="—">
      <button class="btn primary fx" onclick="saveBody('waist','bWa')">${wa!=null?"Update":"Save waist"}</button></div>
    ${stat(wa, CFG.units.waist)}
    <label class="fl">Progress photo note (filename / where saved)</label>
    <div class="row">
      <input id="bPh" value="${esc(ph??"")}" placeholder="e.g. IMG_2041 front+side">
      <button class="btn primary fx" onclick="saveBody('photos','bPh')">${ph?"Update":"Save note"}</button></div>
    ${ph?`<div class="hint" style="color:var(--good)">✓ saved for ${fmtShort(d)}</div>`:""}
  </div>`;
}
export function saveBody(k, inputId){
  const d=S.selDate, v=document.getElementById(inputId).value;
  if(k==="photos"){ if(v.trim()) DB.photos[d]=v.trim(); else delete DB.photos[d]; }
  else {
    const n=num(v);
    if(v.trim()==="" ) delete DB[k][d];
    else if(!(n>0)){ toast("Enter a number"); return; }
    else DB[k][d]=n;
  }
  Store.save(); render();
  toast(v.trim()===""?"Cleared":"Saved for "+fmtShort(d));
}

/* ================= HISTORY ================= */
export function viewHistory(){
  const dates = new Set([...Object.keys(DB.meals), ...Object.keys(DB.workouts), ...Object.keys(DB.weight), ...Object.keys(DB.waist)]);
  const list = [...dates].filter(d=>{
    return (DB.meals[d]&&DB.meals[d].length) || blocks(d).some(blockHasContent) || DB.weight[d]!=null || DB.waist[d]!=null;
  }).sort().reverse().slice(0,60);
  if (!list.length) return `<div class="card"><div class="center">Nothing logged yet. Log a day and it shows up here.</div></div>`;
  return list.map(d=>{
    const t = DB.meals[d]&&DB.meals[d].length ? dayTotals(d) : null;
    const meals = (DB.meals[d]||[]).map(m=>`<div class="sub">🍽 ${m.label?esc(m.label)+": ":""}${esc(m.name)} — ${m.cal} cal / ${m.protein}g</div>`).join("");
    let wo="";
    const bs = blocks(d).filter(blockHasContent);
    bs.forEach((b,bi)=>{
      if (bs.length>1) wo += `<div class="sub" style="margin-top:4px"><b>Workout ${bi+1}${b.t0&&dstr(new Date(b.t0))===d?" · "+fmtTime(b.t0):""}</b></div>`;
      for (const [n,arr] of Object.entries(b.sets||{})){
        const ss = arr.filter(x=>x.w>0||x.r>0);
        if (ss.length) wo += `<div class="sub">🏋 ${esc(n)}: ${ss.map(x=>`${x.w}×${x.r}`).join(", ")}</div>`;
      }
      if (b.run&&(b.run.dist||b.run.dur)) wo += `<div class="sub">🏃 ${b.run.dist||"?"} mi / ${b.run.dur||"?"} min${b.run.kcal?` · ${b.run.kcal} cal`:""}${b.run.note?" — "+esc(b.run.note):""}</div>`;
    });
    const body = [DB.weight[d]!=null?`${DB.weight[d]} ${CFG.units.weight}`:null, DB.waist[d]!=null?`waist ${DB.waist[d]} ${CFG.units.waist}`:null].filter(Boolean).join(" · ");
    return `<div class="card">
      <h2 style="display:flex;justify-content:space-between;align-items:center">${fmtLong(d)}
        <button class="btn small" onclick="setDate('${d}');go('today')">Edit day</button></h2>
      ${t?`<div style="font-size:14px;margin-bottom:6px"><b>${t.cal}</b> cal · <b>${t.protein}g</b> protein${dayDone(d)?' · <span style="color:var(--good)">workout ✓</span>':""}</div>`:""}
      ${meals}${wo}
      ${body?`<div class="sub" style="margin-top:4px">⚖ ${body}</div>`:""}
    </div>`;
  }).join("");
}

/* ================= LIFTS ================= */
export function viewLifts(){
  const seg = CFG.keyLifts.map(n=>
    `<button class="${n===S.liftSel?'on':''}" onclick="pickLift('${esc(n)}')">${esc(n.replace("Barbell ","").replace(" bench press"," bench").replace("Incline barbell","incline"))}</button>`).join("");
  const h = exHistory(S.liftSel);
  const rx = exPrescription(S.liftSel);
  const rdy = readyToProgress(S.liftSel);
  const pts = h.map(s=>[s.date, Math.round(Math.max(...s.sets.map(x=>epley(x.w,x.r)))*10)/10]);
  let html = `<div class="card"><h2>Key lift</h2><div class="seg">${seg}</div>`;
  if (rdy) html+=`<div class="flag">▲ Ready to progress: hit ${rx.hi} reps on all sets on ${fmtShort(rdy.date)}. Add weight next session.</div>`;
  html += `<h3>Estimated 1RM (Epley)</h3>`;
  html += lineChart([{pts, color:"#4da3ff", r:3, width:2}]);
  if (h.length){
    html += `<table class="hist"><tr><th>Date</th><th>Sets</th><th>Best e1RM</th></tr>`;
    for (const s of h.slice().reverse().slice(0,20))
      html+=`<tr><td>${fmtShort(s.date)}</td><td>${s.sets.map(x=>`${x.w}×${x.r}`).join(", ")}</td><td>${bestE1RM(s.sets)}</td></tr>`;
    html+="</table>";
  } else html += `<div class="center">Log a ${esc(S.liftSel)} session and it shows up here.</div>`;
  html += `</div>`;
  const others=[];
  for (const n of allLoggedExercises()) if(!CFG.keyLifts.includes(n)){
    const hh=exHistory(n); if(!hh.length) continue;
    const lastS=hh[hh.length-1];
    const retired = !exPrescription(n);
    others.push(`<div class="li"><div>${esc(n)}${retired?' <span class="badge">retired</span>':""}<div class="sub">last ${fmtShort(lastS.date)}: ${lastS.sets.map(x=>`${x.w}×${x.r}`).join(", ")}</div></div>
      ${readyToProgress(n)?'<span class="badge good">▲ progress</span>':''}</div>`);
  }
  if(others.length) html+=`<div class="card"><h2>Accessories</h2>${others.join("")}</div>`;
  return html;
}
export function pickLift(n){ S.liftSel=n; render(); }

/* ================= TRENDS ================= */
export function viewTrends(){
  const T=CFG.targets;
  const waistPts = Object.entries(DB.waist).sort().map(([d,v])=>[d,v]);
  let html = `<div class="card"><h2>Waist — the headline metric</h2>${lineChart([{pts:waistPts,color:"#3fb950",r:4,width:2.5}],{h:200})}`;
  if (waistPts.length>=2){
    const delta=(waistPts[waistPts.length-1][1]-waistPts[0][1]).toFixed(1);
    html+=`<div class="muted">${waistPts[waistPts.length-1][1]} ${CFG.units.waist} latest · ${delta>0?"+":""}${delta} ${CFG.units.waist} since ${fmtShort(waistPts[0][0])}</div>`;
  } else if (!waistPts.length) html+=`<div class="muted">Log waist on the Log tab (monthly).</div>`;
  html+=`</div>`;
  const wPts = Object.entries(DB.weight).sort().map(([d,v])=>[d,v]);
  const roll=[];
  for (let i=0;i<wPts.length;i++){
    const t0=parseD(wPts[i][0]).getTime()-6*864e5;
    const win=wPts.filter(p=>parseD(p[0]).getTime()>=t0 && p[0]<=wPts[i][0]);
    roll.push([wPts[i][0], Math.round(win.reduce((a,p)=>a+p[1],0)/win.length*10)/10]);
  }
  html+=`<div class="card"><h2>Body weight (supporting metric)</h2>
    ${lineChart([{pts:wPts,color:"#5a6675",r:2.5},{pts:roll,color:"#4da3ff",width:2.5}])}
    <div class="muted">Gray dots: daily. Blue line: 7-day average — the only one that means anything.</div></div>`;
  const days=lastNDays(30);
  const pro=days.map(d=>DB.meals[d]?dayTotals(d).protein:null);
  const cal=days.map(d=>DB.meals[d]?dayTotals(d).cal:null);
  html+=`<div class="card"><h2>Protein — last 30 days vs ${T.proteinFloor}g floor</h2>
    ${barChart(days,pro,{target:T.proteinFloor,floorMode:"below"})}
    <div class="muted">Green ≥ floor · red below · purple = planned cheat day</div></div>`;
  html+=`<div class="card"><h2>Calories — last 30 days vs ${T.cal} target</h2>
    ${barChart(days,cal,{target:T.cal,floorMode:"above",cheatDow:CFG.cheatDay})}
    <div class="muted">Purple bars are Fridays — cheat meal is part of the plan, not a failure.</div></div>`;
  let rxDays=0, doneDays=0, floorDays=0, calSum=0, calN=0;
  for (const d of days){
    const sid=CFG.split[dow(d)];
    if (CFG.sessions[sid].type!=="rest" && d<=today()){ rxDays++; if(dayDone(d)) doneDays++; }
    if (DB.meals[d]&&DB.meals[d].length){ const t=dayTotals(d); calSum+=t.cal; calN++; if(t.protein>=T.proteinFloor) floorDays++; }
  }
  html+=`<div class="card"><h2>Adherence — last 30 days</h2><div class="stat">
    <div class="s"><div class="v">${doneDays}/${rxDays}</div><div class="k">workouts completed vs prescribed</div></div>
    <div class="s"><div class="v">${floorDays}/${calN||0}</div><div class="k">logged days hitting ${T.proteinFloor}g protein floor</div></div>
    <div class="s"><div class="v">${calN?Math.round(calSum/calN):"—"}</div><div class="k">avg daily calories (target ${T.cal})</div></div>
    <div class="s"><div class="v">${calN}</div><div class="k">days with food logged</div></div>
  </div></div>`;
  return html;
}

/* ================= EXPORT ================= */
export function viewExport(){
  return `<div class="card"><h2>Export to Claude</h2>
    <div class="muted" style="margin-bottom:8px">Paste-ready summary of everything logged — targets, adherence, lift progression, body trend. Paste into Claude for a progress review.</div>
    <button class="btn primary" onclick="genClaude()">Generate summary</button>
    <button class="btn" onclick="copyClaude()">Copy</button>
    <textarea id="claudeOut" class="exp" style="margin-top:10px" readonly placeholder="Tap Generate…"></textarea>
  </div>
  <div class="card"><h2>Raw data</h2>
    <div class="muted" style="margin-bottom:8px">Full JSON of everything — you own your data.</div>
    <button class="btn" onclick="dlJSON()">Download JSON</button>
    <button class="btn" onclick="document.getElementById('impFile').click()">Import JSON</button>
    <input type="file" id="impFile" accept=".json,application/json" style="display:none" onchange="impJSON(this)">
    <button class="btn ghost" onclick="resetAll()">Reset all data</button>
  </div>
  <div class="card"><h2>Sync</h2>
    <div class="muted" style="margin-bottom:8px">${Store.user?`Signed in as ${esc(Store.user.email)} — data lives in Supabase Postgres. This device is a cache.`:(Store.configured()?"Not signed in.":"Supabase not configured — data is on this device only.")}</div>
    ${Store.user?`<button class="btn ghost" onclick="logout()">Sign out</button>`:""}
  </div>`;
}
export function genClaude(){
  const T=CFG.targets, days=lastNDays(30).filter(d=>d<=today());
  let s=`# Fitness Progress Export — ${today()}\n\n`;
  s+=`Plan: 6-month recomp. Targets: ${T.cal} cal/day, ${T.protein}g protein (floor ${T.proteinFloor}g). Friday = planned cheat dinner.\n`;
  s+=`Primary metrics: waist, progressive overload on key lifts, protein adherence. Weight is secondary.\n\n`;
  const wa=Object.entries(DB.waist).sort(), wt=Object.entries(DB.weight).sort();
  s+=`## Waist (${CFG.units.waist})\n`+(wa.length?wa.map(([d,v])=>`${d}: ${v}`).join("\n"):"none logged")+"\n\n";
  s+=`## Weight (${CFG.units.weight}) — last 30 entries\n`+(wt.length?wt.slice(-30).map(([d,v])=>`${d}: ${v}`).join("\n"):"none logged")+"\n\n";
  s+=`## Nutrition — last 30 days (logged days only)\n`;
  let any=false;
  for(const d of days){ if(!DB.meals[d]||!DB.meals[d].length) continue; any=true;
    const t=dayTotals(d); const cheat=dow(d)===CFG.cheatDay?" [cheat day]":"";
    const flag=t.protein>=T.proteinFloor?"":" ⚠ under protein floor";
    s+=`${d}: ${t.cal} cal, ${t.protein}g protein${cheat}${flag}\n`;
    for(const m of DB.meals[d].filter(m=>!m.tid)) s+=`   ${m.label?m.label.toLowerCase()+": ":""}${m.name} (${m.cal} cal, ${m.protein}g)\n`;
  }
  if(!any) s+="none logged\n";
  s+="\n## Key lifts — full history (weight×reps per set, best e1RM)\n";
  for(const n of CFG.keyLifts){
    const h=exHistory(n); if(!h.length){ s+=`### ${n}\nno sessions\n`; continue; }
    const rx=exPrescription(n), rdy=readyToProgress(n);
    s+=`### ${n} (prescribed ${rx.sets}×${rx.lo}–${rx.hi})${rdy?" — READY TO PROGRESS":""}\n`;
    for(const sess of h) s+=`${sess.date}: ${sess.sets.map(x=>`${x.w}×${x.r}`).join(", ")} | e1RM ${bestE1RM(sess.sets)}\n`;
  }
  s+="\n## Other exercises — last session each\n";
  for(const n of allLoggedExercises()) if(!CFG.keyLifts.includes(n)){
    const h=exHistory(n); if(!h.length) continue;
    const lastS=h[h.length-1];
    const retired = !exPrescription(n);
    s+=`${n}${retired?" [no longer in program]":""}: ${lastS.date} — ${lastS.sets.map(x=>`${x.w}×${x.r}`).join(", ")}${readyToProgress(n)?" [ready to progress]":""}\n`;
  }
  s+="\n## Runs — last 30 days\n"; let anyRun=false;
  for(const d of days) for(const b of blocks(d))
    if(b.run&&(b.run.dist||b.run.dur)){ anyRun=true; s+=`${d}: ${b.run.dist||"?"} mi in ${b.run.dur||"?"} min${b.run.kcal?`, ~${b.run.kcal} cal burned`:""}${b.run.note?" — "+b.run.note:""}\n`; }
  if(!anyRun) s+="none logged\n";
  let rxD=0,dnD=0; for(const d of days){ const sid=CFG.split[dow(d)];
    if(CFG.sessions[sid].type!=="rest"){ rxD++; if(dayDone(d)) dnD++; } }
  s+=`\n## Adherence (30d)\nWorkouts: ${dnD}/${rxD} prescribed sessions completed\n`;
  s+=`\nQuestions for you, Claude: Am I on track for the recomp goals? Which lifts are stalling? Any adjustments to calories, protein, or the program?\n`;
  document.getElementById("claudeOut").value=s;
}
export function copyClaude(){
  const el=document.getElementById("claudeOut");
  if(!el.value) genClaude();
  el.select(); el.setSelectionRange(0,999999);
  try{ navigator.clipboard.writeText(el.value).then(()=>toast("Copied — paste into Claude")); }
  catch(e){ document.execCommand("copy"); toast("Copied"); }
}
export function dlJSON(){
  const blob=new Blob([JSON.stringify({config:CFG,data:DB},null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`fitness-export-${today()}.json`; a.click();
}
export function impJSON(inp){
  const f = inp.files[0]; if(!f) return; inp.value="";
  f.text().then(txt=>{
    try{
      const j = JSON.parse(txt); const doc = j.data || j;
      if (!doc.meals && !doc.workouts) throw 0;
      if (!confirm("Replace ALL current data with this file (local + server)?")) return;
      for (const k of ["meals","workouts","weight","waist","photos","dismissed"]) DB[k] = doc[k] || {};
      Store.migrate(DB);
      Store.save(); render(); toast("Imported");
    } catch(e){ toast("Not a valid export file"); }
  });
}
export function resetAll(){
  if (!confirm("Erase ALL logged data? This wipes this device AND the server copy.")) return;
  for (const k of ["meals","workouts","weight","waist","photos","dismissed"]) DB[k] = {};
  Store.save(); localStorage.removeItem(Store.DIRTY); render();
}
export function logout(){ Store.logout(); }
