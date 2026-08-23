"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { useBundleenAi } from "@/hooks/useBundleenAi";

const DEFAULT_SUGGESTIONS = [
  "What's open for bids right now?",
  "How does bidding work?",
  "What's on my schedule this week?",
  "Summarize recent activity",
];

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function initialsForSource(label: string) {
  return label.slice(0, 1).toUpperCase();
}

export type BundleenAiPanelProps = {
  /** Short prompt chips shown above the composer when the thread is empty or idle. */
  suggestions?: string[];
  subtitle?: string;
  /** Renders a close control in the header and id's the title for `aria-labelledby` — used by the floating widget. */
  onClose?: () => void;
  titleId?: string;
};

export function BundleenAiPanel({
  suggestions = DEFAULT_SUGGESTIONS,
  subtitle = "Grounded in your real Bundleen data",
  onClose,
  titleId,
}: BundleenAiPanelProps) {
  const { messages, status, error, sources, send, retry, clear } = useBundleenAi();
  const [composer, setComposer] = useState("");
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const busy = status === "loading" || status === "streaming";

  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const handleSend = () => {
    const text = composer.trim();
    if (!text || busy) return;
    send(text);
    setComposer("");
  };

  const handleSuggestion = (prompt: string) => {
    setComposer(prompt);
    composerRef.current?.focus();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-card)" }}>
      <style>{`@keyframes nbPulse{0%,100%{opacity:.3;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}`}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-warm)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            background: "linear-gradient(135deg, var(--orange-600), #ff8f36)",
            display: "grid",
            placeItems: "center",
            color: "white",
            flexShrink: 0,
          }}
        >
          <Icon name="sparkle" size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div id={titleId} style={{ fontWeight: 600, fontSize: 15, color: "var(--ink-900)" }}>Bundleen AI</div>
          <div style={{ fontSize: 12, color: "var(--ink-500)" }}>{subtitle}</div>
        </div>
        <button
          type="button"
          onClick={() => void clear()}
          disabled={messages.length === 0 || busy}
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 30,
            padding: "0 12px",
            borderRadius: 999,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: messages.length === 0 || busy ? "not-allowed" : "pointer",
            background: "transparent",
            color: "var(--ink-500)",
            border: "1px solid var(--border-warm-strong)",
            opacity: messages.length === 0 || busy ? 0.5 : 1,
          }}
        >
          Clear
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Bundleen AI chat"
            style={{
              display: "grid",
              placeItems: "center",
              width: 30,
              height: 30,
              borderRadius: 999,
              cursor: "pointer",
              background: "transparent",
              color: "var(--ink-500)",
              border: "1px solid var(--border-warm-strong)",
              flexShrink: 0,
            }}
          >
            <IconClose />
          </button>
        ) : null}
      </div>

      <div ref={messagesRef} style={{ flex: 1, overflowY: "auto", padding: "20px 20px 12px", display: "flex", flexDirection: "column", gap: 16 }}>
        {messages.length === 0 && status !== "error" ? (
          <div className="chat-welcome">
            <div className="chat-welcome-mark">
              <Icon name="sparkle" size={24} />
            </div>
            <span className="bb-eyebrow">Your Bundleen copilot</span>
            <h2>What can I help you with?</h2>
            <p>Ask about requests, bids, schedules, or how Bundleen works — answers are grounded in your own account, never invented.</p>
          </div>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} style={{ display: "flex", justifyContent: message.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: 520 }}>
              <div
                style={{
                  background: message.role === "user" ? "var(--terracotta-600)" : "var(--cream-100)",
                  color: message.role === "user" ? "white" : "var(--ink-900)",
                  borderRadius: message.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                  padding: "12px 16px",
                  fontSize: 14,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}
              >
                {message.content || (message.pending ? " " : "")}
              </div>
            </div>
          </div>
        ))}

        {status === "loading" && (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <div style={{ background: "var(--cream-100)", borderRadius: "18px 18px 18px 4px", padding: "12px 16px", display: "flex", gap: 5, alignItems: "center" }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "var(--terracotta-500)",
                    display: "inline-block",
                    animation: "nbPulse 1.2s ease-in-out infinite",
                    animationDelay: `${i * 0.2}s`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {status === "idle" && sources.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sources.map((source, index) => {
              const chip = (
                <span
                  key={`${source.type}-${index}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 26,
                    padding: "0 10px",
                    borderRadius: 999,
                    fontSize: 11.5,
                    fontWeight: 600,
                    background: source.type === "doc" ? "var(--sage-50)" : "var(--terracotta-50)",
                    color: source.type === "doc" ? "var(--sage-700)" : "var(--terracotta-600)",
                    border: "1px solid var(--border-warm)",
                  }}
                >
                  <span aria-hidden style={{ fontSize: 10 }}>
                    {initialsForSource(source.type === "doc" ? "Help" : "Data")}
                  </span>
                  {source.label}
                </span>
              );
              return source.href ? (
                <a key={`${source.type}-${index}`} href={source.href} style={{ textDecoration: "none" }}>
                  {chip}
                </a>
              ) : (
                chip
              );
            })}
          </div>
        )}

        {status === "error" && error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 16px",
              borderRadius: 12,
              background: "var(--terracotta-50)",
              border: "1px solid var(--terracotta-100)",
              color: "var(--terracotta-700, var(--terracotta-600))",
              fontSize: 13.5,
            }}
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                flexShrink: 0,
                height: 30,
                padding: "0 12px",
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                background: "var(--terracotta-600)",
                color: "white",
                border: 0,
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--border-warm)", padding: "12px 20px 20px", flexShrink: 0 }}>
        <div className="chat-suggestions">
          <span>Suggested</span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => handleSuggestion(suggestion)}
              style={{ display: "inline-flex", alignItems: "center", height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "var(--cream-100)", color: "var(--ink-900)", border: 0 }}
            >
              {suggestion}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 6px 14px", background: "var(--cream-100)", borderRadius: 22, border: "1px solid transparent" }}>
          <input
            ref={composerRef}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask Bundleen AI anything…"
            disabled={busy}
            style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontSize: 14, color: "var(--ink-900)", padding: "10px 0" }}
          />
          <button
            onClick={handleSend}
            disabled={!composer.trim() || busy}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: "var(--terracotta-600)",
              color: "white",
              border: 0,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: !composer.trim() || busy ? 0.5 : 1,
            }}
          >
            <IconSend />
          </button>
        </div>
      </div>
    </div>
  );
}
