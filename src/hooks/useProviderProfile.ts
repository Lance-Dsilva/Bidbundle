"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken, fetchMe, type AuthUser } from "@/lib/auth";

export interface ProviderProfileFull {
  id: number;
  user_id: number;
  company_name: string | null;
  bio: string | null;
  trades: string;
  service_radius_mi: number;
  address: string | null;
  neighborhood: string | null;
  working_hours_start: string;
  working_hours_end: string;
  working_days: string;
  is_insured: boolean;
  is_licensed: boolean;
  license_number: string | null;
  bank_last4: string | null;
}

export function useProviderProfile() {
  const [profile, setProfile] = useState<ProviderProfileFull | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    Promise.all([
      apiFetch<ProviderProfileFull>("/provider/me", { token }),
      fetchMe(token),
    ])
      .then(([prof, me]) => { setProfile(prof); setUser(me); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const updateProfile = async (patch: Partial<ProviderProfileFull>) => {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      const updated = await apiFetch<ProviderProfileFull>("/provider/me", {
        method: "PATCH",
        body: JSON.stringify(patch),
        token,
      });
      setProfile(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return { profile, user, loading, saving, error, updateProfile };
}
