"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useProviderMessages } from "@/hooks/useProviderMessages";
import { fetchMe, getToken, type AuthUser } from "@/lib/auth";
import type { Message as ApiMsg } from "@/hooks/useProviderMessages";

function IconSearch() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>; }
function IconPaperclip() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12l-9 9a5 5 0 1 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 1 1-3-3l8-8"/></svg>; }
function IconSend() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>; }
function IconChat() { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>; }

type Thread = { id: number; name: string; preview: string; time: string; unread: number };

const avGrad = "linear-gradient(135deg,#B07AA0,#7A4A6E)";

export default function ProviderMessagesPage() {
  const { conversations, loading, getMessages, sendMessage } = useProviderMessages();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [activeThread, setActiveThread] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<ApiMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetchMe(token).then(setMe).catch(() => {});
  }, []);

  // Default to the first conversation once the inbox loads, without
  // clobbering a thread the provider already picked.
  useEffect(() => {
    if (activeThread !== null || conversations.length === 0) return;
    setActiveThread(conversations[0].id);
  }, [activeThread, conversations]);

  useEffect(() => {
    if (activeThread === null) {
      setMessages([]);
      return;
    }
    void getMessages(activeThread).then(setMessages).catch(() => {});
  }, [activeThread, getMessages]);

  useEffect(() => {
    const listEl = messageListRef.current;
    if (!listEl) return;
    listEl.scrollTo({ top: listEl.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const threads = useMemo<Thread[]>(
    () =>
      conversations.map((conversation) => ({
        id: conversation.id,
        name: conversation.other_user_name,
        preview: conversation.last_message ?? "No messages yet",
        time: conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
        unread: conversation.unread_count,
      })),
    [conversations],
  );

  const filteredThreads = threads.filter((thread) => {
    const haystack = `${thread.name} ${thread.preview}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  const activeConv = activeThread !== null ? conversations.find((conversation) => conversation.id === activeThread) ?? null : null;

  const renderedMessages = messages.map((message) => ({
    // Legacy screen: `sender_id` is a numeric id from the not-yet-built
    // messaging backend, while the session id is a cuid. Compared as strings
    // until section 6 defines the real message model.
    from: String(message.sender_id) === me?.id ? "me" : "them",
    text: message.text,
    time: new Date(message.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  }));

  async function handleSend() {
    if (!draft.trim() || sending || !activeConv) return;
    const text = draft.trim();
    setDraft("");
    setSending(true);
    try {
      const sent = await sendMessage(activeConv.id, text);
      if (sent) setMessages((prev) => [...prev, sent]);
    } finally {
      setSending(false);
    }
  }

  const sidebarUnread = conversations.reduce((sum, conversation) => sum + conversation.unread_count, 0);

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
              <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 3 }}>Customers and active bids</div>
            </div>
            <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--teal-50)", color: "var(--teal-800)", whiteSpace: "nowrap" }}>{sidebarUnread} new</span>
          </div>
          <div style={{ position: "relative", marginTop: 14 }}>
            <span style={{ position: "absolute", left: 12, top: 11, color: "var(--ink-400)" }}><IconSearch /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations…" style={{ width: "100%", height: 36, padding: "0 12px 0 34px", borderRadius: 12, border: "1px solid transparent", background: "var(--cream-100)", fontSize: 13, fontFamily: "var(--font-body)", color: "var(--ink-900)", outline: "none", boxSizing: "border-box" }} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 16px" }}>
          {loading ? (
            <div style={{ padding: "16px 22px", fontSize: 13, color: "var(--ink-500)" }}>Loading inbox…</div>
          ) : filteredThreads.length === 0 ? (
            <div style={{ padding: "16px 22px", fontSize: 13, color: "var(--ink-500)" }}>
              {search.trim() ? "No threads match your search." : "No conversations yet. Message a customer from one of their bids."}
            </div>
          ) : filteredThreads.map((thread) => {
            const isActive = activeThread === thread.id;
            const initials = thread.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
            return (
              <div
                key={thread.id}
                onClick={() => { setActiveThread(thread.id); setMobilePane("thread"); }}
                style={{
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
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: avGrad, color: "white", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, marginTop: 2, flexShrink: 0 }}>{initials}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-900)" }}>{thread.name}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-400)", whiteSpace: "nowrap" }}>{thread.time}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thread.preview}</div>
                  <div style={{ marginTop: 6 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px", borderRadius: 999, fontSize: 10, fontWeight: 600, background: "var(--cream-100)", color: "var(--ink-700)", border: "1px solid var(--border-warm)" }}>
                      Direct message
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 2 }}>
                  {thread.unread > 0 ? <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: "var(--terracotta-600)", color: "white" }}>{thread.unread}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`${mobilePane === "thread" ? "flex" : "hidden"} flex-col md:flex`}
        style={{ background: "var(--bg-card)", minHeight: 0, overflow: "hidden" }}
      >
        {!activeConv ? (
          <div className="chat-welcome" style={{ margin: "auto" }}>
            <div className="chat-welcome-mark">
              <IconChat />
            </div>
            <span className="bb-eyebrow">Messages</span>
            <h2>No conversations yet</h2>
            <p>Message a customer from one of their bids to start a conversation here.</p>
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
              {activeConv.other_user_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, color: "var(--ink-900)" }}>
                  {activeConv.other_user_name}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-500)" }}>Direct message thread</div>
            </div>
          </div>
        </div>

        <div
          ref={messageListRef}
          className="p-4 md:px-7 md:py-6"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}
        >
          <div style={{ alignSelf: "center", fontSize: 11, color: "var(--ink-400)", padding: "4px 12px", background: "var(--cream-100)", borderRadius: 999 }}>
            Conversation
          </div>

          {renderedMessages.length === 0 ? (
            <div style={{ alignSelf: "center", padding: "16px 18px", borderRadius: 14, background: "var(--cream-50)", border: "1px solid var(--border-warm)", fontSize: 13, color: "var(--ink-500)" }}>No messages yet in this thread.</div>
          ) : renderedMessages.map((message, index) => (
            <div key={index} style={{ display: "flex", justifyContent: message.from === "me" ? "flex-end" : "flex-start" }}>
              <div style={{
                maxWidth: "70%",
                padding: "10px 14px",
                borderRadius: 14,
                fontSize: 14,
                lineHeight: 1.5,
                background: message.from === "me" ? "var(--terracotta-600)" : "white",
                color: message.from === "me" ? "white" : "var(--ink-900)",
                border: message.from === "me" ? "0" : "1px solid var(--border-warm)",
                boxShadow: message.from === "me" ? "0 4px 12px -6px rgba(232,98,63,0.4)" : "none",
                borderBottomRightRadius: message.from === "me" ? 4 : 14,
                borderBottomLeftRadius: message.from === "me" ? 14 : 4,
              }}>
                <div>{message.text}</div>
                <div style={{ fontSize: 10, marginTop: 4, opacity: 0.7, textAlign: message.from === "me" ? "right" : "left" }}>{message.time}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="provider-composer-pad p-4 md:p-[18px]" style={{ borderTop: "1px solid var(--border-warm)", background: "var(--bg-card)", paddingBottom: "calc(88px + var(--safe-bottom))" }}>
          <style>{`@media (min-width: 768px) { .provider-composer-pad { padding-bottom: 18px !important; } }`}</style>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--cream-50)", border: "1px solid var(--border-warm)", borderRadius: 14 }}>
            <span style={{ color: "var(--ink-500)" }}><IconPaperclip /></span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder={`Reply to ${activeConv.other_user_name}…`}
              style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontSize: 14, fontFamily: "var(--font-body)", color: "var(--ink-900)" }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!draft.trim() || sending || !activeConv}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: draft.trim() ? "var(--terracotta-600)" : "var(--cream-200)", color: draft.trim() ? "white" : "var(--ink-400)", border: 0, fontFamily: "var(--font-body)" }}
            >
              <IconSend /> Send
            </button>
          </div>
        </div>
        </>
        )}
      </div>

    </div>
  );
}
