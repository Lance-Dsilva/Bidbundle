import { BundleenAuthLoader } from "@/components/auth/BundleenAuthLoader";

/**
 * Invitation acceptance verifies the Clerk identity against the invited email
 * before creating a membership. That is a server round trip, so the branded
 * loader stands in for it rather than an empty page.
 */
export default function AcceptInvitationLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-5 py-10"
      style={{ background: "linear-gradient(180deg, #FAF6F0 0%, #F1ECE2 100%)" }}
    >
      <BundleenAuthLoader context="invitation" timeoutMs={0} />
    </div>
  );
}
