/* ---------- rest timer ----------
   The timer is a video, not a JS countdown. iOS won't stream a live <canvas> into
   Picture-in-Picture (WebKit bug 181663), but it will float a real <video> — so
   assets/rest-timer.mp4 is one 10-minute countdown and an N-second rest just seeks to
   600-N and plays to 0:00. That means the *system* runs the clock and the end chime,
   so both survive the PWA being backgrounded or suspended, and video.currentTime is a
   single source of truth the on-screen readout can't drift from.

   The bar lives outside #main so a re-render can't tear down the video mid-rest —
   ripping the element out would stop playback and drop out of PiP. */

import { toast } from "./util.js";

const SPAN = 600;   // countdown baked into the video; must match tools/make-rest-timer.py

let v, bar, timeEl, playEl, wrap;

function els(){
  if (v) return true;
  v      = document.getElementById("restVid");
  bar    = document.getElementById("rest");
  timeEl = document.getElementById("restTime");
  playEl = document.getElementById("restPlay");
  wrap   = document.getElementById("restVidWrap");
  if (!v) return false;
  for (const e of ["timeupdate","play","pause","seeked","ended"]) v.addEventListener(e, paint);
  v.addEventListener("ended", stop);        // GO has had its 10s by now — clear the bar
  v.addEventListener("error", ()=>{ stop(); toast("Rest timer video failed to load"); });
  // the video is the only clock, so coming back from a suspended tab needs no resync
  document.addEventListener("visibilitychange", paint);
  for (const e of ["webkitpresentationmodechanged","enterpictureinpicture","leavepictureinpicture"])
    v.addEventListener(e, paint);
  return true;
}

const fmt = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
// whole seconds left, counting the partial second you're in — matches the video's own digits
export function remaining(){ return v ? Math.max(0, Math.ceil(SPAN - v.currentTime)) : 0; }
export function running(){ return !!v && !bar.hidden && !v.ended; }

function inPip(){
  if (!v) return false;
  return v.webkitPresentationMode === "picture-in-picture" || document.pictureInPictureElement === v;
}
export function pipAvailable(){
  if (!els()) return false;
  if (typeof v.webkitSupportsPresentationMode === "function")
    return !!v.webkitSupportsPresentationMode("picture-in-picture");
  return !!document.pictureInPictureEnabled;
}

function paint(){
  if (!v || bar.hidden) return;
  const r = remaining();
  timeEl.textContent = r > 0 ? fmt(r) : "GO";
  timeEl.className = "rt-time" + (r === 0 ? " go" : r <= 10 ? " soon" : "");
  playEl.textContent = v.paused ? "▶" : "❚❚";
  // in PiP the element renders blank in place, so label the gap instead of showing a black box
  wrap.classList.toggle("popped", inPip());
}

// currentTime only sticks once metadata is in; preload="auto" means that's usually already true
function seek(t){
  if (v.readyState >= 1) v.currentTime = t;
  else v.addEventListener("loadedmetadata", ()=>{ v.currentTime = t; }, { once:true });
}

/* Start (or restart) a rest. Call straight from a click: iOS gates both playback and PiP
   on the user gesture, and awaiting play() first would spend it. */
export function start(secs){
  if (!els()) return;
  secs = Math.max(5, Math.min(SPAN, Math.round(secs)));
  show(true);
  seek(SPAN - secs);
  const p = v.play();
  if (p && p.catch) p.catch(()=>{});
  pop();
  paint();
}
// the bar's pop-out control toggles, so it can also pull the window back in
export function togglePop(){ if (els()) inPip() ? unpop() : pop(); }
export function pop(){
  if (!els() || inPip()) return;
  try {
    if (typeof v.webkitSetPresentationMode === "function") v.webkitSetPresentationMode("picture-in-picture");
    else if (document.pictureInPictureEnabled) v.requestPictureInPicture().catch(()=>{});
  } catch(e){ /* browser refused (no gesture, or unsupported) — the in-app bar still runs */ }
}
function unpop(){
  if (!v || !inPip()) return;
  try {
    if (typeof v.webkitSetPresentationMode === "function") v.webkitSetPresentationMode("inline");
    else document.exitPictureInPicture().catch(()=>{});
  } catch(e){}
}
export function toggle(){
  if (!els()) return;
  if (v.paused){ const p = v.play(); if (p && p.catch) p.catch(()=>{}); } else v.pause();
  paint();
}
export function add(secs){
  if (!els()) return;
  seek(Math.max(0, Math.min(SPAN, v.currentTime - secs)));   // earlier in the video = more time left
  paint();
}
export function stop(){
  if (!els()) return;
  unpop();
  v.pause();
  show(false);
}
// reserve room above the tab bar only while the timer is up
function show(on){
  bar.hidden = !on;
  document.body.classList.toggle("rest-on", on);
}
