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

Editing the plan never rewrites history, because completion is **recorded, not re-derived**.
When you log, `refreshCompletion(date)` checks the day's work against the plan and stamps
`completed[date]` with the session ids it finished; the calendar and `adherence()` read that
stamp. So adding an exercise today changes what counts from here on and leaves last week's
green days green. A session made up onto a day completes that day the same way its own session
would — finish Tuesday's run on Wednesday and Wednesday is the day that gets stamped, while
Tuesday stays red. The calendar records what you did on each day; adherence, which credits per
Mon–Sun week, is where a made-up session still counts.

`backfillCompletion()` stamps days logged before this existed, once per doc. It skips entirely
while there are no workouts: on a fresh device it would otherwise run before the first sync and
save an empty doc, marking it dirty so it could win the next push. Staying quiet also means it
still fires later, when workouts arrive from a pull or a JSON import.

A shipped exercise can carry `from`/`until` (YYYY-MM-DD) to date it into or out of the program —
that's what keeps the backfill honest about days that predate it (dead hangs, added 2026-09-07).

For a permanent change to the defaults (or to edit the targets, meal templates, or units), edit
`CFG` in `js/config.js` and push to `main` (auto-deploys) or `npx vercel --prod`. Note a saved
plan override wins over `CFG` for whatever it covers.
