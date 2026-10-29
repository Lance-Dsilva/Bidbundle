"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import type {
  BidSummary,
  HoaManagerCommunity,
  HoaManagerDashboard,
  HoaRequestSummary,
  OccurrenceSummary,
} from "@/lib/hoa-types";

import { hoaRequestCreateSchema } from "@/lib/validation/hoa";

type ActionState = { busy: boolean; error: string | null; success: string | null };
const IDLE: ActionState = { busy: false, error: null, success: null };
const FREQUENCIES = [
  { value: "weekly", label: "Weekly", days: 7 },
  { value: "fortnightly", label: "Every 2 weeks", days: 14 },
  { value: "monthly", label: "Monthly (every 30 days)", days: 30 },
] as const;

async function sendJson(method: string, path: string, body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const result = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(result?.error ?? "Something went wrong. Please try again.");
}

const STATUS_LABEL: Record<HoaRequestSummary["status"], string> = {
  draft: "Draft",
  collecting_interest: "Collecting interest",
  open_for_bids: "Open for bids",
  bidding_closed: "Bidding closed",
  awarded: "Awarded",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function dateLabel(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

export function HoaManagerWorkspace({ dashboard }: { dashboard: HoaManagerDashboard }) {
  const community = dashboard.communities[0];

  if (!community) {
    return (
      <section className="rounded-2xl border border-[#dce7e4] bg-white p-8 text-center">
        <h1 className="text-2xl font-bold text-[#102a43]">No HOA assignment</h1>
        <p className="mt-2 text-sm text-[#64748b]">
          Bundleen must assign this account to an active HOA before the manager portal can be used.
        </p>
      </section>
    );
  }

  return <CommunityWorkspace community={community} />;
}

function CommunityWorkspace({ community }: { community: HoaManagerCommunity }) {
  const router = useRouter();
  const [invite, setInvite] = useState(IDLE);
  const [unitState, setUnitState] = useState(IDLE);
  const [requestState, setRequestState] = useState(IDLE);
  const [awardState, setAwardState] = useState(IDLE);
  const [surveyState, setSurveyState] = useState(IDLE);
  const [requestKind, setRequestKind] = useState<"compulsory_recurring" | "optional_group">(
    "compulsory_recurring",
  );

  const [requestFrequency, setRequestFrequency] = useState<string>(FREQUENCIES[0].value);
  const [requestVisits, setRequestVisits] = useState("");
  const requestPending = useRef(false);

  const residentInvitations = community.invitations.filter((item) => item.role === "homeowner");
  const occupied = community.units.filter((unit) => unit.occupancyStatus === "occupied").length;
  const invitableUnits = community.units.filter(
    (unit) => unit.occupancyStatus === "vacant" && !unit.pendingInviteEmail,
  );
  const openRequests = community.requests.filter((item) =>
    ["collecting_interest", "open_for_bids"].includes(item.status),
  ).length;
  const bidsAwaiting = community.requests.filter(
    (item) => item.status === "bidding_closed" && (community.bidsByRequest[item.id]?.length ?? 0) > 0,
  ).length;

  const run = async (
    setter: (state: ActionState) => void,
    success: string,
    action: () => Promise<void>,
  ) => {
    setter({ busy: true, error: null, success: null });
    try {
      await action();
      setter({ busy: false, error: null, success });
      router.refresh();
    } catch (error) {
      setter({
        busy: false,
        error: error instanceof Error ? error.message : "Something went wrong.",
        success: null,
      });
    }
  };

  const submitInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(setInvite, "Invitation email sent.", async () => {
      await sendJson("POST", `/api/hoa/communities/${community.id}/invitations`, {
        email: data.get("email"),
        unitId: data.get("unitId"),
      });
      form.reset();
    });
  };

  const submitUnit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(setUnitState, "Unit added to the roster.", async () => {
      await sendJson("POST", `/api/hoa/communities/${community.id}/units`, {
        label: data.get("label"),
        addressLine1: (data.get("addressLine1") as string) || null,
      });
      form.reset();
    });
  };

  const submitRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (requestPending.current || requestState.busy || !form.reportValidity()) return;
    const data = new FormData(form);
    const kind = String(data.get("kind"));
    const frequency = FREQUENCIES.find((preset) => preset.value === data.get("frequency"));
    if (
      (kind !== "compulsory_recurring" && kind !== "optional_group") ||
      (kind === "compulsory_recurring" && !frequency)
    ) {
      setRequestState({ busy: false, error: "Choose a request type and service frequency, then try again.", success: null });
      return;
    }
    const asDate = (name: string) => {
      const raw = String(data.get(name) ?? "").trim();
      if (!raw) return null;
      const date = new Date(raw);
      if (!Number.isFinite(date.getTime())) throw new Error("Enter valid service and deadline dates, then try again.");
      return date.toISOString();
    };
    const asInt = (name: string) => {
      const raw = String(data.get(name) ?? "").trim();
      return raw ? Number(raw) : null;
    };
    requestPending.current = true;
    void run(setRequestState, "Service request created.", async () => {
      const payload = hoaRequestCreateSchema.safeParse({
        title: data.get("title"),
        category: data.get("category"),
        description: data.get("description"),
        kind,
        recurrenceLabel: kind === "compulsory_recurring" ? frequency!.label : null,
        recurrenceIntervalDays: kind === "compulsory_recurring" ? frequency!.days : null,
        totalOccurrences: asInt("totalOccurrences") ?? 1,
        startDate: asDate("startDate"),
        enrollmentClosesAt: kind === "optional_group" ? asDate("enrollmentClosesAt") : null,
        biddingClosesAt: asDate("biddingClosesAt"),
        minHomes: kind === "optional_group" ? asInt("minHomes") : null,
        publish: data.get("publish") === "on",
      });
      if (!payload.success) throw new Error(payload.error.issues[0]?.message ?? "Check the request details and try again.");
      await sendJson("POST", `/api/hoa/communities/${community.id}/requests`, payload.data);
      form.reset();
      setRequestKind("compulsory_recurring");
      setRequestFrequency(FREQUENCIES[0].value);
      setRequestVisits("");
    }).finally(() => {
      requestPending.current = false;
    });
  };

  const transition = (requestId: string, action: string, success: string) =>
    run(setRequestState, success, () => {
      const request = community.requests.find((item) => item.id === requestId);
      const needsDefaultDeadline =
        action === "open_bidding" &&
        request?.kind === "optional_group" &&
        request.status === "collecting_interest" &&
        !request.biddingClosesAt;
      return sendJson("PATCH", `/api/hoa/requests/${requestId}`, {
        action,
        ...(needsDefaultDeadline
          ? { biddingClosesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() }
          : {}),
      });
    });

  const award = (requestId: string, bidId: string) =>
    run(setAwardState, "Bid accepted — agreement and visits created.", () =>
      sendJson("POST", `/api/hoa/requests/${requestId}/award`, { bidId }),
    );

  const submitSurvey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const options = [data.get("option1"), data.get("option2"), data.get("option3")]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    void run(setSurveyState, "Monthly survey published.", async () => {
      await sendJson("POST", `/api/hoa/communities/${community.id}/surveys`, {
        monthKey: data.get("monthKey"),
        question: data.get("question"),
        options,
        status: "open",
      });
      form.reset();
    });
  };

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#0f8f83]">
            {community.name}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#102a43]">
            HOA manager dashboard
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#64748b]">
            Maintain the home roster, invite residents to specific units, run procurements, award
            one bid, and track the provider&apos;s schedule through completion.
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Homes on roster" value={community.units.length} />
        <Stat label="Occupied homes" value={occupied} />
        <Stat label="Open requests" value={openRequests} />
        <Stat label="Awaiting award" value={bidsAwaiting} />
      </div>

      {/* ── Units & residents ─────────────────────────────────────────── */}
      <section id="residents" className="scroll-mt-6 rounded-2xl border border-[#dce7e4] bg-white p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">Homes & residents</p>
        <h2 className="mt-1 text-xl font-bold text-[#102a43]">Unit roster</h2>
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,.9fr)]">
          <div className="overflow-x-auto">
            {community.units.length === 0 ? (
              <Empty text="No homes yet. Add units below or ask Bundleen to import the inventory." />
            ) : (
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#e1e8e6] text-xs uppercase text-[#64748b]">
                    <th className="py-2 pr-3">Home</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2">Resident</th>
                  </tr>
                </thead>
                <tbody>
                  {community.units.map((unit) => (
                    <tr className="border-b border-[#f0f4f3]" key={unit.id}>
                      <td className="py-2 pr-3 font-medium text-[#102a43]">{unit.label}</td>
                      <td className="py-2 pr-3">
                        <Badge
                          tone={
                            unit.occupancyStatus === "occupied"
                              ? "green"
                              : unit.occupancyStatus === "invite_pending"
                                ? "amber"
                                : "gray"
                          }
                        >
                          {unit.occupancyStatus.replace("_", " ")}
                        </Badge>
                      </td>
                      <td className="py-2 text-[#334e68]">
                        {unit.residentName ?? unit.pendingInviteEmail ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={submitUnit}>
              <input className={inputClass} name="label" placeholder="New unit label (Home 11)" required />
              <input className={inputClass} name="addressLine1" placeholder="Street address (optional)" />
              <button className={primaryButton} disabled={unitState.busy} type="submit">
                {unitState.busy ? "Adding…" : "Add unit"}
              </button>
            </form>
            <ActionMessage state={unitState} />
          </div>

          <div className="rounded-xl bg-[#f6faf9] p-4">
            <h3 className="text-sm font-semibold text-[#102a43]">Invite a homeowner to a home</h3>
            <p className="mt-1 text-xs leading-5 text-[#64748b]">
              Bundleen emails a single-use invitation bound to this exact home and email. Membership
              activates when that email is verified — no admin approval afterwards.
            </p>
            <form className="mt-3 space-y-3" onSubmit={submitInvite}>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[#334e68]">Home</span>
                <select className={inputClass} name="unitId" required>
                  <option value="">Choose a vacant home…</option>
                  {invitableUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[#334e68]">Resident email</span>
                <input className={inputClass} name="email" type="email" placeholder="resident@example.com" required />
              </label>
              <button className={`${primaryButton} w-full`} disabled={invite.busy} type="submit">
                {invite.busy ? "Sending…" : "Send invitation"}
              </button>
            </form>
            <ActionMessage state={invite} />
            {residentInvitations.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {residentInvitations.slice(0, 6).map((item) => (
                  <li className="flex items-center justify-between gap-2 text-sm" key={item.id}>
                    <span className="min-w-0 truncate text-[#334e68]">
                      {item.email}
                      {item.unitLabel ? <span className="text-[#64748b]"> · {item.unitLabel}</span> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={item.status === "accepted" ? "green" : item.status === "pending" ? "amber" : "gray"}>
                        {item.status}
                      </Badge>
                      {item.status === "pending" ? (
                        <button
                          className="text-[11px] font-semibold text-red-600"
                          disabled={invite.busy}
                          onClick={() =>
                            void run(setInvite, "Invitation revoked.", () =>
                              sendJson(
                                "DELETE",
                                `/api/hoa/communities/${community.id}/invitations/${item.id}`,
                              ),
                            )
                          }
                          type="button"
                        >
                          Revoke
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── Service requests ──────────────────────────────────────────── */}
      <section id="requests" className="scroll-mt-6 rounded-2xl border border-[#dce7e4] bg-white p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">Procurement</p>
        <h2 className="mt-1 text-xl font-bold text-[#102a43]">Create a service request</h2>
        <p className="mt-2 text-sm text-[#64748b]">
          Choose whether every active home receives the service automatically or residents choose
          to join. When residents choose, collect their interest and confirm participants before bidding.
        </p>
        <form className="mt-5" onSubmit={submitRequest}>
          <fieldset className="grid min-w-0 gap-3 md:grid-cols-2" disabled={requestState.busy}>
            <Field name="title" label="Request title" placeholder="Biweekly gardening" />
            <Field name="category" label="Service category" placeholder="Gardening" />
            <label>
              <span className="mb-1 block text-xs font-semibold text-[#334e68]">Request type</span>
              <select
                className={inputClass}
                name="kind"
                value={requestKind}
                onChange={(event) =>
                  setRequestKind(event.currentTarget.value as typeof requestKind)
                }
              >
                <option value="compulsory_recurring">Every home gets this service</option>
                <option value="optional_group">Residents choose to join</option>
              </select>
            </label>
            <Field name="startDate" label="First service date" type="date" required={false} />
            {requestKind === "compulsory_recurring" ? (
              <>
                <label>
                  <span className="mb-1 block text-xs font-semibold text-[#334e68]">Service frequency</span>
                  <select
                    className={inputClass}
                    name="frequency"
                    value={requestFrequency}
                    onChange={(event) => setRequestFrequency(event.currentTarget.value)}
                    aria-describedby="request-frequency-help"
                    required
                  >
                    {FREQUENCIES.map((preset) => (
                      <option key={preset.value} value={preset.value}>{preset.label}</option>
                    ))}
                  </select>
                  <span id="request-frequency-help" className="mt-1 block text-xs text-[#64748b]">
                    Monthly uses a fixed 30-day interval, so visits may fall on different dates each month.
                  </span>
                </label>
                <Field name="totalOccurrences" label="How many visits" type="number" placeholder="12" min={1} max={104} step={1} value={requestVisits} onChange={setRequestVisits} />
                <Field name="biddingClosesAt" label="Bidding deadline" type="datetime-local" />
              </>
            ) : (
              <>
                <Field name="enrollmentClosesAt" label="Enrollment deadline" type="datetime-local" />
                <div>
                  <Field name="biddingClosesAt" label="Bidding deadline (optional)" type="datetime-local" required={false} />
                  <p className="mt-1 text-xs text-[#64748b]">
                    Leave blank for a 7-day bidding period starting when you open bidding.
                  </p>
                </div>
                <Field name="minHomes" label="Minimum homes" type="number" placeholder="3" required={false} />
                <Field name="totalOccurrences" label="How many visits" type="number" placeholder="1" required={false} min={1} max={104} step={1} value={requestVisits} onChange={setRequestVisits} />
              </>
            )}
            <label className="md:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-[#334e68]">Scope shown to residents and providers</span>
              <textarea
                className={`${inputClass} min-h-24 py-3`}
                name="description"
                required
                placeholder="Explain the scope, expectations, and what homes receive."
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-[#334e68]">
              <input defaultChecked name="publish" type="checkbox" /> Publish immediately
            </label>
            <div className="md:col-span-2">
              <button className={primaryButton} disabled={requestState.busy} type="submit">
                {requestState.busy ? "Saving…" : "Create request"}
              </button>
              <ActionMessage state={requestState} />
            </div>
          </fieldset>
        </form>

        <div className="mt-6 space-y-4">
          {community.requests.length === 0 ? (
            <Empty text="No HOA service requests yet." />
          ) : (
            community.requests.map((item) => (
              <RequestCard
                key={item.id}
                request={item}
                bids={community.bidsByRequest[item.id] ?? []}
                busy={requestState.busy || awardState.busy}
                onTransition={transition}
                onAward={award}
              />
            ))
          )}
          <ActionMessage state={awardState} />
        </div>
      </section>

      {/* ── Agreements & schedule ─────────────────────────────────────── */}
      <section id="schedule" className="scroll-mt-6 rounded-2xl border border-[#dce7e4] bg-white p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">Awarded work</p>
        <h2 className="mt-1 text-xl font-bold text-[#102a43]">Agreements & schedule</h2>
        {community.agreements.length === 0 ? (
          <Empty text="No awarded agreements yet." />
        ) : (
          <div className="mt-4 space-y-4">
            {community.agreements.map((agreement) => (
              <article className="rounded-xl border border-[#e1e8e6] p-4" key={agreement.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[#102a43]">{agreement.requestTitle}</h3>
                    <p className="mt-1 text-sm text-[#64748b]">
                      {agreement.providerCompany ?? agreement.providerName} ·{" "}
                      {money(agreement.amountCents, agreement.currency)}{" "}
                      {agreement.pricingBasis === "per_home"
                        ? "per home"
                        : agreement.pricingBasis === "per_visit"
                          ? "per visit"
                          : "total"}{" "}
                      · {agreement.lockedHomeCount} homes
                    </p>
                  </div>
                  <Badge tone={agreement.status === "active" ? "green" : "gray"}>{agreement.status}</Badge>
                </div>
                <OccurrenceList
                  occurrences={community.occurrencesByAgreement[agreement.id] ?? []}
                  canClose
                  onClose={(occurrenceId) =>
                    void run(setAwardState, "Service day closed.", () =>
                      sendJson("POST", `/api/hoa/occurrences/${occurrenceId}/close`, {}),
                    )
                  }
                />
                {agreement.status === "completed" ? (
                  <ReviewForm
                    label="Review this provider for the HOA"
                    onSubmit={(rating, comment) =>
                      void run(setAwardState, "Review submitted.", () =>
                        sendJson("POST", `/api/hoa/agreements/${agreement.id}/review`, {
                          rating,
                          comment,
                        }),
                      )
                    }
                  />
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── Surveys ───────────────────────────────────────────────────── */}
      <section id="surveys" className="scroll-mt-6 rounded-2xl border border-[#dce7e4] bg-white p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0f8f83]">Monthly survey</p>
        <h2 className="mt-1 text-xl font-bold text-[#102a43]">Ask residents before opening an optional service</h2>
        <form className="mt-5 grid gap-3 md:grid-cols-2" onSubmit={submitSurvey}>
          <Field name="monthKey" label="Survey month" type="month" defaultValue={new Date().toISOString().slice(0, 7)} />
          <Field name="question" label="Question" placeholder="Which shared service should we bundle next?" />
          <Field name="option1" label="Option 1" placeholder="Pool cleaning" />
          <Field name="option2" label="Option 2" placeholder="Window washing" />
          <Field name="option3" label="Option 3 (optional)" placeholder="Pest control" required={false} />
          <div className="flex items-end">
            <button className={`${primaryButton} w-full`} disabled={surveyState.busy} type="submit">
              {surveyState.busy ? "Publishing…" : "Publish survey"}
            </button>
          </div>
          <div className="md:col-span-2">
            <ActionMessage state={surveyState} />
          </div>
        </form>
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {community.surveys.length === 0 ? (
            <Empty text="No monthly surveys yet." />
          ) : (
            community.surveys.slice(0, 6).map((survey) => (
              <article className="rounded-xl border border-[#e1e8e6] p-4" key={survey.id}>
                <div className="flex justify-between gap-3">
                  <p className="text-xs font-bold uppercase text-[#0f8f83]">
                    {survey.monthKey} · {survey.status}
                  </p>
                  <span className="text-xs text-[#64748b]">
                    {survey.voteCounts.reduce((sum, count) => sum + count, 0)} votes
                  </span>
                </div>
                <h3 className="mt-2 font-semibold text-[#102a43]">{survey.question}</h3>
                <ul className="mt-3 space-y-1 text-sm text-[#64748b]">
                  {survey.options.map((option, index) => (
                    <li key={option}>
                      {option} · {survey.voteCounts[index]} vote{survey.voteCounts[index] === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  {survey.status === "open" ? (
                    <StatusButton
                      disabled={surveyState.busy}
                      onClick={() =>
                        void run(setSurveyState, "Survey closed.", () =>
                          sendJson("PATCH", `/api/hoa/surveys/${survey.id}`, { status: "closed" }),
                        )
                      }
                    >
                      Close survey
                    </StatusButton>
                  ) : null}
                  {survey.status === "draft" ? (
                    <StatusButton
                      disabled={surveyState.busy}
                      onClick={() =>
                        void run(setSurveyState, "Survey opened.", () =>
                          sendJson("PATCH", `/api/hoa/surveys/${survey.id}`, { status: "open" }),
                        )
                      }
                    >
                      Open survey
                    </StatusButton>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function RequestCard({
  request,
  bids,
  busy,
  onTransition,
  onAward,
}: {
  request: HoaRequestSummary;
  bids: BidSummary[];
  busy: boolean;
  onTransition: (requestId: string, action: string, success: string) => Promise<void> | void;
  onAward: (requestId: string, bidId: string) => Promise<void> | void;
}) {
  const submitted = bids.filter((bid) => bid.status === "submitted");
  const accepted = bids.find((bid) => bid.status === "accepted");

  return (
    <article className="rounded-xl border border-[#e1e8e6] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#0f8f83]">{request.category}</p>
          <h3 className="mt-1 font-semibold text-[#102a43]">{request.title}</h3>
        </div>
        <Badge tone={["completed", "awarded", "scheduled", "in_progress"].includes(request.status) ? "green" : request.status === "cancelled" ? "gray" : "teal"}>
          {STATUS_LABEL[request.status]}
        </Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-[#64748b]">{request.description}</p>
      <p className="mt-2 text-xs text-[#64748b]">
        {request.kind === "compulsory_recurring"
          ? `Compulsory · ${request.recurrenceLabel ?? ""} · ${request.joinedCount} homes`
          : `Optional · ${request.joinedCount} joined / ${request.declinedCount} declined${request.minHomes ? ` · needs ${request.minHomes}` : ""}`}
        {request.biddingClosesAt ? ` · bids close ${dateLabel(request.biddingClosesAt)}` : ""}
      </p>
      {request.kind === "optional_group" &&
      request.status === "collecting_interest" &&
      !request.biddingClosesAt ? (
        <p className="mt-2 text-xs text-[#64748b]">
          Opening bidding sets the deadline to 7 days from that time.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {request.status === "draft" ? (
          <StatusButton disabled={busy} onClick={() => void onTransition(request.id, "publish", "Request published.")}>
            Publish
          </StatusButton>
        ) : null}
        {request.status === "collecting_interest" ? (
          <StatusButton disabled={busy} onClick={() => void onTransition(request.id, "open_bidding", "Participants locked; bidding open.")}>
            Lock participants & open bidding
          </StatusButton>
        ) : null}
        {request.status === "open_for_bids" ? (
          <StatusButton disabled={busy} onClick={() => void onTransition(request.id, "close_bidding", "Bidding closed.")}>
            Close bidding
          </StatusButton>
        ) : null}
        {["awarded", "scheduled", "in_progress"].includes(request.status) ? (
          <StatusButton disabled={busy} onClick={() => void onTransition(request.id, "complete", "Request completed.")}>
            Mark completed
          </StatusButton>
        ) : null}
        {["draft", "collecting_interest", "open_for_bids", "bidding_closed"].includes(request.status) ? (
          <StatusButton danger disabled={busy} onClick={() => void onTransition(request.id, "cancel", "Request cancelled.")}>
            Cancel
          </StatusButton>
        ) : null}
      </div>

      {bids.length > 0 ? (
        <div className="mt-4 rounded-xl bg-[#f6faf9] p-3">
          <h4 className="text-xs font-bold uppercase tracking-wide text-[#334e68]">
            Bids ({bids.length})
          </h4>
          <ul className="mt-2 space-y-2">
            {bids.map((bid) => (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-3 text-sm" key={bid.id}>
                <div className="min-w-0">
                  <p className="font-medium text-[#102a43]">
                    {bid.providerCompany ?? bid.providerName}
                    {bid.providerVerified ? (
                      <span className="ml-2 rounded-full bg-[#e8f7ee] px-2 py-0.5 text-[10px] font-bold uppercase text-[#16803c]">
                        Verified
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-[#64748b]">
                    {money(bid.amountCents, bid.currency)}{" "}
                    {bid.pricingBasis === "per_home" ? "per home" : bid.pricingBasis === "per_visit" ? "per visit" : "total"}
                    {bid.cadenceLabel ? ` · ${bid.cadenceLabel}` : ""}
                    {bid.proposedStartDate ? ` · starts ${dateLabel(bid.proposedStartDate)}` : ""}
                    {` · v${bid.version}`}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-[#64748b]">{bid.scope}</p>
                </div>
                <div>
                  {bid.status === "accepted" ? (
                    <Badge tone="green">Accepted</Badge>
                  ) : bid.status === "rejected" ? (
                    <Badge tone="gray">Rejected</Badge>
                  ) : request.status === "bidding_closed" && !accepted ? (
                    <button
                      className="rounded-lg bg-[#0f8f83] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void onAward(request.id, bid.id)}
                      type="button"
                    >
                      Accept bid
                    </button>
                  ) : (
                    <Badge tone="amber">Submitted</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {request.status === "open_for_bids" && submitted.length > 0 ? (
            <p className="mt-2 text-xs text-[#64748b]">Close bidding to accept a bid.</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function OccurrenceList({
  occurrences,
  canClose,
  onClose,
}: {
  occurrences: OccurrenceSummary[];
  canClose?: boolean;
  onClose?: (occurrenceId: string) => void;
}) {
  if (occurrences.length === 0) {
    return <p className="mt-3 text-sm text-[#64748b]">No service days yet.</p>;
  }
  return (
    <div className="mt-3 space-y-3">
      {occurrences.map((occurrence) => {
        const resolved = occurrence.visits.filter((visit) =>
          ["completed", "skipped", "blocked", "cancelled"].includes(visit.status),
        ).length;
        return (
          <div className="rounded-lg bg-[#f6faf9] p-3" key={occurrence.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[#102a43]">
                Cycle {occurrence.sequence} · {dateLabel(occurrence.serviceDate)}
              </p>
              <span className="flex items-center gap-2">
                <Badge tone={occurrence.status === "completed" ? "green" : occurrence.status === "in_progress" ? "amber" : "gray"}>
                  {occurrence.status.replace("_", " ")}
                </Badge>
                {canClose && onClose && occurrence.status !== "completed" && resolved === occurrence.visits.length && occurrence.visits.length > 0 ? (
                  <button
                    className="rounded-lg border border-[#b9d9d2] px-2 py-1 text-[11px] font-semibold text-[#0f756c]"
                    onClick={() => onClose(occurrence.id)}
                    type="button"
                  >
                    Close day
                  </button>
                ) : null}
              </span>
            </div>
            <ul className="mt-2 grid gap-1 text-xs text-[#334e68] sm:grid-cols-2">
              {occurrence.visits.map((visit) => (
                <li className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1.5" key={visit.id}>
                  <span className="min-w-0 truncate">
                    {visit.stopRank ? `${visit.stopRank}. ` : ""}
                    {visit.stopLabel}
                    {visit.windowStart ? ` · ${visit.windowStart}–${visit.windowEnd ?? ""}` : ""}
                  </span>
                  <Badge tone={visit.status === "completed" ? "green" : ["skipped", "blocked"].includes(visit.status) ? "amber" : "gray"}>
                    {visit.status.replace("_", " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function ReviewForm({
  label,
  onSubmit,
}: {
  label: string;
  onSubmit: (rating: number, comment: string) => void;
}) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  return (
    <form
      className="mt-3 rounded-lg bg-[#f6faf9] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (comment.trim()) onSubmit(rating, comment.trim());
      }}
    >
      <p className="text-xs font-bold uppercase tracking-wide text-[#334e68]">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          aria-label="Rating"
          className="h-9 rounded-lg border border-[#d8e2e0] bg-white px-2 text-sm"
          onChange={(event) => setRating(Number(event.currentTarget.value))}
          value={rating}
        >
          {[5, 4, 3, 2, 1].map((value) => (
            <option key={value} value={value}>
              {value} star{value === 1 ? "" : "s"}
            </option>
          ))}
        </select>
        <input
          className="h-9 min-w-0 flex-1 rounded-lg border border-[#d8e2e0] bg-white px-3 text-sm"
          onChange={(event) => setComment(event.currentTarget.value)}
          placeholder="How did the work go?"
          required
          value={comment}
        />
        <button className="h-9 rounded-lg bg-[#0f8f83] px-4 text-xs font-semibold text-white" type="submit">
          Submit review
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "h-11 w-full rounded-xl border border-[#d8e2e0] bg-white px-3 text-sm text-[#102a43] outline-none focus:border-[#0f8f83]";
const primaryButton =
  "h-11 rounded-xl bg-[#0f8f83] px-5 text-sm font-semibold text-white disabled:opacity-60";

function Field({
  name,
  label,
  placeholder,
  type = "text",
  defaultValue,
  required = true,
  min,
  max,
  step,
  value,
  onChange,
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block text-xs font-semibold text-[#334e68]">{label}</span>
      <input
        className={inputClass}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange ? (event) => onChange(event.currentTarget.value) : undefined}
        name={name}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-[#dce7e4] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold text-[#64748b]">{label}</p>
      <p className="mt-2 text-3xl font-bold text-[#102a43]">{value}</p>
    </div>
  );
}

function ActionMessage({ state }: { state: ActionState }) {
  if (state.error)
    return (
      <p className="mt-3 text-sm font-medium text-red-600" role="alert">
        {state.error}
      </p>
    );
  if (state.success)
    return (
      <p className="mt-3 text-sm font-medium text-green-700" role="status">
        {state.success}
      </p>
    );
  return null;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl bg-[#f6faf9] p-4 text-sm text-[#64748b]">{text}</p>;
}

function Badge({ children, tone }: { children: ReactNode; tone: "green" | "amber" | "gray" | "teal" }) {
  const tones = {
    green: "bg-[#e8f7ee] text-[#16803c]",
    amber: "bg-[#fff5df] text-[#a15c00]",
    gray: "bg-[#eef1f4] text-[#64748b]",
    teal: "bg-[#edf8f5] text-[#0f8f83]",
  } as const;
  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${tones[tone]}`}>
      {children}
    </span>
  );
}

function StatusButton({
  children,
  danger = false,
  disabled,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${danger ? "border-red-200 text-red-600" : "border-[#b9d9d2] text-[#0f756c]"}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
