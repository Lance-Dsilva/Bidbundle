"use client";

import { useCallback, useEffect, useState } from "react";

import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

export interface Conversation {
  id: number;
  other_user_id: number;
  other_user_name: string;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface GroupChannel {
  id: number;
  request_id: number;
  request_title: string;
  member_count: number;
  last_message: string | null;
  last_message_at: string | null;
  unread_count: number;
  archived: boolean;
}

export interface ChatMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  conversation_id: number | null;
  channel_id: number | null;
  text: string;
  read_at: string | null;
  created_at: string;
}

export interface NeighbourhoodChannel {
  id: number;
  neighbourhood_id: number;
  neighbourhood_name: string;
  member_count: number;
  created_at: string;
}

export interface NeighbourhoodMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  content: string;
  created_at: string;
}

export function useHomeownerChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [channels, setChannels] = useState<GroupChannel[]>([]);
  const [neighbourhoodChannel, setNeighbourhoodChannel] = useState<NeighbourhoodChannel | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    Promise.all([
      apiFetch<Conversation[]>("/homeowner/conversations", { token }),
      apiFetch<GroupChannel[]>("/homeowner/channels", { token }),
      apiFetch<NeighbourhoodChannel | null>("/neighbourhood/channel", { token }).catch(() => null),
    ])
      .then(([convs, chans, nbChannel]) => {
        setConversations(convs);
        setChannels(chans);
        setNeighbourhoodChannel(nbChannel);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();

    const onFocus = () => refresh();
    const onVisibility = () => { if (!document.hidden) refresh(); };
    const interval = window.setInterval(refresh, 15000);

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const getMessages = useCallback(async (type: "dm" | "group", id: number): Promise<ChatMessage[]> => {
    const token = getToken();
    if (!token) return [];
    const path =
      type === "dm"
        ? `/homeowner/conversations/${id}/messages`
        : `/homeowner/channels/${id}/messages`;
    return apiFetch<ChatMessage[]>(path, { token });
  }, []);

  const sendMessage = useCallback(async (
    type: "dm" | "group",
    id: number,
    text: string
  ): Promise<ChatMessage | null> => {
    const token = getToken();
    if (!token) return null;
    const path =
      type === "dm"
        ? `/homeowner/conversations/${id}/messages`
        : `/homeowner/channels/${id}/messages`;
    return apiFetch<ChatMessage>(path, {
      method: "POST",
      body: JSON.stringify({ text }),
      token,
    });
  }, []);

  const getNeighbourhoodMessages = useCallback(async (channelId: number): Promise<NeighbourhoodMessage[]> => {
    const token = getToken();
    if (!token) return [];
    return apiFetch<NeighbourhoodMessage[]>(`/neighbourhood/channel/${channelId}/messages`, { token });
  }, []);

  const sendNeighbourhoodMessage = useCallback(async (channelId: number, text: string): Promise<NeighbourhoodMessage | null> => {
    const token = getToken();
    if (!token) return null;
    return apiFetch<NeighbourhoodMessage>(`/neighbourhood/channel/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: text }),
      token,
    });
  }, []);

  const askAi = useCallback(async (text: string): Promise<string | null> => {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await apiFetch<{ reply: string }>("/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: text, context_key: "general" }),
        token,
      });
      return res.reply;
    } catch {
      return null;
    }
  }, []);

  return {
    conversations, channels, neighbourhoodChannel, loading, refresh,
    getMessages, sendMessage, askAi,
    getNeighbourhoodMessages, sendNeighbourhoodMessage,
  };
}
