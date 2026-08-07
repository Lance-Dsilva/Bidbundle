export interface ProviderReview {
  id: string;
  reviewerName: string;
  reviewerInitial: string;
  rating: number;
  text: string;
  date: string;
}

export const mockProviderReviews: ProviderReview[] = [
  {
    id: "rv-1",
    reviewerName: "Sarah M.",
    reviewerInitial: "S",
    rating: 5,
    text: "I share the group plumbing job for 2 homes on our block and they coordinated perfectly.",
    date: "Apr 20",
  },
  {
    id: "rv-2",
    reviewerName: "James K.",
    reviewerInitial: "J",
    rating: 4,
    text: "Showed up on time and left no mess. Would use through Bundleen again.",
    date: "Apr 12",
  },
  {
    id: "rv-3",
    reviewerName: "Priya A.",
    reviewerInitial: "P",
    rating: 5,
    text: "Best quote in the group bid. Saved everyone money and did quality work.",
    date: "Mar 30",
  },
  {
    id: "rv-4",
    reviewerName: "Lulu O.",
    reviewerInitial: "L",
    rating: 5,
    text: "Coordinated the whole block. Saved everyone money.",
    date: "Mar 22",
  },
];

export const mockOverallRating = { average: 4.9, total: 128 };
