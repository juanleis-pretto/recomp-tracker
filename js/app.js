import { Store } from "./store.js";
import { today, fmtLong } from "./util.js";
import * as V from "./views.js";

const TABS = [
  { id:"today",   label:"Log",     ic:"☰" },
  { id:"history", label:"History", ic:"🗓" },
  { id:"lifts",   label:"Lifts",   ic:"⚒" },
  { id:"trends",  label:"Trends",  ic:"📈" },
  { id:"export",  label:"Export",  ic:"⇪" },
];
let tab = "today";

function nav(){
  document.getElementById("nav").innerHTML = TABS.map(t=>
    `<button class="${t.id===tab?'on':''}" onclick="go('${t.id}')"><span class="ic">${t.ic}</span>${t.label}</button>`).join("");
}
export function go(t){ tab=t; render(); window.scrollTo(0,0); }
export function render(){
  nav();
  const titles={today:"Log",history:"History",lifts:"Lift progression",trends:"Trends",export:"Export"};
  document.getElementById("hTitle").textContent = titles[tab];
  document.getElementById("hDate").textContent = fmtLong(tab==="today"?V.S.selDate:today());
  const m=document.getElementById("main");
  if (tab==="today") m.innerHTML = V.viewToday();
  else if (tab==="history") m.innerHTML = V.viewHistory();
  else if (tab==="lifts") m.innerHTML = V.viewLifts();
  else if (tab==="trends") m.innerHTML = V.viewTrends();
  else m.innerHTML = V.viewExport();
}

/* login gate */
function showLogin(v){ document.getElementById("login").style.display = v?"block":"none"; }
async function doLogin(){
  const err = await Store.login(document.getElementById("lgE").value.trim(), document.getElementById("lgP").value);
  document.getElementById("lgErr").textContent = err||"";
  if (!err) showLogin(false);
}

/* inline onclick handlers need globals */
Object.assign(window, {
  go, render, doLogin,
  shiftDay:V.shiftDay, setDate:V.setDate, dismiss:V.dismiss,
  pickLabel:V.pickLabel, addCustom:V.addCustom, delMeal:V.delMeal,
  editMeal:V.editMeal, cancelMealEdit:V.cancelMealEdit, pickEditLabel:V.pickEditLabel, saveMealEdit:V.saveMealEdit,
  toggleMealsDone:V.toggleMealsDone, setExNote:V.setExNote,
  shiftMonth:V.shiftMonth, openDay:V.openDay, setCalMode:V.setCalMode,
  selEx:V.selEx, addSet:V.addSet, startNewWorkout:V.startNewWorkout, delLastSet:V.delLastSet,
  addActivity:V.addActivity, delActivity:V.delActivity,
  addMakeup:V.addMakeup, removeMakeup:V.removeMakeup,
  saveRun:V.saveRun, toggleDone:V.toggleDone, saveBody:V.saveBody,
  pickLift:V.pickLift, renameEx:V.renameEx,
  genClaude:V.genClaude, copyClaude:V.copyClaude, dlJSON:V.dlJSON, impJSON:V.impJSON,
  resetAll:V.resetAll, logout:V.logout,
});

V.init(render, go);
Store.onChange = render;
Store.onAuthNeeded = ()=>showLogin(true);
window.addEventListener("online", ()=>{ if (localStorage.getItem(Store.DIRTY)==="1") Store.push(); });
document.addEventListener("visibilitychange", ()=>{ if (!document.hidden && localStorage.getItem(Store.DIRTY)==="1") Store.push(); });

render();
Store.init();
