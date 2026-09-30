// Open demo entry: picks a synthetic user without a password. Only active when
// DEMO_OPEN=1. It issues the same server-side session as /api/auth/login, so
// every other route keeps its role checks, ownership checks and rate limits.
import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, checkOrigin, clientKey, createSession, demoOpen, findUser, jsonError, rateLimit, sessionCookieOptions } from "@/lib/auth";
import { readJson } from "@/lib/routeHelpers";

export const dynamic = "force-dynamic";
const Body = z.object({ username: z.string().min(1).max(40) });

export async function GET() {
  return NextResponse.json({ open: demoOpen() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  if (!demoOpen()) return jsonError(404, "Open demo mode is off");
  if (!rateLimit(`demo:${clientKey(req)}`, 60, 60_000)) return jsonError(429, "Too many attempts. Wait a minute.");
  const parsed = Body.safeParse(await readJson(req));
  const user = parsed.success ? findUser(parsed.data.username) : undefined;
  if (!user) return jsonError(400, "Unknown demo user");
  const res = NextResponse.json({ role: user.role }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, createSession(user), sessionCookieOptions());
  return res;
}
