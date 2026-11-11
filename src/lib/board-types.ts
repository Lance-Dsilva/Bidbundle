import type { PoolQuote } from "@/lib/pool-bid-template";
export const BOARD_RULES = ["manager_only", "board_majority", "board_quorum_n", "board_unanimous"] as const;
export type BoardRule = typeof BOARD_RULES[number];
export type BoardPolicy = { rule: BoardRule; quorumN: number | null; version: number };
export type BoardMemberSummary = { id: string; userId: string; name: string; joinedAt: string; status: string; isVerified?: boolean };
export type BoardProposal = {
  bidId: string; version: number; providerUserId: string; providerName: string;
  providerBio?: string | null; businessStartedYear?: number | null; trades?: string[];
  amountCents: number; currency: string; poolQuote: PoolQuote | null; scope: string; exclusions: string | null;
  startDate: string | null; validUntil: string | null; verified: boolean; rating: number | null; reviewCount: number;
  insuranceCoverageCents: number | null; insuranceExpiresAt: string | null; licenseDocumentId: string | null; insuranceDocumentId: string | null;
};
export type BoardRoundSummary = {
  id: string; status: string; rule: BoardRule; quorumN: number | null; threshold: number; deadline: string; createdAt: string;
  electorate: BoardMemberSummary[]; proposals: BoardProposal[]; stale: boolean; staleReason: string | null; awardedBidId: string | null;
  votes: Array<{ bidId: string; voterUserId: string; voterName: string; decision: "approve" | "reject"; comment: string | null; createdAt: string }>;
  commentCount: number; commentsTruncated: boolean;
  comments: Array<{ id: string; authorUserId: string; authorName: string; body: string; createdAt: string }>;
};
export type BoardReviewView = {
  request: { id: string; communityId: string; communityName: string; title: string; status: string };
  canManage: boolean; viewerUserId: string; policy: BoardPolicy; members: BoardMemberSummary[];
  proposals: BoardProposal[]; rounds: BoardRoundSummary[];
};
export type BoardCommunitySummary = {
  id: string; name: string; canManage: boolean; policy: BoardPolicy; members: BoardMemberSummary[];
  requests: Array<{ id: string; title: string; status: string }>;
};
