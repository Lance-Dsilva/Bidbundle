"use client";

import { useBidDrafter } from "@/hooks/useBidDrafter";
import type { BidDraft } from "@/hooks/useBidDrafter";
import { useDemandForecast } from "@/hooks/useDemandForecast";
import type { DemandForecastResult } from "@/hooks/useDemandForecast";
import { MobileSheet } from "@/components/layout/MobileSheet";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { CategoryBanner, CategoryTile } from "@/components/ui/CategoryArt";
import { useProviderJobFeed, type JobFeedItem } from "@/hooks/useProviderJobFeed";
import { useProviderBids } from "@/hooks/useProviderBids";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useViewerContext } from "@/hooks/useViewerContext";
import { getToken } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

/* ── Design tokens helpers ── */
const card: CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border-warm)", borderRadius: 18, boxShadow: "var(--shadow-warm-sm)" };
const btnPrimary: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--terracotta-600)", color: "white", border: 0, fontFamily: "var(--font-body)", boxShadow: "0 1px 0 rgba(0,0,0,0.05) inset, 0 6px 14px -6px rgba(232,98,63,0.5)" };
const btnGhost: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" };
const btnQuiet: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 8, height: 38, padding: "0 16px", borderRadius: 999, fontSize: 14, fontWeight: 600, cursor: "pointer", background: "var(--cream-100)", color: "var(--ink-900)", border: 0, fontFamily: "var(--font-body)" };
const btnSmPrimary: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "var(--terracotta-600)", color: "white", border: 0, fontFamily: "var(--font-body)" };
const btnSmGhost: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", color: "var(--ink-700)", border: "1px solid var(--border-warm-strong)", fontFamily: "var(--font-body)" };
const eyebrow: CSSProperties = { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--ink-400)", fontWeight: 600 };

const avGrad: Record<string, string> = {
  sage: "linear-gradient(135deg,#7A9A7E,#4A6A4D)",
  plum: "linear-gradient(135deg,#B07AA0,#7A4A6E)",
  blue: "linear-gradient(135deg,#6F8DB8,#3F608E)",
  gold: "linear-gradient(135deg,#D6A23E,#B8862B)",
  terracotta: "linear-gradient(135deg, var(--orange-500), var(--orange-600))",
};

