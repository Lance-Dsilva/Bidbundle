import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import { listNotifications, markNotificationsRead } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  try {
    return NextResponse.json({
      notifications: await listNotifications(authorized.user.id),
    });
  } catch (error) {
    console.error("[notifications] list failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Something went wrong on our end. Please try again." },
      { status: 500 },
    );
  }
}

/** Marks all of the caller's notifications read. */
export async function POST(): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  try {
    await markNotificationsRead(authorized.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[notifications] mark-read failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Something went wrong on our end. Please try again." },
      { status: 500 },
    );
  }
}
