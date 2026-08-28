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
js/timer.js     rest timer (video-backed, pops out over other apps)
js/views.js     all screens + user actions
js/app.js       tabs, render loop, window bindings, boot
assets/         rest-timer.mp4 — generated, see tools/
tools/          make-rest-timer.py — regenerates the timer video
```

Workout model: `workouts[date]` is an array of **blocks** (a workout). A set logged within 2h (`CFG.workoutWindowMs`) of the day's last activity joins the current workout; a longer gap — or the "start a new workout" link — begins a new one. Sets bundle per exercise within a block regardless of order.

## Rest timer

Tap a preset (or log a set, with auto-start on) and the countdown starts *and* pops out
into a floating window, so you can leave the app and still see it.

It's a video, not a JS countdown. iOS won't stream a live `<canvas>` into
Picture-in-Picture ([WebKit 181663](https://bugs.webkit.org/show_bug.cgi?id=181663)), but it
will float a real `<video>` — so `assets/rest-timer.mp4` is one 10-minute countdown and an
N-second rest seeks to `600 - N` and plays to 0:00. Consequences worth knowing:

- The **system** runs the clock and the end chime, so both keep working while the app is
  backgrounded or suspended — which plain JS timers don't survive on iOS.
- `video.currentTime` is the only clock, so the in-app readout can't drift from the
  popped-out window, and there's nothing to resync when you come back to the app.
- Max rest is 10:00, the length baked into the video.
- The timer bar lives outside `#main` because `render()` replaces that element's markup —
  tearing the `<video>` out mid-rest would stop playback and drop out of PiP.
- Serving it needs byte-range support (Vercel does this) or iOS won't play or seek it.

To change the look, durations, or beeps, edit and re-run `python3 tools/make-rest-timer.py`
(needs `ffmpeg` with libx264/aac, plus Pillow). Keep `SPAN` in `js/timer.js` in sync.

Pop-out needs Picture-in-Picture, which the button feature-detects; where it's unavailable
the in-app bar still counts down normally.

## Changing the program

Edit `CFG` in `js/config.js`, push to `main` (auto-deploys) or `npx vercel --prod`.
