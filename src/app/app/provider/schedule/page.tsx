"use client";

import { useEffect, useMemo, useState } from "react";
import { useProviderSchedule, type ScheduleItem } from "@/hooks/useProviderSchedule";
import { useSmartSchedule } from "@/hooks/useSmartSchedule";

function IconBack() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6"/></svg>; }
function IconArrowR() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>; }
function IconPlus() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>; }

const hours = ["8 AM", "10 AM", "12 PM", "2 PM", "4 PM", "6 PM"];
const weekDayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayNamesFull = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const toneBg: Record<string, string> = {
  scheduled: "var(--gold-100)",
  confirmed: "var(--sage-100)",
  completed: "var(--sage-50)",
  blocked: "var(--plum-100)",
  default: "var(--terracotta-100)",
};
const toneFg: Record<string, string> = {
  scheduled: "var(--gold-600)",
  confirmed: "var(--sage-700)",
  completed: "var(--sage-700)",
  blocked: "var(--plum-600)",
  default: "var(--terracotta-600)",
};
const toneChipBg: Record<string, string> = {
  scheduled: "var(--gold-50)",
  confirmed: "var(--sage-50)",
  completed: "var(--sage-50)",
  blocked: "var(--plum-100)",
  default: "var(--terracotta-50)",
};

