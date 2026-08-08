"use client";

import { SignOutButton } from "@clerk/nextjs";
import { useEffect, useState, type CSSProperties } from "react";

import { AvatarField } from "@/components/profile/AvatarField";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useHomeownerProfile } from "@/hooks/useHomeownerProfile";
import type { HomeownerProfile } from "@/lib/profile-types";

function IconEdit() {
  return <Icon name="edit" size={14} />;
}
function IconPin() {
  return <Icon name="map-pin" size={14} />;
}
function IconBids() {
  return <Icon name="bids" size={16} />;
}
function IconSpark() {
  return <Icon name="sparkle" size={16} />;
}
function IconChat() {
  return <Icon name="chat" size={16} />;
}
function IconArrowR() {
  return <Icon name="arrow-right" size={14} />;
}

const cardStyle: CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const eyebrowStyle: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.10em",
  color: "var(--ink-400)",
  fontWeight: 600,
};

const pillButtonStyle: CSSProperties = {
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
  ...pillButtonStyle,
  background: "var(--terracotta-600)",
  color: "white",
  border: 0,
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

/** The fields this screen may write. Everything else on the page is read-only. */
type PersonalForm = {
  fullName: string;
  phone: string;
  address: string;
  neighborhood: string;
};

const EMPTY_FORM: PersonalForm = { fullName: "", phone: "", address: "", neighborhood: "" };

function FieldRow(props: {
  label: string;
  value: string | null;
  editing: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-1 px-4 py-3.5 md:grid-cols-[160px_1fr] md:gap-x-3 md:px-6"
      style={{ alignItems: props.editing ? "start" : "center", borderTop: "1px solid var(--border-warm)" }}
    >
      <div style={{ fontSize: 13, color: "var(--ink-500)", paddingTop: props.editing ? 10 : 0 }}>
        {props.label}
      </div>
      {props.editing ? (
        <div>
          {props.children}
          {props.error ? (
            <div role="alert" style={{ marginTop: 5, fontSize: 12, color: "var(--danger-600)" }}>
              {props.error}
            </div>
          ) : null}
        </div>
      ) : (
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: props.value ? "var(--ink-900)" : "var(--ink-400)",
          }}
        >
          {props.value || "Not added yet"}
        </div>
      )}
    </div>
  );
}

