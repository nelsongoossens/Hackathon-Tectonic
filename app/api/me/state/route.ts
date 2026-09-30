import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/auth";
import { ok } from "@/lib/routeHelpers";
import { engineFor, toCustomerView } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireCustomer();
  if (auth instanceof NextResponse) return auth;
  return ok(toCustomerView(await engineFor(auth.customerId)));
}
