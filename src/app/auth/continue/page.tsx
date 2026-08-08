import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { db } from "@/lib/server/db";
import { DASHBOARD_BY_ROLE, isAppRole } from "@/lib/validation/auth";

/** Resolves a successful Clerk sign-in to the user's live Bundleen role. */
export default async function ContinueAfterAuthentication() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const profile = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: { role: true },
  });

  if (!profile || !isAppRole(profile.role)) redirect("/get-started/profile");
  redirect(DASHBOARD_BY_ROLE[profile.role]);
}
