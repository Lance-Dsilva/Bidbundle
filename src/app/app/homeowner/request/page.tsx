"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { useRequestWriter } from "@/hooks/useRequestWriter";
import { apiFetch } from "@/lib/api";
import { fetchMe, getToken } from "@/lib/auth";

const CATEGORY_OPTIONS = [
  { value: "plumbing", label: "Plumbing" },
  { value: "lawn", label: "Lawn" },
  { value: "gutter", label: "Gutter" },
  { value: "hvac", label: "HVAC" },
  { value: "electrical", label: "Electrical" },
  { value: "cleaning", label: "Cleaning" },
  { value: "handyman", label: "Handyman" },
  { value: "roofing", label: "Roofing" },
  { value: "other", label: "Other" },
] as const;

const cardStyle: CSSProperties = {
  background: "var(--cream-50)",
  borderRadius: 18,
  border: "1px solid var(--border-warm)",
  boxShadow: "var(--shadow-warm-sm)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 14,
  border: "1px solid var(--border-warm)",
  background: "var(--bg-card)",
  padding: "12px 14px",
  color: "var(--ink-900)",
  fontFamily: "var(--font-body)",
  fontSize: 14,
  lineHeight: 1.4,
  outline: "none",
};

const badgeStyles: Record<"high" | "medium" | "low", CSSProperties> = {
  high: {
    background: "var(--sage-100)",
    color: "var(--sage-700)",
  },
  medium: {
    background: "var(--gold-100)",
    color: "var(--gold-700)",
  },
  low: {
    background: "var(--cream-200)",
    color: "var(--ink-700)",
  },
};

function truncateTitle(value: string) {
  if (value.length <= 40) return value;
  return `${value.slice(0, 37)}...`;
}

function getCategoryLabel(value: string) {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? "Other";
}

