"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchMe, getToken, type AuthUser } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

type NeighbourhoodChannel = {
  id: number;
  neighbourhood_id: number;
  neighbourhood_name: string;
  member_count: number;
  created_at: string;
};

type NeighbourhoodMember = {
  user_id: number;
  full_name: string;
  joined_at: string;
};

export function useNeighbourhoodSummary() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [channel, setChannel] = useState<NeighbourhoodChannel | null>(null);
  const [members, setMembers] = useState<NeighbourhoodMember[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const me = await fetchMe(token).catch(() => null);
      setUser(me);

      const nextChannel = await apiFetch<NeighbourhoodChannel | null>("/neighbourhood/channel", { token }).catch(() => null);
      setChannel(nextChannel);

      if (nextChannel) {
        const nextMembers = await apiFetch<NeighbourhoodMember[]>("/neighbourhood/channel/members", { token }).catch(() => []);
        setMembers(nextMembers);
      } else {
        setMembers([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const onFocus = () => void refresh();
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    const interval = window.setInterval(() => void refresh(), 15000);

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const otherMembers = members
    .filter((member) => String(member.user_id) !== user?.id)
    .sort((a, b) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime());

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newThisWeek = otherMembers.filter((member) => new Date(member.joined_at).getTime() >= weekAgo).length;

  return {
    user,
    channel,
    members,
    otherMembers,
    loading,
    refresh,
    neighbourhoodName: channel?.neighbourhood_name ?? user?.neighborhood ?? "Your neighbourhood",
    memberCount: members.length,
    neighborCount: otherMembers.length,
    newThisWeek,
  };
}
