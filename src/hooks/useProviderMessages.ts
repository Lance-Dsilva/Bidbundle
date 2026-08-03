"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface Conversation {
  id: number;
  other_user_id: number;
  other_user_name: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface Message {
  id: number;
  sender_id: number;
  sender_name: string;
  conversation_id: number | null;
  channel_id: number | null;
  text: string;
  read_at: string | null;
  created_at: string;
}

export function useProviderMessages() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    apiFetch<Conversation[]>("/provider/conversations", { token })
      .then(setConversations)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const getMessages = useCallback(async (convId: number): Promise<Message[]> => {
    const token = getToken();
    if (!token) return [];
    return apiFetch<Message[]>(`/provider/conversations/${convId}/messages`, { token });
  }, []);

  const sendMessage = useCallback(async (convId: number, text: string): Promise<Message | null> => {
    const token = getToken();
    if (!token) return null;
    const msg = await apiFetch<Message>(`/provider/conversations/${convId}/messages`, {
      method: "POST",
      body: JSON.stringify({ text }),
      token,
    });
    // Update last_message preview in conversations list
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, last_message: text, last_message_at: new Date().toISOString(), unread_count: 0 }
          : c
      )
    );
    return msg;
  }, []);

  const startConversation = useCallback(async (otherUserId: number): Promise<Conversation | null> => {
    const token = getToken();
    if (!token) return null;
    const conv = await apiFetch<Conversation>(
      `/provider/conversations?other_user_id=${otherUserId}`,
      { method: "POST", token }
    );
    setConversations((prev) =>
      prev.find((c) => c.id === conv.id) ? prev : [conv, ...prev]
    );
    return conv;
  }, []);

  return { conversations, loading, error, getMessages, sendMessage, startConversation, refresh };
}
