// Transforme une dictée libre en propositions structurées (tâches, cases cochées, courses).
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@0.129.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.5";

const TaskKind = z.enum(["travaux", "decision", "test", "achat"]);
const Priority = z.enum(["urgente", "haute", "normale", "basse"]);
const StageKind = z.enum(["decider", "acheter", "tester", "preparer", "appliquer", "finir", "autre"]);

export const Proposal = z.object({
  summary: z.string().describe("Une phrase qui résume ce qui a été compris."),
  tasks: z.array(z.object({
    title: z.string().describe("Court, à l'infinitif, sans le nom de la pièce."),
    room_ids: z.array(z.string()).describe("Identifiants de pièces existants. Plusieurs si le même travail se répète."),
    project_id: z.string().describe("Chantier existant auquel rattacher la tâche, ou vide pour un petit travail isolé."),
    stage_id: z.string().describe("Étape existante de ce chantier, ou vide."),
    kind: TaskKind,
    priority: Priority,
    minutes: z.number().int().describe("Estimation par pièce, en minutes. 0 si impossible à estimer."),
    note: z.string(),
    depends_on: z.array(z.string()).describe("Identifiants de tâches existantes qui doivent être faites avant."),
  })),
  new_projects: z.array(z.object({
    title: z.string(),
    priority: Priority,
    stages: z.array(z.object({
      title: z.string(),
      kind: StageKind,
      tasks: z.array(z.object({
        title: z.string(),
        room_ids: z.array(z.string()),
        kind: TaskKind,
        minutes: z.number().int(),
      })),
    })),
  })).describe("Nouveaux chantiers quand la dictée décrit un processus qui n'existe pas encore."),
  done: z.array(z.object({
    task_id: z.string(),
    room_id: z.string().describe("Pièce cochée. Vide si toutes les pièces de la tâche sont faites."),
  })).describe("Tâches existantes que la dictée déclare faites."),
  shopping: z.array(z.object({
    label: z.string(),
    qty: z.string(),
    store: z.string(),
    task_id: z.string().describe("Tâche existante liée, ou vide."),
  })),
  questions: z.array(z.string()).describe("Au plus 3 ambiguïtés réelles à trancher par le couple."),
});
export type Proposal = z.infer<typeof Proposal>;

export type Context = {
  me: string;
  members: string[];
  rooms: { id: string; name: string }[];
  projects: { id: string; title: string; stages: { id: string; title: string; kind: string }[] }[];
  tasks: { id: string; title: string; project_id: string | null; stage_id: string | null; rooms: string[]; done_rooms: string[] }[];
};

const SYSTEM = `Tu aides un couple qui rénove sa maison à tenir la liste de son chantier.
Ils dictent en vrac, à l'oral, souvent au téléphone. Ton travail : transformer la dictée en propositions qu'ils valideront d'un geste.

Le chantier est organisé en chantiers (des processus) découpés en étapes ordonnées : décider, acheter, tester, préparer, appliquer, finir.
Une étape est franchie quand toutes ses tâches sont faites ; l'étape suivante attend.

Règles :
- Découpe les phrases qui mélangent plusieurs actions en tâches distinctes et concrètes.
- Rattache chaque nouvelle tâche au chantier et à l'étape existants qui conviennent (project_id, stage_id).
- Si la dictée décrit un nouveau processus (par exemple choisir, acheter, tester, poser), propose-le dans new_projects avec ses étapes dans l'ordre, plutôt qu'en tâches isolées.
- Un achat à faire est une tâche kind "achat" dans l'étape d'achat ; les articles eux-mêmes vont dans shopping.
- Quand le même travail concerne plusieurs pièces, fais UNE tâche avec plusieurs room_ids.
- Utilise uniquement les identifiants de pièces fournis. Si aucune ne convient, mets "maison".
- kind = "decision" pour un choix à faire, "test" pour un essai ou une expérimentation, sinon "travaux".
- Priorité "urgente" seulement pour la sécurité, l'eau, ou ce qu'ils disent urgent.
- Ne recrée pas une tâche qui existe déjà : si la dictée dit qu'elle est faite, mets-la dans done ; sinon ignore-la.
- Les achats vont dans shopping, pas dans tasks.
- Ne pose une question que si une mauvaise interprétation ferait faire un travail inutile.
- Écris en français, sans jargon.`;

export function contextBlock(ctx: Context): string {
  return JSON.stringify({
    qui_dicte: ctx.me,
    membres: ctx.members,
    pieces: ctx.rooms,
    chantiers: ctx.projects,
    taches_existantes: ctx.tasks,
  });
}

export async function analyse(client: Anthropic, ctx: Context, text: string): Promise<Proposal> {
  const response = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Proposal) },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `État du chantier :\n${contextBlock(ctx)}\n\nDictée :\n${text}`,
    }],
  });
  if (response.stop_reason === "refusal") throw new Error("refusal");
  if (response.stop_reason === "max_tokens") throw new Error("too_long");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("unparseable");
  return sanitize(parsed, ctx);
}

// Le modèle respecte le schéma, mais les identifiants doivent aussi exister dans la base.
export function sanitize(p: Proposal, ctx: Context): Proposal {
  const rooms = new Set(ctx.rooms.map((r) => r.id));
  const tasks = new Map(ctx.tasks.map((t) => [t.id, t]));
  const projects = new Map(ctx.projects.map((p) => [p.id, p]));
  const roomsOf = (ids: string[]) => {
    const ok = [...new Set(ids.filter((r) => rooms.has(r)))];
    return ok.length ? ok : ["maison"];
  };
  return {
    summary: p.summary,
    tasks: p.tasks
      .filter((t) => t.title.trim())
      .map((t) => {
        const project = projects.get(t.project_id);
        return {
          ...t,
          room_ids: roomsOf(t.room_ids),
          project_id: project ? project.id : "",
          stage_id: project?.stages.some((s) => s.id === t.stage_id) ? t.stage_id : "",
          minutes: t.minutes > 0 ? t.minutes : 0,
          depends_on: t.depends_on.filter((d) => tasks.has(d)),
        };
      }),
    new_projects: p.new_projects
      .filter((np) => np.title.trim() && np.stages.length)
      .map((np) => ({
        ...np,
        stages: np.stages.map((st) => ({
          ...st,
          tasks: st.tasks.filter((t) => t.title.trim()).map((t) => ({ ...t, room_ids: roomsOf(t.room_ids), minutes: t.minutes > 0 ? t.minutes : 0 })),
        })),
      })),
    done: p.done.filter((d) => {
      const t = tasks.get(d.task_id);
      return t && (!d.room_id || t.rooms.includes(d.room_id));
    }),
    shopping: p.shopping
      .filter((s) => s.label.trim())
      .map((s) => ({ ...s, task_id: tasks.has(s.task_id) ? s.task_id : "" })),
    questions: p.questions.slice(0, 3),
  };
}
