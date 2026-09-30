import { NextResponse } from "next/server";
import { checkOrigin, jsonError, rateLimit } from "@/lib/auth";
import { ok, readJson, staffCustomer, type IdCtx } from "@/lib/routeHelpers";
import { performAddRule } from "@/lib/actions";
import { engineFor, toStaffView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: IdCtx) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const c = await staffCustomer(ctx);
  if (c instanceof NextResponse) return c;
  if (!rateLimit(`sim-rules:${c.username}`, 20, 60_000)) return jsonError(429, "Too many rules at once. Wait a minute.");
  const r = await performAddRule(c.id, await readJson(req), "simulation");
  if (!r.ok) return jsonError(r.status, r.error);
  return ok({ rule: r.rule, view: toStaffView(await engineFor(c.id)) });
}
