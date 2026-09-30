// Event-sourced replay engine. Everything is an event: transactions, and also the
// customer's answers, corrections, dismissals and rules. The state on day N is
// the replay of all events up to day N. That makes the time-lapse trivial and
// keeps every decision explainable.
import type {
  Belief, BeliefKey, Candidate, Category, Counters, Domain, Facts, Interaction, LedgerEvent, LedgerPoint,
  Ledgers, Moment, Rule, ServiceNode, Signal, Txn,
} from "./types";
import { TIMELINE_DAYS, dayOfMonth, dayToISO, getPersona, type Persona } from "./personas";
import { createWatcherState, endOfDay, onTxn, spendWindow, type WatcherState } from "./watchers";
import { NODE_BY_ID, SERVICE_GRAPH } from "./serviceGraph";
import { decide } from "./gate";
import { llmSensemake, llmWriteCopy, type SenseResult } from "./llm";

export interface EngineState {
  persona: Persona;
  day: number;
  facts: Facts;
  beliefs: Belief[];
  rules: Rule[];
  moments: Moment[]; // chronological
  signals: Signal[];
  ledgers: Ledgers;
  ledgerHistory: LedgerPoint[];
  ledgerEvents: LedgerEvent[];
  counters: Counters;
  txns: Txn[]; // up to day
}

