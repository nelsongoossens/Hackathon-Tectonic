"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type {
  AdvisorItem,
  Belief,
  CompareView,
  CustomerSummary,
  HardCondition,
  InteractBody,
  Moment,
  Rule,
  ScaleResult,
  ServiceNode,
  StaffView,
} from "@/lib/types";
import LedgerChart from "./LedgerChart";
import Phone, { type PhoneData } from "./Phone";
import {
  ApiError,
  ConfidenceBar,
  DOMAIN_LABEL,
  DOMAIN_ORDER,
  OutcomeChip,
  Pill,
  REASON_LABEL,
  SourceBadge,
  Spinner,
  ValueBar,
  api,
  cx,
  dayToISO,
  errText,
  fetchVoice,
  fmtDate,
  fmtDay,
  fmtEUR,
  fmtNum,
  fmtPct,
  fmtSigned,
  groupBy,
  monthTicks,
  post,
  sleep,
  useToast,
} from "./ui";

type OverlayKind = "compare" | "advisor" | "graph" | "scale";
type GateTab = "decisions" | "silence" | "ledgers";

const LS_KEY = "moments.control.customer";
const STEP_DAYS = 3;
const STEP_PAUSE_MS = 350;
const THUMB_PX = 16; // must match .tl-range thumb width in globals.css

const base = (id: string) => `/api/staff/customers/${encodeURIComponent(id)}`;

/** Position a label under a range input so it lines up with the thumb centre. */
function thumbLeft(day: number, maxDay: number): string {
  const f = maxDay > 0 ? Math.max(0, Math.min(1, day / maxDay)) : 0;
  return `calc(${(f * 100).toFixed(3)}% + ${(THUMB_PX / 2 - f * THUMB_PX).toFixed(2)}px)`;
}

