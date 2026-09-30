import { NextResponse } from "next/server";
import { checkOrigin, jsonError, rateLimit, requireCustomer } from "@/lib/auth";
import { audio, readJson } from "@/lib/routeHelpers";
import { performVoice } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const auth = await requireCustomer();
  if (auth instanceof NextResponse) return auth;
  if (!rateLimit(`voice:${auth.user.username}`, 20, 60_000)) return jsonError(429, "Too many voice requests");
  const r = await performVoice(auth.customerId, await readJson(req));
  if (!r.audio) return jsonError(r.status, r.error ?? "voice_disabled");
  return audio(r.audio);
}
