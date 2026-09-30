// Shared contract between the engine, the API routes and the UI.
// Everything the bank knows or decides is expressed in these types.

export type Day = number; // 0 = 2026-03-01, simulation runs TIMELINE_DAYS days

export type Category =
  | "income"
  | "housing"
  | "groceries"
  | "restaurants"
  | "transport"
  | "fuel"
  | "car"
  | "pets"
  | "health"
  | "utilities"
  | "subscriptions"
  | "shopping"
  | "kids"
  | "savings"
  | "family"
  | "home"
  | "travel"
  | "other";

export interface Txn {
  id: string;
  day: Day;
  amount: number; // negative = money out
  merchant: string;
  category: Category;
}

// ---------- Client model (facts tier + understanding tier) ----------

export type BeliefSource = "bank_data" | "declared" | "inferred";
export type Domain =
  | "income_wealth"
  | "housing"
  | "mobility"
  | "household"
  | "commitments"
  | "goals"
  | "habits"
  | "health"
  | "channel";

export type BeliefKey =
  | "income.raise"
  | "household.pet"
  | "household.children"
  | "mobility.car"
  | "habits.grocery_trend"
  | "habits.low_buffer"
  | "commitments.subscriptions"
  | "goals.saving_major_purchase"
  | "goals.home_purchase"
  | "goals.auto_save"
  | "health.rising_costs"
  | "housing.energy_costs"
  | "household.family_support"
  | "channel.prefers_voice";

export interface Belief {
  key: BeliefKey;
  domain: Domain;
  claim: string;
  source: BeliefSource;
  confidence: number; // 0..1
  evidence: string[]; // txn ids / interaction ids
  evidenceSummary: string;
  firstSeenDay: Day;
  lastConfirmedDay: Day;
  status: "active" | "rejected" | "forgotten";
  by: "llm" | "heuristic" | "customer" | "bank";
}

export interface RecurringCommitment {
  key: string;
  merchant: string;
  amount: number; // positive monthly amount
  category: Category;
  sinceDay: Day;
}

export interface Facts {
  name: string;
  age: number;
  city: string;
  products: string[];
  balance: number;
  monthlyIncome: number;
  fixedCosts: number;
  appLoginsPerMonth: number;
  preferredChannel: "app" | "voice";
  recurring: RecurringCommitment[];
  spend30d: Partial<Record<Category, number>>;
}

// ---------- Watchers ----------

export type WatcherKind =
  | "new_recurring"
  | "category_shift"
  | "income_change"
  | "large_one_off"
  | "low_buffer"
  | "duplicate_payment"
  | "savings_change"
  | "user_rule";

export interface Signal {
  id: string;
  day: Day;
  kind: WatcherKind;
  summary: string;
  data: Record<string, string | number>;
  evidence: string[]; // txn ids
}

// ---------- Rules compiled from customer intent ----------

export interface Rule {
  id: string;
  label: string; // human readable, e.g. "Warn me at 80% of €150/week on groceries"
  metric: "category_spend" | "discretionary_spend" | "balance_below" | "single_payment";
  category?: Category;
  period: "week" | "month" | "day";
  threshold: number; // euros
  warnAt: number; // 0.5..1, fraction of threshold that triggers a heads-up
  sourceText: string;
  compiledBy: "llm" | "heuristic" | "moment";
  createdDay: Day;
}

// ---------- UI component library (agents fill these, never write UI) ----------

export interface ChoiceOption {
  id: string;
  label: string;
}

export type ComponentSpec =
  | { type: "info"; ackLabel: string; dismissLabel: string }
  | { type: "confirm"; confirmLabel: string; declineLabel: string }
  | { type: "choice"; options: ChoiceOption[] }
  | {
      type: "slider";
      label: string;
      min: number;
      max: number;
      step: number;
      value: number;
      unit: string;
      submitLabel: string;
    };

// ---------- Service graph ----------

export type HardCondition =
  | { type: "age_min"; value: number }
  | { type: "not_product"; product: string }
  | { type: "income_min"; value: number }
  | { type: "belief"; key: BeliefKey; minConfidence: number };

export interface ServiceNode {
  id: string;
  name: string;
  branch: "budgeting" | "home" | "mobility" | "pets" | "savings" | "investing" | "protection" | "daily";
  kind: "help" | "offer" | "advice";
  commercial: boolean;
  guardrail: "self_serve" | "advisor";
  guardrailNote?: string;
  triggers: { watcher?: WatcherKind; category?: Category; direction?: "up" | "down"; belief?: BeliefKey }[];
  hard: HardCondition[];
  soft: string[];
  requires: string[];
  unlocks: string[];
  conflicts: string[];
  procedure: string[];
  freedoms: string[];
  customerValue: number; // 0..1, what the customer gains
  kbcValue: number; // 0..1, what KBC gains (never used for scoring; only for the earn-nothing test)
  urgency: number; // 0..1
  component: ComponentSpec;
  copy: { title: string; body: string }; // templates with {placeholders}
}

// ---------- Moments and the attention gate ----------

export type GateOutcome = "shown" | "advisor" | "silenced";
export type SilenceReason =
  | "CATEGORY_MUTED"
  | "DECLARED_CONTRADICTS"
  | "RECENTLY_SHOWN"
  | "LOW_CONFIDENCE"
  | "EARN_NOTHING_TEST"
  | "TRUST_TOO_LOW"
  | "BELOW_THRESHOLD"
  | "BUDGET_EXHAUSTED";

