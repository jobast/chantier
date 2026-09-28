import * as L from "./logic.js";
import { CONFIG } from "./config.js";

/* ============ état ============ */
let store, raw, S;
let view = "today";
let roomsMode = "rooms";
let search = "";
let sheet = null;           // { type, ...args } : une fiche ouverte à la fois
let sheetDirty = false;     // un rendu a été retardé pendant une saisie
const photoCache = new Map();
const photoPending = new Set();

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const roomName = (id) => S.roomById.get(id)?.name || "Pièce supprimée";
const KIND = { travaux: "Travaux", decision: "Décision", test: "Essai", achat: "Achat" };
const STAGE_KIND = { decider: "Décider", acheter: "Acheter", tester: "Tester", preparer: "Préparer", appliquer: "Appliquer", finir: "Finir", autre: "Autre" };
const TEMPLATES = [
  ["finition", "Peinture, enduit", [["Choisir", "decider"], ["Acheter", "acheter"], ["Tester", "tester"], ["Préparer", "preparer"], ["Appliquer", "appliquer"]]],
  ["reparation", "Réparation", [["Diagnostiquer", "decider"], ["Acheter", "acheter"], ["Réparer", "appliquer"], ["Vérifier", "finir"]]],
  ["construction", "Construction, meuble", [["Concevoir", "decider"], ["Acheter", "acheter"], ["Construire", "appliquer"], ["Finitions", "finir"]]],
  ["simple", "Simple", [["Décider", "decider"], ["Acheter", "acheter"], ["Faire", "appliquer"]]],
];
const PRIO = { urgente: "Urgente", haute: "Haute", normale: "Normale", basse: "Basse" };
const MINUTES = [15, 30, 60, 120, 240, 480, 960];
const SLOTS = [[30, "30 min"], [60, "1 h"], [120, "2 h"], [240, "½ journée"], [480, "Journée"]];

const ICON = {
  today: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
  rooms: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  sessions: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  projects: '<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><path d="M5 8v8"/><path d="M10 6h10M10 12h10M10 18h7"/><circle cx="5" cy="12" r="2"/>',
  shop: '<path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  check: '<path d="M4 12.5l5 5L20 6.5" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
};
const svg = (name, extra = "") => `<svg viewBox="0 0 24 24" ${extra}>${ICON[name]}</svg>`;

/* ============ démarrage ============ */
boot().catch((e) => {
  console.error(e);
  $("#app").innerHTML = `<div class="login"><h1>Chantier</h1><p class="hint">Impossible de démarrer : ${esc(e.message)}. Vérifie la connexion et recharge la page.</p></div>`;
});

async function boot() {
  const demo = !CONFIG.supabaseUrl || new URLSearchParams(location.search).has("demo");
  if (demo) {
    const { createLocalStore } = await import("./store-local.js");
    store = await createLocalStore();
  } else {
    const { createSupabaseStore } = await import("./store-supabase.js");
    store = await createSupabaseStore(CONFIG);
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  const s = await store.session();
  if (!s.ok) return renderLogin(s);
  if (!store.me) return renderWhoAmI();
  await start();
}

async function start() {
  raw = await store.loadAll();
  rebuild();
  try { view = sessionStorage.getItem("chantier.view") || "today"; } catch { /* */ }
  render();
  const pending = new Set();
  let timer = null;
  store.onChange((table) => {
    pending.add(table);
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const tables = [...pending];
      pending.clear();
      for (const t of tables) raw[t] = await store.load(t);
      rebuild();
      render();
    }, 250);
  });
  bindEvents();
}

function rebuild() { S = L.buildState(raw, store.me); }

/* ============ connexion ============ */
function renderLogin(state) {
  const msg = state.reason === "not_member"
    ? `<p class="hint">Le compte <b>${esc(state.email)}</b> n'est pas dans la liste du foyer. Ajoute son e-mail dans la table <code>members</code> (voir SETUP.md).</p><button class="btn" id="logout">Changer de compte</button>`
    : state.reason === "network" ? `<p class="hint">Connexion à la base impossible : ${esc(state.message)}</p>` : "";
  $("#app").innerHTML = `<div class="login">
    <div><h1>Chantier</h1><p class="sub">Le suivi des travaux de la maison, à deux.</p></div>
    ${msg || `<form id="f-email" class="card">
      <label class="field"><span>Ton e-mail</span><input id="email" type="email" autocomplete="email" required inputmode="email"></label>
      <button class="btn primary" type="submit">Recevoir un code</button>
      <p class="hint">Tu reçois un code à 6 chiffres par e-mail. Pas de mot de passe.</p>
    </form>
    <form id="f-code" class="card" hidden>
      <label class="field"><span>Code reçu par e-mail</span><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" required></label>
      <button class="btn primary" type="submit">Entrer</button>
    </form>`}
  </div>`;
  $("#logout")?.addEventListener("click", () => store.signOut());
  $("#f-email")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim();
    try { await store.sendCode(email); $("#f-email").hidden = true; $("#f-code").hidden = false; $("#code").focus(); }
    catch (err) { toast("Envoi impossible : " + err.message); }
  });
  $("#f-code")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const s = await store.verifyCode($("#email").value.trim(), $("#code").value.trim());
      if (s.ok) await start(); else renderLogin(s);
    } catch (err) { toast("Code refusé : " + err.message); }
  });
}

function renderWhoAmI() {
  $("#app").innerHTML = `<div class="login">
    <div><h1>Chantier</h1><p class="sub">Mode démo : les données restent sur ce téléphone. Qui l'utilise ?</p></div>
    <div class="whoami">${store.members.map((m) => `<button class="btn primary wide" data-me="${esc(m)}">${esc(m)}</button>`).join("")}</div>
  </div>`;
  $("#app").querySelectorAll("[data-me]").forEach((b) => b.addEventListener("click", async () => { store.setMe(b.dataset.me); await start(); }));
}

/* ============ rendu ============ */
function render() {
  const html = ({ today: viewToday, projects: viewProjects, rooms: viewRooms, sessions: viewSessions, shop: viewShop }[view] || viewToday)();
  $("#app").innerHTML = html + tabbar();
  renderSheet();
}

function tabbar() {
  const toBuy = S.shopping.filter((s) => !s.bought_at).length;
  const tab = (id, label, icon, badge = "") => `<button data-a="tab" data-v="${id}" ${view === id ? 'aria-current="page"' : ""}>${svg(icon)}${badge}<span>${label}</span></button>`;
  return `<nav class="tabs"><div class="in">
    ${tab("today", "Aujourd'hui", "today")}
    ${tab("projects", "Chantiers", "projects")}
    <button class="mic" data-a="dictee" aria-label="Dicter">${svg("mic")}</button>
    ${tab("rooms", "Pièces", "rooms")}
    ${tab("shop", "Courses", "shop", toBuy ? `<span class="badge">${toBuy}</span>` : "")}
  </div></nav>`;
}

function itemRow(task, roomId, { showRoom = true, blocked = null, showProject = true } = {}) {
  const pair = task.pairs.find((p) => p.room_id === roomId);
  const done = pair && L.pairDone(pair);
  const blk = blocked ?? (done ? [] : L.blockers(S, task, roomId));
  const meta = [];
  if (showProject && task.project) meta.push(`<span>${esc(shortTitle(task.project.title))}${task.stage ? ` › ${esc(task.stage.title)}` : ""}</span>`);
  if (showRoom && (roomId !== "maison" || !task.project)) meta.push(`<span>${esc(roomName(roomId))}</span>`);
  if (task.kind !== "travaux") meta.push(`<span class="tag k-${task.kind}">${KIND[task.kind]}</span>`);
  if (blk.length && !done) meta.push(`<span class="tag blk">Attend : ${esc(blk.map((b) => shortTitle(b.title)).join(", "))}</span>`);
  if (task.minutes && !done) meta.push(`<span>${L.fmtMinutes(task.minutes)}</span>`);
  if (task.pairs.length > 1) meta.push(`<span class="frac">${task.pairs.filter(L.pairDone).length}/${task.pairs.length} pièces</span>`);
  if (done && pair.done_by) meta.push(`<span>${esc(pair.done_by)}, ${esc(ago(pair.done_at))}</span>`);
  if (task.assignee && !done) meta.push(`<span class="who">${esc(initials(task.assignee))}</span>`);
  const cls = ["item", `p-${task.priority}`, done ? "done" : "", blk.length && !done ? "blocked" : ""].join(" ");
  return `<li class="${cls}" data-key="${esc(task.id)}|${esc(roomId)}">
    <button class="check" data-a="toggle" data-t="${esc(task.id)}" data-r="${esc(roomId)}" aria-label="${done ? "Décocher" : "Cocher"}">${svg("check")}</button>
    <button class="item-body" data-a="task" data-t="${esc(task.id)}"><span class="item-title">${esc(task.title)}</span>${meta.length ? `<span class="meta">${meta.join("")}</span>` : ""}</button>
  </li>`;
}
const list = (rows) => `<ul class="items">${rows.join("")}</ul>`;
const shortTitle = (t) => (t.length > 28 ? t.slice(0, 26) + "…" : t);
const initials = (n) => (n === "Jacqueline" ? "Jq" : n.slice(0, 2));

