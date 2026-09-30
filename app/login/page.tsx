"use client";

import { useEffect, useState, type FormEvent } from "react";

const DEMO_USERS: { username: string; what: string }[] = [
  { username: "analyst", what: "staff control room" },
  { username: "emma", what: "customer app · 24, first job" },
  { username: "sam", what: "customer app · couple saving for a house" },
  { username: "jef", what: "customer app · 71, prefers voice" },
];

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/demo", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((j: { open?: boolean }) => setOpen(Boolean(j.open)))
      .catch(() => setOpen(false));
  }, []);

  async function enter(u: string) {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ username: u }),
      });
      if (res.ok) {
        const j = (await res.json()) as { role?: string };
        window.location.assign(j.role === "staff" ? "/control" : "/app");
        return;
      }
      setError(`Could not open the demo (${res.status}).`);
    } catch {
      setError("Can't reach the server. Is it running?");
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (res.ok) {
        const j = (await res.json()) as { role?: string };
        window.location.assign(j.role === "staff" ? "/control" : "/app");
        return;
      }
      let serverMsg = "";
      try {
        const j = (await res.json()) as { error?: unknown };
        if (typeof j.error === "string") serverMsg = j.error;
      } catch {
        // ignore non-JSON
      }
      if (res.status === 401) setError("Wrong username or password.");
      else if (res.status === 429) setError("Too many attempts. Wait a minute and try again.");
      else if (res.status === 503)
        setError(serverMsg || "The server isn't configured yet: set DEMO_PASSWORD and STAFF_PASSWORD in .env.local.");
      else setError(serverMsg || `Sign-in failed (${res.status}).`);
      setPassword("");
    } catch {
      setError("Can't reach the server. Is it running?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login">
      <div className="login-glow" aria-hidden />
      <div className="login-card">
        <div className="login-brand">
          <img className="brand-mark brand-mark-lg" src="/kairos-logo.svg" alt="" aria-hidden />
          <div>
            <h1>Kairos</h1>
            <p className="login-sub">A bank that earns the right to speak — KBC challenge PoC</p>
          </div>
        </div>

        {open ? (
          <div className="login-hint">
            <div className="login-hint-title">Pick a part of the demo</div>
            <ul>
              {DEMO_USERS.map((u) => (
                <li key={u.username}>
                  <button type="button" className="login-user" disabled={submitting} onClick={() => enter(u.username)} title="Enter the demo as this user">
                    {u.username}
                  </button>
                  <span>{u.what}</span>
                </li>
              ))}
            </ul>
            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}
          </div>
        ) : open === null ? (
          <p className="login-sub">Loading…</p>
        ) : (
          <>
            <form className="login-form" onSubmit={submit} noValidate>
              <label className="field">
                <span>Username</span>
                <input
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  maxLength={64}
                  autoFocus
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  maxLength={200}
                />
              </label>
              {error && (
                <div className="login-error" role="alert">
                  {error}
                </div>
              )}
              <button type="submit" className="btn btn-primary btn-block" disabled={submitting || !username.trim() || !password}>
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <div className="login-hint">
              <div className="login-hint-title">Demo accounts</div>
              <ul>
                {DEMO_USERS.map((u) => (
                  <li key={u.username}>
                    <button type="button" className="login-user" onClick={() => setUsername(u.username)} title="Use this username">
                      {u.username}
                    </button>
                    <span>{u.what}</span>
                  </li>
                ))}
              </ul>
              <div className="login-hint-pw">
                password: see <code>.env.local</code> (<code>DEMO_PASSWORD</code> / <code>STAFF_PASSWORD</code>)
              </div>
            </div>
          </>
        )}
        <p className="login-foot">Synthetic customers and data only.</p>
      </div>
    </main>
  );
}