type ViewMode = "day" | "week" | "month";

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function formatRangeLabel(viewMode: ViewMode, anchorDate: Date, weekDates: Date[]) {
  if (viewMode === "day") {
    return anchorDate.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  if (viewMode === "month") {
    return anchorDate.toLocaleDateString([], { month: "long", year: "numeric" });
  }
  const start = weekDates[0];
  const end = weekDates[6];
  return `${start.toLocaleDateString([], { month: "short", day: "numeric" })} – ${end.toLocaleDateString([], { month: start.getMonth() === end.getMonth() ? undefined : "short", day: "numeric" })}`;
}

function getToneKey(status: string) {
  if (status === "blocked") return "blocked";
  if (status === "completed") return "completed";
  if (status === "confirmed" || status === "en_route") return "confirmed";
  if (status === "scheduled") return "scheduled";
  return "default";
}

function getEventTop(date: Date) {
  const hoursFromStart = (date.getHours() + date.getMinutes() / 60) - 8;
  return Math.max(0, hoursFromStart * 45);
}

function getEventHeight(durationMinutes: number) {
  return Math.max(42, (durationMinutes / 60) * 45 - 4);
}

function getDistanceFromAddress(address: string | null) {
  if (!address) return null;
  if (address.includes("Historic South-Central")) return "0.4 mi";
  if (address.includes("West Adams")) return "3.2 mi";
  if (address.includes("Koreatown")) return "2.9 mi";
  if (address.includes("Echo Park")) return "3.6 mi";
  return null;
}

function inferRevenue(item: ScheduleItem) {
  if (item.status === "blocked") return 0;
  const hoursBooked = item.duration_minutes / 60;
  return Math.round(hoursBooked * 150 * 100);
}

function formatStatusLabel(status: string) {
  if (status === "blocked") return "Temporary hold";
  return status.replaceAll("_", " ");
}

export default function ProviderSchedulePage() {
  const { items: apiItems, loading, addItem, refresh } = useProviderSchedule();
  const { proposals, loading: aiLoading, error: aiError, generate, accept } = useSmartSchedule();
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [anchorDate, setAnchorDate] = useState(startOfDay(new Date()));

  // Phones get the day agenda by default; the 7-column grid is a desktop pattern
  useEffect(() => {
    if (window.innerWidth < 768) setViewMode("day");
  }, []);
  const [proposalOpen, setProposalOpen] = useState(true);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const [acceptedKeys, setAcceptedKeys] = useState<string[]>([]);
  const [isOpenForJobs, setIsOpenForJobs] = useState(true);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [blockTitle, setBlockTitle] = useState("Blocked time");
  const [blockDate, setBlockDate] = useState(startOfDay(new Date()).toISOString().slice(0, 10));
  const [blockTime, setBlockTime] = useState("13:00");
  const [blockDuration, setBlockDuration] = useState("60");
  const [blockSaving, setBlockSaving] = useState(false);

  const today = startOfDay(new Date());
  const weekStart = useMemo(
    () => (viewMode === "week" ? startOfWeek(anchorDate) : startOfWeek(today)),
    [anchorDate, today, viewMode]
  );
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart]
  );

  const visibleItems = useMemo(() => {
    return apiItems.filter((item) => {
      const itemDate = new Date(item.scheduled_at);
      if (viewMode === "day") return isSameDay(itemDate, anchorDate);
      if (viewMode === "month") return isSameMonth(itemDate, anchorDate);
      return weekDates.some((date) => isSameDay(itemDate, date));
    });
  }, [anchorDate, apiItems, viewMode, weekDates]);

  const jobsCount = visibleItems.filter((item) => item.status !== "blocked").length;
  const bookedHours = visibleItems.reduce((sum, item) => sum + item.duration_minutes / 60, 0);

  const todayItems = useMemo(
    () => apiItems.filter((item) => isSameDay(new Date(item.scheduled_at), today)).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()),
    [apiItems, today]
  );

  const todayRevenue = todayItems.reduce((sum, item) => sum + inferRevenue(item), 0);
  const todayHours = todayItems.reduce((sum, item) => sum + item.duration_minutes / 60, 0);

  const conflictItems = useMemo(() => {
    const sorted = [...apiItems].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    const conflicts: ScheduleItem[] = [];
    for (let index = 1; index < sorted.length; index += 1) {
      const prev = sorted[index - 1];
      const current = sorted[index];
      const prevStart = new Date(prev.scheduled_at);
      const currentStart = new Date(current.scheduled_at);
      if (!isSameDay(prevStart, currentStart)) continue;
      const prevEnd = new Date(prevStart.getTime() + prev.duration_minutes * 60 * 1000);
      const gapMinutes = (currentStart.getTime() - prevEnd.getTime()) / (60 * 1000);
      if (gapMinutes < 30) {
        conflicts.push(current);
      }
    }
    return conflicts;
  }, [apiItems]);

  const monthGroups = useMemo(() => {
    const grouped = new Map<string, ScheduleItem[]>();
    for (const item of visibleItems) {
      const key = startOfDay(new Date(item.scheduled_at)).toISOString();
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime());
  }, [visibleItems]);

  async function handleBlockTime() {
    setBlockSaving(true);
    try {
      await addItem({
        title: blockTitle.trim() || "Blocked time",
        address: "Unavailable",
        scheduled_at: new Date(`${blockDate}T${blockTime}:00`).toISOString(),
        duration_minutes: Number(blockDuration) || 60,
        status: "blocked",
      });
      setShowBlockModal(false);
    } finally {
      setBlockSaving(false);
    }
  }

  const navigationStep = viewMode === "month" ? "month" : viewMode === "day" ? "day" : "week";

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>Schedule</h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>
            {formatRangeLabel(viewMode, anchorDate, weekDates)} · {jobsCount} job{jobsCount !== 1 ? "s" : ""} · {bookedHours.toFixed(1).replace(".0", "")} hrs booked
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setAnchorDate((current) => navigationStep === "month" ? addMonths(current, -1) : addDays(current, navigationStep === "day" ? -1 : -7))}
            style={{ display: "inline-flex", alignItems: "center", height: 38, padding: "0 14px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" }}
          >
            <IconBack />
          </button>
          <button
            onClick={() => setAnchorDate(startOfDay(new Date()))}
            style={{ display: "inline-flex", alignItems: "center", height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--cream-100)", color: "var(--ink-900)", border: 0, fontFamily: "var(--font-body)" }}
          >
            Today
          </button>
          <button
            onClick={() => setAnchorDate((current) => navigationStep === "month" ? addMonths(current, 1) : addDays(current, navigationStep === "day" ? 1 : 7))}
            style={{ display: "inline-flex", alignItems: "center", height: 38, padding: "0 14px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" }}
          >
            <IconArrowR />
          </button>
          <span style={{ width: 1, height: 22, background: "var(--border-warm)" }} />
          <div style={{ display: "flex", background: "var(--cream-100)", borderRadius: 10, padding: 3 }}>
            {(["day", "week", "month"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 28, padding: "0 12px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: 0, background: viewMode === mode ? "white" : "transparent", color: "var(--ink-700)", boxShadow: viewMode === mode ? "var(--shadow-warm-sm)" : "none", fontFamily: "var(--font-body)", textTransform: "capitalize" }}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: aiLoading ? "progress" : "pointer", background: "var(--cream-100)", color: "var(--ink-900)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" }}
            disabled={aiLoading}
            onClick={async () => {
              setProposalOpen(true);
              setAcceptedKeys([]);
              await generate(today.toISOString().slice(0, 10));
            }}
          >
            {aiLoading ? "Optimising…" : "✦ AI Optimize"}
          </button>
          <button
            onClick={() => setShowBlockModal(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--terracotta-600)", color: "white", border: 0, fontFamily: "var(--font-body)" }}
          >
            <IconPlus /> Block time
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 px-4 pb-8 md:px-9 md:pb-9 lg:grid-cols-[1fr_300px] lg:gap-[22px]">
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-warm)", borderRadius: 18, boxShadow: "var(--shadow-warm-sm)", padding: 0, overflow: "hidden" }}>
          {viewMode === "month" ? (
            <div style={{ padding: 22 }}>
              {loading ? (
                <div style={{ fontSize: 14, color: "var(--ink-500)" }}>Loading schedule…</div>
              ) : monthGroups.length === 0 ? (
                <div style={{ fontSize: 14, color: "var(--ink-500)" }}>No schedule items in this month.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {monthGroups.map(([dateKey, items]) => {
                    const date = new Date(dateKey);
                    return (
                      <div key={dateKey} style={{ border: "1px solid var(--border-warm)", borderRadius: 16, overflow: "hidden" }}>
                        <div style={{ padding: "12px 16px", background: "var(--cream-50)", fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}>
                          {dayNamesFull[date.getDay()]}, {date.toLocaleDateString([], { month: "short", day: "numeric" })}
                        </div>
                        {items.map((item, index) => {
                          const tone = getToneKey(item.status);
                          const scheduledDate = new Date(item.scheduled_at);
                          return (
                            <div key={item.id} style={{ padding: "12px 16px", borderTop: index > 0 ? "1px solid var(--border-warm)" : 0, display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}>{item.title}</div>
                                <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-500)" }}>
                                  {scheduledDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {item.duration_minutes} min
                                </div>
                              </div>
                              <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: toneChipBg[tone], color: toneFg[tone] }}>
                                {formatStatusLabel(item.status)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: viewMode === "day" ? 0 : 640 }}>
              <div style={{ display: "grid", gridTemplateColumns: `60px repeat(${viewMode === "day" ? 1 : 7}, 1fr)`, borderBottom: "1px solid var(--border-warm)" }}>
                <div style={{ padding: "14px 0", fontSize: 11, color: "var(--ink-400)", textAlign: "center", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Local</div>
                {(viewMode === "day" ? [anchorDate] : weekDates).map((date) => {
                  const dayItems = apiItems.filter((item) => isSameDay(new Date(item.scheduled_at), date));
                  const isToday = isSameDay(date, today);
                  return (
                    <div key={date.toISOString()} style={{ padding: "14px 16px", textAlign: "center", borderLeft: "1px solid var(--border-warm)" }}>
                      <div style={{ fontSize: 11, color: "var(--ink-500)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{weekDayShort[date.getDay()]}</div>
                      <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 22, marginTop: 4, letterSpacing: "-0.02em", color: isToday ? "var(--terracotta-600)" : "var(--ink-900)" }}>{date.getDate()}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 2 }}>{dayItems.length} {dayItems.length === 1 ? "job" : "jobs"}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ position: "relative", display: "grid", gridTemplateColumns: `60px repeat(${viewMode === "day" ? 1 : 7}, 1fr)`, height: 540 }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {hours.map((h) => (
                    <div key={h} style={{ flex: 1, fontSize: 10, color: "var(--ink-400)", textAlign: "right", padding: "4px 8px 0 0", borderTop: "1px solid var(--border-warm)" }}>{h}</div>
                  ))}
                </div>

                {(viewMode === "day" ? [anchorDate] : weekDates).map((date) => {
                  const dayItems = apiItems.filter((item) => isSameDay(new Date(item.scheduled_at), date));
                  const isToday = isSameDay(date, today);
                  return (
                    <div key={date.toISOString()} style={{ position: "relative", borderLeft: "1px solid var(--border-warm)", background: isToday ? "rgba(232,98,63,0.025)" : "transparent" }}>
                      {hours.map((_, hi) => (
                        <div key={hi} style={{ height: 90, borderTop: "1px solid var(--border-warm)" }} />
                      ))}
                      {dayItems.map((item) => {
                        const scheduledDate = new Date(item.scheduled_at);
                        const tone = getToneKey(item.status);
                        return (
                          <div
                            key={item.id}
                            style={{
                              position: "absolute",
                              top: getEventTop(scheduledDate),
                              left: 4,
                              right: 4,
                              height: getEventHeight(item.duration_minutes),
                              background: toneBg[tone],
                              borderLeft: `3px solid ${toneFg[tone]}`,
                              borderRadius: 8,
                              padding: "8px 10px",
                              fontSize: 12,
                              overflow: "hidden",
                            }}
                          >
                            <div style={{ fontWeight: 700, color: toneFg[tone], fontSize: 12 }}>{item.title}</div>
                            <div style={{ color: "var(--ink-700)", fontSize: 11, marginTop: 2 }}>
                              {scheduledDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {item.duration_minutes} min
                            </div>
                            {item.status === "blocked" ? (
                              <div style={{ color: toneFg[tone], fontSize: 11, marginTop: 4, fontWeight: 600 }}>
                                Temporary while homeowner reviews your bid
                              </div>
                            ) : null}
                            {item.address ? (
                              <div style={{ color: "var(--ink-500)", fontSize: 11, marginTop: 3 }}>{item.address}</div>
                            ) : null}
                          </div>
                        );
                      })}
                      {isToday ? (
                        <div style={{ position: "absolute", top: getEventTop(new Date()), left: 0, right: 0, borderTop: "2px solid var(--terracotta-500)", zIndex: 5 }}>
                          <div style={{ position: "absolute", left: -5, top: -5, width: 8, height: 8, borderRadius: "50%", background: "var(--terracotta-500)" }} />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-warm)", borderRadius: 18, boxShadow: "var(--shadow-warm-sm)", padding: 22 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>
              Today · {today.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 26, marginTop: 6, letterSpacing: "-0.02em", color: "var(--ink-900)" }}>
              {todayItems.length} job{todayItems.length !== 1 ? "s" : ""} · {todayHours.toFixed(1).replace(".0", "")} hrs
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-500)" }}>Est. revenue ${Math.round(todayRevenue / 100).toLocaleString()}</div>
            <div style={{ height: 1, background: "var(--border-warm)", margin: "14px 0" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {todayItems.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--ink-500)" }}>No jobs scheduled today.</div>
              ) : todayItems.map((item) => {
                const scheduledDate = new Date(item.scheduled_at);
                const tone = getToneKey(item.status);
                const distance = getDistanceFromAddress(item.address);
                return (
                  <div key={item.id} style={{ display: "grid", gridTemplateColumns: "4px 1fr", gap: 12 }}>
                    <div style={{ background: toneFg[tone], borderRadius: 2 }} />
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 14, color: "var(--ink-900)" }}>
                          {scheduledDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </span>
                        <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: toneChipBg[tone], color: toneFg[tone] }}>
                          {formatStatusLabel(item.status)}
                        </span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4, color: "var(--ink-900)" }}>{item.title}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-500)" }}>
                        {(item.duration_minutes / 60).toFixed(1).replace(".0", "")}h{distance ? ` · ${distance}` : ""}
                      </div>
                      {item.status === "blocked" ? (
                        <div style={{ fontSize: 11, color: toneFg[tone], marginTop: 4, fontWeight: 600 }}>
                          Temporary hold while bid is pending
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-warm)", borderRadius: 18, boxShadow: "var(--shadow-warm-sm)", padding: 22 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 }}>Availability</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}>Open for new jobs</div>
                <div style={{ fontSize: 11, color: "var(--ink-500)" }}>Auto-accept up to 2/day</div>
              </div>
              <button
                onClick={() => setIsOpenForJobs((current) => !current)}
                style={{ width: 40, height: 22, background: isOpenForJobs ? "var(--sage-500)" : "var(--cream-300)", borderRadius: 999, position: "relative", cursor: "pointer", border: 0 }}
              >
                <div style={{ position: "absolute", [isOpenForJobs ? "right" : "left"]: 2, top: 2, width: 18, height: 18, background: "var(--bg-card)", borderRadius: "50%" }} />
              </button>
            </div>
            <div style={{ height: 1, background: "var(--border-warm)", margin: "12px 0" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
              {[["Working hours", "7 AM – 6 PM"], ["Days off", "Sun"], ["Buffer between jobs", "30 min"]].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink-500)" }}>{k}</span>
                  <span style={{ fontWeight: 600, color: "var(--ink-900)" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ background: "var(--cream-100)", border: "1px solid var(--border-warm)", borderRadius: 18, padding: 22 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}>{conflictItems.length} conflict{conflictItems.length !== 1 ? "s" : ""} detected</div>
            <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 4 }}>
              {conflictItems.length === 0 ? "No overlaps or sub-30-minute buffers detected." : "Some jobs are too close together. Use AI Optimize or add blocked time to create buffer."}
            </div>
            <button
              onClick={async () => {
                setProposalOpen(true);
                setAcceptedKeys([]);
                await generate(today.toISOString().slice(0, 10));
              }}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "100%", height: 30, borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "var(--bg-card)", color: "var(--ink-900)", border: 0, marginTop: 10, fontFamily: "var(--font-body)" }}
            >
              Auto-resolve
            </button>
          </div>
        </div>
      </div>

      {proposals ? (
        <div style={{ margin: "0 36px 36px", background: "var(--bg-card)", borderRadius: 18, border: "1px solid var(--border-warm)", boxShadow: "var(--shadow-warm-sm)", padding: 28 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 22, letterSpacing: "-0.01em", color: "var(--ink-900)" }}>AI schedule proposal</div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--ink-500)" }}>
                {proposals.date} · {proposals.total_hours}h · est. ${Math.round(proposals.estimated_revenue_cents / 100).toLocaleString()} revenue
              </div>
            </div>
            <button
              onClick={() => setProposalOpen((open) => !open)}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--cream-100)", color: "var(--ink-900)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" }}
            >
              {proposalOpen ? "Collapse" : "Expand"}
            </button>
          </div>

          {proposalOpen ? (
            <div style={{ marginTop: 20 }}>
              {aiError ? (
                <div style={{ marginBottom: 16, fontSize: 13, color: "var(--terracotta-600)", fontWeight: 600 }}>{aiError}</div>
              ) : null}

              {proposals.stub ? (
                <div style={{ marginBottom: 16, fontSize: 12, color: "var(--ink-500)" }}>AI unavailable — showing a stub response.</div>
              ) : null}

              {proposals.conflicts.length > 0 ? (
                <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--terracotta-50)", borderRadius: 18, border: "1px solid var(--border-warm)" }}>
                  {proposals.conflicts.map((conflict, index) => (
                    <div key={index} style={{ fontSize: 12, color: "var(--terracotta-600)", fontWeight: 600 }}>
                      {conflict}
                    </div>
                  ))}
                </div>
              ) : null}

              {proposals.items.length === 0 ? (
                <div style={{ fontSize: 14, color: "var(--ink-500)" }}>No accepted bids to schedule. Accept some bids first.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {proposals.items.map((item, index) => {
                    const itemKey = `${item.request_id ?? "none"}-${item.suggested_start}-${index}`;
                    const isAccepted = acceptedKeys.includes(itemKey);
                    const isAccepting = acceptingKey === itemKey;

                    return (
                      <div key={itemKey} style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", rowGap: 8, columnGap: 14, alignItems: "center", background: "var(--cream-50)", borderRadius: 18, border: "1px solid var(--border-warm)", boxShadow: "var(--shadow-warm-sm)", padding: "16px 18px" }}>
                        <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 20, letterSpacing: "-0.01em", color: "var(--terracotta-600)" }}>
                          {item.suggested_start}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink-900)" }}>{item.title}</div>
                          <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-500)" }}>
                            {item.neighborhood} · {item.duration_minutes} min
                          </div>
                          <div style={{ marginTop: 4, fontSize: 12, color: "var(--ink-500)" }}>{item.reason}</div>
                        </div>
                        <button
                          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: isAccepted ? "default" : "pointer", background: isAccepted ? "var(--sage-100)" : "var(--terracotta-600)", color: isAccepted ? "var(--sage-700)" : "white", border: isAccepted ? "1px solid var(--border-warm)" : 0, fontFamily: "var(--font-body)" }}
                          disabled={isAccepted || isAccepting}
                          onClick={async () => {
                            setAcceptingKey(itemKey);
                            try {
                              await accept(item);
                              await refresh();
                              setAcceptedKeys((current) => [...current, itemKey]);
                            } finally {
                              setAcceptingKey(null);
                            }
                          }}
                        >
                          {isAccepted ? "Accepted" : isAccepting ? "Adding…" : "Accept"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {showBlockModal ? (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(34,28,22,0.42)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 24 }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowBlockModal(false);
          }}
        >
          <div style={{ width: "100%", maxWidth: 460, background: "var(--bg-card)", borderRadius: 18, border: "1px solid var(--border-warm)", boxShadow: "var(--shadow-warm-sm)", padding: 24 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 24, color: "var(--ink-900)" }}>Block time</div>
            <div style={{ marginTop: 4, fontSize: 13, color: "var(--ink-500)" }}>Create a real blocked schedule entry so the calendar updates immediately.</div>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-400)", fontWeight: 600 }}>Title</span>
                <input value={blockTitle} onChange={(e) => setBlockTitle(e.target.value)} style={{ height: 42, borderRadius: 12, border: "1px solid var(--border-warm)", padding: "0 12px", fontSize: 14, fontFamily: "var(--font-body)" }} />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-400)", fontWeight: 600 }}>Date</span>
                  <input type="date" value={blockDate} onChange={(e) => setBlockDate(e.target.value)} style={{ height: 42, borderRadius: 12, border: "1px solid var(--border-warm)", padding: "0 12px", fontSize: 14, fontFamily: "var(--font-body)" }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-400)", fontWeight: 600 }}>Start time</span>
                  <input type="time" value={blockTime} onChange={(e) => setBlockTime(e.target.value)} style={{ height: 42, borderRadius: 12, border: "1px solid var(--border-warm)", padding: "0 12px", fontSize: 14, fontFamily: "var(--font-body)" }} />
                </label>
              </div>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-400)", fontWeight: 600 }}>Duration (minutes)</span>
                <input type="number" min="15" step="15" value={blockDuration} onChange={(e) => setBlockDuration(e.target.value)} style={{ height: 42, borderRadius: 12, border: "1px solid var(--border-warm)", padding: "0 12px", fontSize: 14, fontFamily: "var(--font-body)" }} />
              </label>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowBlockModal(false)} style={{ flex: 1, height: 40, borderRadius: 999, border: "1px solid var(--border-warm-strong)", background: "transparent", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-body)" }}>Cancel</button>
              <button onClick={() => void handleBlockTime()} disabled={blockSaving} style={{ flex: 1, height: 40, borderRadius: 999, border: 0, background: "var(--terracotta-600)", color: "white", fontSize: 14, fontWeight: 600, cursor: blockSaving ? "progress" : "pointer", fontFamily: "var(--font-body)" }}>{blockSaving ? "Saving…" : "Add block"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
