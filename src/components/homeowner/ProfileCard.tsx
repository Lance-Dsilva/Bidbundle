interface ProfileCardProps {
  initials: string;
  name: string;
  address: string;
  joinDate: string;
  rating: number;
  servicesBooked: number;
}

export function ProfileCard({
  initials,
  name,
  address,
  joinDate,
  rating,
  servicesBooked,
}: ProfileCardProps) {
  return (
    <section className="rounded-card bg-surface p-5 text-white shadow-card">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-primary text-base font-bold text-white shadow-sm">
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-white">{name}</p>
          <p className="mt-0.5 text-xs text-white/60">{address}</p>
          <p className="text-xs text-white/50">Member since {joinDate}</p>

          <div className="mt-2 flex flex-wrap gap-2">
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300">
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2.2">
                <path strokeLinecap="round" strokeLinejoin="round" d="m2.5 6 2.5 2.5 5-5" />
              </svg>
              VERIFIED
            </span>
            <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-[10px] font-semibold text-white/80">
              ★ {rating.toFixed(1)} · {servicesBooked} bookings
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
