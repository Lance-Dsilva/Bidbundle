"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { useHomeownerSession } from "@/components/homeowner/HomeownerSessionContext";
import { CreativeIcon } from "@/components/ui/CreativeIcon";
import { Icon } from "@/components/ui/Icon";
import { useHomeownerInbox } from "@/hooks/useHomeownerInbox";
import { initialsFromName } from "@/lib/display-name";

/**
 * The customer's messages: one thread per provider quote on their own work.
 *
 * This page used to call `/api/homeowner/conversations`, `/api/homeowner/channels`,
 * and `/api/neighbourhood/channel`, none of which had a Route Handler. The
 * conversation half now runs on the real `ServiceConversation` rows the
 * provider console writes to.
 *
 * The group-chat and neighbourhood-channel sections that sat here are gone
 * rather than stubbed: no table has ever backed them, so every state they could
 * render would have been an invention. See the completion notes.
 */

function IconSearch() {
  return <Icon name="search" size={14} />;
}
function IconSend() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>;
}
function IconCheck() {
  return <Icon name="check-circle" size={12} />;
}

const avatarGradients = [
  "linear-gradient(135deg,#D6A23E,#B8862B)",
  "linear-gradient(135deg,#B07AA0,#7A4A6E)",
  "linear-gradient(135deg,#6F8DB8,#3F608E)",
  "linear-gradient(135deg,#7A9A7E,#4A6A4D)",
] as const;

/** Stable per-thread colour, so a thread does not change hue as the list moves. */
function avatarGradient(threadId: string) {
  let hash = 0;
  for (const character of threadId) hash = (hash * 31 + character.charCodeAt(0)) % 997;
  return avatarGradients[hash % avatarGradients.length]!;
}