function viewToday() {
  const p = L.progress(S);
  const st = L.streak(S);
  const wk = L.doneThisWeek(S);
  const today = L.isoDay(new Date());
  const live = S.sessions.find((s) => s.day === today);
  const seen = new Set();
  const fresh = (items) => items.filter((i) => { const k = i.task.id + "|" + i.room_id; if (seen.has(k)) return false; seen.add(k); return true; });
  const decisions = L.blockingDecisions(S);
  const parts = [];

  parts.push(`<div class="v-head"><div><div class="eyebrow">${esc(greeting())}, ${esc(S.me)}</div><h1>Le chantier</h1></div></div>`);

  const byWho = Object.entries(wk.by).filter(([k]) => k !== "?").map(([k, v]) => `${esc(k)} ${v}`).join(" · ");
  parts.push(`<div class="hero">
    <div class="hero-top"><div class="big">${Math.round(p.pct * 100)}<small>%</small></div>
      <div class="what">${p.done} case${p.done > 1 ? "s" : ""} cochée${p.done > 1 ? "s" : ""} sur ${p.total}. ${p.total - p.done ? `Encore ${p.total - p.done}.` : "Tout est fait !"}</div></div>
    <div class="bar"><i style="width:${(p.pct * 100).toFixed(1)}%"></i></div>
    <div class="stats">
      <span class="stat ${wk.total ? "hot" : ""}">Cette semaine : <b>${wk.total}</b>${byWho ? ` (${byWho})` : ""}</span>
      <span class="stat ${st.weeks >= 2 ? "hot" : ""}">${st.weeks ? `<b>${st.weeks}</b> semaine${st.weeks > 1 ? "s" : ""} d'affilée` : "Pas encore de série"}</span>
    </div>
    ${!wk.total ? `<p class="hint">Rien coché cette semaine. Une petite victoire de 20 minutes suffit pour lancer la série.</p>` : ""}
  </div>`);

  if (live) {
    const ss = L.sessionStats(S, live);
    parts.push(`<section class="block"><div class="block-head"><h2>Session du jour</h2><span class="hint frac">${ss.done}/${ss.total}</span></div>
      ${list((live.items || []).map((it) => { const t = S.tasks.get(it.task_id); return t ? itemRow(t, it.room_id) : ""; }))}
    </section>`);
  }

  const infos = L.projectsByState(S).filter((i) => !i.complete);
  const active = infos.filter((i) => i.started).slice(0, 3);
  const shown = active.length ? active : infos.slice(0, 3);
  if (live) fresh((live.items || []).map((it) => ({ task: { id: it.task_id }, room_id: it.room_id })));
  for (const i of shown) fresh(L.nextActions(S, i.project, 1));
  const urgent = fresh(L.urgent(S));
  const quick = fresh(L.quickWins(S, S.me, 8)).slice(0, 4);
  if (shown.length) parts.push(`<section class="block"><div class="block-head"><h2>${active.length ? "Chantiers en cours" : "Chantiers à lancer"}</h2><button class="more" data-a="tab" data-v="projects">Tous</button></div>
    <div class="projs">${shown.map((i) => projectCard(i, true)).join("")}</div></section>`);

  const upcoming = S.sessions.filter((x) => x.day > today).sort((a, b) => a.day.localeCompare(b.day))[0];
  parts.push(`<section class="block"><div class="block-head"><h2>Sessions</h2><button class="more" data-a="tab" data-v="sessions">Toutes</button></div>
    ${upcoming ? `<button class="btn wide" style="text-align:left" data-a="sessionEdit" data-s="${esc(upcoming.id)}">Prochaine : ${esc(dayLabel(upcoming.day))}${upcoming.label ? " · " + esc(upcoming.label) : ""} <span class="hint">(${L.sessionStats(S, upcoming).total} tâches)</span></button>`
      : `<button class="btn wide" data-a="sessionNew">Préparer la prochaine session à deux</button>`}
  </section>`);

  parts.push(`<section class="block"><div class="block-head"><h2>On a combien de temps ?</h2></div>
    <div class="slots">${SLOTS.map(([m, l]) => `<button class="slot" data-a="slot" data-m="${m}">${l}</button>`).join("")}</div>
    <p class="hint">L'app choisit ce qui est débloqué et prioritaire, en regroupant par pièce.</p></section>`);

  if (urgent.length) parts.push(`<section class="block"><div class="block-head"><h2>Urgent</h2></div>${list(urgent.map((i) => itemRow(i.task, i.room_id, { blocked: [] })))}</section>`);
  if (quick.length) parts.push(`<section class="block"><div class="block-head"><h2>Petites victoires</h2><span class="hint">30 min max</span></div>${list(quick.map((i) => itemRow(i.task, i.room_id, { blocked: [] })))}</section>`);
  if (decisions.length) parts.push(`<section class="block"><div class="block-head"><h2>Décisions qui bloquent le reste</h2></div>
    ${list(decisions.map(({ task, unlocks }) => itemRow(task, task.pairs[0].room_id, { showRoom: false, blocked: [] }).replace('<span class="meta">', `<span class="meta"><span><b>débloque ${unlocks}</b></span>`)))}</section>`);

  parts.push(`<section class="block"><div class="block-head"><h2>Récemment</h2></div>${feed(8)}</section>`);
  parts.push(`<p class="hint" style="text-align:center">${store.mode === "demo" ? "Mode démo : données sur ce téléphone uniquement." : `Connecté·e : ${esc(S.me)}`} · <button class="btn ghost small" data-a="settings">Réglages</button></p>`);
  return `<main class="view">${parts.join("")}</main>`;
}

function feed(n) {
  const rows = S.activity.slice(0, n);
  if (!rows.length) return `<div class="empty">Ce que vous cochez, ajoutez ou photographiez apparaîtra ici.</div>`;
  const verb = { done: "a fini", added: "a ajouté", photo: "a ajouté une photo :", essai: "a noté un essai :", decided: "a tranché :", bought: "a acheté", session: "a préparé" };
  return `<ul class="feed">${rows.map((a) => `<li><span class="who">${esc(initials(a.who || "?"))}</span><span class="txt">${esc(a.who || "")} ${verb[a.verb] || esc(a.verb)} ${esc(a.label)}</span><span class="when">${esc(ago(a.at))}</span></li>`).join("")}</ul>`;
}

function viewRooms() {
  const seg = `<div class="seg">${[["rooms", "Pièces"], ["all", "Toutes les tâches"]].map(([k, l]) => `<button data-a="roomsMode" data-v="${k}" aria-pressed="${roomsMode === k}">${l}</button>`).join("")}</div>`;
  let body = "";
  if (roomsMode === "rooms") {
    const stats = L.roomStats(S).filter((r) => r.total);
    body = `<div class="rooms">${stats.map((r) => {
      const cover = roomCover(r.room.id);
      const src = cover ? photoSrc(cover) : "";
      return `<button class="room ${src ? "has-photo" : ""} ${r.pct === 1 ? "complete" : ""}" data-a="room" data-r="${esc(r.room.id)}" ${src ? `style="background-image:url('${esc(src)}')"` : ""}>
        <span class="room-name">${esc(r.room.name)}</span>
        <span style="display:grid;gap:6px"><span class="room-meta"><span>${r.pct === 1 ? "Terminé" : `${r.done}/${r.total}`}</span><span>${r.pct < 1 ? esc(L.fmtMinutes(r.minutesLeft)) : ""}</span></span>
        <span class="bar"><i style="width:${(r.pct * 100).toFixed(0)}%"></i></span></span>
      </button>`;
    }).join("")}</div>
    <button class="btn wide" data-a="newRoom">Ajouter une pièce</button>`;
  } else {
    const q = norm(search);
    const rows = [];
    for (const t of S.tasks.values()) for (const p of t.pairs) {
      if (q && !norm(t.title + " " + roomName(p.room_id) + " " + (t.project?.title || "") + " " + (t.stage?.title || "")).includes(q)) continue;
      rows.push({ t, p });
    }
    rows.sort((a, b) => L.pairDone(a.p) - L.pairDone(b.p) || L.PRIO_WEIGHT[b.t.priority] - L.PRIO_WEIGHT[a.t.priority]);
    body = `<input class="search" id="search" type="search" placeholder="Chercher : turquoise, Liam, acheter…" value="${esc(search)}">
      ${rows.length ? list(rows.slice(0, 150).map(({ t, p }) => itemRow(t, p.room_id))) : `<div class="empty">Rien ne correspond.</div>`}`;
  }
  return `<main class="view"><div class="v-head"><h1>Pièces</h1><button class="btn small" data-a="newTask">+ Tâche</button></div>${seg}${body}</main>`;
}
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function track(info) {
  return `<ol class="track" style="--n:${Math.max(info.stages.length, 1)}">${info.stages.map((x) => {
    const state = x.complete ? "done" : info.current && x.stage.id === info.current.stage.id ? "current" : x.empty ? "void" : "todo";
    return `<li class="${state}"><i>${x.complete ? svg("check") : ""}</i><em>${esc(x.stage.title)}</em></li>`;
  }).join("")}</ol>`;
}

function projectCard(info, compact = false) {
  const p = info.project;
  const next = L.nextActions(S, p, 1)[0];
  const status = info.complete ? "Terminé" : info.current ? `Étape ${info.stages.indexOf(info.current) + 1}/${info.stages.length} : ${info.current.stage.title}` : "Aucune tâche";
  return `<div class="proj p-${esc(p.priority)} ${info.complete ? "complete" : ""}">
    <button class="proj-main" data-a="project" data-p="${esc(p.id)}">
      <span class="proj-top"><span class="proj-title">${esc(p.title)}</span>${p.priority === "urgente" || p.priority === "haute" ? `<span class="tag prio-${p.priority}">${PRIO[p.priority]}</span>` : ""}</span>
      ${track(info)}
      <span class="meta"><span><b>${esc(status)}</b></span>${info.minutesLeft && !info.complete ? `<span>reste ${esc(L.fmtMinutes(info.minutesLeft))}</span>` : ""}</span>
    </button>
    ${next && compact ? list([itemRow(next.task, next.room_id, { showProject: false, blocked: [] })]) : ""}
  </div>`;
}

function viewProjects() {
  const infos = L.projectsByState(S);
  const active = infos.filter((i) => i.started);
  const todo = infos.filter((i) => !i.started && !i.complete);
  const done = infos.filter((i) => i.complete);
  const loose = [...S.tasks.values()].filter((t) => !t.project_id && !L.taskDone(t));
  const sec = (title, arr, hint = "") => arr.length ? `<section class="block"><div class="block-head"><h2>${title}</h2><span class="hint">${hint || arr.length}</span></div><div class="projs">${arr.map((i) => projectCard(i)).join("")}</div></section>` : "";
  return `<main class="view">
    <div class="v-head"><div><h1>Chantiers</h1><p class="sub">Chaque chantier avance étape par étape : décider, acheter, tester, appliquer.</p></div><button class="btn small" data-a="projectNew">+ Chantier</button></div>
    ${sec("En cours", active)}
    ${sec("À lancer", todo, "par priorité")}
    ${loose.length ? `<section class="block"><div class="block-head"><h2>Petits travaux</h2><span class="hint">sans étapes</span></div>${list(loose.flatMap((t) => t.pairs.filter((p) => !L.pairDone(p)).map((p) => itemRow(t, p.room_id))))}</section>` : ""}
    ${sec("Terminés", done)}
  </main>`;
}

function sheetProject(st) {
  const p = S.projectById.get(st.id);
  if (!p) return null;
  const info = L.projectInfo(S, p);
  const stagesHtml = info.stages.map((x, i) => {
    const state = x.complete ? "done" : info.current && x.stage.id === info.current.stage.id ? "current" : "todo";
    const editing = st.editStage === x.stage.id;
    const items = x.tasks.flatMap((t) => t.pairs.map((pr) => itemRow(t, pr.room_id, { showProject: false })));
    const shop = x.stage.kind === "acheter" ? S.shopping.filter((it) => x.tasks.some((t) => t.id === it.task_id)) : [];
    return `<section class="stage ${state}">
      <div class="stage-rail"><span class="stage-dot">${x.complete ? svg("check") : i + 1}</span></div>
      <div class="stage-body">
        <div class="stage-head"><div style="min-width:0;flex:1"><h3>${esc(x.stage.title)}</h3><span class="hint">${esc(STAGE_KIND[x.stage.kind] || "")}${x.total ? ` · ${x.done}/${x.total}` : ""}${x.minutesLeft ? ` · ${esc(L.fmtMinutes(x.minutesLeft))}` : ""}</span></div>
          <button class="x" data-a="stageEdit" data-s="${esc(x.stage.id)}" aria-label="Modifier l'étape">…</button></div>
        ${editing ? `<form class="card" data-form="stageEdit" data-s="${esc(x.stage.id)}">
            <label class="field"><span>Nom de l'étape</span><input name="title" value="${esc(x.stage.title)}"></label>
            <label class="field"><span>Type</span><select name="kind">${Object.entries(STAGE_KIND).map(([k, l]) => `<option value="${k}" ${x.stage.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <div class="row"><button type="button" class="btn small" data-a="stageMove" data-s="${esc(x.stage.id)}" data-d="-1" ${i === 0 ? "disabled" : ""}>Monter</button><button type="button" class="btn small" data-a="stageMove" data-s="${esc(x.stage.id)}" data-d="1" ${i === info.stages.length - 1 ? "disabled" : ""}>Descendre</button>
              <button type="button" class="btn danger small" data-a="stageDelete" data-s="${esc(x.stage.id)}">${st.confirmStage === x.stage.id ? "Confirmer" : "Supprimer"}</button><button class="btn primary small" style="margin-left:auto">OK</button></div>
            ${x.tasks.length ? `<p class="hint">Supprimer l'étape garde ses tâches, sans étape.</p>` : ""}
          </form>` : ""}
        ${items.length ? list(items) : `<p class="hint">${state === "current" ? "Ajoutez la première tâche de cette étape." : "Pas encore de tâche."}</p>`}
        ${shop.length ? `<ul class="items shop-mini">${shop.map((it) => `<li class="item ${it.bought_at ? "done" : ""}"><button class="check" data-a="buy" data-id="${esc(it.id)}" aria-label="Acheté">${svg("check")}</button><div class="item-body"><span class="item-title">${esc(it.label)}${it.qty ? ` × ${esc(it.qty)}` : ""}</span><span class="meta"><span>Courses</span>${it.store ? `<span>${esc(it.store)}</span>` : ""}</span></div></li>`).join("")}</ul>` : ""}
        <button class="btn ghost small" style="justify-self:start" data-a="newTask" data-p="${esc(p.id)}" data-s="${esc(x.stage.id)}">+ Tâche</button>
      </div>
    </section>`;
  }).join("");
  const loose = info.loose.flatMap((t) => t.pairs.map((pr) => itemRow(t, pr.room_id, { showProject: false })));
  return `${head(`<textarea class="title-input" rows="1" data-f="projTitle" data-p="${esc(p.id)}">${esc(p.title)}</textarea>
      <p class="sub">${info.stagesDone}/${info.stages.length} étapes franchies · ${info.done}/${info.total} cases${info.minutesLeft ? ` · reste environ ${esc(L.fmtMinutes(info.minutesLeft))}` : ""}</p>`)}
    ${track(info)}
    <div class="chips">${Object.entries(PRIO).map(([k, l]) => `<button class="chip" data-a="projPrio" data-p="${esc(p.id)}" data-v="${k}" aria-pressed="${p.priority === k}">${l}</button>`).join("")}</div>
    <div class="timeline">${stagesHtml}</div>
    ${loose.length ? `<section class="block"><h3>Sans étape</h3>${list(loose)}</section>` : ""}
    <form class="add-row" data-form="stageAdd" data-p="${esc(p.id)}"><input name="title" placeholder="Ajouter une étape (ex. Vérifier)" autocomplete="off"><button class="btn">+</button></form>
    <label class="field"><span>Notes du chantier</span><textarea data-f="projNote" data-p="${esc(p.id)}">${esc(p.note)}</textarea></label>
    <div class="row end"><button class="btn danger small" data-a="projectDelete" data-p="${esc(p.id)}">${st.confirmDelete ? "Confirmer : supprimer le chantier et ses tâches" : "Supprimer le chantier"}</button></div>`;
}

function sheetNewProject(st) {
  const tpl = TEMPLATES.find((x) => x[0] === (st.tpl || "finition"));
  if (!st.stages) st.stages = tpl[2].map((x) => [...x]);
  return `${head("<h2>Nouveau chantier</h2>")}
    <label class="field"><span>Nom</span><input id="np-title" placeholder="Terrasse, cuisine, isolation…" autocomplete="off" value="${esc(st.title || "")}"></label>
    <div class="field"><span>Modèle d'étapes</span><div class="chips">${TEMPLATES.map(([k, l]) => `<button class="chip" data-a="npTpl" data-v="${k}" aria-pressed="${(st.tpl || "finition") === k}">${l}</button>`).join("")}</div></div>
    <div class="card"><div class="label">Étapes, dans l'ordre</div>
      ${st.stages.map(([title, kind], i) => `<div class="row"><span class="stage-dot small">${i + 1}</span><input class="search" style="flex:1" data-f="npStage" data-i="${i}" value="${esc(title)}"><span class="hint">${STAGE_KIND[kind]}</span><button class="x" data-a="npDrop" data-i="${i}" aria-label="Retirer">×</button></div>`).join("")}
      <button class="btn ghost small" style="justify-self:start" data-a="npAdd">+ Étape</button>
    </div>
    <p class="hint">Une tâche d'achat est créée dans l'étape Acheter : ajoutez-y les articles, elle se coche quand tout est acheté.</p>
    <button class="btn primary wide" data-a="npSave">Créer le chantier</button>`;
}

function placementOptions(projectId, stageId) {
  const opts = [`<option value="" ${!projectId ? "selected" : ""}>Petit travail (sans chantier)</option>`];
  for (const p of S.projects) {
    const st = S.stages.filter((x) => x.project_id === p.id);
    opts.push(`<optgroup label="${esc(p.title)}">${st.map((x) => `<option value="${esc(p.id)}|${esc(x.id)}" ${x.id === stageId ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</optgroup>`);
  }
  return opts.join("");
}

async function createProject(title, priority, stageDefs) {
  const pid = uid();
  const project = { id: pid, title, priority, note: "", sort: S.projects.length };
  const stages = stageDefs.map(([t, kind], i) => ({ id: uid(), project_id: pid, title: t, kind: kind || "autre", sort: i }));
  await store.upsert("projects", project);
  if (stages.length) await store.upsert("stages", stages);
  raw.projects = [...(raw.projects || []), project];
  raw.stages = [...(raw.stages || []), ...stages];
  rebuild();
  return pid;
}

function viewSessions() {
  const today = L.isoDay(new Date());
  const upcoming = S.sessions.filter((s) => s.day >= today).sort((a, b) => a.day.localeCompare(b.day));
  const past = S.sessions.filter((s) => s.day < today);
  const card = (s, live) => {
    const ss = L.sessionStats(S, s);
    return `<div class="session ${live ? "live" : ""}">
      <div class="session-head"><div><div class="day">${esc(dayLabel(s.day))}</div><div class="hint">${esc(s.label || "")}${ss.minutesLeft ? ` · reste ${esc(L.fmtMinutes(ss.minutesLeft))}` : ""}</div></div>
        <span class="frac"><b>${ss.done}</b>/${ss.total}</span></div>
      ${(s.items || []).length ? list(s.items.map((it) => { const t = S.tasks.get(it.task_id); return t ? itemRow(t, it.room_id) : ""; })) : ""}
      <div class="session-actions"><button class="btn small" data-a="sessionEdit" data-s="${esc(s.id)}">Modifier</button><button class="btn small" data-a="sessionMore" data-s="${esc(s.id)}">+ 1 h de travail</button></div>
    </div>`;
  };
  const recap = past.slice(0, 8).map((s) => { const ss = L.sessionStats(S, s); return `<li><span class="txt">${esc(dayLabel(s.day))}${s.label ? " · " + esc(s.label) : ""}</span><span class="when frac">${ss.done}/${ss.total} faits</span></li>`; }).join("");
  return `<main class="view">
    <button class="btn ghost small" style="justify-self:start;padding-left:0" data-a="tab" data-v="today">‹ Aujourd'hui</button>
    <div class="v-head"><div><h1>Sessions</h1><p class="sub">On se fixe un créneau à deux, l'app le remplit.</p></div></div>
    <button class="btn primary wide" data-a="sessionNew">Préparer une session</button>
    ${upcoming.length ? upcoming.map((s) => card(s, s.day === today)).join("") : `<div class="empty">Aucune session prévue. Choisissez un samedi et une durée : l'app propose quoi faire.</div>`}
    ${recap ? `<section class="block"><h2>Sessions passées</h2><ul class="feed">${recap}</ul></section>` : ""}
  </main>`;
}

function viewShop() {
  const open = S.shopping.filter((s) => !s.bought_at);
  const bought = S.shopping.filter((s) => s.bought_at);
  const byStore = new Map();
  for (const s of open) { const k = s.store || "Sans magasin"; if (!byStore.has(k)) byStore.set(k, []); byStore.get(k).push(s); }
  const row = (s) => {
    const t = s.task_id ? S.tasks.get(s.task_id) : null;
    return `<li class="item ${s.bought_at ? "done" : ""}"><button class="check" data-a="buy" data-id="${esc(s.id)}" aria-label="Acheté">${svg("check")}</button>
      <div class="item-body"><span class="item-title">${esc(s.label)}${s.qty ? ` <span class="hint">× ${esc(s.qty)}</span>` : ""}</span>
      ${t ? `<span class="meta"><button class="btn ghost small" style="padding:0;border:0;color:var(--accent)" data-a="task" data-t="${esc(t.id)}">Pour : ${esc(shortTitle(t.title))}</button></span>` : ""}</div>
      <button class="x" data-a="unshop" data-id="${esc(s.id)}" aria-label="Supprimer">×</button></li>`;
  };
  return `<main class="view">
    <div class="v-head"><h1>Courses</h1></div>
    <form class="add-row shop" id="f-shop"><input id="shop-label" placeholder="Ajouter : chaux, rouleau, vis…" autocomplete="off"><input id="shop-store" placeholder="Magasin" autocomplete="off"><button class="btn primary" aria-label="Ajouter">+</button></form>
    ${open.length ? [...byStore.entries()].map(([k, rows]) => `<section class="block"><div class="group-title"><h2>${esc(k)}</h2><span>${rows.length}</span></div>${list(rows.map(row))}</section>`).join("") : `<div class="empty">Rien à acheter. Dictez « acheter… » ou ajoutez ici.</div>`}
    ${bought.length ? `<section class="block"><div class="block-head"><h2>Achetés</h2><button class="more" data-a="clearBought">Vider</button></div>${list(bought.slice(0, 30).map(row))}</section>` : ""}
  </main>`;
}

/* ============ fiches ============ */
let sheetFresh = false;
function openSheet(s) { sheet = s; sheetFresh = true; renderSheet(true); }
function closeSheet() {
  const back = sheet?.back;
  if (back && (back.type !== "project" || S.projectById.has(back.id))) { openSheet(back); return; }
  sheet = null;
  $("#sheets").innerHTML = "";
}

function renderSheet(force = false) {
  const host = $("#sheets");
  if (!sheet) { host.innerHTML = ""; return; }
  if (!force && host.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { sheetDirty = true; return; }
  sheetDirty = false;
  const fn = { project: sheetProject, newProject: sheetNewProject, task: sheetTask, room: sheetRoom, dictee: sheetDictee, picker: sheetPicker, session: sheetSession, newTask: sheetNewTask, settings: sheetSettings }[sheet.type];
  const body = fn ? fn(sheet) : "";
  if (body == null) { closeSheet(); return; }
  const existing = $(".sheet", host);
  if (existing && !sheetFresh) {
    // Mise à jour sur place : pas de nouvelle animation, on garde le défilement.
    const scroll = existing.scrollTop;
    existing.innerHTML = `<div class="grab"></div>${body}`;
    existing.scrollTop = scroll;
  } else {
    host.innerHTML = `<div class="scrim" data-a="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${body}</div></div>`;
  }
  sheetFresh = false;
  host.querySelectorAll("textarea.title-input").forEach(autosize);
}
const head = (title, extra = "") => `<div class="sheet-head"><div style="min-width:0;flex:1">${title}</div>${extra}<button class="x" data-a="close" aria-label="Fermer">×</button></div>`;

function sheetTask({ id }) {
  const t = S.tasks.get(id);
  if (!t) return null;
  const opts = S.options.filter((o) => o.task_id === id);
  const entries = S.entries.filter((e) => e.task_id === id);
  const shop = S.shopping.filter((s) => s.task_id === id);
  const deps = t.depends_on.map((d) => S.tasks.get(d)).filter(Boolean);
  const dependents = [...S.tasks.values()].filter((x) => x.depends_on.includes(id));
  const freeRooms = S.rooms.filter((r) => !t.pairs.some((p) => p.room_id === r.id));
  const candidates = [...S.tasks.values()].filter((x) => x.id !== id && !t.depends_on.includes(x.id)).sort((a, b) => a.title.localeCompare(b.title, "fr"));
  const today = L.isoDay(new Date());
  const futureSessions = S.sessions.filter((s) => s.day >= today);
  const pairsHtml = t.pairs.map((p) => {
    const done = L.pairDone(p), blk = done ? [] : L.blockers(S, t, p.room_id);
    return `<li class="item ${done ? "done" : ""} ${blk.length ? "blocked" : ""}">
      <button class="check" data-a="toggle" data-t="${esc(t.id)}" data-r="${esc(p.room_id)}">${svg("check")}</button>
      <div class="item-body"><span class="item-title">${esc(roomName(p.room_id))}</span>
      <span class="meta">${done ? `${esc(p.done_by || "")} ${esc(ago(p.done_at))}` : blk.length ? `<span class="tag blk">Attend : ${esc(blk.map((b) => shortTitle(b.title)).join(", "))}</span>` : "À faire"}</span></div>
      ${!done && t.pairs.length > 1 ? `<button class="x" data-a="dropRoom" data-t="${esc(t.id)}" data-r="${esc(p.room_id)}" aria-label="Retirer la pièce">×</button>` : ""}
    </li>`;
  }).join("");

  return `${head(`${t.project ? `<button class="btn ghost small" style="padding:0 0 4px;border:0;color:var(--accent)" data-a="project" data-p="${esc(t.project.id)}">${esc(t.project.title)}${t.stage ? ` › ${esc(t.stage.title)}` : ""}</button>` : ""}<textarea class="title-input" rows="1" data-f="title" data-t="${esc(id)}">${esc(t.title)}</textarea>`)}
    <div class="chips">
      ${Object.entries(KIND).map(([k, l]) => `<button class="chip" data-a="setField" data-t="${esc(id)}" data-k="kind" data-v="${k}" aria-pressed="${t.kind === k}">${l}</button>`).join("")}
    </div>
    <section class="block"><div class="label">Pièces</div><ul class="items">${pairsHtml}</ul>
      ${freeRooms.length ? `<select data-f="addRoom" data-t="${esc(id)}" class="search"><option value="">+ Ajouter une pièce…</option>${freeRooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select>` : ""}
    </section>

    ${t.kind === "decision" ? `<section class="card"><div class="block-head"><div class="label">Options</div></div>
      ${opts.map((o) => `<div class="opt ${o.chosen ? "chosen" : ""}"><div class="grow"><strong>${esc(o.label)}</strong>${o.price ? `<span class="hint">${esc(o.price)} €</span>` : ""}${o.note ? `<span class="hint">${esc(o.note)}</span>` : ""}${o.photo ? `<div class="photos">${photoTag(o.photo)}</div>` : ""}</div>
        ${o.chosen ? `<span class="tag k-decision">Choisi</span>` : `<button class="btn small" data-a="choose" data-o="${esc(o.id)}">Choisir</button>`}
        <button class="x" data-a="dropOption" data-o="${esc(o.id)}" aria-label="Supprimer l'option">×</button></div>`).join("") || `<p class="hint">Listez les options, avec prix et photo si besoin, puis choisissez.</p>`}
      <form class="add-row" data-form="option" data-t="${esc(id)}"><input name="label" placeholder="Nouvelle option" autocomplete="off"><input name="price" placeholder="Prix €" inputmode="decimal" style="max-width:28%"><button class="btn">+</button></form>
    </section>` : ""}

    <div class="grid2">
      <label class="field"><span>Priorité</span><select data-f="priority" data-t="${esc(id)}">${Object.entries(PRIO).map(([k, l]) => `<option value="${k}" ${t.priority === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span>Durée par pièce</span><select data-f="minutes" data-t="${esc(id)}"><option value="">?</option>${MINUTES.map((m) => `<option value="${m}" ${t.minutes === m ? "selected" : ""}>${L.fmtMinutes(m)}</option>`).join("")}</select></label>
    </div>
    <div class="field"><span>Qui s'en occupe</span><div class="chips">
      ${["", ...S.members].map((m) => `<button class="chip" data-a="setField" data-t="${esc(id)}" data-k="assignee" data-v="${esc(m)}" aria-pressed="${(t.assignee || "") === m}">${m ? esc(m) : "Les deux / personne"}</button>`).join("")}
    </div></div>
    <div class="grid2">
      <label class="field"><span>Chantier › étape</span><select data-f="placement" data-t="${esc(id)}">${placementOptions(t.project_id, t.stage_id)}</select></label>
      ${futureSessions.length ? `<label class="field"><span>Ajouter à une session</span><select data-f="toSession" data-t="${esc(id)}"><option value="">Choisir…</option>${futureSessions.map((s) => `<option value="${esc(s.id)}">${esc(dayLabel(s.day))}</option>`).join("")}</select></label>` : ""}
    </div>
    <label class="field"><span>Notes</span><textarea data-f="note" data-t="${esc(id)}">${esc(t.note)}</textarea></label>

    <section class="card"><div class="label">Avant de pouvoir le faire</div>
      ${deps.length ? deps.map((d) => `<div class="row"><button class="btn ghost small" style="flex:1;text-align:left;${L.taskDone(d) ? "text-decoration:line-through" : ""}" data-a="task" data-t="${esc(d.id)}">${esc(d.title)}</button><button class="x" data-a="dropDep" data-t="${esc(id)}" data-d="${esc(d.id)}" aria-label="Retirer">×</button></div>`).join("") : `<p class="hint">Rien : on peut s'y mettre.</p>`}
      <select data-f="addDep" data-t="${esc(id)}" class="search"><option value="">+ Doit attendre…</option>${candidates.map((c) => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("")}</select>
      ${dependents.length ? `<p class="hint">Débloque : ${dependents.map((d) => esc(shortTitle(d.title))).join(", ")}</p>` : ""}
    </section>

    <section class="card"><div class="block-head"><div class="label">${t.kind === "test" ? "Carnet d'essais" : "Carnet"}</div></div>
      ${entries.map(entryHtml).join("") || `<p class="hint">${t.kind === "test" ? "Notez chaque essai : recette, résultat, photo. C'est ce qui évitera de refaire les mêmes erreurs." : "Notes et photos de cette tâche."}</p>`}
      <form class="grid" data-form="entry" data-t="${esc(id)}" style="display:grid;gap:8px">
        ${t.kind === "test" ? `<label class="field"><span>Recette / méthode</span><textarea name="recipe" placeholder="Ex. 1 volume de chaux, 3 de sable, eau…"></textarea></label>
        <label class="field"><span>Résultat</span><textarea name="verdict" placeholder="Tenue, couleur, séchage, fissures…"></textarea></label>
        <div class="chips" data-rating>${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="chip" data-a="rate" data-v="${n}" aria-pressed="false">${"★".repeat(n)}</button>`).join("")}</div>`
        : `<label class="field"><span>Note</span><textarea name="body" placeholder="Une info, une mesure, une idée…"></textarea></label>`}
        <div class="row"><label class="btn small">Photo<input type="file" name="photo" accept="image/*" hidden></label><span class="hint" data-photo-name></span><button class="btn primary small" style="margin-left:auto">${t.kind === "test" ? "Noter l'essai" : "Ajouter"}</button></div>
      </form>
    </section>

    <section class="card"><div class="label">À acheter pour ça${t.kind === "achat" ? " (la tâche se coche quand tout est acheté)" : ""}</div>
      ${shop.map((s) => `<div class="row"><span style="flex:1;${s.bought_at ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(s.label)}${s.qty ? ` × ${esc(s.qty)}` : ""}</span><button class="x" data-a="unshop" data-id="${esc(s.id)}">×</button></div>`).join("")}
      <form class="add-row" data-form="shop" data-t="${esc(id)}"><input name="label" placeholder="Ajouter un achat" autocomplete="off"><button class="btn">+</button></form>
    </section>
    <div class="row end"><button class="btn danger small" data-a="deleteTask" data-t="${esc(id)}">${sheet.confirmDelete ? "Confirmer la suppression" : "Supprimer la tâche"}</button></div>`;
}

function entryHtml(e) {
  const stars = e.rating ? `<span class="stars">${"★".repeat(e.rating)}${"☆".repeat(5 - e.rating)}</span>` : "";
  return `<div class="entry">
    <div class="by">${esc(e.author || "")} · ${esc(ago(e.created_at))} ${stars}</div>
    ${e.recipe ? `<div><b>Recette</b> ${esc(e.recipe)}</div>` : ""}
    ${e.verdict ? `<div><b>Résultat</b> ${esc(e.verdict)}</div>` : ""}
    ${e.body ? `<div>${esc(e.body)}</div>` : ""}
    ${e.photos?.length ? `<div class="photos">${e.photos.map(photoTag).join("")}</div>` : ""}
  </div>`;
}

function sheetRoom({ id }) {
  const r = S.roomById.get(id);
  if (!r) return null;
  const stat = L.roomStats(S).find((x) => x.room.id === id);
  const items = [...S.tasks.values()].filter((t) => t.pairs.some((p) => p.room_id === id));
  const open = [], blocked = [], done = [];
  for (const t of items) {
    const p = t.pairs.find((x) => x.room_id === id);
    if (L.pairDone(p)) done.push(t); else if (L.blockers(S, t, id).length) blocked.push(t); else open.push(t);
  }
  const sortP = (a, b) => L.PRIO_WEIGHT[b.priority] - L.PRIO_WEIGHT[a.priority];
  const photos = S.entries.filter((e) => e.room_id === id && e.photos?.length);
  return `${head(`<h2>${esc(r.name)}</h2><p class="sub">${stat.done}/${stat.total} fait${stat.minutesLeft ? ` · reste environ ${esc(L.fmtMinutes(stat.minutesLeft))}` : ""}</p>`)}
    <div class="bar"><i style="width:${(stat.pct * 100).toFixed(0)}%"></i></div>
    <section class="card"><div class="block-head"><div class="label">Photos avant / après</div>
      <label class="btn small">Photo<input type="file" accept="image/*" data-f="roomPhoto" data-r="${esc(id)}" hidden></label></div>
      ${photos.length ? `<div class="photos">${photos.flatMap((e) => e.photos.map((p) => `<div style="display:grid;gap:2px">${photoTag(p)}<span class="hint" style="font-size:.72rem">${esc(e.body || "")} · ${esc(shortDate(e.created_at))}</span></div>`)).join("")}</div>`
        : `<p class="hint">Prenez une photo maintenant. Dans quelques semaines, la comparaison fera plaisir.</p>`}
    </section>
    ${open.length ? `<section class="block"><h2>On peut s'y mettre</h2>${list(open.sort(sortP).map((t) => itemRow(t, id, { showRoom: false })))}</section>` : ""}
    ${blocked.length ? `<section class="block"><h2>En attente</h2>${list(blocked.map((t) => itemRow(t, id, { showRoom: false })))}</section>` : ""}
    ${done.length ? `<section class="block"><h2>Fait</h2>${list(done.map((t) => itemRow(t, id, { showRoom: false })))}</section>` : ""}
    <div class="row"><button class="btn" data-a="newTask" data-r="${esc(id)}">+ Tâche dans cette pièce</button><button class="btn ghost small" data-a="renameRoom" data-r="${esc(id)}" style="margin-left:auto">Renommer</button></div>
    ${sheet.rename ? `<form class="add-row" data-form="renameRoom" data-r="${esc(id)}"><input name="name" value="${esc(r.name)}"><button class="btn primary">OK</button></form>` : ""}`;
}

function sheetDictee(st) {
  if (st.phase === "loading") return `${head("<h2>Dicter</h2>")}<div class="row"><div class="spinner"></div><span>Claude range la dictée…</span></div>`;
  if (st.phase === "result") {
    const r = st.result;
    const roomChips = (i, sel) => S.rooms.map((rm) => `<button type="button" class="chip" data-a="propRoom" data-i="${i}" data-r="${esc(rm.id)}" aria-pressed="${sel.includes(rm.id)}">${esc(rm.name)}</button>`).join("");
    const n = r.tasks.filter((t) => t.keep).length + r.done.filter((d) => d.keep).length + r.shopping.filter((s) => s.keep).length + (r.new_projects || []).filter((x) => x.keep).length;
    return `${head("<h2>Ce que j'ai compris</h2>")}
      ${r.summary ? `<p class="hint">${esc(r.summary)}</p>` : ""}
      ${r.questions?.length ? `<div class="card"><div class="label">À trancher</div>${r.questions.map((q) => `<div>${esc(q)}</div>`).join("")}</div>` : ""}
      ${r.done.length ? `<section class="card"><div class="label">Fait</div>${r.done.map((d, i) => {
        const t = S.tasks.get(d.task_id);
        return `<div class="proposal"><input type="checkbox" data-f="propKeep" data-kind="done" data-i="${i}" ${d.keep ? "checked" : ""}><div class="grow">${esc(t?.title || "")}${d.room_id ? ` · ${esc(roomName(d.room_id))}` : " · toutes les pièces"}</div></div>`;
      }).join("")}</section>` : ""}
      ${r.tasks.length ? `<section class="card"><div class="label">Nouvelles tâches</div>${r.tasks.map((t, i) => `<div class="proposal">
        <input type="checkbox" data-f="propKeep" data-kind="tasks" data-i="${i}" ${t.keep ? "checked" : ""}>
        <div class="grow"><input type="text" data-f="propTitle" data-i="${i}" value="${esc(t.title)}">
          <div class="meta">${t.kind !== "travaux" ? `<span class="tag k-${t.kind}">${KIND[t.kind]}</span>` : ""}${t.priority !== "normale" ? `<span>${PRIO[t.priority]}</span>` : ""}${t.project_id && S.projectById.get(t.project_id) ? `<span>${esc(S.projectById.get(t.project_id).title)}${t.stage_id && S.stageById.get(t.stage_id) ? " › " + esc(S.stageById.get(t.stage_id).title) : ""}</span>` : ""}${t.minutes ? `<span>${L.fmtMinutes(t.minutes)}</span>` : ""}</div>
          <details><summary class="hint">${esc(t.room_ids.map(roomName).join(", "))}</summary><div class="chips" style="margin-top:6px">${roomChips(i, t.room_ids)}</div></details>
          ${t.note ? `<span class="hint">${esc(t.note)}</span>` : ""}</div></div>`).join("")}</section>` : ""}
      ${r.new_projects?.length ? `<section class="card"><div class="label">Nouveaux chantiers</div>${r.new_projects.map((np, i) => `<div class="proposal"><input type="checkbox" data-f="propKeep" data-kind="new_projects" data-i="${i}" ${np.keep ? "checked" : ""}><div class="grow"><strong>${esc(np.title)}</strong>
        ${np.stages.map((st) => `<div class="hint">${esc(st.title)}${st.tasks.length ? " : " + esc(st.tasks.map((x) => x.title).join(", ")) : ""}</div>`).join("")}</div></div>`).join("")}</section>` : ""}
      ${r.shopping.length ? `<section class="card"><div class="label">Courses</div>${r.shopping.map((s, i) => `<div class="proposal"><input type="checkbox" data-f="propKeep" data-kind="shopping" data-i="${i}" ${s.keep ? "checked" : ""}><div class="grow">${esc(s.label)}${s.qty ? ` × ${esc(s.qty)}` : ""}${s.store ? ` <span class="hint">(${esc(s.store)})</span>` : ""}</div></div>`).join("")}</section>` : ""}
      ${!r.tasks.length && !r.done.length && !r.shopping.length && !r.new_projects?.length ? `<div class="empty">Rien d'exploitable. Reformule avec des actions concrètes.</div>` : ""}
      <div class="row"><button class="btn" data-a="dicteeBack">Corriger le texte</button><button class="btn primary" style="flex:1" data-a="dicteeApply" ${n ? "" : "disabled"}>Valider (${n})</button></div>`;
  }
  return `${head("<h2>Dicter</h2>")}
    <p class="hint">Parle en vrac, comme à ton conjoint : ce qu'il faut faire, ce qui est fait, ce qu'il faut acheter. Touche le micro du clavier pour dicter.</p>
    <textarea class="big-input" id="dictee-text" placeholder="Ex. : On a posé les balais chez Liam et Maceo. Il faut racheter de la chaux. Dans le bureau, faudrait fixer une étagère au-dessus du plan de travail.">${esc(st.text || "")}</textarea>
    ${st.error ? `<p class="hint" style="color:var(--urgent)">${esc(st.error)}</p>` : ""}
    <button class="btn primary wide" data-a="dicteeGo">Analyser</button>`;
}

function sheetPicker(st) {
  const r = L.pick(S, st.minutes, st.who || null);
  st.items = r.items.map((i) => ({ task_id: i.task.id, room_id: i.room_id }));
  return `${head(`<h2>${esc(SLOTS.find((s) => s[0] === st.minutes)?.[1] || L.fmtMinutes(st.minutes))} devant vous</h2><p class="sub">Débloqué et prioritaire, regroupé par pièce.</p>`)}
    <div class="chips">${[["", "À deux"], ...S.members.map((m) => [m, m + " seul·e"])].map(([k, l]) => `<button class="chip" data-a="pickWho" data-v="${esc(k)}" aria-pressed="${(st.who || "") === k}">${esc(l)}</button>`).join("")}</div>
    ${r.items.length ? list(r.items.map((i) => itemRow(i.task, i.room_id, { blocked: [] }))) + `<p class="hint">Environ ${esc(L.fmtMinutes(r.minutes))} au total. Les durées sont des estimations à ajuster dans chaque tâche.</p>`
      : `<div class="empty">Rien ne tient dans ce créneau. Essaie plus long, ou tranche une décision qui bloque.</div>`}
    ${r.items.length ? `<button class="btn primary wide" data-a="pickGo">C'est parti</button>` : ""}`;
}

function sheetSession(st) {
  const s = st.id ? S.sessions.find((x) => x.id === st.id) : null;
  const draft = st.draft || (st.draft = { day: s?.day || L.isoDay(L.nextSaturday()), label: s?.label || "", items: [...(s?.items || [])] });
  const valid = draft.items.filter((it) => S.tasks.get(it.task_id)?.pairs.some((p) => p.room_id === it.room_id));
  const minutes = valid.reduce((a, it) => a + L.minutesOf(S.tasks.get(it.task_id)), 0);
  return `${head(`<h2>${s ? "Modifier la session" : "Préparer une session"}</h2>`)}
    <div class="grid2"><label class="field"><span>Jour</span><input type="date" id="sess-day" value="${esc(draft.day)}"></label>
      <label class="field"><span>Nom (facultatif)</span><input id="sess-label" value="${esc(draft.label)}" placeholder="Samedi peinture"></label></div>
    <div class="field"><span>Remplir avec</span><div class="chips">${[[60, "1 h"], [120, "2 h"], [240, "½ journée"], [480, "Journée"]].map(([m, l]) => `<button class="chip" data-a="sessFill" data-m="${m}">${l}</button>`).join("")}</div></div>
    ${valid.length ? `<ul class="items">${valid.map((it, i) => { const t = S.tasks.get(it.task_id); return `<li class="item"><div class="item-body"><span class="item-title">${esc(t.title)}</span><span class="meta"><span>${esc(roomName(it.room_id))}</span><span>${L.fmtMinutes(L.minutesOf(t))}</span></span></div><button class="x" data-a="sessDrop" data-i="${i}" aria-label="Retirer">×</button></li>`; }).join("")}</ul>
      <p class="hint">Environ ${esc(L.fmtMinutes(minutes))}.</p>` : `<div class="empty">Choisissez une durée : l'app propose les tâches.</div>`}
    <div class="row">${s ? `<button class="btn danger small" data-a="sessDelete">${st.confirmDelete ? "Confirmer" : "Supprimer"}</button>` : ""}<button class="btn primary" style="flex:1" data-a="sessSave">Enregistrer</button></div>`;
}

function sheetNewTask(st) {
  if (!st.rooms) {
    // Dans une étape : on reprend les pièces des tâches du chantier.
    const siblings = st.project ? [...S.tasks.values()].filter((t) => t.project_id === st.project) : [];
    const rooms = [...new Set(siblings.flatMap((t) => t.pairs.map((p) => p.room_id)))];
    st.rooms = st.room ? [st.room] : rooms.length === 1 ? rooms : ["maison"];
  }
  const sel = st.rooms;
  const stage = st.stage ? S.stageById.get(st.stage) : null;
  const defKind = stage?.kind === "acheter" ? "achat" : stage?.kind === "tester" ? "test" : stage?.kind === "decider" ? "decision" : "travaux";
  if (!st.kind) st.kind = defKind;
  return `${head(`<h2>Nouvelle tâche</h2>${stage ? `<p class="sub">${esc(S.projectById.get(st.project)?.title || "")} › ${esc(stage.title)}</p>` : ""}`)}
    <label class="field"><span>Quoi</span><input id="nt-title" placeholder="Poser une étagère…" autocomplete="off"></label>
    <div class="field"><span>Pièces</span><div class="chips">${S.rooms.map((r) => `<button class="chip" data-a="ntRoom" data-r="${esc(r.id)}" aria-pressed="${sel.includes(r.id)}">${esc(r.name)}</button>`).join("")}</div></div>
    <div class="chips">${Object.entries(KIND).map(([k, l]) => `<button class="chip" data-a="ntKind" data-v="${k}" aria-pressed="${(st.kind || "travaux") === k}">${l}</button>`).join("")}</div>
    <button class="btn primary wide" data-a="ntSave">Ajouter</button>
    <p class="hint">Astuce : le micro en bas de l'écran crée plusieurs tâches d'un coup à partir d'une dictée.</p>`;
}

function sheetSettings() {
  return `${head("<h2>Réglages</h2>")}
    <div class="card"><div>${store.mode === "demo" ? "Mode démo : les données restent dans ce navigateur. Pour partager avec Jacqueline, suivez SETUP.md." : `Connecté·e en tant que <b>${esc(S.me)}</b>.`}</div>
      ${store.mode === "demo" ? `<div class="row"><button class="btn small" data-a="switchMe">Changer d'utilisateur</button><button class="btn danger small" data-a="resetDemo">${sheet.confirmReset ? "Confirmer la remise à zéro" : "Remettre la démo à zéro"}</button></div>` : `<button class="btn small" data-a="signOut">Se déconnecter</button>`}
    </div>
    <p class="hint">Sur iPhone : dans Safari, bouton Partager, puis « Sur l'écran d'accueil » pour l'avoir comme une app.</p>`;
}

/* ============ photos ============ */
function photoSrc(path) {
  if (photoCache.has(path)) return photoCache.get(path);
  if (!photoPending.has(path)) {
    photoPending.add(path);
    queueMicrotask(async () => {
      const paths = [...photoPending].filter((p) => !photoCache.has(p));
      photoPending.clear();
      try {
        const urls = await store.photoUrls(paths);
        for (const p of paths) photoCache.set(p, urls[p] || "");
        render();
      } catch { /* on réessaiera au prochain rendu */ }
    });
  }
  return "";
}
const photoTag = (p) => { const src = photoSrc(p); return src ? `<img src="${esc(src)}" alt="" loading="lazy" data-a="viewPhoto" data-src="${esc(src)}">` : `<div class="ph"></div>`; };
function roomCover(roomId) {
  const e = S.entries.find((x) => x.room_id === roomId && x.photos?.length);
  return e ? e.photos[0] : null;
}

async function resizeImage(file, max = 1600) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b || file), "image/jpeg", 0.82));
}
async function uploadPhoto(file) {
  const blob = await resizeImage(file, store.mode === "demo" ? 700 : 1600);
  return store.uploadPhoto(blob);
}

/* ============ écritures ============ */
async function write(fn, table) {
  try {
    await fn();
    if (store.mode === "cloud" && table) { raw[table] = await store.load(table); rebuild(); render(); }
    return true;
  } catch (e) {
    toast(e.message || "Enregistrement impossible");
    if (table) { raw[table] = await store.load(table).catch(() => raw[table]); rebuild(); render(); }
    return false;
  }
}
const log = (verb, label, task_id = null) => store.upsert("activity", { id: uid(), at: now(), who: S.me, verb, label, task_id }).catch(() => {});

async function toggle(taskId, roomId) {
  const t = S.tasks.get(taskId);
  const pair = t?.pairs.find((p) => p.room_id === roomId);
  if (!pair) return;
  const done = !L.pairDone(pair);
  const before = { room: L.roomStats(S).find((r) => r.room.id === roomId)?.pct ?? 0, task: L.taskDone(t), project: t.project ? L.projectInfo(S, t.project) : null };
  const rawPair = raw.task_rooms.find((p) => p.task_id === taskId && p.room_id === roomId);
  const row = { task_id: taskId, room_id: roomId, done_at: done ? now() : null, done_by: done ? S.me : null };
  Object.assign(rawPair, row);
  rebuild();
  render();
  if (done) {
    const li = document.querySelector(`li.item[data-key="${CSS.escape(taskId + "|" + roomId)}"]`);
    li?.classList.add("pop");
  }
  const ok = await write(() => store.upsert("task_rooms", row), "task_rooms");
  if (!ok || !done) return;
  log("done", t.title + (t.pairs.length > 1 || roomId !== "maison" ? ` (${roomName(roomId)})` : ""), taskId);
  const after = L.roomStats(S).find((r) => r.room.id === roomId);
  const tAfter = S.tasks.get(taskId);
  const live = S.sessions.find((s) => s.day === L.isoDay(new Date()));
  const liveStats = live ? L.sessionStats(S, live) : null;
  const pAfter = tAfter.project ? L.projectInfo(S, tAfter.project) : null;
  const stageBefore = before.project?.stages.find((x) => x.stage.id === tAfter.stage_id);
  const stageAfter = pAfter?.stages.find((x) => x.stage.id === tAfter.stage_id);
  if (pAfter?.complete && !before.project.complete) celebrate(`${pAfter.project.title} : terminé !`, `${pAfter.stages.length} étapes franchies. Un chantier de moins.`);
  else if (stageAfter?.complete && !stageBefore?.complete) celebrate(`Étape franchie : ${stageAfter.stage.title}`, pAfter.current ? `${pAfter.project.title}. ${pAfter.current.stage.sort > stageAfter.stage.sort ? "Prochaine étape" : "Reste l'étape"} : ${pAfter.current.stage.title}.` : pAfter.project.title, true);
  else if (after && after.pct === 1 && before.room < 1 && roomId !== "maison") celebrate(`${roomName(roomId)} : terminé !`, "Toutes les cases de la pièce sont cochées.");
  else if (liveStats && liveStats.total && liveStats.done === liveStats.total && live.items.some((i) => i.task_id === taskId && i.room_id === roomId)) celebrate("Session bouclée !", `${liveStats.total} tâches faites aujourd'hui.`);
  else if (L.taskDone(tAfter) && !before.task && tAfter.pairs.length > 1) toast(`« ${shortTitle(t.title)} » : fait dans toutes les pièces.`);
  else if (after && roomId !== "maison") toast(`Bien joué. ${roomName(roomId)} : ${Math.round(after.pct * 100)} %`);
  else toast("Bien joué.");
}

async function saveTask(id, patch) {
  const t = raw.tasks.find((x) => x.id === id);
  if (!t) return;
  Object.assign(t, patch);
  rebuild();
  renderSheet();
  render();
  await write(() => store.upsert("tasks", stripTask(t)), "tasks");
}
const stripProject = (p) => ({ id: p.id, title: p.title, priority: p.priority, note: p.note || "", sort: p.sort ?? 100 });
const stripTask = (t) => ({ id: t.id, title: t.title, project_id: t.project_id || null, stage_id: t.stage_id || null, kind: t.kind, priority: t.priority, minutes: t.minutes || null, assignee: t.assignee || null, note: t.note || "", depends_on: t.depends_on || [] });

async function createTask({ title, rooms, kind = "travaux", priority = "normale", project_id = null, stage_id = null, minutes = null, note = "", depends_on = [] }) {
  const id = uid();
  const task = { id, title, project_id, stage_id, kind, priority, minutes: minutes || null, assignee: null, note, depends_on, created_by: S.me };
  const pairs = rooms.map((r) => ({ task_id: id, room_id: r, done_at: null, done_by: null }));
  raw.tasks.push(task);
  raw.task_rooms.push(...pairs);
  rebuild();
  await store.upsert("tasks", task);
  await store.upsert("task_rooms", pairs);
  return id;
}

async function applyDictee(r) {
  let added = 0, done = 0, bought = 0;
  try {
    for (const t of r.tasks.filter((x) => x.keep)) {
      await createTask({ title: t.title, rooms: t.room_ids, kind: t.kind, priority: t.priority, project_id: t.project_id || null, stage_id: t.project_id ? t.stage_id || null : null, minutes: t.minutes || null, note: t.note, depends_on: t.depends_on });
      log("added", t.title);
      added++;
    }
    for (const np of (r.new_projects || []).filter((x) => x.keep)) {
      const pid = await createProject(np.title, np.priority || "normale", np.stages.map((st) => [st.title, st.kind]));
      const stageIds = S.stages.filter((x) => x.project_id === pid).map((x) => x.id);
      for (const [i, st] of np.stages.entries()) {
        for (const t of st.tasks) await createTask({ title: t.title, rooms: t.room_ids?.length ? t.room_ids : ["maison"], kind: t.kind || "travaux", priority: np.priority || "normale", project_id: pid, stage_id: stageIds[i], minutes: t.minutes || null });
      }
      log("added", `le chantier ${np.title}`);
      added++;
    }
    const rows = [];
    for (const d of r.done.filter((x) => x.keep)) {
      const t = S.tasks.get(d.task_id);
      if (!t) continue;
      for (const p of t.pairs) if ((!d.room_id || p.room_id === d.room_id) && !L.pairDone(p)) rows.push({ task_id: t.id, room_id: p.room_id, done_at: now(), done_by: S.me });
      log("done", t.title + (d.room_id ? ` (${roomName(d.room_id)})` : ""), t.id);
      done++;
    }
    if (rows.length) await store.upsert("task_rooms", rows);
    const shop = r.shopping.filter((x) => x.keep).map((s) => ({ id: uid(), label: s.label, qty: s.qty || "", store: s.store || "", task_id: s.task_id || null, bought_at: null }));
    if (shop.length) { await store.upsert("shopping", shop); bought = shop.length; }
  } catch (e) {
    toast("Une partie n'a pas été enregistrée : " + e.message);
  }
  raw = await store.loadAll();
  rebuild();
  closeSheet();
  render();
  toast([added && `${added} tâche${added > 1 ? "s" : ""} ajoutée${added > 1 ? "s" : ""}`, done && `${done} cochée${done > 1 ? "s" : ""}`, bought && `${bought} course${bought > 1 ? "s" : ""}`].filter(Boolean).join(", ") || "Rien d'enregistré");
}

async function saveSession(st) {
  const s = st.id ? S.sessions.find((x) => x.id === st.id) : null;
  const d = st.draft;
  d.day = $("#sess-day")?.value || d.day;
  d.label = $("#sess-label")?.value.trim() ?? d.label;
  const row = { id: s?.id || uid(), day: d.day, label: d.label, items: d.items, created_by: s?.created_by || S.me };
  const ok = await write(() => store.upsert("sessions", row), "sessions");
  if (ok) { if (!s) log("session", `une session le ${dayLabel(d.day)}`); closeSheet(); view = "sessions"; render(); toast("Session enregistrée"); }
}

/* ============ fête ============ */
// light : bandeau qui disparaît seul (étape franchie) ; sinon fenêtre à fermer (chantier, pièce, session).
function celebrate(title, text, light = false) {
  document.querySelectorAll(".celebrate").forEach((x) => x.remove());
  const el = document.createElement("div");
  el.className = "celebrate" + (light ? " light" : "");
  el.innerHTML = `<canvas></canvas><div class="box"><strong>${esc(title)}</strong><span>${esc(text)}</span>${light ? "" : `<button class="btn primary">Continuer</button>`}</div>`;
  document.body.appendChild(el);
  if (light) setTimeout(() => el.remove(), 2800);
  else el.addEventListener("click", () => el.remove());
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = $("canvas", el), ctx = c.getContext("2d");
  const dpr = devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  const styles = getComputedStyle(document.documentElement);
  const colors = [styles.getPropertyValue("--accent"), styles.getPropertyValue("--high"), "#ffffff", styles.getPropertyValue("--accent-soft")];
  const bits = Array.from({ length: 120 }, () => ({ x: Math.random() * c.width, y: -Math.random() * c.height * 0.5, vx: (Math.random() - 0.5) * 3 * dpr, vy: (2 + Math.random() * 4) * dpr, r: (3 + Math.random() * 4) * dpr, a: Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)] }));
  const t0 = performance.now();
  (function frame(t) {
    if (!el.isConnected || t - t0 > 3500) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of bits) { b.x += b.vx; b.y += b.vy; b.a += 0.1; ctx.fillStyle = b.c; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillRect(-b.r, -b.r / 2, b.r * 2, b.r); ctx.restore(); }
    requestAnimationFrame(frame);
  })(t0);
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  $("#toasts").replaceChildren(el);
  setTimeout(() => el.remove(), 3000);
}

