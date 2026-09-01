import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

export default function HoaAccessDeniedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f4ee] px-5 py-10">
      <section className="w-full max-w-md rounded-2xl border border-[#e4e7ec] bg-white p-8 text-center shadow-xl">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fff3e8] text-xl text-[#b45309]">!</span>
        <h1 className="mt-5 text-2xl font-bold text-[#1f2937]">HOA access is not active</h1>
        <p className="mt-2 text-sm leading-6 text-[#667085]">
          This staff account does not currently have an active HOA assignment. Ask Bundleen support or the primary administrator to review the invitation.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link className="inline-flex h-11 items-center rounded-xl bg-[#0f8f83] px-5 text-sm font-semibold text-white" href="/app/support">
            Contact support
          </Link>
          <UserButton appearance={{ elements: { avatarBox: "h-10 w-10" } }} />
        </div>
      </section>
    </main>
  );
}
