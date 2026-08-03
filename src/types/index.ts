export interface User {
  id: string;
  name: string;
  email: string;
  role: "homeowner" | "provider" | "admin";
  neighborhood: string;
}

export interface ServiceRequest {
  id: string;
  userId: string;
  title: string;
  category: string;
  description: string;
  neighborhood: string;
  status: "draft" | "grouping" | "live" | "closed";
  budgetMin: number;
  budgetMax: number;
}

export interface Bid {
  id: string;
  requestId: string;
  providerId: string;
  amount: number;
  status: "submitted" | "leading" | "accepted" | "rejected";
  estimatedDays: number;
}

export interface Provider {
  id: string;
  name: string;
  category: string;
  rating: number;
  neighborhood: string;
  jobsCompleted: number;
}
