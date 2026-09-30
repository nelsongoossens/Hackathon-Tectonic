// Customer intent -> deterministic rule. The LLM (or the offline parser) is a
// compiler: it only ever produces this small JSON DSL, which plain code evaluates.
// Nothing the model returns is executed.
import { z } from "zod";
import type { Category, Rule } from "./types";

export const RULE_CATEGORIES = [
  "groceries", "restaurants", "transport", "fuel", "shopping", "subscriptions", "pets", "health", "travel", "kids",
] as const satisfies readonly Category[];

export const RuleDraftSchema = z.object({
  understood: z.boolean().describe("false if the request is not a spending/balance rule this bank can monitor"),
  label: z.string().describe("Short human readable summary of the rule, max 90 characters"),
  metric: z.enum(["category_spend", "discretionary_spend", "balance_below", "single_payment"]),
  category: z.enum(RULE_CATEGORIES).nullable().describe("Only for metric category_spend"),
  period: z.enum(["week", "month", "day"]),
  threshold: z.number().describe("Amount in euro"),
  warnAt: z.number().describe("Fraction of the threshold at which to send a heads-up, 0.5 to 1"),
});
export type RuleDraft = z.infer<typeof RuleDraftSchema>;

export function finalizeRule(d: RuleDraft, sourceText: string, compiledBy: Rule["compiledBy"], day: number, id: string): Rule | { error: string } {
  if (!d.understood) return { error: "That isn't something I can monitor yet. Try a spending limit, a balance floor or a large-payment alert." };
  if (!Number.isFinite(d.threshold) || d.threshold < 1 || d.threshold > 1_000_000) return { error: "I couldn't find a sensible amount in that." };
  if (d.metric === "category_spend" && !d.category) return { error: "Which kind of spending should I watch (groceries, restaurants, ...)?" };
  const warnAt = Math.min(1, Math.max(0.5, Number.isFinite(d.warnAt) ? d.warnAt : 1));
  return {
    id,
    label: d.label.slice(0, 90) || "Custom rule",
    metric: d.metric,
    category: d.metric === "category_spend" ? (d.category ?? undefined) : undefined,
    period: d.metric === "balance_below" || d.metric === "single_payment" ? "day" : d.period,
    threshold: Math.round(d.threshold),
    warnAt,
    sourceText: sourceText.slice(0, 300),
    compiledBy,
    createdDay: day,
  };
}

const CATEGORY_WORDS: [RegExp, (typeof RULE_CATEGORIES)[number]][] = [
  [/grocer|supermarket|boodschap|food shop/i, "groceries"],
  [/restaurant|eating out|take ?away|takeout|delivery|deliveroo|dining/i, "restaurants"],
  [/fuel|petrol|gas station|diesel/i, "fuel"],
  [/shopping|clothes|clothing/i, "shopping"],
  [/subscription|streaming/i, "subscriptions"],
  [/\bpets?\b|\bvet\b|\bdog\b|\bcat\b/i, "pets"],
  [/pharmac|health|doctor/i, "health"],
  [/travel|holiday|vacation|trip/i, "travel"],
  [/\btrain\b|transport|\bbus\b|tram/i, "transport"],
];

/** Offline compiler used when no LLM key is configured (or the LLM fails). */
export function heuristicCompile(text: string): RuleDraft {
  const t = text.toLowerCase();
  const amountMatch = t.match(/(?:€|eur(?:o|os)?\s*)?\s*(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,]\d{1,2})?\s*(?:€|eur(?:o|os)?|k\b)?/i);
  let threshold = NaN;
  if (amountMatch) {
    threshold = Number(amountMatch[1].replace(/[.,\s]/g, ""));
    if (/\d\s*k\b/i.test(amountMatch[0])) threshold *= 1000;
  }
  const period: RuleDraft["period"] = /\bweek|weekly\b/.test(t) ? "week" : /\bday|daily\b/.test(t) ? "day" : "month";
  const warnAt = /before|approach|close to|heads.?up|nearly|almost/.test(t) ? 0.8 : 1;
  let metric: RuleDraft["metric"] = "discretionary_spend";
  let category: RuleDraft["category"] = null;
  if (/balance|account (?:drops|goes|falls)|below|under\s+€?\d+\s*(?:on|in) my account/.test(t) && /(drop|fall|below|under|less than)/.test(t) && !/spend/.test(t)) {
    metric = "balance_below";
  } else if (/single|any (?:one )?payment|one payment|transaction (?:over|above|bigger|larger)|payment (?:over|above|bigger|larger)/.test(t)) {
    metric = "single_payment";
  } else {
    for (const [re, cat] of CATEGORY_WORDS) if (re.test(t)) { metric = "category_spend"; category = cat; break; }
    if (/fixed cost|outside|besides|apart from|discretionary|free spending|everything else/.test(t)) { metric = "discretionary_spend"; category = null; }
  }
  const eur = Number.isFinite(threshold) ? `€${threshold.toLocaleString("en-US")}` : "?";
  const label =
    metric === "balance_below" ? `Tell me when my balance drops below ${eur}` :
    metric === "single_payment" ? `Tell me about any single payment over ${eur}` :
    metric === "category_spend" ? `${warnAt < 1 ? "Warn me before" : "Tell me when"} I spend more than ${eur}/${period} on ${category}` :
    `${warnAt < 1 ? "Warn me before" : "Tell me when"} I spend more than ${eur}/${period} outside fixed costs`;
  return { understood: Number.isFinite(threshold) && threshold > 0, label, metric, category, period, threshold, warnAt };
}
