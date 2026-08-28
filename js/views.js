import { CFG, MEAL_LABELS } from "./config.js";
import { DB, Store, DOC_KEYS } from "./store.js";
import { today, parseD, dstr, dow, fmtShort, fmtLong, fmtTime, esc, epley, lastNDays, toast, num } from "./util.js";
import { dayTotals, blocks, newBlock, attachBlock, loggedSets, daySetCount, blockHasContent, pruneEmptyBlocks,
         allExercises, allLoggedExercises, exDef, isBodyweight, exPrescription, exHistory, readyToProgress, bestE1RM, suggestedWeight, suggestedReps, adherence } from "./data.js";
import { lineChart, barChart } from "./charts.js";

/* ---------- ui state ---------- */
export const S = { selDate: today(), mealLabel: "Breakfast", addExSel: "", liftSel: CFG.keyLifts[0], editMeal: null, calMonth: today().slice(0,7) };
let render = ()=>{}, go = ()=>{};
export function init(r, g){ render = r; go = g; }

const DOW_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
// unique muscles across a list of exercises, in first-seen order
function aggMuscles(exList){
  const order=[], seen=new Set();
  for(const ex of exList) if(ex&&ex.mus) for(const m of ex.mus.split(",").map(s=>s.trim())) if(m&&!seen.has(m)){ seen.add(m); order.push(m); }
  return order;
}
function musclesSummary(exList){
  const ms=aggMuscles(exList);
  return ms.length ? `<div class="muted" style="margin:2px 0 8px"><span style="color:var(--faint)">💪 Targets:</span> ${esc(ms.join(", "))}</div>` : "";
}
// user-facing exercise name (respects renames); data is always keyed by the canonical name
function dispName(name){ return (DB.aliases && DB.aliases[name]) || name; }
// weekday(s) a session is scheduled for, e.g. push_b → "Friday"
function sessionDays(sid){
  return Object.entries(CFG.split).filter(([,v])=>v===sid).map(([k])=>DOW_NAMES[+k]).join("/");
}
// a set renders as "135×8" for weighted, or "12" / "45 sec" for bodyweight
function unitOf(name){ const e=exDef(name); return e&&e.unit?" "+e.unit:""; }
function setStr(name, x){ return isBodyweight(name) ? `${x.r}${unitOf(name)}` : `${x.w}×${x.r}`; }
function fmtSets(name, sets){ return sets.map(x=>setStr(name,x)).join(", "); }

/* ================= LOG (any day) ================= */
export function viewToday(){
  const d = S.selDate, isToday = d===today(), future = d>today();
  const bar = `<div class="card" style="padding:10px 14px"><div class="row">
    <button class="btn small fx" onclick="shiftDay(-1)">‹ prev</button>
    <input type="date" value="${d}" onchange="setDate(this.value)" style="text-align:center">
    <button class="btn small fx" onclick="shiftDay(1)">next ›</button>
  </div>
  <div style="text-align:center;margin-top:6px;font-weight:600">${DOW_NAMES[dow(d)]}${isToday?" · today":""}</div>
  ${isToday?"":`<div class="muted" style="margin-top:2px;text-align:center">${future?"Upcoming day — preview only":"Editing a past day"} — <a href="#" style="color:var(--accent)" onclick="setDate('${today()}');return false">back to today</a></div>`}</div>`;
  if (future) return bar + plannedCard(d);
  return bar + (isToday?nags(d):"") + foodCard(d) + workoutCard(d) + bodyCard(d);
}
export function shiftDay(n){ const d=parseD(S.selDate); d.setDate(d.getDate()+n); S.selDate=dstr(d); S.addExSel=""; S.editMeal=null; render(); }
export function setDate(v){ if(v){ S.selDate=v; S.addExSel=""; S.editMeal=null; render(); } }

