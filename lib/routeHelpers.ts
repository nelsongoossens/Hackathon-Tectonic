import { NextResponse } from "next/server";
import { jsonError, requireStaff } from "./auth";
import { getPersona } from "./personas";

export function ok(data: unknown) {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export const MAX_JSON_BYTES = 10_000;

/**
 * Parses a JSON body of at most MAX_JSON_BYTES. The limit is enforced on the
 * bytes actually received, not on Content-Length, so a chunked request cannot
 * stream an unbounded body into memory. Returns null for anything invalid.
 */
export async function readJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_JSON_BYTES) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
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