/* ============ événements ============ */
function bindEvents() {
  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("input", (e) => {
    if (e.target.id === "search") { search = e.target.value; const pos = e.target.selectionStart; render(); const s = $("#search"); s.focus(); s.setSelectionRange(pos, pos); }
    if (e.target.id === "dictee-text" && sheet?.type === "dictee") sheet.text = e.target.value;
    if (e.target.classList.contains("title-input")) autosize(e.target);
  });
  document.addEventListener("focusout", () => setTimeout(() => { if (sheetDirty && !$("#sheets").contains(document.activeElement)) renderSheet(); }, 0));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
}

async function onClick(e) {
  const el = e.target.closest("[data-a]");
  if (!el) return;
  const a = el.dataset.a, d = el.dataset;
  if (a === "scrim" && e.target !== el) return;
  switch (a) {
    case "tab": view = d.v; try { sessionStorage.setItem("chantier.view", view); } catch { /* */ } render(); scrollTo(0, 0); break;
    case "close": case "scrim": closeSheet(); break;
    case "toggle": toggle(d.t, d.r); break;
    case "task": openSheet({ type: "task", id: d.t, back: sheet?.type === "project" ? { type: "project", id: sheet.id } : sheet?.type === "task" ? sheet.back : null }); break;
    case "project": openSheet({ type: "project", id: d.p }); break;
    case "projectNew": openSheet({ type: "newProject" }); setTimeout(() => $("#np-title")?.focus(), 250); break;
    case "npTpl": sheet.title = $("#np-title").value; sheet.tpl = d.v; sheet.stages = null; renderSheet(true); break;
    case "npAdd": sheet.title = $("#np-title").value; sheet.stages.push(["Nouvelle étape", "autre"]); renderSheet(true); break;
    case "npDrop": sheet.title = $("#np-title").value; sheet.stages.splice(+d.i, 1); renderSheet(true); break;
    case "npSave": {
      const title = $("#np-title").value.trim();
      if (!title) { $("#np-title").focus(); break; }
      const defs = sheet.stages.filter(([t]) => t.trim());
      try {
        const pid = await createProject(title, "normale", defs);
        const buyStage = S.stages.find((x) => x.project_id === pid && x.kind === "acheter");
        if (buyStage) await createTask({ title: "Acheter le nécessaire", rooms: ["maison"], kind: "achat", project_id: pid, stage_id: buyStage.id, minutes: 60 });
        log("added", `le chantier ${title}`);
        raw = await store.loadAll(); rebuild(); view = "projects"; render();
        openSheet({ type: "project", id: pid });
      } catch (err) { toast(err.message); }
      break;
    }
    case "projPrio": {
      const pr = S.projectById.get(d.p);
      await write(() => store.upsert("projects", { ...stripProject(pr), priority: d.v }), "projects");
      renderSheet(true);
      break;
    }
    case "projectDelete":
      if (!sheet.confirmDelete) { sheet.confirmDelete = true; renderSheet(true); break; }
      if (await write(() => store.remove("projects", { id: d.p }), "projects")) { sheet.back = null; raw = await store.loadAll(); rebuild(); closeSheet(); render(); toast("Chantier supprimé"); }
      break;
    case "stageEdit": sheet.editStage = sheet.editStage === d.s ? null : d.s; sheet.confirmStage = null; renderSheet(true); break;
    case "stageMove": {
      const st = S.stageById.get(d.s);
      const sib = S.stages.filter((x) => x.project_id === st.project_id);
      const i = sib.indexOf(st), j = i + +d.d;
      if (j < 0 || j >= sib.length) break;
      [sib[i], sib[j]] = [sib[j], sib[i]];
      await write(() => store.upsert("stages", sib.map((x, k) => ({ id: x.id, project_id: x.project_id, title: x.title, kind: x.kind, sort: k }))), "stages");
      if (store.mode === "demo") { raw.stages = await store.load("stages"); rebuild(); }
      renderSheet(true);
      break;
    }
    case "stageDelete": {
      if (sheet.confirmStage !== d.s) { sheet.confirmStage = d.s; renderSheet(true); break; }
      const moved = raw.tasks.filter((t) => t.stage_id === d.s).map((t) => ({ ...stripTask(t), stage_id: null }));
      if (moved.length) await store.upsert("tasks", moved);
      await write(() => store.remove("stages", { id: d.s }), "stages");
      raw = await store.loadAll(); rebuild(); sheet.editStage = null; renderSheet(true); render();
      break;
    }
    case "room": openSheet({ type: "room", id: d.r }); break;
    case "roomsMode": roomsMode = d.v; render(); break;
    case "dictee": openSheet({ type: "dictee", text: "" }); setTimeout(() => $("#dictee-text")?.focus(), 250); break;
    case "slot": openSheet({ type: "picker", minutes: +d.m, who: "" }); break;
    case "pickWho": sheet.who = d.v; renderSheet(true); break;
    case "pickGo": {
      const today = L.isoDay(new Date());
      const existing = S.sessions.find((s) => s.day === today);
      const items = [...(existing?.items || [])];
      for (const it of sheet.items) if (!items.some((x) => x.task_id === it.task_id && x.room_id === it.room_id)) items.push(it);
      const row = { id: existing?.id || uid(), day: today, label: existing?.label || "Session du jour", items, created_by: existing?.created_by || S.me };
      if (await write(() => store.upsert("sessions", row), "sessions")) { closeSheet(); view = "today"; render(); scrollTo(0, 0); toast("C'est parti. Cochez au fur et à mesure."); }
      break;
    }
    case "settings": openSheet({ type: "settings" }); break;
    case "switchMe": store.setMe(null); closeSheet(); renderWhoAmI(); break;
    case "resetDemo": if (!sheet.confirmReset) { sheet.confirmReset = true; renderSheet(true); } else { store.reset(); location.reload(); } break;
    case "signOut": store.signOut(); break;
    case "setField": saveTask(d.t, { [d.k]: d.v || null }); break;
    case "choose": {
      const o = S.options.find((x) => x.id === d.o);
      const rows = S.options.filter((x) => x.task_id === o.task_id).map((x) => ({ ...x, chosen: x.id === o.id }));
      await write(() => store.upsert("options", rows), "options");
      const t = S.tasks.get(o.task_id);
      const open = t.pairs.filter((p) => !L.pairDone(p)).map((p) => ({ task_id: t.id, room_id: p.room_id, done_at: now(), done_by: S.me }));
      if (open.length) await write(() => store.upsert("task_rooms", open), "task_rooms");
      log("decided", `${t.title} → ${o.label}`, t.id);
      toast(`Décidé : ${o.label}. ${L.unlocks(S, t) ? "Des tâches viennent d'être débloquées." : ""}`);
      break;
    }
    case "dropOption": await write(() => store.remove("options", { id: d.o }), "options"); break;
    case "dropRoom": await write(() => store.remove("task_rooms", { task_id: d.t, room_id: d.r }), "task_rooms"); break;
    case "dropDep": { const t = S.tasks.get(d.t); saveTask(d.t, { depends_on: t.depends_on.filter((x) => x !== d.d) }); break; }
    case "deleteTask":
      if (!sheet.confirmDelete) { sheet.confirmDelete = true; renderSheet(true); break; }
      if (await write(() => store.remove("tasks", { id: d.t }), "tasks")) { raw = await store.loadAll(); rebuild(); closeSheet(); render(); toast("Tâche supprimée"); }
      break;
    case "rate": el.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b === el)); el.closest("form").dataset.rating = d.v; break;
    case "buy": {
      const s = S.shopping.find((x) => x.id === d.id);
      const bought = !s.bought_at;
      const row = { ...s, bought_at: bought ? now() : null };
      Object.assign(raw.shopping.find((x) => x.id === s.id), row);
      rebuild();
      render();
      if (!(await write(() => store.upsert("shopping", row), "shopping"))) break;
      if (bought) log("bought", s.label, s.task_id);
      // Une tâche d'achat se coche toute seule quand tous ses articles sont achetés.
      const t = s.task_id ? S.tasks.get(s.task_id) : null;
      if (bought && t?.kind === "achat" && !L.taskDone(t) && S.shopping.filter((x) => x.task_id === t.id).every((x) => x.bought_at)) {
        for (const pr of t.pairs.filter((x) => !L.pairDone(x))) await toggle(t.id, pr.room_id);
      }
      break;
    }
    case "unshop": await write(() => store.remove("shopping", { id: d.id }), "shopping"); break;
    case "clearBought": for (const s of S.shopping.filter((x) => x.bought_at)) await store.remove("shopping", { id: s.id }); raw.shopping = await store.load("shopping"); rebuild(); render(); break;
    case "newTask": openSheet({ type: "newTask", room: d.r || null, project: d.p || null, stage: d.s || null, back: d.p ? { type: "project", id: d.p } : null }); setTimeout(() => $("#nt-title")?.focus(), 250); break;
    case "ntRoom": { const i = sheet.rooms.indexOf(d.r); if (i >= 0) { if (sheet.rooms.length > 1) sheet.rooms.splice(i, 1); } else sheet.rooms.push(d.r); const v = $("#nt-title").value; renderSheet(true); $("#nt-title").value = v; break; }
    case "ntKind": { sheet.kind = d.v; const v = $("#nt-title").value; renderSheet(true); $("#nt-title").value = v; break; }
    case "ntSave": {
      const title = $("#nt-title").value.trim();
      if (!title) { $("#nt-title").focus(); break; }
      try { const back = sheet.back; const id = await createTask({ title, rooms: sheet.rooms, kind: sheet.kind || "travaux", project_id: sheet.project || null, stage_id: sheet.stage || null, priority: (sheet.project && S.projectById.get(sheet.project)?.priority) || "normale" }); log("added", title, id); raw = await store.loadAll(); rebuild(); render(); openSheet({ type: "task", id, back }); }
      catch (err) { toast(err.message); }
      break;
    }
    case "newRoom": {
      const id = uid();
      await write(() => store.upsert("rooms", { id, name: "Nouvelle pièce", sort: S.rooms.length }), "rooms");
      openSheet({ type: "room", id, rename: true });
      break;
    }
    case "renameRoom": sheet.rename = true; renderSheet(true); break;
    case "dicteeGo": {
      const text = ($("#dictee-text")?.value || "").trim();
      if (!text) { toast("Écris ou dicte quelque chose d'abord."); break; }
      sheet.text = text; sheet.phase = "loading"; sheet.error = ""; renderSheet(true);
      try {
        const r = await store.dictee(text, S);
        r.tasks = (r.tasks || []).map((t) => ({ ...t, keep: true }));
        r.done = (r.done || []).map((x) => ({ ...x, keep: true }));
        r.shopping = (r.shopping || []).map((x) => ({ ...x, keep: true }));
        r.new_projects = (r.new_projects || []).map((x) => ({ ...x, keep: true }));
        if (sheet?.type === "dictee") { sheet.result = r; sheet.phase = "result"; renderSheet(true); }
      } catch (err) {
        if (sheet?.type === "dictee") { sheet.phase = "input"; sheet.error = err.message; renderSheet(true); }
      }
      break;
    }
    case "dicteeBack": sheet.phase = "input"; renderSheet(true); break;
    case "dicteeApply": el.disabled = true; await applyDictee(sheet.result); break;
    case "propRoom": {
      const t = sheet.result.tasks[+d.i];
      const i = t.room_ids.indexOf(d.r);
      if (i >= 0) { if (t.room_ids.length > 1) t.room_ids.splice(i, 1); } else t.room_ids.push(d.r);
      renderSheet(true);
      $(`.proposal:nth-of-type(${+d.i + 1}) details`)?.setAttribute("open", "");
      break;
    }
    case "sessionNew": openSheet({ type: "session" }); break;
    case "sessionEdit": openSheet({ type: "session", id: d.s }); break;
    case "sessionMore": {
      const s = S.sessions.find((x) => x.id === d.s);
      const add = L.pick(S, 60, null, s.items || []).items.map((i) => ({ task_id: i.task.id, room_id: i.room_id }));
      if (!add.length) { toast("Plus rien de débloqué qui tienne en 1 h."); break; }
      await write(() => store.upsert("sessions", { ...s, items: [...(s.items || []), ...add] }), "sessions");
      break;
    }
    case "sessFill": {
      const dr = sheet.draft;
      dr.day = $("#sess-day").value; dr.label = $("#sess-label").value;
      const taken = S.sessions.filter((s) => s.id !== sheet.id && s.day >= L.isoDay(new Date())).flatMap((s) => s.items || []);
      dr.items = L.pick(S, +d.m, null, taken).items.map((i) => ({ task_id: i.task.id, room_id: i.room_id }));
      renderSheet(true);
      break;
    }
    case "sessDrop": { sheet.draft.day = $("#sess-day").value; sheet.draft.label = $("#sess-label").value; sheet.draft.items.splice(+d.i, 1); renderSheet(true); break; }
    case "sessSave": saveSession(sheet); break;
    case "sessDelete":
      if (!sheet.confirmDelete) { sheet.confirmDelete = true; renderSheet(true); break; }
      if (await write(() => store.remove("sessions", { id: sheet.id }), "sessions")) closeSheet();
      break;
    case "viewPhoto": {
      const v = document.createElement("div");
      v.className = "photo-view";
      v.innerHTML = `<img src="${esc(d.src)}" alt="">`;
      v.addEventListener("click", () => v.remove());
      document.body.appendChild(v);
      break;
    }
  }
}

