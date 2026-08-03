export interface BidRoomEntry {
  id: string;
  providerName: string;
  providerInitials: string;
  rating: number;
  jobsCompleted: number;
  amount: number;
  estimatedDays: number;
  isLeading: boolean;
}

export const mockBiddingRoomRequest = {
  title: "Plumbing leak inspection",
  category: "Plumbing",
  neighborhood: "Oakwood Heights",
  neighborsJoined: 3,
  neighborsTotal: 8,
  soloPrice: 575,
  countdown: "32h 16m",
};

export const mockBiddingRoomBids: BidRoomEntry[] = [
  {
    id: "br-1",
    providerName: "ProFix Plumbing",
    providerInitials: "PP",
    rating: 4.9,
    jobsCompleted: 128,
    amount: 490,
    estimatedDays: 2,
    isLeading: true,
  },
  {
    id: "br-2",
    providerName: "AquaFlow Services",
    providerInitials: "AF",
    rating: 4.7,
    jobsCompleted: 87,
    amount: 530,
    estimatedDays: 3,
    isLeading: false,
  },
  {
    id: "br-3",
    providerName: "PipePro Co",
    providerInitials: "PC",
    rating: 4.5,
    jobsCompleted: 62,
    amount: 575,
    estimatedDays: 4,
    isLeading: false,
  },
];