export interface Candidate {
  id: string; // stable across replays
  day: Day;
  nodeId: string;
  nodeName: string;
  signalId: string;
  signalSummary: string;
  kind: ServiceNode["kind"];
  commercial: boolean;
  guardrail: ServiceNode["guardrail"];
  customerValue: number;
  kbcValue: number;
  confidence: number;
  urgency: number;
  title: string;
  body: string;
  copyBy: "llm" | "template";
  component: ComponentSpec;
  why: string[]; // provenance: signal -> belief -> graph node -> conditions
  params: Record<string, string | number>;
  customerRequested: boolean; // rule alerts the customer asked for
}

export interface GateDecision {
  outcome: GateOutcome;
  channel: "app" | "voice" | "advisor" | "none";
  score: number;
  threshold: number;
  breakdown: { value: number; confidence: number; urgency: number; interruptionCost: number };
  reason?: SilenceReason;
  reasonText: string;
  trustAtDecision: number;
  attentionLeft: number;
}

export type MomentStatus = "open" | "engaged" | "answered" | "dismissed" | "ignored" | "silenced" | "queued";

export interface Moment {
  candidate: Candidate;
  decision: GateDecision;
  status: MomentStatus;
  answerLabel?: string;
}

// ---------- Customer interactions (event-sourced, replayed with the timeline) ----------

export type Actor = "customer" | "simulation";

export type Interaction =
  | { id: string; day: Day; actor: Actor; type: "answer"; momentId: string; optionId?: string; value?: number }
  | { id: string; day: Day; actor: Actor; type: "engage"; momentId: string }
  | { id: string; day: Day; actor: Actor; type: "dismiss"; momentId: string }
  | { id: string; day: Day; actor: Actor; type: "mute"; nodeId: string }
  | { id: string; day: Day; actor: Actor; type: "correct"; beliefKey: BeliefKey; verdict: "confirm" | "reject" | "forget"; note?: string }
  | { id: string; day: Day; actor: Actor; type: "add_rule"; rule: Rule }
  | { id: string; day: Day; actor: Actor; type: "remove_rule"; ruleId: string };

// ---------- Ledgers ----------

export interface Ledgers {
  trust: number; // 0..1
  attentionBudget: number; // interruptions per week this person tolerates
  attentionUsed: number; // this week
  muted: string[]; // node ids
}

export interface LedgerPoint {
  day: Day;
  trust: number;
  attentionBudget: number;
}

export interface LedgerEvent {
  day: Day;
  what: string;
  trustDelta: number;
  attentionDelta: number;
}

export interface Counters {
  events: number;
  watcherHits: number;
  llmCalls: number; // live calls made while computing this view
  llmCached: number; // answers served from the LLM cache
  heuristic: number; // offline fallbacks
  candidates: number;
  shown: number;
  advisor: number;
  silenced: number;
}

// ---------- API views ----------

export interface CustomerSummary {
  id: string;
  name: string;
  age: number;
  city: string;
  tagline: string;
}

/** Full engine view for staff (control room). GET /api/staff/customers/:id/state */
export interface StaffView {
  customer: CustomerSummary;
  history: string; // pre-timeline context (e.g. "dismissed 3 offers before March")
  day: Day;
  date: string; // ISO date of `day`
  maxDay: Day;
  facts: Facts;
  beliefs: Belief[];
  rules: Rule[];
  moments: Moment[]; // every gate decision up to `day`, newest first
  signals: Signal[]; // newest first
  ledgers: Ledgers;
  ledgerHistory: LedgerPoint[];
  ledgerEvents: LedgerEvent[]; // newest first
  counters: Counters;
  recentTxns: Txn[]; // newest first, max 40
  llm: { mode: "live" | "offline"; model: string | null };
  voice: { enabled: boolean };
}

/** What the customer sees in the app. GET /api/me/state */
export interface CustomerAppView {
  customer: CustomerSummary;
  day: Day;
  date: string;
  balance: number;
  recentTxns: Txn[];
  feed: Moment[]; // shown moments, newest first (includes answered ones, max 20)
  beliefs: Belief[]; // "What KBC understands about me"
  rules: Rule[];
  preferredChannel: "app" | "voice";
  voice: { enabled: boolean };
}

export interface CompareRow {
  customer: CustomerSummary;
  trust: number;
  moments: Moment[];
}

/** GET /api/staff/compare - the same event for two customers */
export interface CompareView {
  event: string;
  day: Day;
  date: string;
  rows: CompareRow[];
}

export interface AdvisorItem {
  customer: CustomerSummary;
  moment: Moment;
}

export interface ScaleResult {
  customers: number;
  days: number;
  events: number;
  watcherHits: number;
  escalationRate: number; // watcher hits / customers / month
  seconds: number;
  eventsPerSecond: number;
  byWatcher: Record<string, number>;
  projection: {
    customers: number;
    hoursForSixMonthsOfEvents: number;
    llmCallsPerDay: number;
    costPerCustomerPerYearEUR: { model: string; eur: number }[];
  };
  ranAt: string;
}

/** POST bodies (validated server-side with zod). Customer id NEVER comes from the client on /api/me/*. */
export type InteractBody =
  | { type: "answer"; momentId: string; optionId?: string; value?: number }
  | { type: "engage"; momentId: string }
  | { type: "dismiss"; momentId: string }
  | { type: "mute"; nodeId: string }
  | { type: "correct"; beliefKey: BeliefKey; verdict: "confirm" | "reject" | "forget"; note?: string }
  | { type: "remove_rule"; ruleId: string };
