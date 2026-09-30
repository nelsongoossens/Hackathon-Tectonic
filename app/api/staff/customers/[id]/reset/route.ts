import { NextResponse } from "next/server";
import { checkOrigin } from "@/lib/auth";
import { ok, staffCustomer, type IdCtx } from "@/lib/routeHelpers";
import { resetInteractions } from "@/lib/store";
import { engineFor, toStaffView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: IdCtx) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const c = await staffCustomer(ctx);
  if (c instanceof NextResponse) return c;
  resetInteractions(c.id);
  return ok(toStaffView(await engineFor(c.id)));
}
