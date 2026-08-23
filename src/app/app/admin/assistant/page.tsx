import { redirect } from "next/navigation";

/**
 * Ask Bundleen AI now lives in the global floating widget, not a dedicated
 * page. This route only exists so an old bookmark or link doesn't 404.
 */
export default function AdminAssistantPage() {
  redirect("/app/admin/dashboard");
}
