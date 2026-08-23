// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "@/components/ui/NotificationBell";
import type { AppNotification } from "@/hooks/useNotifications";

const NOTIFICATION: AppNotification = {
  id: "n1",
  type: "bid",
  title: "New bid received",
  body: "A provider bid on your request.",
  action_url: "/app/homeowner/bids",
  read: false,
  created_at: new Date().toISOString(),
};

function renderBell(overrides: Partial<ComponentProps<typeof NotificationBell>> = {}) {
  const markRead = vi.fn(async () => {});
  const dismiss = vi.fn(async () => {});
  const props = {
    notifications: [] as AppNotification[],
    loading: false,
    markRead,
    dismiss,
    ...overrides,
  };
  const utils = render(<NotificationBell {...props} />);
  return { ...utils, markRead, dismiss };
}

describe("NotificationBell", () => {
  afterEach(() => cleanup());

  it("shows a loading state while notifications are fetching", () => {
    renderBell({ loading: true });
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("Loading notifications…")).toBeInTheDocument();
  });

  it("shows an empty state when there is nothing to read", () => {
    renderBell({ notifications: [] });
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it("lists notifications and supports dismiss", async () => {
    const { dismiss } = renderBell({ notifications: [NOTIFICATION] });
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(screen.getByText("New bid received")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith("n1"));
  });

  it("marks a notification read when its View link is followed, and closes on Escape", async () => {
    const { markRead } = renderBell({ notifications: [NOTIFICATION] });
    const trigger = screen.getByRole("button", { name: "Notifications" });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("link", { name: "View" }));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("n1"));

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
