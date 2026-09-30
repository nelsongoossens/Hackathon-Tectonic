import { NextResponse } from "next/server";
import { ok, staffCustomer, type IdCtx } from "@/lib/routeHelpers";
import { engineFor, toStaffView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: IdCtx) {
  const c = await staffCustomer(ctx);
  if (c instanceof NextResponse) return c;
  return ok(toStaffView(await engineFor(c.id)));
}
