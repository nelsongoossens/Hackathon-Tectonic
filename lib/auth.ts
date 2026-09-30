// Authentication and authorization. Demo users are synthetic; passwords come from
// the environment (never from the repo). The customer id ALWAYS comes from the
// server-side session, never from the request.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export type Role = "staff" | "customer";
export interface User {
  username: string;
  role: Role;
  name: string;
  customerId?: string;
}
interface Session extends User {
  expires: number;
}

export const SESSION_COOKIE = "moments_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const USERS: User[] = [
  { username: "analyst", role: "staff", name: "KBC analyst" },
  { username: "emma", role: "customer", name: "Emma Claes", customerId: "c_emma" },
  { username: "sam", role: "customer", name: "Sam & Noor Peeters", customerId: "c_sam" },
  { username: "jef", role: "customer", name: "Jef Vermeulen", customerId: "c_jef" },
];

interface AuthGlobal {
  sessions: Map<string, Session>;
  salt: Buffer;
  limits: Map<string, { count: number; reset: number }>;
}
const g = globalThis as unknown as { __momentsAuth?: AuthGlobal };
function st(): AuthGlobal {
  g.__momentsAuth ??= { sessions: new Map(), salt: randomBytes(16), limits: new Map() };
  return g.__momentsAuth;
}

function passwordFor(role: Role): string | null {
  const p = role === "staff" ? process.env.STAFF_PASSWORD : process.env.DEMO_PASSWORD;
  return p && p.length >= 10 ? p : null;
}

export function authConfigured(): boolean {
  return Boolean(passwordFor("staff") && passwordFor("customer"));
}

/**
 * Keyed digest so two strings of different length can be compared in constant
 * time. Passwords are never stored, so no slow KDF is needed: a slow hash here
 * would only hand an unauthenticated caller a cheap way to burn server CPU.
 */
function digest(p: string): Buffer {
  return createHmac("sha256", st().salt).update(p).digest();
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** Returns the user on success, null on bad credentials. Constant-time comparison. */
export function verifyLogin(username: string, password: string): User | null {
  const user = USERS.find((u) => u.username === normalizeUsername(username));
  const expected = passwordFor(user?.role ?? "customer");
  const ok = expected !== null && timingSafeEqual(digest(password), digest(expected));
  return user && ok ? user : null;
}

export function createSession(user: User): string {
  const token = randomBytes(32).toString("base64url");
  const s = st();
  s.sessions.set(token, { ...user, expires: Date.now() + SESSION_TTL_MS });
  if (s.sessions.size > 1000) {
    const now = Date.now();
    for (const [k, v] of s.sessions) if (v.expires < now) s.sessions.delete(k);
  }
  return token;
}

export function destroySession(token: string | undefined) {
  if (token) st().sessions.delete(token);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = st().sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) {
    st().sessions.delete(token);
    return null;
  }
  return { username: s.username, role: s.role, name: s.name, customerId: s.customerId };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Rejects cross-site state-changing requests (defence in depth on top of SameSite=strict). */
export function checkOrigin(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return jsonError(403, "Cross-origin request refused");
    } catch {
      return jsonError(403, "Bad origin");
    }
  }
  return null;
}

/**
 * Key that identifies the caller for unauthenticated rate limits. Forwarded
 * headers are only believed behind a proxy that sets them (TRUST_PROXY=1);
 * otherwise anyone could pick a fresh "IP" per request and bypass the limit.
 */
export function clientKey(req: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd.slice(0, 64);
  }
  return "shared";
}

const MAX_LIMIT_KEYS = 10_000;

/** Fixed-window rate limit. Returns true when the call is allowed. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const limits = st().limits;
  const now = Date.now();
  const e = limits.get(key);
  if (!e || e.reset < now) {
    if (!e && limits.size >= MAX_LIMIT_KEYS) {
      for (const [k, v] of limits) if (v.reset < now) limits.delete(k);
      // Still full: attacker-chosen keys must not grow memory without bound, so drop the oldest.
      while (limits.size >= MAX_LIMIT_KEYS) limits.delete(limits.keys().next().value as string);
    }
    limits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  e.count++;
  return e.count <= max;
}

export async function requireCustomer(): Promise<{ user: User; customerId: string } | NextResponse> {
  const user = await currentUser();
  if (!user) return jsonError(401, "Not signed in");
  if (user.role !== "customer" || !user.customerId) return jsonError(403, "Customers only");
  return { user, customerId: user.customerId };
}

export async function requireStaff(): Promise<{ user: User } | NextResponse> {
  const user = await currentUser();
  if (!user) return jsonError(401, "Not signed in");
  if (user.role !== "staff") return jsonError(403, "Staff only");
  return { user };
}
