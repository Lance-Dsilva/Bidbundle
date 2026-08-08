"use client";

import { SignOutButton } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";

import { AvatarField } from "@/components/profile/AvatarField";
import { useProviderBids } from "@/hooks/useProviderBids";
import { useProviderDashboard } from "@/hooks/useProviderDashboard";
import { useProviderEarnings } from "@/hooks/useProviderEarnings";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderReviews } from "@/hooks/useProviderReviews";
import type { ProviderProfile } from "@/lib/profile-types";
import { MAX_BIO_LENGTH, WEEKDAYS, type Weekday } from "@/lib/validation/profile";

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

const inputStyle: CSSProperties = {
  height: 40,
  width: "100%",
  borderRadius: 12,
  border: "1px solid var(--border-warm)",
  padding: "0 12px",
  fontSize: 14,
  color: "var(--ink-900)",
  fontFamily: "var(--font-body)",
  background: "var(--bg-card)",
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

/** Every field the edit dialog may write, across both endpoints. */
type EditForm = {
  fullName: string;
  phone: string;
  address: string;
  neighborhood: string;
  companyName: string;
  bio: string;
  trades: string;
  workingDays: Weekday[];
  workingHoursStart: string;
  workingHoursEnd: string;
  licenseNumber: string;
  licenseState: string;
  insuranceProvider: string;
  insurancePolicyNumber: string;
};

const EMPTY_FORM: EditForm = {
  fullName: "",
  phone: "",
  address: "",
  neighborhood: "",
  companyName: "",
  bio: "",
  trades: "",
  workingDays: [],
  workingHoursStart: "",
  workingHoursEnd: "",
  licenseNumber: "",
  licenseState: "",
  insuranceProvider: "",
  insurancePolicyNumber: "",
};

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
  const { avgRating, reviews } = useProviderReviews();
  const { dashboard } = useProviderDashboard();
  const { earnings } = useProviderEarnings();
  const { bids } = useProviderBids();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);

  const resetForm = () => {
    if (!profile || !provider) return;
    setForm({
      fullName: profile.fullName,
      phone: profile.phone ?? "",
      address: profile.address ?? "",
      neighborhood: profile.neighborhood ?? "",
      companyName: provider.companyName ?? "",
      bio: provider.bio ?? "",
      trades: provider.trades.join(", "),
      workingDays: provider.workingDays,
      workingHoursStart: provider.workingHoursStart ?? "",
      workingHoursEnd: provider.workingHoursEnd ?? "",
      licenseNumber: provider.licenseNumber ?? "",
      licenseState: provider.licenseState ?? "",
      insuranceProvider: provider.insuranceProvider ?? "",
      insurancePolicyNumber: provider.insurancePolicyNumber ?? "",
    });
  };

  // Keeps the dialog in step with whatever the server last returned.
  useEffect(resetForm, [profile, provider]);

  async function handleSave() {
    const saved = await saveAll(
      {
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        neighborhood: form.neighborhood.trim() || null,
      },
      {
        companyName: form.companyName.trim() || null,
        bio: form.bio.trim() || null,
        trades: form.trades.split(",").map((trade) => trade.trim()).filter(Boolean),
        workingDays: form.workingDays,
        workingHoursStart: form.workingHoursStart || null,
        workingHoursEnd: form.workingHoursEnd || null,
        licenseNumber: form.licenseNumber.trim() || null,
        licenseState: form.licenseState.trim() || null,
        insuranceProvider: form.insuranceProvider.trim() || null,
        insurancePolicyNumber: form.insurancePolicyNumber.trim() || null,
      },
    );
    if (saved) setEditing(false);
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

  const pendingBids = bids.filter((bid) => bid.status === "pending");
  const acceptedBids = bids.filter((bid) => bid.status === "accepted");
  const avgLeadDays =
    bids.length > 0 ? (bids.reduce((sum, bid) => sum + bid.estimated_days, 0) / bids.length).toFixed(1) : "—";

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
            Edit public profile
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
                <AvatarField
                  url={profile.avatarUrl}
                  name={provider.companyName ?? profile.fullName}
                  progress={uploadProgress}
                  onSelect={(file) => void changeAvatar(file)}
                  onRemove={() => void clearAvatar()}
                />
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
                    {reviews.length > 0 ? (
                      <>
                        <span style={{ color: "var(--gold-600)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                          {[1, 2, 3, 4, 5].map((index) => (
                            <IconStar key={index} color={index <= Math.round(avgRating ?? 0) ? "var(--gold-500)" : "var(--ink-200)"} />
                          ))}
                          <strong style={{ color: "var(--ink-900)", marginLeft: 4 }}>{avgRating ?? "—"}</strong>
                        </span>
                        <span style={{ color: "var(--ink-500)" }}>
                          · {reviews.length} {reviews.length === 1 ? "review" : "reviews"} on Bundleen
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
                <PStat big={fmtMoney(earnings?.total_cents ?? 0)} label="Earnings" tone="terracotta" />
                <PStat big={`${dashboard?.win_rate_pct?.toFixed(0) ?? 0}%`} label="Win rate" tone="sage" />
                <PStat big={reviews.length > 0 ? String(avgRating ?? "—") : "—"} label="Rating" tone="gold" />
                <PStat big={String(avgLeadDays)} label="Avg lead days" tone="ink" />
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Business details</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-[18px]" style={{ marginTop: 14 }}>
                <ProfileField label="Service area" value={`${areaLabel} · ${profile.communityRadiusMi} mi radius`} />
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

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Trades offered</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {provider.trades.length === 0 ? (
                  <span style={{ fontSize: 13, color: "var(--ink-500)" }}>No trades configured yet.</span>
                ) : (
                  provider.trades.map((trade) => (
                    <span key={trade} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--terracotta-50)", color: "var(--terracotta-600)" }}>
                      {trade}
                    </span>
                  ))
                )}
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Recent customer reviews</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
                {reviews.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--ink-500)" }}>No homeowner reviews yet.</div>
                ) : (
                  reviews.slice(0, 4).map((review) => (
                    <div key={review.id} style={{ padding: "14px 16px", borderRadius: 14, background: "var(--cream-50)", border: "1px solid var(--border-warm)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{review.homeowner_name}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                          {new Date(review.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </div>
                      </div>
                      <div style={{ marginTop: 6, display: "flex", gap: 2 }}>
                        {Array.from({ length: review.stars }).map((_, index) => (
                          <IconStar key={index} color="var(--gold-500)" />
                        ))}
                      </div>
                      <div style={{ marginTop: 8, fontSize: 13, color: "var(--ink-700)", lineHeight: 1.5 }}>
                        {review.comment ?? "No written comment."}
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
                {fmtMoney(earnings?.total_cents ?? 0)}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{PAYOUT_LABELS[provider.payoutStatus]}</div>
              <div style={{ borderTop: "1px solid var(--border-warm)", marginTop: 18, paddingTop: 14, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Completed jobs</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{acceptedBids.length}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Gross earnings</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{fmtMoney(earnings?.total_cents ?? 0)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Pending pipeline</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>
                    {fmtMoney(pendingBids.reduce((sum, bid) => sum + bid.amount, 0))}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>This month</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{fmtMoney(earnings?.this_month_cents ?? 0)}</span>
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
                  { label: "Neighborhood", verified: Boolean(profile.neighborhood), detail: areaLabel },
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
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{dashboard?.unread_messages ?? 0}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Active bids</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{dashboard?.active_bids ?? 0}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>Reviews</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{reviews.length}</span>
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

      {editing ? (
        <div
          onClick={() => {
            resetForm();
            setEditing(false);
          }}
          style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,0.24)", display: "grid", placeItems: "center", padding: 24, zIndex: 50, overflowY: "auto" }}
        >
          <div
            role="dialog"
            aria-label="Edit provider profile"
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(780px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "var(--bg-card)", borderRadius: 22, border: "1px solid var(--border-warm)", boxShadow: "var(--shadow-warm-lg)", padding: 24 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, gap: 12 }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, color: "var(--ink-900)" }}>
                  Edit provider profile
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
                  These fields save to your Bundleen record. Verification and payouts are handled by
                  our team.
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  resetForm();
                  setEditing(false);
                }}
                style={{ background: "transparent", border: 0, fontSize: 22, cursor: "pointer", color: "var(--ink-500)" }}
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(
                [
                  ["Your name", "fullName"],
                  ["Phone", "phone"],
                  ["Company name", "companyName"],
                  ["Neighborhood", "neighborhood"],
                  ["Business address", "address"],
                  ["Trades (comma separated)", "trades"],
                  ["License number", "licenseNumber"],
                  ["License state", "licenseState"],
                  ["Insurance provider", "insuranceProvider"],
                  ["Insurance policy number", "insurancePolicyNumber"],
                ] as const
              ).map(([label, key]) => (
                <label key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={eyebrowStyle}>{label}</span>
                  <input
                    style={inputStyle}
                    value={form[key]}
                    onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  {fieldErrors[key] ? (
                    <span role="alert" style={{ fontSize: 12, color: "var(--danger-600)" }}>{fieldErrors[key]}</span>
                  ) : null}
                </label>
              ))}

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={eyebrowStyle}>Opens at</span>
                <input
                  type="time"
                  style={inputStyle}
                  value={form.workingHoursStart}
                  onChange={(event) => setForm((current) => ({ ...current, workingHoursStart: event.target.value }))}
                />
                {fieldErrors.workingHoursStart ? (
                  <span role="alert" style={{ fontSize: 12, color: "var(--danger-600)" }}>{fieldErrors.workingHoursStart}</span>
                ) : null}
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={eyebrowStyle}>Closes at</span>
                <input
                  type="time"
                  style={inputStyle}
                  value={form.workingHoursEnd}
                  onChange={(event) => setForm((current) => ({ ...current, workingHoursEnd: event.target.value }))}
                />
                {fieldErrors.workingHoursEnd ? (
                  <span role="alert" style={{ fontSize: 12, color: "var(--danger-600)" }}>{fieldErrors.workingHoursEnd}</span>
                ) : null}
              </label>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
                <span style={eyebrowStyle}>Working days</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {WEEKDAYS.map((day) => {
                    const selected = form.workingDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            workingDays: selected
                              ? current.workingDays.filter((value) => value !== day)
                              : [...current.workingDays, day],
                          }))
                        }
                        style={{
                          height: 32,
                          padding: "0 12px",
                          borderRadius: 999,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: "var(--font-body)",
                          background: selected ? "var(--terracotta-600)" : "var(--cream-100)",
                          color: selected ? "white" : "var(--ink-800)",
                          border: selected ? "1px solid var(--terracotta-600)" : "1px solid var(--border-warm)",
                        }}
                      >
                        {DAY_LABELS[day]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}>
                <span style={eyebrowStyle}>Bio</span>
                <textarea
                  value={form.bio}
                  maxLength={MAX_BIO_LENGTH}
                  onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
                  rows={5}
                  style={{ borderRadius: 12, border: "1px solid var(--border-warm)", padding: 12, fontSize: 14, color: "var(--ink-900)", fontFamily: "var(--font-body)", resize: "vertical", background: "var(--bg-card)" }}
                />
                <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                  {form.bio.length}/{MAX_BIO_LENGTH}
                </span>
                {fieldErrors.bio ? (
                  <span role="alert" style={{ fontSize: 12, color: "var(--danger-600)" }}>{fieldErrors.bio}</span>
                ) : null}
              </label>
            </div>

            {saveError ? (
              <div role="alert" style={{ marginTop: 14, fontSize: 13, color: "var(--danger-600)" }}>
                {saveError}
              </div>
            ) : null}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setEditing(false);
                }}
                style={ghostButtonStyle}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                style={{ ...primaryButtonStyle, opacity: saving ? 0.7 : 1, cursor: saving ? "default" : "pointer" }}
              >
                {saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
