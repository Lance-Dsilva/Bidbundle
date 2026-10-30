"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { HomeAddressCompletion } from "@/components/homeowner/HomeAddressCompletion";
import {
  MAX_REQUEST_DESCRIPTION_LENGTH,
  MAX_REQUEST_TITLE_LENGTH,
} from "@/lib/validation/homeowner-requests";
import { CATEGORY_LABELS, SERVICE_CATEGORIES, type ServiceCategory } from "@/lib/service-categories";

const REQUEST_CATEGORIES = SERVICE_CATEGORIES.filter((value) => value !== "other");

/**
 * Open an individual (non-HOA) service request.
 *
 * Everything on this screen comes from `/api/homeowner/requests`, which is also
 * what decides whether this account may open a request at all. Eligibility is
 * fetched before the form renders, so an HOA resident is told where their
 * services actually come from instead of being handed a form the server will
 * refuse.
 */

type Eligibility =
  | { canCreate: true; communityId: string; communityName: string }
  | {
      canCreate: false;
      reason: string;
      message: string;
      actionLabel: string;
      actionPath: string;
    };

type CreatedRequest = {
  id: string;
  title: string;
  categoryLabel: string;
  communityName: string;
  budgetMinCents: number | null;
  budgetMaxCents: number | null;
};

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

function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Dollars as typed → whole cents.
 *
 * Returns `null` for anything that is not a finite non-negative number, so the
 * caller reports a field error rather than silently posting `NaN` or `0`.
 */
