"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { useProviderSession } from "@/components/provider/ProviderSessionContext";
import { useProviderInbox } from "@/hooks/useProviderInbox";
import { initialsFromName } from "@/lib/display-name";

function IconSearch() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>; }
function IconSend() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>; }
function IconChat() { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>; }

const avGrad = "linear-gradient(135deg,#B07AA0,#7A4A6E)";

function formatClock(value: string) {
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/**
 * Wrapped in a boundary because the thread deep link is read from the query
 * string: `/app/provider/messages?thread=…` is where "Message customer" on a
 * bid lands.
 */
export default function ProviderMessagesPage() {
  return (
    <Suspense
      fallback={<div style={{ padding: "22px 18px", fontSize: 13, color: "var(--ink-500)" }}>Loading inbox…</div>}
    >
      <ProviderMessages />
    </Suspense>
  );
}

function ProviderMessages() {
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
  } = useProviderInbox();
  const { setUnreadMessages } = useProviderSession();
  const requestedThreadId = useSearchParams().get("thread");

  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const messageListRef = useRef<HTMLDivElement>(null);

  // The sidebar badge is seeded by the server layout and cannot re-read itself
  // on a client navigation, so this page — the one that actually clears unread
  // messages — keeps it honest.
  useEffect(() => {
    if (!loading) setUnreadMessages(unreadTotal);
  }, [loading, setUnreadMessages, unreadTotal]);

  // Open the thread the deep link asked for, else the most recent one — and in
  // neither case clobber a thread the provider has already picked. An unknown
  // or foreign id in the query falls back rather than erroring: the server
  // would refuse it anyway, and there is nothing useful to say about an id
  // that is not in this inbox.
  useEffect(() => {
    if (activeThreadId !== null || threads.length === 0) return;
    const linked = threads.find((thread) => thread.id === requestedThreadId);
    void selectThread(linked?.id ?? threads[0]!.id);
    if (linked) setMobilePane("thread");
  }, [activeThreadId, requestedThreadId, selectThread, threads]);

  useEffect(() => {
    const listEl = messageListRef.current;
    if (!listEl) return;
    listEl.scrollTo({ top: listEl.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const filteredThreads = threads.filter((thread) => {
    const haystack =
      `${thread.otherPartyName} ${thread.requestTitle} ${thread.lastMessagePreview ?? ""}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending || !activeThread) return;
    setDraft("");
    const sent = await send(text);
    // Sending failed: give the provider their words back rather than losing
    // them to an error banner.
    if (!sent) setDraft(text);
  }

  return (
    <div className="homeowner-chat-layout grid grid-cols-1 md:grid-cols-[300px_1fr]">
      <div
        className={`${mobilePane === "list" ? "flex" : "hidden"} flex-col md:flex`}
        style={{ borderRight: "1px solid var(--border-warm)", background: "var(--cream-50)", minHeight: 0, overflow: "hidden" }}
      >
        <div style={{ padding: "22px 18px 14px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div>
              <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink-900)" }}>Messages</h1>
              <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 3 }}>Customers on jobs you have quoted</div>
            </div>
            {unreadTotal > 0 ? (
              <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--teal-50)", color: "var(--teal-800)", whiteSpace: "nowrap" }}>{unreadTotal} new</span>
            ) : null}
          </div>
          <div style={{ position: "relative", marginTop: 14 }}>
            <span style={{ position: "absolute", left: 12, top: 11, color: "var(--ink-400)" }}><IconSearch /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations…" style={{ width: "100%", height: 36, padding: "0 12px 0 34px", borderRadius: 12, border: "1px solid transparent", background: "var(--cream-100)", fontSize: 13, fontFamily: "var(--font-body)", color: "var(--ink-900)", outline: "none", boxSizing: "border-box" }} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>
          {loading ? (
            <div style={{ padding: "16px 22px", fontSize: 13, color: "var(--ink-500)" }}>Loading inbox…</div>
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
          ) : filteredThreads.length === 0 ? (
            <div style={{ padding: "16px 22px", fontSize: 13, color: "var(--ink-500)" }}>
              {search.trim()
                ? "No threads match your search."
                : "No conversations yet. A thread opens once you have quoted a customer's request."}
            </div>
          ) : filteredThreads.map((thread) => {
            const isActive = activeThreadId === thread.id;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => { void selectThread(thread.id); setMobilePane("thread"); }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  font: "inherit",
                  padding: 12,
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  alignItems: "flex-start",
                  borderRadius: 12,
                  marginTop: 4,
                  background: isActive ? "white" : "transparent",
                  border: isActive ? "1px solid var(--border-warm)" : "1px solid transparent",
                  boxShadow: isActive ? "var(--shadow-warm-sm)" : "none",
                  cursor: "pointer",
                }}
              >
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: avGrad, color: "white", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, marginTop: 2, flexShrink: 0 }}>{initialsFromName(thread.otherPartyName, "??")}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-900)" }}>{thread.otherPartyName}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-400)", whiteSpace: "nowrap" }}>{thread.lastMessageAt ? formatClock(thread.lastMessageAt) : ""}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thread.lastMessagePreview ?? "No messages yet"}</div>
                  <div style={{ marginTop: 6 }}>
                    {/* The job is what the thread is *for*, so it is the label. */}
                    <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px", borderRadius: 999, fontSize: 10, fontWeight: 600, background: "var(--cream-100)", color: "var(--ink-700)", border: "1px solid var(--border-warm)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {thread.requestTitle}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 2 }}>
                  {thread.unreadCount > 0 ? <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: "var(--terracotta-600)", color: "white" }}>{thread.unreadCount}</span> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={`${mobilePane === "thread" ? "flex" : "hidden"} flex-col md:flex`}
        style={{ background: "var(--bg-card)", minHeight: 0, overflow: "hidden" }}
      >
        {!activeThread ? (
          <div className="chat-welcome" style={{ margin: "auto" }}>
            <div className="chat-welcome-mark">
              <IconChat />
            </div>
            <span className="bb-eyebrow">Messages</span>
            <h2>No conversation open</h2>
            <p>Pick a thread on the left, or quote a nearby request to start one.</p>
          </div>
        ) : (
        <>
        <div className="px-4 py-3.5 md:px-7 md:py-[18px]" style={{ borderBottom: "1px solid var(--border-warm)", background: "var(--bg-card)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <button
              onClick={() => setMobilePane("list")}
              aria-label="Back to inbox"
              className="md:hidden"
              style={{ background: "var(--cream-100)", border: 0, borderRadius: 999, width: 34, height: 34, display: "grid", placeItems: "center", cursor: "pointer", color: "var(--ink-700)", flexShrink: 0 }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
            </button>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: avGrad, color: "white", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
              {initialsFromName(activeThread.otherPartyName, "??")}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, color: "var(--ink-900)" }}>
                  {activeThread.otherPartyName}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-500)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeThread.requestTitle} · {activeThread.communityName}
              </div>
            </div>
          </div>
        </div>

        <div
          ref={messageListRef}
          className="p-4 md:px-7 md:py-6"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}
        >
          {messagesLoading ? (
            <div style={{ alignSelf: "center", fontSize: 13, color: "var(--ink-400)" }}>Loading conversation…</div>
          ) : messagesError ? (
            <div role="alert" style={{ alignSelf: "center", padding: "16px 18px", borderRadius: 14, background: "rgba(182,68,48,0.08)", border: "1px solid rgba(182,68,48,0.24)", fontSize: 13, color: "var(--danger-600)" }}>
              {messagesError}
            </div>
          ) : messages.length === 0 ? (
            <div style={{ alignSelf: "center", padding: "16px 18px", borderRadius: 14, background: "var(--cream-50)", border: "1px solid var(--border-warm)", fontSize: 13, color: "var(--ink-500)" }}>
              No messages yet. Say hello and confirm the details of the job.
            </div>
          ) : messages.map((message) => (
            <div key={message.id} style={{ display: "flex", justifyContent: message.isMine ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "70%",
                padding: "10px 14px",
                borderRadius: 14,
                fontSize: 14,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                background: message.isMine ? "var(--terracotta-600)" : "white",
                color: message.isMine ? "white" : "var(--ink-900)",
                border: message.isMine ? "0" : "1px solid var(--border-warm)",
                boxShadow: message.isMine ? "0 4px 12px -6px rgba(232,98,63,0.4)" : "none",
                borderBottomRightRadius: message.isMine ? 4 : 14,
                borderBottomLeftRadius: message.isMine ? 14 : 4,
              }}>
                <div>{message.body}</div>
                <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7, textAlign: message.isMine ? "right" : "left" }}>{formatClock(message.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="provider-composer-pad p-4 md:p-[18px]" style={{ borderTop: "1px solid var(--border-warm)", background: "var(--bg-card)", paddingBottom: "calc(88px + var(--safe-bottom))" }}>
          <style>{`@media (min-width: 768px) { .provider-composer-pad { padding-bottom: 18px !important; } }`}</style>
          {sendError ? (
            <div role="alert" style={{ marginBottom: 10, fontSize: 12, color: "var(--danger-600)" }}>{sendError}</div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--cream-50)", border: "1px solid var(--border-warm)", borderRadius: 14 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder={`Reply to ${activeThread.otherPartyName}…`}
              style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontSize: 14, fontFamily: "var(--font-body)", color: "var(--ink-900)" }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!draft.trim() || sending}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: draft.trim() && !sending ? "pointer" : "default", background: draft.trim() && !sending ? "var(--terracotta-600)" : "var(--cream-200)", color: draft.trim() && !sending ? "white" : "var(--ink-400)", border: 0, fontFamily: "var(--font-body)" }}
            >
              <IconSend /> {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
        </>
        )}
      </div>

    </div>
  );
}
