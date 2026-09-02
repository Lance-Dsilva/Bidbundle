"use client";

import { useConversationInbox } from "@/hooks/useConversationInbox";

/**
 * The provider's side of their job conversations.
 *
 * Only the base path differs from the customer's inbox; see
 * {@link useConversationInbox} for why there is one implementation.
 */
export function useProviderInbox() {
  return useConversationInbox("/provider/inbox");
}
