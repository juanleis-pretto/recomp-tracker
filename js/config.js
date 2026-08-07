/* ================= CONFIG — edit program & targets here ================= */
export const CFG = {
  targets: { cal: 1870, protein: 169, proteinFloor: 150 },
  units: { weight: "lb", waist: "in" },
  mealTemplates: [
    { id:"breakfast", name:"Breakfast — standard", detail:"3 eggs + 1c Greek yogurt", cal:360, protein:43 },
    { id:"lunch",     name:"Lunch — standard",     detail:"6oz beef + rice + veg",    cal:620, protein:50 },
    { id:"snack",     name:"Snack — standard",     detail:"Cottage cheese + fruit",   cal:270, protein:26 },
    { id:"dinner",    name:"Dinner — standard",    detail:"8oz shrimp + pasta + veg + oil", cal:620, protein:50 },
  ],
  cheatDay: 5, // Friday: restaurant dinner is part of the plan
  // Two segments logged within this window belong to the same workout.
  workoutWindowMs: 2 * 3600e3,
  // sessions: reps `hi` = top of rep range → progression trigger
  sessions: {
    push_a: { name:"Push (chest emphasis)", type:"lift", exercises:[
      { n:"Dumbbell bench press",           sets:4, lo:8,  hi:8,  mus:"chest, triceps, front delts" },
      { n:"Incline dumbbell press",         sets:3, lo:8,  hi:10, mus:"upper chest, front delts, triceps" },
      { n:"Seated dumbbell shoulder press", sets:3, lo:8,  hi:8,  mus:"shoulders, triceps" },
      { n:"Cable fly",                      sets:3, lo:12, hi:12, mus:"chest" },
      { n:"Triceps pushdown",               sets:3, lo:12, hi:12, mus:"triceps" },
      { n:"Cable woodchop",                 sets:3, lo:12, hi:12, note:"per side", mus:"obliques, core" },
      { n:"Hanging leg raise",              sets:3, lo:12, hi:12, bw:true, mus:"abs, hip flexors" },
    ]},
    pull: { name:"Pull", type:"lift", exercises:[
      { n:"Chest-supported dumbbell row", sets:4, lo:8,  hi:8,  mus:"lats, upper back, rear delts, biceps" },
      { n:"Lat pulldown",     sets:3, lo:10, hi:10, mus:"lats, biceps" },
      { n:"Seated cable row", sets:3, lo:10, hi:10, mus:"mid-back, lats, biceps" },
      { n:"Face pull",        sets:3, lo:15, hi:15, mus:"rear delts, upper back" },
      { n:"Dumbbell curl",    sets:3, lo:12, hi:12, mus:"biceps" },
    ]},
    legs: { name:"Legs & Core", type:"lift", exercises:[
      { n:"Goblet squat",           sets:4, lo:10, hi:10, mus:"quads, glutes" },
      { n:"Dumbbell RDL (light)",   sets:3, lo:8,  hi:8,  mus:"hamstrings, glutes" },
      { n:"Walking lunge",          sets:3, lo:10, hi:10, note:"per leg", mus:"quads, glutes, hamstrings" },
      { n:"Hanging leg raise",      sets:3, lo:12, hi:12, bw:true, mus:"abs, hip flexors" },
      { n:"Plank",                  sets:3, lo:45, hi:45, unit:"sec", bw:true, mus:"core" },
    ]},
    push_b: { name:"Push (incline emphasis)", type:"lift", exercises:[
      { n:"Incline dumbbell press",       sets:4, lo:8,  hi:8,  mus:"upper chest, front delts, triceps" },
      { n:"Flat dumbbell press",          sets:3, lo:8,  hi:10, mus:"chest, triceps" },
      { n:"Dumbbell lateral raise",       sets:3, lo:15, hi:15, mus:"side delts" },
      { n:"Machine chest press",          sets:3, lo:10, hi:10, mus:"chest, triceps" },
      { n:"Overhead triceps extension",   sets:3, lo:12, hi:12, mus:"triceps" },
      { n:"Pallof press",                 sets:3, lo:12, hi:12, note:"per side", mus:"core, obliques" },
    ]},
    run_easy: { name:"Run — easy", type:"run", detail:"35 min conversational pace" },
    run_int:  { name:"Run — intervals", type:"run", detail:"10 min warmup · 6 × (2 hard / 2 easy) · 5 min cooldown" },
    rest: { name:"Rest", type:"rest" },
  },
  // available in the picker on any day, not tied to a prescribed session
  extraExercises: [
    { n:"Jump rope", bw:true, unit:"sec", note:"seconds or skips", mus:"calves, cardio" },
  ],
  split: { 0:"rest", 1:"push_a", 2:"run_easy", 3:"pull", 4:"legs", 5:"push_b", 6:"run_int" },
  keyLifts: ["Dumbbell bench press","Incline dumbbell press","Chest-supported dumbbell row","Goblet squat"],
};

/* ====== SUPABASE ====== */
export const SUPA = {
  url: "https://ghdxoskreouvssrxrspg.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdoZHhvc2tyZW91dnNzcnhyc3BnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5ODYxMTIsImV4cCI6MjA5OTU2MjExMn0.d6vCsHRiNO325NkEZRJ7NAp4NH5WgDEUk0gvDdyJERM", // anon public key — safe in client, RLS guards data
};

export const MEAL_LABELS = ["Breakfast","Lunch","Snack","Dinner","Other"];
