# Recomp Tracker — deploy

Static single-file app + Supabase (auth + Postgres). ~10 minutes total.

## 1. Supabase (free tier)

1. https://supabase.com → New project (any region near you).
2. SQL Editor → paste `supabase-setup.sql` → Run. Creates one `app_state` table with RLS (rows readable/writable only by their owner).
3. Authentication → Users → **Add user** → your email + a password → check "Auto Confirm User".
4. Authentication → Sign In / Providers → Email → **disable "Allow new users to sign up"**. With signups off + RLS on, the anon key in the client is harmless — this is the standard Supabase model.
5. Settings → API → copy **Project URL** and **anon public** key.

## 2. Configure the app

In `index.html`, near the top of the `<script>`, fill in:

```js
const SUPA = {
  url: "https://YOURREF.supabase.co",
  anonKey: "eyJ...",
};
```

Leave both empty and the app runs in local-only mode (what you had before).

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

## Changing the program

Targets, meal templates, split, exercises and rep ranges are all in the `CFG` object at the top of the script in `index.html`. Edit, redeploy (`npx vercel --prod`).
