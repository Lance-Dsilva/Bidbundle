export type BidStatus = "active" | "won" | "past";

export interface BidHistoryItem {
  id: string;
  title: string;
  category: string;
  provider: string;
  amount: number;
  date: string;
  status: BidStatus;
  statusLabel: string;
}

export const mockBidHistory: BidHistoryItem[] = [
  {
    id: "bh-1",
    title: "Plumbing leak inspection",
    category: "Plumbing",
    provider: "ProFix Plumbing",
    amount: 490,
    date: "18m ago",
    status: "active",
    statusLabel: "In Progress",
  },
  {
    id: "bh-2",
    title: "Lawn care bundle",
    category: "Landscaping",
    provider: "GreenThumb Co",
    amount: 275,
    date: "Today",
    status: "active",
    statusLabel: "In Progress",
  },
  {
    id: "bh-3",
    title: "House cleaning",
    category: "Cleaning",
    provider: "SparkleClean",
    amount: 140,
    date: "Apr 10",
    status: "won",
    statusLabel: "Complete",
  },
  {
    id: "bh-4",
    title: "Gutter repair",
    category: "Exterior",
    provider: "AllWeather Crew",
    amount: 330,
    date: "Mar 28",
    status: "past",
    statusLabel: "Saved",
  },
];
