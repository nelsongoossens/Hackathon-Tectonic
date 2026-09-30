import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { ok } from "@/lib/routeHelpers";
import { customerSummaries } from "@/lib/personas";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;
  return ok({ customers: customerSummaries() });
}
