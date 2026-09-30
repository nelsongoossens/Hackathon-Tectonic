import { currentUser, jsonError } from "@/lib/auth";
import { ok } from "@/lib/routeHelpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return jsonError(401, "Not signed in");
  return ok({ user });
}
