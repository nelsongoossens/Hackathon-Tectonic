"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { BeliefSource, Domain, GateOutcome, SilenceReason } from "@/lib/types";

// ---------- dates ----------

const DAY_MS = 86_400_000;
const DAY0_UTC = Date.UTC(2026, 2, 1); // day 0 = 2026-03-01
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function dayToISO(day: number): string {
  return new Date(DAY0_UTC + Math.round(day) * DAY_MS).toISOString().slice(0, 10);
}

function parseISO(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** "12 Mar 2026" (or "12 Mar" with withYear=false). */
export function fmtDate(iso: string, withYear = true): string {
  const d = parseISO(iso);
  if (!d) return iso ?? "";
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withYear ? `${base} ${d.getUTCFullYear()}` : base;
}

/** "Thursday 12 March" style long date for the phone greeting. */
export function fmtLongDate(iso: string): string {
  const d = parseISO(iso);
  if (!d) return iso ?? "";
  const longMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${longMonths[d.getUTCMonth()]}`;
}

export function fmtDay(day: number, withYear = false): string {
  return fmtDate(dayToISO(day), withYear);
}

/** Month starts (Mar..Aug...) as simulation days, up to maxDay. */
export function monthTicks(maxDay: number): { day: number; label: string }[] {
  const out: { day: number; label: string }[] = [];
  for (let m = 0; m < 24; m++) {
    const t = Date.UTC(2026, 2 + m, 1);
    const day = Math.round((t - DAY0_UTC) / DAY_MS);
    if (day > maxDay) break;
    out.push({ day, label: MONTHS[new Date(t).getUTCMonth()] });
  }
  return out;
}

// ---------- numbers ----------

/** Belgian style money: "€ 1.234" / "−€ 45,50". */
export function fmtEUR(n: number, decimals = 0, signed = false): string {
  if (!Number.isFinite(n)) return "€ –";
  const neg = n < 0;
  const [int, frac] = Math.abs(n).toFixed(decimals).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = frac ? `${grouped},${frac}` : grouped;
  const sign = neg ? "−" : signed && n > 0 ? "+" : "";
  return `${sign}€ ${body}`;
}

export function fmtPct(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "–";
  return `${(n * 100).toFixed(decimals)}%`;
}

export function fmtNum(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "–";
  const [int, frac] = Math.abs(n).toFixed(decimals).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "−" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

export function fmtSigned(n: number, decimals = 2): string {
  if (!Number.isFinite(n) || n === 0) return (0).toFixed(decimals);
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(decimals)}`;
}

// ---------- labels ----------

export const DOMAIN_LABEL: Record<Domain, string> = {
  income_wealth: "Income & wealth",
  housing: "Home",
  mobility: "Getting around",
  household: "Household",
  commitments: "Commitments",
  goals: "Goals",
  habits: "Habits",
  health: "Health",
  channel: "How you like to hear from us",
};

export const DOMAIN_ORDER: Domain[] = [
  "income_wealth",
  "goals",
  "household",
  "housing",
  "mobility",
  "commitments",
  "habits",
  "health",
  "channel",
];

export const REASON_LABEL: Record<SilenceReason, string> = {
  CATEGORY_MUTED: "Customer muted this",
  DECLARED_CONTRADICTS: "Customer told us otherwise",
  RECENTLY_SHOWN: "Recently shown",
  LOW_CONFIDENCE: "Not sure enough",
  EARN_NOTHING_TEST: "Fails the earn-nothing test",
  TRUST_TOO_LOW: "Trust too low",
  BELOW_THRESHOLD: "Not worth the interruption",
  BUDGET_EXHAUSTED: "Attention budget used up",
};

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function groupBy<T, K extends string>(items: T[], key: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return map;
}

// ---------- small components ----------

const SOURCE_LABEL: Record<"customer" | "staff", Record<BeliefSource, string>> = {
  customer: { bank_data: "bank data", declared: "you told us", inferred: "we think" },
  staff: { bank_data: "bank data", declared: "declared", inferred: "inferred" },
};

export function SourceBadge({ source, variant = "staff" }: { source: BeliefSource; variant?: "customer" | "staff" }) {
  return (
    <span className={`badge src-${source}`} title={`Source: ${source.replace("_", " ")}`}>
      {SOURCE_LABEL[variant][source]}
    </span>
  );
}

const OUTCOME_LABEL: Record<GateOutcome, string> = { shown: "Shown", advisor: "Advisor", silenced: "Silenced" };

export function OutcomeChip({ outcome }: { outcome: GateOutcome }) {
  return (
    <span className={`outcome outcome-${outcome}`}>
      <span className="outcome-dot" aria-hidden />
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

export function ConfidenceBar({ value, label = true, width }: { value: number; label?: boolean; width?: number }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const tone = v >= 0.75 ? "hi" : v >= 0.5 ? "mid" : "lo";
  return (
    <span className="conf" title={`Confidence ${fmtPct(v)}`}>
      <span className="conf-track" style={width ? { width } : undefined}>
        <span className={`conf-fill conf-${tone}`} style={{ width: `${v * 100}%` }} />
      </span>
      {label && <span className="conf-num">{fmtPct(v)}</span>}
    </span>
  );
}

export function ValueBar({ value, tone = "accent", label }: { value: number; tone?: "accent" | "kbc" | "urgency"; label?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <span className="vbar">
      {label && <span className="vbar-label">{label}</span>}
      <span className="vbar-track">
        <span className={`vbar-fill vbar-${tone}`} style={{ width: `${v * 100}%` }} />
      </span>
      <span className="vbar-num">{v.toFixed(2)}</span>
    </span>
  );
}

export function Pill({
  children,
  tone = "default",
  title,
  mono,
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "green" | "amber" | "red" | "purple" | "slate" | "blue" | "pink";
  title?: string;
  mono?: boolean;
}) {
  return (
    <span className={cx("pill", `pill-${tone}`, mono && "mono")} title={title}>
      {children}
    </span>
  );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" style={{ width: size, height: size }} aria-hidden />
      {label ? <span className="spinner-label">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

// ---------- toasts ----------

export type ToastTone = "error" | "info" | "success";
interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

export function useToast() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (text: string, tone: ToastTone = "error") => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-3), { id, text, tone }]);
      timers.current.push(setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500));
    },
    [dismiss],
  );

  const element = (
    <div className="toasts" aria-live="assertive">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
          <span>{t.text}</span>
          <button type="button" className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );

  return { push, element };
}

