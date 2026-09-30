"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomerAppView, InteractBody, Rule } from "@/lib/types";
import Phone from "./Phone";
import { ApiError, Spinner, api, errText, fetchVoice, fmtDate, post, useToast } from "./ui";

export default function CustomerApp() {
  const [view, setView] = useState<CustomerAppView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { push: pushToast, element: toastEl } = useToast();

  // Latest-request-wins: an action result must never be overwritten by an older poll response.
  const seq = useRef(0);
  const busyRef = useRef(false);

  const load = useCallback(async (silent: boolean) => {
    const ticket = ++seq.current;
    try {
      const v = await api<CustomerAppView>("/api/me/state");
      if (ticket === seq.current) {
        setView(v);
        setLoadError(null);
      }
    } catch (e) {
      if (!silent) setLoadError(errText(e));
    }
  }, []);

  useEffect(() => {
    load(false);
    const t = setInterval(() => {
      if (!busyRef.current && document.visibilityState === "visible") load(true);
    }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    busyRef.current = true;
    setBusy(true);
    seq.current++; // invalidate any poll that is still in flight
    try {
      return await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const onInteract = useCallback(
    async (body: InteractBody) => {
      try {
        await run(async () => {
          const v = await post<CustomerAppView>("/api/me/interact", body);
          setView(v);
        });
      } catch (e) {
        pushToast(errText(e));
      }
    },
    [run, pushToast],
  );

  const onAddRule = useCallback(
    async (text: string): Promise<string | null> => {
      try {
        await run(async () => {
          const res = await post<{ rule: Rule; view: CustomerAppView }>("/api/me/rules", { text });
          setView(res.view);
          pushToast(`Rule added: ${res.rule.label}`, "success");
        });
        return null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 422) return e.message || "We couldn't turn that into a rule. Try rephrasing it.";
        return errText(e);
      }
    },
    [run, pushToast],
  );

  const onVoice = useCallback((momentId: string) => fetchVoice("/api/me/voice", momentId), []);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <div className="custapp">
      <header className="custapp-bar">
        <span className="custapp-brand">
          <img className="brand-mark" src="/kairos-logo.svg" alt="" aria-hidden />
          Kairos
        </span>
        <span className="custapp-who">
          {view ? (
            <>
              Signed in as <strong>{view.customer.name}</strong> · simulated date <strong>{fmtDate(view.date)}</strong>
            </>
          ) : (
            "Loading…"
          )}
        </span>
        <button type="button" className="btn btn-ghost-light" onClick={logout}>
          Log out
        </button>
      </header>

      <main className="custapp-main">
        {view ? (
          <Phone
            data={{
              customer: view.customer,
              date: view.date,
              balance: view.balance,
              recentTxns: view.recentTxns,
              feed: view.feed,
              beliefs: view.beliefs,
              rules: view.rules,
              preferredChannel: view.preferredChannel,
            }}
            onInteract={onInteract}
            onAddRule={onAddRule}
            onVoice={onVoice}
            busy={busy}
          />
        ) : loadError ? (
          <div className="custapp-error">
            <p>{loadError}</p>
            <button type="button" className="btn btn-primary" onClick={() => load(false)}>
              Try again
            </button>
          </div>
        ) : (
          <Spinner size={28} label="Opening your app…" />
        )}
      </main>
      {toastEl}
    </div>
  );
}
