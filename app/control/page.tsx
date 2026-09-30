import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import ControlRoom from "@/components/ControlRoom";

export const dynamic = "force-dynamic";

export default async function ControlPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "staff") redirect("/app");
  return <ControlRoom />;
}
