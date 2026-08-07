"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useProviderMessages } from "@/hooks/useProviderMessages";
import { Icon } from "@/components/ui/Icon";
import { apiFetch } from "@/lib/api";
import { fetchMe, getToken, type AuthUser } from "@/lib/auth";
import type { Message as ApiMsg } from "@/hooks/useProviderMessages";

function IconSearch() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>; }
function IconPaperclip() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12l-9 9a5 5 0 1 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 1 1-3-3l8-8"/></svg>; }
function IconSend() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>; }
function IconSpark() { return <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 5L19 9.8 14 11.6 12 17l-1.8-5.4L5 9.8 10.2 8z"/></svg>; }

type AIMemory = {
  id: number | string;
  user_id: number;
  context_key: string;
  role: string;
  content: string;
  created_at: string;
};

type Thread =
  | { kind: "ai"; id: "ai"; name: string; preview: string; time: string; unread: number }
  | { kind: "conv"; id: number; name: string; preview: string; time: string; unread: number };

const avGrad: Record<string, string> = {
  ai: "linear-gradient(135deg, var(--orange-500), var(--orange-600))",
  dm: "linear-gradient(135deg,#B07AA0,#7A4A6E)",
};

const quickAiPrompts = [
  "Which nearby job should I focus on next?",
  "Help me write a follow-up message for a pending bid",
  "What should I charge for a duplex pipe repair?",
];

export default function ProviderMessagesPage() {
  const { conversations, loading, getMessages, sendMessage } = useProviderMessages();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [activeThread, setActiveThread] = useState<"ai" | number>("ai");
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState<ApiMsg[]>([]);
  const [aiHistory, setAiHistory] = useState<AIMemory[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetchMe(token).then(setMe).catch(() => {});
  }, []);

  async function refreshAiHistory() {
    const token = getToken();
    if (!token) return;
    try {
      const history = await apiFetch<AIMemory[]>("/ai/history?context_key=general", { token });
      setAiHistory(history);
    } catch {}
  }

  useEffect(() => {
    void refreshAiHistory();
  }, []);

  useEffect(() => {
    if (activeThread === "ai") {
      setMessages([]);
      void refreshAiHistory();
      return;
    }
    void getMessages(activeThread).then(setMessages).catch(() => {});
  }, [activeThread, getMessages]);

  useEffect(() => {
    const listEl = messageListRef.current;
    if (!listEl) return;
    listEl.scrollTo({
      top: listEl.scrollHeight,
      behavior: activeThread === "ai" ? "auto" : "smooth",
    });
  }, [messages, aiHistory, activeThread]);

  const aiPreview = aiHistory[aiHistory.length - 1]?.content ?? "Ask about bids, pricing, route planning, or replies.";
  const threads = useMemo<Thread[]>(() => {
    const convThreads: Thread[] = conversations.map((conversation) => ({
      kind: "conv",
      id: conversation.id,
      name: conversation.other_user_name,
      preview: conversation.last_message ?? "No messages yet",
      time: conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
      unread: conversation.unread_count,
    }));
    return [
      {
        kind: "ai",
        id: "ai",
        name: "Bundleen AI",
        preview: aiPreview,
        time: aiHistory[aiHistory.length - 1]?.created_at ? new Date(aiHistory[aiHistory.length - 1].created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "",
        unread: 0,
      },
      ...convThreads,
    ];
  }, [aiHistory, aiPreview, conversations]);

  const filteredThreads = threads.filter((thread) => {
    const haystack = `${thread.name} ${thread.preview}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  const activeConv = typeof activeThread === "number" ? conversations.find((conversation) => conversation.id === activeThread) ?? null : null;
  const activeAiMessages = aiHistory
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      from: item.role === "assistant" ? "them" : "me",
      text: item.content,
      time: new Date(item.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    }));

  const activeDmMessages = messages.map((message) => ({
    from: message.sender_id === me?.id ? "me" : "them",
    text: message.text,
    time: new Date(message.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  }));

  const renderedMessages = activeThread === "ai" ? activeAiMessages : activeDmMessages;

  async function handleSend() {
    if (!draft.trim() || sending) return;
    const text = draft.trim();
    setDraft("");
    setSending(true);
    try {
      if (activeThread === "ai") {
        const token = getToken();
        if (!token) return;
        const createdAt = new Date().toISOString();
        const optimisticMessage: AIMemory = {
          id: `pending-${Date.now()}`,
          user_id: me?.id ?? 0,
          context_key: "general",
          role: "user",
          content: text,
          created_at: createdAt,
        };
        setAiHistory((prev) => [...prev, optimisticMessage]);
        const response = await apiFetch<{ reply: string }>("/ai/chat", {
          method: "POST",
          body: JSON.stringify({ message: text, context_key: "general" }),
          token,
        });
        setAiHistory((prev) => [
          ...prev,
          {
            id: `reply-${Date.now()}`,
            user_id: 0,
            context_key: "general",
            role: "assistant",
            content: response.reply,
            created_at: new Date().toISOString(),
          },
        ]);
        void refreshAiHistory();
      } else {
        const sent = await sendMessage(activeThread, text);
        if (sent) setMessages((prev) => [...prev, sent]);
      }
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
              <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 3 }}>Customers, active bids and AI</div>
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
            <div style={{ padding: "16px 22px", fontSize: 13, color: "var(--ink-500)" }}>No threads match your search.</div>
          ) : filteredThreads.map((thread) => {
            const isActive = activeThread === (thread.kind === "ai" ? "ai" : thread.id);
            const initials = thread.kind === "ai" ? "AI" : thread.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
            return (
              <div
                key={`${thread.kind}-${thread.id}`}
                onClick={() => { setActiveThread(thread.kind === "ai" ? "ai" : thread.id); setMobilePane("thread"); }}
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
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: thread.kind === "ai" ? avGrad.ai : avGrad.dm, color: "white", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, marginTop: 2, flexShrink: 0 }}>{initials}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-900)" }}>{thread.name}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-400)", whiteSpace: "nowrap" }}>{thread.time}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thread.preview}</div>
                  <div style={{ marginTop: 6 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px", borderRadius: 999, fontSize: 10, fontWeight: 600, background: "var(--cream-100)", color: "var(--ink-700)", border: "1px solid var(--border-warm)" }}>
                      {thread.kind === "ai" ? "AI assistant" : "Direct message"}
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
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: activeThread === "ai" ? avGrad.ai : avGrad.dm, color: "white", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
              {activeThread === "ai" ? "AI" : (activeConv?.other_user_name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? "DM")}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, color: "var(--ink-900)" }}>
                  {activeThread === "ai" ? "Bundleen AI" : activeConv?.other_user_name ?? "No active conversation"}
                </span>
                {activeThread === "ai" ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 18, padding: "0 8px", borderRadius: 999, fontSize: 10, fontWeight: 600, background: "var(--terracotta-50)", color: "var(--terracotta-600)" }}>
                    <IconSpark /> Live AI
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-500)" }}>
                {activeThread === "ai" ? "Ask about bids, routing, pricing, and customer replies" : "Direct message thread"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {activeThread === "ai" ? (
              <button
                onClick={async () => {
                  const token = getToken();
                  if (!token) return;
                  await apiFetch("/ai/memory?context_key=general", { method: "DELETE", token });
                  setAiHistory([]);
                }}
                style={{ display: "inline-flex", alignItems: "center", height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" }}
              >
                Clear memory
              </button>
            ) : null}
          </div>
        </div>

        <div
          ref={messageListRef}
          className="p-4 md:px-7 md:py-6"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}
        >
          <div style={{ alignSelf: "center", fontSize: 11, color: "var(--ink-400)", padding: "4px 12px", background: "var(--cream-100)", borderRadius: 999 }}>
            {activeThread === "ai" ? "General AI assistant" : "Conversation"}
          </div>

          {renderedMessages.length === 0 && activeThread === "ai" ? (
            <div className="chat-welcome">
              <div className="chat-welcome-mark"><Icon name="sparkle" size={24} /></div>
              <span className="bb-eyebrow">Your business copilot</span>
              <h2>What can I help you handle?</h2>
              <p>Get help prioritizing nearby work, pricing bids, planning routes, and writing clear customer replies.</p>
              <div className="chat-welcome-actions">
                {[
                  { icon: "search" as const, title: "Prioritize nearby jobs", copy: "Focus on the best opportunity", prompt: quickAiPrompts[0] },
                  { icon: "chat" as const, title: "Draft a follow-up", copy: "Write a clear customer reply", prompt: quickAiPrompts[1] },
                  { icon: "dollar" as const, title: "Check my pricing", copy: "Choose a competitive bid amount", prompt: quickAiPrompts[2] },
                ].map((action) => (
                  <button type="button" key={action.title} onClick={() => setDraft(action.prompt)}>
                    <span><Icon name={action.icon} size={18} /></span>
                    <strong>{action.title}</strong>
                    <small>{action.copy}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : renderedMessages.length === 0 ? (
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
          {activeThread === "ai" && sending ? (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  maxWidth: "70%",
                  padding: "10px 14px",
                  borderRadius: 14,
                  fontSize: 14,
                  lineHeight: 1.5,
                  background: "var(--bg-card)",
                  color: "var(--ink-900)",
                  border: "1px solid var(--border-warm)",
                  borderBottomLeftRadius: 4,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ display: "inline-flex", gap: 4, color: "var(--ink-400)", letterSpacing: "0.15em", fontWeight: 700 }}>
                    <span>•</span>
                    <span>•</span>
                    <span>•</span>
                  </span>
                  <span style={{ fontSize: 12, color: "var(--ink-500)" }}>Bundleen AI is typing</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="provider-composer-pad p-4 md:p-[18px]" style={{ borderTop: "1px solid var(--border-warm)", background: "var(--bg-card)", paddingBottom: "calc(88px + var(--safe-bottom))" }}>
          <style>{`@media (min-width: 768px) { .provider-composer-pad { padding-bottom: 18px !important; } }`}</style>
          {activeThread === "ai" ? (
            <div className="chat-suggestions">
              <span>Suggested</span>
              {quickAiPrompts.map((prompt) => (
                <button key={prompt} type="button" onClick={() => setDraft(prompt)} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--cream-100)", color: "var(--ink-900)", border: 0, cursor: "pointer" }}>
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--cream-50)", border: "1px solid var(--border-warm)", borderRadius: 14 }}>
            <span style={{ color: "var(--ink-500)" }}><IconPaperclip /></span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
              placeholder={activeThread === "ai" ? "Ask Bundleen AI anything…" : activeConv ? `Reply to ${activeConv.other_user_name}…` : "Select a conversation…"}
              style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontSize: 14, fontFamily: "var(--font-body)", color: "var(--ink-900)" }}
            />
            <button
              onClick={() => void handleSend()}
              disabled={!draft.trim() || sending || (activeThread !== "ai" && !activeConv)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: draft.trim() ? "var(--terracotta-600)" : "var(--cream-200)", color: draft.trim() ? "white" : "var(--ink-400)", border: 0, fontFamily: "var(--font-body)" }}
            >
              <IconSend /> Send
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
