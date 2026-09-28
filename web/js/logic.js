// Règles du chantier, sans DOM : ce qui est fait, ce qui bloque, quoi proposer.

export const PRIO_WEIGHT = { urgente: 100, haute: 40, normale: 12, basse: 3 };
export const DEFAULT_MINUTES = 60;

export function buildState(raw, me = null) {
  const tasks = new Map();
  for (const t of raw.tasks || []) tasks.set(t.id, { ...t, depends_on: t.depends_on || [], pairs: [] });
  for (const p of raw.task_rooms || []) {
    const t = tasks.get(p.task_id);
    if (t) t.pairs.push({ ...p });
  }
  const rooms = [...(raw.rooms || [])].sort((a, b) => (a.sort ?? 100) - (b.sort ?? 100) || a.name.localeCompare(b.name, "fr"));
  const roomOrder = new Map(rooms.map((r, i) => [r.id, i]));
  for (const t of tasks.values()) t.pairs.sort((a, b) => (roomOrder.get(a.room_id) ?? 99) - (roomOrder.get(b.room_id) ?? 99));
  return {
    me,
    members: raw.members || [],
    rooms,
    roomById: new Map(rooms.map((r) => [r.id, r])),
    tasks,
    options: raw.options || [],
    entries: [...(raw.entries || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    shopping: raw.shopping || [],
    sessions: [...(raw.sessions || [])].sort((a, b) => String(b.day).localeCompare(String(a.day))),
    activity: [...(raw.activity || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))),
  };
}

export const pairDone = (p) => !!p.done_at;
export const taskDone = (t) => t.pairs.length > 0 && t.pairs.every(pairDone);
export const taskStarted = (t) => t.pairs.some(pairDone) && !taskDone(t);
export const minutesOf = (t) => (t.minutes > 0 ? t.minutes : DEFAULT_MINUTES);

// Une dépendance bloque la pièce R si elle a une case R non cochée,
// ou, si elle ne concerne pas R, tant qu'elle n'est pas entièrement faite.
export function blockers(S, task, roomId) {
  const out = [];
  for (const id of task.depends_on) {
    const d = S.tasks.get(id);
    if (!d) continue;
    const same = d.pairs.find((p) => p.room_id === roomId);
    if (same ? !pairDone(same) : !taskDone(d)) out.push(d);
  }
  return out;
}

// Une unité de travail = une tâche dans une pièce.
export function openItems(S) {
  const items = [];
  for (const t of S.tasks.values()) {
    for (const p of t.pairs) {
      if (pairDone(p)) continue;
      items.push({ task: t, room_id: p.room_id, blocked: blockers(S, t, p.room_id) });
    }
  }
  return items;
}

export function unlocks(S, task) {
  let n = 0;
  for (const t of S.tasks.values()) if (t.depends_on.includes(task.id) && !taskDone(t)) n += t.pairs.filter((p) => !pairDone(p)).length;
  return n;
}

function score(S, item, who) {
  const t = item.task;
  let s = PRIO_WEIGHT[t.priority] ?? 10;
  if (t.assignee && who) s += t.assignee === who ? 6 : -25;
  if (taskStarted(t)) s += 8;
  s += Math.min(unlocks(S, t), 10) * 3;
  if (t.kind === "decision") s += 4;
  return s;
}

// Choisit de quoi remplir un créneau : prioritaire, débloqué, et regroupé par pièce
// (moins de temps perdu à installer et ranger).
export function pick(S, budget, who = null, exclude = []) {
  const skip = new Set(exclude.map((x) => x.task_id + "|" + x.room_id));
  let pool = openItems(S).filter((i) => !i.blocked.length && !skip.has(i.task.id + "|" + i.room_id));
  const chosen = [];
  let left = budget;
  const rooms = new Set();
  while (pool.length) {
    let best = null, bestScore = -Infinity;
    for (const i of pool) {
      if (minutesOf(i.task) > left) continue;
      const s = score(S, i, who) + (rooms.has(i.room_id) ? 15 : 0) + (chosen.some((c) => c.task.id === i.task.id) ? 6 : 0);
      if (s > bestScore) { best = i; bestScore = s; }
    }
    if (!best) break;
    chosen.push(best);
    rooms.add(best.room_id);
    left -= minutesOf(best.task);
    pool = pool.filter((i) => i !== best);
  }
  return { items: chosen, minutes: budget - left };
}

// Une ligne par tâche (la première pièce ouverte), pour ne pas répéter 6 fois le même geste.
export function quickWins(S, who = null, n = 4) {
  const seen = new Set();
  return openItems(S)
    .filter((i) => !i.blocked.length && i.task.minutes > 0 && i.task.minutes <= 30 && i.task.kind !== "decision")
    .sort((a, b) => score(S, b, who) - score(S, a, who))
    .filter((i) => !seen.has(i.task.id) && seen.add(i.task.id))
    .slice(0, n);
}

export function urgent(S) {
  return openItems(S).filter((i) => !i.blocked.length && i.task.priority === "urgente");
}

export function blockingDecisions(S, n = 3) {
  return [...S.tasks.values()]
    .filter((t) => t.kind === "decision" && !taskDone(t) && !t.pairs.some((p) => blockers(S, t, p.room_id).length))
    .map((t) => ({ task: t, unlocks: unlocks(S, t) }))
    .sort((a, b) => b.unlocks - a.unlocks || (PRIO_WEIGHT[b.task.priority] - PRIO_WEIGHT[a.task.priority]))
    .slice(0, n);
}

export function progress(S) {
  let total = 0, done = 0;
  for (const t of S.tasks.values()) for (const p of t.pairs) { total++; if (pairDone(p)) done++; }
  return { total, done, pct: total ? done / total : 0 };
}

export function roomStats(S) {
  const m = new Map(S.rooms.map((r) => [r.id, { room: r, total: 0, done: 0, minutesLeft: 0 }]));
  for (const t of S.tasks.values()) for (const p of t.pairs) {
    const e = m.get(p.room_id);
    if (!e) continue;
    e.total++;
    if (pairDone(p)) e.done++; else e.minutesLeft += minutesOf(t);
  }
  return [...m.values()].map((e) => ({ ...e, pct: e.total ? e.done / e.total : 0 }));
}

// Semaines (lundi) consécutives avec au moins une case cochée. La semaine en cours
// ne casse pas la série tant qu'elle n'est pas finie.
export function weekStart(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export function streak(S, now = new Date()) {
  const weeks = new Set();
  for (const t of S.tasks.values()) for (const p of t.pairs) if (p.done_at) weeks.add(weekStart(p.done_at).getTime());
  let w = weekStart(now);
  if (!weeks.has(w.getTime())) w.setDate(w.getDate() - 7);
  let n = 0;
  while (weeks.has(w.getTime())) { n++; w.setDate(w.getDate() - 7); }
  return { weeks: n, thisWeek: weeks.has(weekStart(now).getTime()) };
}

export function doneThisWeek(S, now = new Date()) {
  const w0 = weekStart(now).getTime();
  const by = {};
  let total = 0;
  for (const t of S.tasks.values()) for (const p of t.pairs) {
    if (p.done_at && new Date(p.done_at).getTime() >= w0) { total++; const k = p.done_by || "?"; by[k] = (by[k] || 0) + 1; }
  }
  return { total, by };
}

export function sessionStats(S, session) {
  let done = 0, total = 0, minutes = 0;
  for (const it of session.items || []) {
    const t = S.tasks.get(it.task_id);
    const p = t?.pairs.find((x) => x.room_id === it.room_id);
    if (!p) continue;
    total++;
    if (pairDone(p)) done++; else minutes += minutesOf(t);
  }
  return { done, total, minutesLeft: minutes };
}

export function fmtMinutes(m) {
  if (!m) return "";
  if (m < 60) return `${m} min`;
  if (m < 240) return (m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`);
  if (m <= 300) return "½ journée";
  if (m <= 540) return "1 journée";
  return `${Math.round(m / 480)} jours`;
}

export function nextSaturday(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const add = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + add);
  return d;
}

export const isoDay = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
