import { CFG } from "./config.js";
import { DB } from "./store.js";
import { today, dow, parseD, dstr, epley } from "./util.js";

/* ---------- program (shipped defaults + your edits) ----------
   CFG holds the program as shipped; DB.plan holds whatever the Plan tab changed. Everything
   reads sessions()/programSplit() rather than the config directly, so an edit lands
   everywhere at once — including backwards: past days are always scored against the plan as
   it stands now, which is what makes adding an exercise mark earlier days as not having
   followed it. */
export function sessions(){
  const out = { ...CFG.sessions }, ov = (DB.plan && DB.plan.sessions) || {};
  for (const [id, s] of Object.entries(ov)) out[id] = { ...(CFG.sessions[id] || {}), ...s };
  return out;
}
export function programSplit(){ return { ...CFG.split, ...((DB.plan && DB.plan.split) || {}) }; }
export function planEdited(){
  const p = DB.plan || {};
  return !!(Object.keys(p.sessions || {}).length || Object.keys(p.split || {}).length);
}

/* ---------- nutrition ---------- */
// CFG.targets is the program default; anything the user edits in the app overrides it.
// Everything reads targets() rather than CFG.targets so an edit lands everywhere at once.
export function targets(){ return { ...CFG.targets, ...((DB.prefs && DB.prefs.targets) || {}) }; }

export function dayTotals(date){
  const meals = DB.meals[date]||[];
  const t = meals.reduce((a,m)=>({cal:a.cal+(+m.cal||0), protein:a.protein+(+m.protein||0)}),{cal:0,protein:0});
  return { cal: Math.round(t.cal*10)/10, protein: Math.round(t.protein*10)/10 };
}

/* ---------- workout blocks ----------
   A "workout" is a block of segments (exercise sets / a run). Blocks are
   auto-created: a segment logged within CFG.workoutWindowMs of the day's last
   activity joins that workout; otherwise a new one starts. "New workout"
   button forces a split. */
export function blocks(d){ return DB.workouts[d] || []; }

export function newBlock(d){
  const t = Date.now();
  const b = { id:"b"+t+Math.random().toString(36).slice(2,6), t0:t, t1:t, sets:{}, run:{}, done:false };
  (DB.workouts[d] = DB.workouts[d] || []).push(b);
  return b;
}

// The block new segments attach to (or null → a new one will be created).
export function activeBlock(d, force=false){
  const arr = blocks(d);
  const last = arr[arr.length-1];
  if (!last || force) return null;
  if (d !== today()) return last;                       // past-day edits: attach to last unless forced
  return (Date.now() - (last.t1||last.t0)) <= CFG.workoutWindowMs ? last : null;
}
export function attachBlock(d, force=false){
  let b = activeBlock(d, force);
  if (!b) b = newBlock(d);
  b.t1 = Date.now();
  return b;
}

export function loggedSets(block, name){ return ((block.sets||{})[name]||[]).filter(x=>x.r>0); }
// drop blocks that have nothing in them (fixes stale workout start-times after deletes)
export function pruneEmptyBlocks(d){
  if(!DB.workouts[d]) return;
  DB.workouts[d] = DB.workouts[d].filter(b => blockHasContent(b) || b.done);
  if(!DB.workouts[d].length) delete DB.workouts[d];
}
export function daySetCount(d, name){ return blocks(d).reduce((a,b)=>a+loggedSets(b,name).length, 0); }
export function blockHasContent(b){
  return Object.keys(b.sets||{}).some(n=>loggedSets(b,n).length) || (b.run && (b.run.dist||b.run.dur)) || (b.activities&&b.activities.length);
}
// was this session type fully logged on this specific day — every exercise at its prescribed set
// count, or any run data for a run session? (independent of whether `d` is that session's own
// scheduled day, so it can also check a makeup day.)
function sessionSatisfiedOnDay(d, sid){
  const s = sessions()[sid];
  if (!s || s.type==="rest") return false;
  if (s.type==="run") return blocks(d).some(b=>b.run && (b.run.dist||b.run.dur));
  // an emptied session satisfies nothing: every() on [] is true, which would green up every
  // past day the moment the last exercise came out of a session
  if (s.type==="lift") return !!(s.exercises||[]).length && s.exercises.every(ex=>daySetCount(d, ex.n) >= ex.sets);
  return false;
}
// workout adherence, credited per calendar week (Mon–Sun, matching the split — Sunday is the rest
// day and the last chance to make up a miss) rather than per exact day: a session made up on a
// different day still counts, as long as it's within the same week as its own scheduled day — which
// day it happened on matters less than the work getting done.
export function adherence(days){
  const weeks=[]; let cur=[];
  for (const d of days){ if (dow(d)===1 && cur.length){ weeks.push(cur); cur=[]; } cur.push(d); }
  if (cur.length) weeks.push(cur);
  let need=0, got=0;
  for (const week of weeks){
    const seen=new Set();
    for (const d of week){
      const sid = programSplit()[dow(d)], all = sessions();
      if (!all[sid] || all[sid].type==="rest" || seen.has(sid)) continue;
      seen.add(sid); need++;
      const done = week.some(d2 => (d2===d || (DB.makeup[d2]||[]).includes(sid)) && sessionSatisfiedOnDay(d2, sid));
      if (done) got++;
    }
  }
  return { need, got };
}

