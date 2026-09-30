"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Belief, BeliefKey, CustomerSummary, InteractBody, Moment, Rule, Txn } from "@/lib/types";
import MomentCard from "./MomentCard";
import { ConfidenceBar, DOMAIN_LABEL, DOMAIN_ORDER, SourceBadge, Spinner, cx, fmtDay, fmtEUR, fmtLongDate, groupBy } from "./ui";

export interface PhoneData {
  customer: CustomerSummary;
  date: string;
  balance: number;
  recentTxns: Txn[];
  feed: Moment[];
  beliefs: Belief[];
  rules: Rule[];
  preferredChannel: "app" | "voice";
}

interface Props {
  data: PhoneData;
  onInteract(body: InteractBody): Promise<void>;
  onAddRule(text: string): Promise<string | null>;
  onVoice(momentId: string): Promise<Blob | null>;
  busy?: boolean;
  /** Fill the parent's height (control room) instead of a fixed device height. */
  embedded?: boolean;
}

type Tab = "home" | "about" | "rules";

const CATEGORY_LABEL: Record<string, string> = {
  income: "Income",
  housing: "Housing",
  groceries: "Groceries",
  restaurants: "Restaurants",
  transport: "Transport",
  fuel: "Fuel",
  car: "Car",
  pets: "Pets",
  health: "Health",
  utilities: "Utilities",
  subscriptions: "Subscriptions",
  shopping: "Shopping",
  kids: "Kids",
  savings: "Savings",
  family: "Family",
  home: "Home",
  travel: "Travel",
  other: "Other",
};

const RULE_EXAMPLES = [
  "Keep my groceries under €150 a week",
  "Tell me if my balance drops below €500",
  "Warn me about any single payment over €1,000",
];

function greetingName(name: string): string {
  if (name.includes("&")) {
    return name
      .split("&")
      .map((p) => p.trim().split(/\s+/)[0])
      .filter(Boolean)
      .join(" & ");
  }
  return name.trim().split(/\s+/)[0] ?? name;
}

function splitEUR(n: number): [string, string] {
  const s = fmtEUR(n, 2);
  const i = s.lastIndexOf(",");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i)];
}