/* preview of a future day's prescribed session */
function plannedCard(d){
  const sid = CFG.split[dow(d)], s = CFG.sessions[sid];
  const isCheat = dow(d)===CFG.cheatDay;
  let html = `<div class="card"><h2>Planned — ${esc(s.name)}</h2>`;
  if (s.type==="rest") html += `<div class="center">Rest day. Nothing on the calendar.</div>`;
  else if (s.type==="run") html += `<div class="muted">${esc(s.detail)}</div>`;
  else {
    html += musclesSummary(s.exercises);
    html += s.exercises.map(ex=>{
      const liveHi = ex.bw ? suggestedReps(ex.n) : null;
      const hi = liveHi ?? ex.hi;
      const rx = `${ex.sets}×${ex.lo===ex.hi?hi:ex.lo+"–"+hi}${ex.unit?" "+ex.unit:""}${ex.note?" "+ex.note:""}`;
      const h = exHistory(ex.n);
      const last = h.length ? h[h.length-1] : null;
      const rdy = ex.bw ? null : readyToProgress(ex.n);
      return `<div class="li"><div>${esc(dispName(ex.n))}${ex.mus?`<div class="sub" style="color:var(--faint)">💪 ${esc(ex.mus)}</div>`:""}<div class="sub">${rx}${last?` · last: ${fmtSets(ex.n,last.sets)}`:""}</div></div>
        ${rdy?'<span class="badge good">▲ go heavier</span>':""}</div>`;
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
    out += `<div class="nag"><span>1st of the month: log your waist measurement.</span><button class="btn small ghost" onclick="dismiss('m${monthKey}')">Later</button></div>`;
  return out;
}
export function dismiss(k){ DB.dismissed[k]=1; Store.save(); render(); }

/* ---------- food ---------- */
function foodCard(d){
  const meals = DB.meals[d]||[];
  const t = dayTotals(d);
  const T = CFG.targets;
  const pLeft = Math.round(Math.max(0, T.protein - t.protein)*10)/10;
  const isCheat = dow(d)===CFG.cheatDay;
  const lblChips = MEAL_LABELS.map(l=>`<button class="${l===S.mealLabel?'on':''}"
    onclick="pickLabel('${l}',this)">${l}</button>`).join("");
  const groups = {};
  meals.forEach((m,i)=>{ const lbl=m.label||"Other"; (groups[lbl]=groups[lbl]||[]).push(i); });
  const list = MEAL_LABELS.filter(lbl=>groups[lbl]).map(lbl=>{
    const idxs = groups[lbl];
    const gCal = Math.round(idxs.reduce((a,i)=>a+(+meals[i].cal||0),0)*10)/10;
    const gPro = Math.round(idxs.reduce((a,i)=>a+(+meals[i].protein||0),0)*10)/10;
    const rows = idxs.map(i=>{
      const m = meals[i];
      if (i===S.editMeal){
        const lchips = MEAL_LABELS.map(l=>`<button class="${l===(m.label||'Other')?'on':''}" onclick="pickEditLabel('${l}',this)">${l}</button>`).join("");
        return `<div class="li" style="display:block">
          <div class="seg" id="editlbl" style="margin-bottom:6px">${lchips}</div>
          <input id="emName" value="${esc(m.name)}" style="margin-bottom:6px">
          <div class="row">
            <input id="emCal" class="num" inputmode="decimal" value="${m.lazy?"":(m.cal??"")}" placeholder="Calories">
            <input id="emPro" class="num" inputmode="decimal" value="${m.lazy?"":(m.protein??"")}" placeholder="Protein g"></div>
          <div class="row" style="margin-top:8px">
            <button class="btn primary" onclick="saveMealEdit(${i})">Save</button>
            <button class="btn ghost fx" onclick="cancelMealEdit()">Cancel</button></div>
          <div class="muted" style="margin-top:4px;font-size:12px">Leave calories blank to keep it record-only.</div>
        </div>`;
      }
      const tm = m.t && dstr(new Date(m.t))===d ? ` · ${fmtTime(m.t)}` : "";
      const macros = m.lazy ? `not counted${tm}` : `${m.cal} cal · ${m.protein}g protein${tm}`;
      return `<div class="li"><div style="cursor:pointer" onclick="editMeal(${i})">${esc(m.name)}<div class="sub">${macros} · <span style="color:var(--accent)">edit</span></div></div>
      <button class="del" onclick="delMeal(${i})">✕</button></div>`;
    }).join("");
    return `<div class="mealgroup"><div class="ghead"><span>${esc(lbl)}</span><span>${gCal} cal · ${gPro}g protein</span></div>${rows}</div>`;
  }).join("");
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
    <div style="margin-top:6px"><a href="#" class="muted" style="color:var(--accent)" onclick="addCustom(true);return false">+ Log meal without calories (record only)</a></div>
    ${list?`<div class="loggedlist">${list}</div>`:""}
    <div class="tot"><div class="tl"><span>Calories</span><span><b>${t.cal}</b> / ${T.cal}</span></div>
      <div class="bar"><i class="${t.cal>T.cal+60?'over':''}" style="width:${calPct}%"></i></div></div>
    <div class="tot"><div class="tl"><span>Protein</span><span><b>${t.protein}g</b> / ${T.protein}g</span></div>
      <div class="bar"><i class="${t.protein>=T.proteinFloor?'good':''}" style="width:${pPct}%"></i></div>
      <div class="hint">${pLeft>0?pLeft+"g protein left to hit target"+(t.protein>=T.proteinFloor?" (floor of "+T.proteinFloor+"g met ✓)":""):"Protein target hit ✓"}</div></div>
    <div style="margin-top:12px"><button class="btn ${DB.mealsDone[d]?'done':''}" style="width:100%" onclick="toggleMealsDone()">${DB.mealsDone[d]?"✓ All meals logged for the day":"Mark all meals logged"}</button></div>
  </div>`;
}
export function pickLabel(l, el){ S.mealLabel=l; if(el) el.parentNode.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b===el)); }
export function addCustom(lazy){
  const n=document.getElementById("cmName").value.trim();
  if(!n){ toast("Meal name required"); return; }
  const meal = { label:S.mealLabel, name:n, t:Date.now() };
  if(lazy){ meal.lazy=true; meal.cal=0; meal.protein=0; }
  else {
    const c=num(document.getElementById("cmCal").value), p=num(document.getElementById("cmPro").value);
    if(!c){ toast("Enter calories, or use record-only below"); return; }
    meal.cal=c; meal.protein=p;
  }
  (DB.meals[S.selDate]=DB.meals[S.selDate]||[]).push(meal);
  Store.save(); render();
}
export function delMeal(i){ DB.meals[S.selDate].splice(i,1); if(S.editMeal===i) S.editMeal=null; Store.save(); render(); }
export function toggleMealsDone(){ const d=S.selDate; if(DB.mealsDone[d]) delete DB.mealsDone[d]; else DB.mealsDone[d]=1; Store.save(); render(); }
export function editMeal(i){ S.editMeal=i; S._editLabel=(DB.meals[S.selDate][i]||{}).label||"Other"; render(); }
export function cancelMealEdit(){ S.editMeal=null; render(); }
export function pickEditLabel(l, el){ S._editLabel=l; if(el) el.parentNode.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b===el)); }
export function saveMealEdit(i){
  const m=DB.meals[S.selDate][i]; if(!m) return;
  const n=document.getElementById("emName").value.trim();
  if(!n){ toast("Meal name required"); return; }
  m.name=n; m.label=S._editLabel||m.label;
  const cRaw=document.getElementById("emCal").value.trim();
  if(cRaw===""){ m.lazy=true; m.cal=0; m.protein=0; }
  else {
    const c=num(cRaw); if(!c){ toast("Enter calories, or clear to keep record-only"); return; }
    delete m.lazy; m.cal=c; m.protein=num(document.getElementById("emPro").value);
  }
  S.editMeal=null; Store.save(); render(); toast("Updated");
}

/* ---------- workout (blocks of segments) ---------- */
function sessionExercisesHtml(d, s){
  if (s.type==="run") return `<div class="muted">${esc(s.detail)}</div>`;
  if (s.type!=="lift") return "";
  return s.exercises.map(ex=>{
    const done = daySetCount(d, ex.n);
    // bodyweight targets are live (reps/time is the progressive variable) — the static config hi
    // would otherwise go stale and diverge from the "goal" shown in the add-set form
    const liveHi = ex.bw ? suggestedReps(ex.n) : null;
    const hi = liveHi ?? ex.hi;
    const rdy = ex.bw ? null : readyToProgress(ex.n);
    const rx = `${ex.sets}×${ex.lo===ex.hi?hi:ex.lo+"–"+hi}${ex.unit?" "+ex.unit:""}${ex.note?" "+ex.note:""}`;
    const rdyW = rdy ? Math.max(...rdy.sets.map(x=>x.w)) : 0;
    const rdyMsg = rdy ? `▲ you got all ${ex.sets}×${ex.hi} @ ${rdyW} ${CFG.units.weight} — go heavier today` : "";
    const last = (exHistory(ex.n, d).slice(-1)[0]);
    const lastTxt = last ? ` · last: ${fmtSets(ex.n,last.sets)}` : "";
    const pin = DB.exNotes[ex.n];
    return `<div class="li" style="cursor:pointer" onclick="selEx('${esc(ex.n)}')">
      <div>${esc(dispName(ex.n))}${ex.mus?`<div class="sub" style="color:var(--faint)">💪 ${esc(ex.mus)}</div>`:""}<div class="sub">${rx}${lastTxt}${rdy?` · <span style="color:var(--good)">${rdyMsg}</span>`:""}${pin?`<div style="color:var(--warn)">📌 ${esc(pin)}</div>`:""}</div></div>
      <span class="badge ${done>=ex.sets?'good':''}">${done}/${ex.sets} sets</span></div>`;
  }).join("");
}
function workoutCard(d){
  const sid = CFG.split[dow(d)];
  const s = CFG.sessions[sid];
  const arr = blocks(d);
  const makeup = (DB.makeup[d]||[]).filter(m=>CFG.sessions[m]);
  const anyLiftShown = s.type==="lift" || makeup.some(m=>CFG.sessions[m].type==="lift");
  const names = [s.type!=="rest"?s.name:null, ...makeup.map(m=>CFG.sessions[m].name)].filter(Boolean);
  let html = `<div class="card"><h2>Workout${names.length?` — ${esc(names.join(" + "))}`:""}</h2>`;
  if (s.type==="rest" && !makeup.length) html += `<div class="muted" style="margin-bottom:6px">Rest day per the program — but log anything you did anyway.</div>`;

  const allEx = [...(s.exercises||[]), ...makeup.flatMap(m=>CFG.sessions[m].exercises||[])];
  html += musclesSummary(allEx);
  html += sessionExercisesHtml(d, s);
  // make-up sessions loaded onto this day
  makeup.forEach(m=>{
    const ms = CFG.sessions[m];
    const mday=sessionDays(m);
    html += `<h3 style="display:flex;justify-content:space-between;align-items:center">Made up: ${esc(ms.name)}${mday?` · ${mday}`:""}
      <a href="#" class="muted" style="color:var(--faint);font-size:12px" onclick="removeMakeup('${m}');return false">remove</a></h3>`;
    html += sessionExercisesHtml(d, ms);
  });
  // control to load a missed session's reference list onto this day
  const loadable = Object.entries(CFG.sessions).filter(([id,ss])=>ss.type!=="rest" && id!==sid && !makeup.includes(id));
  html += `<details class="cust" style="margin-top:10px"><summary>+ Make up a missed session</summary>
    <div class="muted" style="margin:4px 0 6px">Loads another day's exercise list here so you can log it with the same UI. Doesn't move your schedule.</div>
    <div class="mealgrid">${loadable.map(([id,ss])=>{
      const day=sessionDays(id);
      return `<button class="mealbtn" onclick="addMakeup('${id}')"><div class="mn">${esc(ss.name)}</div>${day?`<div class="mm">${day}</div>`:""}</button>`;
    }).join("")}</div>
  </details>`;

  // ---- add exercise: pick Run or a lift; inputs appear per type ----
  if (s.type==="run" && !anyLiftShown && !S.addExSel) S.addExSel = "__run";
  const opts = `<option value="" ${S.addExSel?"":"selected"} disabled>Choose: run, activity, or a lift…</option>
    <option value="__run" ${S.addExSel==="__run"?"selected":""}>🏃 Run</option>
    <option value="__activity" ${S.addExSel==="__activity"?"selected":""}>🎾 Other activity (tennis, hike…)</option>
    <optgroup label="Lifts">` +
    allExercises().map(e=>`<option value="${esc(e.n)}" ${e.n===S.addExSel?"selected":""}>${esc(dispName(e.n))}</option>`).join("") +
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
  } else if (S.addExSel === "__activity"){
    html += `<div class="row" style="margin-top:8px">
      <div style="flex:2"><label class="fl">Activity</label><input id="acName" placeholder="e.g. Tennis, hike, yoga"></div>
      <div><label class="fl">Duration (min)</label><input id="acDur" class="num" inputmode="decimal" placeholder="opt."></div>
      <div><label class="fl">Cal burned</label><input id="acCal" class="num" inputmode="decimal" placeholder="opt."></div></div>
    <div class="row" style="margin-top:8px">
      <div style="flex:2"><label class="fl">Note</label><input id="acNote" placeholder="optional"></div>
      <div><label class="fl">Time (opt.)</label><input id="acTime" type="time"></div></div>
    <div class="muted" style="margin-top:4px;font-size:12px">Set a time if you did this earlier — it logs as its own workout at that time instead of joining your current one.</div>
    <div style="margin-top:10px"><button class="btn primary" onclick="addActivity()">Add activity</button></div>
    ${joinTxt}`;
  } else if (S.addExSel){
    const selRx = exPrescription(S.addExSel);
    const h = exHistory(S.addExSel, d);
    const last = h.length ? h[h.length-1] : null;
    const bw = isBodyweight(S.addExSel);
    const sugg = bw ? null : suggestedWeight(S.addExSel);
    const suggR = bw ? suggestedReps(S.addExSel) : null;
    const repPh = (selRx&&selRx.unit==='sec')||unitOf(S.addExSel)===" sec" ? "sec" : "reps";
    const pin = DB.exNotes[S.addExSel];
    const exd = exDef(S.addExSel);
    html += `${exd&&exd.mus?`<div class="muted" style="color:var(--faint);margin-top:4px">💪 ${esc(exd.mus)}</div>`:""}
    <div class="muted" style="margin:6px 0 2px">${last?`Last time (${fmtShort(last.date)}): ${fmtSets(S.addExSel,last.sets)}`:"First time logging this"}${selRx?` · target ${selRx.sets}×${selRx.lo===selRx.hi?(suggR??selRx.lo):selRx.lo+"–"+selRx.hi}`:""}</div>
    <div style="margin:2px 0 4px"><span style="color:var(--warn)">📌 ${pin?esc(pin):'<span class="muted">no pinned note</span>'}</span> · <a href="#" class="muted" style="color:var(--accent);font-size:12px" onclick="setExNote('${esc(S.addExSel)}');return false">${pin?"edit":"add"} pinned note</a></div>
    <div class="row" style="margin-top:8px">
      ${bw?"":`<div><label class="fl">${sugg!=null?`goal: ${sugg} ${CFG.units.weight}`:CFG.units.weight}</label><input id="asW" class="num" inputmode="decimal" placeholder="${CFG.units.weight}"></div>`}
      <div><label class="fl">${suggR!=null?`goal: ${suggR} ${repPh}`:selRx?`goal: ${selRx.lo===selRx.hi?selRx.lo:selRx.lo+"–"+selRx.hi} ${repPh}`:repPh}</label><input id="asR" class="num" inputmode="numeric" placeholder="${repPh}"></div>
      <button class="btn primary fx" onclick="addSet()">Add ${bw?repPh:"set"}</button></div>
    <input id="asNote" placeholder="note for this set (optional)" style="margin-top:8px">
    ${joinTxt}`;
  }

  // logged workouts for the day
  arr.forEach((b,bi)=>{
    if (!blockHasContent(b) && !b.done) return;
    const mins = b.t0 && b.t1 ? Math.round((b.t1-b.t0)/60e3) : 0;
    const timeTxt = b.t0 && dstr(new Date(b.t0))===d ? ` · ${fmtTime(b.t0)}${b.t1&&b.t1-b.t0>60e3?`–${fmtTime(b.t1)} (${mins} min)`:""}` : "";
    let rows = Object.entries(b.sets||{}).map(([n,setsArr])=>{
      const ss = setsArr.filter(x=>x.r>0); if(!ss.length) return "";
      const notes = ss.filter(x=>x.note).map(x=>esc(x.note));
      const noteTxt = notes.length ? `<div class="sub" style="color:var(--faint)">📝 ${notes.join(" · ")}</div>` : "";
      return `<div class="li"><div><b>${esc(dispName(n))}</b><div class="sub">${fmtSets(n,ss)}</div>${noteTxt}</div>
        <button class="del" title="remove last set" onclick="delLastSet('${b.id}','${esc(n)}')">⌫</button></div>`;
    }).join("");
    if (b.run&&(b.run.dist||b.run.dur)) rows += `<div class="li"><div><b>Run</b><div class="sub">${b.run.dist||"?"} mi / ${b.run.dur||"?"} min${b.run.kcal?` · ${b.run.kcal} cal`:""}${b.run.note?" — "+esc(b.run.note):""}</div></div></div>`;
    (b.activities||[]).forEach((a,ai)=>{ rows += `<div class="li"><div><b>${esc(a.name)}</b><div class="sub">${[a.dur?a.dur+" min":"",a.kcal?a.kcal+" cal":""].filter(Boolean).join(" · ")}${a.note?" — "+esc(a.note):""}</div></div>
      <button class="del" onclick="delActivity('${b.id}',${ai})">✕</button></div>`; });
    html += `<h3 style="display:flex;justify-content:space-between;align-items:center">Workout ${bi+1}${timeTxt}
      <button class="btn small ${b.done?'done':''}" onclick="toggleDone('${b.id}')">${b.done?"✓ done":"mark done"}</button></h3>
    <div class="loggedlist" style="margin-top:0">${rows}</div>`;
  });
  html += `</div>`;
  return html;
}
export function selEx(n){ S.addExSel=n; render(); const el=document.getElementById("asW")||document.getElementById("asR"); if(el) el.focus(); }
export function setExNote(name){
  const cur=DB.exNotes[name]||"";
  const v=prompt(`Pinned note for "${dispName(name)}" (e.g. use notch 2):`, cur);
  if(v==null) return;
  const t=v.trim();
  if(t) DB.exNotes[name]=t; else delete DB.exNotes[name];
  Store.save(); render();
}
export function addSet(){
  if(!S.addExSel){ toast("Pick an exercise first"); return; }
  const wEl=document.getElementById("asW");
  const wv=wEl?num(wEl.value):0, rv=num(document.getElementById("asR").value);
  if(!rv){ toast("Enter reps"); return; }
  const noteEl=document.getElementById("asNote");
  const note=noteEl?noteEl.value.trim():"";
  const b = attachBlock(S.selDate, S._forceNew); S._forceNew=false;
  const set={w:wv, r:rv}; if(note) set.note=note;
  (b.sets[S.addExSel]=b.sets[S.addExSel]||[]).push(set);
  Store.save(); render();
}
// selDate (YYYY-MM-DD) + "HH:MM" → epoch ms
function tsFromTime(dateStr, hhmm){ const [y,m,dd]=dateStr.split("-").map(Number); const [H,M]=hhmm.split(":").map(Number); return new Date(y,m-1,dd,H||0,M||0).getTime(); }
export function addActivity(){
  const name=document.getElementById("acName").value.trim();
  if(!name){ toast("Enter an activity name"); return; }
  const dur=num(document.getElementById("acDur").value);
  const kcal=num(document.getElementById("acCal").value);
  const note=document.getElementById("acNote").value.trim();
  const timeStr=document.getElementById("acTime").value;
  let b;
  if(timeStr){ const ts=tsFromTime(S.selDate,timeStr); b=newBlock(S.selDate); b.t0=ts; b.t1=ts; }
  else { b = attachBlock(S.selDate, S._forceNew); S._forceNew=false; }
  (b.activities=b.activities||[]).push({name, dur, kcal, note});
  Store.save(); render();
}
export function delActivity(bid, ai){
  const b = blocks(S.selDate).find(x=>x.id===bid);
  if(b&&b.activities){ b.activities.splice(ai,1); if(!b.activities.length) delete b.activities; pruneEmptyBlocks(S.selDate); Store.save(); render(); }
}
export function addMakeup(sid){
  const arr = DB.makeup[S.selDate] = DB.makeup[S.selDate] || [];
  if(!arr.includes(sid)) arr.push(sid);
  Store.save(); render(); toast(`Loaded ${CFG.sessions[sid].name}`);
}
export function removeMakeup(sid){
  const arr = DB.makeup[S.selDate]; if(!arr) return;
  const i = arr.indexOf(sid); if(i>=0) arr.splice(i,1);
  if(!arr.length) delete DB.makeup[S.selDate];
  Store.save(); render();
}
export function startNewWorkout(){ S._forceNew=true; toast("Next set starts a new workout"); render(); }
export function delLastSet(bid, n){
  const b = blocks(S.selDate).find(x=>x.id===bid);
  if(b&&b.sets[n]){ b.sets[n].pop(); if(!b.sets[n].length) delete b.sets[n]; pruneEmptyBlocks(S.selDate); Store.save(); render(); }
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
  const wt=DB.weight[d], wa=DB.waist[d];
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
/* ---------- calendar of "all meals logged" days ---------- */
const CAL_DOW = ["M","T","W","T","F","S","S"];
// consecutive days ending today with every meal logged. Today not yet marked doesn't break
// the streak — the day isn't over — so counting starts from yesterday in that case.
function mealsDoneStreak(){
  const d = parseD(today());
  if (!DB.mealsDone[dstr(d)]) d.setDate(d.getDate()-1);
  let n = 0;
  while (DB.mealsDone[dstr(d)]){ n++; d.setDate(d.getDate()-1); }
  return n;
}
// month grid, Monday-first to match the Mon–Sun week adherence() credits against.
// Green = marked "all meals logged"; a dot = food logged but never marked complete.
function calendarCard(){
  const [y,m] = S.calMonth.split("-").map(Number);
  const cur = today(), curMonth = cur.slice(0,7);
  const lead = (new Date(y,m-1,1).getDay()+6)%7;      // Mon-first offset of the 1st
  const nDays = new Date(y,m,0).getDate();
  let cells="", done=0, partial=0, elapsed=0;
  for (let i=0;i<lead;i++) cells += `<div class="cal-d empty"></div>`;
  for (let n=1;n<=nDays;n++){
    const d = dstr(new Date(y,m-1,n));
    const isDone = !!DB.mealsDone[d], hasFood = !!(DB.meals[d]&&DB.meals[d].length);
    const future = d > cur;
    if (!future){ elapsed++; if (isDone) done++; else if (hasFood) partial++; }
    const cls = ["cal-d", isDone?"done":(hasFood?"partial":""), d===cur?"today":"", future?"future":""].filter(Boolean).join(" ");
    cells += `<button class="${cls}" onclick="openDay('${d}')" aria-label="${fmtLong(d)}${isDone?" — all meals logged":""}">
      <span class="cn">${n}</span><span class="cm">${isDone?"✓":(hasFood?"•":"")}</span></button>`;
  }
  const label = new Date(y,m-1,1).toLocaleDateString(undefined,{month:"long",year:"numeric"});
  const atCur = S.calMonth >= curMonth;
  return `<div class="card">
    <h2>All meals logged</h2>
    <div class="row" style="margin-bottom:10px">
      <button class="btn small fx" onclick="shiftMonth(-1)">‹</button>
      <div style="text-align:center;font-weight:600;font-size:15px">${esc(label)}</div>
      <button class="btn small fx" onclick="shiftMonth(1)" ${atCur?"disabled style=\"opacity:.35\"":""}>›</button>
    </div>
    <div class="cal-head">${CAL_DOW.map(c=>`<div>${c}</div>`).join("")}</div>
    <div class="cal">${cells}</div>
    <div class="cal-legend">
      <span><i class="sw done"></i>all meals logged</span>
      <span><i class="sw partial"></i>food logged, not marked</span>
      <span><i class="sw"></i>nothing logged</span>
    </div>
    <div class="stat" style="margin-top:10px">
      <div class="s"><div class="v">${elapsed?done+"/"+elapsed:"—"}</div><div class="k">days this month with all meals logged</div></div>
      <div class="s"><div class="v">${mealsDoneStreak()}</div><div class="k">day current streak</div></div>
    </div>
    ${partial?`<div class="muted" style="margin-top:8px">${partial} day${partial>1?"s":""} this month have food logged but were never marked complete — tap one to finish it off.</div>`:""}
  </div>`;
}
export function shiftMonth(n){
  const [y,m] = S.calMonth.split("-").map(Number);
  const d = new Date(y, m-1+n, 1);
  S.calMonth = dstr(d).slice(0,7);
  render();
}
export function openDay(d){ S.selDate=d; S.addExSel=""; S.editMeal=null; go("today"); }

export function viewHistory(){
  const dates = new Set([...Object.keys(DB.meals), ...Object.keys(DB.workouts), ...Object.keys(DB.weight), ...Object.keys(DB.waist)]);
  const list = [...dates].filter(d=>{
    return (DB.meals[d]&&DB.meals[d].length) || blocks(d).some(blockHasContent) || DB.weight[d]!=null || DB.waist[d]!=null;
  }).sort().reverse().slice(0,60);
  const cal = calendarCard();
  if (!list.length) return cal + `<div class="card"><div class="center">Nothing logged yet. Log a day and it shows up here.</div></div>`;
  return cal + list.map(d=>{
    const t = DB.meals[d]&&DB.meals[d].length ? dayTotals(d) : null;
    const meals = (DB.meals[d]||[]).map(m=>`<div class="sub">🍽 ${m.label?esc(m.label)+": ":""}${esc(m.name)} — ${m.lazy?"not counted":`${m.cal} cal / ${m.protein}g`}${m.t&&dstr(new Date(m.t))===d?` · ${fmtTime(m.t)}`:""}</div>`).join("");
    let wo="";
    const bs = blocks(d).filter(blockHasContent);
    bs.forEach((b,bi)=>{
      if (bs.length>1) wo += `<div class="sub" style="margin-top:4px"><b>Workout ${bi+1}${b.t0&&dstr(new Date(b.t0))===d?" · "+fmtTime(b.t0)+(b.t1&&b.t1-b.t0>60e3?` (${Math.round((b.t1-b.t0)/60e3)} min)`:""):""}</b></div>`;
      for (const [n,arr] of Object.entries(b.sets||{})){
        const ss = arr.filter(x=>x.r>0);
        if (!ss.length) continue;
        const nts = ss.filter(x=>x.note).map(x=>esc(x.note)).join(" · ");
        wo += `<div class="sub">🏋 ${esc(dispName(n))}: ${fmtSets(n,ss)}${nts?` <span style="color:var(--faint)">📝 ${nts}</span>`:""}</div>`;
      }
      if (b.run&&(b.run.dist||b.run.dur)) wo += `<div class="sub">🏃 ${b.run.dist||"?"} mi / ${b.run.dur||"?"} min${b.run.kcal?` · ${b.run.kcal} cal`:""}${b.run.note?" — "+esc(b.run.note):""}</div>`;
      (b.activities||[]).forEach(a=>{ wo += `<div class="sub">🎾 ${esc(a.name)}${a.dur?` · ${a.dur} min`:""}${a.kcal?` · ${a.kcal} cal`:""}${a.note?" — "+esc(a.note):""}</div>`; });
    });
    const body = [DB.weight[d]!=null?`${DB.weight[d]} ${CFG.units.weight}`:null, DB.waist[d]!=null?`waist ${DB.waist[d]} ${CFG.units.waist}`:null].filter(Boolean).join(" · ");
    return `<div class="card">
      <h2 style="display:flex;justify-content:space-between;align-items:center">${fmtLong(d)}
        <button class="btn small" onclick="setDate('${d}');go('today')">Edit day</button></h2>
      ${t?`<div style="font-size:14px;margin-bottom:6px"><b>${t.cal}</b> cal · <b>${t.protein}g</b> protein${DB.mealsDone[d]?' <span style="color:var(--good)">✓</span>':""}${bs.length?' · <span style="color:var(--good)">workout ✓</span>':""}</div>`:""}
      ${meals}${wo}
      ${body?`<div class="sub" style="margin-top:4px">⚖ ${body}</div>`:""}
    </div>`;
  }).join("");
}

/* ================= LIFTS ================= */
// notes across all sessions for an exercise: [{date, note}]
function exNotes(name){
  const out=[];
  for (const date of Object.keys(DB.workouts).sort())
    for (const b of blocks(date)) for (const x of ((b.sets||{})[name]||[])) if (x.note) out.push({date, note:x.note});
  return out;
}
export function viewLifts(){
  const seg = CFG.keyLifts.map(n=>
    `<button class="${n===S.liftSel?'on':''}" onclick="pickLift('${esc(n)}')">${esc(dispName(n))}</button>`).join("");
  const h = exHistory(S.liftSel);
  const rx = exPrescription(S.liftSel);
  const rdy = readyToProgress(S.liftSel);
  const pts = h.map(s=>[s.date, Math.round(Math.max(...s.sets.map(x=>epley(x.w,x.r)))*10)/10]);
  const pin = DB.exNotes[S.liftSel];
  let html = `<div class="card"><h2 style="display:flex;justify-content:space-between;align-items:center">Key lift
    <a href="#" class="muted" style="color:var(--accent);font-size:12px" onclick="renameEx('${esc(S.liftSel)}');return false">rename</a></h2><div class="seg">${seg}</div>
    <div style="margin:6px 0"><span style="color:var(--warn)">📌 ${pin?esc(pin):'<span class="muted">no pinned note</span>'}</span> · <a href="#" class="muted" style="color:var(--accent);font-size:12px" onclick="setExNote('${esc(S.liftSel)}');return false">${pin?"edit":"add"} pinned note</a></div>`;
  if (rdy) html+=`<div class="flag">▲ Ready to progress: on ${fmtShort(rdy.date)} you got ${rx.hi} reps on every set (${fmtSets(S.liftSel,rdy.sets)}). ${isBodyweight(S.liftSel)?"Add reps next session.":`Use a heavier ${CFG.units.weight==="lb"?"weight":"load"} next session.`}</div>`;
  html += `<h3>Estimated 1RM (Epley)</h3>`;
  html += lineChart([{pts, color:"#4da3ff", r:3, width:2}]);
  if (h.length){
    html += `<table class="hist"><tr><th>Date</th><th>Sets</th><th>Best e1RM</th></tr>`;
    for (const s of h.slice().reverse().slice(0,20)){
      const notes=s.sets.filter(x=>x.note).map(x=>esc(x.note)).join(" · ");
      html+=`<tr><td>${fmtShort(s.date)}</td><td>${fmtSets(S.liftSel,s.sets)}${notes?`<div style="color:var(--faint);font-size:11px">📝 ${notes}</div>`:""}</td><td>${bestE1RM(s.sets)}</td></tr>`;
    }
    html+="</table>";
  } else html += `<div class="center">Log a ${esc(dispName(S.liftSel))} session and it shows up here.</div>`;
  html += `</div>`;
  const others=[];
  for (const n of allLoggedExercises()) if(!CFG.keyLifts.includes(n)){
    const hh=exHistory(n); if(!hh.length) continue;
    const lastS=hh[hh.length-1];
    const retired = !exDef(n);
    const apin = DB.exNotes[n];
    others.push(`<div class="li"><div>${esc(dispName(n))}${retired?' <span class="badge">retired</span>':""}<div class="sub">last ${fmtShort(lastS.date)}: ${fmtSets(n,lastS.sets)}</div>${apin?`<div class="sub" style="color:var(--warn)">📌 ${esc(apin)}</div>`:""}</div>
      <div style="display:flex;gap:8px;align-items:center;flex:none">${readyToProgress(n)?'<span class="badge good">▲</span>':''}<a href="#" class="muted" style="color:var(--accent);font-size:12px" onclick="setExNote('${esc(n)}');return false">📌</a><a href="#" class="muted" style="color:var(--accent);font-size:12px" onclick="renameEx('${esc(n)}');return false">rename</a></div></div>`);
  }
  if(others.length) html+=`<div class="card"><h2>Accessories</h2>${others.join("")}</div>`;
  return html;
}
export function pickLift(n){ S.liftSel=n; render(); }
export function renameEx(name){
  const cur=dispName(name);
  const v=prompt(`Rename "${cur}" (display only — history is kept):`, cur);
  if(v==null) return;
  const t=v.trim();
  if(!t || t===name){ delete DB.aliases[name]; }
  else DB.aliases[name]=t;
  Store.save(); render();
}

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
  const adh = adherence(days.filter(d=>d<=today()));
  let floorDays=0, calSum=0, calN=0, fullyLoggedDays=0;
  for (const d of days){
    if (DB.meals[d]&&DB.meals[d].length){ const t=dayTotals(d); calSum+=t.cal; calN++; if(t.protein>=T.proteinFloor) floorDays++; }
    if (DB.mealsDone[d]) fullyLoggedDays++;
  }
  html+=`<div class="card"><h2>Adherence — last 30 days</h2><div class="stat">
    <div class="s"><div class="v">${adh.got}/${adh.need}</div><div class="k">workouts completed vs prescribed</div></div>
    <div class="s"><div class="v">${floorDays}/${calN||0}</div><div class="k">logged days hitting ${T.proteinFloor}g protein floor</div></div>
    <div class="s"><div class="v">${calN?Math.round(calSum/calN):"—"}</div><div class="k">avg daily calories (target ${T.cal})</div></div>
    <div class="s"><div class="v">${fullyLoggedDays}</div><div class="k">days with food fully logged</div></div>
    <div class="s"><div class="v">${days.length-fullyLoggedDays}</div><div class="k">days without all meals logged</div></div>
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
    const complete=DB.mealsDone[d]?" [all meals logged]":" [may be incomplete]";
    s+=`${d}: ${t.cal} cal, ${t.protein}g protein${cheat}${flag}${complete}\n`;
    for(const m of DB.meals[d].filter(m=>!m.tid)) s+=`   ${m.label?m.label.toLowerCase()+": ":""}${m.name} (${m.lazy?"not counted — record only":`${m.cal} cal, ${m.protein}g`})\n`;
  }
  if(!any) s+="none logged\n";
  s+="\n## Key lifts — full history (weight×reps per set, best e1RM)\n";
  for(const n of CFG.keyLifts){
    const h=exHistory(n); if(!h.length){ s+=`### ${dispName(n)}\nno sessions\n`; continue; }
    const rx=exPrescription(n), rdy=readyToProgress(n);
    s+=`### ${dispName(n)} (prescribed ${rx.sets}×${rx.lo}–${rx.hi})${rdy?" — READY TO PROGRESS":""}\n`;
    for(const sess of h){
      const notes=sess.sets.filter(x=>x.note).map(x=>x.note).join("; ");
      s+=`${sess.date}: ${fmtSets(n,sess.sets)} | e1RM ${bestE1RM(sess.sets)}${notes?` | notes: ${notes}`:""}\n`;
    }
  }
  s+="\n## Other exercises — last session each\n";
  for(const n of allLoggedExercises()) if(!CFG.keyLifts.includes(n)){
    const h=exHistory(n); if(!h.length) continue;
    const lastS=h[h.length-1];
    const retired = !exDef(n);
    const anotes=lastS.sets.filter(x=>x.note).map(x=>x.note).join("; ");
    s+=`${dispName(n)}${retired?" [no longer in program]":""}: ${lastS.date} — ${fmtSets(n,lastS.sets)}${anotes?` | notes: ${anotes}`:""}${readyToProgress(n)?" [ready to progress]":""}\n`;
  }
  s+="\n## Runs — last 30 days\n"; let anyRun=false;
  for(const d of days) for(const b of blocks(d))
    if(b.run&&(b.run.dist||b.run.dur)){ anyRun=true; s+=`${d}: ${b.run.dist||"?"} mi in ${b.run.dur||"?"} min${b.run.kcal?`, ~${b.run.kcal} cal burned`:""}${b.run.note?" — "+b.run.note:""}\n`; }
  if(!anyRun) s+="none logged\n";
  s+="\n## Other activities — last 30 days\n"; let anyAct=false;
  for(const d of days) for(const b of blocks(d)) for(const a of (b.activities||[])){
    anyAct=true; s+=`${d}: ${a.name}${a.dur?`, ${a.dur} min`:""}${a.kcal?`, ~${a.kcal} cal`:""}${a.note?" — "+a.note:""}\n`; }
  if(!anyAct) s+="none logged\n";
  const adhExport = adherence(days.filter(d=>d<=today()));
  s+=`\n## Adherence (30d)\nWorkouts: ${adhExport.got}/${adhExport.need} prescribed sessions completed\n`;
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
      for (const k of DOC_KEYS) DB[k] = doc[k] || {};
      Store.migrate(DB);
      Store.save(); render(); toast("Imported");
    } catch(e){ toast("Not a valid export file"); }
  });
}
export function resetAll(){
  if (!confirm("Erase ALL logged data? This wipes this device AND the server copy.")) return;
  for (const k of DOC_KEYS) DB[k] = {};
  Store.save(); localStorage.removeItem(Store.DIRTY); render();
}
export function logout(){ Store.logout(); }
