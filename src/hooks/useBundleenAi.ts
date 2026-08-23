"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AiMessageRole = "user" | "assistant";

export type AiChatMessage = {
  id: string;
  role: AiMessageRole;
  content: string;
  /** True while an assistant reply is still streaming in. */
  pending?: boolean;
};

export type AiSource = { type: "data" | "doc"; label: string; href?: string };

export type AiChatStatus = "idle" | "loading" | "streaming" | "error";

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "done"; conversationId: string; sources: AiSource[] }
  | { type: "error"; message: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Owns the "Ask Bundleen AI" conversation: history, sending, streaming, and
 * error/retry/clear. Talks to `/api/ai/chat|history|memory` — no numeric-ID
 * legacy endpoints, unlike the older `useHomeownerChat` conversations code
 * this replaces for the AI thread specifically.
 */
export function useBundleenAi() {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [status, setStatus] = useState<AiChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<AiSource[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const lastMessageRef = useRef<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/history");
      if (!res.ok) return;
      const data: { messages?: { id: string; role: AiMessageRole; content: string }[] } =
        await res.json();
      setMessages(
        (data.messages ?? []).map((m) => ({ id: m.id, role: m.role, content: m.content })),
      );
    } catch {
      // Best-effort: the panel still works starting from an empty thread.
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const performSend = useCallback(async (text: string, appendUserMessage: boolean) => {
    lastMessageRef.current = text;
    setError(null);
    setSources([]);

    const userMessageId = `local-user-${Date.now()}`;
    const assistantMessageId = `local-assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      ...(appendUserMessage
        ? [{ id: userMessageId, role: "user" as const, content: text }]
        : []),
      { id: assistantMessageId, role: "assistant" as const, content: "", pending: true },
    ]);
    setStatus("loading");

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(
          response.status === 429
            ? (body?.error ?? "You've reached the message limit for now. Please try again shortly.")
            : (body?.error ?? GENERIC_ERROR),
        );
      }

      setStatus("streaming");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let streamError: string | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            continue;
          }

          if (event.type === "delta") {
            assistantText += event.text;
            const snapshot = assistantText;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId ? { ...m, content: snapshot, pending: true } : m,
              ),
            );
          } else if (event.type === "done") {
            setSources(event.sources ?? []);
          } else if (event.type === "error") {
            streamError = event.message;
          }
        }
      }

      if (streamError) throw new Error(streamError);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessageId ? { ...m, content: assistantText, pending: false } : m,
        ),
      );
      setStatus("idle");
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId));
      setError(err instanceof Error ? err.message : GENERIC_ERROR);
      setStatus("error");
    }
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || status === "loading" || status === "streaming") return;
      void performSend(trimmed, true);
    },
    [performSend, status],
  );

  const retry = useCallback(() => {
    const last = lastMessageRef.current;
    if (!last || status === "loading" || status === "streaming") return;
    void performSend(last, false);
  }, [performSend, status]);

  const clear = useCallback(async () => {
    try {
      await fetch("/api/ai/memory", { method: "DELETE" });
    } catch {
      // Best-effort — the local thread still resets.
    }
    setMessages([]);
    setSources([]);
    setError(null);
    setStatus("idle");
    lastMessageRef.current = null;
  }, []);

  return { messages, status, error, sources, historyLoaded, send, retry, clear };
}
