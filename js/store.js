import { SUPA } from "./config.js";
import { parseD } from "./util.js";

/* localStorage = write-through cache (works offline in the gym);
   Supabase Postgres = source of truth. Dirty flag → last-write-wins push. */
export const DOC_KEYS = ["meals","workouts","weight","waist","photos","dismissed","makeup","aliases"];

export const Store = {
  KEY: "recomp_v1", DIRTY: "recomp_dirty",
  data: null, client: null, user: null, status: "local", _t: null,
  onChange: null,   // set by app.js → re-render after remote pull
  onAuthNeeded: null,
  configured(){ return SUPA.url && SUPA.anonKey && typeof globalThis.supabase !== "undefined"; },

  load(){
    try { this.data = JSON.parse(localStorage.getItem(this.KEY)) || null; } catch(e){ this.data = null; }
    if (!this.data) this.data = {};
    for (const k of DOC_KEYS) if(!this.data[k]) this.data[k]={};
    this.migrate(this.data);
    return this.data;
  },

  /* v1 → v2: workouts[date] was a single object; now an array of workout blocks
     { id, t0, t1, sets:{name:[{w,r}]}, run:{}, done } */
  migrate(doc){
    const w = doc.workouts || {};
    for (const d of Object.keys(w)){
      if (!Array.isArray(w[d])){
        const old = w[d], t = parseD(d).getTime() + 12*3600e3;
        w[d] = [{ id:"b"+t, t0:t, t1:t, sets:old.sets||{}, run:old.run||{}, done:!!old.done }];
      }
    }
  },

  async init(){
    if (!this.configured()){ this.setStatus("local"); return; }
    this.client = globalThis.supabase.createClient(SUPA.url, SUPA.anonKey);
    const { data:{ session } } = await this.client.auth.getSession();
    if (!session){ this.setStatus("signedout"); this.onAuthNeeded && this.onAuthNeeded(); return; }
    this.user = session.user;
    await this.pull();
  },
  async login(email, pw){
    const { data, error } = await this.client.auth.signInWithPassword({ email, password: pw });
    if (error) return error.message;
    this.user = data.user; await this.pull(); return null;
  },
  async logout(){ await this.client.auth.signOut(); location.reload(); },

  async pull(){
    this.setStatus("syncing");
    const { data, error } = await this.client.from("app_state").select("doc").eq("user_id", this.user.id).maybeSingle();
    if (error){ this.setStatus("error"); return; }
    const dirty = localStorage.getItem(this.DIRTY) === "1";
    if (data && data.doc && !dirty){
      for (const k of DOC_KEYS) this.data[k] = data.doc[k] || {};
      this.migrate(this.data);
      localStorage.setItem(this.KEY, JSON.stringify(this.data));
      this.setStatus("synced");
      this.onChange && this.onChange();
    } else {
      await this.push(); // no remote row yet, or unsynced local changes → local wins
    }
  },
  save(){
    localStorage.setItem(this.KEY, JSON.stringify(this.data));
    localStorage.setItem(this.DIRTY, "1");
    if (this.user){ clearTimeout(this._t); this._t = setTimeout(()=>this.push(), 800); this.setStatus("syncing"); }
  },
  async push(){
    if (!this.user) return;
    this.setStatus("syncing");
    const { error } = await this.client.from("app_state")
      .upsert({ user_id: this.user.id, doc: this.data, updated_at: new Date().toISOString() });
    if (error){ this.setStatus("pending"); return; }
    localStorage.setItem(this.DIRTY, "0");
    this.setStatus("synced");
  },
  setStatus(s){
    this.status = s;
    const m = { local:["local only","var(--faint)"], signedout:["signed out","var(--warn)"],
      syncing:["syncing…","var(--warn)"], synced:["● synced","var(--good)"],
      pending:["offline — will retry","var(--bad)"], error:["sync error","var(--bad)"] }[s];
    const el = document.getElementById("sync");
    if (el && m){ el.textContent = m[0]; el.style.color = m[1]; }
  },
};

export const DB = Store.load();
