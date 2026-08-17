import Link from "next/link";
import { notFound } from "next/navigation";

import { ProviderAdminControls } from "@/components/admin/ProviderAdminControls";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { requireRole } from "@/lib/server/auth";
import { getProviderDetail } from "@/lib/server/providers-admin";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ userId: string }> };

export default async function AdminProviderDetailPage({ params }: PageProps) {
  await requireRole(["admin"], "/app/admin/providers");

  const { userId } = await params;
  const provider = await getProviderDetail(userId);
  if (!provider) notFound();

  return (
    <div className="flex flex-col">
      <AppPageHeader
        title={provider.companyName ?? provider.user.fullName}
        subtitle={provider.companyName ? provider.user.fullName : "Service provider"}
        action={
          <Link
            href="/app/admin/providers"
            className="text-[12px] font-semibold"
            style={{ color: "var(--teal-800)" }}
          >
            ← All providers
          </Link>
        }
      />

      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 md:px-6 xl:px-8">
        <ProviderAdminControls initialProvider={provider} />
      </div>
    </div>
  );
}