async function onChange(e) {
  const el = e.target, f = el.dataset.f, id = el.dataset.t;
  if (!f) {
    if (el.name === "photo") { const span = el.closest("form")?.querySelector("[data-photo-name]"); if (span) span.textContent = el.files[0] ? "1 photo" : ""; }
    return;
  }
  switch (f) {
    case "title": if (el.value.trim()) saveTask(id, { title: el.value.trim() }); break;
    case "placement": { const [pid, sid] = el.value ? el.value.split("|") : [null, null]; saveTask(id, { project_id: pid, stage_id: sid }); break; }
    case "projTitle": { const pr = S.projectById.get(el.dataset.p); if (el.value.trim()) await write(() => store.upsert("projects", { ...stripProject(pr), title: el.value.trim() }), "projects"); break; }
    case "projNote": { const pr = S.projectById.get(el.dataset.p); await write(() => store.upsert("projects", { ...stripProject(pr), note: el.value.trim() }), "projects"); break; }
    case "npStage": sheet.stages[+el.dataset.i][0] = el.value; break;
    case "note": saveTask(id, { note: el.value.trim() }); break;
    case "priority": saveTask(id, { priority: el.value }); break;
    case "minutes": saveTask(id, { minutes: el.value ? +el.value : null }); break;
    case "addRoom": if (el.value) await write(() => store.upsert("task_rooms", { task_id: id, room_id: el.value, done_at: null, done_by: null }), "task_rooms"); break;
    case "addDep": if (el.value) { const t = S.tasks.get(id); saveTask(id, { depends_on: [...t.depends_on, el.value] }); } break;
    case "toSession": {
      if (!el.value) break;
      const s = S.sessions.find((x) => x.id === el.value);
      const t = S.tasks.get(id);
      const add = t.pairs.filter((p) => !L.pairDone(p) && !(s.items || []).some((i) => i.task_id === id && i.room_id === p.room_id)).map((p) => ({ task_id: id, room_id: p.room_id }));
      if (await write(() => store.upsert("sessions", { ...s, items: [...(s.items || []), ...add] }), "sessions")) toast(`Ajouté à ${dayLabel(s.day)}`);
      break;
    }
    case "roomPhoto": {
      const file = el.files[0];
      if (!file) break;
      const r = L.roomStats(S).find((x) => x.room.id === el.dataset.r);
      try {
        toast("Envoi de la photo…");
        const path = await uploadPhoto(file);
        const label = r.pct === 0 ? "Avant" : r.pct === 1 ? "Après" : "Pendant";
        await write(() => store.upsert("entries", { id: uid(), room_id: el.dataset.r, kind: "photo", body: label, photos: [path], author: S.me, created_at: now() }), "entries");
        log("photo", `${roomName(el.dataset.r)} (${label.toLowerCase()})`);
      } catch (err) { toast(err.message); }
      break;
    }
    case "propKeep": sheet.result[el.dataset.kind][+el.dataset.i].keep = el.checked; renderSheet(true); break;
    case "propTitle": sheet.result.tasks[+el.dataset.i].title = el.value; break;
  }
}

