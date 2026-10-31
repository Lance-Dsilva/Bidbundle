import type { Metadata } from "next";
import Link from "next/link";

import { BundleenCompanyIcon } from "@/components/brand/BundleenCompanyIcon";
import { CommunityInterestForm } from "@/components/marketing/CommunityInterestForm";

export const metadata: Metadata = { title: "Bring Bundleen to your community" };

export default function CommunityOnboardingPage() {
  return (
    <main className="min-h-screen bg-[#f7f8fa] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="inline-flex min-h-11 items-center gap-3 rounded-lg text-lg font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" aria-label="Bundleen home">
          <BundleenCompanyIcon size={32} /> Bundleen
        </Link>
        <header className="mb-8 mt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Staff-led community setup</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Bring Bundleen to your community</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">Bundleen staff help set up communities and invite their managers. Tell us who to contact to start that conversation.</p>
          <p className="mt-3 text-sm leading-6 text-slate-600">You do not need to create a homeowner or provider account to express interest. This form does not create a community or grant manager access.</p>
        </header>
        <CommunityInterestForm />
      </div>
    </main>
  );
}
