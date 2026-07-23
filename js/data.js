import { CFG } from "./config.js";
import { DB } from "./store.js";
import { today, epley } from "./util.js";

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

export function loggedSets(block, name){ return ((block.sets||{})[name]||[]).filter(x=>x.w>0||x.r>0); }
export function daySetCount(d, name){ return blocks(d).reduce((a,b)=>a+loggedSets(b,name).length, 0); }
export function blockHasContent(b){
  return Object.keys(b.sets||{}).some(n=>loggedSets(b,n).length) || (b.run && (b.run.dist||b.run.dur)) || (b.activities&&b.activities.length);
}
export function dayDone(d){ return blocks(d).some(b=>b.done); }

/* ---------- exercise catalog & progression ---------- */
export function allExercises(){
  const seen={}, out=[];
  for (const s of Object.values(CFG.sessions)) if(s.exercises)
    for (const e of s.exercises) if(!seen[e.n]){ seen[e.n]=1; out.push(e); }
  return out;
}
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
    for (const b of blocks(date)) for (const x of ((b.sets||{})[name]||[])) if (x.w>0&&x.r>0) sets.push(x);
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
