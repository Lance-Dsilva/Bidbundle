export const mockProviderStats = {
  businessName: "ProFix Plumbing",
  initials: "PF",
  category: "Plumbing",
  tagline: "Licensed · Insured · 10 yrs",
  rating: 4.9,
  reviewCount: 128,
  revenueEarned: 3343,
  jobsCompleted: 14,
};

export interface JobOpportunity {
  id: string;
  title: string;
  neighborhood: string;
  neighborsJoined: number;
  budgetMin: number;
  budgetMax: number;
  status: "live" | "upcoming";
  countdown?: string;
}

export const mockJobOpportunities: JobOpportunity[] = [
  {
    id: "jo-1",
    title: "Plumbing leak inspection",
    neighborhood: "Oakwood Heights",
    neighborsJoined: 3,
    budgetMin: 450,
    budgetMax: 620,
    status: "live",
  },
  {
    id: "jo-2",
    title: "Lawn care bundle",
    neighborhood: "Lakeview Park",
    neighborsJoined: 5,
    budgetMin: 180,
    budgetMax: 320,
    status: "live",
  },
  {
    id: "jo-3",
    title: "Gutter cleanup",
    neighborhood: "Oakwood Heights",
    neighborsJoined: 2,
    budgetMin: 120,
    budgetMax: 220,
    status: "upcoming",
    countdown: "32h 16m",
  },
];
