import "server-only";

import type { CommunityInterestList } from "@/lib/community-interest-types";
import { db } from "@/lib/server/db";
import { communityInterestKey, type CommunityInterestInput, type CommunityInterestListQuery } from "@/lib/validation/community-interest";

const DUPLICATE_INDEX = "CommunityInterest_email_communityKey_key";
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
/** The PostgreSQL adapter may quote camelCase SQL identifiers in its metadata.
 * Decode identifier quoting only; never trim, case-fold or accept extra fields. */
function sqlIdentifier(value: unknown): unknown {
  return typeof value === "string" && /^"(?:[^"]|"")*"$/.test(value)
    ? value.slice(1, -1).replace(/""/g, '"')
    : value;
}
function duplicateFields(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const fields = value.map(sqlIdentifier);
  return fields.includes("email") && fields.includes("communityKey");
}

/** Do not turn primary-key collisions or unrelated database failures into success. */
function isDuplicateCommunityInterest(error: unknown): boolean {
  const candidate = record(error);
  if (!candidate) return false;
  if (candidate.code === "23505") return sqlIdentifier(candidate.constraint) === DUPLICATE_INDEX;
  if (candidate.code !== "P2002") return false;
  const meta = record(candidate.meta);
  if (meta?.modelName !== undefined && meta.modelName !== "CommunityInterest") return false;
  if (sqlIdentifier(meta?.target) === DUPLICATE_INDEX || duplicateFields(meta?.target)) return true;
  const cause = record(record(meta?.driverAdapterError)?.cause);
  const constraint = record(cause?.constraint);
  return sqlIdentifier(constraint?.name) === DUPLICATE_INDEX || duplicateFields(constraint?.fields);
}

/** Anonymous repeats never replace the original contact details. */
export async function submitCommunityInterest(input: CommunityInterestInput): Promise<void> {
  try {
    await db.communityInterest.create({ data: { ...input, communityKey: communityInterestKey(input.communityName) } });
  } catch (error) {
    if (!isDuplicateCommunityInterest(error)) throw error;
  }
}

/** Route callers must pass the existing verified administrator gate first. */
export async function listCommunityInterest(query: CommunityInterestListQuery): Promise<CommunityInterestList> {
  const [items, total] = await Promise.all([
    db.communityInterest.findMany({
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true, contactName: true, contactRole: true, communityName: true,
        numberOfHomes: true, email: true, phone: true, createdAt: true,
      },
    }),
    db.communityInterest.count(),
  ]);
  return { items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })), total, page: query.page, pageSize: query.pageSize };
}
