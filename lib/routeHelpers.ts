import { NextResponse } from "next/server";
import { jsonError, requireStaff } from "./auth";
import { getPersona } from "./personas";

export function ok(data: unknown) {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 10_000) return null;
  return req.json().catch(() => null);
}

export function audio(buf: Buffer) {
  return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" } });
}

export type IdCtx = { params: Promise<{ id: string }> };

/** Staff-only route on a specific synthetic customer: role check first, then the id must be a known customer. */
export async function staffCustomer(ctx: IdCtx): Promise<{ id: string; username: string } | NextResponse> {
  const auth = await requireStaff();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!getPersona(id)) return jsonError(404, "Unknown customer");
  return { id, username: auth.user.username };
}
