import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { ok } from "@/lib/routeHelpers";
import { SERVICE_GRAPH } from "@/lib/serviceGraph";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;
  return ok({ nodes: SERVICE_GRAPH });
}
