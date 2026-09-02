"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api";
import type {
  ConversationMessageView,
  ConversationPage,
  ConversationThread,
} from "@/lib/server/conversations";

/**
 * One side of the job conversations, whichever side that is.
 *
 * Both consoles read the same `ServiceConversation` rows through the same
 * participant-scoped service, so the only thing that differs is the base path:
 * `/provider/inbox` or `/homeowner/inbox`. Keeping one implementation is what
 * stops the two inboxes from drifting into disagreeing about ordering, unread
 * counts, or when a thread is marked read.
 *
 * This replaces `useProviderMessages` and `useHomeownerChat`, whose
 * `/provider/conversations` and `/homeowner/conversations` calls had no handler
 * at all, and whose "start a conversation with `other_user_id`" entry point
 * would have let a browser address any account by id. Every id below is a
 * server-issued cuid the caller already participates in.
 *
 * The hook owns selection as well as loading, because the two are coupled:
 * switching threads must abort the previous transcript request so a slow
 * response cannot overwrite the thread the reader has since moved to.
 */

type InboxPayload = { threads: ConversationThread[]; unreadTotal: number };

export function useConversationInbox(basePath: string) {
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessageView[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const listAbortRef = useRef<AbortController | null>(null);
  const threadAbortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const payload = await apiFetch<InboxPayload>(basePath, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setThreads(payload.threads);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "We could not load your inbox.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    void refresh();
    return () => listAbortRef.current?.abort();
  }, [refresh]);

  /** Clears this thread's unread badge locally once the server has agreed. */
  const clearUnread = useCallback((threadId: string) => {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId ? { ...thread, unreadCount: 0 } : thread,
      ),
    );
  }, []);

  const selectThread = useCallback(
    async (threadId: string | null) => {
      threadAbortRef.current?.abort();
      setActiveThreadId(threadId);
      setMessagesError(null);
      setSendError(null);

      if (threadId === null) {
        setMessages([]);
        return;
      }

      const controller = new AbortController();
      threadAbortRef.current = controller;
      setMessagesLoading(true);

      try {
        const page = await apiFetch<ConversationPage>(`${basePath}/${threadId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setMessages(page.messages);

        // Opening a thread is what "reading" it means. Marking read is a
        // separate, idempotent call, and a failure there must not break the
        // transcript the provider is already looking at.
        if (page.thread.unreadCount > 0) {
          try {
            await apiFetch(`${basePath}/${threadId}/read`, {
              method: "POST",
              signal: controller.signal,
            });
            if (!controller.signal.aborted) clearUnread(threadId);
          } catch {
            // Left unread; the next open tries again.
          }
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
        setMessages([]);
        setMessagesError(
          caught instanceof Error ? caught.message : "We could not open that conversation.",
        );
      } finally {
        if (!controller.signal.aborted) setMessagesLoading(false);
      }
    },
    [basePath, clearUnread],
  );

  useEffect(() => () => threadAbortRef.current?.abort(), []);

  const send = useCallback(
    async (body: string): Promise<boolean> => {
      const threadId = activeThreadId;
      if (!threadId || sending) return false;

      setSending(true);
      setSendError(null);
      try {
        const payload = await apiFetch<{ message: ConversationMessageView }>(
          `${basePath}/${threadId}/messages`,
          { method: "POST", body: JSON.stringify({ body }) },
        );
        setMessages((current) => [...current, payload.message]);
        setThreads((current) =>
          [...current]
            .map((thread) =>
              thread.id === threadId
                ? {
                    ...thread,
                    lastMessagePreview: payload.message.body,
                    lastMessageAt: payload.message.createdAt,
                  }
                : thread,
            )
            // The server orders by last activity; mirroring it here keeps the
            // list from jumping when it is next refreshed.
            .sort(
              (a, b) =>
                new Date(b.lastMessageAt ?? 0).getTime() -
                new Date(a.lastMessageAt ?? 0).getTime(),
            ),
        );
        return true;
      } catch (caught) {
        setSendError(
          caught instanceof Error ? caught.message : "We could not send that message.",
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [activeThreadId, basePath, sending],
  );

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const unreadTotal = threads.reduce((sum, thread) => sum + thread.unreadCount, 0);

  return {
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
  };
}
