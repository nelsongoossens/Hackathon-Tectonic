import { NextResponse } from "next/server";
import { z } from "zod";
import { checkOrigin, jsonError, rateLimit, requireStaff } from "@/lib/auth";
import { ok, readJson } from "@/lib/routeHelpers";
import { lastScaleResult, runScale } from "@/lib/scale";

export const dynamic = "force-dynamic";
const Body = z.object({ customers: z.number().int().min(100).max(20_000) });

export async function GET() {
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;
  return ok({ result: lastScaleResult() });
}

export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;
  if (!rateLimit(`scale:${auth.user.username}`, 3, 60_000)) return jsonError(429, "Scale test is limited to 3 runs a minute");
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(400, "customers must be between 100 and 20,000 (use npm run scale for more)");
  return ok({ result: runScale(parsed.data.customers) });
}
