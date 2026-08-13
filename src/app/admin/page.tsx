import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function AdminEntryPage() {
  const { userId } = await auth();
  redirect(userId ? "/app/admin/dashboard" : "/admin/sign-in");
}

