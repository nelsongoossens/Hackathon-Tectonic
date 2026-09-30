// Shared action logic for customer routes (/api/me/*) and staff simulation
// routes (/api/staff/customers/:id/*). Validates everything server-side against
// the engine state of THAT customer before recording an interaction.
import { z } from "zod";
import type { Actor, Interaction } from "./types";
import { NODE_BY_ID } from "./serviceGraph";
import { addInteraction, getSimDay } from "./store";
import { engineFor } from "./views";
import { finalizeRule, heuristicCompile } from "./rules";
import { llmCompileRule } from "./llm";
import { synthesize } from "./voice";

const id = z.string().min(1).max(120).regex(/^[\w.:-]+$/);
const beliefKey = z.enum([
  "income.raise", "household.pet", "household.children", "mobility.car", "habits.grocery_trend", "habits.low_buffer",
  "commitments.subscriptions", "goals.saving_major_purchase", "goals.home_purchase", "goals.auto_save",
  "health.rising_costs", "housing.energy_costs", "household.family_support", "channel.prefers_voice",
]);

export const InteractSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answer"), momentId: id, optionId: z.string().max(40).optional(), value: z.number().finite().min(0).max(100_000).optional() }),
  z.object({ type: z.literal("engage"), momentId: id }),
  z.object({ type: z.literal("dismiss"), momentId: id }),
  z.object({ type: z.literal("mute"), nodeId: id }),
  z.object({ type: z.literal("correct"), beliefKey, verdict: z.enum(["confirm", "reject", "forget"]), note: z.string().max(200).optional() }),
  z.object({ type: z.literal("remove_rule"), ruleId: id }),
]);
export const RuleTextSchema = z.object({ text: z.string().trim().min(4).max(300) });
export const VoiceSchema = z.object({ momentId: id });

type Result = { ok: true } | { ok: false; status: number; error: string };

export async function performInteract(customerId: string, raw: unknown, actor: Actor): Promise<Result> {
  const parsed = InteractSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: "Invalid request" };
  const body = parsed.data;
  const state = await engineFor(customerId);
  const day = getSimDay(customerId);

  if (body.type === "answer" || body.type === "engage" || body.type === "dismiss") {
    const m = state.moments.find((x) => x.candidate.id === body.momentId);
    if (!m || m.decision.outcome !== "shown" || (m.status !== "open" && m.status !== "ignored"))
      return { ok: false, status: 409, error: "That moment isn't open any more" };
    if (body.type === "answer" && m.candidate.component.type === "choice" && !m.candidate.component.options.some((o) => o.id === body.optionId))
      return { ok: false, status: 400, error: "Unknown option" };
  }
  if (body.type === "mute" && !NODE_BY_ID.has(body.nodeId)) return { ok: false, status: 400, error: "Unknown moment type" };
  if (body.type === "correct" && !state.beliefs.some((b) => b.key === body.beliefKey)) return { ok: false, status: 404, error: "Nothing to correct" };
  if (body.type === "remove_rule" && !state.rules.some((r) => r.id === body.ruleId)) return { ok: false, status: 404, error: "Rule not found" };

  addInteraction(customerId, { ...body, day, actor } as Omit<Interaction, "id">);
  return { ok: true };
}

export async function performAddRule(customerId: string, raw: unknown, actor: Actor): Promise<Result & { rule?: unknown }> {
  const parsed = RuleTextSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: "Please describe the rule in 4 to 300 characters" };
  const text = parsed.data.text;
  const day = getSimDay(customerId);
  const llm = await llmCompileRule(text);
  const draft = llm?.value ?? heuristicCompile(text);
  const rule = finalizeRule(draft, text, llm ? "llm" : "heuristic", day, `r-${Date.now().toString(36)}`);
  if ("error" in rule) return { ok: false, status: 422, error: rule.error };
  const state = await engineFor(customerId);
  if (state.rules.length >= 10) return { ok: false, status: 422, error: "You can have at most 10 rules" };
  addInteraction(customerId, { type: "add_rule", rule, day, actor } as Omit<Interaction, "id">);
  return { ok: true, rule };
}

/** Only synthesises text of a moment that belongs to this customer (no arbitrary text: protects the TTS credits). */
export async function performVoice(customerId: string, raw: unknown): Promise<{ status: number; audio?: Buffer; error?: string }> {
  const parsed = VoiceSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, error: "Invalid request" };
  const state = await engineFor(customerId);
  const m = state.moments.find((x) => x.candidate.id === parsed.data.momentId && x.decision.outcome === "shown");
  if (!m) return { status: 404, error: "Moment not found" };
  const audio = await synthesize(`${m.candidate.title}. ${m.candidate.body}`);
  if (!audio) return { status: 503, error: "voice_disabled" };
  return { status: 200, audio };
}
