// Transforme une dictée libre en propositions structurées (tâches, cases cochées, courses).
import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@0.129.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.5";

export const Proposal = z.object({
  summary: z.string().describe("Une phrase qui résume ce qui a été compris."),
  tasks: z.array(z.object({
    title: z.string().describe("Court, à l'infinitif, sans le nom de la pièce."),
    room_ids: z.array(z.string()).describe("Identifiants de pièces existants. Plusieurs si le même travail se répète."),
    lot: z.string(),
    kind: z.enum(["travaux", "decision", "test"]),
    priority: z.enum(["urgente", "haute", "normale", "basse"]),
    minutes: z.number().int().describe("Estimation par pièce, en minutes. 0 si impossible à estimer."),
    note: z.string(),
    depends_on: z.array(z.string()).describe("Identifiants de tâches existantes qui doivent être faites avant."),
  })),
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
  lots: string[];
  tasks: { id: string; title: string; rooms: string[]; done_rooms: string[] }[];
};

const SYSTEM = `Tu aides un couple qui rénove sa maison à tenir la liste de son chantier.
Ils dictent en vrac, à l'oral, souvent au téléphone. Ton travail : transformer la dictée en propositions qu'ils valideront d'un geste.

Règles :
- Découpe les phrases qui mélangent plusieurs actions en tâches distinctes et concrètes.
- Quand le même travail concerne plusieurs pièces, fais UNE tâche avec plusieurs room_ids.
- Utilise uniquement les identifiants de pièces fournis. Si aucune ne convient, mets "maison".
- Réutilise un lot existant quand il convient ; sinon crée un nom de lot court.
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
    lots: ctx.lots,
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
  return {
    summary: p.summary,
    tasks: p.tasks
      .filter((t) => t.title.trim())
      .map((t) => {
        const ids = t.room_ids.filter((r) => rooms.has(r));
        return {
          ...t,
          room_ids: ids.length ? [...new Set(ids)] : ["maison"],
          minutes: t.minutes > 0 ? t.minutes : 0,
          depends_on: t.depends_on.filter((d) => tasks.has(d)),
        };
      }),
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
