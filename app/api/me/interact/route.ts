import { NextResponse } from "next/server";
import { checkOrigin, jsonError, rateLimit, requireCustomer } from "@/lib/auth";
import { ok, readJson } from "@/lib/routeHelpers";
import { performInteract } from "@/lib/actions";
import { engineFor, toCustomerView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const auth = await requireCustomer();
  if (auth instanceof NextResponse) return auth;
  if (!rateLimit(`interact:${auth.user.username}`, 60, 60_000)) return jsonError(429, "Slow down a little");
  const r = await performInteract(auth.customerId, await readJson(req), "customer");
  if (!r.ok) return jsonError(r.status, r.error);
  return ok(toCustomerView(await engineFor(auth.customerId)));
}
