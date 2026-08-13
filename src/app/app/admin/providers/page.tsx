import Link from "next/link";

import {
  AdminEmptyState,
  formatDate,
  PersonLine,
  PROVIDER_STATUS_TONE,
  StatusPill,
} from "@/components/admin/AdminPrimitives";
import { ProviderFilters } from "@/components/admin/ProviderFilters";
import { AppPageHeader } from "@/components/layout/AppPageHeader";
import { requireRole } from "@/lib/server/auth";
import { listProviders } from "@/lib/server/providers-admin";
import { providerListQuerySchema, searchParamsToObject } from "@/lib/validation/community";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminProvidersPage({ searchParams }: PageProps) {
  await requireRole(["admin"], "/app/admin/providers");

  const resolved = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === "string") params.set(key, value);
  }

  const query = providerListQuerySchema.parse(searchParamsToObject(params));
  const { providers, total } = await listProviders(query);
  const lastPage = Math.max(1, Math.ceil(total / query.pageSize));
  const pageHref = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    return `/app/admin/providers?${next.toString()}`;
  };

  const hasFilters = Boolean(query.search || query.status || query.verification);

  return (
    <div className="flex flex-col">
      <AppPageHeader
        title="Service providers"
        subtitle={`${total} provider${total === 1 ? "" : "s"} match this view`}
      />

      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-7 pb-24">
        <ProviderFilters query={query} />

        {providers.length === 0 ? (
          <AdminEmptyState
            title={hasFilters ? "No providers match these filters" : "No provider accounts yet"}
            body={
              hasFilters
                ? "Clear a filter to widen the search."
                : "Providers appear here as soon as they complete public sign-up."
            }
          />
        ) : (
          <ul className="space-y-3">
            {providers.map((provider) => (
              <li key={provider.userId}>
                <Link
                  href={`/app/admin/providers/${provider.userId}`}
                  className="block rounded-2xl border p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
                  style={{ background: "var(--paper)", borderColor: "var(--line)" }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <PersonLine
                      person={provider.user}
                      meta={
                        <>
                          {provider.companyName ?? "No company name"}
                          {provider.trades.length > 0 ? ` · ${provider.trades.join(", ")}` : ""}
                          {` · joined ${formatDate(provider.createdAt)}`}
                        </>
                      }
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={
                          provider.isLicenseVerified ? "Licence verified" : "Licence unverified"
                        }
                        tone={provider.isLicenseVerified ? "positive" : "neutral"}
                        withDot={false}
                      />
                      <StatusPill
                        label={
                          provider.isInsuranceVerified
                            ? "Insurance verified"
                            : "Insurance unverified"
                        }
                        tone={provider.isInsuranceVerified ? "positive" : "neutral"}
                        withDot={false}
                      />
                      <StatusPill
                        label={
                          provider.accountStatus[0].toUpperCase() + provider.accountStatus.slice(1)
                        }
                        tone={PROVIDER_STATUS_TONE[provider.accountStatus]}
                      />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {lastPage > 1 && (
          <nav className="flex items-center justify-between" aria-label="Provider pages">
            {query.page > 1 ? <Link href={pageHref(query.page - 1)}>← Previous</Link> : <span />}
            <span className="text-[12px]" style={{ color: "var(--muted)" }}>Page {query.page} of {lastPage}</span>
            {query.page < lastPage ? <Link href={pageHref(query.page + 1)}>Next →</Link> : <span />}
          </nav>
        )}
      </div>
    </div>
  );
}
