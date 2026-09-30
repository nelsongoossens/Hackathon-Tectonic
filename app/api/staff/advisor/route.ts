import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { ok } from "@/lib/routeHelpers";
import { advisorQueue } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;
  return ok({ items: await advisorQueue() });
}
