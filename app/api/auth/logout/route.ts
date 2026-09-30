import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, checkOrigin, destroySession, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  destroySession((await cookies()).get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
