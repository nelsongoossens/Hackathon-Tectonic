import { NextResponse } from "next/server";
import { z } from "zod";
import { checkOrigin, jsonError } from "@/lib/auth";
import { ok, readJson, staffCustomer, type IdCtx } from "@/lib/routeHelpers";
import { setSimDay } from "@/lib/store";
import { engineFor, toStaffView } from "@/lib/views";

export const dynamic = "force-dynamic";
const Body = z.object({ day: z.number().int().min(0).max(1000) });

export async function POST(req: Request, ctx: IdCtx) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const c = await staffCustomer(ctx);
  if (c instanceof NextResponse) return c;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, "Invalid day");
  setSimDay(c.id, parsed.data.day);
  return ok(toStaffView(await engineFor(c.id)));
}
