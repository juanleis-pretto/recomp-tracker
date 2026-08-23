import { CFG } from "./config.js";
import { DB } from "./store.js";
import { today, dow, epley } from "./util.js";

/* ---------- nutrition ---------- */
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
  const s = CFG.sessions[sid];
  if (!s || s.type==="rest") return false;
  if (s.type==="run") return blocks(d).some(b=>b.run && (b.run.dist||b.run.dur));
  if (s.type==="lift") return s.exercises.every(ex=>daySetCount(d, ex.n) >= ex.sets);
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
      const sid = CFG.split[dow(d)];
      if (!CFG.sessions[sid] || CFG.sessions[sid].type==="rest" || seen.has(sid)) continue;
      seen.add(sid); need++;
      const done = week.some(d2 => (d2===d || (DB.makeup[d2]||[]).includes(sid)) && sessionSatisfiedOnDay(d2, sid));
      if (done) got++;
    }
  }
  return { need, got };
}

/* ---------- exercise catalog & progression ---------- */
export function allExercises(){
  const seen={}, out=[];
  for (const s of Object.values(CFG.sessions)) if(s.exercises)
    for (const e of s.exercises) if(!seen[e.n]){ seen[e.n]=1; out.push(e); }
  for (const e of (CFG.extraExercises||[])) if(!seen[e.n]){ seen[e.n]=1; out.push(e); }
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
  for (const s of Object.values(CFG.sessions))
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
