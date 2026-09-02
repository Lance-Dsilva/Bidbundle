"use client";

import { useCallback } from "react";

import { useConversationInbox } from "@/hooks/useConversationInbox";
import { apiFetch } from "@/lib/api";
import type { ConversationThread } from "@/lib/server/conversations";

/**
 * The customer's side of their job conversations.
 *
 * Replaces `useHomeownerChat`, which called three endpoints that no handler
 * served. The one addition over the shared hook is opening a thread, which
 * names a *bid* — the server reads the provider off it and confirms the bid is
 * on a request this account owns. No provider id ever crosses the wire.
 */
export function useHomeownerInbox() {
  const inbox = useConversationInbox("/homeowner/inbox");
  const { refresh, selectThread } = inbox;

  const openForBid = useCallback(
    async (bidId: string): Promise<ConversationThread> => {
      const payload = await apiFetch<{ thread: ConversationThread }>("/homeowner/inbox", {
        method: "POST",
        body: JSON.stringify({ bidId }),
      });
      // The thread may be brand new, so the list has to catch up before it can
      // be selected out of it.
      await refresh();
      await selectThread(payload.thread.id);
      return payload.thread;
    },
    [refresh, selectThread],
  );

  return { ...inbox, openForBid };
}
