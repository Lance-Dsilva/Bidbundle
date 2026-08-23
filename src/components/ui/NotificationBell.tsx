"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import type { AppNotification } from "@/hooks/useNotifications";

export type NotificationBellProps = {
  notifications: AppNotification[];
  loading: boolean;
  markRead: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
};

/**
 * Accessible replacement for the old "scroll to the notifications rail card"
 * bell behavior. Presentational only — state comes from `useNotifications`,
 * kept entirely separate from AI widget state.
 */
export function NotificationBell({ notifications, loading, markRead, dismiss }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="bb-notif-bell">
      <button
        ref={triggerRef}
        type="button"
        className="dash-icon-btn"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="bell" size={18} />
        {notifications.length > 0 ? <span className="dash-notif-dot" /> : null}
      </button>

      {open ? (
        <div id={panelId} ref={panelRef} role="dialog" aria-label="Notifications" className="bb-notif-popover">
          <div className="bb-notif-popover-heading">
            <span>Notifications</span>
            {notifications.length > 0 ? <span className="dash-rail-count">{notifications.length}</span> : null}
          </div>
          <div className="bb-notif-popover-list">
            {loading ? (
              <div className="bb-notif-loading">Loading notifications…</div>
            ) : notifications.length === 0 ? (
              <div className="dash-rail-empty">
                <span className="dash-rail-icon">
                  <Icon name="check-circle" size={17} />
                </span>
                <div>
                  <strong>You&rsquo;re all caught up</strong>
                  <p>New updates will appear here.</p>
                </div>
              </div>
            ) : (
              notifications.map((notification) => (
                <div className="dash-rail-item" key={notification.id}>
                  <span className="dash-rail-icon">
                    <Icon name="bell" size={15} />
                  </span>
                  <div>
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    <div className="dash-rail-item-actions">
                      {notification.action_url ? (
                        <Link
                          href={notification.action_url}
                          onClick={() => {
                            void markRead(notification.id);
                            close();
                          }}
                        >
                          View
                        </Link>
                      ) : null}
                      <button type="button" onClick={() => void dismiss(notification.id)}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
