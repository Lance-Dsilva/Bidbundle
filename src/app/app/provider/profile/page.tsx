"use client";

import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { ProviderBusinessDetailsDialog } from "@/components/provider/ProviderBusinessDetailsDialog";
import { ProviderServiceAreasPanel } from "@/components/provider/ProviderServiceAreasPanel";
import { useProviderMarketplace } from "@/hooks/useProviderMarketplace";
import { useProviderEarnings } from "@/hooks/useProviderEarnings";
import { useProviderOverview } from "@/hooks/useProviderOverview";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderRatings } from "@/hooks/useProviderRatings";
import { initialsFromName } from "@/lib/display-name";
import { serviceCategoryLabel } from "@/lib/service-categories";
import type { ProviderProfile } from "@/lib/profile-types";
import type {
  CommonProfileUpdate,
  ProviderProfileUpdate,
  Weekday,
} from "@/lib/validation/profile";

const cardStyle: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const cardPadStyle: CSSProperties = { ...cardStyle, padding: 22 };

const ghostButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 38,
  padding: "0 16px",
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  background: "transparent",
  color: "var(--ink-700)",
  border: "1px solid var(--border-warm-strong)",
  fontFamily: "var(--font-body)",
};

const primaryButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  background: "var(--terracotta-600)",
  color: "white",
  border: 0,
};

const smallQuietButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 30,
  padding: "0 12px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  background: "var(--cream-100)",
  color: "var(--ink-900)",
  border: 0,
  fontFamily: "var(--font-body)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.10em",
  color: "var(--ink-400)",
  fontWeight: 600,
};

const numeralStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 500,
  letterSpacing: "-0.02em",
};

const DAY_LABELS: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const PAYOUT_LABELS: Record<ProviderProfile["payoutStatus"], string> = {
  not_connected: "No payout method connected",
  pending: "Payout setup in review",
  active: "Payouts active",
  restricted: "Payouts restricted — contact support",
};

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21l3.5-1 11-11-2.5-2.5-11 11z" />
      <path d="M14 5l2.5 2.5" />
    </svg>
  );
}

