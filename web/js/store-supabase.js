// Mode partagé : Supabase (base, connexion par code e-mail, photos, temps réel).
const SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
const TABLES = ["rooms", "projects", "stages", "tasks", "task_rooms", "options", "entries", "shopping", "sessions", "activity"];
const ORDER = { rooms: "sort", projects: "sort", stages: "sort", activity: "at", entries: "created_at", sessions: "day", shopping: "created_at" };

export async function createSupabaseStore(cfg) {
  const { createClient } = await import(SDK);
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "chantier.auth" },
  });
  const listeners = new Set();
  let me = null, members = [], channel = null;

  const fail = (error) => { if (error) throw new Error(error.message || "Erreur réseau"); };

  async function identify() {
    const { data } = await sb.auth.getSession();
    const email = data.session?.user?.email?.toLowerCase();
    if (!email) return { ok: false, reason: "login" };
    const { data: rows, error } = await sb.from("members").select("email, name");
    if (error) return { ok: false, reason: "network", message: error.message };
    members = (rows || []).map((m) => m.name);
    me = (rows || []).find((m) => m.email.toLowerCase() === email)?.name || null;
    if (!me) return { ok: false, reason: "not_member", email };
    subscribe();
    return { ok: true };
  }

  function subscribe() {
    if (channel) return;
    channel = sb.channel("chantier");
    for (const t of TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => { for (const fn of listeners) fn(t); });
    }
    channel.subscribe();
  }

  return {
    mode: "cloud",
    get me() { return me; },
    get members() { return members; },
    session: identify,
    async sendCode(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      fail(error);
    },
    async verifyCode(email, token) {
      const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
      fail(error);
      return identify();
    },
    async signOut() { await sb.auth.signOut(); location.reload(); },
    async load(table) {
      let q = sb.from(table).select("*");
      if (ORDER[table]) q = q.order(ORDER[table], { ascending: ["rooms", "projects", "stages"].includes(table) });
      if (table === "activity") q = q.limit(200);
      const { data, error } = await q;
      fail(error);
      return data || [];
    },
    async loadAll() {
      const out = { members };
      await Promise.all(TABLES.map(async (t) => { out[t] = await this.load(t); }));
      return out;
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async upsert(table, rows) {
      rows = Array.isArray(rows) ? rows : [rows];
      const opts = table === "task_rooms" ? { onConflict: "task_id,room_id" } : {};
      const { error } = await sb.from(table).upsert(rows, opts);
      fail(error);
    },
    async remove(table, match) {
      const { error } = await sb.from(table).delete().match(match);
      fail(error);
    },
    async uploadPhoto(blob) {
      const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
      fail(error);
      return path;
    },
    async photoUrls(paths) {
      if (!paths.length) return {};
      const { data, error } = await sb.storage.from("photos").createSignedUrls(paths, 3600);
      fail(error);
      return Object.fromEntries((data || []).map((d) => [d.path, d.signedUrl]));
    },
    async dictee(text) {
      const { data, error } = await sb.functions.invoke("dictee", { body: { text } });
      if (error) {
        let code = "";
        try { code = (await error.context.json()).error; } catch { /* */ }
        const msg = {
          not_member: "Ce compte n'est pas membre du foyer.",
          busy: "Claude est très sollicité. Réessaie dans une minute.",
          api_key: "La clé Claude n'est pas configurée côté Supabase (voir SETUP.md).",
          refusal: "Claude n'a pas pu traiter ce texte. Reformule et réessaie.",
          too_long: "Texte trop long : découpe-le en deux.",
        }[code];
        throw new Error(msg || "L'analyse n'a pas marché. Vérifie la connexion et réessaie.");
      }
      return data;
    },
  };
}
