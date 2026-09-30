// Synthetic customers. Every transaction is generated from a fixed seed so the
// demo is reproducible. Storylines (a raise, a new pet, a house hunt...) are
// planted on purpose, with random noise around them. No real customer data.
import type { Belief, Category, CustomerSummary, Ledgers, Txn } from "./types";

export const TIMELINE_DAYS = 184; // 2026-03-01 .. 2026-08-31
const START = Date.UTC(2026, 2, 1);
const DAY_MS = 86_400_000;

export function dayToISO(day: number): string {
  return new Date(START + day * DAY_MS).toISOString().slice(0, 10);
}
export function dayOfMonth(day: number): number {
  return new Date(START + day * DAY_MS).getUTCDate();
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface KnownRecurring {
  merchant: string;
  amount: number;
  category: Category;
}

export interface Persona {
  summary: CustomerSummary;
  history: string;
  startBalance: number;
  products: string[];
  appLoginsPerMonth: number;
  preferredChannel: "app" | "voice";
  ledgers: Ledgers;
  knownRecurring: KnownRecurring[]; // standing orders the bank already knows on day 0
  initialBeliefs: Belief[];
  txns: Txn[];
}

class Builder {
  txns: Txn[] = [];
  private n = 0;
  constructor(private prefix: string, readonly rng: () => number) {}

  once(day: number, amount: number, merchant: string, category: Category) {
    if (day < 0 || day >= TIMELINE_DAYS) return;
    this.txns.push({
      id: `${this.prefix}-t${(this.n++).toString(36)}`,
      day,
      amount: Math.round(amount * 100) / 100,
      merchant,
      category,
    });
  }
  monthly(dom: number, amount: number, merchant: string, category: Category, from = 0, to = TIMELINE_DAYS - 1) {
    for (let d = from; d <= to; d++) if (dayOfMonth(d) === dom) this.once(d, amount, merchant, category);
  }
  everyNDays(n: number, offset: number, amount: number, merchant: string, category: Category, from = 0, to = TIMELINE_DAYS - 1) {
    for (let d = from + offset; d <= to; d += n) this.once(d, amount, merchant, category);
  }
  /** `perWeek` random purchases per week, amount uniform in [min,max], optional multiplier from a given day. */
  random(perWeek: number, min: number, max: number, merchants: string[], category: Category, boost?: { from: number; factor: number }) {
    for (let d = 0; d < TIMELINE_DAYS; d++) {
      if (this.rng() < perWeek / 7) {
        const factor = boost && d >= boost.from ? boost.factor : 1;
        const amount = (min + this.rng() * (max - min)) * factor;
        const merchant = merchants[Math.floor(this.rng() * merchants.length)];
        this.once(d, -amount, merchant, category);
      }
    }
  }
  done(): Txn[] {
    return this.txns.sort((a, b) => a.day - b.day || a.id.localeCompare(b.id));
  }
}

function belief(partial: Omit<Belief, "status" | "evidence" | "firstSeenDay" | "lastConfirmedDay"> & { evidence?: string[] }): Belief {
  return { status: "active", evidence: [], firstSeenDay: 0, lastConfirmedDay: 0, ...partial };
}

function emma(): Persona {
  const b = new Builder("emma", mulberry32(11));
  b.monthly(25, 2450, "Brightlane Consulting NV (salary)", "income", 0, 140);
  b.monthly(25, 2780, "Brightlane Consulting NV (salary)", "income", 141); // raise from July
  b.monthly(1, -780, "Residentie Kouter (rent)", "housing");
  b.monthly(8, -95, "Engie", "utilities");
  b.monthly(12, -35, "Proximus", "subscriptions");
  b.monthly(5, -11.99, "Spotify", "subscriptions");
  b.monthly(14, -13.99, "Netflix", "subscriptions");
  b.monthly(3, -29.99, "Basic-Fit", "subscriptions", 31); // new gym membership in April
  b.monthly(2, -49, "NMBS/SNCB season ticket", "transport");
  b.monthly(26, -200, "Transfer to own savings account", "savings");
  b.random(2.2, 24, 44, ["Colruyt", "Delhaize", "Aldi", "Lidl"], "groceries", { from: 61, factor: 1.38 }); // grocery creep from May
  b.random(1.4, 14, 38, ["Pakt Ghent", "Café Labath", "Pizza Pomodoro", "Deliveroo"], "restaurants");
  b.random(0.6, 20, 75, ["Zalando", "HEMA", "Fnac", "IKEA"], "shopping");
  // Toy-shop purchases: gifts for a nephew, but a model could read "has a child" (low confidence)
  b.once(64, -58, "Dreamland (toys)", "kids");
  b.once(75, -49, "Dreamland (toys)", "kids");
  b.once(112, -39, "Dreamland (toys)", "kids");
  // A puppy arrives in June: vet visit, monthly care plan, pet shop
  b.once(93, -85, "Dierenkliniek Artevelde", "pets");
  b.monthly(4, -42, "Dierenkliniek Artevelde (care plan)", "pets", 95);
  b.once(98, -29, "Tom&Co", "pets");
  b.once(129, -44, "Tom&Co", "pets");
  b.once(161, -37, "Tom&Co", "pets");
  // A second-hand car in late July, then weekly fuel
  b.once(150, -6400, "Autocenter Gent (used car)", "car");
  b.everyNDays(7, 2, -58, "TotalEnergies", "fuel", 150);
  return {
    summary: { id: "c_emma", name: "Emma Claes", age: 24, city: "Ghent", tagline: "24 · first job · rents" },
    history: "Active app user since her student account. Engaged with 4 of her last 5 tips; never dismissed an offer.",
    startBalance: 4700,
    products: ["current_account", "savings_account", "debit_card"],
    appLoginsPerMonth: 38,
    preferredChannel: "app",
    ledgers: { trust: 0.62, attentionBudget: 2, attentionUsed: 0, muted: [] },
    knownRecurring: [
      { merchant: "Residentie Kouter (rent)", amount: 780, category: "housing" },
      { merchant: "Engie", amount: 95, category: "utilities" },
      { merchant: "Proximus", amount: 35, category: "subscriptions" },
      { merchant: "Spotify", amount: 11.99, category: "subscriptions" },
      { merchant: "Netflix", amount: 13.99, category: "subscriptions" },
      { merchant: "NMBS/SNCB season ticket", amount: 49, category: "transport" },
      { merchant: "Transfer to own savings account", amount: 200, category: "savings" },
    ],
    initialBeliefs: [],
    txns: b.done(),
  };
}

function samNoor(): Persona {
  const b = new Builder("sam", mulberry32(22));
  b.monthly(25, 3100, "Nexora NV (salary Sam)", "income");
  b.monthly(25, 2850, "AZ Sint-Jan (salary Noor)", "income");
  b.monthly(1, -1150, "Immo Zuid (rent)", "housing");
  b.monthly(10, -165, "Luminus", "utilities");
  b.monthly(12, -65, "Telenet", "subscriptions");
  b.monthly(14, -13.99, "Netflix", "subscriptions");
  b.monthly(18, -8.99, "Disney+", "subscriptions");
  b.monthly(15, -52, "KBC car insurance", "car");
  b.monthly(26, -900, "Transfer to joint savings account", "savings", 0, 60);
  b.monthly(26, -1500, "Transfer to joint savings account", "savings", 61); // saving much harder from May
  b.random(3, 28, 62, ["Colruyt", "Delhaize", "Carrefour", "Albert Heijn"], "groceries");
  b.random(1.6, 18, 60, ["Otomat", "Le Pain Quotidien", "Deliveroo", "Sushi Shop"], "restaurants");
  b.random(1, 45, 70, ["Q8", "Shell"], "fuel");
  b.random(0.5, 25, 120, ["Coolblue", "Zara", "Decathlon", "Brico"], "shopping");
  // Same puppy storyline, same days as Emma: the "same event, two customers" demo
  b.once(93, -92, "Dierenkliniek Ter Linde", "pets");
  b.monthly(4, -42, "Dierenkliniek Ter Linde (care plan)", "pets", 95);
  b.once(98, -31, "Tom&Co", "pets");
  b.once(129, -46, "Tom&Co", "pets");
  // House hunt: inspection and notary provision in July
  b.once(138, -650, "Vastgoedkeuring BV (home inspection)", "home");
  b.once(140, -1200, "Notaris Van Damme (provision)", "home");
  return {
    summary: { id: "c_sam", name: "Sam & Noor Peeters", age: 31, city: "Antwerp", tagline: "31 & 30 · couple · saving hard" },
    history: "Before March they dismissed 3 commercial suggestions in a row (credit card upgrade, travel insurance, investment fund). Trust starts low.",
    startBalance: 6800,
    products: ["current_account", "joint_account", "savings_account", "debit_card", "credit_card", "car_insurance"],
    appLoginsPerMonth: 22,
    preferredChannel: "app",
    ledgers: { trust: 0.45, attentionBudget: 1.5, attentionUsed: 0, muted: [] },
    knownRecurring: [
      { merchant: "Immo Zuid (rent)", amount: 1150, category: "housing" },
      { merchant: "Luminus", amount: 165, category: "utilities" },
      { merchant: "Telenet", amount: 65, category: "subscriptions" },
      { merchant: "Netflix", amount: 13.99, category: "subscriptions" },
      { merchant: "Disney+", amount: 8.99, category: "subscriptions" },
      { merchant: "KBC car insurance", amount: 52, category: "car" },
      { merchant: "Transfer to joint savings account", amount: 900, category: "savings" },
    ],
    initialBeliefs: [
      belief({
        key: "mobility.car",
        domain: "mobility",
        claim: "Owns a car, insured at KBC",
        source: "bank_data",
        confidence: 1,
        evidenceSummary: "Active KBC car insurance policy",
        by: "bank",
      }),
    ],
    txns: b.done(),
  };
}

function jef(): Persona {
  const b = new Builder("jef", mulberry32(33));
  b.monthly(1, 1980, "Federale Pensioendienst (pension)", "income");
  b.monthly(9, -145, "Luminus", "utilities", 0, 91);
  b.monthly(9, -208, "Luminus", "utilities", 92); // new energy contract from June: +43%
  b.monthly(15, -38, "De Watergroep", "utilities");
  b.monthly(20, -89, "Fluvius (network costs)", "utilities");
  b.once(51, -89, "Fluvius (network costs)", "utilities"); // debited twice in April
  b.monthly(12, -42, "Proximus", "subscriptions");
  b.random(2, 18, 38, ["Delhaize", "Bakkerij Janssens", "Colruyt"], "groceries");
  b.random(0.5, 18, 30, ["Apotheek Hasselt Centrum"], "health", { from: 40, factor: 2.6 }); // rising pharmacy costs
  b.random(0.4, 20, 45, ["Brasserie De Markt"], "restaurants");
  b.once(130, -5000, "Transfer to K. Peeters (grandchild)", "family");
  return {
    summary: { id: "c_jef", name: "Jef Vermeulen", age: 71, city: "Hasselt", tagline: "71 · retired · prefers a call" },
    history: "Logs into the app about once a quarter; called his branch 4 times this year. Prefers to be spoken to, briefly.",
    startBalance: 14200,
    products: ["current_account", "savings_account", "home_insurance"],
    appLoginsPerMonth: 0.3,
    preferredChannel: "voice",
    ledgers: { trust: 0.68, attentionBudget: 1, attentionUsed: 0, muted: [] },
    knownRecurring: [
      { merchant: "Luminus", amount: 145, category: "utilities" },
      { merchant: "De Watergroep", amount: 38, category: "utilities" },
      { merchant: "Fluvius (network costs)", amount: 89, category: "utilities" },
      { merchant: "Proximus", amount: 42, category: "subscriptions" },
    ],
    initialBeliefs: [
      belief({
        key: "channel.prefers_voice",
        domain: "channel",
        claim: "Prefers to be contacted by voice rather than in the app",
        source: "bank_data",
        confidence: 0.9,
        evidenceSummary: "1 app login in the last 3 months, 4 calls to the branch this year",
        by: "bank",
      }),
    ],
    txns: b.done(),
  };
}

let cache: Map<string, Persona> | null = null;

export function personas(): Map<string, Persona> {
  if (!cache) {
    cache = new Map();
    for (const p of [emma(), samNoor(), jef()]) cache.set(p.summary.id, p);
  }
  return cache;
}

export function getPersona(id: string): Persona | undefined {
  return personas().get(id);
}

export function customerSummaries(): CustomerSummary[] {
  return [...personas().values()].map((p) => p.summary);
}