function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export default function HomeownerRequestPage() {
  const router = useRouter();

  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<ServiceCategory | "">("");
  const [description, setDescription] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<CreatedRequest | null>(null);
  /** Synchronous latch: `disabled` alone cannot stop a same-tick second click. */
  const inFlight = useRef(false);
  const firstCategoryInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/homeowner/requests", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`status ${response.status}`);
      }
      const payload = (await response.json()) as { eligibility: Eligibility };
      setEligibility(payload.eligibility);
    } catch {
      setLoadError(
        "We could not check your neighbourhood. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit() {
    if (inFlight.current) return;

    // Client-side pass first, so obvious mistakes get an inline answer without
    // a round trip. The server repeats every one of these checks — this is a
    // convenience, not the boundary.
    const minCents = dollarsToCents(budgetMin);
    const maxCents = dollarsToCents(budgetMax);
    const localErrors: Record<string, string> = {};
    if (!category) localErrors.category = "Choose a service category.";
    if (!title.trim()) localErrors.title = "Give your request a short title.";
    if (!description.trim()) localErrors.description = "Describe the work you need done.";
    if (minCents === null) localErrors.budgetMinCents = "Enter a minimum budget.";
    if (maxCents === null) localErrors.budgetMaxCents = "Enter a maximum budget.";
    if (minCents !== null && maxCents !== null && maxCents < minCents) {
      localErrors.budgetMaxCents = "The maximum budget cannot be below the minimum.";
    }
    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setFormError(null);
      if (localErrors.category) firstCategoryInput.current?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const response = await fetch("/api/homeowner/requests", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          category,
          description: description.trim(),
          budgetMinCents: minCents,
          budgetMaxCents: maxCents,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            request?: CreatedRequest;
            error?: string;
            fields?: Record<string, string>;
            reason?: string;
            reference?: string;
          }
        | null;

      if (!response.ok || !payload?.request) {
        setFieldErrors(payload?.fields ?? {});
        // The real status is preserved for diagnostics in the network tab and
        // the server log; what the customer reads is a sentence, never
        // "HTTP 404".
        setFormError(
          payload?.error
            ? payload.reference
              ? `${payload.error} (reference ${payload.reference})`
              : payload.error
            : "We could not post your request. Your details are still here — please try again.",
        );
        // A product-state refusal means the form should not be offered at all;
        // re-reading eligibility replaces it with the explanation.
        if (response.status === 403 || response.status === 409) void load();
        return;
      }

      setCreated(payload.request);
    } catch {
      setFormError("We could not reach Bundleen. Check your connection and try again.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div
      className="mx-auto max-w-lg space-y-4 px-5 py-6 pb-24"
      style={{ background: "var(--bg-app)", fontFamily: "var(--font-body)" }}
    >
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

      {created ? (
        <>
          <section className="p-6 text-center" style={cardStyle}>
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
            <h2 role="status" className="mt-4 text-xl font-bold text-foreground">
              Request posted
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-600)]">
              {created.categoryLabel} · {created.communityName}
            </p>
          </section>

          <section className="space-y-2 p-4" style={cardStyle}>
            <h3 className="text-base font-semibold text-[var(--ink-900)]">{created.title}</h3>
            <p className="text-sm text-[var(--ink-600)]">
              Budget {formatCents(created.budgetMinCents)} – {formatCents(created.budgetMaxCents)}
            </p>
            <p className="text-sm text-[var(--ink-600)]">
              It is now collecting interest in {created.communityName}. You will find it under
              your requests, and we will let you know as it progresses.
            </p>
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
              className="h-12 w-full rounded-xl border border-divider bg-card text-sm font-medium text-foreground transition-all duration-150 hover:bg-canvas active:scale-[0.98]"
              type="button"
              onClick={() => {
                setCreated(null);
                setTitle("");
                setCategory("");
                setDescription("");
                setBudgetMin("");
                setBudgetMax("");
              }}
            >
              Post another request
            </button>
          </div>
        </>
      ) : loading ? (
        <section className="p-4" style={cardStyle}>
          <p role="status" className="text-sm text-[var(--ink-600)]">
            Checking your neighbourhood…
          </p>
        </section>
      ) : loadError ? (
        <section className="p-4" style={cardStyle}>
          <p role="alert" className="text-sm font-medium text-[var(--danger-600)]">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-sm font-semibold text-[var(--terracotta-600)] underline underline-offset-2"
          >
            Try again
          </button>
        </section>
      ) : eligibility && !eligibility.canCreate ? (
        <section className="space-y-3 p-5" style={cardStyle}>
          <h2 className="text-base font-semibold text-[var(--ink-900)]">
            {eligibility.reason === "no_profile_location"
              ? "Add your home address to continue"
              : "You cannot open this request yourself"}
          </h2>
          <p className="text-sm leading-relaxed text-[var(--ink-600)]">{eligibility.message}</p>
          {eligibility.reason === "no_profile_location" ? (
            <HomeAddressCompletion
              onComplete={load}
              onCancel={() => router.push("/app/homeowner/dashboard")}
              submitLabel="Save address & continue"
            />
          ) : <Link
            href={eligibility.actionPath}
            className="inline-flex h-11 items-center rounded-full px-5 text-sm font-semibold"
            style={{ background: "var(--terracotta-600)", color: "white" }}
          >
            {eligibility.actionLabel}
          </Link>}
        </section>
      ) : eligibility?.canCreate ? (
        <>
          <section className="space-y-4 p-4" style={cardStyle}>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-500)]">
              For {eligibility.communityName}
            </p>

            <fieldset
              disabled={submitting}
              aria-invalid={fieldErrors.category ? true : undefined}
              aria-describedby={fieldErrors.category ? "request-category-error" : undefined}
            >
              <legend className="mb-1.5 text-sm font-medium text-[var(--ink-700)]">
                Category <span className="text-[var(--ink-500)]">(required)</span>
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {REQUEST_CATEGORIES.map((value, index) => (
                  <label
                    key={value}
                    className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-3 text-sm font-medium text-[var(--ink-900)] transition focus-within:ring-2 focus-within:ring-[var(--terracotta-600)] focus-within:ring-offset-2 ${
                      category === value
                        ? "border-[var(--terracotta-600)] bg-[var(--terracotta-50)]"
                        : "border-[var(--border-warm)] bg-[var(--bg-card)]"
                    } ${submitting ? "cursor-wait opacity-60" : "cursor-pointer"}`}
                  >
                    <input
                      ref={index === 0 ? firstCategoryInput : undefined}
                      type="radio"
                      name="request-category"
                      value={value}
                      required
                      checked={category === value}
                      className="h-4 w-4 shrink-0 accent-[var(--terracotta-600)]"
                      aria-describedby={fieldErrors.category ? "request-category-error" : undefined}
                      onChange={() => {
                        setCategory(value);
                        setFieldErrors((errors) => {
                          const next = { ...errors };
                          delete next.category;
                          return next;
                        });
                      }}
                    />
                    {CATEGORY_LABELS[value]}
                  </label>
                ))}
              </div>
              {fieldErrors.category ? (
                <p id="request-category-error" role="alert" className="mt-1 text-[12px] font-medium text-[var(--danger-600)]">
                  {fieldErrors.category}
                </p>
              ) : null}
            </fieldset>

            <div>
              <label
                className="mb-1.5 block text-sm font-medium text-[var(--ink-700)]"
                htmlFor="request-title"
              >
                Title
              </label>
              <input
                id="request-title"
                style={inputStyle}
                type="text"
                maxLength={MAX_REQUEST_TITLE_LENGTH}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-invalid={fieldErrors.title ? true : undefined}
                aria-describedby={fieldErrors.title ? "request-title-error" : undefined}
              />
              {fieldErrors.title ? (
                <p id="request-title-error" className="mt-1 text-[12px] font-medium text-[var(--danger-600)]">
                  {fieldErrors.title}
                </p>
              ) : null}
            </div>

            <div>
              <label
                className="mb-1.5 block text-sm font-medium text-[var(--ink-700)]"
                htmlFor="request-description"
              >
                Description
              </label>
              <textarea
                id="request-description"
                className="h-32 resize-none"
                style={inputStyle}
                maxLength={MAX_REQUEST_DESCRIPTION_LENGTH}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                aria-invalid={fieldErrors.description ? true : undefined}
                aria-describedby={
                  fieldErrors.description ? "request-description-error" : undefined
                }
              />
              {fieldErrors.description ? (
                <p id="request-description-error" className="mt-1 text-[12px] font-medium text-[var(--danger-600)]">
                  {fieldErrors.description}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-[var(--ink-700)]"
                  htmlFor="budget-min"
                >
                  Min ($)
                </label>
                <input
                  id="budget-min"
                  inputMode="decimal"
                  min={0}
                  style={inputStyle}
                  type="number"
                  value={budgetMin}
                  onChange={(event) => setBudgetMin(event.target.value)}
                  aria-invalid={fieldErrors.budgetMinCents ? true : undefined}
                  aria-describedby={fieldErrors.budgetMinCents ? "budget-min-error" : undefined}
                />
                {fieldErrors.budgetMinCents ? (
                  <p id="budget-min-error" className="mt-1 text-[12px] font-medium text-[var(--danger-600)]">
                    {fieldErrors.budgetMinCents}
                  </p>
                ) : null}
              </div>
              <div>
                <label
                  className="mb-1.5 block text-sm font-medium text-[var(--ink-700)]"
                  htmlFor="budget-max"
                >
                  Max ($)
                </label>
                <input
                  id="budget-max"
                  inputMode="decimal"
                  min={0}
                  style={inputStyle}
                  type="number"
                  value={budgetMax}
                  onChange={(event) => setBudgetMax(event.target.value)}
                  aria-invalid={fieldErrors.budgetMaxCents ? true : undefined}
                  aria-describedby={fieldErrors.budgetMaxCents ? "budget-max-error" : undefined}
                />
                {fieldErrors.budgetMaxCents ? (
                  <p id="budget-max-error" className="mt-1 text-[12px] font-medium text-[var(--danger-600)]">
                    {fieldErrors.budgetMaxCents}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {formError ? (
            <p role="alert" className="text-sm font-medium text-[var(--danger-600)]">
              {formError}
            </p>
          ) : null}

          <Button
            variant="warm"
            className="h-12 w-full rounded-full text-[14px] font-semibold"
            disabled={submitting}
            onClick={() => void handleSubmit()}
          >
            {submitting ? "Posting…" : "Post request →"}
          </Button>
        </>
      ) : null}
    </div>
  );
}