export default function ControlRoom() {
  const { push: pushToast, element: toastEl } = useToast();
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<StaffView | null>(null);
  const [sliderDay, setSliderDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [actions, setActions] = useState(0); // in-flight phone actions
  const [syncs, setSyncs] = useState(0); // in-flight state/day requests
  const [overlay, setOverlay] = useState<OverlayKind | null>(null);
  const [gateTab, setGateTab] = useState<GateTab>("decisions");

  const seq = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accept = useCallback((ticket: number, v: StaffView) => {
    if (ticket !== seq.current || v.customer.id !== selectedRef.current) return;
    setView(v);
    if (debounceRef.current === null) setSliderDay(v.day);
  }, []);

  /** Runs a request that returns a StaffView for the selected customer. Latest request wins. */
  const runView = useCallback(
    async (fn: (id: string) => Promise<StaffView>, kind: "sync" | "action"): Promise<StaffView | null> => {
      const id = selectedRef.current;
      if (!id) return null;
      const ticket = ++seq.current;
      const bump = kind === "action" ? setActions : setSyncs;
      bump((n) => n + 1);
      try {
        const v = await fn(id);
        accept(ticket, v);
        return v;
      } catch (e) {
        pushToast(errText(e));
        return null;
      } finally {
        bump((n) => Math.max(0, n - 1));
      }
    },
    [accept, pushToast],
  );

  const stopPlay = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
  }, []);

  // ---- load customers once ----
  useEffect(() => {
    let alive = true;
    api<{ customers: CustomerSummary[] }>("/api/staff/customers")
      .then((r) => {
        if (!alive) return;
        setCustomers(r.customers);
        let remembered: string | null = null;
        try {
          remembered = window.localStorage.getItem(LS_KEY);
        } catch {
          remembered = null;
        }
        const pick = r.customers.find((c) => c.id === remembered)?.id ?? r.customers[0]?.id ?? null;
        setSelectedId(pick);
      })
      .catch((e) => pushToast(errText(e)));
    return () => {
      alive = false;
    };
  }, [pushToast]);

  // ---- load the selected customer's view ----
  useEffect(() => {
    selectedRef.current = selectedId;
    playingRef.current = false;
    setPlaying(false);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (!selectedId) return;
    try {
      window.localStorage.setItem(LS_KEY, selectedId);
    } catch {
      // storage unavailable: not important
    }
    void runView((id) => api<StaffView>(`${base(id)}/state`), "sync");
  }, [selectedId, runView]);

  useEffect(
    () => () => {
      playingRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const postDay = useCallback(
    (day: number) => runView((id) => post<StaffView>(`${base(id)}/day`, { day }), "sync"),
    [runView],
  );

  function onSlide(day: number) {
    stopPlay();
    setSliderDay(day);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void postDay(day);
    }, 150);
  }

  async function startPlay() {
    if (!view || playingRef.current) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const maxDay = view.maxDay;
    const id = selectedRef.current;
    let d = sliderDay >= maxDay ? -STEP_DAYS : sliderDay; // at the end: restart from day 0
    playingRef.current = true;
    setPlaying(true);
    while (playingRef.current && selectedRef.current === id) {
      d = Math.min(maxDay, d + STEP_DAYS);
      setSliderDay(d);
      const v = await postDay(d);
      if (!v || !playingRef.current || d >= maxDay) break;
      await sleep(STEP_PAUSE_MS);
    }
    playingRef.current = false;
    setPlaying(false);
  }

  async function resetCustomer() {
    if (!view) return;
    const ok = window.confirm(
      `Reset ${view.customer.name}?\n\nThis clears every simulated interaction (answers, dismissals, mutes, corrections and rules added in the demo).`,
    );
    if (!ok) return;
    stopPlay();
    const v = await runView((id) => post<StaffView>(`${base(id)}/reset`, {}), "action");
    if (v) pushToast(`${v.customer.name} reset to a clean slate`, "success");
  }

  // ---- phone callbacks (simulated customer reactions) ----
  const onInteract = useCallback(
    async (body: InteractBody) => {
      await runView((id) => post<StaffView>(`${base(id)}/interact`, body), "action");
    },
    [runView],
  );

  const onAddRule = useCallback(
    async (text: string): Promise<string | null> => {
      const id = selectedRef.current;
      if (!id) return "No customer selected.";
      const ticket = ++seq.current;
      setActions((n) => n + 1);
      try {
        const r = await post<{ rule: Rule; view: StaffView }>(`${base(id)}/rules`, { text });
        accept(ticket, r.view);
        pushToast(`Rule compiled (${r.rule.compiledBy}): ${r.rule.label}`, "success");
        return null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 422) return e.message;
        return errText(e);
      } finally {
        setActions((n) => Math.max(0, n - 1));
      }
    },
    [accept, pushToast],
  );

  const onVoice = useCallback((momentId: string) => {
    const id = selectedRef.current;
    return id ? fetchVoice(`${base(id)}/voice`, momentId) : Promise.resolve(null);
  }, []);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.assign("/login");
    }
  }

  const phoneData: PhoneData | null = useMemo(() => {
    if (!view) return null;
    const feed = view.moments
      .filter((m) => m.decision.outcome === "shown")
      .sort((a, b) => b.candidate.day - a.candidate.day)
      .slice(0, 20);
    return {
      customer: view.customer,
      date: view.date,
      balance: view.facts.balance,
      recentTxns: view.recentTxns,
      feed,
      beliefs: view.beliefs,
      rules: view.rules,
      preferredChannel: view.facts.preferredChannel,
    };
  }, [view]);

  const maxDay = Math.max(1, view?.maxDay ?? 183);
  const c = view?.counters;

  return (
    <div className="cr">
      {/* ---------- top bar ---------- */}
      <header className="cr-top">
        <div className="cr-brand">
          <span className="brand-mark" aria-hidden>
            M
          </span>
          <span>
            <span className="cr-brand-name">Moments</span>
            <span className="cr-brand-sub">understanding layer behind Kate</span>
          </span>
        </div>
        <div className="cust-tabs" role="tablist" aria-label="Customer">
          {customers.map((cu) => (
            <button
              key={cu.id}
              type="button"
              role="tab"
              aria-selected={cu.id === selectedId}
              className={cx("cust-tab", cu.id === selectedId && "is-active")}
              onClick={() => setSelectedId(cu.id)}
              title={`${cu.name}, ${cu.age} · ${cu.city} · ${cu.tagline}`}
            >
              <span className="cust-tab-name">
                {cu.name} <span className="cust-tab-age">{cu.age}</span>
              </span>
              <span className="cust-tab-tag">{cu.tagline}</span>
            </button>
          ))}
        </div>
        <nav className="cr-nav">
          <button type="button" className="btn btn-nav" onClick={() => setOverlay("compare")}>
            Same event, two customers
          </button>
          <button type="button" className="btn btn-nav" onClick={() => setOverlay("advisor")}>
            Advisor queue
          </button>
          <button type="button" className="btn btn-nav" onClick={() => setOverlay("graph")}>
            Service graph
          </button>
          <button type="button" className="btn btn-nav" onClick={() => setOverlay("scale")}>
            Scale
          </button>
        </nav>
        <button type="button" className="btn btn-ghost" onClick={logout}>
          Log out
        </button>
      </header>

      {/* ---------- timeline ---------- */}
      <section className="cr-timeline">
        <div className="tl-date">
          <div className="tl-date-big">{fmtDate(dayToISO(sliderDay))}</div>
          <div className="tl-date-sub">
            day {sliderDay} of {maxDay}
            {syncs > 0 && <Spinner size={11} />}
          </div>
        </div>
        <button
          type="button"
          className={cx("btn btn-play", playing && "is-playing")}
          onClick={playing ? stopPlay : startPlay}
          disabled={!view}
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <div className="tl-track">
          <div className="tl-marks" aria-hidden>
            {view?.moments.map((m) => (
              <span
                key={m.candidate.id}
                className={`tl-mark tl-mark-${m.decision.outcome}`}
                style={{ left: thumbLeft(m.candidate.day, maxDay) }}
              />
            ))}
          </div>
          <input
            type="range"
            className="tl-range"
            min={0}
            max={maxDay}
            step={1}
            value={Math.min(sliderDay, maxDay)}
            onChange={(e) => onSlide(Number(e.target.value))}
            disabled={!view}
            aria-label="Simulation day"
            style={{ "--tl-fill": `${(Math.min(sliderDay, maxDay) / maxDay) * 100}%` } as CSSProperties}
          />
          <div className="tl-ticks" aria-hidden>
            {monthTicks(maxDay).map((t) => (
              <span key={t.day} style={{ left: thumbLeft(t.day, maxDay) }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={resetCustomer} disabled={!view || actions > 0}>
          Reset customer
        </button>
        <div className="funnel" title="Candidate moments proposed by the service graph vs. what the attention gate let through">
          <div className="funnel-cell">
            <b>{c ? c.candidates : "–"}</b>
            <span>candidates</span>
          </div>
          <div className="funnel-arrow" aria-hidden>
            →
          </div>
          <div className="funnel-cell funnel-shown">
            <b>{c ? c.shown : "–"}</b>
            <span>shown</span>
          </div>
          <div className="funnel-cell funnel-advisor">
            <b>{c ? c.advisor : "–"}</b>
            <span>advisor</span>
          </div>
          <div className="funnel-cell funnel-silenced">
            <b>{c ? c.silenced : "–"}</b>
            <span>silenced</span>
          </div>
        </div>
      </section>

      {/* ---------- counters ---------- */}
      <section className="cr-counters">
        <Counter label="events processed" value={c ? fmtNum(c.events) : "–"} />
        <Counter label="watcher hits" value={c ? fmtNum(c.watcherHits) : "–"} />
        <Counter
          label="LLM calls"
          value={
            c ? (
              <>
                {c.llmCalls} <em>live</em> · {c.llmCached} <em>cached</em> · {c.heuristic} <em>heuristic</em>
              </>
            ) : (
              "–"
            )
          }
        />
        <span className="cr-spacer" />
        {view && (
          <>
            <span className={cx("mode-badge", view.llm.mode === "live" ? "mode-live" : "mode-off")}>
              <i />
              {view.llm.mode === "live" ? `LLM live · ${view.llm.model ?? "model"}` : "LLM offline · heuristics"}
            </span>
            <span className={cx("mode-badge", view.voice.enabled ? "mode-live" : "mode-off")}>
              <i />
              {view.voice.enabled ? "Voice · server TTS" : "Voice · browser fallback"}
            </span>
          </>
        )}
      </section>

      {/* ---------- three columns ---------- */}
      <main className="cr-cols">
        <section className="col-phone">
          <div className="col-label">Customer&apos;s phone — actions here are simulated</div>
          <div className="col-phone-inner">
            {phoneData ? (
              <Phone
                data={phoneData}
                onInteract={onInteract}
                onAddRule={onAddRule}
                onVoice={onVoice}
                busy={actions > 0}
                embedded
              />
            ) : (
              <div className="phone phone-embedded phone-skeleton">
                <Spinner size={22} label="Replaying…" />
              </div>
            )}
          </div>
        </section>

        {view ? <ClientModel view={view} /> : <PanelSkeleton title="Client model" />}
        {view ? <GatePanel view={view} tab={gateTab} setTab={setGateTab} /> : <PanelSkeleton title="Attention gate" />}
      </main>

      {overlay === "compare" && <CompareOverlay onClose={() => setOverlay(null)} />}
      {overlay === "advisor" && <AdvisorOverlay onClose={() => setOverlay(null)} />}
      {overlay === "graph" && <GraphOverlay onClose={() => setOverlay(null)} />}
      {overlay === "scale" && <ScaleOverlay onClose={() => setOverlay(null)} />}
      {toastEl}
    </div>
  );
}

// =====================================================================
// Small pieces
// =====================================================================

function Counter({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="counter">
      <b>{value}</b>
      <span>{label}</span>
    </span>
  );
}

function PanelSkeleton({ title }: { title: string }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
      </header>
      <div className="panel-body panel-center">
        <Spinner size={20} label="Loading…" />
      </div>
    </section>
  );
}

function ScoreLine({ m }: { m: Moment }) {
  const d = m.decision;
  const pass = d.score >= d.threshold;
  return (
    <span className="score-line">
      score <b className={pass ? "is-pass" : "is-fail"}>{d.score.toFixed(2)}</b> / threshold {d.threshold.toFixed(2)}
    </span>
  );
}

function ErrorBox({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="error-box">
      <span>{text}</span>
      {onRetry && (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// =====================================================================
// Column 2: client model
// =====================================================================

const RECURRING_PREVIEW = 6;

function ClientModel({ view }: { view: StaffView }) {
  const f = view.facts;
  const [allRecurring, setAllRecurring] = useState(false);
  const recurring = useMemo(() => [...view.facts.recurring].sort((a, b) => b.amount - a.amount), [view.facts.recurring]);
  const shownRecurring = allRecurring ? recurring : recurring.slice(0, RECURRING_PREVIEW);
  const grouped = useMemo(() => groupBy(view.beliefs, (b) => b.domain), [view.beliefs]);
  const domains = DOMAIN_ORDER.filter((d) => grouped.has(d));
  const active = view.beliefs.filter((b) => b.status === "active").length;
  const signals = [...view.signals].sort((a, b) => b.day - a.day);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Client model</h2>
        <span className="panel-sub">{view.customer.name} · what the bank knows vs. what it understands</span>
      </header>
      <div className="panel-body">
        <div className="tier">
          <div className="tier-head">
            <span className="tier-tag tier-facts">Facts tier</span>
            <span className="tier-note">derived by code from bank data</span>
          </div>
          <div className="facts-grid">
            <Fact k="Age" v={String(f.age)} />
            <Fact k="City" v={f.city} />
            <Fact k="Monthly income" v={fmtEUR(f.monthlyIncome)} />
            <Fact k="Fixed costs" v={fmtEUR(f.fixedCosts)} />
            <Fact k="Balance" v={fmtEUR(f.balance)} />
            <Fact k="Preferred channel" v={f.preferredChannel === "voice" ? "Voice" : "App"} />
            <Fact k="App logins / month" v={String(f.appLoginsPerMonth)} />
            <Fact k="Products" v={String(f.products.length)} />
          </div>
          {f.products.length > 0 && (
            <div className="facts-products">
              {f.products.map((p) => (
                <Pill key={p}>{p}</Pill>
              ))}
            </div>
          )}
          <div className="mini-head">
            Recurring commitments{recurring.length > 0 && ` · ${recurring.length} · ${fmtEUR(recurring.reduce((t, r) => t + r.amount, 0))}/mo`}
          </div>
          {recurring.length === 0 ? (
            <div className="muted small">None detected yet.</div>
          ) : (
            <>
              <ul className="rec-list">
                {shownRecurring.map((r) => (
                  <li key={r.key}>
                    <span className="rec-merchant">{r.merchant}</span>
                    <span className="rec-meta">
                      {r.category} · since {fmtDay(r.sinceDay)}
                    </span>
                    <span className="rec-amt">{fmtEUR(r.amount)}/mo</span>
                  </li>
                ))}
              </ul>
              {recurring.length > RECURRING_PREVIEW && (
                <button type="button" className="link-btn" onClick={() => setAllRecurring((v) => !v)}>
                  {allRecurring ? "Show fewer" : `Show all ${recurring.length}`}
                </button>
              )}
            </>
          )}
          {view.history && (
            <div className="history-note">
              <b>Before the timeline:</b> {view.history}
            </div>
          )}
        </div>

        <div className="tier">
          <div className="tier-head">
            <span className="tier-tag tier-und">Understanding tier</span>
            <span className="tier-note">
              {active} active · declared &gt; bank data &gt; inferred
            </span>
          </div>
          {view.beliefs.length === 0 && <div className="muted small">No beliefs yet. Move the timeline forward.</div>}
          {domains.map((d) => (
            <div key={d} className="domain-group">
              <div className="domain-title">{d === "channel" ? "Channel" : DOMAIN_LABEL[d]}</div>
              {(grouped.get(d) ?? []).map((b) => (
                <BeliefRow key={b.key} b={b} today={view.day} />
              ))}
            </div>
          ))}
        </div>

        <div className="tier">
          <div className="tier-head">
            <span className="tier-tag tier-sig">Watcher signals</span>
            <span className="tier-note">deterministic, no LLM · {signals.length}</span>
          </div>
          {signals.length === 0 ? (
            <div className="muted small">No watcher has fired yet.</div>
          ) : (
            <ul className="sig-list">
              {signals.slice(0, 60).map((s) => (
                <li key={s.id} className={cx(view.day - s.day <= 3 && "is-fresh")}>
                  <span className="sig-date">{fmtDay(s.day)}</span>
                  <span className="sig-kind">{s.kind}</span>
                  <span className="sig-sum">{s.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="fact">
      <span className="fact-k">{k}</span>
      <span className="fact-v">{v}</span>
    </div>
  );
}

function BeliefRow({ b, today }: { b: Belief; today: number }) {
  const off = b.status !== "active";
  return (
    <div className={cx("belief", off && "is-off", !off && today - b.lastConfirmedDay <= 3 && "is-fresh")}>
      <div className="belief-top">
        <span className="belief-claim">{b.claim}</span>
        <SourceBadge source={b.source} />
      </div>
      <div className="belief-mid">
        <ConfidenceBar value={b.confidence} width={96} />
        <span className="belief-by">by {b.by}</span>
        {off && <Pill tone={b.status === "rejected" ? "red" : "slate"}>{b.status}</Pill>}
      </div>
      {b.evidenceSummary && <div className="belief-ev">{b.evidenceSummary}</div>}
      <div className="belief-dates">
        <span className="mono">{b.key}</span> · first seen {fmtDay(b.firstSeenDay)} · last confirmed {fmtDay(b.lastConfirmedDay)} ·{" "}
        {b.evidence.length} evidence
      </div>
    </div>
  );
}

// =====================================================================
// Column 3: attention gate
// =====================================================================

function GatePanel({ view, tab, setTab }: { view: StaffView; tab: GateTab; setTab: (t: GateTab) => void }) {
  const moments = useMemo(() => [...view.moments].sort((a, b) => b.candidate.day - a.candidate.day), [view.moments]);
  const silenced = useMemo(() => moments.filter((m) => m.decision.outcome === "silenced"), [moments]);

  return (
    <section className="panel">
      <header className="panel-head panel-head-tabs">
        <h2>Attention gate</h2>
        <div className="seg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "decisions"} className={cx(tab === "decisions" && "is-active")} onClick={() => setTab("decisions")}>
            Decisions <span className="seg-count">{moments.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "silence"} className={cx(tab === "silence" && "is-active")} onClick={() => setTab("silence")}>
            Silence log <span className="seg-count">{silenced.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "ledgers"} className={cx(tab === "ledgers" && "is-active")} onClick={() => setTab("ledgers")}>
            Ledgers
          </button>
        </div>
      </header>
      <div className="panel-body">
        {tab === "decisions" && <Decisions moments={moments} today={view.day} />}
        {tab === "silence" && <SilenceLog silenced={silenced} total={moments.length} />}
        {tab === "ledgers" && <LedgersTab view={view} />}
      </div>
    </section>
  );
}

function Decisions({ moments, today }: { moments: Moment[]; today: number }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (moments.length === 0) {
    return <div className="empty-panel">No candidate moments yet. The gate has nothing to decide.</div>;
  }
  return (
    <ul className="dec-list">
      {moments.map((m) => {
        const c = m.candidate;
        const d = m.decision;
        const open = openId === c.id;
        return (
          <li key={c.id} className={cx("dec", `dec-${d.outcome}`, open && "is-open", today - c.day <= 2 && "is-fresh")}>
            <button type="button" className="dec-summary" onClick={() => setOpenId(open ? null : c.id)} aria-expanded={open}>
              <span className="dec-line1">
                <OutcomeChip outcome={d.outcome} />
                <span className="dec-date">{fmtDay(c.day)}</span>
                <span className="dec-node">{c.nodeName}</span>
                {c.commercial ? <Pill tone="pink">commercial</Pill> : <Pill tone="green">help</Pill>}
                {c.customerRequested && <Pill tone="blue">customer rule</Pill>}
                <span className="cr-spacer" />
                <ScoreLine m={m} />
              </span>
              <span className="dec-title">{c.title}</span>
              <span className="dec-reason">
                {d.reason && <code className="reason-code">{d.reason}</code>}
                {d.reasonText}
              </span>
            </button>
            {open && <DecisionDetail m={m} />}
          </li>
        );
      })}
    </ul>
  );
}

function DecisionDetail({ m }: { m: Moment }) {
  const c = m.candidate;
  const d = m.decision;
  const b = d.breakdown;
  return (
    <div className="dec-detail">
      <div className="formula">
        <span>
          value <b>{b.value.toFixed(2)}</b>
        </span>
        <i>×</i>
        <span>
          confidence <b>{b.confidence.toFixed(2)}</b>
        </span>
        <i>×</i>
        <span>
          urgency <b>{b.urgency.toFixed(2)}</b>
        </span>
        <i>−</i>
        <span>
          interruption cost <b>{b.interruptionCost.toFixed(2)}</b>
        </span>
        <i>=</i>
        <span className="formula-total">
          <b>{d.score.toFixed(2)}</b>
        </span>
        <span className="formula-vs">
          {d.score >= d.threshold ? "≥" : "<"} threshold {d.threshold.toFixed(2)}
        </span>
      </div>
      <div className="dec-values">
        <ValueBar label="customer value" value={c.customerValue} />
        <ValueBar label="KBC value" value={c.kbcValue} tone="kbc" />
      </div>
      <div className="dec-meta">
        <span>
          channel <b>{d.channel}</b>
        </span>
        <span>
          trust at decision <b>{d.trustAtDecision.toFixed(2)}</b>
        </span>
        <span>
          attention left <b>{d.attentionLeft.toFixed(1)}</b>
        </span>
        <span>
          status <b>{m.status}</b>
        </span>
        <span>
          copy by <b>{c.copyBy}</b>
        </span>
        <span>
          guardrail <b>{c.guardrail === "advisor" ? "advisor only" : "self-serve"}</b>
        </span>
      </div>
      <div className="mini-head">Why — provenance trace</div>
      <ol className="why-trace">
        {c.why.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ol>
      <div className="dec-copy">
        <span className="mini-head">Copy that would be shown</span>
        <p>{c.body}</p>
      </div>
    </div>
  );
}

function SilenceLog({ silenced, total }: { silenced: Moment[]; total: number }) {
  const [filter, setFilter] = useState<string | null>(null);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of silenced) {
      const r = m.decision.reason ?? "UNSPECIFIED";
      map.set(r, (map.get(r) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [silenced]);
  const rows = filter ? silenced.filter((m) => (m.decision.reason ?? "UNSPECIFIED") === filter) : silenced;

  return (
    <div className="silence">
      <div className="silence-hero">
        <div className="silence-kicker">Silence log</div>
        <div className="silence-title">What we chose NOT to say</div>
        <div className="silence-sub">
          {silenced.length} of {total} candidate moments held back — every one with a reason. Restraint you can audit.
        </div>
        <div className="reason-chips">
          <button type="button" className={cx("reason-chip", !filter && "is-active")} onClick={() => setFilter(null)}>
            all <b>{silenced.length}</b>
          </button>
          {counts.map(([r, n]) => (
            <button
              key={r}
              type="button"
              className={cx("reason-chip", filter === r && "is-active")}
              onClick={() => setFilter(filter === r ? null : r)}
              title={REASON_LABEL[r as keyof typeof REASON_LABEL] ?? r}
            >
              <code>{r}</code> <b>{n}</b>
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-panel">Nothing silenced yet. Every candidate so far was worth saying.</div>
      ) : (
        <ul className="sil-list">
          {rows.map((m) => {
            const c = m.candidate;
            const d = m.decision;
            return (
              <li key={c.id} className="sil-row">
                <div className="sil-top">
                  <span className="sil-date">{fmtDay(c.day)}</span>
                  <span className="sil-node">{c.nodeName}</span>
                  {c.commercial && <Pill tone="pink">commercial</Pill>}
                  <span className="cr-spacer" />
                  <code className="reason-code">{d.reason ?? "UNSPECIFIED"}</code>
                </div>
                <div className="sil-title">{c.title}</div>
                <div className="sil-reason">{d.reasonText}</div>
                <div className="sil-meta">
                  <ScoreLine m={m} /> · trust {d.trustAtDecision.toFixed(2)} · attention left {d.attentionLeft.toFixed(1)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LedgersTab({ view }: { view: StaffView }) {
  const l = view.ledgers;
  const nodeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of view.moments) map.set(m.candidate.nodeId, m.candidate.nodeName);
    return map;
  }, [view.moments]);

  return (
    <div className="ledgers">
      <div className="ledger-stats">
        <div className="lstat">
          <span className="lstat-k">Trust</span>
          <span className="lstat-v lstat-trust">{l.trust.toFixed(2)}</span>
          <span className="lstat-s">offers need more of it</span>
        </div>
        <div className="lstat">
          <span className="lstat-k">Attention</span>
          <span className="lstat-v lstat-attn">{l.attentionBudget.toFixed(1)}</span>
          <span className="lstat-s">interruptions / week</span>
        </div>
        <div className="lstat">
          <span className="lstat-k">Used this week</span>
          <span className="lstat-v">
            {fmtNum(l.attentionUsed, Number.isInteger(l.attentionUsed) ? 0 : 1)}
            <small> / {l.attentionBudget.toFixed(1)}</small>
          </span>
          <span className="lstat-s">{l.attentionUsed >= l.attentionBudget ? "budget exhausted" : "room left"}</span>
        </div>
        <div className="lstat">
          <span className="lstat-k">Muted</span>
          <span className="lstat-v">{l.muted.length}</span>
          <span className="lstat-s">{l.muted.length ? l.muted.map((id) => nodeNames.get(id) ?? id).join(", ") : "nothing muted"}</span>
        </div>
      </div>
      <LedgerChart points={view.ledgerHistory} currentDay={view.day} maxDay={view.maxDay} />
      <div className="mini-head">Ledger events</div>
      {view.ledgerEvents.length === 0 ? (
        <div className="muted small">No reactions yet. Trust and attention move when the customer engages, dismisses or mutes.</div>
      ) : (
        <ul className="lev-list">
          {view.ledgerEvents.map((e, i) => (
            <li key={`${e.day}-${i}`}>
              <span className="lev-date">{fmtDay(e.day)}</span>
              <span className="lev-what">{e.what}</span>
              <span className={cx("lev-delta", e.trustDelta > 0 ? "is-up" : e.trustDelta < 0 ? "is-down" : "is-zero")}>
                trust {fmtSigned(e.trustDelta, 2)}
              </span>
              <span className={cx("lev-delta", e.attentionDelta > 0 ? "is-up" : e.attentionDelta < 0 ? "is-down" : "is-zero")}>
                attention {fmtSigned(e.attentionDelta, 1)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// Overlays
// =====================================================================

function Overlay({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ov-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ov" role="dialog" aria-modal="true" aria-label={title}>
        <header className="ov-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="ov-sub">{sub}</div>}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            Close ✕
          </button>
        </header>
        <div className="ov-body">{children}</div>
      </div>
    </div>
  );
}

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    api<T>(path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(errText(e)));
    return () => {
      alive = false;
    };
  }, [path, n]);
  return { data, error, retry: () => setN((x) => x + 1), setData };
}

function CompareOverlay({ onClose }: { onClose: () => void }) {
  const { data, error, retry } = useLoad<CompareView>("/api/staff/compare");
  return (
    <Overlay title="Same event, two customers" sub="One injected event, replayed through each customer's own model and ledgers." onClose={onClose}>
      {error ? (
        <ErrorBox text={error} onRetry={retry} />
      ) : !data ? (
        <div className="ov-center">
          <Spinner size={22} label="Replaying the event for each customer…" />
        </div>
      ) : (
        <div className="cmp">
          <div className="cmp-hero">
            <div className="cmp-headline">Same event. Different relationship. Different outcome.</div>
            <div className="cmp-event">
              <Pill tone="accent">event</Pill> {data.event} · {fmtDate(data.date)}
            </div>
          </div>
          <div className="cmp-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, data.rows.length)}, minmax(0, 1fr))` }}>
            {data.rows.map((r) => (
              <div key={r.customer.id} className="cmp-col">
                <div className="cmp-who">
                  <div className="cmp-name">
                    {r.customer.name}, {r.customer.age}
                  </div>
                  <div className="cmp-tag">
                    {r.customer.city} · {r.customer.tagline}
                  </div>
                </div>
                <div className="cmp-trust">
                  <span>Trust at that moment</span>
                  <b>{r.trust.toFixed(2)}</b>
                  <ConfidenceBar value={r.trust} label={false} width={140} />
                </div>
                {r.moments.length === 0 ? (
                  <div className="muted small">No candidate moment for this customer.</div>
                ) : (
                  r.moments.map((m) => (
                    <div key={m.candidate.id} className={cx("cmp-moment", `dec-${m.decision.outcome}`)}>
                      <div className="cmp-m-top">
                        <OutcomeChip outcome={m.decision.outcome} />
                        <span className="dec-node">{m.candidate.nodeName}</span>
                        {m.candidate.commercial && <Pill tone="pink">commercial</Pill>}
                      </div>
                      <div className={cx("cmp-m-title", m.decision.outcome === "silenced" && "is-silenced")}>{m.candidate.title}</div>
                      <div className="cmp-m-reason">
                        {m.decision.reason && <code className="reason-code">{m.decision.reason}</code>}
                        {m.decision.reasonText}
                      </div>
                      <div className="cmp-m-meta">
                        <ScoreLine m={m} /> · channel {m.decision.channel}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Overlay>
  );
}

function AdvisorOverlay({ onClose }: { onClose: () => void }) {
  const { data, error, retry } = useLoad<{ items: AdvisorItem[] }>("/api/staff/advisor");
  return (
    <Overlay
      title="Advisor queue"
      sub="Moments the gate may not deliver on its own — regulated or high-stakes advice goes to a human, with the full context."
      onClose={onClose}
    >
      {error ? (
        <ErrorBox text={error} onRetry={retry} />
      ) : !data ? (
        <div className="ov-center">
          <Spinner size={22} label="Loading queue…" />
        </div>
      ) : data.items.length === 0 ? (
        <div className="empty-panel">The advisor queue is empty.</div>
      ) : (
        <div className="adv-grid">
          {data.items.map((it) => {
            const c = it.moment.candidate;
            return (
              <div key={`${it.customer.id}-${c.id}`} className="adv-card">
                <div className="adv-top">
                  <span className="adv-who">
                    {it.customer.name}, {it.customer.age}
                  </span>
                  <span className="muted small">{fmtDay(c.day, true)}</span>
                  <span className="cr-spacer" />
                  <OutcomeChip outcome={it.moment.decision.outcome} />
                </div>
                <div className="adv-node">
                  {c.nodeName} {c.commercial && <Pill tone="pink">commercial</Pill>} <Pill tone="amber">status: {it.moment.status}</Pill>
                </div>
                <div className="adv-title">{c.title}</div>
                <p className="adv-body">{c.body}</p>
                <div className="adv-guard">
                  <span className="mini-head">Why a human</span>
                  <p>{it.moment.decision.reasonText}</p>
                </div>
                <ol className="why-trace">
                  {c.why.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </Overlay>
  );
}

const BRANCH_LABEL: Record<ServiceNode["branch"], string> = {
  budgeting: "Budgeting",
  home: "Home",
  mobility: "Mobility",
  pets: "Pets",
  savings: "Savings",
  investing: "Investing",
  protection: "Protection",
  daily: "Daily banking",
};

function fmtHard(h: HardCondition): string {
  switch (h.type) {
    case "age_min":
      return `age ≥ ${h.value}`;
    case "not_product":
      return `doesn't already hold ${h.product}`;
    case "income_min":
      return `income ≥ ${fmtEUR(h.value)}/mo`;
    case "belief":
      return `belief ${h.key} ≥ ${fmtPct(h.minConfidence)} confidence`;
  }
}

function fmtTrigger(t: ServiceNode["triggers"][number]): string {
  const parts: string[] = [];
  if (t.watcher) parts.push(t.watcher);
  if (t.category) parts.push(t.category);
  if (t.direction) parts.push(t.direction === "up" ? "↑ up" : "↓ down");
  if (t.belief) parts.push(`belief ${t.belief}`);
  return parts.join(" · ") || "any";
}

function NodeList({ label, items, ordered }: { label: string; items: string[]; ordered?: boolean }) {
  if (items.length === 0) return null;
  const L = ordered ? "ol" : "ul";
  return (
    <div className="node-sec">
      <div className="node-sec-k">{label}</div>
      <L className="node-sec-list">
        {items.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </L>
    </div>
  );
}

function GraphOverlay({ onClose }: { onClose: () => void }) {
  const { data, error, retry } = useLoad<{ nodes: ServiceNode[] }>("/api/staff/graph");
  const names = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n.name] as const)), [data]);
  const branches = useMemo(() => groupBy(data?.nodes ?? [], (n) => n.branch), [data]);
  const rel = (ids: string[]) => ids.map((id) => names.get(id) ?? id);

  return (
    <Overlay
      title="Service graph"
      sub="Curated by KBC, not generated. Agents can only propose what's in here — hard conditions are checked by code before any LLM sees a node."
      onClose={onClose}
    >
      {error ? (
        <ErrorBox text={error} onRetry={retry} />
      ) : !data ? (
        <div className="ov-center">
          <Spinner size={22} label="Loading graph…" />
        </div>
      ) : (
        <div className="graph">
          {[...branches.entries()].map(([branch, nodes]) => (
            <section key={branch} className="graph-branch">
              <h3 className="graph-branch-title">
                {BRANCH_LABEL[branch] ?? branch} <span className="muted">{nodes.length}</span>
              </h3>
              <div className="graph-grid">
                {nodes.map((n) => (
                  <article key={n.id} className="node-card">
                    <div className="node-top">
                      <span className="node-name">{n.name}</span>
                      <span className="node-id mono">{n.id}</span>
                    </div>
                    <div className="node-pills">
                      <Pill>{n.kind}</Pill>
                      {n.commercial ? <Pill tone="pink">commercial</Pill> : <Pill tone="green">non-commercial</Pill>}
                      <Pill tone={n.guardrail === "advisor" ? "amber" : "blue"}>{n.guardrail === "advisor" ? "advisor only" : "self-serve"}</Pill>
                      <Pill tone="slate" mono>
                        {n.component.type}
                      </Pill>
                    </div>
                    {n.guardrailNote && <div className="node-note">{n.guardrailNote}</div>}
                    <div className="node-bars">
                      <ValueBar label="customer" value={n.customerValue} />
                      <ValueBar label="KBC" value={n.kbcValue} tone="kbc" />
                      <ValueBar label="urgency" value={n.urgency} tone="urgency" />
                    </div>
                    <NodeList label="Triggers" items={n.triggers.map(fmtTrigger)} />
                    <NodeList label="Hard conditions" items={n.hard.map(fmtHard)} />
                    <NodeList label="Soft signals" items={n.soft} />
                    {(n.requires.length > 0 || n.unlocks.length > 0 || n.conflicts.length > 0) && (
                      <div className="node-rel">
                        {n.requires.length > 0 && (
                          <span>
                            <em>requires</em> {rel(n.requires).join(", ")}
                          </span>
                        )}
                        {n.unlocks.length > 0 && (
                          <span>
                            <em>unlocks</em> {rel(n.unlocks).join(", ")}
                          </span>
                        )}
                        {n.conflicts.length > 0 && (
                          <span>
                            <em>conflicts</em> {rel(n.conflicts).join(", ")}
                          </span>
                        )}
                      </div>
                    )}
                    <NodeList label="Procedure" items={n.procedure} ordered />
                    <NodeList label="Degrees of freedom" items={n.freedoms} />
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Overlay>
  );
}

function ScaleOverlay({ onClose }: { onClose: () => void }) {
  const { data, error, retry, setData } = useLoad<{ result: ScaleResult | null }>("/api/staff/scale");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const r = data?.result ?? null;

  async function run() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await post<{ result: ScaleResult }>("/api/staff/scale", { customers: 10000 });
      setData({ result: res.result });
    } catch (e) {
      setRunError(errText(e));
    } finally {
      setRunning(false);
    }
  }

  const byWatcher = r ? Object.entries(r.byWatcher).sort((a, b) => b[1] - a[1]) : [];
  const maxW = byWatcher.length ? Math.max(...byWatcher.map(([, n]) => n), 1) : 1;

  return (
    <Overlay
      title="Scale"
      sub="Deterministic watchers run on every event for every customer. The LLM only wakes up when one fires."
      onClose={onClose}
    >
      {error ? (
        <ErrorBox text={error} onRetry={retry} />
      ) : !data ? (
        <div className="ov-center">
          <Spinner size={22} label="Loading last run…" />
        </div>
      ) : (
        <div className="scale">
          <div className="scale-actions">
            <button type="button" className="btn btn-primary" onClick={run} disabled={running}>
              {running ? (
                <>
                  <Spinner size={14} /> Running 10,000 customers…
                </>
              ) : (
                "Run 10,000 customers"
              )}
            </button>
            <span className="muted small">
              For a bigger run: <code>npm run scale -- --customers 100000</code>
            </span>
            {r && <span className="muted small scale-ran">last run {r.ranAt.replace("T", " ").slice(0, 16)}</span>}
          </div>
          {runError && <ErrorBox text={runError} />}
          {!r ? (
            <div className="empty-panel">No scale run yet. Run one — it takes about ten seconds.</div>
          ) : (
            <>
              <div className="big-grid">
                <Big k="synthetic customers" v={fmtNum(r.customers)} />
                <Big k={`events over ${r.days} days`} v={fmtNum(r.events)} />
                <Big k="events / second" v={fmtNum(r.eventsPerSecond)} accent />
                <Big k="watcher hits" v={fmtNum(r.watcherHits)} />
                <Big k="escalation rate" v={r.escalationRate.toFixed(2)} sub="hits / customer / month" />
                <Big k="wall time" v={`${r.seconds.toFixed(1)} s`} />
              </div>
              <div className="scale-cols">
                <div className="scale-card">
                  <div className="mini-head">Watcher hits by kind</div>
                  <ul className="wbars">
                    {byWatcher.map(([k, n]) => (
                      <li key={k}>
                        <span className="wbar-k mono">{k}</span>
                        <span className="wbar-track">
                          <span className="wbar-fill" style={{ width: `${(n / maxW) * 100}%` }} />
                        </span>
                        <span className="wbar-n">{fmtNum(n)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="scale-card scale-proj">
                  <div className="mini-head">Projection to {fmtNum(r.projection.customers)} customers</div>
                  <div className="proj-grid">
                    <Big k="hours for 6 months of events" v={r.projection.hoursForSixMonthsOfEvents.toFixed(1)} />
                    <Big k="LLM calls / day" v={fmtNum(r.projection.llmCallsPerDay)} />
                  </div>
                  <table className="cost-table">
                    <thead>
                      <tr>
                        <th>Model</th>
                        <th>Cost / customer / year</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.projection.costPerCustomerPerYearEUR.map((row) => (
                        <tr key={row.model}>
                          <td className="mono">{row.model}</td>
                          <td>€ {row.eur < 0.01 ? row.eur.toFixed(4) : row.eur.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Overlay>
  );
}

function Big({ k, v, sub, accent }: { k: string; v: string; sub?: string; accent?: boolean }) {
  return (
    <div className={cx("big", accent && "big-accent")}>
      <span className="big-v">{v}</span>
      <span className="big-k">{k}</span>
      {sub && <span className="big-s">{sub}</span>}
    </div>
  );
}
