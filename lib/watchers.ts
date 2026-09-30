// Deterministic watchers: cheap, predictable checks that run on every event for
// every customer. An LLM is only woken up when one of these fires.
// Shared by the demo engine and by scripts/scale.ts (same code, measured at scale).
import type { Category, Signal, Txn } from "./types";
import { TIMELINE_DAYS } from "./personas";

const SHIFT_EXCLUDED: Category[] = ["income", "housing", "savings", "family", "car", "home"];
const VARIABLE: Category[] = ["groceries", "restaurants", "shopping", "fuel", "health", "kids", "travel"];
const CATEGORIES: Category[] = [
  "income", "housing", "groceries", "restaurants", "transport", "fuel", "car", "pets", "health",
  "utilities", "subscriptions", "shopping", "kids", "savings", "family", "home", "travel", "other",
];

interface MerchantTrack {
  firstDay: number;
  lastDay: number;
  lastAmount: number;
  recurring: boolean;
  category: Category;
}

export interface WatcherState {
  customerId: string;
  balance: number;
  merchants: Map<string, MerchantTrack>;
  lastIncome: Map<string, number>;
  lastSavings: number | null;
  spend: Map<Category, Float64Array>; // money out per category per day
  lastShift: Map<Category, number>;
  lastLowBuffer: number;
  seq: number;
}

export function createWatcherState(customerId: string, balance: number, known: { merchant: string; amount: number; category: Category }[]): WatcherState {
  const merchants = new Map<string, MerchantTrack>();
  for (const k of known) merchants.set(k.merchant, { firstDay: 0, lastDay: -30, lastAmount: -k.amount, recurring: true, category: k.category });
  const spend = new Map<Category, Float64Array>();
  for (const c of CATEGORIES) spend.set(c, new Float64Array(TIMELINE_DAYS));
  return {
    customerId, balance, merchants, lastIncome: new Map(), lastSavings: null, spend,
    lastShift: new Map(), lastLowBuffer: -999, seq: 0,
  };
}

function sig(s: WatcherState, day: number, kind: Signal["kind"], summary: string, data: Signal["data"], evidence: string[]): Signal {
  return { id: `${s.customerId}-s${day}-${kind}-${(s.seq++).toString(36)}`, day, kind, summary, data, evidence };
}

const eur = (n: number) => `€${Math.round(Math.abs(n)).toLocaleString("en-US")}`;

