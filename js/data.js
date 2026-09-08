import { CFG } from "./config.js";
import { DB, Store } from "./store.js";
import { today, dow, epley } from "./util.js";

/* ---------- program ----------
   CFG is the program as shipped; DB.plan holds Plan-tab edits on top of it. A shipped exercise
   may carry from/until so the backfill below knows it wasn't prescribed before it existed;
   day-to-day, history is protected by the stored completion flag rather than by dating. */
const liveOn = (e, on) => (!e.from || e.from <= on) && (!e.until || e.until > on);
export function sessions(on){
  const day = on || today();
  const out = {}, ov = (DB.plan && DB.plan.sessions) || {};
  for (const [id, s] of Object.entries(CFG.sessions)) out[id] = { ...s };
  for (const [id, s] of Object.entries(ov)) out[id] = { ...(out[id] || {}), ...s };
  for (const s of Object.values(out))
    if (s.exercises) s.exercises = s.exercises.filter(e => liveOn(e, day));
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
  // the plan as of that day, so a backfill of old days isn't judged against exercises that
  // hadn't been added yet; for a day you're logging now, that's simply today's plan
  const s = sessions(d)[sid];
  if (!s || s.type==="rest") return false;
  if (s.type==="run") return blocks(d).some(b=>b.run && (b.run.dist||b.run.dur));
  // an emptied session satisfies nothing: every() on [] is true, which would green up every
  // past day the moment the last exercise came out of a session
  if (s.type==="lift") return !!(s.exercises||[]).length && s.exercises.every(ex=>daySetCount(d, ex.n) >= ex.sets);
  return false;
}
/* Completion is recorded, not re-derived. A day is stamped with the prescribed sessions its
   logged work actually finished, at the moment you log it — so changing the plan later never
   rewrites what a past day was measured against. Re-run only for the day being edited, which
   is the one you're actively making claims about. */
export function refreshCompletion(d){
  const own = programSplit()[dow(d)], done = [];
  if (own && sessionSatisfiedOnDay(d, own)) done.push(own);
  // a session made up onto this day completes the day just as its own session would
  for (const m of (DB.makeup[d] || [])) if (m !== own && sessionSatisfiedOnDay(d, m)) done.push(m);
  if (done.length) DB.completed[d] = done; else delete DB.completed[d];
  return done;
}
export const completedOn = d => DB.completed[d] || [];
/* One-off: stamp days logged before completion was tracked, so the switch doesn't blank out
   history. Uses each day's own date, so an exercise added to the shipped program later (via
   `from`) isn't held against days that predate it. */
export function backfillCompletion(){
  const days = Object.keys(DB.workouts);
  // Nothing logged yet means nothing to stamp — and, more importantly, nothing to write. On a
  // fresh device this runs before any data has arrived; saving an empty doc here would mark it
  // dirty and let it win the next sync. Staying quiet also means the backfill still fires later,
  // when workouts actually show up (a pull, or a JSON import).
  if (!days.length || DB.prefs.completedBackfill) return false;
  for (const d of days) refreshCompletion(d);
  DB.prefs.completedBackfill = 1;
  Store.save();
  return true;
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
      const done = week.some(d2 => completedOn(d2).includes(sid));
      if (done) got++;
    }
  }
  return { need, got };
}

/* How a day reads for workouts. A session counts on whatever day it actually got done, so a
   Tuesday session made up on Wednesday makes *Wednesday* the completed day — same credit rule
   adherence() uses.
     done    — the day was stamped complete when its work was logged (its own session, or one
               made up onto it — finishing Tuesday's session on Wednesday completes Wednesday)
     partial — training was logged, but no prescribed session was finished
     missed  — a session was prescribed and the day came and went without it
     rest    — the split prescribes rest, so there was nothing to miss
   Today is never "missed" — the day isn't over. Making a session up later greens up the day it
   actually happened on and still counts toward adherence, but the skipped day stays red: it is
   a record of what you did that day. */
export function workoutDayState(d){
  if (d > today()) return "future";
  const sid = programSplit()[dow(d)], own = sessions(d)[sid];
  const prescribed = own && own.type !== "rest";
  if (completedOn(d).length) return "done";
  if (blocks(d).some(blockHasContent)) return "partial";
  if (!prescribed || d === today()) return "rest";
  return "missed";
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
