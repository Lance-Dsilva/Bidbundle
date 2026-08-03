"use client";

import { useEffect, useState } from "react";

import { fetchMe, getToken, type AuthUser } from "@/lib/auth";
import { apiFetch } from "@/lib/api";

export interface HomeownerProfile {
  id: number;
  user_id: number;
  service_radius_mi: number;
  notif_bids: boolean;
  notif_groups: boolean;
  notif_savings: boolean;
}

export function useHomeownerProfile() {
  const [profile, setProfile] = useState<HomeownerProfile | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    Promise.all([
      apiFetch<HomeownerProfile>("/homeowner/me", { token }),
      fetchMe(token),
    ])
      .then(([prof, me]) => {
        setProfile(prof);
        setUser(me);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateProfile = async (patch: Partial<HomeownerProfile>) => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      const updated = await apiFetch<HomeownerProfile>("/homeowner/me", {
        method: "PATCH",
        body: JSON.stringify(patch),
        token,
      });
      setProfile(updated);
    } finally {
      setSaving(false);
    }
  };

  const updateUser = async (patch: {
    full_name?: string;
    phone?: string;
    address?: string;
    neighborhood?: string;
  }) => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      const updated = await apiFetch<AuthUser>("/users/me", {
        method: "PUT",
        body: JSON.stringify({ full_name: user?.full_name ?? "", ...patch }),
        token,
      });
      setUser(updated);
    } finally {
      setSaving(false);
    }
  };

  return { profile, user, loading, saving, updateProfile, updateUser };
}
