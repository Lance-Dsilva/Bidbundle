export type HoaShareStatementView = {
  id: string; periodStart: string; periodEnd: string; totalCents: number;
  savingsCents: number; availableCents: number; distributedCents: number;
  closingBalanceCents: number; status: string; paidAt: string | null; reference: string | null;
};
export type HoaShareDashboard = {
  communityId: string; communityName: string; rateBps: number; payoutStatus: string;
  savingsCents: number; earnedCents: number; availableCents: number; payoutHoldReason: string | null;
  currentMonth: string; monthSavingsCents: number; monthEarnedCents: number;
  statements: HoaShareStatementView[];
};
export type HoaShareStatementExport = HoaShareStatementView & {
  communityId: string; communityName: string; openingBalanceCents: number;
  lines: { date: string; kind: string; amountCents: number; savingsCents: number }[];
};