export default function Phone({ data, onInteract, onAddRule, onVoice, busy, embedded }: Props) {
  const [tab, setTab] = useState<Tab>("home");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  const openCount = data.feed.filter((m) => m.status === "open").length;

  return (
    <div className={cx("phone", embedded && "phone-embedded")}>
      <div className="phone-screen">
        <div className="ph-status" aria-hidden>
          <span>09:41</span>
          <span>KBC · {greetingName(data.customer.name)}</span>
        </div>

        <div className="ph-scroll" ref={scrollRef}>
          {tab === "home" && <HomeTab data={data} onInteract={onInteract} onVoice={onVoice} busy={busy} />}
          {tab === "about" && <AboutTab beliefs={data.beliefs} onInteract={onInteract} busy={busy} />}
          {tab === "rules" && <RulesTab rules={data.rules} onInteract={onInteract} onAddRule={onAddRule} busy={busy} />}
        </div>

        <nav className="ph-tabs" aria-label="App sections">
          <button type="button" className={cx("ph-tab", tab === "home" && "is-active")} onClick={() => setTab("home")}>
            Home
            {openCount > 0 && <span className="ph-tab-badge">{openCount}</span>}
          </button>
          <button type="button" className={cx("ph-tab", tab === "about" && "is-active")} onClick={() => setTab("about")}>
            Understands
          </button>
          <button type="button" className={cx("ph-tab", tab === "rules" && "is-active")} onClick={() => setTab("rules")}>
            My rules
          </button>
        </nav>

        {busy && (
          <div className="ph-busy" aria-live="polite">
            <span className="ph-busy-pill">
              <Spinner size={14} /> Updating…
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Home ----------

function HomeTab({
  data,
  onInteract,
  onVoice,
  busy,
}: {
  data: PhoneData;
  onInteract(body: InteractBody): Promise<void>;
  onVoice(momentId: string): Promise<Blob | null>;
  busy?: boolean;
}) {
  const [euros, cents] = splitEUR(data.balance);
  return (
    <div className="ph-page">
      <div className="ph-balance">
        <div className="ph-label">
          {fmtLongDate(data.date)} · Everyday account
        </div>
        <div className="ph-balance-amt">
          {euros}
          <span>{cents}</span>
        </div>
      </div>
      <div className="ph-quick" aria-hidden>
        <span className="ph-quick-btn is-primary">Pay</span>
        <span className="ph-quick-btn">Transfer</span>
        <span className="ph-quick-btn">Cards</span>
      </div>

      <section className="ph-section">
        <h2 className="ph-section-title">
          For you
          {data.preferredChannel === "voice" && <span className="ph-chip">voice first</span>}
        </h2>
        {data.feed.length === 0 ? (
          <div className="ph-empty">
            <span className="ph-empty-dot" aria-hidden />
            <p>Nothing needs you today.</p>
            <p className="ph-empty-sub">Held back on purpose · see the silence log</p>
          </div>
        ) : (
          <div className="ph-feed">
            {data.feed.map((m) => (
              <MomentCard key={m.candidate.id} moment={m} onInteract={onInteract} onVoice={onVoice} disabled={busy} />
            ))}
          </div>
        )}
      </section>

      <section className="ph-section">
        <h2 className="ph-section-title">Recent</h2>
        {data.recentTxns.length === 0 ? (
          <div className="ph-muted">No transactions yet.</div>
        ) : (
          <ul className="ph-txns">
            {data.recentTxns.slice(0, 20).map((t) => (
              <li key={t.id} className="ph-txn">
                <span className={cx("ph-txn-ico", `cat-${t.category}`)} aria-hidden>
                  {t.merchant.trim()[0]?.toUpperCase() ?? "•"}
                </span>
                <span className="ph-txn-main">
                  <span className="ph-txn-merchant">{t.merchant}</span>
                  <span className="ph-txn-cat">
                    {CATEGORY_LABEL[t.category] ?? t.category} · {fmtDay(t.day)}
                  </span>
                </span>
                <span className={cx("ph-txn-amt", t.amount > 0 && "is-in")}>{fmtEUR(t.amount, 2, true)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------- About me ----------

function AboutTab({
  beliefs,
  onInteract,
  busy,
}: {
  beliefs: Belief[];
  onInteract(body: InteractBody): Promise<void>;
  busy?: boolean;
}) {
  const [pendingKey, setPendingKey] = useState<BeliefKey | null>(null);
  const grouped = useMemo(() => groupBy(beliefs, (b) => b.domain), [beliefs]);
  const domains = DOMAIN_ORDER.filter((d) => grouped.has(d));

  async function correct(b: Belief, verdict: "confirm" | "reject" | "forget") {
    let note: string | undefined;
    if (verdict === "reject") {
      const answer = typeof window !== "undefined" ? window.prompt("What's not right? (optional — helps us learn)", "") : "";
      if (answer === null) return; // cancelled
      note = answer.trim().slice(0, 280) || undefined;
    }
    setPendingKey(b.key);
    try {
      await onInteract({ type: "correct", beliefKey: b.key, verdict, ...(note ? { note } : {}) });
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="ph-page">
      <div className="ph-label">What KBC understands about you</div>
      <h1 className="ph-h1">
        {beliefs.filter((b) => b.status === "active").length} things. You can fix or remove any of them.
      </h1>
      <p className="ph-intro">Everything here can be corrected. What you tell us always beats what we guess.</p>
      <div className="ph-legend">
        <SourceBadge source="bank_data" variant="customer" />
        <SourceBadge source="declared" variant="customer" />
        <SourceBadge source="inferred" variant="customer" />
      </div>

      {beliefs.length === 0 && (
        <div className="ph-empty">
          <p>We don&apos;t assume anything about you yet.</p>
          <p className="ph-empty-sub">As we learn, it shows up here first.</p>
        </div>
      )}

      {domains.map((d) => {
        const list = [...(grouped.get(d) ?? [])].sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active"));
        return (
          <section key={d} className="ph-section">
            <h2 className="ph-section-title ph-domain">{DOMAIN_LABEL[d]}</h2>
            <div className="ph-beliefs">
              {list.map((b) => {
                const off = b.status !== "active";
                const locked = !!busy || pendingKey !== null;
                return (
                  <div key={b.key} className={cx("ph-belief", off && "is-off")}>
                    <div className="ph-belief-top">
                      <SourceBadge source={b.source} variant="customer" />
                      <span className="ph-since">since {fmtDay(b.firstSeenDay, true)}</span>
                    </div>
                    <p className="ph-claim">{b.claim}</p>
                    {!off && b.source !== "declared" && <ConfidenceBar value={b.confidence} />}
                    {b.evidenceSummary && <p className="ph-evidence">{b.evidenceSummary}</p>}
                    {off ? (
                      <div className="ph-belief-off">
                        {b.status === "rejected" ? "You told us this isn't true" : "You asked us not to use this"}
                      </div>
                    ) : (
                      <div className="ph-belief-actions">
                        {b.source !== "declared" && (
                          <button type="button" className="ph-mini ph-mini-yes" disabled={locked} onClick={() => correct(b, "confirm")}>
                            ✓ That&apos;s right
                          </button>
                        )}
                        <button type="button" className="ph-mini ph-mini-no" disabled={locked} onClick={() => correct(b, "reject")}>
                          ✗ Not true
                        </button>
                        <button type="button" className="ph-mini" disabled={locked} onClick={() => correct(b, "forget")}>
                          Don&apos;t use this
                        </button>
                        {pendingKey === b.key && <Spinner size={12} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---------- Rules ----------

function RulesTab({
  rules,
  onInteract,
  onAddRule,
  busy,
}: {
  rules: Rule[];
  onInteract(body: InteractBody): Promise<void>;
  onAddRule(text: string): Promise<string | null>;
  busy?: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = text.trim();
    if (!t || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const err = await onAddRule(t.slice(0, 500));
      if (err) setError(err);
      else setText("");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(ruleId: string) {
    setRemoving(ruleId);
    try {
      await onInteract({ type: "remove_rule", ruleId });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="ph-page">
      <div className="ph-label">My rules</div>
      <h1 className="ph-h1">You decide what KBC watches.</h1>
      <p className="ph-intro">You decide what KBC keeps an eye on. We check these for you and only speak up when one trips.</p>

      {rules.length === 0 ? (
        <div className="ph-empty ph-empty-sm">
          <p>No rules yet.</p>
        </div>
      ) : (
        <ul className="ph-rules">
          {rules.map((r) => (
            <li key={r.id} className="ph-rule">
              <div className="ph-rule-main">
                <span className="ph-rule-label">{r.label}</span>
                <span className="ph-rule-meta">
                  compiled by {r.compiledBy} · since {fmtDay(r.createdDay, true)}
                </span>
                {r.sourceText && r.sourceText !== r.label && <span className="ph-rule-src">“{r.sourceText}”</span>}
              </div>
              <button
                type="button"
                className="ph-mini ph-mini-no"
                disabled={!!busy || removing !== null}
                onClick={() => remove(r.id)}
                aria-label={`Remove rule ${r.label}`}
              >
                {removing === r.id ? <Spinner size={11} /> : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="ph-rule-form" onSubmit={submit}>
        <label htmlFor="rule-text" className="ph-label">
          Tell KBC what to watch for, in your own words
        </label>
        <textarea
          id="rule-text"
          className="ph-textarea"
          rows={3}
          maxLength={500}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Warn me if I spend more than €2,000 a month outside my fixed costs"
          disabled={submitting}
        />
        <div className="ph-suggest">
          {RULE_EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="ph-suggest-chip" onClick={() => setText(ex)} disabled={submitting}>
              {ex}
            </button>
          ))}
        </div>
        {error && (
          <div className="ph-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="p-btn p-btn-primary p-btn-block" disabled={submitting || !!busy || !text.trim()}>
          {submitting ? (
            <>
              <Spinner size={14} /> Understanding your rule…
            </>
          ) : (
            "Add rule"
          )}
        </button>
      </form>
    </div>
  );
}
