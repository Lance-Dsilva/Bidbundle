"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { CategoryTile } from "@/components/ui/CategoryArt";
import { CountdownRing } from "@/components/ui/CountdownRing";
import { PageSkeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useHomeownerBids } from "@/hooks/useHomeownerBids";
import { useHomeownerGroups } from "@/hooks/useHomeownerGroups";
import type { HomeownerGroup } from "@/hooks/useHomeownerGroups";
import { useHomeownerRequests } from "@/hooks/useHomeownerRequests";
import { useQuoteSummary } from "@/hooks/useQuoteSummary";
import type { QuoteSummaryResult } from "@/hooks/useQuoteSummary";
import { useDisputeMediator } from "@/hooks/useDisputeMediator";
import type { DisputeResult } from "@/hooks/useDisputeMediator";
import { Icon } from "@/components/ui/Icon";

function IconSearch() {
  return <Icon name="search" size={14} />;
}
function IconPlus() {
  return <Icon name="plus" size={14} />;
}
function IconWrench() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 6a4 4 0 0 1 5 5l-9 9-4 1 1-4 9-9z"/></svg>;
}
function IconLeaf() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 19c0-9 7-14 16-14-1 9-5 16-14 16a4 4 0 0 1-2-2z"/><path d="M5 19l8-8"/></svg>;
}
function IconBroom() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4l6 6-7 7H6v-7z"/><path d="M6 14l-3 6 6-3"/></svg>;
}
function IconEdit() {
  return <Icon name="edit" size={14} />;
}
function IconMessage() {
  return <Icon name="chat" size={14} />;
}
function IconStar() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M12 2l3 6.5 7 .9-5.1 4.7 1.3 7-6.2-3.4-6.2 3.4 1.3-7L2 9.4l7-.9z"/></svg>;
}
function IconUsers() {
  return <Icon name="users" size={16} />;
}

const cardStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-warm)",
  borderRadius: 18,
  boxShadow: "var(--shadow-warm-sm)",
};

const btnPrimary = {
  display: "inline-flex" as const, alignItems: "center" as const, gap: 8,
  height: 38, padding: "0 16px", borderRadius: 999,
  fontSize: 14, fontWeight: 600, cursor: "pointer",
  background: "var(--terracotta-600)", color: "white", border: 0,
  fontFamily: "var(--font-body)",
  boxShadow: "0 1px 0 rgba(0,0,0,0.05) inset, 0 6px 14px -6px rgba(232,98,63,0.5)",
};
const btnGhost = {
  display: "inline-flex" as const, alignItems: "center" as const, gap: 8,
  height: 38, padding: "0 16px", borderRadius: 999,
  fontSize: 14, fontWeight: 600, cursor: "pointer",
  background: "transparent", color: "var(--ink-700)",
  border: "1px solid var(--border-warm-strong)",
  fontFamily: "var(--font-body)",
};
const btnSmQuiet = {
  display: "inline-flex" as const, alignItems: "center" as const, gap: 8,
  height: 30, padding: "0 12px", borderRadius: 999,
  fontSize: 13, fontWeight: 600, cursor: "pointer",
  background: "var(--cream-100)", color: "var(--ink-900)", border: 0,
  fontFamily: "var(--font-body)",
};
const btnSmGhost = {
  display: "inline-flex" as const, alignItems: "center" as const, gap: 8,
  height: 30, padding: "0 12px", borderRadius: 999,
  fontSize: 13, fontWeight: 600, cursor: "pointer",
  background: "transparent", color: "var(--ink-700)",
  border: "1px solid var(--border-warm-strong)",
  fontFamily: "var(--font-body)",
};

function iconForIndex(index: number) {
  if (index % 3 === 0) return <IconWrench />;
  if (index % 3 === 1) return <IconLeaf />;
  return <IconBroom />;
}

function iconBgForIndex(index: number) {
  if (index % 3 === 0) return "linear-gradient(135deg,#6F8DB8,#3F608E)";
  if (index % 3 === 1) return "linear-gradient(135deg,#7A9A7E,#4A6A4D)";
  return "linear-gradient(135deg,#D6A23E,#B8862B)";
}

