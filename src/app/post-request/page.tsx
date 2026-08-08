import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { db } from "@/lib/server/db";
import { DASHBOARD_BY_ROLE, isAppRole } from "@/lib/validation/auth";

/**
 * Resolves the public "Post a Request" intent without trusting client-side
 * role state. Homeowners go directly to the request form; other signed-in
 * roles return to their own dashboard instead of entering homeowner flows.
 */
export default async function PostRequestPage() {
  const { userId } = await auth();

  if (!userId) redirect("/get-started");

  const profile = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: { role: true },
  });

  if (!profile || !isAppRole(profile.role)) redirect("/get-started/profile");
  if (profile.role === "homeowner") redirect("/app/homeowner/request");

  redirect(DASHBOARD_BY_ROLE[profile.role]);
}
