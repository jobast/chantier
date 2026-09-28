// Mode démo : tout reste dans ce navigateur. Sert à essayer l'app avant de brancher Supabase.
const KEY = "chantier.demo.v4";
const TABLES = ["rooms", "projects", "stages", "tasks", "task_rooms", "options", "entries", "shopping", "sessions", "activity"];
const keyOf = (table, row) => (table === "task_rooms" ? row.task_id + "|" + row.room_id : row.id);

export async function createLocalStore() {
  let db = null;
  try { db = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { db = null; }
  if (!db) {
    db = await (await fetch("./seed.json")).json();
    persist();
  }
  const listeners = new Set();

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* quota : on garde la session en mémoire */ }
  }
  function emit(table) { for (const fn of listeners) fn(table); }

  let me = null;
  try { me = localStorage.getItem("chantier.demo.me"); } catch { /* */ }

  return {
    mode: "demo",
    members: ["Joan", "Jacqueline"],
    get me() { return me; },
    setMe(name) { me = name; try { localStorage.setItem("chantier.demo.me", name); } catch { /* */ } },
    async session() { return { ok: true }; },
    async loadAll() {
      const out = { members: this.members };
      for (const t of TABLES) out[t] = structuredClone(db[t] || []);
      return out;
    },
    async load(table) { return structuredClone(db[table] || []); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async upsert(table, rows) {
      rows = Array.isArray(rows) ? rows : [rows];
      const list = (db[table] ||= []);
      for (const r of rows) {
        const row = { ...r };
        if (!row.id && table !== "task_rooms") row.id = crypto.randomUUID();
        if (table === "activity" && !row.at) row.at = new Date().toISOString();
        if ((table === "entries" || table === "shopping" || table === "sessions") && !row.created_at) row.created_at = new Date().toISOString();
        const i = list.findIndex((x) => keyOf(table, x) === keyOf(table, row));
        if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
      }
      persist();
      emit(table);
    },
    async remove(table, match) {
      const list = db[table] || [];
      db[table] = list.filter((x) => !Object.entries(match).every(([k, v]) => x[k] === v));
      if (table === "projects") {
        const gone = new Set(db.tasks.filter((t) => t.project_id === match.id).map((t) => t.id));
        db.stages = db.stages.filter((x) => x.project_id !== match.id);
        db.tasks = db.tasks.filter((t) => !gone.has(t.id));
        db.task_rooms = db.task_rooms.filter((p) => !gone.has(p.task_id));
        db.options = db.options.filter((o) => !gone.has(o.task_id));
        db.entries = db.entries.filter((e) => !gone.has(e.task_id));
        for (const s of db.shopping) if (gone.has(s.task_id)) s.task_id = null;
      }
      if (table === "stages") for (const t of db.tasks) if (t.stage_id === match.id) t.stage_id = null;
      if (table === "tasks") {
        const id = match.id;
        db.task_rooms = db.task_rooms.filter((p) => p.task_id !== id);
        db.options = db.options.filter((o) => o.task_id !== id);
        db.entries = db.entries.filter((e) => e.task_id !== id);
        for (const s of db.shopping) if (s.task_id === id) s.task_id = null;
      }
      persist();
      emit(table);
    },
    async uploadPhoto(blob) {
      const id = "demo-" + crypto.randomUUID();
      const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
      try { localStorage.setItem("chantier.photo." + id, url); } catch { throw new Error("Stockage plein : en mode démo les photos restent petites et peu nombreuses."); }
      return id;
    },
    async photoUrls(paths) {
      const out = {};
      for (const p of paths) { try { out[p] = localStorage.getItem("chantier.photo." + p); } catch { /* */ } }
      return out;
    },
    async dictee(text, S) { return naiveDictee(text, S); },
    reset() { try { localStorage.removeItem(KEY); } catch { /* */ } },
  };
}

// Découpage simple, sans IA : une tâche par phrase, pièce devinée par mots-clés.
function naiveDictee(text, S) {
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const parts = text.split(/[.\n;!?]+|,\s*(?:et\s+)?(?:puis|ensuite)\s+/i).map((s) => s.trim()).filter((s) => s.length > 3);
  const tasks = [], shopping = [];
  for (const p of parts) {
    const n = norm(p);
    const rooms = S.rooms.filter((r) => {
      const words = norm(r.name).split(/[\s/+]+/).filter((w) => w.length > 3 && !["chambre", "notre", "salle", "bain", "toute", "maison"].includes(w));
      return words.some((w) => n.includes(w));
    }).map((r) => r.id);
    if (/^(acheter|il faut acheter|prendre)\b/.test(n)) {
      shopping.push({ label: p.replace(/^(il faut )?(acheter|prendre)\s*/i, ""), qty: "", store: "", task_id: "" });
      continue;
    }
    tasks.push({
      title: p.charAt(0).toUpperCase() + p.slice(1),
      room_ids: rooms.length ? rooms : ["maison"],
      project_id: "", stage_id: "", kind: /\b(choisir|decider|ou bien|est-ce qu)/.test(n) ? "decision" : /\b(tester|essayer|essai)/.test(n) ? "test" : "travaux",
      priority: /\burgent/.test(n) ? "urgente" : "normale", minutes: 0, note: "", depends_on: [],
    });
  }
  return {
    summary: "Mode démo : découpage simple, une tâche par phrase. Avec Supabase et la clé Claude, l'analyse comprend vraiment la dictée.",
    tasks, done: [], shopping, questions: [], new_projects: [],
  };
}