function IconSearch() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>; }
function IconFilter() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>; }
function IconSpark() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 5L19 9.8 14 11.6 12 17l-1.8-5.4L5 9.8 10.2 8z"/></svg>; }
function IconArrowR() { return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>; }
function IconLeaf() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 19c0-9 7-14 16-14-1 9-5 16-14 16a4 4 0 0 1-2-2z"/><path d="M5 19l8-8"/></svg>; }
function IconBroom() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4l6 6-7 7H6v-7z"/><path d="M6 14l-3 6 6-3"/></svg>; }
function IconWrench() { return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 6a4 4 0 0 1 5 5l-9 9-4 1 1-4 9-9z"/></svg>; }

const chipTone: Record<string, CSSProperties> = {
  sage:       { background: "var(--sage-50)",        color: "var(--sage-700)"       },
  terracotta: { background: "var(--terracotta-50)",  color: "var(--terracotta-600)" },
  gold:       { background: "var(--gold-50)",        color: "var(--gold-600)"       },
  plum:       { background: "var(--plum-100)",       color: "var(--plum-600)"       },
};

const filters = ["All trades", "Plumbing", "HVAC", "Lawn", "Cleaning", "Handyman"];
const AUTO_BID_STORAGE_KEY = "provider-job-feed:auto-bid-settings";
const SAVED_JOBS_STORAGE_KEY = "provider-job-feed:saved-jobs";

function formatDateMeta(date: string | null) {
  if (!date) return "Open now";
  return `Ends ${new Date(date).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function formatDistance(distance: number | null | undefined) {
  return typeof distance === "number" && Number.isFinite(distance)
    ? `${distance} mi away`
    : "";
}

function isClosingToday(date: string | null) {
  if (!date) return false;
  const closing = new Date(date);
  const now = new Date();
  return closing.getTime() - now.getTime() <= 24 * 60 * 60 * 1000;
}

function formatTimeRemaining(date: string | null) {
  if (!date) return "Open";
  const diffMs = new Date(date).getTime() - Date.now();
  if (diffMs <= 0) return "Closing";
  const hours = Math.round(diffMs / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

type AutoBidSettings = {
  enabled: boolean;
  matchThreshold: number;
  radiusMi: number;
};

type SortMode = "best_match" | "closing_soon" | "budget_high" | "budget_low";

function nextWorkDays(count: number) {
  const result: string[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (result.length < Math.max(count, 1)) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      result.push(cursor.toISOString().slice(0, 10));
    }
  }
  return result;
}

function ServiceMap({
  lat,
  lng,
  radiusMi,
  locality,
  jobCount,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  radiusMi: number;
  locality: string;
  jobCount: number;
}) {
  if (typeof lat === "number" && typeof lng === "number") {
    const latDelta = Math.max(radiusMi / 69, 0.012);
    const lngDelta = Math.max(radiusMi / (Math.cos((lat * Math.PI) / 180) * 69), 0.012);
    const bbox = `${lng - lngDelta},${lat - latDelta},${lng + lngDelta},${lat + latDelta}`;
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
    return (
      <div style={{ position: "relative", marginTop: 10, height: 140, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border-warm)", background: "var(--cream-50)" }}>
        <iframe
          src={src}
          title="Provider service area"
          width="100%"
          height="140"
          style={{ border: "none", display: "block", pointerEvents: "none" }}
          loading="lazy"
        />
        <div
          style={{
            position: "absolute",
            inset: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: "72%",
              height: "72%",
              borderRadius: "50%",
              border: "1.5px dashed rgba(232,98,63,0.55)",
              background: "rgba(232,98,63,0.08)",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 18,
                height: 18,
                borderRadius: 999,
                background: "var(--bg-card)",
                border: "2px solid var(--terracotta-600)",
                transform: "translate(-50%, -50%)",
                boxShadow: "0 6px 14px rgba(59,38,22,0.16)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: "var(--terracotta-600)",
                  transform: "translate(-50%, -50%)",
                }}
              />
            </div>
          </div>
        </div>
        {locality ? (
          <div style={{ position: "absolute", right: 10, top: 10, borderRadius: 999, background: "rgba(255,255,255,0.92)", padding: "5px 10px", fontSize: 10, fontWeight: 700, color: "var(--terracotta-600)", boxShadow: "var(--shadow-warm-sm)" }}>
            {locality}
          </div>
        ) : null}
        <div style={{ position: "absolute", left: 10, bottom: 10, borderRadius: 999, background: "rgba(255,255,255,0.94)", padding: "5px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--ink-700)", boxShadow: "var(--shadow-warm-sm)" }}>
          {jobCount} nearby job{jobCount !== 1 ? "s" : ""}
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, height: 140, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border-warm)", background: "linear-gradient(160deg, var(--sage-50), var(--cream-100))", display: "grid", placeItems: "center", padding: 20, textAlign: "center" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-700)" }}>Location unavailable</div>
        <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 4 }}>
          Save your provider address to render the live service map.
        </div>
      </div>
    </div>
  );
}

export default function ProviderJobFeedPage() {
  const { jobs: apiJobs, loading, refresh: refreshJobFeed, setJobs } = useProviderJobFeed();
  const { bids: providerBids, refresh: refreshProviderBids } = useProviderBids();
  const { draftBid, loading: draftLoading, error: draftError } = useBidDrafter();
  const { getForecast, loading: forecastLoading } = useDemandForecast();
  const { profile } = useProviderProfile();
  const { context } = useViewerContext();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [activeTrade, setActiveTrade] = useState("All trades");
  const [highBudgetOnly, setHighBudgetOnly] = useState(false);
  const [closingTodayOnly, setClosingTodayOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("best_match");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [savedJobIds, setSavedJobIds] = useState<number[]>([]);
  const activeFilterCount =
    Number(highBudgetOnly) + Number(closingTodayOnly) + Number(savedOnly) + Number(sortMode !== "best_match");
  const [autoBidSettings, setAutoBidSettings] = useState<AutoBidSettings>({
    enabled: true,
    matchThreshold: 85,
    radiusMi: 4,
  });
  const [showAutoBidModal, setShowAutoBidModal] = useState(false);
  const [detailJob, setDetailJob] = useState<JobFeedItem | null>(null);
  const [activeDraft, setActiveDraft] = useState<{
    requestId: number;
    title: string;
    draft: BidDraft;
  } | null>(null);
  const [forecast, setForecast] = useState<DemandForecastResult | null>(null);
  const [draftAmount, setDraftAmount] = useState("");
  const [draftDays, setDraftDays] = useState("");
  const [draftWorkDays, setDraftWorkDays] = useState<string[]>([]);
  const [draftText, setDraftText] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The community radius is fixed platform-wide; the stored auto-bid value is
  // only a fallback for the moment before the profile loads.
  const actualRadiusMi = profile?.communityRadiusMi ?? autoBidSettings.radiusMi;
  const bidByRequestId = useMemo(
    () => new Map(providerBids.map((bid) => [bid.request_id, bid])),
    [providerBids]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedSaved = window.localStorage.getItem(SAVED_JOBS_STORAGE_KEY);
    const storedAutoBid = window.localStorage.getItem(AUTO_BID_STORAGE_KEY);

    if (storedSaved) {
      try {
        const parsed = JSON.parse(storedSaved);
        if (Array.isArray(parsed)) {
          setSavedJobIds(parsed.filter((value): value is number => typeof value === "number"));
        }
      } catch {}
    }

    if (storedAutoBid) {
      try {
        const parsed = JSON.parse(storedAutoBid) as Partial<AutoBidSettings>;
        setAutoBidSettings((current) => ({
          enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : current.enabled,
          matchThreshold: typeof parsed.matchThreshold === "number" ? parsed.matchThreshold : current.matchThreshold,
          radiusMi: typeof parsed.radiusMi === "number" ? parsed.radiusMi : current.radiusMi,
        }));
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SAVED_JOBS_STORAGE_KEY, JSON.stringify(savedJobIds));
  }, [savedJobIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTO_BID_STORAGE_KEY, JSON.stringify(autoBidSettings));
  }, [autoBidSettings]);

  useEffect(() => {
    if (!profile?.communityRadiusMi) return;
    setAutoBidSettings((current) => (
      current.radiusMi === profile.communityRadiusMi
        ? current
        : { ...current, radiusMi: profile.communityRadiusMi }
    ));
  }, [profile?.communityRadiusMi]);

  const displayedJobs = useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    const nextJobs = [...apiJobs]
      .filter((job) => {
        if (activeTrade !== "All trades" && !job.category.toLowerCase().includes(activeTrade.toLowerCase())) {
          return false;
        }
        if (highBudgetOnly && Math.round(job.budget_max / 100) < 500) {
          return false;
        }
        if (closingTodayOnly && !isClosingToday(job.closes_at)) {
          return false;
        }
        if (savedOnly && !savedJobIds.includes(job.id)) {
          return false;
        }
        if (normalizedSearch) {
          const haystack = `${job.title} ${job.category} ${job.neighborhood}`.toLowerCase();
          if (!haystack.includes(normalizedSearch)) {
            return false;
          }
        }
        return true;
      });

    nextJobs.sort((a, b) => {
      if (sortMode === "budget_high") return b.budget_max - a.budget_max;
      if (sortMode === "budget_low") return a.budget_min - b.budget_min;
      if (sortMode === "closing_soon") {
        const aTime = a.closes_at ? new Date(a.closes_at).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.closes_at ? new Date(b.closes_at).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      }

      const aDistance = typeof a.distance_mi === "number" ? a.distance_mi : Number.MAX_SAFE_INTEGER;
      const bDistance = typeof b.distance_mi === "number" ? b.distance_mi : Number.MAX_SAFE_INTEGER;
      if (aDistance !== bDistance) return aDistance - bDistance;
      return b.bid_count - a.bid_count;
    });

    return nextJobs;
  }, [activeTrade, apiJobs, closingTodayOnly, highBudgetOnly, savedJobIds, savedOnly, searchText, sortMode]);

  const featuredJob = displayedJobs[0] ?? null;
  const featuredExistingBid = featuredJob ? bidByRequestId.get(featuredJob.id) : undefined;
  const closingSoonJobs = useMemo(
    () => displayedJobs.filter((job) => Boolean(job.closes_at)).slice().sort((a, b) => {
      const aTime = a.closes_at ? new Date(a.closes_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.closes_at ? new Date(b.closes_at).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    }).slice(0, 3),
    [displayedJobs]
  );

  function toggleSavedJob(jobId: number) {
    setSavedJobIds((current) =>
      current.includes(jobId)
        ? current.filter((id) => id !== jobId)
        : [...current, jobId]
    );
  }

  async function handleDraftBid(requestId: number, title: string) {
    const existingBid = bidByRequestId.get(requestId);
    const fallbackDraft: BidDraft = {
      suggested_amount_cents: existingBid?.amount ?? 210000,
      suggested_days: existingBid?.work_days?.length ?? existingBid?.estimated_days ?? 2,
      draft_text:
        "We can complete this work professionally and on schedule. Our team is ready to confirm scope, materials, and timing, and we can begin once the homeowner approves the bid.",
      headline: "Licensed · Insured · Ready to schedule",
      confidence: "medium",
      stub: true,
    };

    if (requestId === 0) {
      setActiveDraft({ requestId, title, draft: fallbackDraft });
      setDraftAmount(String(existingBid ? Math.round(existingBid.amount / 100) : Math.round(fallbackDraft.suggested_amount_cents / 100)));
      setDraftDays(String(existingBid?.work_days?.length ?? fallbackDraft.suggested_days));
      setDraftWorkDays(existingBid?.work_days?.length ? existingBid.work_days : nextWorkDays(fallbackDraft.suggested_days));
      setDraftText(fallbackDraft.draft_text);
      setSubmitSuccess(false);
      setSubmitError(null);
      return;
    }

    const result = await draftBid(requestId);
    const draft = result ?? fallbackDraft;
    setActiveDraft({ requestId, title, draft });
    setDraftAmount(String(existingBid ? Math.round(existingBid.amount / 100) : Math.round(draft.suggested_amount_cents / 100)));
    setDraftDays(String(existingBid?.work_days?.length ?? draft.suggested_days));
    setDraftWorkDays(existingBid?.work_days?.length ? existingBid.work_days : nextWorkDays(draft.suggested_days));
    setDraftText(draft.draft_text);
    setSubmitSuccess(false);
    setSubmitError(null);
  }

  async function handleSubmitBid() {
    if (!activeDraft) return;
    if (context?.providerStatus !== "active") {
      setSubmitError(
        context?.providerStatus === "suspended"
          ? "Your provider account is suspended. Contact Bundleen support before submitting bids."
          : "Your provider account must be approved by Bundleen before you can submit bids.",
      );
      return;
    }
    const token = getToken();
    if (!token) {
      setSubmitError("You need to sign in again before submitting a bid.");
      return;
    }

    const amountDollars = Number(draftAmount);
    const workDays = draftWorkDays.filter(Boolean);
    const estimatedDays = workDays.length;
    if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
      setSubmitError("Enter a valid bid amount.");
      return;
    }
    if (!Number.isFinite(estimatedDays) || estimatedDays <= 0) {
      setSubmitError("Select at least one work day.");
      return;
    }

    setSubmitLoading(true);
    setSubmitError(null);
    try {
      await apiFetch(`/requests/${activeDraft.requestId}/bids`, {
        method: "POST",
        token,
        body: JSON.stringify({
          amount: Math.round(amountDollars * 100),
          estimated_days: estimatedDays,
          work_days: workDays,
        }),
      });
      setJobs((current) =>
        current.map((job) =>
          job.id === activeDraft.requestId
            ? {
                ...job,
                bid_count: job.bid_count + (bidByRequestId.has(activeDraft.requestId) ? 0 : 1),
              }
            : job
        )
      );
      await Promise.all([refreshJobFeed(), refreshProviderBids()]);
      setSubmitSuccess(true);
      setTimeout(() => setActiveDraft(null), 1200);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to submit bid");
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <div style={{ background: "var(--bg-app)", minHeight: "100vh" }}>
      {/* Topbar */}
      <div className="flex flex-col gap-4 px-4 pb-4 pt-6 md:flex-row md:items-end md:justify-between md:px-9 md:pb-5 md:pt-7">
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "clamp(24px, 6vw, 30px)", letterSpacing: "-0.02em", margin: "0 0 4px", color: "var(--ink-900)" }}>Job feed</h1>
          <p style={{ margin: 0, color: "var(--ink-500)", fontSize: 14 }}>
            {displayedJobs.length} nearby homeowner request{displayedJobs.length !== 1 ? "s" : ""} within your service radius
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={btnGhost} onClick={() => setSearchOpen((current) => !current)}><IconSearch /> {searchOpen ? "Hide search" : "Search jobs"}</button>
          <button style={{ ...btnQuiet, background: savedOnly ? "var(--gold-50)" : "var(--cream-100)" }} onClick={() => setSavedOnly((current) => !current)}>
            {savedOnly ? "Showing saved" : "Saved"} <span style={{ marginLeft: 4, color: "var(--ink-400)" }}>{savedJobIds.length}</span>
          </button>
          <button style={btnPrimary} onClick={() => setShowAutoBidModal(true)}><IconSpark /> Auto-bid settings</button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-5 px-4 pb-8 md:px-9 md:pb-9 lg:grid-cols-[1fr_320px] lg:gap-[22px]">
        {/* Left */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {searchOpen ? (
            <div style={{ ...card, padding: 16 }}>
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search by title, trade, or neighborhood"
                style={{ width: "100%", height: 42, borderRadius: 12, border: "1px solid var(--border-warm)", background: "var(--bg-card)", padding: "0 14px", fontSize: 14, color: "var(--ink-900)", fontFamily: "var(--font-body)", boxSizing: "border-box" }}
              />
            </div>
          ) : null}

          {/* Filter row — chips scroll on mobile; extra filters live in a sheet */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px" }}>
            <div className="scrollbar-hide flex flex-1 items-center gap-1.5 overflow-x-auto md:flex-wrap md:overflow-visible">
              {filters.map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveTrade(f)}
                  style={{ display: "inline-flex", alignItems: "center", height: 30, padding: "0 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer", border: 0, background: activeTrade === f ? "var(--ink-900)" : "transparent", color: activeTrade === f ? "white" : "var(--ink-700)", fontFamily: "var(--font-body)", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  {f}
                </button>
              ))}
              <span className="hidden md:block" style={{ width: 1, height: 22, background: "var(--border-warm)", margin: "0 6px" }} />
              <button className="hidden md:inline-flex" style={{ ...btnSmGhost, background: highBudgetOnly ? "var(--terracotta-50)" : "transparent", color: highBudgetOnly ? "var(--terracotta-600)" : "var(--ink-700)" }} onClick={() => setHighBudgetOnly((current) => !current)}>$500+</button>
              <button className="hidden md:inline-flex" style={{ ...btnSmGhost, background: closingTodayOnly ? "var(--terracotta-50)" : "transparent", color: closingTodayOnly ? "var(--terracotta-600)" : "var(--ink-700)" }} onClick={() => setClosingTodayOnly((current) => !current)}>Closing today</button>
            </div>
            <button
              className="hidden md:inline-flex"
              style={btnSmGhost}
              onClick={() =>
                setSortMode((current) =>
                  current === "best_match"
                    ? "closing_soon"
                    : current === "closing_soon"
                      ? "budget_high"
                      : current === "budget_high"
                        ? "budget_low"
                        : "best_match"
                )
              }
            >
              Sort: {sortMode === "best_match" ? "Best match" : sortMode === "closing_soon" ? "Closing soon" : sortMode === "budget_high" ? "Budget high" : "Budget low"} ↓
            </button>
            <button
              className="md:hidden"
              aria-label="Open filters"
              onClick={() => setFilterSheetOpen(true)}
              style={{ ...btnSmGhost, flexShrink: 0, gap: 6 }}
            >
              <IconFilter />
              Filters
              {activeFilterCount > 0 ? (
                <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 999, background: "var(--terracotta-600)", color: "white", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
          </div>

          <MobileSheet open={filterSheetOpen} onClose={() => setFilterSheetOpen(false)} title="Filters">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { label: "Budget $500+", active: highBudgetOnly, toggle: () => setHighBudgetOnly((c) => !c) },
                { label: "Closing today", active: closingTodayOnly, toggle: () => setClosingTodayOnly((c) => !c) },
                { label: `Saved jobs only (${savedJobIds.length})`, active: savedOnly, toggle: () => setSavedOnly((c) => !c) },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={item.toggle}
                  className="tap-target flex items-center justify-between"
                  style={{ padding: "12px 10px", borderRadius: 12, background: item.active ? "var(--terracotta-50)" : "transparent", color: item.active ? "var(--terracotta-600)" : "var(--ink-700)", fontSize: 15, fontWeight: 600, border: 0, cursor: "pointer", width: "100%", fontFamily: "var(--font-body)" }}
                >
                  {item.label}
                  {item.active ? <span aria-hidden>✓</span> : null}
                </button>
              ))}
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--ink-400)", fontWeight: 600, padding: "14px 10px 6px" }}>Sort by</div>
              {([
                ["best_match", "Best match"],
                ["closing_soon", "Closing soon"],
                ["budget_high", "Budget: high to low"],
                ["budget_low", "Budget: low to high"],
              ] as [SortMode, string][]).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => { setSortMode(mode); setFilterSheetOpen(false); }}
                  className="tap-target flex items-center justify-between"
                  style={{ padding: "12px 10px", borderRadius: 12, background: sortMode === mode ? "var(--cream-100)" : "transparent", color: "var(--ink-900)", fontSize: 15, fontWeight: sortMode === mode ? 700 : 500, border: 0, cursor: "pointer", width: "100%", fontFamily: "var(--font-body)" }}
                >
                  {label}
                  {sortMode === mode ? <span aria-hidden>✓</span> : null}
                </button>
              ))}
            </div>
          </MobileSheet>

          {/* Featured job card */}
          {featuredJob ? (
            <div style={{ ...card, padding: 0, overflow: "hidden", position: "relative" }}>
              <div style={{ position: "absolute", top: 16, left: 16, display: "flex", gap: 8, zIndex: 2 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--terracotta-50)", color: "var(--terracotta-600)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: "currentColor" }} /> Closest match
                </span>
                {featuredJob.is_group === true ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--sage-50)", color: "var(--sage-700)" }}>
                    {featuredJob.member_count} homes · Group deal
                  </span>
                ) : null}
                <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--gold-50)", color: "var(--gold-600)" }}>
                  {formatDateMeta(featuredJob.closes_at)}
                </span>
              </div>
              <CategoryBanner category={featuredJob.category} height={130} />
              <div style={{ padding: "20px 28px 22px" }}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "clamp(19px, 5vw, 26px)",
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                        color: "var(--ink-900)",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {featuredJob.title}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
                      {featuredJob.neighborhood}{formatDistance(featuredJob.distance_mi) ? ` · ${formatDistance(featuredJob.distance_mi)}` : ""} · {featuredJob.bid_count} competing provider bid{featuredJob.bid_count !== 1 ? "s" : ""}
                    </div>
                    {featuredJob.is_group === true ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                        <AvatarStack total={featuredJob.member_count ?? undefined} size={26} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--sage-700)" }}>
                          One bid serves all {featuredJob.member_count} homes
                        </span>
                      </div>
                    ) : null}
                    {featuredExistingBid ? (
                      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: "var(--sage-700)" }}>
                        Your current bid: ${Math.round(featuredExistingBid.amount / 100).toLocaleString()} · {featuredExistingBid.estimated_days} day{featuredExistingBid.estimated_days !== 1 ? "s" : ""}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ ...eyebrow }}>Bid range</div>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 30, color: "var(--terracotta-600)", lineHeight: 1, marginTop: 4, letterSpacing: "-0.02em" }}>
                      ${Math.round(featuredJob.budget_min / 100).toLocaleString()}–${Math.round(featuredJob.budget_max / 100).toLocaleString()}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--sage-700)", fontWeight: 600, marginTop: 4 }}>
                      {featuredJob.status === "live" ? "Open for bids now" : "Grouping neighbors now"}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18, justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, color: "var(--ink-700)" }}>
                    Category: <strong style={{ color: "var(--ink-900)" }}>{featuredJob.category}</strong>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={{ ...btnSmGhost, background: "var(--cream-100)", border: 0 }} onClick={() => setDetailJob(featuredJob)}>View details</button>
                    <button
                      style={btnPrimary}
                      disabled={draftLoading}
                      onClick={() => handleDraftBid(featuredJob.id, featuredJob.title)}
                    >
                      {draftLoading ? "Drafting..." : <><span>{featuredExistingBid ? "Update bid" : "Draft bid"}</span> <IconArrowR /></>}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ ...card, padding: "22px 24px", fontSize: 14, color: "var(--ink-500)" }}>
              No nearby homeowner requests are currently inside your configured service radius.
            </div>
          )}

          {/* Job list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {loading ? (
              <div style={{ ...card, padding: "18px 22px", fontSize: 13, color: "var(--ink-500)" }}>Loading nearby requests…</div>
            ) : displayedJobs.length === 0 ? (
              <div style={{ ...card, padding: "18px 22px", fontSize: 13, color: "var(--ink-500)" }}>
                No homeowner requests match your current search and filters.
              </div>
            ) : displayedJobs.map((job) => {
              return (
              <div key={job.id} className="flex flex-wrap items-center gap-3.5 p-4 md:px-[22px]" style={card}>
                <CategoryTile category={job.category} size={42} />
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, color: "var(--ink-900)" }}>{job.title}</div>
                    <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, ...(job.status === "live" ? chipTone.sage : chipTone.gold) }}>
                      {job.status}
                    </span>
                    {bidByRequestId.has(job.id) ? (
                      <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, ...chipTone.terracotta }}>
                        Your bid placed
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
                    {job.neighborhood}{formatDistance(job.distance_mi) ? ` · ${formatDistance(job.distance_mi)}` : ""} · {job.bid_count} competing bid{job.bid_count !== 1 ? "s" : ""} · {formatDateMeta(job.closes_at)}
                  </div>
                </div>
                <div className="hidden md:block" style={{ width: 140 }}>
                  <div style={{ fontSize: 11, color: "var(--ink-400)", marginTop: 4 }}>category</div>
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                    {job.is_group === true ? (
                      <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "var(--sage-50)", color: "var(--sage-700)", marginRight: 6 }}>
                        {job.member_count} homes
                      </span>
                    ) : null}
                    <div style={{ fontSize: 13, color: "var(--ink-700)", fontWeight: 600, textTransform: "capitalize" }}>{job.category}</div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: 16, color: "var(--ink-900)", letterSpacing: "-0.02em" }}>
                    ${Math.round(job.budget_min / 100).toLocaleString()}–${Math.round(job.budget_max / 100).toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 2 }}>bid range</div>
                </div>
                <div className="flex w-full flex-wrap gap-1.5 md:w-auto">
                  <button style={{ ...btnSmGhost, background: savedJobIds.includes(job.id) ? "var(--gold-50)" : "transparent", color: savedJobIds.includes(job.id) ? "var(--gold-600)" : "var(--ink-700)" }} onClick={() => toggleSavedJob(job.id)}>
                    {savedJobIds.includes(job.id) ? "Saved" : "Save"}
                  </button>
                  <button style={btnSmGhost} onClick={() => setDetailJob(job)}>View</button>
                  <button
                    style={btnSmPrimary}
                    disabled={draftLoading}
                    onClick={() => handleDraftBid(job.id, job.title)}
                  >
                    {bidByRequestId.has(job.id) ? "Update bid" : "Draft bid"}
                  </button>
                </div>
              </div>
            )})}
          </div>
        </div>

        {/* Right rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Auto-bid */}
          <div style={{ ...card, padding: 22, background: "linear-gradient(160deg, var(--sage-50), white)" }}>
            <div style={{ ...eyebrow }}>Auto-bid is <span style={{ color: autoBidSettings.enabled ? "var(--sage-700)" : "var(--terracotta-600)" }}>{autoBidSettings.enabled ? "ON" : "PAUSED"}</span></div>
            <div style={{ fontSize: 13, color: "var(--ink-700)", marginTop: 8, lineHeight: 1.5 }}>
              We&apos;ll draft a quote when a job matches <strong>≥{autoBidSettings.matchThreshold}%</strong> within your <strong>{actualRadiusMi} mi radius</strong>. You approve before sending.
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <button
                style={{ ...btnSmGhost, flex: 1, background: "var(--cream-100)", border: 0 } as CSSProperties}
                onClick={() => setAutoBidSettings((current) => ({ ...current, enabled: !current.enabled }))}
              >
                {autoBidSettings.enabled ? "Pause" : "Resume"}
              </button>
              <button style={{ ...btnSmGhost, flex: 1 }} onClick={() => setShowAutoBidModal(true)}>Edit rules</button>
            </div>
          </div>

          {/* Closing soon */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ ...eyebrow }}>Closing soon</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {closingSoonJobs.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--ink-500)" }}>No active deadlines in your current results.</div>
              ) : closingSoonJobs.map((job) => {
                const tone = isClosingToday(job.closes_at) ? "terracotta" : "gold";
                return (
                  <button
                    key={job.id}
                    onClick={() => setDetailJob(job)}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ color: "var(--ink-700)" }}>{job.title}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, ...(chipTone[tone] ?? {}) }}>{formatTimeRemaining(job.closes_at)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Service map */}
          <div style={{ ...card, padding: 22 }}>
            <div style={{ ...eyebrow }}>Service map</div>
            <ServiceMap
              lat={profile?.latitude}
              lng={profile?.longitude}
              radiusMi={actualRadiusMi}
              locality={profile?.neighborhood ?? ""}
              jobCount={displayedJobs.length}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink-500)", marginTop: 10 }}>
              <span style={{ color: "var(--ink-500)" }}>Community radius: <strong style={{ color: "var(--ink-900)" }}>{actualRadiusMi} mi</strong></span>
              <span style={{ color: "var(--ink-500)" }}>{profile?.latitude && profile?.longitude ? "Map centered on your saved provider address" : "Add a provider address to enable the live map"}</span>
            </div>
          </div>

          {/* Demand forecast */}
          <div style={{ ...card, padding: 22, background: "var(--cream-100)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500, color: "var(--ink-900)" }}>
                {forecast ? "Demand forecast" : "Bidding tip"}
              </div>
              {!forecast && (
                <button
                  style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", background: "var(--terracotta-50)", color: "var(--terracotta-600)", border: 0 }}
                  disabled={forecastLoading}
                  onClick={async () => {
                    const result = await getForecast();
                    if (result) setForecast(result);
                  }}
                >
                  {forecastLoading ? "Loading…" : "✦ Forecast"}
                </button>
              )}
              {forecast && (
                <button
                  style={{ background: "transparent", border: 0, cursor: "pointer", fontSize: 13, color: "var(--ink-400)", padding: 0 }}
                  onClick={() => setForecast(null)}
                >
                  ×
                </button>
              )}
            </div>

            {!forecast ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-700)", lineHeight: 1.5 }}>
                Crews who quote within <strong>2 hours</strong> of a group RFP win <strong>3.4×</strong> more often.
              </p>
            ) : (
              <div>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-500)" }}>
                  {forecast.neighborhood} · {forecast.forecast_period}
                  {forecast.stub ? " · estimate only" : ""}
                </p>
                {forecast.predictions.slice(0, 4).map((p, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: i > 0 ? "1px solid var(--border-warm)" : "none" }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)", textTransform: "capitalize" as const }}>{p.category}</span>
                      {p.provider_shortage && (
                        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 600, color: "var(--terracotta-600)", background: "var(--terracotta-50)", borderRadius: 999, padding: "1px 6px" }}>short</span>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-900)" }}>{p.predicted_requests}</span>
                      <span style={{ fontSize: 11, color: "var(--ink-400)", marginLeft: 3 }}>req</span>
                    </div>
                  </div>
                ))}
                <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--ink-700)", lineHeight: 1.5, fontStyle: "italic" }}>
                  {forecast.top_opportunity}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {activeDraft && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(34,28,22,0.55)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveDraft(null);
          }}
        >
          <div
            style={{
              ...card,
              width: "100%",
              maxWidth: 560,
              borderRadius: "18px 18px 0 0",
              padding: "28px 28px 32px",
              maxHeight: "80vh",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--ink-900)", letterSpacing: "-0.01em" }}>
                  AI bid draft
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 3 }}>{activeDraft.title}</div>
              </div>
              <button
                onClick={() => setActiveDraft(null)}
                style={{ background: "var(--cream-100)", border: 0, borderRadius: 999, width: 32, height: 32, cursor: "pointer", fontSize: 18, color: "var(--ink-500)", display: "grid", placeItems: "center" }}
              >
                ×
              </button>
            </div>

            <div style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--terracotta-50)", color: "var(--terracotta-600)", marginBottom: 20 }}>
              {activeDraft.draft.headline}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-400)", display: "block", marginBottom: 6 }}>
                  Bid amount ($)
                </label>
                <input
                  type="number"
                  value={draftAmount}
                  onChange={(e) => setDraftAmount(e.target.value)}
                  style={{ width: "100%", height: 40, borderRadius: 10, border: "1px solid var(--border-warm)", background: "var(--bg-app)", padding: "0 12px", fontSize: 15, fontWeight: 600, color: "var(--ink-900)", fontFamily: "var(--font-body)", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-400)", display: "block", marginBottom: 6 }}>
                  Work days selected
                </label>
                <input
                  type="number"
                  value={draftWorkDays.length}
                  readOnly
                  style={{ width: "100%", height: 40, borderRadius: 10, border: "1px solid var(--border-warm)", background: "var(--bg-app)", padding: "0 12px", fontSize: 15, fontWeight: 600, color: "var(--ink-900)", fontFamily: "var(--font-body)", boxSizing: "border-box" }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-400)", display: "block" }}>
                  Proposed work days
                </label>
                <button
                  type="button"
                  style={{ ...btnSmGhost, height: 28 }}
                  onClick={() => {
                    const last = draftWorkDays[draftWorkDays.length - 1];
                    const base = last ? new Date(`${last}T00:00:00`) : new Date();
                    const next = new Date(base);
                    next.setDate(next.getDate() + 1);
                    setDraftWorkDays((current) => [...current, next.toISOString().slice(0, 10)]);
                    setDraftDays(String(draftWorkDays.length + 1));
                  }}
                >
                  Add day
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {draftWorkDays.map((day, index) => (
                  <div key={`${day}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <input
                      type="date"
                      value={day}
                      onChange={(e) => {
                        const nextDays = draftWorkDays.map((value, valueIndex) => valueIndex === index ? e.target.value : value);
                        setDraftWorkDays(nextDays);
                        setDraftDays(String(nextDays.filter(Boolean).length));
                      }}
                      style={{ width: "100%", height: 40, borderRadius: 10, border: "1px solid var(--border-warm)", background: "var(--bg-app)", padding: "0 12px", fontSize: 14, color: "var(--ink-900)", fontFamily: "var(--font-body)", boxSizing: "border-box" }}
                    />
                    <button
                      type="button"
                      style={{ ...btnSmGhost, height: 40 }}
                      onClick={() => {
                        const nextDays = draftWorkDays.filter((_, valueIndex) => valueIndex !== index);
                        setDraftWorkDays(nextDays);
                        setDraftDays(String(nextDays.filter(Boolean).length));
                      }}
                      disabled={draftWorkDays.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-500)" }}>
                These dates will be temporarily blocked on your calendar while the bid is pending.
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-400)", display: "block", marginBottom: 6 }}>
                Proposal text
              </label>
              <textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                rows={4}
                style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border-warm)", background: "var(--bg-app)", padding: "10px 12px", fontSize: 14, color: "var(--ink-700)", fontFamily: "var(--font-body)", lineHeight: 1.55, resize: "vertical", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ fontSize: 12, color: "var(--ink-400)", marginBottom: 22 }}>
              Price confidence: <strong style={{ color: activeDraft.draft.confidence === "high" ? "var(--sage-700)" : activeDraft.draft.confidence === "medium" ? "var(--gold-600)" : "var(--ink-500)" }}>{activeDraft.draft.confidence}</strong>
              {activeDraft.draft.stub ? " · AI unavailable — showing estimate" : ""}
            </div>

            {context && context.providerStatus !== "active" ? (
              <div style={{ fontSize: 12, color: "var(--terracotta-600)", marginBottom: 16 }}>
                {context.providerStatus === "suspended"
                  ? "Your account is suspended, so new bids are disabled. Contact Bundleen support."
                  : "New bids are disabled until Bundleen approves your provider account."}
              </div>
            ) : null}

            {draftError ? (
              <div style={{ fontSize: 12, color: "var(--terracotta-600)", marginBottom: 16 }}>
                {draftError}
              </div>
            ) : null}

            {submitError ? (
              <div style={{ fontSize: 12, color: "var(--terracotta-600)", marginBottom: 16 }}>
                {submitError}
              </div>
            ) : null}

            {submitSuccess ? (
              <div style={{ textAlign: "center", padding: "12px 0", color: "var(--sage-700)", fontWeight: 600, fontSize: 15 }}>
                ✓ Bid submitted!
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  style={{ ...btnGhost, flex: 1 }}
                  onClick={() => setActiveDraft(null)}
                >
                  Cancel
                </button>
                <button
                  style={{ ...btnPrimary, flex: 2, justifyContent: "center" }}
                  disabled={submitLoading || context?.providerStatus !== "active"}
                  onClick={() => void handleSubmitBid()}
                >
                  <span>{submitLoading ? "Submitting…" : "Submit bid"}</span> {!submitLoading ? <IconArrowR /> : null}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {detailJob ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(34,28,22,0.42)", display: "flex", justifyContent: "center", alignItems: "center", padding: 24 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailJob(null);
          }}
        >
          <div style={{ ...card, width: "100%", maxWidth: 560, padding: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, color: "var(--ink-900)" }}>{detailJob.title}</div>
                <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
                  {detailJob.neighborhood}{formatDistance(detailJob.distance_mi) ? ` · ${formatDistance(detailJob.distance_mi)}` : ""} · {detailJob.status}
                </div>
              </div>
              <button onClick={() => setDetailJob(null)} style={{ background: "transparent", border: 0, fontSize: 20, cursor: "pointer", color: "var(--ink-500)" }}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 20 }}>
              <div style={{ ...card, padding: 14 }}>
                <div style={eyebrow}>Budget range</div>
                <div style={{ marginTop: 8, fontWeight: 600, color: "var(--ink-900)" }}>${Math.round(detailJob.budget_min / 100).toLocaleString()}–${Math.round(detailJob.budget_max / 100).toLocaleString()}</div>
              </div>
              <div style={{ ...card, padding: 14 }}>
                <div style={eyebrow}>Competitive bids</div>
                <div style={{ marginTop: 8, fontWeight: 600, color: "var(--ink-900)" }}>{detailJob.bid_count}</div>
              </div>
            </div>
            <div style={{ ...card, padding: 16, marginTop: 14 }}>
              <div style={eyebrow}>Opportunity</div>
              <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--ink-700)", lineHeight: 1.6 }}>
                This homeowner request is inside your current service radius. Review it, save it for later, or draft a bid now.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button style={{ ...btnGhost, flex: 1 }} onClick={() => toggleSavedJob(detailJob.id)}>{savedJobIds.includes(detailJob.id) ? "Remove saved" : "Save job"}</button>
              <button
                style={{ ...btnPrimary, flex: 1, justifyContent: "center" }}
                onClick={() => {
                  setDetailJob(null);
                  void handleDraftBid(detailJob.id, detailJob.title);
                }}
              >
                Draft bid
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showAutoBidModal ? (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 45, background: "rgba(34,28,22,0.42)", display: "flex", justifyContent: "center", alignItems: "center", padding: 24 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAutoBidModal(false);
          }}
        >
          <div style={{ ...card, width: "100%", maxWidth: 520, padding: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 500, color: "var(--ink-900)" }}>Auto-bid settings</div>
                <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>Adjust the saved rules used for AI draft suggestions.</div>
              </div>
              <button onClick={() => setShowAutoBidModal(false)} style={{ background: "transparent", border: 0, fontSize: 20, cursor: "pointer", color: "var(--ink-500)" }}>×</button>
            </div>
            <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
              <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, color: "var(--ink-700)" }}>
                <span>Enable auto-bid drafting</span>
                <input
                  type="checkbox"
                  checked={autoBidSettings.enabled}
                  onChange={(e) => setAutoBidSettings((current) => ({ ...current, enabled: e.target.checked }))}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={eyebrow}>Minimum match threshold</span>
                <input
                  type="range"
                  min="50"
                  max="100"
                  step="5"
                  value={autoBidSettings.matchThreshold}
                  onChange={(e) => setAutoBidSettings((current) => ({ ...current, matchThreshold: Number(e.target.value) }))}
                />
                <span style={{ fontSize: 13, color: "var(--ink-600)" }}>{autoBidSettings.matchThreshold}% match</span>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={eyebrow}>Service radius</span>
                <input
                  type="range"
                  min="1"
                  max="25"
                  step="1"
                  value={autoBidSettings.radiusMi}
                  onChange={(e) => setAutoBidSettings((current) => ({ ...current, radiusMi: Number(e.target.value) }))}
                />
                <span style={{ fontSize: 13, color: "var(--ink-600)" }}>{autoBidSettings.radiusMi} miles</span>
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
              <button style={{ ...btnGhost, flex: 1 }} onClick={() => setShowAutoBidModal(false)}>Close</button>
              <button style={{ ...btnPrimary, flex: 1, justifyContent: "center" }} onClick={() => setShowAutoBidModal(false)}>Save rules</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
