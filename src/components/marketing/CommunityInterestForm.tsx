"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ApiError, apiFetch } from "@/lib/api";
import {
  COMMUNITY_INTEREST_ROLE_LABELS,
  communityInterestReceiptSchema,
  communityInterestSchema,
} from "@/lib/validation/community-interest";

type InterestDraft = {
  contactName: string;
  contactRole: string;
  communityName: string;
  numberOfHomes: string;
  email: string;
  phone: string;
};
const EMPTY: InterestDraft = {
  contactName: "", contactRole: "", communityName: "", numberOfHomes: "", email: "", phone: "",
};

export function CommunityInterestForm() {
  const [draft, setDraft] = useState<InterestDraft>(EMPTY);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [received, setReceived] = useState(false);
  const inFlight = useRef(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  useEffect(() => { if (received) successHeading.current?.focus(); }, [received]);

  const change = (name: keyof InterestDraft, value: string) => {
    setDraft((current) => ({ ...current, [name]: value }));
    setFields((current) => { const next = { ...current }; delete next[name]; return next; });
    setError(null);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || received) return;
    const parsed = communityInterestSchema.safeParse({
      ...draft,
      numberOfHomes: /^\d+$/.test(draft.numberOfHomes.trim()) ? Number(draft.numberOfHomes) : Number.NaN,
      phone: draft.phone.trim() || null,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? "form")] ??= issue.message;
      setFields(next);
      setError("Check the highlighted fields before sending your interest.");
      errorSummary.current?.focus();
      return;
    }
    inFlight.current = true;
    setPending(true);
    setFields({});
    setError(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await apiFetch<unknown>("/community-interest", {
        method: "POST", body: JSON.stringify(parsed.data), cache: "no-store", signal: controller.signal,
      });
      if (!communityInterestReceiptSchema.safeParse(result).success) throw new Error("We could not confirm receipt. Please try again.");
      if (mounted.current && !controller.signal.aborted) setReceived(true);
    } catch (caught) {
      if (!mounted.current || controller.signal.aborted) return;
      if (caught instanceof ApiError && caught.fields) {
        setFields(Object.fromEntries(Object.entries(caught.fields).filter(([key, value]) => key in EMPTY && typeof value === "string")));
      }
      setError(caught instanceof Error ? caught.message : "Your interest was not received. Please try again.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };

  if (received) return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm sm:p-8" aria-labelledby="community-interest-received">
      <h2 ref={successHeading} id="community-interest-received" tabIndex={-1} className="text-2xl font-semibold tracking-tight text-slate-900">Your community interest was received</h2>
      <p role="status" className="mt-4 text-sm leading-6 text-slate-600">Bundleen staff will review your interest and contact you about community setup. If your community proceeds, staff will send an invitation for manager access.</p>
      <p className="mt-3 text-sm leading-6 text-slate-600">This form has not created an account or given anyone community access.</p>
    </section>
  );

  return (
    <form className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" onSubmit={(event) => void submit(event)} noValidate aria-labelledby="community-interest-form-title" aria-busy={pending}>
      <h2 id="community-interest-form-title" className="text-xl font-semibold tracking-tight text-slate-900">Tell us about your community</h2>
      <fieldset disabled={pending} className="mt-6 grid min-w-0 gap-5 sm:grid-cols-2">
        <Input variant="warm" id="community-contact-name" label="Your name" autoComplete="name" value={draft.contactName} onChange={(event) => change("contactName", event.target.value)} error={fields.contactName} required />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="community-contact-role" className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">Your connection to the community</label>
          <select id="community-contact-role" className="min-h-11 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
            value={draft.contactRole} onChange={(event) => change("contactRole", event.target.value)} required aria-invalid={Boolean(fields.contactRole)} aria-describedby={fields.contactRole ? "community-contact-role-error" : undefined}>
            <option value="">Choose your connection</option>
            {Object.entries(COMMUNITY_INTEREST_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {fields.contactRole ? <p id="community-contact-role-error" role="alert" className="text-xs text-red-600">{fields.contactRole}</p> : null}
        </div>
        <Input variant="warm" id="community-name" label="Community name" value={draft.communityName} onChange={(event) => change("communityName", event.target.value)} error={fields.communityName} required />
        <Input variant="warm" id="community-home-count" label="Number of homes" inputMode="numeric" value={draft.numberOfHomes} onChange={(event) => change("numberOfHomes", event.target.value)} error={fields.numberOfHomes} required />
        <Input variant="warm" id="community-email" label="Email" type="email" autoComplete="email" value={draft.email} onChange={(event) => change("email", event.target.value)} error={fields.email} required />
        <Input variant="warm" id="community-phone" label="Phone (optional)" type="tel" autoComplete="tel" value={draft.phone} onChange={(event) => change("phone", event.target.value)} error={fields.phone} />
      </fieldset>
      <p className="mt-6 text-sm leading-6 text-slate-600">By sending this form, you are asking Bundleen staff to use these contact details to discuss community onboarding. Your connection to the community is self-reported; manager access is granted separately by invitation.</p>
      <Button className="mt-5 min-h-11 h-auto w-full rounded-xl px-4 py-3 text-sm sm:w-auto" type="submit" disabled={pending}
        onClick={(event) => { if (event.detail > 1) event.preventDefault(); }} variant="warm">
        <span className="grid">
          <span aria-hidden={pending} className={`col-start-1 row-start-1${pending ? " invisible" : ""}`}>Send community interest</span>
          <span aria-hidden={!pending} className={`col-start-1 row-start-1${pending ? "" : " invisible"}`}>Sending…</span>
        </span>
      </Button>
      <div className="mt-4 min-h-6">
        {error ? <p ref={errorSummary} tabIndex={-1} role="alert" className="text-sm leading-6 text-red-700">{error} Your entries are still here.</p>
          : pending ? <p role="status" className="text-sm leading-6 text-slate-600">Sending your community interest. Please wait.</p> : null}
      </div>
    </form>
  );
}