export default function HomeownerBids() {
  const router = useRouter();
  const toast = useToast();
  const { requests, loading: reqLoading } = useHomeownerRequests();
  const { bids, loading: bidsLoading, acceptBid, declineBid } = useHomeownerBids();
  const { groups, loading: groupsLoading, approveGroup, cancelGroup } = useHomeownerGroups();
  const loading = reqLoading || bidsLoading;
  const { summariseQuote, loading: quoteLoading, error: quoteError } = useQuoteSummary();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [quoteResult, setQuoteResult] = useState<QuoteSummaryResult | null>(null);
  const [showQuotePanel, setShowQuotePanel] = useState(false);
  const { submitDispute, loading: disputeLoading } = useDisputeMediator();
  const [disputeBidId, setDisputeBidId] = useState<number | null>(null);
  const [disputeComplaint, setDisputeComplaint] = useState("");
  const [disputeResult, setDisputeResult] = useState<DisputeResult | null>(null);
  const [messagingProviderId, setMessagingProviderId] = useState<number | null>(null);
  const [groupActionId, setGroupActionId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "active" | "completed" | "archived">("all");

  async function startConversation(providerId: number) {
    const token = getToken();
    if (!token) return;
    setMessagingProviderId(providerId);
    try {
      await apiFetch<{ id: number }>(`/homeowner/conversations?other_user_id=${providerId}`, {
        method: "POST",
        token,
      });
      router.push("/app/homeowner/chat");
    } catch {
      // ignore
    } finally {
      setMessagingProviderId(null);
    }
  }

  const pendingBids = bids.filter((bid) => bid.status === "pending");
  const acceptedBids = bids.filter((bid) => bid.status === "accepted");
  const archivedBids = bids.filter((bid) => bid.status === "declined");
  const closedRequests = requests.filter((request) => request.status === "closed");
  const activeGroups = groups.filter((group) => group.status !== "cancelled");

  const stats = [
    {
      eyebrow: "Total saved",
      big: `$${Math.round(acceptedBids.reduce((sum, bid) => sum + bid.amount, 0) / 100).toLocaleString()}`,
      sub: "accepted bids",
      numColor: "var(--terracotta-600)",
      barColor: "var(--terracotta-500)",
    },
    {
      eyebrow: "Booked",
      big: `${acceptedBids.length}`,
      sub: "accepted bids",
      numColor: "var(--ink-900)",
      barColor: "var(--ink-200)",
    },
    {
      eyebrow: "Active now",
      big: `${pendingBids.length}`,
      sub: "pending bids",
      numColor: "var(--sage-700)",
      barColor: "var(--sage-500)",
    },
    {
      eyebrow: "Completed",
      big: `${closedRequests.length}`,
      sub: "closed requests",
      numColor: "var(--gold-600)",
      barColor: "var(--gold-500)",
    },
  ];

  function renderGroupCard(group: HomeownerGroup) {
    if (group.status === "grouping") {
      return (
        <div
          key={group.group_id}
          className="flex flex-wrap items-center"
          style={{
            background: "var(--sage-50)",
            border: "1px solid var(--border-warm)",
            borderRadius: 18,
            padding: "16px 20px",
            marginBottom: 8,
            gap: 16,
          }}
        >
          <CountdownRing hoursRemaining={group.hours_remaining} totalHours={72} size={58} />
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "var(--ink-900)" }}>
              Gathering neighbors
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <CategoryTile category={group.category} size={24} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)", textTransform: "capitalize" as const }}>
                {group.category}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <AvatarStack total={group.member_count} size={28} ringColor="var(--sage-50)" />
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sage-700)" }}>
              {group.member_count} joined
            </span>
          </div>
        </div>
      );
    }

    if (group.status === "pending_approval") {
      const isBusy = groupActionId === group.group_id;
      return (
        <div
          key={group.group_id}
          style={{
            background: "var(--gold-50)",
            border: "1px solid var(--border-warm)",
            borderRadius: 18,
            padding: "18px 22px",
            marginBottom: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink-900)" }}>Your vote is needed</div>
            <div style={{ fontSize: 13, color: "var(--ink-700)", fontWeight: 600 }}>{group.approved_count}/{group.member_count} approved</div>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--ink-700)", textTransform: "capitalize" as const }}>
            {group.category} · {group.member_count} neighbors · window closed
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--ink-700)" }}>
            Approve to send this group to providers, or cancel your spot.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button
              type="button"
              disabled={isBusy}
              style={{ ...btnGhost, height: 34, opacity: isBusy ? 0.65 : 1 }}
              onClick={() => {
                setGroupActionId(group.group_id);
                void cancelGroup(group.group_id)
                  .then(() => toast("Your spot was cancelled", "info"))
                  .catch(() => toast("Couldn't cancel — try again", "error"))
                  .finally(() => setGroupActionId((current) => (current === group.group_id ? null : current)));
              }}
            >
              Cancel my spot
            </button>
            <button
              type="button"
              disabled={isBusy}
              style={{ ...btnPrimary, height: 34, opacity: isBusy ? 0.65 : 1 }}
              onClick={() => {
                setGroupActionId(group.group_id);
                void approveGroup(group.group_id)
                  .then(() => toast("Group approved — providers can now bid"))
                  .catch(() => toast("Couldn't approve — try again", "error"))
                  .finally(() => setGroupActionId((current) => (current === group.group_id ? null : current)));
              }}
            >
              Approve group
            </button>
          </div>
        </div>
      );
    }

    if (group.status === "bidding") {
      return (
        <div key={group.group_id} style={{ ...cardStyle, padding: "18px 22px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontSize: 15, color: "var(--sage-700)", fontWeight: 600 }}>✓ Sent to providers</div>
            <div style={{ fontSize: 13, color: "var(--ink-700)", fontWeight: 600 }}>{group.member_count} neighbors</div>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: "var(--ink-700)", textTransform: "capitalize" as const }}>
            {group.category} · waiting for bids from providers
          </div>
        </div>
      );
    }

    return null;
  }

  if (loading) {
    return (
      <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>
            My bids
          </h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>Track bookings, savings, and provider work in progress.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/*"
            style={{ display: "none" }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setShowQuotePanel(true);
              setQuoteResult(null);
              const result = await summariseQuote(f);
              if (result) setQuoteResult(result);
              e.target.value = "";
            }}
          />
          <button style={btnGhost} onClick={() => fileInputRef.current?.click()}>
            {quoteLoading ? "Analysing…" : "Compare outside quote"}
          </button>
          <button style={btnGhost}><IconSearch /> Search bids</button>
          <Link href="/app/homeowner/request" style={{ ...btnPrimary, textDecoration: "none" }}><IconPlus /> New request</Link>
        </div>
      </div>

      <div className="px-4 pb-8 md:px-9 md:pb-9">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-3.5" style={{ marginBottom: 22 }}>
          {stats.map((s) => (
            <div key={s.eyebrow} style={{ ...cardStyle, padding: 20, position: "relative", overflow: "hidden" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>{s.eyebrow}</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 36, marginTop: 8, color: s.numColor, lineHeight: 1, letterSpacing: "-0.02em" }}>{s.big}</div>
              <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 6 }}>{s.sub}</div>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: s.barColor }} />
            </div>
          ))}
        </div>

        {showQuotePanel && (
          <div style={{ ...cardStyle, padding: 24, marginBottom: 22, position: "relative" }}>
            <button
              onClick={() => { setShowQuotePanel(false); setQuoteResult(null); }}
              style={{ position: "absolute", top: 16, right: 16, background: "var(--cream-100)", border: 0, borderRadius: 999, width: 30, height: 30, cursor: "pointer", fontSize: 16, color: "var(--ink-500)", display: "grid", placeItems: "center" }}
            >×</button>

            {quoteLoading && !quoteResult && (
              <div style={{ color: "var(--ink-500)", fontSize: 14 }}>Analysing your quote…</div>
            )}

            {quoteError && (
              <p style={{ color: "var(--terracotta-600)", fontSize: 14 }}>{quoteError}</p>
            )}

            {quoteResult && (
              <div>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Outside quote</div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--ink-900)", marginTop: 4, letterSpacing: "-0.01em" }}>
                      {quoteResult.provider_name}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 500, color: "var(--ink-900)", letterSpacing: "-0.02em" }}>
                      {quoteResult.quoted_amount > 0 ? `$${Math.round(quoteResult.quoted_amount / 100).toLocaleString()}` : "—"}
                    </div>
                    <div style={{
                      display: "inline-flex", alignItems: "center", height: 22, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, marginTop: 4,
                      background: quoteResult.score >= 70 ? "var(--sage-50)" : quoteResult.score >= 40 ? "var(--gold-50)" : "var(--terracotta-50)",
                      color: quoteResult.score >= 70 ? "var(--sage-700)" : quoteResult.score >= 40 ? "var(--gold-600)" : "var(--terracotta-600)",
                    }}>
                      Score {quoteResult.score}/100
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: 14, color: "var(--ink-700)", lineHeight: 1.55, marginBottom: 14 }}>{quoteResult.scope_summary}</p>

                {quoteResult.flags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8, marginBottom: 14 }}>
                    {quoteResult.flags.map((flag, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--terracotta-50)", color: "var(--terracotta-600)" }}>
                        ⚠ {flag}
                      </span>
                    ))}
                  </div>
                )}

                {quoteResult.vs_neighbid && (
                  <div style={{ background: "var(--sage-50)", border: "1px solid var(--border-warm)", borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--sage-700)" }}>
                      BidBundle best bid: ${Math.round(quoteResult.vs_neighbid.neighbid_best_bid / 100).toLocaleString()}
                      {quoteResult.vs_neighbid.saving_if_use_neighbid > 0
                        ? ` · Saves you $${Math.round(quoteResult.vs_neighbid.saving_if_use_neighbid / 100).toLocaleString()}`
                        : quoteResult.vs_neighbid.saving_if_use_neighbid < 0
                          ? ` · This quote is $${Math.round(Math.abs(quoteResult.vs_neighbid.saving_if_use_neighbid) / 100).toLocaleString()} cheaper`
                          : " · Same price"}
                    </div>
                  </div>
                )}

                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}>{quoteResult.recommendation}</p>
                {quoteResult.stub && <p style={{ fontSize: 12, color: "var(--ink-400)", marginTop: 8 }}>AI unavailable — partial analysis only.</p>}
              </div>
            )}
          </div>
        )}

        <div id="groups" style={{ marginBottom: 18, scrollMarginTop: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "0 4px" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Group bids</div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)" }}>
                <IconUsers /> {activeGroups.length} active
              </span>
              {groupsLoading ? <span style={{ fontSize: 12, color: "var(--ink-400)" }}>Refreshing…</span> : null}
            </div>
            {activeGroups.length > 0 ? activeGroups.map(renderGroupCard) : (
              <div style={{ ...cardStyle, padding: "16px 18px", color: "var(--ink-500)", fontSize: 13 }}>
                No active group bids yet. Post a request and invite neighbors to start one.
              </div>
            )}
          </div>

        <div id="bids" className="flex flex-wrap items-center" style={{ gap: 6, marginBottom: 18, padding: "0 4px", scrollMarginTop: 24 }}>
          {[
            { k: "all", label: "All", n: bids.length },
            { k: "active", label: "Active", n: pendingBids.length },
            { k: "completed", label: "Completed", n: acceptedBids.length },
            { k: "archived", label: "Archived", n: archivedBids.length },
          ].map((tab) => (
            <button
              key={tab.k}
              type="button"
              onClick={() => setActiveTab(tab.k as typeof activeTab)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                height: 30, padding: "0 12px", borderRadius: 999,
                fontSize: 13, fontWeight: 600, cursor: "pointer", border: 0,
                background: activeTab === tab.k ? "var(--ink-900)" : "transparent",
                color: activeTab === tab.k ? "white" : "var(--ink-700)",
                fontFamily: "var(--font-body)",
              }}
            >
              {tab.label}
              <span
                style={{
                  marginLeft: 2,
                  background: activeTab === tab.k ? "rgba(255,255,255,0.18)" : "var(--cream-200)",
                  color: activeTab === tab.k ? "white" : "var(--ink-500)",
                  fontSize: 11, padding: "1px 7px", borderRadius: 9,
                }}
              >
                {tab.n}
              </span>
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button style={btnSmGhost}>Sort: Recent ↓</button>
        </div>

        {bids.length === 0 ? (
          <div className="bb-card bb-empty-state">
            <img src="/creative/illustrations/compare-bids.svg" alt="Empty bid list" />
            <h3>No bids yet</h3>
            <p>When you post a request, bids from providers and your neighborhood will show up here.</p>
            <Link href="/app/homeowner/request" className="bb-btn bb-btn-primary">
              <Icon name="plus" size={18} /> New request
            </Link>
          </div>
        ) : (
          <>
            {(activeTab === "all" || activeTab === "active") && <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "0 4px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Active</div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} /> {pendingBids.length} in progress
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {pendingBids.map((bid, index) => {
                  const request = requests.find((r) => r.id === bid.request_id);
                  const savings = ((request?.budget_min ?? 0) - bid.amount) / 100;
                  return (
                    <div key={bid.id} style={cardStyle}>
                      <div className="flex flex-wrap items-center p-4 md:px-6 md:py-5" style={{ gap: 14 }}>
                        <div style={{ width: 44, height: 44, borderRadius: 12, background: iconBgForIndex(index), display: "grid", placeItems: "center", color: "white", flexShrink: 0 }}>
                          {iconForIndex(index)}
                        </div>
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, color: "var(--ink-900)" }}>{bid.request_title}</div>
                          <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 2 }}>{bid.provider_name} · {bid.estimated_days} days</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--ink-900)", letterSpacing: "-0.02em" }}>${Math.round(bid.amount / 100).toLocaleString()}</div>
                          <div style={{ fontSize: 12, color: "var(--sage-700)", fontWeight: 600, marginTop: 2 }}>−${Math.round(savings)} vs solo</div>
                        </div>
                        <div className="flex w-full flex-wrap gap-2 md:w-auto">
                          <button
                            style={btnSmGhost}
                            onClick={() => void startConversation(bid.provider_id)}
                            disabled={messagingProviderId === bid.provider_id}
                          >
                            <IconMessage />
                            {messagingProviderId === bid.provider_id ? "Opening…" : "Message"}
                          </button>
                          <button
                            style={{ ...btnSmQuiet, flex: 1, justifyContent: "center" }}
                            onClick={() => acceptBid(bid.id).then(() => toast(`Accepted ${bid.provider_name}'s bid`)).catch(() => toast("Couldn't accept bid — try again", "error"))}
                          >
                            Accept bid
                          </button>
                          <button
                            style={btnSmGhost}
                            onClick={() => declineBid(bid.id).then(() => toast("Bid declined", "info")).catch(() => toast("Couldn't decline bid — try again", "error"))}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>}

            {(activeTab === "all" || activeTab === "completed") && <div style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "0 4px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Completed</div>
                <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--cream-200)", color: "var(--ink-700)", border: "1px solid var(--border-warm)" }}>
                  {acceptedBids.length} accepted
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {acceptedBids.map((bid, index) => (
                  <div key={bid.id} className="flex flex-wrap items-center p-4 md:p-5" style={{ ...cardStyle, gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: iconBgForIndex(index + 10), display: "grid", placeItems: "center", color: "white", flexShrink: 0 }}>
                      {iconForIndex(index + 10)}
                    </div>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 500, color: "var(--ink-900)" }}>{bid.request_title}</div>
                      <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 2 }}>{bid.provider_name} · {new Date(bid.created_at).toLocaleDateString()}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
                        {[1, 2, 3, 4, 5].map((star) => <IconStar key={star} />)}
                        <span style={{ fontSize: 12, color: "var(--ink-500)", marginLeft: 6 }}>5.0</span>
                      </div>
                    </div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--ink-900)", letterSpacing: "-0.02em" }}>${Math.round(bid.amount / 100).toLocaleString()}</div>
                    <div className="flex w-full flex-wrap gap-2 md:w-auto md:flex-col md:items-end">
                      <button
                        style={btnSmGhost}
                        onClick={() => void startConversation(bid.provider_id)}
                        disabled={messagingProviderId === bid.provider_id}
                      >
                        <IconMessage />
                        {messagingProviderId === bid.provider_id ? "Opening…" : "Message"}
                      </button>
                      <button style={btnSmGhost}><IconEdit /> Leave review</button>
                      <button
                        style={btnSmGhost}
                        onClick={() => {
                          setDisputeBidId(bid.id);
                          setDisputeComplaint("");
                          setDisputeResult(null);
                        }}
                      >
                        Dispute job
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>}

            {(activeTab === "all" || activeTab === "archived") && <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "0 4px" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase" as const, letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Archived</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {archivedBids.map((bid, index) => (
                  <div key={bid.id} style={{ ...cardStyle, padding: "14px 20px", display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 14, alignItems: "center", opacity: 0.85 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: iconBgForIndex(index + 20), display: "grid", placeItems: "center", color: "white" }}>
                      {iconForIndex(index + 20)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{bid.request_title}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{bid.provider_name} · {new Date(bid.created_at).toLocaleDateString()}</div>
                    </div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, color: "var(--ink-500)", letterSpacing: "-0.02em" }}>${Math.round(bid.amount / 100).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>}
          </>
        )}
      </div>

      {disputeBidId !== null && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(34,28,22,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setDisputeBidId(null); setDisputeResult(null); } }}
        >
          <div style={{ ...cardStyle, width: "100%", maxWidth: 600, borderRadius: "18px 18px 0 0", padding: "28px 28px 36px", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--ink-900)", letterSpacing: "-0.01em" }}>
                {disputeResult ? "Mediation result" : "Dispute this job"}
              </div>
              <button onClick={() => { setDisputeBidId(null); setDisputeResult(null); }} style={{ background: "var(--cream-100)", border: 0, borderRadius: 999, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "var(--ink-500)", display: "grid", placeItems: "center" }}>×</button>
            </div>

            {!disputeResult ? (
              <>
                <p style={{ fontSize: 14, color: "var(--ink-700)", marginBottom: 16, lineHeight: 1.55 }}>
                  Describe the issue. AI will read the full job context and suggest a fair resolution.
                </p>
                <textarea
                  rows={5}
                  value={disputeComplaint}
                  onChange={(e) => setDisputeComplaint(e.target.value)}
                  placeholder="e.g. The work was incomplete — 2 pipes still dripping after the plumber left."
                  style={{ width: "100%", borderRadius: 12, border: "1px solid var(--border-warm)", background: "var(--bg-app)", padding: "12px 14px", fontSize: 14, color: "var(--ink-700)", fontFamily: "var(--font-body)", lineHeight: 1.55, resize: "vertical", boxSizing: "border-box", marginBottom: 16 }}
                />
                <div style={{ display: "flex", gap: 10 }}>
                  <button style={{ ...btnGhost, flex: 1 }} onClick={() => setDisputeBidId(null)}>Cancel</button>
                  <button
                    style={{ ...btnPrimary, flex: 2, justifyContent: "center" }}
                    disabled={!disputeComplaint.trim() || disputeLoading}
                    onClick={async () => {
                      if (!disputeBidId) return;
                      const result = await submitDispute(disputeBidId, disputeComplaint);
                      if (result) setDisputeResult(result);
                    }}
                  >
                    {disputeLoading ? "Analysing…" : "Submit to AI mediator"}
                  </button>
                </div>
              </>
            ) : (
              <div>
                <p style={{ fontSize: 14, color: "var(--ink-700)", lineHeight: 1.6, marginBottom: 20 }}>{disputeResult.summary}</p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" style={{ marginBottom: 20 }}>
                  <div style={{ background: "var(--terracotta-50)", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--terracotta-600)", marginBottom: 6 }}>Your position</div>
                    <p style={{ fontSize: 13, color: "var(--ink-700)", lineHeight: 1.5, margin: 0 }}>{disputeResult.homeowner_position}</p>
                  </div>
                  <div style={{ background: "var(--cream-100)", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--ink-500)", marginBottom: 6 }}>Provider agreed to</div>
                    <p style={{ fontSize: 13, color: "var(--ink-700)", lineHeight: 1.5, margin: 0 }}>{disputeResult.provider_position}</p>
                  </div>
                </div>

                <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--ink-400)", marginBottom: 10 }}>Resolution options</div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 8, marginBottom: 20 }}>
                  {disputeResult.resolution_options.map((opt, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 12, background: opt.type === disputeResult.recommendation ? "var(--sage-50)" : "var(--cream-50)", border: `1px solid ${opt.type === disputeResult.recommendation ? "var(--sage-200,#b0d4b0)" : "var(--border-warm)"}` }}>
                      {opt.type === disputeResult.recommendation && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--sage-700)", background: "var(--sage-100)", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" as const }}>Recommended</span>}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)", textTransform: "capitalize" as const }}>{opt.type.replace(/_/g, " ")}{opt.amount_cents ? ` — $${Math.round(opt.amount_cents / 100)}` : ""}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>{opt.description}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 20 }}>
                  AI confidence: <strong style={{ color: disputeResult.confidence === "high" ? "var(--sage-700)" : disputeResult.confidence === "medium" ? "var(--gold-600)" : "var(--ink-500)" }}>{disputeResult.confidence}</strong>
                  {disputeResult.stub ? " · AI unavailable — showing estimate" : ""}
                </div>

                <div style={{ display: "flex", gap: 10 }}>
                  <button style={{ ...btnGhost, flex: 1 }} onClick={() => { setDisputeBidId(null); setDisputeResult(null); }}>Close</button>
                  <button style={{ ...btnPrimary, flex: 1, justifyContent: "center" }} onClick={() => { setDisputeBidId(null); setDisputeResult(null); }}>Accept recommendation</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