function formatTime(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Wrapped in a boundary because the thread deep link is read from the query
 * string: `/app/homeowner/chat?thread=…` is where "Message provider" on a
 * quote lands.
 */
export default function HomeownerChat() {
  return (
    <Suspense
      fallback={<div style={{ padding: "22px 18px", fontSize: 13, color: "var(--ink-500)" }}>Loading messages…</div>}
    >
      <HomeownerChatInbox />
    </Suspense>
  );
}

function HomeownerChatInbox() {
  const {
    threads,
    unreadTotal,
    loading,
    error,
    refresh,
    activeThread,
    activeThreadId,
    selectThread,
    messages,
    messagesLoading,
    messagesError,
    send,
    sending,
    sendError,
  } = useHomeownerInbox();
  const requestedThreadId = useSearchParams().get("thread");
  const { setUnreadMessages } = useHomeownerSession();

  const [composer, setComposer] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);

  // Open the thread the deep link asked for, else the most recent one, without
  // clobbering one the reader has already picked.
  useEffect(() => {
    if (activeThreadId !== null || threads.length === 0) return;
    const linked = threads.find((thread) => thread.id === requestedThreadId);
    void selectThread(linked?.id ?? threads[0]!.id);
    if (linked) setMobilePane("thread");
  }, [activeThreadId, requestedThreadId, selectThread, threads]);

  // The sidebar badge is seeded by the server layout and cannot re-read itself
  // on a client navigation, so this page — the one that actually clears unread
  // messages — keeps it honest.
  useEffect(() => {
    if (!loading) setUnreadMessages(unreadTotal);
  }, [loading, setUnreadMessages, unreadTotal]);

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleThreads = threads.filter(
    (thread) =>
      !normalizedSearch ||
      `${thread.otherPartyName} ${thread.requestTitle} ${thread.lastMessagePreview ?? ""}`
        .toLowerCase()
        .includes(normalizedSearch),
  );

  async function handleSend() {
    const text = composer.trim();
    if (!text || sending || !activeThread) return;
    setComposer("");
    // A refused send gives the words back rather than losing them to a banner.
    if (!(await send(text))) setComposer(text);
  }

  return (
    <div className="homeowner-chat-layout grid grid-cols-1 md:grid-cols-[300px_1fr]">
      <div
        className={`${mobilePane === "list" ? "flex" : "hidden"} flex-col md:flex`}
        style={{ borderRight: "1px solid var(--border-warm)", background: "var(--cream-50)", overflow: "hidden" }}
      >
        <div style={{ padding: "22px 18px 14px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink-900)" }}>Messages</div>
              <p style={{ margin: "3px 0 0", color: "var(--ink-500)", fontSize: 12 }}>Providers who quoted your work</p>
            </div>
            {unreadTotal > 0 ? (
              <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--terracotta-50)", color: "var(--terracotta-600)", whiteSpace: "nowrap" }}>
                {unreadTotal} new
              </span>
            ) : null}
          </div>
          <div style={{ marginTop: 14, height: 36, borderRadius: 12, background: "var(--cream-100)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", border: "1px solid transparent" }}>
            <IconSearch />
            <input
              aria-label="Search conversations"
              placeholder="Search conversations…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              style={{ border: 0, outline: 0, background: "transparent", fontSize: 13, fontFamily: "var(--font-body)", color: "var(--ink-900)", flex: 1 }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>
          {loading ? (
            <div style={{ padding: "16px 22px", fontSize: 13, color: "var(--ink-500)" }}>Loading messages…</div>
          ) : error ? (
            <div role="alert" style={{ padding: "16px 22px", fontSize: 13, color: "var(--danger-600)" }}>
              <div>{error}</div>
              <button
                type="button"
                onClick={() => void refresh()}
                style={{ marginTop: 10, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" }}
              >
                Try again
              </button>
            </div>
          ) : visibleThreads.length === 0 ? (
            <div className="chat-list-empty amber">
              <span><CreativeIcon name="home" size={20} /></span>
              <div>
                <strong>{normalizedSearch ? "No matching conversations" : "No conversations yet"}</strong>
                <p>
                  {normalizedSearch
                    ? "Try a different provider or request name."
                    : "Open one from a quote on your bids page."}
                </p>
              </div>
            </div>
          ) : visibleThreads.map((thread) => {
            const isActive = activeThreadId === thread.id;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => { void selectThread(thread.id); setMobilePane("thread"); }}
                style={{
                  width: "100%",
                  padding: 12,
                  borderRadius: 12,
                  marginTop: 4,
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  cursor: "pointer",
                  textAlign: "left",
                  font: "inherit",
                  background: isActive ? "white" : "transparent",
                  border: isActive ? "1px solid var(--border-warm)" : "1px solid transparent",
                  boxShadow: isActive ? "var(--shadow-warm-sm)" : "none",
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: avatarGradient(thread.id), display: "grid", placeItems: "center", color: "white", flexShrink: 0, fontSize: 12, fontWeight: 600 }}>
                  {initialsFromName(thread.otherPartyName, "??")}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)", display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thread.otherPartyName}</span>
                      <span style={{ width: 14, height: 14, borderRadius: "50%", background: "var(--sage-50)", color: "var(--sage-700)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                        <IconCheck />
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-400)", whiteSpace: "nowrap" }}>{formatTime(thread.lastMessageAt)}</div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {thread.lastMessagePreview ?? "No messages yet"}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {/* The job is what the thread is *for*, so it is the label. */}
                    <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px", borderRadius: 999, fontSize: 10, fontWeight: 600, background: "var(--cream-100)", color: "var(--ink-700)", border: "1px solid var(--border-warm)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {thread.requestTitle}
                    </span>
                  </div>
                </div>
                {thread.unreadCount > 0 && (
                  <span style={{ minWidth: 18, height: 18, padding: "0 6px", borderRadius: 9, background: "var(--terracotta-600)", color: "white", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center" }}>
                    {thread.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={`${mobilePane === "thread" ? "flex" : "hidden"} flex-col md:flex`}
        style={{ overflow: "hidden", background: "var(--bg-card)" }}
      >
        {!activeThread ? (
          <div className="chat-welcome" style={{ margin: "auto" }}>
            <div className="chat-welcome-mark">
              <Icon name="chat" size={24} />
            </div>
            <span className="bb-eyebrow">Messages</span>
            <h2>No conversation open</h2>
            <p>Pick a thread on the left, or start one from a quote on your bids page.</p>
            <Link
              href="/app/homeowner/bids"
              style={{ display: "inline-flex", alignItems: "center", height: 34, padding: "0 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, background: "var(--terracotta-600)", color: "white", textDecoration: "none", marginTop: 12 }}
            >
              View your quotes
            </Link>
          </div>
        ) : (
        <>
        <div className="px-4 py-3.5 md:px-7 md:py-5" style={{ borderBottom: "1px solid var(--border-warm)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <button
            onClick={() => setMobilePane("list")}
            aria-label="Back to conversations"
            className="md:hidden"
            style={{ background: "var(--cream-100)", border: 0, borderRadius: 999, width: 34, height: 34, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--ink-700)", flexShrink: 0 }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
          </button>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: avatarGradient(activeThread.id), display: "grid", placeItems: "center", color: "white", flexShrink: 0, fontSize: 12, fontWeight: 600 }}>
            {initialsFromName(activeThread.otherPartyName, "??")}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: "var(--ink-900)" }}>{activeThread.otherPartyName}</div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)", border: "1px solid var(--sage-100)" }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} />
                Quoted your job
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-500)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeThread.requestTitle} · {activeThread.communityName}
            </div>
          </div>
          <Link
            href="/app/homeowner/bids"
            style={{ display: "inline-flex", alignItems: "center", height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)", textDecoration: "none", flexShrink: 0 }}
          >
            View bids
          </Link>
        </div>

        <div ref={messagesRef} className="p-4 md:px-7 md:py-6" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
          {messagesLoading ? (
            <div style={{ alignSelf: "center", fontSize: 13, color: "var(--ink-400)" }}>Loading conversation…</div>
          ) : messagesError ? (
            <div role="alert" style={{ alignSelf: "center", padding: "16px 18px", borderRadius: 14, background: "rgba(182,68,48,0.08)", border: "1px solid rgba(182,68,48,0.24)", fontSize: 13, color: "var(--danger-600)" }}>
              {messagesError}
            </div>
          ) : messages.length === 0 ? (
            <div style={{ alignSelf: "center", padding: "16px 18px", borderRadius: 14, background: "var(--cream-50)", border: "1px solid var(--border-warm)", fontSize: 13, color: "var(--ink-500)" }}>
              No messages yet. Ask about availability, materials, or what the quote covers.
            </div>
          ) : messages.map((message) => (
            <div key={message.id} style={{ display: "flex", justifyContent: message.isMine ? "flex-end" : "flex-start" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", maxWidth: 640, flexDirection: message.isMine ? "row-reverse" : "row" }}>
                {!message.isMine && (
                  <div
                    title={message.senderName}
                    aria-label={message.senderName}
                    style={{ width: 30, height: 30, borderRadius: "50%", background: avatarGradient(activeThread.id), display: "grid", placeItems: "center", color: "white", flexShrink: 0, fontSize: 11, fontWeight: 700 }}
                  >
                    {initialsFromName(message.senderName, "??")}
                  </div>
                )}
                <div style={{ maxWidth: 480 }}>
                  <div
                    style={{
                      background: message.isMine ? "var(--terracotta-600)" : "white",
                      color: message.isMine ? "white" : "var(--ink-900)",
                      borderRadius: message.isMine ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                      padding: "12px 16px",
                      fontSize: 14,
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      border: message.isMine ? 0 : "1px solid var(--border-warm)",
                      boxShadow: message.isMine ? "none" : "var(--shadow-warm-sm)",
                    }}
                  >
                    {message.body}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 4, marginLeft: message.isMine ? 0 : 4, textAlign: message.isMine ? "right" : "left" }}>
                    {formatTime(message.createdAt)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          className="chat-composer-pad px-4 pt-3.5 md:px-7"
          style={{ borderTop: "1px solid var(--border-warm)", paddingBottom: "calc(88px + var(--safe-bottom))", background: "var(--bg-card)", flexShrink: 0 }}
        >
          <style>{`@media (min-width: 768px) { .chat-composer-pad { padding-bottom: 22px !important; } }`}</style>
          {sendError ? (
            <div role="alert" style={{ marginBottom: 10, fontSize: 12, color: "var(--danger-600)" }}>{sendError}</div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 6px 14px", background: "var(--cream-100)", borderRadius: 22, border: "1px solid transparent" }}>
            <input
              ref={composerRef}
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={`Message ${activeThread.otherPartyName}…`}
              style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontSize: 14, fontFamily: "var(--font-body)", color: "var(--ink-900)", padding: "10px 0" }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!composer.trim() || sending}
              aria-label="Send message"
              style={{ width: 36, height: 36, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--terracotta-600)", color: "white", border: 0, cursor: "pointer", opacity: !composer.trim() || sending ? 0.5 : 1 }}
            >
              <IconSend />
            </button>
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
