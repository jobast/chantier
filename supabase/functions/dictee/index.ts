// POST { text } -> Proposal. Réservé aux membres du foyer (vérifié via la table members, sous RLS).
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { analyse, type Context } from "./core.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY, défini dans les secrets Supabase

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: user } = await supabase.auth.getUser();
  const email = user?.user?.email?.toLowerCase();
  const { data: members } = await supabase.from("members").select("email, name");
  const me = members?.find((m) => m.email.toLowerCase() === email);
  if (!me) return json({ error: "not_member" }, 403);

  let text = "";
  try {
    text = String((await req.json()).text ?? "").trim();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (!text) return json({ error: "empty" }, 400);
  if (text.length > 8000) return json({ error: "too_long" }, 400);

  const [rooms, projects, stages, tasks, taskRooms] = await Promise.all([
    supabase.from("rooms").select("id, name").order("sort"),
    supabase.from("projects").select("id, title").order("sort"),
    supabase.from("stages").select("id, project_id, title, kind").order("sort"),
    supabase.from("tasks").select("id, title, project_id, stage_id"),
    supabase.from("task_rooms").select("task_id, room_id, done_at"),
  ]);
  const byTask = new Map<string, { rooms: string[]; done_rooms: string[] }>();
  for (const tr of taskRooms.data ?? []) {
    const e = byTask.get(tr.task_id) ?? { rooms: [], done_rooms: [] };
    e.rooms.push(tr.room_id);
    if (tr.done_at) e.done_rooms.push(tr.room_id);
    byTask.set(tr.task_id, e);
  }
  const ctx: Context = {
    me: me.name,
    members: (members ?? []).map((m) => m.name),
    rooms: rooms.data ?? [],
    projects: (projects.data ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      stages: (stages.data ?? []).filter((s) => s.project_id === p.id).map((s) => ({ id: s.id, title: s.title, kind: s.kind })),
    })),
    tasks: (tasks.data ?? []).map((t) => ({
      id: t.id, title: t.title, project_id: t.project_id, stage_id: t.stage_id,
      ...(byTask.get(t.id) ?? { rooms: [], done_rooms: [] }),
    })),
  };

  try {
    return json(await analyse(anthropic, ctx, text));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "api_key" }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: "api", status: e.status }, 502);
    const msg = e instanceof Error ? e.message : "unknown";
    return json({ error: msg }, msg === "refusal" || msg === "too_long" ? 422 : 500);
  }
});
