# Recomp Tracker — deploy

Static app (plain ES modules, no build step) + Supabase (auth + Postgres). ~10 minutes total.

## 1. Supabase (free tier)

1. https://supabase.com → New project (any region near you).
2. SQL Editor → paste `supabase-setup.sql` → Run. Creates one `app_state` table with RLS (rows readable/writable only by their owner).
3. Authentication → Users → **Add user** → your email + a password → check "Auto Confirm User".
4. Authentication → Sign In / Providers → Email → **disable "Allow new users to sign up"**. With signups off + RLS on, the anon key in the client is harmless — this is the standard Supabase model.
5. Settings → API → copy **Project URL** and **anon public** key.

## 2. Configure the app

In `js/config.js`, fill in:

```js
export const SUPA = {
  url: "https://YOURREF.supabase.co",
  anonKey: "eyJ...",
};
```

Leave both empty and the app runs in local-only mode.

## 3. Deploy to Vercel

From this folder:

```sh
npx vercel --prod
```

Accept defaults (it's detected as a static site). Or push the folder to a GitHub repo and import it at vercel.com/new — same result, plus auto-deploy on push.

## 4. iPhone

Open the Vercel URL in Safari → sign in → Share → **Add to Home Screen**. Runs fullscreen; sign-in persists.

## How sync works

- Every edit writes to localStorage instantly (works offline mid-set), sets a dirty flag, and pushes the whole state doc to Postgres ~1s later.
- If offline, the header shows "offline — will retry"; it retries when the network returns or the app regains focus.
- On launch: server copy wins unless local has unsynced changes, in which case local wins (single-user last-write-wins; don't log on two devices simultaneously and it'll never bite you).
- Export tab: JSON backup/restore still there, plus "Export to Claude".

## Structure

```
index.html      markup + login gate
styles.css      theme
js/config.js    CFG (targets, meals, split, exercises) + SUPA keys — edit the program here
js/util.js      date/format helpers, Epley
js/store.js     persistence: localStorage cache + Supabase sync, v1→v2 migration
js/data.js      domain logic: totals, workout blocks, progression detection
js/charts.js    dependency-free SVG line/bar charts
js/views.js     all screens + user actions
js/app.js       tabs, render loop, window bindings, boot
```

Workout model: `workouts[date]` is an array of **blocks** (a workout). A set logged within 2h (`CFG.workoutWindowMs`) of the day's last activity joins the current workout; a longer gap — or the "start a new workout" link — begins a new one. Sets bundle per exercise within a block regardless of order.

## Changing the program

The **Plan** tab edits it in the app: pick a weekday, swap which session it runs, and
add/remove/reorder its exercises or change sets and rep ranges. Edits are stored in the synced
doc as overrides on top of `CFG`, so "restore the shipped program" is just a delete.

The plan is scored **live**, which is deliberate: past days are measured against the plan as it
stands now, so adding an exercise makes days that didn't include it stop counting as complete.
Nothing logged is ever touched — removing an exercise keeps its history, and its old sets still
render with the right units because `allExercises()` falls back to the shipped definitions.

For a permanent change to the defaults (or to edit the targets, meal templates, or units), edit
`CFG` in `js/config.js` and push to `main` (auto-deploys) or `npx vercel --prod`. Note a saved
plan override wins over `CFG` for whatever it covers.