export default function HomeownerProfilePage() {
  const {
    profile,
    homeowner,
    loading,
    saving,
    error,
    saveError,
    fieldErrors,
    uploadProgress,
    reload,
    saveProfile,
    saveNotifications,
    changeAvatar,
    clearAvatar,
  } = useHomeownerProfile();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<PersonalForm>(EMPTY_FORM);

  // The form mirrors the server record whenever a fresh one arrives, so a
  // successful save and a background reload both leave the inputs correct.
  useEffect(() => {
    if (!profile) return;
    setForm({
      fullName: profile.fullName,
      phone: profile.phone ?? "",
      address: profile.address ?? "",
      neighborhood: profile.neighborhood ?? "",
    });
  }, [profile]);

  const notifRows: Array<{ key: keyof HomeownerProfile; title: string; hint: string }> = [
    { key: "notifyBids", title: "Bid updates", hint: "When providers submit or update bids" },
    { key: "notifyGroups", title: "Group activity", hint: "When neighbors join or comment" },
    { key: "notifySavings", title: "Savings reports", hint: "Monthly recap of money saved" },
    { key: "notifyEmail", title: "Email", hint: "Receive the above by email" },
    { key: "notifyPush", title: "Push", hint: "Receive the above as push notifications" },
  ];

  const quickLinks = [
    { t: "View my bids", s: "Active and past bookings", I: <IconBids />, href: "/app/homeowner/bids" },
    { t: "Savings history", s: "See what your groups have saved", I: <IconSpark />, href: "/app/homeowner/bids" },
    { t: "Neighborhood chat", s: "Open provider and group messages", I: <IconChat />, href: "/app/homeowner/chat" },
  ];

  async function handleSave() {
    const saved = await saveProfile({
      fullName: form.fullName.trim(),
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
      neighborhood: form.neighborhood.trim() || null,
    });
    if (saved) setEditing(false);
  }

  function handleCancel() {
    if (profile) {
      setForm({
        fullName: profile.fullName,
        phone: profile.phone ?? "",
        address: profile.address ?? "",
        neighborhood: profile.neighborhood ?? "",
      });
    }
    setEditing(false);
  }

  if (loading) {
    return (
      <div style={{ background: "var(--bg-app)", minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div style={{ color: "var(--ink-400)", fontSize: 14 }}>Loading account…</div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ background: "var(--bg-app)", minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ ...cardStyle, padding: 28, maxWidth: 420, textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--ink-900)" }}>
            Account unavailable
          </div>
          <p style={{ margin: "8px 0 18px", fontSize: 14, color: "var(--ink-500)", lineHeight: 1.5 }}>
            {error ?? "We could not load your account."}
          </p>
          <button type="button" style={{ ...primaryButtonStyle, width: "100%", justifyContent: "center" }} onClick={() => void reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const memberSince = new Date(profile.createdAt).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
  const alertsOn = homeowner
    ? [homeowner.notifyBids, homeowner.notifyGroups, homeowner.notifySavings].filter(Boolean).length
    : 0;

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>
            Account
          </h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>Profile, neighborhood, notifications.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ThemeToggle compact />
          {/* Status, not decoration: this reflects the verification the server
              recorded, so an unverified account says so. */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              borderRadius: 999,
              fontSize: 11.5,
              fontWeight: 600,
              background: profile.isVerified ? "var(--sage-50)" : "var(--cream-100)",
              color: profile.isVerified ? "var(--sage-700)" : "var(--ink-500)",
              border: `1px solid ${profile.isVerified ? "var(--sage-100)" : "var(--border-warm)"}`,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
            {profile.isVerified ? "Email verified" : "Email not verified"}
          </span>
        </div>
      </div>

      {saveError ? (
        <div
          role="alert"
          className="mx-4 mb-4 md:mx-9"
          style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(182,68,48,0.08)", color: "var(--danger-600)", fontSize: 13, border: "1px solid rgba(182,68,48,0.24)" }}
        >
          {saveError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 px-4 pb-8 md:px-9 md:pb-9 lg:grid-cols-[1.5fr_1fr] lg:gap-[22px]" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div style={{ height: 88, position: "relative", background: "linear-gradient(120deg, #f9c99c, #f7ebd8 46%, var(--teal-50))" }}>
              <img src="/creative/illustrations/house-hero.svg" alt="" style={{ position: "absolute", right: 0, bottom: 0, width: "30%", opacity: 0.9 }} />
            </div>
            <div style={{ padding: "0 28px 24px", marginTop: -38 }}>
              <AvatarField
                url={profile.avatarUrl}
                name={profile.fullName}
                progress={uploadProgress}
                onSelect={(file) => void changeAvatar(file)}
                onRemove={() => void clearAvatar()}
              />
              <div style={{ marginTop: 14 }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, letterSpacing: "-0.01em", color: "var(--ink-900)" }}>
                  {profile.fullName}
                </div>
                <div style={{ marginTop: 4, color: "var(--ink-500)", fontSize: 13 }}>
                  Member since {memberSince}
                </div>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ padding: "20px 24px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={eyebrowStyle}>Personal information</div>
              {editing ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={{ ...pillButtonStyle, height: 32 }} onClick={handleCancel} disabled={saving}>
                    Cancel
                  </button>
                  <button type="button" style={{ ...primaryButtonStyle, height: 32 }} onClick={() => void handleSave()} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              ) : (
                <button type="button" style={{ ...pillButtonStyle, height: 32 }} onClick={() => setEditing(true)}>
                  <IconEdit /> Edit
                </button>
              )}
            </div>

            <FieldRow label="Full name" value={profile.fullName} editing={editing} error={fieldErrors.fullName}>
              <input
                aria-label="Full name"
                style={inputStyle}
                value={form.fullName}
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
              />
            </FieldRow>

            {/* Owned by Clerk, so it is shown but never editable here. */}
            <FieldRow label="Email" value={profile.email} editing={false}>
              {null}
            </FieldRow>

            <FieldRow label="Phone" value={profile.phone} editing={editing} error={fieldErrors.phone}>
              <input
                aria-label="Phone"
                type="tel"
                style={inputStyle}
                value={form.phone}
                onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              />
            </FieldRow>

            <FieldRow label="Address" value={profile.address} editing={editing} error={fieldErrors.address}>
              <input
                aria-label="Address"
                style={inputStyle}
                value={form.address}
                onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
              />
            </FieldRow>

            <FieldRow label="Neighborhood" value={profile.neighborhood} editing={editing} error={fieldErrors.neighborhood}>
              <input
                aria-label="Neighborhood"
                style={inputStyle}
                value={form.neighborhood}
                onChange={(event) => setForm((current) => ({ ...current, neighborhood: event.target.value }))}
              />
            </FieldRow>
          </div>

          <div style={cardStyle}>
            <div style={{ padding: "20px 24px 12px" }}>
              <div style={eyebrowStyle}>Service area</div>
            </div>
            <div style={{ height: 1, background: "var(--border-warm)" }} />
            <div className="grid grid-cols-1 gap-5 px-4 py-4 md:grid-cols-[1.2fr_1fr] md:gap-6 md:px-6" style={{ alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ color: "var(--terracotta-600)" }}><IconPin /></span>
                  <div style={{ fontWeight: 600, fontSize: 14, color: profile.address ? "var(--ink-900)" : "var(--ink-400)" }}>
                    {profile.address ?? "Address not set"}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 16 }}>
                  Used to match local providers and neighbor groups.
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: "var(--ink-500)" }}>Community radius</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--terracotta-600)" }}>
                    {profile.communityRadiusMi} mi
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--ink-400)" }}>
                  Fixed for every Bundleen neighborhood.
                </div>
              </div>
              <div style={{ position: "relative", height: 140, borderRadius: 14, overflow: "hidden", background: "var(--sage-50)" }}>
                <svg viewBox="0 0 200 140" width="100%" height="100%" preserveAspectRatio="none">
                  <rect width="200" height="140" fill="#EBF1EC" />
                  <path d="M0 60 L60 50 L100 70 L160 55 L200 65 L200 80 L0 80 Z" fill="#DCE7DD" />
                  <path d="M20 100 L80 90 L130 110 L200 100 L200 140 L0 140 Z" fill="#C9DBCB" />
                  <path d="M0 30 H200" stroke="#B5C9B7" strokeWidth="0.6" strokeDasharray="2 3" />
                  <circle cx="100" cy="70" r="38" fill="rgba(217,101,35,0.10)" stroke="rgba(217,101,35,0.4)" strokeWidth="1" strokeDasharray="3 3" />
                  <circle cx="100" cy="70" r="6" style={{ fill: "var(--orange-600)" }} stroke="white" strokeWidth="2" />
                </svg>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ padding: "20px 24px 12px" }}>
              <div style={eyebrowStyle}>Notifications</div>
            </div>
            {notifRows.map((notif) => {
              const on = homeowner ? Boolean(homeowner[notif.key]) : false;
              return (
                <div
                  key={String(notif.key)}
                  className="flex flex-wrap items-center gap-3 px-4 py-3.5 md:px-6"
                  style={{ borderTop: "1px solid var(--border-warm)" }}
                >
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{notif.title}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{notif.hint}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={notif.title}
                    disabled={!homeowner}
                    onClick={() => void saveNotifications({ [notif.key]: !on })}
                    style={{
                      width: 38,
                      height: 22,
                      borderRadius: 11,
                      background: on ? "var(--sage-600)" : "var(--cream-300)",
                      position: "relative",
                      cursor: homeowner ? "pointer" : "default",
                      flexShrink: 0,
                      border: 0,
                    }}
                  >
                    <div style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "var(--bg-card)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.15s" }} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ background: "linear-gradient(160deg, var(--cream-100), var(--cream-200))", borderRadius: 22, padding: 24, border: "1px solid var(--border-warm)" }}>
            <div style={eyebrowStyle}>Your community</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 14 }}>
              {[
                { num: `${profile.communityRadiusMi} mi`, label: "Radius", color: "var(--terracotta-600)" },
                { num: profile.neighborhood ?? "—", label: "Neighborhood", color: "var(--ink-900)" },
                { num: String(alertsOn), label: "Alerts on", color: "var(--ink-900)" },
              ].map((stat) => (
                <div key={stat.label}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 28, color: stat.color, lineHeight: 1, letterSpacing: "-0.02em" }}>
                    {stat.num}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 4 }}>{stat.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...cardStyle, padding: "20px 22px" }}>
            <div style={{ ...eyebrowStyle, marginBottom: 10 }}>Quick links</div>
            {quickLinks.map((link, index) => (
              <a
                key={link.t}
                href={link.href}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: index ? "1px solid var(--border-warm)" : "0", textDecoration: "none", color: "var(--ink-900)" }}
              >
                <div style={{ width: 32, height: 32, borderRadius: 9, background: "var(--cream-100)", color: "var(--terracotta-600)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  {link.I}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{link.t}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{link.s}</div>
                </div>
                <span style={{ color: "var(--ink-400)" }}><IconArrowR /></span>
              </a>
            ))}
          </div>

          <div style={{ ...cardStyle, padding: 18, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-900)" }}>Sign out</div>
              <div style={{ fontSize: 11, color: "var(--ink-500)" }}>End session on this device</div>
            </div>
            <SignOutButton redirectUrl="/">
              <button type="button" style={{ ...pillButtonStyle, height: 30, fontSize: 13, color: "var(--danger-600)", borderColor: "rgba(182,68,48,0.3)" }}>
                Sign out
              </button>
            </SignOutButton>
          </div>
        </div>
      </div>
    </div>
  );
}
