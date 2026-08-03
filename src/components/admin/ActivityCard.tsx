import type { SVGProps } from "react";

import type { ActivityItem } from "@/data/mock/mockAdminDashboard";

interface ActivityCardProps {
  item: ActivityItem;
}

const activityStyles: Record<
  ActivityItem["type"],
  { className: string; Icon: (props: SVGProps<SVGSVGElement>) => JSX.Element }
> = {
  bid: {
    className: "bg-primary/10 text-primary",
    Icon: DocumentListIcon,
  },
  join: {
    className: "bg-accent/10 text-accent",
    Icon: PersonIcon,
  },
  saving: {
    className: "bg-emerald-50 text-emerald-600",
    Icon: CheckmarkIcon,
  },
};

export function ActivityCard({ item }: ActivityCardProps) {
  const style = activityStyles[item.type];
  const Icon = style.Icon;

  return (
    <article className="flex items-start gap-3 rounded-card bg-card p-4 shadow-card">
      <div
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${style.className}`}
      >
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-foreground">{item.description}</p>
        <p className="mt-1 text-xs text-muted">{item.time}</p>
      </div>
    </article>
  );
}

function IconFrame(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      {...props}
    />
  );
}

function DocumentListIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconFrame {...props}>
      <rect x="5.5" y="4.5" width="13" height="15" rx="2" />
      <path d="M9 9h6" />
      <path d="M9 12.25h6" />
      <path d="M9 15.5h4.5" />
    </IconFrame>
  );
}

function PersonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="8" r="3" />
      <path d="M6.5 18a5.5 5.5 0 0 1 11 0" />
    </IconFrame>
  );
}

function CheckmarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconFrame {...props}>
      <polyline points="6.5 12.5 10 16 17.5 8.5" />
    </IconFrame>
  );
}
