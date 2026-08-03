import type { Bid } from "@/types";

export const mockBids: Bid[] = [
  {
    id: "bid-1",
    requestId: "request-1",
    providerId: "provider-1",
    amount: 490,
    status: "leading",
    estimatedDays: 2,
  },
  {
    id: "bid-2",
    requestId: "request-1",
    providerId: "provider-2",
    amount: 530,
    status: "submitted",
    estimatedDays: 3,
  },
  {
    id: "bid-3",
    requestId: "request-2",
    providerId: "provider-3",
    amount: 275,
    status: "submitted",
    estimatedDays: 1,
  },
];
