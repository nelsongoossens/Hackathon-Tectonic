import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import CustomerApp from "@/components/CustomerApp";

export const dynamic = "force-dynamic";

export default async function CustomerPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "customer") redirect("/control");
  return <CustomerApp />;
}
