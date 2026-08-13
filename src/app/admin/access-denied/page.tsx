import { SignOutButton } from "@clerk/nextjs";

export default function AdminAccessDeniedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5" style={{ background: "var(--cream)" }}>
      <section className="w-full max-w-lg rounded-2xl border bg-white p-8 text-center shadow-card" style={{ borderColor: "var(--line)" }}>
        <span className="bb-eyebrow">Admin access required</span>
        <h1 className="mt-2 text-2xl font-bold" style={{ color: "var(--ink-900)" }}>This account is not authorized</h1>
        <p className="mx-auto mt-3 max-w-sm text-[13px]" style={{ color: "var(--muted)" }}>
          Sign in with the primary owner account or an email that the owner has approved in the admin portal.
        </p>
        <SignOutButton redirectUrl="/admin/sign-in">
          <button type="button" className="mt-6 rounded-xl px-5 py-3 text-[13px] font-semibold text-white" style={{ background: "var(--teal-800)" }}>
            Sign in with another account
          </button>
        </SignOutButton>
      </section>
    </main>
  );
}

