"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderReviews } from "@/hooks/useProviderReviews";
import { useProviderDashboard } from "@/hooks/useProviderDashboard";
import { useProviderEarnings } from "@/hooks/useProviderEarnings";
import { useProviderBids } from "@/hooks/useProviderBids";
import { logout } from "@/lib/auth";

const cardStyle: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const cardPadStyle: CSSProperties = {
  ...cardStyle,
  padding: 22,
};

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
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  height: 38,
  padding: "0 16px",
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  background: "var(--terracotta-600)",
  color: "white",
  border: 0,
  fontFamily: "var(--font-body)",
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

function fmtMoney(cents: number) {
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function ProfileField(props: { label: string; value: string }) {
  return (
    <div>
      <div style={eyebrowStyle}>{props.label}</div>
      <div style={{ marginTop: 6, fontSize: 14, color: "var(--ink-900)", lineHeight: 1.5 }}>{props.value}</div>
    </div>
  );
}

export default function ProviderProfilePage() {
  const { profile, user, loading, saving, error, updateProfile } = useProviderProfile();
  const { avgRating, reviews } = useProviderReviews();
  const { dashboard } = useProviderDashboard();
  const { earnings } = useProviderEarnings();
  const { bids } = useProviderBids();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    company_name: "",
    bio: "",
    trades: "",
    neighborhood: "",
    address: "",
    service_radius_mi: 4,
    working_days: "",
    working_hours_start: "",
    working_hours_end: "",
    license_number: "",
    bank_last4: "",
    is_insured: false,
    is_licensed: false,
  });
  const providerNeighborhood = profile?.neighborhood || user?.neighborhood || "Area not set";
  const providerAddress = profile?.address || user?.address || "Not set";

  useEffect(() => {
    if (!profile) return;
    setForm({
      company_name: profile.company_name ?? "",
      bio: profile.bio ?? "",
      trades: profile.trades ?? "",
      neighborhood: profile.neighborhood ?? user?.neighborhood ?? "",
      address: profile.address ?? user?.address ?? "",
      service_radius_mi: profile.service_radius_mi ?? 4,
      working_days: profile.working_days ?? "",
      working_hours_start: profile.working_hours_start ?? "",
      working_hours_end: profile.working_hours_end ?? "",
      license_number: profile.license_number ?? "",
      bank_last4: profile.bank_last4 ?? "",
      is_insured: profile.is_insured,
      is_licensed: profile.is_licensed,
    });
  }, [profile, user]);

  const trades = useMemo(
    () => (profile?.trades ?? "").split(",").map((trade) => trade.trim()).filter(Boolean),
    [profile?.trades]
  );

  const pendingBids = bids.filter((bid) => bid.status === "pending");
  const acceptedBids = bids.filter((bid) => bid.status === "accepted");
  const avgLeadDays =
    bids.length > 0
      ? (bids.reduce((sum, bid) => sum + bid.estimated_days, 0) / bids.length).toFixed(1)
      : "—";

  async function handleSave() {
    await updateProfile({
      company_name: form.company_name,
      bio: form.bio,
      trades: form.trades,
      neighborhood: form.neighborhood,
      address: form.address,
      service_radius_mi: Number(form.service_radius_mi),
      working_days: form.working_days,
      working_hours_start: form.working_hours_start,
      working_hours_end: form.working_hours_end,
      license_number: form.license_number || null,
      bank_last4: form.bank_last4 || null,
      is_insured: form.is_insured,
      is_licensed: form.is_licensed,
    });
    setEditing(false);
  }

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>
            Profile &amp; business
          </h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>Live provider profile, service area, verification, payouts, and reviews</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" onClick={() => setEditing(true)} style={ghostButtonStyle}>
            <IconEdit />
            Edit public profile
          </button>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: profile?.is_insured || profile?.is_licensed ? "var(--sage-50)" : "var(--cream-100)", color: profile?.is_insured || profile?.is_licensed ? "var(--sage-700)" : "var(--ink-700)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
            {profile?.is_insured || profile?.is_licensed ? "Verified business" : "Verification incomplete"}
          </span>
        </div>
      </div>

      <div className="px-4 pb-8 md:px-9 md:pb-9">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr] lg:gap-[22px]" style={{ alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
              <div style={{ height: 88, background: "linear-gradient(135deg, var(--terracotta-100), var(--cream-200) 50%, var(--sage-100))" }} />
              <div style={{ padding: "0 28px 24px", marginTop: -36 }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
                  <div
                    style={{
                      width: 76,
                      height: 76,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, var(--orange-500), var(--orange-600))",
                      color: "white",
                      border: "4px solid white",
                      boxShadow: "var(--shadow-warm-md)",
                      fontFamily: "var(--font-display)",
                      fontSize: 22,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {(profile?.company_name ?? user?.full_name ?? "PB").split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}
                  </div>
                  <div style={{ flex: 1, paddingBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, color: "var(--ink-900)" }}>
                        {loading ? "…" : (profile?.company_name ?? user?.full_name ?? "Your business")}
                      </div>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)" }}>
                        <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
                        {providerNeighborhood}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
                      {[profile?.is_licensed ? "Licensed" : null, profile?.is_insured ? "Insured" : null, `${profile?.service_radius_mi ?? 0} mi radius`].filter(Boolean).join(" · ")}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 13, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--gold-600)", display: "inline-flex", alignItems: "center", gap: 2 }}>
                        {[1, 2, 3, 4, 5].map((index) => (
                          <IconStar key={index} color="var(--gold-500)" />
                        ))}
                        <strong style={{ color: "var(--ink-900)", marginLeft: 4 }}>{avgRating ?? "—"}</strong>
                      </span>
                      <span style={{ color: "var(--ink-500)" }}>· {reviews.length} reviews on Bundleen</span>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 18, fontSize: 14, color: "var(--ink-700)", lineHeight: 1.6 }}>
                  {profile?.bio || "No business description yet. Add your specialties, experience, and what customers can expect."}
                </div>
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Performance · live</div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-3.5" style={{ marginTop: 14 }}>
                <PStat big={fmtMoney(earnings?.total_cents ?? 0)} label="Earnings" tone="terracotta" />
                <PStat big={`${dashboard?.win_rate_pct?.toFixed(0) ?? 0}%`} label="Win rate" tone="sage" />
                <PStat big={String(avgRating ?? "—")} label="Rating" tone="gold" />
                <PStat big={String(avgLeadDays)} label="Avg lead days" tone="ink" />
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Business details</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-[18px]" style={{ marginTop: 14 }}>
                <ProfileField label="Service area" value={`${providerNeighborhood} · ${profile?.service_radius_mi ?? 0} mi radius`} />
                <ProfileField label="Working hours" value={profile ? `${profile.working_days} · ${profile.working_hours_start} – ${profile.working_hours_end}` : "Not set"} />
                <ProfileField label="Business address" value={providerAddress} />
                <ProfileField label="Payout account" value={profile?.bank_last4 ? `Bank account •••• ${profile.bank_last4}` : "No payout method on file"} />
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Recent customer reviews</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
                {reviews.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--ink-500)" }}>No homeowner reviews yet.</div>
                ) : reviews.slice(0, 4).map((review) => (
                  <div key={review.id} style={{ padding: "14px 16px", borderRadius: 14, background: "var(--cream-50)", border: "1px solid var(--border-warm)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{review.homeowner_name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{new Date(review.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                    </div>
                    <div style={{ marginTop: 6, display: "flex", gap: 2 }}>
                      {Array.from({ length: review.stars }).map((_, index) => <IconStar key={index} color="var(--gold-500)" />)}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 13, color: "var(--ink-700)", lineHeight: 1.5 }}>{review.comment ?? "No written comment."}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ ...cardStyle, padding: 18, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-900)" }}>Sign out</div>
                <div style={{ fontSize: 11, color: "var(--ink-500)" }}>End session on this device</div>
              </div>
              <button type="button" onClick={logout} style={{ ...ghostButtonStyle, color: "var(--danger-600)", borderColor: "rgba(182,68,48,0.3)", height: 34 }}>
                Sign out
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18, position: "sticky", top: 0 }}>
            <div style={{ background: "linear-gradient(160deg, var(--terracotta-50), var(--cream-100))", borderRadius: 22, padding: 24, border: "1px solid var(--border-warm)" }}>
              <div style={eyebrowStyle}>Next payout</div>
              <div style={{ ...numeralStyle, fontSize: 38, color: "var(--terracotta-600)", marginTop: 6 }}>{fmtMoney(earnings?.total_cents ?? 0)}</div>
              <div style={{ fontSize: 12, color: "var(--ink-500)" }}>Booked revenue currently reflected in your account</div>
              <div style={{ borderTop: "1px solid var(--border-warm)", marginTop: 18, paddingTop: 14, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-500)" }}>Completed jobs</span><span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{acceptedBids.length}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-500)" }}>Gross earnings</span><span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{fmtMoney(earnings?.total_cents ?? 0)}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-500)" }}>Pending pipeline</span><span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{fmtMoney(pendingBids.reduce((sum, bid) => sum + bid.amount, 0))}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-500)" }}>This month</span><span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{fmtMoney(earnings?.this_month_cents ?? 0)}</span></div>
              </div>
              <Link href="/app/provider/earnings" style={{ ...smallQuietButtonStyle, width: "100%", marginTop: 12, background: "var(--bg-card)", justifyContent: "center", textDecoration: "none" }}>
                View full payout breakdown
              </Link>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Verification status</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                {[
                  ["Business license", profile?.is_licensed ? `Verified${profile.license_number ? ` · ${profile.license_number}` : ""}` : "Not verified"],
                  ["Liability insurance", profile?.is_insured ? "Verified" : "Not verified"],
                  ["Service radius", `${profile?.service_radius_mi ?? 0} miles configured`],
                  ["Neighborhood", providerNeighborhood],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 22, height: 22, borderRadius: "50%", background: value.startsWith("Verified") ? "var(--sage-50)" : "var(--cream-100)", color: value.startsWith("Verified") ? "var(--sage-700)" : "var(--ink-500)", display: "grid", placeItems: "center" }}>
                      <IconCheck />
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-900)" }}>{label}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Trades offered</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {trades.length === 0 ? (
                  <span style={{ fontSize: 13, color: "var(--ink-500)" }}>No trades configured yet.</span>
                ) : trades.map((trade) => (
                  <span key={trade} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--terracotta-50)", color: "var(--terracotta-600)" }}>
                    {trade}
                  </span>
                ))}
              </div>
            </div>

            <div style={cardPadStyle}>
              <div style={eyebrowStyle}>Live account summary</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-500)" }}>Unread messages</span><span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{dashboard?.unread_messages ?? 0}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-500)" }}>Active bids</span><span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{dashboard?.active_bids ?? 0}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-500)" }}>Reviews</span><span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{dashboard?.reviews_count ?? 0}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--ink-500)" }}>Email</span><span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{user?.email ?? "—"}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {editing ? (
        <div
          onClick={() => setEditing(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(20,16,12,0.24)", display: "grid", placeItems: "center", padding: 24, zIndex: 50 }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(780px, 100%)", background: "var(--bg-card)", borderRadius: 22, border: "1px solid var(--border-warm)", boxShadow: "var(--shadow-warm-lg)", padding: 24 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, color: "var(--ink-900)" }}>Edit provider profile</div>
                <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>These fields save directly to your provider record.</div>
              </div>
              <button onClick={() => setEditing(false)} style={{ background: "transparent", border: 0, fontSize: 22, cursor: "pointer", color: "var(--ink-500)" }}>×</button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" style={{ }}>
              {[
                ["Company name", "company_name"],
                ["Neighborhood", "neighborhood"],
                ["Address", "address"],
                ["Trades (comma separated)", "trades"],
                ["Working days", "working_days"],
                ["Working hours start", "working_hours_start"],
                ["Working hours end", "working_hours_end"],
                ["License number", "license_number"],
                ["Bank last4", "bank_last4"],
              ].map(([label, key]) => (
                <label key={key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={eyebrowStyle}>{label}</span>
                  <input
                    value={String(form[key as keyof typeof form] ?? "")}
                    onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                    style={{ height: 40, borderRadius: 12, border: "1px solid var(--border-warm)", padding: "0 12px", fontSize: 14, color: "var(--ink-900)", fontFamily: "var(--font-body)" }}
                  />
                </label>
              ))}
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={eyebrowStyle}>Service radius (miles)</span>
                <input
                  type="number"
                  min={1}
                  value={form.service_radius_mi}
                  onChange={(event) => setForm((current) => ({ ...current, service_radius_mi: Number(event.target.value) }))}
                  style={{ height: 40, borderRadius: 12, border: "1px solid var(--border-warm)", padding: "0 12px", fontSize: 14, color: "var(--ink-900)", fontFamily: "var(--font-body)" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={eyebrowStyle}>Bio</span>
                <textarea
                  value={form.bio}
                  onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
                  rows={5}
                  style={{ borderRadius: 12, border: "1px solid var(--border-warm)", padding: "12px", fontSize: 14, color: "var(--ink-900)", fontFamily: "var(--font-body)", resize: "vertical" }}
                />
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--ink-900)" }}>
                  <input type="checkbox" checked={form.is_licensed} onChange={(event) => setForm((current) => ({ ...current, is_licensed: event.target.checked }))} />
                  Licensed
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--ink-900)" }}>
                  <input type="checkbox" checked={form.is_insured} onChange={(event) => setForm((current) => ({ ...current, is_insured: event.target.checked }))} />
                  Insured
                </label>
              </div>
            </div>

            {error ? <div style={{ marginTop: 14, fontSize: 13, color: "var(--danger-600)" }}>{error}</div> : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button onClick={() => setEditing(false)} style={ghostButtonStyle}>Cancel</button>
              <button onClick={() => void handleSave()} disabled={saving} style={{ ...primaryButtonStyle, opacity: saving ? 0.7 : 1, cursor: saving ? "default" : "pointer" }}>
                {saving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
