"use client";

import { useState } from "react";
import Link from "next/link";
import { mockBiddingRoomBids, mockBiddingRoomRequest } from "@/data/mock/mockBiddingRoom";

/* ── Mock chat data ── */
const conversations = [
  {
    id: "c1",
    name: "Plumbing Group · 3 neighbors",
    avatar: "PG",
    avatarBg: "#eff6ff",
    avatarColor: "#2563eb",
    lastMsg: "Maria: Has anyone seen the ProFix bid? Looks solid 👍",
    time: "2m ago",
    unread: 3,
    messages: [
      { id: 1, sender: "Maria Chen",   initials: "MC", text: "Hey everyone, ProFix Plumbing submitted a new bid — $490. Thoughts?",          time: "9:41 AM", mine: false },
      { id: 2, sender: "You",          initials: "LS", text: "Saw that! They have 128 jobs and 4.9 stars. That's the best so far.",          time: "9:43 AM", mine: true  },
      { id: 3, sender: "James Kim",    initials: "JK", text: "AquaFlow came in at $530. ProFix is better value if the rating holds.",        time: "9:45 AM", mine: false },
      { id: 4, sender: "Maria Chen",   initials: "MC", text: "Has anyone seen the ProFix bid? Looks solid 👍",                              time: "9:47 AM", mine: false },
    ],
  },
  {
    id: "c2",
    name: "Lance & ProFix Plumbing",
    avatar: "PP",
    avatarBg: "#fff7ed",
    avatarColor: "#d97706",
    lastMsg: "ProFix: We can start Thursday if confirmed today",
    time: "1h ago",
    unread: 0,
    messages: [
      { id: 1, sender: "ProFix Plumbing", initials: "PP", text: "Hi Lance, we've submitted our bid for the plumbing group. Happy to answer any questions!", time: "8:30 AM", mine: false },
      { id: 2, sender: "You",             initials: "LS", text: "Thanks! Do you have availability this week?",                                             time: "8:45 AM", mine: true  },
      { id: 3, sender: "ProFix Plumbing", initials: "PP", text: "We can start Thursday if confirmed today",                                               time: "9:00 AM", mine: false },
    ],
  },
  {
    id: "c3",
    name: "Lawn Care Group · 5 neighbors",
    avatar: "LC",
    avatarBg: "#f0fdf4",
    avatarColor: "#16a34a",
    lastMsg: "Priya: Group is almost full, 1 spot left!",
    time: "3h ago",
    unread: 1,
    messages: [
      { id: 1, sender: "Priya Raman", initials: "PR", text: "Group is almost full, 1 spot left! Anyone want to join before bidding opens?", time: "7:15 AM", mine: false },
    ],
  },
];

/* ── Bid comparison helpers ── */
const maxBid = Math.max(...mockBiddingRoomBids.map(b => b.amount));
const soloPrice = mockBiddingRoomRequest.soloPrice;

const bidInsights = mockBiddingRoomBids.map(bid => ({
  ...bid,
  savingVsSolo: soloPrice - bid.amount,
  pct: Math.round((bid.amount / maxBid) * 100),
  score: Math.round((bid.rating / 5) * 50 + ((maxBid - bid.amount) / maxBid) * 50),
})).sort((a, b) => b.score - a.score);

type Tab = "chat" | "bids";

