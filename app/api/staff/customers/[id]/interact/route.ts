import { NextResponse } from "next/server";
import { checkOrigin, jsonError, rateLimit } from "@/lib/auth";
import { ok, readJson, staffCustomer, type IdCtx } from "@/lib/routeHelpers";
import { performInteract } from "@/lib/actions";
import { engineFor, toStaffView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: IdCtx) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const c = await staffCustomer(ctx);
  if (c instanceof NextResponse) return c;
  if (!rateLimit(`sim-interact:${c.username}`, 120, 60_000)) return jsonError(429, "Slow down a little");
  const r = await performInteract(c.id, await readJson(req), "simulation");
  if (!r.ok) return jsonError(r.status, r.error);
  return ok(toStaffView(await engineFor(c.id)));
}
