import type { ServiceRequest } from "@/types";

export const mockServiceRequests: ServiceRequest[] = [
  {
    id: "request-1",
    userId: "user-1",
    title: "Plumbing leak inspection",
    category: "Plumbing",
    description: "Kitchen sink leak affecting two adjacent units.",
    neighborhood: "Oakwood Heights",
    status: "live",
    budgetMin: 450,
    budgetMax: 620,
  },
  {
    id: "request-2",
    userId: "user-2",
    title: "Lawn care bundle",
    category: "Landscaping",
    description: "Weekly mow and trim for homes on Cedar Lane.",
    neighborhood: "Lakeview Park",
    status: "grouping",
    budgetMin: 180,
    budgetMax: 320,
  },
  {
    id: "request-3",
    userId: "user-1",
    title: "Gutter cleanup",
    category: "Exterior",
    description: "Seasonal gutter cleaning before spring storms.",
    neighborhood: "Oakwood Heights",
    status: "draft",
    budgetMin: 120,
    budgetMax: 220,
  },
];
