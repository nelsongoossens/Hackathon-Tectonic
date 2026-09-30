// The attention gate. Default outcome is silence. Scores use ONLY the value to
// the customer; KBC's value is used for one thing: the "would we show this if
// KBC earned nothing from it?" test.
import type { Candidate, GateDecision, Ledgers, SilenceReason } from "./types";

export const GATE = {
  threshold: 0.15,
  minConfidence: 0.5,
  commercialTrust: 0.6,
  commercialTrustWhenDeclared: 0.4, // the customer told us the goal themselves
  earnNothingMinValue: 0.3,
  baseCost: 0.08,
  costPerUse: 0.12,
  recentlyShownDays: 45,
};

export interface GateContext {
  ledgers: Ledgers;
  preferredChannel: "app" | "voice";
  lastShownDay?: number; // same node
  contradiction?: string; // claim the customer rejected / asked us to forget
  triggerDeclared: boolean;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function decide(c: Candidate, ctx: GateContext, guardrailNote?: string): GateDecision {
  const { ledgers } = ctx;
  const budget = Math.max(ledgers.attentionBudget, 0.5);
  const interruptionCost = GATE.baseCost + GATE.costPerUse * (ledgers.attentionUsed / budget);
  const score = r2(c.customerValue * c.confidence * (0.5 + 0.5 * c.urgency) - interruptionCost);
  const base = {
    score,
    threshold: GATE.threshold,
    breakdown: { value: c.customerValue, confidence: r2(c.confidence), urgency: c.urgency, interruptionCost: r2(interruptionCost) },
    trustAtDecision: r2(ledgers.trust),
    attentionLeft: r2(Math.max(0, ledgers.attentionBudget - ledgers.attentionUsed)),
  };
  const silence = (reason: SilenceReason, reasonText: string): GateDecision => ({ ...base, outcome: "silenced", channel: "none", reason, reasonText });
  const channel = ctx.preferredChannel === "voice" ? "voice" : "app";

  if (ledgers.muted.includes(c.nodeId)) return silence("CATEGORY_MUTED", `Customer asked not to see "${c.nodeName}" moments.`);
  if (ctx.contradiction) return silence("DECLARED_CONTRADICTS", `Customer told us this isn't true ("${ctx.contradiction}"). What they declare beats what we infer.`);
  if (c.customerRequested) return { ...base, score: 1, outcome: "shown", channel, reasonText: "Customer asked for this rule, so it's always delivered and doesn't use the attention budget." };
  if (ctx.lastShownDay !== undefined && c.day - ctx.lastShownDay < GATE.recentlyShownDays)
    return silence("RECENTLY_SHOWN", `Already raised ${c.day - ctx.lastShownDay} days ago. Repeating it would be noise.`);
  if (c.confidence < GATE.minConfidence)
    return silence("LOW_CONFIDENCE", `Only ${pct(c.confidence)} sure. Not enough to interrupt someone (needs ${pct(GATE.minConfidence)}).`);
  if (c.commercial && c.customerValue < GATE.earnNothingMinValue)
    return silence("EARN_NOTHING_TEST", `Fails "would we show this if KBC earned nothing?": value to customer ${c.customerValue} vs value to KBC ${c.kbcValue}.`);
  const trustNeeded = ctx.triggerDeclared ? GATE.commercialTrustWhenDeclared : GATE.commercialTrust;
  if (c.commercial && ledgers.trust < trustNeeded)
    return silence("TRUST_TOO_LOW", `Commercial moment needs trust ≥ ${trustNeeded}${ctx.triggerDeclared ? " (lowered: the customer declared this goal)" : ""}; current trust is ${r2(ledgers.trust)}.`);
  if (c.guardrail === "advisor")
    return { ...base, outcome: "advisor", channel: "advisor", reasonText: `${guardrailNote ?? "Needs a human advisor."} Routed to the advisor queue instead of the app.` };
  if (score < GATE.threshold)
    return silence("BELOW_THRESHOLD", `Score ${score} is below ${GATE.threshold}: value × confidence × urgency doesn't justify an interruption.`);
  if (ledgers.attentionUsed >= ledgers.attentionBudget - 1e-9)
    return silence("BUDGET_EXHAUSTED", `Attention budget used up this week (${r2(ledgers.attentionUsed)} of ${r2(ledgers.attentionBudget)}).`);
  return {
    ...base,
    outcome: "shown",
    channel,
    reasonText: `Score ${score} ≥ ${GATE.threshold}${c.commercial ? `, trust ${r2(ledgers.trust)} ≥ ${trustNeeded}` : ""}. ${channel === "voice" ? "Delivered as a voice message (preferred channel)." : "Shown in the app."}`,
  };
}
