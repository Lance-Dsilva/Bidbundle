import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface AppNotification {
  id: string;
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
    setLoading(true);
    apiFetch<{
      notifications: Array<{
        id: string;
        kind: string;
        title: string;
        body: string;
        linkPath: string | null;
        readAt: string | null;
        createdAt: string;
      }>;
    }>("/me/notifications")
      .then(({ notifications: rows }) =>
        setNotifications(
          rows
            .filter((row) => row.readAt === null)
            .map((row) => ({
              id: row.id,
              type: row.kind,
              title: row.title,
              body: row.body,
              action_url: row.linkPath,
              read: false,
              created_at: row.createdAt,
            })),
        ),
      )
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const markRead = async (id: string) => {
    await apiFetch(`/me/notifications/${encodeURIComponent(id)}`, { method: "POST" });
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  const dismiss = async (id: string) => {
    await apiFetch(`/me/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return { notifications, loading, refresh, markRead, dismiss };
}