async function onSubmit(e) {
  const form = e.target;
  if (form.id === "f-shop") {
    e.preventDefault();
    const label = $("#shop-label").value.trim();
    if (!label) return;
    const storeName = $("#shop-store").value.trim();
    await write(() => store.upsert("shopping", { id: uid(), label, qty: "", store: storeName, task_id: null, bought_at: null }), "shopping");
    $("#shop-label")?.focus();
    return;
  }
  const kind = form.dataset.form;
  if (!kind) return;
  e.preventDefault();
  const fd = new FormData(form);
  const id = form.dataset.t;
  if (kind === "option") {
    const label = String(fd.get("label") || "").trim();
    if (!label) return;
    const price = parseFloat(String(fd.get("price") || "").replace(",", "."));
    await write(() => store.upsert("options", { id: uid(), task_id: id, label, price: isNaN(price) ? null : price, note: "", photo: null, chosen: false }), "options");
  } else if (kind === "shop") {
    const label = String(fd.get("label") || "").trim();
    if (!label) return;
    await write(() => store.upsert("shopping", { id: uid(), label, qty: "", store: "", task_id: id, bought_at: null }), "shopping");
  } else if (kind === "entry") {
    const file = fd.get("photo");
    const row = { id: uid(), task_id: id, kind: "note", body: String(fd.get("body") || "").trim(), recipe: String(fd.get("recipe") || "").trim(), verdict: String(fd.get("verdict") || "").trim(), rating: form.dataset.rating ? +form.dataset.rating : null, photos: [], author: S.me, created_at: now() };
    if (row.recipe || row.verdict || row.rating) row.kind = "essai";
    const btn = form.querySelector("button:not([type=button])");
    if (btn) btn.disabled = true;
    try {
      if (file && file.size) row.photos = [await uploadPhoto(file)];
      if (!row.body && !row.recipe && !row.verdict && !row.photos.length) { toast("Rien à enregistrer."); if (btn) btn.disabled = false; return; }
      if (await write(() => store.upsert("entries", row), "entries")) {
        const t = S.tasks.get(id);
        log(row.kind === "essai" ? "essai" : row.photos.length ? "photo" : "added", t ? t.title : "", id);
        toast(row.kind === "essai" ? "Essai noté" : "Ajouté au carnet");
      }
    } catch (err) { toast(err.message); if (btn) btn.disabled = false; }
  } else if (kind === "stageAdd") {
    const title = String(fd.get("title") || "").trim();
    if (!title) return;
    const pid = form.dataset.p;
    const n = S.stages.filter((x) => x.project_id === pid).length;
    await write(() => store.upsert("stages", { id: uid(), project_id: pid, title, kind: "autre", sort: n }), "stages");
  } else if (kind === "stageEdit") {
    const st = S.stageById.get(form.dataset.s);
    await write(() => store.upsert("stages", { id: st.id, project_id: st.project_id, title: String(fd.get("title") || st.title).trim() || st.title, kind: String(fd.get("kind") || st.kind), sort: st.sort }), "stages");
    sheet.editStage = null; renderSheet(true);
  } else if (kind === "renameRoom") {
    const name = String(fd.get("name") || "").trim();
    const r = S.roomById.get(form.dataset.r);
    if (name && r) { await write(() => store.upsert("rooms", { ...r, name }), "rooms"); sheet.rename = false; renderSheet(true); }
  }
}

/* ============ dates ============ */
function ago(iso) {
  if (!iso) return "";
  const d = new Date(iso), s = (Date.now() - d) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return `aujourd'hui ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "hier";
  if (days < 7) return d.toLocaleDateString("fr-FR", { weekday: "long" });
  return shortDate(iso);
}
const shortDate = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
function dayLabel(day) {
  const [y, m, dd] = day.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const diff = Math.round((d - new Date().setHours(0, 0, 0, 0)) / 864e5);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  const s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
}
function autosize(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
