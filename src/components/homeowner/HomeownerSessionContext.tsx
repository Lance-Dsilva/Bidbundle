"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * The one piece of customer state the whole homeowner console shares.
 *
 * The shell used to read its unread badge out of `/api/homeowner/dashboard`,
 * which the dashboard page underneath was already loading — two requests for
 * one payload on every route — and the number it showed was the *notification*
 * count, which the bell beside it already displays. The badge now counts
 * unread conversation messages, read once by the server layout.
 *
 * It is then owned by the chat page: opening a thread marks it read, and the
 * badge must follow, because a layout does not re-render on client navigation.
 * Nothing else belongs in here. Page data belongs to the page that shows it.
 */

export type HomeownerSession = {
  unreadMessages: number;
  /** Called by the chat page once it knows the live count. */
  setUnreadMessages: (count: number) => void;
};

const HomeownerSessionContext = createContext<HomeownerSession | null>(null);

export function HomeownerSessionProvider({
  unreadMessages: seed,
  children,
}: Readonly<{ unreadMessages: number; children: ReactNode }>) {
  const [unreadMessages, setUnreadMessages] = useState(seed);

  const value = useMemo<HomeownerSession>(
    () => ({ unreadMessages, setUnreadMessages }),
    [unreadMessages],
  );

  return (
    <HomeownerSessionContext.Provider value={value}>{children}</HomeownerSessionContext.Provider>
  );
}

/**
 * Reads the homeowner session.
 *
 * Returns a no-op session outside the homeowner layout rather than throwing:
 * the chat page is also reachable through other shells during role changes,
 * and a missing badge is not worth a crash.
 */
export function useHomeownerSession(): HomeownerSession {
  return (
    useContext(HomeownerSessionContext) ?? {
      unreadMessages: 0,
      setUnreadMessages: () => {},
    }
  );
}
