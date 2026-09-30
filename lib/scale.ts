// Scale test: runs the SAME watcher code the demo uses over N synthetic
// customers and measures throughput and how often an LLM would be woken up.
import fs from "node:fs";
import path from "node:path";
import type { Category, ScaleResult, Txn } from "./types";
import { TIMELINE_DAYS, dayOfMonth, mulberry32 } from "./personas";
import { createWatcherState, endOfDay, onTxn } from "./watchers";

const RESULT_FILE = path.join(process.cwd(), ".data", "scale-result.json");
const KBC_CUSTOMERS = 2_300_000;
const USD_TO_EUR = 0.92; // approximate, for the projection only
// List prices per million tokens (input/output), assumed ~1,500 in + 300 out per sensemaking call.
const MODELS = [
  { model: "claude-opus-5-5", inUsd: 4, outUsd: 20 },
  { model: "claude-haiku-4-5", inUsd: 1, outUsd: 5 },
];

function syntheticCustomer(i: number, rng: () => number): { txns: Txn[]; balance: number; known: { merchant: string; amount: number; category: Category }[] } {
  const txns: Txn[] = [];
  let n = 0;
  const add = (day: number, amount: number, merchant: string, category: Category) => txns.push({ id: `x${i}-${n++}`, day, amount, merchant, category });
  const salary = 1800 + rng() * 2600;
  const raiseDay = rng() < 0.1 ? Math.floor(rng() * TIMELINE_DAYS) : Infinity;
  const rent = 600 + rng() * 700;
  const subs = 2 + Math.floor(rng() * 4);
  const creepDay = rng() < 0.15 ? 40 + Math.floor(rng() * 120) : Infinity;
  const petDay = rng() < 0.04 ? 30 + Math.floor(rng() * 120) : Infinity;
  const carDay = rng() < 0.03 ? Math.floor(rng() * TIMELINE_DAYS) : Infinity;
  const dupDay = rng() < 0.02 ? 5 + Math.floor(rng() * 170) : Infinity;
  const known = [{ merchant: "rent", amount: rent, category: "housing" as Category }, { merchant: "energy", amount: 120, category: "utilities" as Category }];
  for (let s = 0; s < subs; s++) known.push({ merchant: `sub${s}`, amount: 10 + s * 3, category: "subscriptions" });
  for (let d = 0; d < TIMELINE_DAYS; d++) {
    const dom = dayOfMonth(d);
    if (dom === 25) add(d, d >= raiseDay ? salary * 1.1 : salary, "employer", "income");
    if (dom === 1) add(d, -rent, "rent", "housing");
    if (dom === 8) add(d, -120, "energy", "utilities");
    if (d === dupDay) { add(d, -120, "energy", "utilities"); add(d, -120, "energy", "utilities"); }
    for (let s = 0; s < subs; s++) if (dom === 3 + s * 4) add(d, -(10 + s * 3), `sub${s}`, "subscriptions");
    if (rng() < 2.5 / 7) add(d, -(20 + rng() * 40) * (d >= creepDay ? 1.4 : 1), "supermarket", "groceries");
    if (rng() < 1.2 / 7) add(d, -(12 + rng() * 30), "restaurant", "restaurants");
    if (rng() < 0.6 / 7) add(d, -(15 + rng() * 80), "shop", "shopping");
    if (d >= petDay && (d - petDay) % 30 === 0) add(d, -42, "vet", "pets");
    if (d === carDay) add(d, -(4000 + rng() * 8000), "car dealer", "car");
  }
  return { txns, balance: 2000 + rng() * 6000, known };
}

export function runScale(customers: number): ScaleResult {
  const rng = mulberry32(2026);
  let events = 0;
  let hits = 0;
  const byWatcher: Record<string, number> = {};
  const t0 = performance.now();
  for (let i = 0; i < customers; i++) {
    const c = syntheticCustomer(i, rng);
    const ws = createWatcherState(`x${i}`, c.balance, c.known);
    const history: Txn[] = [];
    let ti = 0;
    for (let d = 0; d < TIMELINE_DAYS; d++) {
      while (ti < c.txns.length && c.txns[ti].day === d) {
        const t = c.txns[ti++];
        events++;
        for (const s of onTxn(ws, t, history.length > 60 ? history.slice(-60) : history)) { hits++; byWatcher[s.kind] = (byWatcher[s.kind] ?? 0) + 1; }
        history.push(t);
      }
      for (const s of endOfDay(ws, d)) { hits++; byWatcher[s.kind] = (byWatcher[s.kind] ?? 0) + 1; }
    }
  }
  const seconds = (performance.now() - t0) / 1000;
  const eventsPerSecond = events / seconds;
  const months = TIMELINE_DAYS / 30.4;
  const hitsPerCustomerPerYear = (hits / customers) * (12 / months);
  const eventsPerCustomer = events / customers;
  const result: ScaleResult = {
    customers,
    days: TIMELINE_DAYS,
    events,
    watcherHits: hits,
    escalationRate: Math.round((hits / customers / months) * 1000) / 1000,
    seconds: Math.round(seconds * 100) / 100,
    eventsPerSecond: Math.round(eventsPerSecond),
    byWatcher,
    projection: {
      customers: KBC_CUSTOMERS,
      hoursForSixMonthsOfEvents: Math.round(((eventsPerCustomer * KBC_CUSTOMERS) / eventsPerSecond / 3600) * 100) / 100,
      llmCallsPerDay: Math.round((hitsPerCustomerPerYear * KBC_CUSTOMERS) / 365),
      costPerCustomerPerYearEUR: MODELS.map((m) => ({
        model: m.model,
        eur: Math.round(hitsPerCustomerPerYear * ((1500 * m.inUsd + 300 * m.outUsd) / 1e6) * USD_TO_EUR * 10000) / 10000,
      })),
    },
    ranAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(RESULT_FILE), { recursive: true });
    fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
  } catch { /* best effort */ }
  return result;
}

export function lastScaleResult(): ScaleResult | null {
  try {
    return JSON.parse(fs.readFileSync(RESULT_FILE, "utf8")) as ScaleResult;
  } catch {
    return null;
  }
}
