import { NextResponse } from "next/server";

import { authorizeRequest } from "@/lib/server/auth";
import {
  dismissNotification,
  markNotificationRead,
} from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ notificationId: string }> };

function validId(value: string): boolean {
  return value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  const { notificationId } = await context.params;
  if (!validId(notificationId)) {
    return NextResponse.json({ error: "Invalid notification." }, { status: 400 });
  }

  try {
    await markNotificationRead(authorized.user.id, notificationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[notifications] mark-one-read failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Something went wrong on our end." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const authorized = await authorizeRequest();
  if (!authorized.ok) return authorized.response;

  const { notificationId } = await context.params;
  if (!validId(notificationId)) {
    return NextResponse.json({ error: "Invalid notification." }, { status: 400 });
  }

  try {
    await dismissNotification(authorized.user.id, notificationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[notifications] dismiss failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ error: "Something went wrong on our end." }, { status: 500 });
  }
}
