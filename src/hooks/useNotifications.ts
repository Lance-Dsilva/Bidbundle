import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

export interface AppNotification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  read: boolean;
  created_at: string;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    apiFetch<AppNotification[]>("/notifications", { token })
      .then(setNotifications)
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const markRead = async (id: number) => {
    const token = getToken();
    if (!token) return;
    await apiFetch(`/notifications/${id}/read`, { method: "POST", token });
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const dismiss = async (id: number) => {
    const token = getToken();
    if (!token) return;
    await apiFetch(`/notifications/${id}`, { method: "DELETE", token });
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return { notifications, loading, refresh, markRead, dismiss };
}
