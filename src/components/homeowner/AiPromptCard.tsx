"use client";

import { useRouter } from "next/navigation";

export function AiPromptCard() {
  const router = useRouter();

  return (
    <button
      type="button"
      className="grain group w-full rounded-card bg-surface p-4 text-left shadow-surface transition-all duration-200 hover:scale-[1.005] active:scale-[0.998]"
      onClick={() => router.push("/app/homeowner/request")}
    >
      {/* Label */}
      <div className="flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/25 text-[10px] font-bold text-primary">
          ✦
        </span>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
          AI-powered matching
        </p>
      </div>

      {/* Prompt */}
      <p className="mt-2.5 font-display text-[17px] font-semibold italic text-white">
        What do you need done?
      </p>

      {/* Fake input */}
      <div className="mt-2.5 flex h-10 w-full items-center rounded-xl border border-white/8 bg-white/6 px-3">
        <span className="text-[13px] text-white/30">Describe a home service…</span>
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[11px] text-white/35">Detects category · finds nearby groups</p>
        <span className="flex items-center gap-1 rounded-full bg-accent-bright px-3 py-1 text-[11px] font-bold text-white transition-all group-hover:bg-[#b45309]">
          Start
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
          </svg>
        </span>
      </div>
    </button>
  );
}