export function DashboardChatPanel() {
  const [tab, setTab] = useState<Tab>("chat");
  const [activeConvo, setActiveConvo] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const convo = conversations.find(c => c.id === activeConvo);

  return (
    <div className="rounded-[10px] border border-[#e2e8f0] bg-white shadow-card overflow-hidden">

      {/* Header + tabs */}
      <div className="flex items-center justify-between border-b border-[#e2e8f0] px-4 py-3">
        <div className="flex items-center gap-2">
          {activeConvo && tab === "chat" ? (
            <button
              onClick={() => setActiveConvo(null)}
              className="mr-1 flex h-6 w-6 items-center justify-center rounded-md text-[#64748b] hover:bg-[#f1f5f9]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
              </svg>
            </button>
          ) : null}
          <p className="text-[13px] font-semibold text-[#0f172a]">
            {tab === "chat"
              ? activeConvo
                ? convo?.name
                : "Neighborhood Chat"
              : "Bid Analysis"}
          </p>
          {tab === "chat" && !activeConvo && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">
              4
            </span>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-0.5 rounded-lg bg-[#f1f5f9] p-0.5">
          {(["chat", "bids"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setActiveConvo(null); }}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition-all ${
                tab === t
                  ? "bg-white text-[#0f172a] shadow-sm"
                  : "text-[#64748b] hover:text-[#0f172a]"
              }`}
            >
              {t === "chat" ? "💬 Chat" : "📊 Bids"}
            </button>
          ))}
        </div>
      </div>

      {/* ── CHAT TAB ── */}
      {tab === "chat" && !activeConvo && (
        <div className="divide-y divide-[#f1f5f9]">
          {conversations.map(c => (
            <button
              key={c.id}
              onClick={() => setActiveConvo(c.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#f8fafc]"
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                style={{ background: c.avatarBg, color: c.avatarColor }}
              >
                {c.avatar}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-semibold text-[#0f172a]">{c.name}</p>
                  <span className="text-[10px] text-[#94a3b8]">{c.time}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-[#64748b]">{c.lastMsg}</p>
              </div>
              {c.unread > 0 && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">
                  {c.unread}
                </span>
              )}
            </button>
          ))}

          <div className="px-4 py-2.5">
            <Link
              href="/app/homeowner/chat"
              className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-[#64748b] transition hover:text-[#2563eb]"
            >
              Open full chat
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            </Link>
          </div>
        </div>
      )}

      {/* ── ACTIVE CONVERSATION ── */}
      {tab === "chat" && activeConvo && convo && (
        <div className="flex flex-col" style={{ height: "280px" }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-3 p-4 scrollbar-hide">
            {convo.messages.map(msg => (
              <div key={msg.id} className={`flex items-end gap-2 ${msg.mine ? "flex-row-reverse" : ""}`}>
                {!msg.mine && (
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white bg-[#2563eb]"
                  >
                    {msg.initials}
                  </div>
                )}
                <div className={`max-w-[72%] ${msg.mine ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                  {!msg.mine && (
                    <span className="px-1 text-[10px] text-[#94a3b8]">{msg.sender}</span>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-2 text-[12px] leading-snug ${
                      msg.mine
                        ? "rounded-br-sm bg-[#2563eb] text-white"
                        : "rounded-bl-sm bg-[#f1f5f9] text-[#0f172a]"
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className="px-1 text-[10px] text-[#94a3b8]">{msg.time}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="border-t border-[#e2e8f0] px-3 py-2.5 flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && setInput("")}
              placeholder="Reply to group…"
              className="flex-1 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-[12px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-blue-100 placeholder:text-[#94a3b8]"
            />
            <button
              onClick={() => setInput("")}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2563eb] text-white transition hover:bg-[#1d4ed8]"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 7-7 7 7M12 5v14" transform="rotate(90 12 12)" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ── BID ANALYSIS TAB ── */}
      {tab === "bids" && (
        <div className="p-4 space-y-4">
          {/* Context row */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-semibold text-[#0f172a]">{mockBiddingRoomRequest.title}</p>
              <p className="text-[11px] text-[#64748b]">
                {mockBiddingRoomRequest.neighborsJoined} neighbors · Solo price ${soloPrice}
              </p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
              {mockBiddingRoomBids.length} bids live
            </span>
          </div>

          {/* Bid cards */}
          <div className="space-y-2.5">
            {bidInsights.map((bid, i) => (
              <div
                key={bid.id}
                className={`rounded-lg border p-3 transition ${
                  i === 0
                    ? "border-blue-200 bg-blue-50"
                    : "border-[#e2e8f0] bg-white"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {/* Rank */}
                  <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                    i === 0 ? "bg-blue-600 text-white" : "bg-[#e2e8f0] text-[#64748b]"
                  }`}>
                    {i + 1}
                  </div>

                  {/* Provider */}
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white"
                    style={{ background: i === 0 ? "#2563eb" : "#64748b" }}
                  >
                    {bid.providerInitials}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[12px] font-semibold text-[#0f172a]">{bid.providerName}</p>
                      {i === 0 && (
                        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                          BEST
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-amber-600 font-semibold">★ {bid.rating}</span>
                      <span className="text-[10px] text-[#94a3b8]">{bid.jobsCompleted} jobs</span>
                      <span className="text-[10px] text-[#94a3b8]">{bid.estimatedDays}d est.</span>
                    </div>
                  </div>

                  <div className="flex-none text-right">
                    <p className="text-[14px] font-bold text-[#0f172a]">${bid.amount}</p>
                    <p className="text-[10px] font-semibold text-emerald-600">-${bid.savingVsSolo} vs solo</p>
                  </div>
                </div>

                {/* Price bar */}
                <div className="mt-2.5 h-1.5 w-full rounded-full bg-[#e2e8f0]">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${bid.pct}%`,
                      background: i === 0 ? "#2563eb" : "#94a3b8",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* AI recommendation */}
          <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="flex h-4 w-4 items-center justify-center rounded bg-blue-100 text-[9px] text-blue-600 font-bold">✦</div>
              <p className="text-[11px] font-semibold text-blue-700">AI recommendation</p>
            </div>
            <p className="text-[11px] text-[#334155] leading-relaxed">
              <strong>ProFix Plumbing</strong> offers the highest rating (4.9★) at the lowest price — saving you ${soloPrice - Math.min(...mockBiddingRoomBids.map(b => b.amount))} vs booking solo. Recommend accepting.
            </p>
          </div>

          <Link
            href="/app/homeowner/bidding-room"
            className="flex items-center justify-center gap-1.5 rounded-lg bg-[#2563eb] py-2 text-[12px] font-semibold text-white transition hover:bg-[#1d4ed8]"
          >
            Go to bidding room
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        </div>
      )}
    </div>
  );
}
