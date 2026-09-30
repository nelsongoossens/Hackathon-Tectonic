import { NextResponse } from "next/server";
import { checkOrigin, jsonError, rateLimit, requireCustomer } from "@/lib/auth";
import { ok, readJson } from "@/lib/routeHelpers";
import { performAddRule } from "@/lib/actions";
import { engineFor, toCustomerView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const auth = await requireCustomer();
  if (auth instanceof NextResponse) return auth;
  if (!rateLimit(`rules:${auth.user.username}`, 10, 60_000)) return jsonError(429, "Too many rules at once. Wait a minute.");
  const r = await performAddRule(auth.customerId, await readJson(req), "customer");
  if (!r.ok) return jsonError(r.status, r.error);
  return ok({ rule: r.rule, view: toCustomerView(await engineFor(auth.customerId)) });
}
