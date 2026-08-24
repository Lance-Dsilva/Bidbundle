import { redirect } from "next/navigation";

import { SupportCenter } from "@/components/support/SupportCenter";
import { requireUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "Support · Bundleen" };

export default async function SupportPage() {
  const user = await requireUser("/app/support");
  // Staff belong in the queue, not the customer form.
  if (user.role === "admin") redirect("/app/admin/support");

  return (
    <div className="px-4 py-6 sm:px-6">
      <SupportCenter />
    </div>
  );
}