export default function HomeownerRequestPage() {
  const router = useRouter();
  const { writeRequest, loading, error } = useRequestWriter();
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const [plainText, setPlainText] = useState("");
  const [step, setStep] = useState<"form" | "posted">("form");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("other");
  const [description, setDescription] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [groupLikelihood, setGroupLikelihood] = useState<"high" | "medium" | "low">("low");
  const [groupReason, setGroupReason] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState(false);
  const [postedCategoryLabel, setPostedCategoryLabel] = useState("Other");
  const [postedTitle, setPostedTitle] = useState("Other");
  const [userNeighborhood, setUserNeighborhood] = useState("Oakwood Heights");

  useEffect(() => {
    const token = getToken();
    if (token) {
      fetchMe(token)
        .then((me) => { if (me.neighborhood) setUserNeighborhood(me.neighborhood); })
        .catch(() => {});
    }
  }, []);

  async function handleWriteWithAi() {
    if (!plainText.trim()) return;
    const result = await writeRequest(plainText.trim());
    if (!result) return;

    setTitle(result.title);
    setCategory(result.category);
    setDescription(result.description);
    setBudgetMin(String(result.budget_min / 100));
    setBudgetMax(String(result.budget_max / 100));
    setGroupLikelihood(result.estimated_group_likelihood);
    setGroupReason(result.group_reason);
    setMode("manual");
  }

  function handleManualMode() {
    setMode("manual");
    setTitle("");
    setCategory("other");
    setDescription("");
    setBudgetMin("");
    setBudgetMax("");
    setGroupLikelihood("low");
    setGroupReason("");
  }

  async function handlePost() {
    if (!title.trim() || !description.trim()) return;
    setIsPosting(true);
    setPostError(null);
    try {
      const token = getToken();
      await apiFetch("/requests", {
        method: "POST",
        token: token ?? undefined,
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          neighborhood: userNeighborhood,
          budget_min: Math.round(parseFloat(budgetMin || "0") * 100),
          budget_max: Math.round(parseFloat(budgetMax || "0") * 100),
          status: "draft",
        }),
      });
      setPostedCategoryLabel(getCategoryLabel(category));
      setPostedTitle(truncateTitle(title.trim()));
      setStep("posted");
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Failed to post request");
    } finally {
      setIsPosting(false);
    }
  }

  function handleInvite() {
    setInviteSent(true);
  }

  return (
    <div
      className="mx-auto max-w-lg space-y-4 px-5 py-6 pb-24"
      style={{ background: "var(--bg-app)", fontFamily: "var(--font-body)" }}
    >
      <style>{`
        @keyframes nbPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1); }
        }
        .nb-dot { animation: nbPulse 1.2s ease-in-out infinite; }
        .nb-dot:nth-child(2) { animation-delay: 0.2s; }
        .nb-dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>

      {step === "form" ? (
        <>
          <header className="relative flex items-center justify-center">
            <button
              aria-label="Back to dashboard"
              className="absolute left-0 flex h-10 w-10 items-center justify-center rounded-full text-foreground transition hover:bg-card"
              type="button"
              onClick={() => router.push("/app/homeowner/dashboard")}
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-foreground">New request</h1>
          </header>

          {mode === "ai" ? (
            <>
              <section className="p-4" style={cardStyle}>
                <label
                  className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-500)]"
                  htmlFor="request-plain-text"
                >
                  Describe your problem
                </label>
                <textarea
                  id="request-plain-text"
                  className="mt-3 h-36 w-full resize-none"
                  placeholder="Describe your problem in plain English…"
                  style={inputStyle}
                  value={plainText}
                  onChange={(event) => setPlainText(event.target.value)}
                />
                {plainText.trim().length === 0 ? (
                  <div className="mt-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-400)]">
                      Try one of these
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[
                        "My kitchen faucet is dripping and the cabinet below is wet",
                        "Lawn is overgrown, needs mowing and edge trim",
                        "Gutters are overflowing when it rains",
                        "AC blows warm air on the second floor",
                        "Need a deep clean before family visits next weekend",
                      ].map((example) => (
                        <button
                          key={example}
                          type="button"
                          onClick={() => setPlainText(example)}
                          className="rounded-full px-3 py-2 text-left text-[12px] font-medium transition hover:bg-[var(--terracotta-50)]"
                          style={{
                            background: "var(--cream-100)",
                            color: "var(--ink-700)",
                            border: "1px solid var(--border-warm)",
                          }}
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {error ? (
                  <p className="mt-2 text-sm text-[var(--danger-600)]">{error}</p>
                ) : null}
                <Button
                  variant="warm"
                  className="mt-4 h-12 w-full rounded-full text-[14px] font-semibold"
                  disabled={!plainText.trim() || loading}
                  onClick={handleWriteWithAi}
                >
                  Write with AI →
                </Button>
                <button
                  className="mt-3 text-sm font-medium text-[var(--terracotta-600)] underline underline-offset-2"
                  type="button"
                  onClick={handleManualMode}
                >
                  Or fill manually →
                </button>
              </section>

              {loading ? (
                <section className="p-4" style={cardStyle}>
                  <div className="flex items-center gap-3 text-[var(--ink-700)]">
                    <div className="flex items-center gap-2">
                      <span
                        className="nb-dot inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: "var(--terracotta-600)" }}
                      />
                      <span
                        className="nb-dot inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: "var(--terracotta-600)" }}
                      />
                      <span
                        className="nb-dot inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: "var(--terracotta-600)" }}
                      />
                    </div>
                    <p className="text-sm font-medium">AI is structuring your request…</p>
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <>
              <section className="space-y-4 p-4" style={cardStyle}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-500)]">
                    Structured request
                  </p>
                  <button
                    className="text-sm font-medium text-[var(--terracotta-600)] underline underline-offset-2"
                    type="button"
                    onClick={() => setMode("ai")}
                  >
                    Edit plain text ↺
                  </button>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--ink-700)]" htmlFor="request-title">
                    Title
                  </label>
                  <input
                    id="request-title"
                    style={inputStyle}
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--ink-700)]" htmlFor="request-category">
                    Category
                  </label>
                  <select
                    id="request-category"
                    style={inputStyle}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-[var(--ink-700)]" htmlFor="request-description">
                    Description
                  </label>
                  <textarea
                    id="request-description"
                    className="h-32 resize-none"
                    style={inputStyle}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--ink-700)]" htmlFor="budget-min">
                      Min ($)
                    </label>
                    <input
                      id="budget-min"
                      inputMode="numeric"
                      style={inputStyle}
                      type="number"
                      value={budgetMin}
                      onChange={(event) => setBudgetMin(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-[var(--ink-700)]" htmlFor="budget-max">
                      Max ($)
                    </label>
                    <input
                      id="budget-max"
                      inputMode="numeric"
                      style={inputStyle}
                      type="number"
                      value={budgetMax}
                      onChange={(event) => setBudgetMax(event.target.value)}
                    />
                  </div>
                </div>

                <div
                  className="space-y-2 rounded-[16px] p-3"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-warm)" }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold capitalize"
                      style={badgeStyles[groupLikelihood]}
                    >
                      {groupLikelihood}
                    </span>
                    <span className="text-sm font-medium text-[var(--ink-700)]">Group likelihood</span>
                  </div>
                  <p className="text-sm text-[var(--ink-600)]">
                    {groupReason || "No active group for this service — your request will start one"}
                  </p>
                </div>
              </section>

              {postError && (
                <p className="text-sm text-[var(--terracotta-600)]">{postError}</p>
              )}
              <Button
                variant="warm"
                className="h-12 w-full rounded-full text-[14px] font-semibold"
                disabled={!title.trim() || !description.trim() || isPosting}
                onClick={handlePost}
              >
                {isPosting ? "Posting…" : "Post request →"}
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <section className="rounded-card bg-card px-5 py-8 text-center shadow-card">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
              <svg
                aria-hidden="true"
                className="h-7 w-7 text-emerald-600"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
                viewBox="0 0 24 24"
              >
                <path d="m5 12 5 5L19 8" />
              </svg>
            </div>
            <h1 className="mt-4 text-xl font-bold text-foreground">Request posted!</h1>
            <p className="mt-1 text-sm text-muted">{postedCategoryLabel} · Oakwood Heights</p>
          </section>

          <section className="rounded-card bg-surface p-5 text-white">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/50">
              Group forming
            </p>
            <h2 className="mt-2 text-base font-semibold text-white">{postedTitle}</h2>
            <div className="mt-4 flex items-end gap-1.5">
              <span className="text-3xl font-bold leading-none">3</span>
              <span className="pb-0.5 text-sm text-white/60">of 8 neighbors joined</span>
            </div>
            <div className="mt-2.5 h-1.5 w-full rounded-full bg-white/15">
              <div className="h-full rounded-full bg-primary" style={{ width: "37.5%" }} />
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-white/50">
              <span>⏱ 32h 16m left</span>
              <span>📍 Oakwood Heights</span>
            </div>
          </section>

          <div className="space-y-3">
            <Button
              variant="primary"
              className="w-full"
              onClick={() => router.push("/app/homeowner/dashboard")}
            >
              Back to dashboard
            </Button>
            <button
              className={`h-12 w-full rounded-xl border text-sm font-medium transition-all duration-150 active:scale-[0.98] ${
                inviteSent
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-divider bg-card text-foreground hover:border-foreground/20 hover:bg-canvas"
              }`}
              type="button"
              onClick={handleInvite}
            >
              {inviteSent ? "✓ Invite sent!" : "Invite a neighbor"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
