// Server-side state: per-customer interaction log (event-sourced) and simulation
// clock. Kept on globalThis so all route bundles share one instance; persisted
// to .data/ so a restart keeps the demo state.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Interaction } from "./types";
import { TIMELINE_DAYS, personas } from "./personas";

const FILE = path.join(process.cwd(), ".data", "interactions.json");

interface StoreShape {
  interactions: Record<string, Interaction[]>;
  simDay: Record<string, number>;
}
const g = globalThis as unknown as { __momentsStore?: StoreShape };

function store(): StoreShape {
  if (!g.__momentsStore) {
    let loaded: StoreShape = { interactions: {}, simDay: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<StoreShape> | null;
      // A damaged file must not turn every request into a crash: fall back to a clean store.
      if (raw && typeof raw === "object" && raw.interactions && typeof raw.interactions === "object" && raw.simDay && typeof raw.simDay === "object") {
        loaded = { interactions: raw.interactions, simDay: raw.simDay };
      }
    } catch { /* first run */ }
    for (const id of personas().keys()) {
      loaded.interactions[id] ??= [];
      loaded.simDay[id] ??= TIMELINE_DAYS - 1;
    }
    g.__momentsStore = loaded;
  }
  return g.__momentsStore;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store()));
  } catch (e) {
    console.error("[store] could not persist", e);
  }
}

export function getInteractions(customerId: string): Interaction[] {
  return store().interactions[customerId] ?? [];
}

export function addInteraction(customerId: string, i: Omit<Interaction, "id">): Interaction {
  const full = { ...i, id: randomUUID().slice(0, 12) } as Interaction;
  const list = store().interactions[customerId];
  list.push(full);
  if (list.length > 500) list.splice(0, list.length - 500);
  save();
  return full;
}

export function resetInteractions(customerId: string) {
  store().interactions[customerId] = [];
  save();
}

export function getSimDay(customerId: string): number {
  return store().simDay[customerId] ?? TIMELINE_DAYS - 1;
}

export function setSimDay(customerId: string, day: number) {
  store().simDay[customerId] = Math.min(TIMELINE_DAYS - 1, Math.max(0, Math.floor(day)));
  save();
}
