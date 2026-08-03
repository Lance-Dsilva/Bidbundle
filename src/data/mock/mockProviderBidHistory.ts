export type ProviderBidStatus = "active" | "won" | "lost";

export interface ProviderBidItem {
  id: string;
  title: string;
  neighborhood: string;
  amount: number;
  date: string;
  status: ProviderBidStatus;
  statusLabel: string;
}

export const mockProviderBidHistory: ProviderBidItem[] = [
  {
    id: "pb-1",
    title: "Plumbing",
    neighborhood: "Maple St",
    amount: 3325,
    date: "Apr 18",
    status: "won",
    statusLabel: "Win",
  },
  {
    id: "pb-2",
    title: "Lawn care",
    neighborhood: "Oak St",
    amount: 720,
    date: "Today",
    status: "active",
    statusLabel: "In Progress",
  },
  {
    id: "pb-3",
    title: "Handyman",
    neighborhood: "Elm Ct",
    amount: 680,
    date: "Apr 10",
    status: "won",
    statusLabel: "Win",
  },
  {
    id: "pb-4",
    title: "Water heater",
    neighborhood: "Pine Ave",
    amount: 880,
    date: "Mar 30",
    status: "active",
    statusLabel: "In Progress",
  },
  {
    id: "pb-5",
    title: "Gutter clean",
    neighborhood: "Ash Blvd",
    amount: 0,
    date: "Mar 28",
    status: "lost",
    statusLabel: "Lost",
  },
];
