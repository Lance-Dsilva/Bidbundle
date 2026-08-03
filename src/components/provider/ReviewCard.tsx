import type { ProviderReview } from "@/data/mock/mockProviderReviews";

interface ReviewCardProps {
  review: ProviderReview;
}

const COLORS = [
  "bg-primary",
  "bg-accent",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-sky-500",
];

function getAvatarColor(initial: string) {
  return COLORS[initial.charCodeAt(0) % COLORS.length];
}

export function ReviewCard({ review }: ReviewCardProps) {
  const color = getAvatarColor(review.reviewerInitial);
  return (
    <article className="rounded-card bg-card p-4 shadow-card">
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-bold text-white ${color}`}>
          {review.reviewerInitial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{review.reviewerName}</p>
            <span className="shrink-0 text-xs text-muted">{review.date}</span>
          </div>
          <div className="mt-0.5 flex gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <svg
                key={i}
                className={`h-3.5 w-3.5 ${i < review.rating ? "text-accent" : "text-muted/30"}`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 0 0 .95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 0 0-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 0 0-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 0 0-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 0 0 .951-.69l1.07-3.292Z" />
              </svg>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">{review.text}</p>
    </article>
  );
}