function IconStar(props: { color?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill={props.color ?? "currentColor"} stroke="none">
      <path d="M12 2l3 6.5 7 .9-5.1 4.7 1.3 7-6.2-3.4-6.2 3.4 1.3-7L2 9.4l7-.9z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

function PStat(props: { big: string; label: string; tone: "terracotta" | "sage" | "gold" | "ink" }) {
  const color =
    props.tone === "terracotta"
      ? "var(--terracotta-600)"
      : props.tone === "sage"
        ? "var(--sage-700)"
        : props.tone === "gold"
          ? "var(--gold-600)"
          : "var(--ink-900)";

  return (
    <div>
      <div style={{ ...numeralStyle, fontSize: 26, color, lineHeight: 1 }}>{props.big}</div>
      <div style={{ fontSize: 11, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginTop: 6 }}>
        {props.label}
      </div>
    </div>
  );
}

function ProfileField(props: { label: string; value: string | null }) {
  return (
    <div>
      <div style={eyebrowStyle}>{props.label}</div>
      <div style={{ marginTop: 6, fontSize: 14, color: props.value ? "var(--ink-900)" : "var(--ink-400)", lineHeight: 1.5 }}>
        {props.value || "Not added yet"}
      </div>
    </div>
  );
}

function fmtMoney(cents: number) {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

export default function ProviderProfilePage() {
  const {
    profile,
    provider,
    loading,
    saving,
    error,
    saveError,
    fieldErrors,
    uploadProgress,
    reload,
    saveAll,
    changeAvatar,
    clearAvatar,
  } = useProviderProfile();
  // Identity and business details come from the canonical profile endpoints;
  // the rating and the console metrics each come from their own one endpoint.
  // Nothing here reads a "provider me" aggregate.
  const { reviews, summary: ratings } = useProviderRatings(4);
  const { overview } = useProviderOverview();
  const { earnings } = useProviderEarnings();
  // One marketplace payload, shared with the feed/bids/schedule pages.
  const { workspace } = useProviderMarketplace();
  const bids = workspace?.bids ?? [];

  const [editing, setEditing] = useState(false);
  /** Set after a successful save so the page can confirm it out loud. */
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [coverageChoice, setCoverageChoice] = useState<"needed" | "kept" | null>(null);
  const coveragePromptRef = useRef<HTMLDivElement>(null);
  const coverageFocusPendingRef = useRef(false);
  useEffect(() => {
    if (!editing && coverageChoice && coverageFocusPendingRef.current && coveragePromptRef.current) {
      coverageFocusPendingRef.current = false;
      coveragePromptRef.current.focus();
    }
  }, [editing, coverageChoice]);

  // The confirmation is a moment, not a state: it clears itself rather than
  // sitting on the page until the next navigation.
  useEffect(() => {
    if (savedAt === null) return;
    const timer = window.setTimeout(() => setSavedAt(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [savedAt]);

  async function handleSave(
    common: CommonProfileUpdate,
    business: ProviderProfileUpdate,
  ): Promise<boolean> {
    // Capture the persisted location before saveAll replaces the hook snapshot.
    const locationChanged = (common.address ?? "").trim() !== (profile?.address ?? "").trim() ||
      ("latitude" in common && common.latitude !== profile?.latitude) ||
      ("longitude" in common && common.longitude !== profile?.longitude);
    const saved = await saveAll(common, business);
    // `saveAll` replaces the hook's profile/provider with what the server
    // returned, so the summary below is already the persisted values — the
    // same ones a reload would fetch.
    if (saved) {
      setSavedAt(Date.now());
      if (locationChanged) {
        coverageFocusPendingRef.current = true;
        setCoverageChoice("needed");
      }
    }
    return saved;
  }

  if (loading) {
    return (
      <div style={{ background: "var(--bg-app)", minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div style={{ color: "var(--ink-400)", fontSize: 14 }}>Loading profile…</div>
      </div>
    );
  }

  if (error || !profile || !provider) {
    return (
      <div style={{ background: "var(--bg-app)", minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ ...cardStyle, padding: 28, maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--ink-900)" }}>
            Profile unavailable
          </div>
          <p style={{ margin: "8px 0 18px", fontSize: 14, color: "var(--ink-500)", lineHeight: 1.5 }}>
            {error ?? "We could not load your profile."}
          </p>
          <button type="button" style={{ ...primaryButtonStyle, width: "100%", justifyContent: "center" }} onClick={() => void reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Summary figures are the database's totals over every published review, not
  // a count of the four shown below.
  const reviewsCount = ratings?.totalCount ?? 0;
  const averageRating = ratings?.averageRating ?? null;

  const pendingBids = bids.filter((bid) => bid.status === "submitted");
  const acceptedBids = bids.filter((bid) => bid.status === "accepted");
  // Lead time is the gap between quoting and the start date the provider
  // offered. Bids with no proposed date are excluded rather than counted as
  // zero, which would drag the average toward "same day" dishonestly.
  const datedBids = bids.filter((bid) => bid.proposedStartDate !== null);
  const avgLeadDays =
    datedBids.length > 0
      ? (
          datedBids.reduce(
            (sum, bid) =>
              sum +
              Math.max(
                0,
                (new Date(bid.proposedStartDate as string).getTime() -
                  new Date(bid.submittedAt).getTime()) /
                  86_400_000,
              ),
            0,
          ) / datedBids.length
        ).toFixed(1)
      : "—";

  const areaLabel = profile.neighborhood ?? "Area not set";
  const workingHours =
    provider.workingHoursStart && provider.workingHoursEnd
      ? `${provider.workingHoursStart} – ${provider.workingHoursEnd}`
      : null;
  const workingDaysLabel =
    provider.workingDays.length > 0 ? provider.workingDays.map((day) => DAY_LABELS[day]).join(", ") : null;
  const scheduleLabel = [workingDaysLabel, workingHours].filter(Boolean).join(" · ") || null;

  // "Verified" here means an admin recorded it. A filled-in license number is
  // a claim, and the badge deliberately does not react to one.
  const anyVerified = provider.isLicenseVerified || provider.isInsuranceVerified;

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>
            Profile &amp; business
          </h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>
            Live provider profile, service area, verification, payouts, and reviews
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setEditing(true)} style={ghostButtonStyle}>
            <IconEdit />
            Edit business details
          </button>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 30,
              padding: "0 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              background: anyVerified ? "var(--sage-50)" : "var(--cream-100)",
              color: anyVerified ? "var(--sage-700)" : "var(--ink-700)",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
            {anyVerified ? "Verified business" : "Verification pending"}
          </span>
        </div>
      </div>

      {savedAt !== null && !editing ? (
        <div
          role="status"
          className="mx-4 mb-4 md:mx-9"
          style={{ padding: "10px 14px", borderRadius: 12, background: "var(--sage-50)", color: "var(--sage-700)", fontSize: 13, border: "1px solid var(--sage-100)" }}
        >
          Your business details are saved.
        </div>
      ) : null}

      {coverageChoice && !editing ? (
        <div ref={coveragePromptRef} tabIndex={-1} role="status" className="mx-4 mb-4 rounded-xl border border-[var(--border-warm)] bg-[var(--bg-card)] p-4 md:mx-9">
          {coverageChoice === "kept" ? <p className="m-0 text-sm text-[var(--ink-700)]">Your existing service areas are kept unchanged. You can edit them below at any time.</p> : <>
            <p className="m-0 text-sm font-semibold text-[var(--ink-900)]">Your business location changed. Review where you work.</p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-500)]">Your existing service areas have not moved. Choose whether to review them or keep your current coverage.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" style={{ ...primaryButtonStyle, minHeight: 44 }} onClick={() => {
                coverageFocusPendingRef.current = false;
                setCoverageChoice(null);
                const section = document.getElementById("service-areas");
                section?.focus({ preventScroll: true });
                section?.scrollIntoView({ behavior: "auto", block: "start" });
              }}>Review service areas</button>
              <button type="button" style={{ ...ghostButtonStyle, minHeight: 44 }} onClick={() => {
                coverageFocusPendingRef.current = true;
                setCoverageChoice("kept");
              }}>Keep existing service areas</button>
            </div>
          </>}
        </div>
      ) : null}

      {saveError && !editing ? (
        <div
          role="alert"
          className="mx-4 mb-4 md:mx-9"
          style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(182,68,48,0.08)", color: "var(--danger-600)", fontSize: 13, border: "1px solid rgba(182,68,48,0.24)" }}
        >
          {saveError}
        </div>
      ) : null}

      <div className="px-4 pb-8 md:px-9 md:pb-9">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr] lg:gap-[22px]" style={{ alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
              <div style={{ height: 88, background: "linear-gradient(135deg, var(--terracotta-100), var(--cream-200) 50%, var(--sage-100))" }} />
              <div style={{ padding: "0 28px 24px", marginTop: -36 }}>
                {/* Display only. The photo is changed in the business-details
                    editor, alongside the company name it sits next to. */}
                <div
                  aria-hidden
                  style={{
                    width: 76,
                    height: 76,
                    borderRadius: "50%",
                    border: "3px solid var(--bg-card)",
                    background: profile.avatarUrl ? `center / cover no-repeat url(${JSON.stringify(profile.avatarUrl)})` : "var(--cream-200)",
                    color: "var(--ink-700)",
                    display: "grid",
                    placeItems: "center",
                    fontFamily: "var(--font-display)",
                    fontSize: 26,
                    fontWeight: 600,
                    overflow: "hidden",
                  }}
                >
                  {profile.avatarUrl
                    ? null
                    : initialsFromName(provider.companyName ?? profile.fullName, "SP")}
                </div>
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, color: "var(--ink-900)" }}>
                      {provider.companyName ?? profile.fullName}
                    </div>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)" }}>
                      <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
                      {areaLabel}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
                    {[
                      provider.isLicenseVerified ? "Licensed" : null,
                      provider.isInsuranceVerified ? "Insured" : null,
                      `${profile.communityRadiusMi} mi community radius`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 13, flexWrap: "wrap" }}>
                    {reviewsCount > 0 ? (
                      <>
                        <span style={{ color: "var(--gold-600)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                          {[1, 2, 3, 4, 5].map((index) => (
                            <IconStar key={index} color={index <= Math.round(averageRating ?? 0) ? "var(--gold-500)" : "var(--ink-200)"} />
                          ))}
                          <strong style={{ color: "var(--ink-900)", marginLeft: 4 }}>{averageRating ?? "—"}</strong>
                        </span>
                        <span style={{ color: "var(--ink-500)" }}>
                          · {reviewsCount} {reviewsCount === 1 ? "review" : "reviews"} on Bundleen
                        </span>
                      </>
                    ) : (
                      <span style={{ color: "var(--ink-500)" }}>No reviews yet</span>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: 18, fontSize: 14, color: provider.bio ? "var(--ink-700)" : "var(--ink-400)", lineHeight: 1.6 }}>
                  {provider.bio ??
                    "No business description yet. Add your specialties, experience, and what customers can expect."}
                </div>
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Performance · live</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-3.5" style={{ marginTop: 14 }}>
                <PStat big={fmtMoney(earnings?.earnedCents ?? 0)} label="Earnings" tone="terracotta" />
                <PStat big={overview?.winRatePct !== null && overview ? `${overview.winRatePct}%` : "—"} label="Win rate" tone="sage" />
                <PStat big={reviewsCount > 0 ? String(averageRating ?? "—") : "—"} label="Rating" tone="gold" />
                <PStat big={String(avgLeadDays)} label="Avg lead days" tone="ink" />
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Business details</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-[18px]" style={{ marginTop: 14 }}>
                <ProfileField label="Business locality" value={profile.neighborhood} />
                <ProfileField label="Working hours" value={scheduleLabel} />
                <ProfileField label="Business address" value={profile.address} />
                <ProfileField
                  label="Payout account"
                  value={
                    provider.payoutLast4
                      ? `${PAYOUT_LABELS[provider.payoutStatus]} · •••• ${provider.payoutLast4}`
                      : PAYOUT_LABELS[provider.payoutStatus]
                  }
                />
              </div>
              <p style={{ marginTop: 14, fontSize: 11, color: "var(--ink-400)", lineHeight: 1.5 }}>
                Payout details are managed by our payments partner. Bundleen never stores your bank
                credentials.
              </p>
            </div>

            {/* The canonical long-term home for coverage management. The HOA
                workspace links here rather than duplicating the editor. */}
            <ProviderServiceAreasPanel />

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Trades offered</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {provider.trades.length === 0 ? (
                  <span style={{ fontSize: 13, color: "var(--ink-500)" }}>No trades configured yet.</span>
                ) : (
                  provider.trades.map((trade) => (
                    <span key={trade} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--terracotta-50)", color: "var(--terracotta-600)" }}>
                      {serviceCategoryLabel(trade)}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Recent customer reviews</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
                {reviews.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--ink-500)" }}>No customer reviews yet.</div>
                ) : (
                  reviews.map((review) => (
                    <div key={review.id} style={{ padding: "14px 16px", borderRadius: 14, background: "var(--cream-50)", border: "1px solid var(--border-warm)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{review.reviewerName}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                          {new Date(review.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </div>
                      </div>
                      <div style={{ marginTop: 6, display: "flex", gap: 2 }}>
                        {Array.from({ length: review.rating }).map((_, index) => (
                          <IconStar key={index} color="var(--gold-500)" />
                        ))}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, color: "var(--ink-700)", lineHeight: 1.5 }}>
                        {review.comment}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ ...cardStyle, padding: 18, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-900)" }}>Sign out</div>
                <div style={{ fontSize: 11, color: "var(--ink-500)" }}>End session on this device</div>
              </div>
              <SignOutButton redirectUrl="/">
                <button type="button" style={{ ...ghostButtonStyle, color: "var(--danger-600)", borderColor: "rgba(182,68,48,0.3)", height: 34 }}>
                  Sign out
                </button>
              </SignOutButton>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18, position: "sticky", top: 0 }}>
            <div style={{ background: "linear-gradient(160deg, var(--terracotta-50), var(--cream-100))", borderRadius: 22, padding: 24, border: "1px solid var(--border-warm)" }}>
              <div style={eyebrowStyle}>Booked revenue</div>
              <div style={{ ...numeralStyle, fontSize: 38, color: "var(--terracotta-600)", marginTop: 6 }}>
                {fmtMoney(earnings?.earnedCents ?? 0)}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{PAYOUT_LABELS[provider.payoutStatus]}</div>
              <div style={{ borderTop: "1px solid var(--border-warm)", marginTop: 18, paddingTop: 14, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Completed jobs</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{acceptedBids.length}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Gross earnings</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{fmtMoney(earnings?.earnedCents ?? 0)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Pending pipeline</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                    {fmtMoney(pendingBids.reduce((sum, bid) => sum + bid.amountCents, 0))}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>This month</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{fmtMoney(earnings?.thisMonthCents ?? 0)}</span>
                </div>
              </div>
              <Link href="/app/provider/earnings" style={{ ...smallQuietButtonStyle, width: "100%", marginTop: 12, background: "var(--bg-card)", justifyContent: "center", textDecoration: "none" }}>
                View full payout breakdown
              </Link>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Verification status</div>
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--ink-400)", lineHeight: 1.5 }}>
                Reviewed by our team. Adding a number here submits it for checking.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                {[
                  {
                    label: "Business license",
                    verified: provider.isLicenseVerified,
                    detail: provider.isLicenseVerified
                      ? `Verified${provider.licenseNumber ? ` · ${provider.licenseNumber}` : ""}`
                      : provider.licenseNumber
                        ? `Submitted · ${provider.licenseNumber}`
                        : "Not submitted",
                  },
                  {
                    label: "Liability insurance",
                    verified: provider.isInsuranceVerified,
                    detail: provider.isInsuranceVerified
                      ? `Verified${provider.insuranceProvider ? ` · ${provider.insuranceProvider}` : ""}`
                      : provider.insuranceProvider
                        ? `Submitted · ${provider.insuranceProvider}`
                        : "Not submitted",
                  },
                  {
                    label: "Community radius",
                    verified: true,
                    detail: `${profile.communityRadiusMi} miles · fixed for everyone`,
                  },
                  // A geocoded locality is location data, never a business verification.
                  { label: "Neighborhood", verified: false, detail: areaLabel },
                ].map((row) => (
                  <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: row.verified ? "var(--sage-50)" : "var(--cream-100)",
                        color: row.verified ? "var(--sage-700)" : "var(--ink-500)",
                        display: "grid",
                        placeItems: "center",
                      }}
                    >
                      <IconCheck />
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-900)" }}>{row.label}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{row.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Live account summary</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Unread messages</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{overview?.unreadMessages ?? 0}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Active bids</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{pendingBids.length}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Reviews</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{reviewsCount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "var(--ink-500)" }}>Email</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)", overflowWrap: "anywhere" }}>{profile.email}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {editing && profile && provider ? (
        <ProviderBusinessDetailsDialog
          profile={profile}
          provider={provider}
          saving={saving}
          saveError={saveError}
          fieldErrors={fieldErrors}
          uploadProgress={uploadProgress}
          onChangeAvatar={(file) => void changeAvatar(file)}
          onClearAvatar={() => void clearAvatar()}
          onSave={handleSave}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
