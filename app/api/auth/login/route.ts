import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, authConfigured, checkOrigin, clientKey, createSession, jsonError, normalizeUsername, rateLimit, sessionCookieOptions, verifyLogin } from "@/lib/auth";
import { readJson } from "@/lib/routeHelpers";

export const dynamic = "force-dynamic";
const Body = z.object({ username: z.string().min(1).max(40), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  if (!authConfigured()) return jsonError(503, "Server not configured: set DEMO_PASSWORD and STAFF_PASSWORD (10+ characters) in .env.local");
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, "Invalid request");
  // Per-account limit uses the same normalisation as verifyLogin, so " Emma" and "emma" share one bucket.
  const username = normalizeUsername(parsed.data.username);
  const client = clientKey(req);
  const perClientMax = client === "shared" ? 30 : 10;
  if (!rateLimit(`login:${client}`, perClientMax, 60_000) || !rateLimit(`login-user:${username}`, 8, 60_000))
    return jsonError(429, "Too many attempts. Wait a minute.");
  const user = verifyLogin(username, parsed.data.password);
  if (!user) return jsonError(401, "Wrong username or password");
  const res = NextResponse.json({ role: user.role }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, createSession(user), sessionCookieOptions());
  return res;
}