// ---------- API ----------

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

function goToLogin() {
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const j: unknown = await res.json();
    if (j && typeof j === "object" && "error" in j) {
      const e = (j as { error: unknown }).error;
      if (typeof e === "string" && e) return e;
    }
  } catch {
    // not JSON
  }
  if (res.status === 429) return "Too many requests. Slow down a little.";
  if (res.status === 403) return "Not allowed for this role.";
  if (res.status >= 500) return `Server error (${res.status}).`;
  return `Request failed (${res.status}).`;
}

type ApiInit = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit | null };

function buildInit(init?: ApiInit): RequestInit {
  const { json, headers: h, ...rest } = init ?? {};
  const headers = new Headers(h);
  let body = rest.body;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }
  return { ...rest, body, headers, credentials: "same-origin", cache: "no-store" };
}

/** Same-origin JSON fetch. Throws ApiError on non-OK; redirects to /login on 401. */
export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const res = await fetch(path, buildInit(init));
  if (res.status === 401) {
    goToLogin();
    throw new ApiError(401, "Your session ended. Please sign in again.");
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return (await res.json()) as T;
}

export function post<T>(path: string, json: unknown = {}): Promise<T> {
  return api<T>(path, { method: "POST", json });
}

/** POST for audio. Returns the mp3 Blob, or null when server voice is off (caller falls back to speechSynthesis). */
export async function fetchVoice(path: string, momentId: string): Promise<Blob | null> {
  try {
    const res = await fetch(path, buildInit({ method: "POST", json: { momentId } }));
    if (res.status === 401) {
      goToLogin();
      return null;
    }
    if (!res.ok) return null;
    const type = res.headers.get("Content-Type") ?? "";
    if (!type.startsWith("audio/")) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
