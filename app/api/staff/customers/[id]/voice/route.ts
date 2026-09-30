import { NextResponse } from "next/server";
import { checkOrigin, jsonError, rateLimit } from "@/lib/auth";
import { audio, readJson, staffCustomer, type IdCtx } from "@/lib/routeHelpers";
import { performVoice } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: IdCtx) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const c = await staffCustomer(ctx);
  if (c instanceof NextResponse) return c;
  if (!rateLimit(`sim-voice:${c.username}`, 30, 60_000)) return jsonError(429, "Too many voice requests");
  const r = await performVoice(c.id, await readJson(req));
  if (!r.audio) return jsonError(r.status, r.error ?? "voice_disabled");
  return audio(r.audio);
}