/** Runs on every transaction. Returns zero or more signals. */
export function onTxn(s: WatcherState, t: Txn, history: Txn[]): Signal[] {
  const out: Signal[] = [];
  s.balance += t.amount;
  if (t.amount < 0) s.spend.get(t.category)![t.day] += -t.amount;

  // income change (per payer)
  if (t.category === "income") {
    const prev = s.lastIncome.get(t.merchant);
    if (prev !== undefined && Math.abs(t.amount - prev) / prev > 0.05) {
      const pct = Math.round(((t.amount - prev) / prev) * 100);
      out.push(sig(s, t.day, "income_change", `Income from ${t.merchant} changed ${pct > 0 ? "+" : ""}${pct}% (${eur(prev)} → ${eur(t.amount)})`,
        { merchant: t.merchant, previous: prev, current: t.amount, pct, direction: pct > 0 ? "up" : "down" }, [t.id]));
    }
    s.lastIncome.set(t.merchant, t.amount);
    return out;
  }

  // savings change
  if (t.category === "savings") {
    const prev = s.lastSavings;
    if (prev !== null && -t.amount > -prev * 1.3) {
      const pct = Math.round(((t.amount - prev) / prev) * 100);
      out.push(sig(s, t.day, "savings_change", `Monthly savings transfer up ${pct}% (${eur(prev)} → ${eur(t.amount)})`,
        { previous: -prev, current: -t.amount, pct, direction: "up" }, [t.id]));
    }
    s.lastSavings = t.amount;
  }

  const m = s.merchants.get(t.merchant);
  // duplicate payment: same merchant, same amount, within 2 days
  if (m && t.amount < 0 && Math.abs(m.lastAmount - t.amount) < 0.01 && t.day - m.lastDay <= 2) {
    out.push(sig(s, t.day, "duplicate_payment", `${t.merchant} debited twice (${eur(t.amount)}) within ${t.day - m.lastDay || "the same"} day(s)`,
      { merchant: t.merchant, amount: -t.amount, category: t.category }, [
        ...history.filter((h) => h.merchant === t.merchant && h.day === m.lastDay).map((h) => h.id), t.id,
      ]));
    s.merchants.set(t.merchant, { ...m, lastDay: t.day });
    return out;
  }

  // new recurring payment: second payment ~monthly with a similar amount
  // (variable spending like groceries or shopping is never a commitment)
  if (m && !m.recurring && t.amount < 0 && !VARIABLE.includes(t.category)) {
    const gap = t.day - m.lastDay;
    const similar = Math.abs(t.amount - m.lastAmount) <= Math.abs(m.lastAmount) * 0.25;
    if (gap >= 26 && gap <= 35 && similar) {
      m.recurring = true;
      out.push(sig(s, t.day, "new_recurring", `New recurring payment: ${t.merchant} ${eur(t.amount)}/month`,
        { merchant: t.merchant, amount: -t.amount, category: t.category },
        history.filter((h) => h.merchant === t.merchant).map((h) => h.id).concat(t.id)));
    }
  }

  // large one-off
  if (t.amount <= -1000 && !(m && m.recurring)) {
    out.push(sig(s, t.day, "large_one_off", `Large one-off payment: ${eur(t.amount)} to ${t.merchant}`,
      { merchant: t.merchant, amount: -t.amount, category: t.category }, [t.id]));
  }

  s.merchants.set(t.merchant, { firstDay: m?.firstDay ?? t.day, lastDay: t.day, lastAmount: t.amount, recurring: m?.recurring ?? false, category: t.category });
  return out;
}

/** Runs once per customer per day, after that day's transactions. */
export function endOfDay(s: WatcherState, day: number): Signal[] {
  const out: Signal[] = [];

  if (s.balance < 400 && day - s.lastLowBuffer > 20) {
    s.lastLowBuffer = day;
    out.push(sig(s, day, "low_buffer", `Balance dropped to ${eur(s.balance)}`, { balance: Math.round(s.balance) }, []));
  }

  // category shift, checked weekly
  if (day >= 56 && day % 7 === 0) {
    for (const [cat, arr] of s.spend) {
      if (SHIFT_EXCLUDED.includes(cat)) continue;
      const last = s.lastShift.get(cat);
      if (last !== undefined && day - last < 45) continue;
      let recent = 0;
      for (let d = day - 29; d <= day; d++) recent += arr[d];
      const baseFrom = Math.max(0, day - 89);
      let base = 0;
      for (let d = baseFrom; d < day - 29; d++) base += arr[d];
      const baseDays = day - 29 - baseFrom;
      const baseline = baseDays > 0 ? (base / baseDays) * 30 : 0;
      const established = baseline >= 20;
      const fires = established
        ? recent > baseline * 1.25 && recent - baseline >= 45
        : recent >= 95; // spending in a category that barely existed before
      if (fires) {
        s.lastShift.set(cat, day);
        const pct = established ? Math.round(((recent - baseline) / baseline) * 100) : 0;
        out.push(sig(s, day, "category_shift",
          established
            ? `${cat} spending up ${pct}% (last 30 days ${eur(recent)} vs usual ${eur(baseline)})`
            : `New spending on ${cat}: ${eur(recent)} in 30 days`,
          { category: cat, recent: Math.round(recent), baseline: Math.round(baseline), pct, direction: "up", newCategory: established ? 0 : 1 },
          []));
      }
    }
  }
  return out;
}

/** 30-day spend per category ending at `day` (for the facts tier and rules). */
export function spendWindow(s: WatcherState, day: number, days: number): Partial<Record<Category, number>> {
  const out: Partial<Record<Category, number>> = {};
  for (const [cat, arr] of s.spend) {
    let sum = 0;
    for (let d = Math.max(0, day - days + 1); d <= day; d++) sum += arr[d];
    if (sum > 0) out[cat] = Math.round(sum);
  }
  return out;
}
