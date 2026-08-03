export const mockAdminStats = {
  communityName: "Oakwood Heights HOA",
  adminName: "Lance Silva",
  adminInitials: "LS",
  totalMembers: 14,
  activeBids: 3,
  monthlySavings: 310,
  totalSavingsAllTime: 1840,
};

export interface CommunityMember {
  id: string;
  name: string;
  address: string;
  joinDate: string;
  eligibility: "verified" | "pending" | "ineligible";
}

export const mockCommunityMembers: CommunityMember[] = [
  {
    id: "m-1",
    name: "Sarah Miller",
    address: "12 Maple St",
    joinDate: "Jan 2024",
    eligibility: "verified",
  },
  {
    id: "m-2",
    name: "James Kim",
    address: "14 Maple St",
    joinDate: "Feb 2024",
    eligibility: "verified",
  },
  {
    id: "m-3",
    name: "Priya Raman",
    address: "18 Maple St",
    joinDate: "Mar 2024",
    eligibility: "verified",
  },
  {
    id: "m-4",
    name: "David Chen",
    address: "22 Cedar Lane",
    joinDate: "Mar 2024",
    eligibility: "pending",
  },
  {
    id: "m-5",
    name: "Aisha Patel",
    address: "30 Cedar Lane",
    joinDate: "Apr 2024",
    eligibility: "pending",
  },
  {
    id: "m-6",
    name: "Tom Nguyen",
    address: "8 Oak Ave",
    joinDate: "Apr 2024",
    eligibility: "ineligible",
  },
];

export interface ActivityItem {
  id: string;
  description: string;
  time: string;
  type: "bid" | "join" | "saving";
}

export const mockRecentActivity: ActivityItem[] = [
  {
    id: "a-1",
    description: "ProFix Plumbing submitted a bid on Plumbing leak inspection",
    time: "18m ago",
    type: "bid",
  },
  {
    id: "a-2",
    description: "David Chen applied to join Oakwood Heights community",
    time: "2h ago",
    type: "join",
  },
  {
    id: "a-3",
    description: "Lawn care group bid saved $130 across 5 homes",
    time: "Yesterday",
    type: "saving",
  },
];

export const mockSavingsReport = {
  categories: [
    { name: "Plumbing", saved: 490, bids: 1 },
    { name: "Landscaping", saved: 275, bids: 2 },
    { name: "Exterior", saved: 220, bids: 1 },
    { name: "Cleaning", saved: 140, bids: 1 },
    { name: "Handyman", saved: 120, bids: 1 },
  ],
};
