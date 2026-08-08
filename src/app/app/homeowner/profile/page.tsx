"use client";

import { SignOutButton } from "@clerk/nextjs";
import { Icon } from "@/components/ui/Icon";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { useHomeownerProfile } from "@/hooks/useHomeownerProfile";

function IconEdit() {
  return <Icon name="edit" size={14} />;
}
function IconPin() {
  return <Icon name="map-pin" size={14} />;
}
function IconShield() {
  return <Icon name="shield" size={14} />;
}
function IconCheck() {
  return <Icon name="check-circle" size={14} />;
}
function IconStar() {
  return <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none"><path d="M12 2l3 6.5 7 .9-5.1 4.7 1.3 7-6.2-3.4-6.2 3.4 1.3-7L2 9.4l7-.9z"/></svg>;
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

const cardStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const iconbtn = {
  width: 32, height: 32, borderRadius: "50%", border: 0,
  background: "transparent", color: "var(--ink-500)",
  display: "grid" as const, placeItems: "center" as const, cursor: "pointer",
};

export default function HomeownerProfile() {
  const { profile, user, loading, saving, updateProfile } = useHomeownerProfile();
  const initials = user?.full_name?.split(" ").map((part) => part[0]).slice(0, 2).join("") ?? "NB";

  const notifRows = [
    { key: "notif_bids" as const, t: "Bid updates", s: "When providers submit or update bids", on: profile?.notif_bids ?? false, ch: ["Email", "Push"] },
    { key: "notif_groups" as const, t: "Group activity", s: "When neighbors join or comment", on: profile?.notif_groups ?? false, ch: ["Push"] },
    { key: "notif_savings" as const, t: "Savings reports", s: "Monthly recap of money saved", on: profile?.notif_savings ?? false, ch: ["Email"] },
  ];

  const quickLinks = [
    { t: "View my bids", s: "Active and past bookings", I: <IconBids />, href: "/app/homeowner/bids" },
    { t: "Savings history", s: "See what your groups have saved", I: <IconSpark />, href: "/app/homeowner/bids" },
    { t: "Neighborhood chat", s: "Open provider and group messages", I: <IconChat />, href: "/app/homeowner/chat" },
  ];

  if (loading) {
    return (
      <div style={{ background: "var(--bg-app)", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: "var(--ink-400)", fontSize: 14 }}>Loading account…</div>
      </div>
    );
  }

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>Account</h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>Profile, neighborhood, notifications.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <ThemeToggle compact />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)", border: "1px solid var(--sage-100)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} /> HOA verified
          </span>
          <button style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" }}>
            <IconEdit /> {saving ? "Saving…" : "Edit profile"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 px-4 pb-8 md:px-9 md:pb-9 lg:grid-cols-[1.5fr_1fr] lg:gap-[22px]" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div style={{ height: 88, position: "relative", background: "linear-gradient(120deg, #f9c99c, #f7ebd8 46%, var(--teal-50))" }}>
              <img
                src="/creative/illustrations/house-hero.svg"
                alt=""
                style={{ position: "absolute", right: 0, bottom: 0, width: "30%", opacity: 0.9 }}
              />
            </div>
            <div style={{ padding: "0 28px 24px", marginTop: -38 }}>
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:gap-4">
                <div style={{ width: 76, height: 76, borderRadius: "50%", background: "linear-gradient(135deg, var(--orange-500), var(--orange-600))", display: "grid", placeItems: "center", color: "white", fontSize: 24, fontWeight: 600, border: "4px solid white", boxShadow: "var(--shadow-warm-md)", flexShrink: 0 }}>
                  {initials}
                </div>
                <div style={{ flex: 1, paddingBottom: 6 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, letterSpacing: "-0.01em", color: "var(--ink-900)" }}>{user?.full_name ?? "Homeowner"}</div>
                  <div className="flex flex-wrap items-center" style={{ gap: 10, marginTop: 4, color: "var(--ink-500)", fontSize: 13 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      {[1, 2, 3, 4].map((star) => <span key={star} style={{ color: "var(--gold-500)" }}><IconStar /></span>)}
                      <span style={{ color: "var(--ink-200)" }}><IconStar /></span>
                      <span style={{ marginLeft: 4 }}>4.0 · 3 bookings</span>
                    </span>
                    <span className="hidden sm:inline" style={{ color: "var(--ink-300)" }}>·</span>
                    <span>Member since Nov 2024</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ padding: "20px 24px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Personal information</div>
              <button style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" }}>
                Edit all
              </button>
            </div>
            <div style={{ height: 1, background: "var(--border-warm)" }} />
            {[
              { k: "Full name", v: user?.full_name ?? "—" },
              { k: "Email", v: user?.email ?? "—" },
              { k: "Phone", v: user?.phone ?? "—" },
            ].map((row, i) => (
              <div key={row.k} className="grid grid-cols-[90px_1fr_auto] gap-x-3 px-4 py-3.5 md:grid-cols-[160px_1fr_auto] md:px-6" style={{ alignItems: "center", borderBottom: i < 2 ? "1px solid var(--border-warm)" : 0 }}>
                <div style={{ fontSize: 13, color: "var(--ink-500)" }}>{row.k}</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--ink-900)" }}>{row.v}</div>
                <button style={iconbtn}><IconEdit /></button>
              </div>
            ))}
          </div>

          <div style={cardStyle}>
            <div style={{ padding: "20px 24px 12px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Service area</div>
            </div>
            <div style={{ height: 1, background: "var(--border-warm)" }} />
            <div className="grid grid-cols-1 gap-5 px-4 py-4 md:grid-cols-[1.2fr_1fr] md:gap-6 md:px-6" style={{ alignItems: "center" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ color: "var(--terracotta-600)" }}><IconPin /></span>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{user?.address ?? "Address not set"}</div>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 16 }}>Used to match local providers and neighbor groups.</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: "var(--ink-500)" }}>Community radius</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--terracotta-600)" }}>4 mi</div>
                </div>
                <div style={{ height: 6, background: "var(--cream-200)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: "26.6%", height: "100%", background: "var(--terracotta-500)", borderRadius: 999 }} />
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
              <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Notifications</div>
            </div>
            <div style={{ height: 1, background: "var(--border-warm)" }} />
            {notifRows.map((notif, i) => (
              <div key={notif.key} className="flex flex-wrap items-center gap-3 px-4 py-3.5 md:px-6" style={{ borderBottom: i < 2 ? "1px solid var(--border-warm)" : 0 }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{notif.t}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{notif.s}</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {notif.ch.map((channel) => (
                    <span key={channel} style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: "var(--cream-100)", color: "var(--ink-700)", border: "1px solid var(--border-warm)" }}>
                      {channel}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => void updateProfile({ [notif.key]: !notif.on })}
                  style={{ width: 38, height: 22, borderRadius: 11, background: notif.on ? "var(--sage-600)" : "var(--cream-300)", position: "relative", cursor: "pointer", flexShrink: 0, border: 0 }}
                >
                  <div style={{ position: "absolute", top: 2, left: notif.on ? 18 : 2, width: 18, height: 18, borderRadius: "50%", background: "var(--bg-card)", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.15s" }} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ background: "linear-gradient(160deg, var(--cream-100), var(--cream-200))", borderRadius: 22, padding: 24, border: "1px solid var(--border-warm)" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Your impact</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 14 }}>
              {[
                { num: "4 mi", label: "Radius", color: "var(--terracotta-600)" },
                { num: user?.neighborhood ?? "—", label: "Neighborhood", color: "var(--ink-900)" },
                { num: `${Number(profile?.notif_bids ?? false) + Number(profile?.notif_groups ?? false) + Number(profile?.notif_savings ?? false)}`, label: "Alerts on", color: "var(--ink-900)" },
              ].map((stat) => (
                <div key={stat.label}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 28, color: stat.color, lineHeight: 1, letterSpacing: "-0.02em" }}>{stat.num}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 4 }}>{stat.label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: "var(--sage-50)", color: "var(--sage-700)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <IconShield />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink-900)" }}>HOA verified</div>
                <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{user?.neighborhood ?? "Neighborhood"} · homeowner</div>
              </div>
              <span style={{ color: "var(--sage-700)" }}><IconCheck /></span>
            </div>
          </div>

          <div style={{ ...cardStyle, padding: "20px 22px" }}>
            <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600, marginBottom: 10 }}>Quick links</div>
            {quickLinks.map((link, i) => (
              <a
                key={link.t}
                href={link.href}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: i ? "1px solid var(--border-warm)" : "0", textDecoration: "none", color: "var(--ink-900)" }}
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
              <button style={{ display: "inline-flex", alignItems: "center", height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--danger-600)", border: "1px solid rgba(182,68,48,0.3)", fontFamily: "var(--font-body)" }}>
                Sign out
              </button>
            </SignOutButton>
          </div>
        </div>
      </div>
    </div>
  );
}