// the Mon–Sun week containing d, as date strings — the unit adherence() credits against
function weekOf(d){
  const x = parseD(d), mon = new Date(x);
  mon.setDate(x.getDate() - ((x.getDay()+6)%7));
  return Array.from({length:7}, (_,i)=>{ const y=new Date(mon); y.setDate(mon.getDate()+i); return dstr(y); });
}
// was this session made up on some *other* day of d's week?
function madeUpInWeek(d, sid){
  return weekOf(d).some(d2 => d2!==d && (DB.makeup[d2]||[]).includes(sid) && sessionSatisfiedOnDay(d2, sid));
}
/* How a day reads for workouts. A session counts on whatever day it actually got done, so a
   Tuesday session made up on Wednesday makes *Wednesday* the completed day — same credit rule
   adherence() uses.
     done    — a prescribed session was completed here (this day's own, or one made up onto it)
     partial — training was logged, but no prescribed session was finished
     missed  — a session was prescribed, nothing was logged, and it wasn't made up that week
     rest    — the split prescribes rest, or the missed session was made up on another day
   Today is never "missed" — the day isn't over. A miss also un-reds itself the moment that
   session gets made up later in the same week. */
export function workoutDayState(d){
  if (d > today()) return "future";
  const sid = programSplit()[dow(d)], own = sessions()[sid];
  const prescribed = own && own.type !== "rest";
  if (prescribed && sessionSatisfiedOnDay(d, sid)) return "done";
  if ((DB.makeup[d]||[]).some(m => sessionSatisfiedOnDay(d, m))) return "done";
  if (blocks(d).some(blockHasContent)) return "partial";
  if (!prescribed || d === today()) return "rest";
  return madeUpInWeek(d, sid) ? "rest" : "missed";
}

/* ---------- exercise catalog & progression ---------- */
export function allExercises(){
  const seen={}, out=[];
  const push = e => { if(!seen[e.n]){ seen[e.n]=1; out.push(e); } };
  // plan first so edited sets/reps win, then the shipped program so a move dropped from the
  // plan keeps its unit/bodyweight metadata and its old history still renders correctly
  for (const s of Object.values(sessions())) if(s.exercises) s.exercises.forEach(push);
  for (const s of Object.values(CFG.sessions)) if(s.exercises) s.exercises.forEach(push);
  for (const e of (CFG.extraExercises||[])) push(e);
  return out;
}
export function exDef(name){ return allExercises().find(e=>e.n===name) || null; }
export function isBodyweight(name){ const e=exDef(name); return !!(e && e.bw); }
// configured exercises + anything ever logged (retired program items keep their history)
export function allLoggedExercises(){
  const names = new Set(allExercises().map(e=>e.n));
  for (const d of Object.keys(DB.workouts))
    for (const b of blocks(d)) for (const n of Object.keys(b.sets||{})) names.add(n);
  return [...names];
}
export function exPrescription(name){
  for (const s of Object.values(sessions()))
    if (s.exercises){ const e=s.exercises.find(e=>e.n===name); if(e) return e; }
  return null;
}
// history merged per date across blocks: [{date, sets:[{w,r}]}] asc
export function exHistory(name, before){
  const out=[];
  for (const date of Object.keys(DB.workouts).sort()){
    if (before && date >= before) continue;
    const sets=[];
    for (const b of blocks(date)) for (const x of ((b.sets||{})[name]||[])) if (x.r>0) sets.push(x);
    if (sets.length) out.push({date, sets});
  }
  return out;
}
// last session hit top of rep range on all prescribed sets → add weight
export function readyToProgress(name){
  const rx = exPrescription(name); if(!rx) return null;
  const h = exHistory(name); if(!h.length) return null;
  const last = h[h.length-1];
  const ok = last.sets.length >= rx.sets && last.sets.every(s=>s.r >= rx.hi);
  return ok ? last : null;
}
export function bestE1RM(sets){ return Math.round(Math.max(...sets.map(x=>epley(x.w,x.r)))); }
// single-joint/isolation moves (less absolute strength behind them) get finer jumps than compound lifts
const ISOLATION_RE = /curl|pushdown|extension|raise|fly|face pull|woodchop|pallof|kickback/i;
function exIncrement(name){ return ISOLATION_RE.test(name) ? 2.5 : 5; }
// double progression: suggest the next weight from the single most recently logged set for this
// exercise (today's last set if any, else last session's last set) — hit top of rep range → add the
// increment; missed badly (under half the low end) → drop it; otherwise repeat the same weight
export function suggestedWeight(name){
  if (isBodyweight(name)) return null;
  const h = exHistory(name); if (!h.length) return null;
  const last = h[h.length-1].sets.slice(-1)[0];
  const rx = exPrescription(name);
  if (!rx) return last.w;
  const inc = exIncrement(name);
  if (last.r >= rx.hi) return last.w + inc;
  if (last.r < rx.lo/2) return Math.max(inc, last.w - inc);
  return last.w;
}
// bodyweight moves have no weight to add, so reps (or seconds) is the progressive variable instead —
// same double-progression rule as suggestedWeight, applied to the target itself: hit the goal → raise
// it next time; miss badly → ease it back down; otherwise hold at the current prescribed target
export function suggestedReps(name){
  if (!isBodyweight(name)) return null;
  const rx = exPrescription(name); if (!rx) return null;
  const h = exHistory(name); if (!h.length) return null;
  const last = h[h.length-1].sets.slice(-1)[0];
  const inc = rx.unit==='sec' ? 5 : 2;
  if (last.r >= rx.hi) return last.r + inc;
  if (last.r < rx.lo/2) return Math.max(inc, last.r - inc);
  return rx.hi;
}
