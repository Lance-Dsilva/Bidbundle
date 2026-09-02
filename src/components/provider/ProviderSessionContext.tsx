"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { ProviderAccountStatus } from "@/generated/prisma/enums";

/**
 * The one piece of provider state the whole console shares.
 *
 * The console's shell used to call the dashboard and profile endpoints on
 * every route so it could render a company name and an unread badge, which
 * duplicated whatever the page underneath was already loading. Those two
 * facts now arrive from the server layout — one query, no client request — and
 * live here.
 *
 * `unreadMessages` is seeded from that server read and then owned by the
 * messages page: opening a thread marks it read, and the badge must follow,
 * because a layout does not re-render on client navigation. Nothing else is
 * allowed in here. Page data belongs to the page that shows it.
 */

export type ProviderSession = {
  companyName: string | null;
  accountStatus: ProviderAccountStatus;
  unreadMessages: number;
  /** Called by the messages page once it knows the live count. */
  setUnreadMessages: (count: number) => void;
};

const ProviderSessionContext = createContext<ProviderSession | null>(null);

export type ProviderSessionSeed = {
  companyName: string | null;
  accountStatus: ProviderAccountStatus;
  unreadMessages: number;
};

export function ProviderSessionProvider({
  seed,
  children,
}: Readonly<{ seed: ProviderSessionSeed; children: ReactNode }>) {
  const [unreadMessages, setUnreadMessages] = useState(seed.unreadMessages);

  const value = useMemo<ProviderSession>(
    () => ({
      companyName: seed.companyName,
      accountStatus: seed.accountStatus,
      unreadMessages,
      setUnreadMessages,
    }),
    [seed.accountStatus, seed.companyName, unreadMessages],
  );

  return (
    <ProviderSessionContext.Provider value={value}>{children}</ProviderSessionContext.Provider>
  );
}

/**
 * Reads the provider session.
 *
 * Throws outside the provider layout rather than returning a placeholder: a
 * component rendering provider chrome without a provider session is a wiring
 * mistake, and a silent default would hide it.
 */
export function useProviderSession(): ProviderSession {
  const value = useContext(ProviderSessionContext);
  if (!value) {
    throw new Error("useProviderSession must be used inside the provider layout.");
  }
  return value;
}