const eur = (n: number) => `€${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Heuristic sensemaking (offline fallback, also the reference behaviour) ----------

interface BeliefUpdate {
  key: BeliefKey;
  domain: Domain;
  claim: string;
  confidence: number;
  source: "bank_data" | "inferred";
  evidenceSummary: string;
}

function heuristicSense(sg: Signal, evidence: Txn[]): BeliefUpdate[] {
  const d = sg.data;
  const cat = String(d.category ?? "");
  const merchants = [...new Set(evidence.map((t) => t.merchant))].slice(0, 3).join(", ");
  switch (sg.kind) {
    case "new_recurring":
      if (cat === "pets") return [{ key: "household.pet", domain: "household", claim: "Probably has a pet, most likely a young dog", confidence: 0.8, source: "inferred", evidenceSummary: `Monthly vet care plan + pet shop purchases (${merchants})` }];
      if (cat === "subscriptions") return [{ key: "commitments.subscriptions", domain: "commitments", claim: `Added a new subscription: ${d.merchant}`, confidence: 1, source: "bank_data", evidenceSummary: `${d.merchant} ${eur(Number(d.amount))}/month` }];
      return [];
    case "category_shift":
      if (cat === "groceries") return [{ key: "habits.grocery_trend", domain: "habits", claim: `Grocery spending up ${d.pct}% since spring`, confidence: 0.95, source: "bank_data", evidenceSummary: `${eur(Number(d.recent))} in 30 days vs ${eur(Number(d.baseline))} usual` }];
      if (cat === "utilities") return [{ key: "housing.energy_costs", domain: "housing", claim: `Energy costs rose ${d.pct}% (new contract or tariff)`, confidence: 0.9, source: "bank_data", evidenceSummary: `${merchants}: ${eur(Number(d.recent))}/month vs ${eur(Number(d.baseline))}` }];
      if (cat === "health") return [{ key: "health.rising_costs", domain: "health", claim: "Pharmacy spending has more than doubled", confidence: 0.6, source: "bank_data", evidenceSummary: `${eur(Number(d.recent))} in 30 days vs ${eur(Number(d.baseline))} usual` }];
      if (cat === "kids") return [{ key: "household.children", domain: "household", claim: "Might have a young child (toy-shop purchases)", confidence: 0.35, source: "inferred", evidenceSummary: `${evidence.length} purchases at ${merchants}; could also be gifts` }];
      if (cat === "pets") return [{ key: "household.pet", domain: "household", claim: "Probably has a pet", confidence: 0.6, source: "inferred", evidenceSummary: `New spending at ${merchants}` }];
      return [];
    case "income_change":
      if (d.direction === "up") return [{ key: "income.raise", domain: "income_wealth", claim: `Got a raise: +${d.pct}% net salary`, confidence: 0.95, source: "bank_data", evidenceSummary: `${d.merchant}: ${eur(Number(d.previous))} → ${eur(Number(d.current))}` }];
      return [];
    case "savings_change":
      return [{ key: "goals.saving_major_purchase", domain: "goals", claim: "Saving much harder, likely for a major purchase", confidence: 0.65, source: "inferred", evidenceSummary: `Monthly savings transfer ${eur(Number(d.previous))} → ${eur(Number(d.current))}` }];
    case "large_one_off":
      if (cat === "car") return [{ key: "mobility.car", domain: "mobility", claim: "Bought a car", confidence: 0.85, source: "inferred", evidenceSummary: `${eur(Number(d.amount))} to ${d.merchant}` }];
      if (cat === "home") return [{ key: "goals.home_purchase", domain: "goals", claim: "Preparing to buy a home", confidence: 0.8, source: "inferred", evidenceSummary: `Home inspection + notary provision (${eur(Number(d.amount))} to ${d.merchant})` }];
      if (cat === "family") return [{ key: "household.family_support", domain: "household", claim: "Supports family financially (large gift)", confidence: 0.75, source: "inferred", evidenceSummary: `${eur(Number(d.amount))} to ${d.merchant}` }];
      return [];
    case "low_buffer":
      return [{ key: "habits.low_buffer", domain: "habits", claim: "Balance runs low before payday", confidence: 0.85, source: "bank_data", evidenceSummary: `Balance dropped to ${eur(Number(d.balance))}` }];
    default:
      return [];
  }
}

// ---------- Engine ----------

export interface ComputeOptions {
  useLlm?: boolean; // default true (cache or live)
}

export async function computeState(customerId: string, uptoDay: number, interactions: Interaction[], opts: ComputeOptions = {}): Promise<EngineState> {
  const found = getPersona(customerId);
  if (!found) throw new Error("unknown customer");
  const persona: Persona = found;
  const day = clamp(Math.floor(uptoDay), 0, TIMELINE_DAYS - 1);
  const useLlm = opts.useLlm !== false;

  const ws: WatcherState = createWatcherState(customerId, persona.startBalance, persona.knownRecurring);
  const beliefs = new Map<BeliefKey, Belief>(persona.initialBeliefs.map((b) => [b.key, { ...b }]));
  const rules: Rule[] = [];
  const moments: Moment[] = [];
  const momentById = new Map<string, Moment>();
  const signals: Signal[] = [];
  const ledgers: Ledgers = { ...persona.ledgers, muted: [...persona.ledgers.muted] };
  const ledgerHistory: LedgerPoint[] = [];
  const ledgerEvents: LedgerEvent[] = [];
  const counters: Counters = { events: 0, watcherHits: 0, llmCalls: 0, llmCached: 0, heuristic: 0, candidates: 0, shown: 0, advisor: 0, silenced: 0 };
  const history: Txn[] = [];
  const lastProposed = new Map<string, { day: number; confidence: number }>();
  const lastShown = new Map<string, number>();
  const ruleFired = new Set<string>();
  const byDay = new Map<number, Txn[]>();
  for (const t of persona.txns) {
    if (t.day > day) break;
    if (!byDay.has(t.day)) byDay.set(t.day, []);
    byDay.get(t.day)!.push(t);
  }
  const interactionsByDay = new Map<number, Interaction[]>();
  for (const i of interactions) {
    if (i.day > day) continue;
    if (!interactionsByDay.has(i.day)) interactionsByDay.set(i.day, []);
    interactionsByDay.get(i.day)!.push(i);
  }
  const firstName = persona.summary.name.split(" ")[0];

  const ledger = (d: number, what: string, dt: number, da: number) => {
    ledgers.trust = r2(clamp(ledgers.trust + dt, 0.05, 0.95));
    ledgers.attentionBudget = r2(clamp(ledgers.attentionBudget + da, 0.5, 4));
    ledgerEvents.push({ day: d, what, trustDelta: dt, attentionDelta: da });
  };

  const recurringMerchants = () => [...ws.merchants.entries()].filter(([, m]) => m.recurring);
  const fixedCosts = () => recurringMerchants().reduce((s, [, m]) => s + (m.lastAmount < 0 && m.category !== "savings" ? -m.lastAmount : 0), 0);
  const subsTotal = () => recurringMerchants().reduce((s, [, m]) => s + (m.category === "subscriptions" ? -m.lastAmount : 0), 0);

  function applyBelief(u: BeliefUpdate, sg: Signal, by: Belief["by"], d: number): { changed: boolean; contradiction?: string } {
    const ex = beliefs.get(u.key);
    if (ex && ex.status !== "active") return { changed: false, contradiction: ex.claim };
    if (ex && ex.source === "declared") {
      ex.lastConfirmedDay = d;
      return { changed: false };
    }
    const conf = clamp(u.confidence, 0, 1);
    if (!ex) {
      beliefs.set(u.key, {
        key: u.key, domain: u.domain, claim: u.claim.slice(0, 140), source: u.source, confidence: r2(conf),
        evidence: sg.evidence.slice(-10), evidenceSummary: u.evidenceSummary.slice(0, 180),
        firstSeenDay: d, lastConfirmedDay: d, status: "active", by,
      });
      return { changed: true };
    }
    const merged = r2(clamp(Math.max(ex.confidence, conf) + (conf > 0.3 ? 0.04 : 0), 0, 0.97));
    const changed = merged - ex.confidence >= 0.05;
    Object.assign(ex, {
      claim: u.claim.slice(0, 140), confidence: merged, source: ex.source === "bank_data" ? "bank_data" : u.source,
      evidence: [...new Set([...ex.evidence, ...sg.evidence])].slice(-12), evidenceSummary: u.evidenceSummary.slice(0, 180),
      lastConfirmedDay: d, by,
    });
    return { changed };
  }

  function fill(tpl: string, params: Record<string, string | number>) {
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
  }

  function hardOk(node: ServiceNode): boolean {
    return node.hard.every((h) => {
      switch (h.type) {
        case "age_min": return persona.summary.age >= h.value;
        case "not_product": return !persona.products.includes(h.product);
        case "income_min": return currentIncome() >= h.value;
        case "belief": return (beliefs.get(h.key)?.confidence ?? 0) >= h.minConfidence;
      }
    });
  }
  const currentIncome = () => [...ws.lastIncome.values()].reduce((a, b) => a + b, 0);

  async function propose(node: ServiceNode, sg: Signal, d: number, confidence: number, via: string, opts2: { contradiction?: string; triggerDeclared?: boolean; params?: Record<string, string | number> } = {}) {
    if (!hardOk(node)) return;
    const prev = lastProposed.get(node.id);
    if (prev && d - prev.day < 14 && !(confidence >= prev.confidence + 0.1)) return;
    lastProposed.set(node.id, { day: d, confidence });

    const data = sg.data;
    const params: Record<string, string | number> = {
      merchant: String(data.merchant ?? ""),
      amount: data.amount !== undefined ? eur(Number(data.amount)) : "",
      category: String(data.category ?? ""),
      pct: data.pct !== undefined ? Math.abs(Number(data.pct)) : "",
      recent: data.recent !== undefined ? eur(Number(data.recent)) : "",
      baseline: data.baseline !== undefined ? eur(Number(data.baseline)) : "",
      fixedCosts: eur(fixedCosts()),
      subsTotal: eur(subsTotal()),
      balance: data.balance !== undefined ? eur(Number(data.balance)) : eur(ws.balance),
      ...(opts2.params ?? {}),
    };
    if (node.id === "budget_coach") {
      const weekly = Math.max(10, Math.round(((Number(data.baseline) || 100) / 30) * 7 / 5) * 5);
      params.weekly = `€${weekly}`;
      params.weeklyNum = weekly;
    }
    const component = structuredClone(node.component);
    if (component.type === "choice") component.options = component.options.map((o) => ({ ...o, label: fill(o.label, params) }));
    if (component.type === "slider" && node.id === "raise_autosave") {
      const raise = Math.max(20, Math.round((Number(data.current) - Number(data.previous)) / 10) * 10);
      params.raise = eur(raise);
      component.max = raise;
      component.value = Math.round(raise / 20) * 10;
    }
    const why = [
      `Watcher: ${sg.summary}`,
      via,
      `Service graph: ${node.name} (${node.kind}${node.commercial ? ", commercial" : ""}${node.guardrail === "advisor" ? ", advisor-only" : ""})`,
      ...node.hard.map((h) => `Hard condition ✓ ${h.type === "age_min" ? `age ≥ ${h.value}` : h.type === "not_product" ? `doesn't hold ${h.product}` : h.type === "income_min" ? `income ≥ €${h.value}` : `${h.key} ≥ ${h.minConfidence}`}`),
      ...node.soft.slice(0, 2).map((s) => `Soft signal: ${s}`),
    ];
    const cand: Candidate = {
      id: `${customerId}.${node.id}.d${d}`,
      day: d, nodeId: node.id, nodeName: node.name, signalId: sg.id, signalSummary: sg.summary,
      kind: node.kind, commercial: node.commercial, guardrail: node.guardrail,
      customerValue: node.customerValue, kbcValue: node.kbcValue, confidence: r2(confidence), urgency: node.urgency,
      title: fill(node.copy.title, params), body: fill(node.copy.body, params), copyBy: "template",
      component, why, params, customerRequested: node.id === "rule_alert",
    };
    counters.candidates++;
    const decision = decide(cand, {
      ledgers, preferredChannel: persona.preferredChannel, lastShownDay: lastShown.get(node.id),
      contradiction: opts2.contradiction, triggerDeclared: Boolean(opts2.triggerDeclared),
    }, node.guardrailNote);

    if (decision.outcome !== "silenced" && useLlm) {
      const buttons = component.type === "choice" ? component.options.map((o) => o.label)
        : component.type === "confirm" ? [component.confirmLabel, component.declineLabel]
        : component.type === "info" ? [component.ackLabel, component.dismissLabel] : [component.submitLabel];
      const copy = await llmWriteCopy(node, { title: cand.title, body: cand.body }, {
        firstName, channel: decision.channel, signal: sg.summary,
        beliefs: [...beliefs.values()].filter((b) => b.status === "active").map((b) => b.claim), buttons,
      });
      if (copy) {
        cand.title = copy.value.title.slice(0, 80);
        cand.body = copy.value.body.slice(0, 280);
        cand.copyBy = "llm";
        if (copy.from === "live") counters.llmCalls++; else counters.llmCached++;
      }
    }
    if (decision.outcome === "shown") {
      counters.shown++;
      lastShown.set(node.id, d);
      if (!cand.customerRequested) ledgers.attentionUsed = r2(ledgers.attentionUsed + 1);
    } else if (decision.outcome === "advisor") counters.advisor++;
    else counters.silenced++;
    const m: Moment = { candidate: cand, decision, status: decision.outcome === "shown" ? "open" : decision.outcome === "advisor" ? "queued" : "silenced" };
    moments.push(m);
    momentById.set(cand.id, m);
  }

  async function walkGraph(sg: Signal, d: number, changedBeliefs: { key: BeliefKey; contradiction?: string; declared?: boolean }[]) {
    for (const node of SERVICE_GRAPH) {
      for (const tr of node.triggers) {
        if (tr.watcher && tr.watcher === sg.kind && (!tr.category || tr.category === sg.data.category) && (!tr.direction || tr.direction === sg.data.direction)) {
          await propose(node, sg, d, sg.kind === "category_shift" || sg.kind === "large_one_off" ? 0.9 : 0.95, `Direct trigger on ${sg.kind}`);
          break;
        }
        const cb = tr.belief ? changedBeliefs.find((c) => c.key === tr.belief) : undefined;
        if (cb) {
          const b = beliefs.get(cb.key);
          await propose(node, sg, d, b?.confidence ?? 0.3, b ? `Belief: "${b.claim}" (${b.source}, ${Math.round(b.confidence * 100)}%)` : `Belief ${cb.key}`, {
            contradiction: cb.contradiction, triggerDeclared: cb.declared,
          });
          break;
        }
      }
    }
  }

  async function handleSignal(sg: Signal, d: number) {
    counters.watcherHits++;
    signals.push(sg);
    if (sg.kind === "category_shift" && sg.evidence.length === 0) {
      sg.evidence = history.filter((t) => t.category === sg.data.category && t.day > d - 30 && t.amount < 0).map((t) => t.id);
    }
    const changed: { key: BeliefKey; contradiction?: string; declared?: boolean }[] = [];
    if (sg.kind !== "duplicate_payment" && sg.kind !== "user_rule") {
      const evTxns = history.filter((t) => sg.evidence.includes(t.id));
      let result: SenseResult["beliefs"] | null = null;
      let by: Belief["by"] = "heuristic";
      if (useLlm) {
        const r = await llmSensemake(sg, evTxns, [...beliefs.values()]);
        if (r) {
          result = r.value.beliefs;
          by = "llm";
          if (r.from === "live") counters.llmCalls++; else counters.llmCached++;
        }
      }
      if (!result) {
        result = heuristicSense(sg, evTxns);
        counters.heuristic++;
      }
      for (const u of result) {
        const res = applyBelief(u, sg, by, d);
        if (res.changed || res.contradiction) changed.push({ key: u.key, contradiction: res.contradiction });
      }
    }
    await walkGraph(sg, d, changed);
  }

  function ruleSignals(d: number): Signal[] {
    const out: Signal[] = [];
    const todays = byDay.get(d) ?? [];
    for (const rule of rules) {
      let spent = 0;
      let periodKey = "";
      if (rule.metric === "single_payment") {
        for (const t of todays) {
          if (-t.amount > rule.threshold && !ruleFired.has(`${rule.id}:${t.id}`)) {
            ruleFired.add(`${rule.id}:${t.id}`);
            out.push(mkRuleSignal(rule, d, `${eur(t.amount)} paid to ${t.merchant}, above your ${eur(rule.threshold)} alert.`, [t.id]));
          }
        }
        continue;
      }
      if (rule.metric === "balance_below") {
        if (ws.balance < rule.threshold && !ruleFired.has(`${rule.id}:bal:${Math.floor(d / 7)}`)) {
          ruleFired.add(`${rule.id}:bal:${Math.floor(d / 7)}`);
          out.push(mkRuleSignal(rule, d, `Your balance is ${eur(ws.balance)}, below the ${eur(rule.threshold)} you asked us to watch.`, []));
        }
        continue;
      }
      const start = rule.period === "week" ? d - ((d + 6) % 7) : rule.period === "month" ? d - dayOfMonth(d) + 1 : d;
      periodKey = `${rule.id}:${start}`;
      const recurring = new Set(recurringMerchants().map(([k]) => k));
      for (const t of history) {
        if (t.day < start || t.day > d || t.amount >= 0) continue;
        if (rule.metric === "category_spend" && t.category !== rule.category) continue;
        if (rule.metric === "discretionary_spend" && (recurring.has(t.merchant) || ["housing", "savings", "utilities", "subscriptions", "family"].includes(t.category))) continue;
        spent += -t.amount;
      }
      const per = rule.period === "week" ? "this week" : rule.period === "month" ? "this month" : "today";
      if (spent > rule.threshold && !ruleFired.has(`${periodKey}:over`)) {
        ruleFired.add(`${periodKey}:over`);
        ruleFired.add(`${periodKey}:warn`);
        out.push(mkRuleSignal(rule, d, `You've spent ${eur(spent)} ${per}, over your ${eur(rule.threshold)} limit.`, []));
      } else if (rule.warnAt < 1 && spent > rule.threshold * rule.warnAt && !ruleFired.has(`${periodKey}:warn`)) {
        ruleFired.add(`${periodKey}:warn`);
        out.push(mkRuleSignal(rule, d, `Heads-up: ${eur(spent)} spent ${per}, ${Math.round((spent / rule.threshold) * 100)}% of your ${eur(rule.threshold)} limit.`, []));
      }
    }
    return out;
  }
  function mkRuleSignal(rule: Rule, d: number, detail: string, evidence: string[]): Signal {
    return { id: `${customerId}-s${d}-rule-${rule.id}`, day: d, kind: "user_rule", summary: `Rule "${rule.label}": ${detail}`, data: { ruleId: rule.id, ruleLabel: rule.label, detail }, evidence };
  }

  async function applyInteraction(i: Interaction, d: number) {
    if (i.type === "mute") {
      if (NODE_BY_ID.has(i.nodeId) && !ledgers.muted.includes(i.nodeId)) {
        ledgers.muted.push(i.nodeId);
        ledger(d, `Muted "${NODE_BY_ID.get(i.nodeId)!.name}"`, -0.02, -0.1);
      }
      return;
    }
    if (i.type === "add_rule") {
      if (rules.length < 10) rules.push({ ...i.rule, createdDay: d });
      return;
    }
    if (i.type === "remove_rule") {
      const idx = rules.findIndex((r) => r.id === i.ruleId);
      if (idx >= 0) rules.splice(idx, 1);
      return;
    }
    if (i.type === "correct") {
      const b = beliefs.get(i.beliefKey);
      if (!b) return;
      if (i.verdict === "confirm") Object.assign(b, { source: "declared", confidence: 1, status: "active", by: "customer", lastConfirmedDay: d });
      if (i.verdict === "reject") Object.assign(b, { source: "declared", status: "rejected", by: "customer", lastConfirmedDay: d, evidenceSummary: `Customer: not true${i.note ? ` ("${i.note.slice(0, 100)}")` : ""}` });
      if (i.verdict === "forget") Object.assign(b, { status: "forgotten", by: "customer", lastConfirmedDay: d, evidenceSummary: "Customer asked us not to use this" });
      return;
    }
    const m = momentById.get(i.momentId);
    if (!m || m.decision.outcome !== "shown" || (m.status !== "open" && m.status !== "ignored")) return;
    const c = m.candidate;
    const commercial = c.commercial;
    if (i.type === "dismiss") {
      m.status = "dismissed";
      ledger(d, `Dismissed "${c.title}"`, commercial ? -0.08 : -0.02, -0.3);
      return;
    }
    // engage or answer
    m.status = i.type === "engage" ? "engaged" : "answered";
    ledger(d, `${i.type === "engage" ? "Engaged with" : "Answered"} "${c.title}"`, commercial ? 0.04 : 0.06, commercial ? 0.1 : 0.2);
    const declare = (key: BeliefKey, domain: Domain, claim: string) => {
      const ex = beliefs.get(key);
      beliefs.set(key, {
        key, domain, claim, source: "declared", confidence: 1, status: "active", by: "customer",
        evidence: [...(ex?.evidence ?? []), i.id], evidenceSummary: `You told us on ${dayToISO(d)}`,
        firstSeenDay: ex?.firstSeenDay ?? d, lastConfirmedDay: d,
      });
    };
    if (c.component.type === "choice") {
      const opt = c.component.options.find((o) => o.id === (i.type === "answer" ? i.optionId : undefined));
      m.answerLabel = opt?.label ?? "Answered";
      if (c.nodeId === "budget_coach" && i.type === "answer") {
        const cat = String(c.params.category || "groceries") as Category;
        if (i.optionId === "new_normal") declare("habits.grocery_trend", "habits", `Says the higher ${cat} spending is the new normal`);
        if (i.optionId === "temporary") declare("habits.grocery_trend", "habits", `Says the higher ${cat} spending is temporary`);
        if (i.optionId === "help") {
          const weekly = Number(c.params.weeklyNum) || 100;
          rules.push({
            id: `r-${i.id}`, label: `Warn me at 80% of €${weekly}/week on ${cat}`, metric: "category_spend", category: cat, period: "week",
            threshold: weekly, warnAt: 0.8, sourceText: opt?.label ?? "", compiledBy: "moment", createdDay: d,
          });
        }
      }
      if (c.nodeId === "goal_check" && i.type === "answer") {
        if (i.optionId === "house") {
          declare("goals.home_purchase", "goals", "Saving to buy a home");
          await walkGraph({ id: `${customerId}-s${d}-declared-home`, day: d, kind: "savings_change", summary: "Customer declared: saving to buy a home", data: {}, evidence: [i.id] }, d, [{ key: "goals.home_purchase", declared: true }]);
        } else if (i.optionId === "car") declare("goals.saving_major_purchase", "goals", "Saving for a car");
        else if (i.optionId === "travel") declare("goals.saving_major_purchase", "goals", "Saving for a big trip");
        else if (i.optionId === "private") {
          declare("goals.saving_major_purchase", "goals", "Saving for something they'd rather keep private");
          if (!ledgers.muted.includes("goal_check")) ledgers.muted.push("goal_check");
        }
      }
      if (c.nodeId === "energy_check" && i.type === "answer" && i.optionId === "fine") declare("housing.energy_costs", "housing", "Says the higher energy bill is expected");
    } else if (c.component.type === "slider") {
      const v = clamp(Math.round(Number(i.type === "answer" ? i.value : 0) || 0), c.component.min, c.component.max);
      m.answerLabel = `€${v}/month to savings`;
      if (c.nodeId === "raise_autosave") declare("goals.auto_save", "goals", `Moves €${v}/month to savings automatically`);
    } else if (c.component.type === "confirm") {
      m.answerLabel = c.nodeId === "duplicate_refund" ? "Refund requested" : c.nodeId === "low_buffer_alert" ? "€300 moved from savings" : c.component.confirmLabel;
      if (c.nodeId === "low_buffer_alert") ws.balance += 300;
    } else {
      m.answerLabel = "Got it";
    }
  }

  for (let d = 0; d <= day; d++) {
    if ((d + 6) % 7 === 0) ledgers.attentionUsed = 0; // Monday: new week
    const todays = byDay.get(d) ?? [];
    const daySignals: Signal[] = [];
    for (const t of todays) {
      counters.events++;
      daySignals.push(...onTxn(ws, t, history));
      history.push(t);
    }
    daySignals.push(...endOfDay(ws, d));
    daySignals.push(...ruleSignals(d));
    for (const m of moments) {
      if (m.status === "open" && d - m.candidate.day >= 7 && !m.candidate.customerRequested) {
        m.status = "ignored";
        ledger(d, `No response to "${m.candidate.title}"`, 0, -0.15);
      }
    }
    for (const sg of daySignals) await handleSignal(sg, d);
    for (const i of interactionsByDay.get(d) ?? []) await applyInteraction(i, d);
    ledgerHistory.push({ day: d, trust: ledgers.trust, attentionBudget: ledgers.attentionBudget });
  }

  const income = currentIncome();
  const facts: Facts = {
    name: persona.summary.name,
    age: persona.summary.age,
    city: persona.summary.city,
    products: persona.products,
    balance: Math.round(ws.balance),
    monthlyIncome: Math.round(income),
    fixedCosts: Math.round(fixedCosts()),
    appLoginsPerMonth: persona.appLoginsPerMonth,
    preferredChannel: persona.preferredChannel,
    recurring: recurringMerchants().map(([merchant, m]) => ({ key: merchant, merchant, amount: Math.round(-m.lastAmount * 100) / 100, category: m.category, sinceDay: m.firstDay })),
    spend30d: spendWindow(ws, day, 30),
  };

  return {
    persona, day, facts, beliefs: [...beliefs.values()], rules, moments, signals, ledgers, ledgerHistory, ledgerEvents, counters,
    txns: history,
  };
}
