import { BundleenAuthLoader } from "@/components/auth/BundleenAuthLoader";

/**
 * `/auth/continue` is a server component that resolves the signed-in user's
 * live Bundleen role and redirects. That work involves database reads, so
 * without this the browser sits on the previous page — or a blank one — while
 * it runs. `timeoutMs={0}` because there is nothing for the user to retry:
 * the redirect either lands or the page itself renders an error.
 */
export default function ContinueLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center px-5 py-10"
      style={{ background: "linear-gradient(180deg, #FAF6F0 0%, #F1ECE2 100%)" }}
    >
      <BundleenAuthLoader context="redirect" timeoutMs={0} />
    </div>
  );
}
