// Maps engine state to API views. The customer view deliberately leaves out the
// bank-internal parts (silence log, scores, KBC value, advisor queue).
import type { AdvisorItem, CompareView, CustomerAppView, StaffView } from "./types";
import { computeState, type EngineState } from "./engine";
import { TIMELINE_DAYS, customerSummaries, dayToISO, getPersona } from "./personas";
import { getInteractions, getSimDay } from "./store";
import { llmEnabled, llmModel } from "./llm";
import { voiceEnabled } from "./voice";

export async function engineFor(customerId: string, day = getSimDay(customerId)): Promise<EngineState> {
  return computeState(customerId, day, getInteractions(customerId));
}

export function toStaffView(s: EngineState): StaffView {
  return {
    customer: s.persona.summary,
    history: s.persona.history,
    day: s.day,
    date: dayToISO(s.day),
    maxDay: TIMELINE_DAYS - 1,
    facts: s.facts,
    beliefs: s.beliefs,
    rules: s.rules,
    moments: [...s.moments].reverse(),
    signals: [...s.signals].reverse(),
    ledgers: s.ledgers,
    ledgerHistory: s.ledgerHistory,
    ledgerEvents: [...s.ledgerEvents].reverse(),
    counters: s.counters,
    recentTxns: s.txns.slice(-40).reverse(),
    llm: { mode: llmEnabled() ? "live" : "offline", model: llmEnabled() ? llmModel() : null },
    voice: { enabled: voiceEnabled() },
  };
}

export function toCustomerView(s: EngineState): CustomerAppView {
  return {
    customer: s.persona.summary,
    day: s.day,
    date: dayToISO(s.day),
    balance: s.facts.balance,
    recentTxns: s.txns.slice(-25).reverse(),
    feed: s.moments.filter((m) => m.decision.outcome === "shown").reverse().slice(0, 20),
    beliefs: s.beliefs,
    rules: s.rules,
    preferredChannel: s.persona.preferredChannel,
    voice: { enabled: voiceEnabled() },
  };
}

export async function advisorQueue(): Promise<AdvisorItem[]> {
  const items: AdvisorItem[] = [];
  for (const c of customerSummaries()) {
    const s = await engineFor(c.id);
    for (const m of s.moments) if (m.decision.outcome === "advisor") items.push({ customer: c, moment: m });
  }
  return items.sort((a, b) => b.moment.candidate.day - a.moment.candidate.day);
}

/** Same event (a new pet showing up in the transactions), two customers, different relationship. */
export async function compareView(): Promise<CompareView> {
  const ids = ["c_emma", "c_sam"];
  const rows = [];
  let eventDay = 98;
  for (const id of ids) {
    const s = await engineFor(id, Math.max(getSimDay(id), 140));
    const sig = s.signals.find((x) => x.data.category === "pets");
    if (sig) eventDay = sig.day;
    const moments = s.moments.filter((m) => ["pet_budget", "pet_insurance"].includes(m.candidate.nodeId));
    rows.push({ customer: getPersona(id)!.summary, trust: moments[0]?.decision.trustAtDecision ?? s.ledgers.trust, moments });
  }
  return { event: "A puppy shows up in the transactions (vet visit, care plan, pet shop)", day: eventDay, date: dayToISO(eventDay), rows };
}
