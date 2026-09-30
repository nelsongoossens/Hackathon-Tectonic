import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, authConfigured, checkOrigin, createSession, jsonError, rateLimit, sessionCookieOptions, verifyLogin } from "@/lib/auth";
import { readJson } from "@/lib/routeHelpers";

export const dynamic = "force-dynamic";
const Body = z.object({ username: z.string().min(1).max(40), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  if (!authConfigured()) return jsonError(503, "Server not configured: set DEMO_PASSWORD and STAFF_PASSWORD (10+ characters) in .env.local");
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, "Invalid request");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`login:${ip}`, 10, 60_000) || !rateLimit(`login-user:${parsed.data.username.toLowerCase()}`, 8, 60_000))
    return jsonError(429, "Too many attempts. Wait a minute.");
  const user = verifyLogin(parsed.data.username, parsed.data.password);
  if (!user) return jsonError(401, "Wrong username or password");
  const res = NextResponse.json({ role: user.role }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, createSession(user), sessionCookieOptions());
  return res;
}
