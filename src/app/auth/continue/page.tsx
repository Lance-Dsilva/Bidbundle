import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { db } from "@/lib/server/db";
import { activateApprovedAdminIdentity } from "@/lib/server/admin-access";
import { DASHBOARD_BY_ROLE, isAppRole } from "@/lib/validation/auth";

/** Resolves a successful Clerk sign-in to the user's live Bundleen role. */
export default async function ContinueAfterAuthentication() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // A primary owner or approved staff member may not yet have a Bundleen row
  // (for example, their first sign-in followed an owner-issued approval).
  // Clerk proves the exact verified email before the grant is activated.
  const identity = await currentUser();
  const primaryEmail = identity?.emailAddresses.find(
    (item) => item.id === identity.primaryEmailAddressId,
  );
  if (identity && primaryEmail) {
    await activateApprovedAdminIdentity({
      clerkUserId: identity.id,
      email: primaryEmail.emailAddress,
      emailVerified: primaryEmail.verification?.status === "verified",
      fullName:
        identity.fullName ||
        [identity.firstName, identity.lastName].filter(Boolean).join(" ") ||
        primaryEmail.emailAddress.split("@")[0],
    });
  }

  const profile = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: { role: true },
  });

  if (!profile || !isAppRole(profile.role)) redirect("/get-started/profile");
  redirect(DASHBOARD_BY_ROLE[profile.role]);
}
