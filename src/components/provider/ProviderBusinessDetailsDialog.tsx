"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { AvatarField } from "@/components/profile/AvatarField";
import type { CommonProfile, ProviderProfile } from "@/lib/profile-types";
import {
  MAX_BIO_LENGTH,
  MAX_TRADES,
  MAX_TRADE_LENGTH,
  WEEKDAYS,
  type CommonProfileUpdate,
  type ProviderProfileUpdate,
  type Weekday,
} from "@/lib/validation/profile";

/**
 * The one editor for everything a provider owns about their business.
 *
 * There is deliberately no second route or modal: this is the same
 * `PUT /api/profile/provider` save the page already used, reorganized into the
 * five things a provider actually thinks about — who they are publicly, what
 * they do, where they are based, when they work, and what they claim to hold.
 * The previous version was one undifferentiated ten-input grid, which is why
 * the licence and insurance fields read as afterthoughts.
 *
 * What it deliberately cannot do: touch verification, payout, or account
 * status. Those are absent from the payload because they are absent from
 * `providerProfileUpdateSchema`, and the server would reject them anyway.
 */

const DAY_LABELS: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

const inputStyle: CSSProperties = {
  height: 44,
  width: "100%",
  borderRadius: 12,
  border: "1px solid var(--border-warm)",
  padding: "0 12px",
  fontSize: 14,
  color: "var(--ink-900)",
  fontFamily: "var(--font-body)",
  background: "var(--bg-card)",
  boxSizing: "border-box",
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.10em",
  color: "var(--ink-500)",
  fontWeight: 700,
};

const ghostButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 44,
  padding: "0 18px",
  borderRadius: 999,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  background: "transparent",
  color: "var(--ink-700)",
  border: "1px solid var(--border-warm-strong)",
  fontFamily: "var(--font-body)",
};

const primaryButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  background: "var(--terracotta-600)",
  color: "white",
  border: 0,
};

/** Every field the dialog may write, across both halves of the save. */
export type BusinessForm = {
  fullName: string;
  phone: string;
  address: string;
  neighborhood: string;
  companyName: string;
  bio: string;
  trades: string[];
  workingDays: Weekday[];
  workingHoursStart: string;
  workingHoursEnd: string;
  licenseNumber: string;
  licenseState: string;
  insuranceProvider: string;
  insurancePolicyNumber: string;
};

export function formFromProfile(
  profile: CommonProfile,
  provider: ProviderProfile,
): BusinessForm {
  return {
    fullName: profile.fullName,
    phone: profile.phone ?? "",
    address: profile.address ?? "",
    neighborhood: profile.neighborhood ?? "",
    companyName: provider.companyName ?? "",
    bio: provider.bio ?? "",
    trades: [...provider.trades],
    workingDays: [...provider.workingDays],
    workingHoursStart: provider.workingHoursStart ?? "",
    workingHoursEnd: provider.workingHoursEnd ?? "",
    licenseNumber: provider.licenseNumber ?? "",
    licenseState: provider.licenseState ?? "",
    insuranceProvider: provider.insuranceProvider ?? "",
    insurancePolicyNumber: provider.insurancePolicyNumber ?? "",
  };
}

type DialogProps = {
  profile: CommonProfile;
  provider: ProviderProfile;
  saving: boolean;
  saveError: string | null;
  fieldErrors: Record<string, string>;
  uploadProgress: number | null;
  onChangeAvatar: (file: File) => void;
  onClearAvatar: () => void;
  onSave: (
    common: CommonProfileUpdate,
    business: ProviderProfileUpdate,
  ) => Promise<boolean>;
  onClose: () => void;
};

function Section({
  title,
  hint,
  children,
}: Readonly<{ title: string; hint?: string; children: ReactNode }>) {
  return (
    <section style={{ borderTop: "1px solid var(--border-warm)", paddingTop: 18, marginTop: 18 }}>
      <h3
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: 16,
          fontWeight: 600,
          color: "var(--ink-900)",
        }}
      >
        {title}
      </h3>
      {hint ? (
        <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-500)", lineHeight: 1.5 }}>
          {hint}
        </p>
      ) : null}
      <div style={{ marginTop: 14 }}>{children}</div>
    </section>
  );
}

function FieldError({ message }: Readonly<{ message?: string }>) {
  if (!message) return null;
  return (
    <span role="alert" style={{ fontSize: 12, color: "var(--danger-600)" }}>
      {message}
    </span>
  );
}

export function ProviderBusinessDetailsDialog({
  profile,
  provider,
  saving,
  saveError,
  fieldErrors,
  uploadProgress,
  onChangeAvatar,
  onClearAvatar,
  onSave,
  onClose,
}: DialogProps) {
  const reactId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const tradeInputRef = useRef<HTMLInputElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const discardOpenerRef = useRef<Element | null>(null);
  const mountedRef = useRef(false);
  const saveInFlightRef = useRef(false);
  /** Where focus came from, so closing puts it back. */
  const openerRef = useRef<Element | null>(null);

  const initial = useMemo(() => formFromProfile(profile, provider), [profile, provider]);
  const [form, setForm] = useState<BusinessForm>(initial);
  const [tradeDraft, setTradeDraft] = useState("");
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localSaveError, setLocalSaveError] = useState<string | null>(null);
  const busy = saving || submitting;

  const isDirty = useMemo(
    () => Boolean(tradeDraft.trim()) || JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial, tradeDraft],
  );

  const set = <Key extends keyof BusinessForm>(key: Key, value: BusinessForm[Key]) => {
    if (saveInFlightRef.current || busy) return;
    setForm((current) => ({ ...current, [key]: value }));
  };

  /** Closing with unsaved edits asks first; a clean form just closes. */
  const requestClose = useCallback(() => {
    if (saveInFlightRef.current || busy || confirmingDiscard) return;
    if (isDirty) {
      discardOpenerRef.current = document.activeElement;
      setConfirmingDiscard(true);
      return;
    }
    onClose();
  }, [busy, confirmingDiscard, isDirty, onClose]);

  useEffect(() => {
    mountedRef.current = true;
    openerRef.current = document.activeElement;
    firstFieldRef.current?.focus();
    return () => {
      mountedRef.current = false;
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, []);

  const keepEditing = useCallback(() => {
    setConfirmingDiscard(false);
  }, []);

  useEffect(() => {
    if (confirmingDiscard) {
      keepEditingRef.current?.focus();
    } else if (busy) {
      dialogRef.current?.focus();
    } else if (discardOpenerRef.current instanceof HTMLElement) {
      // Restore after the disabled fieldset has been enabled by this render.
      discardOpenerRef.current.focus();
      discardOpenerRef.current = null;
    }
  }, [busy, confirmingDiscard]);

  /**
   * Escape closes, and Tab cycles inside the dialog.
   *
   * Without the cycle, tabbing walks out into the page behind the overlay,
   * which is both confusing and a way to edit something you cannot see.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmingDiscard) keepEditing();
        else requestClose();
        return;
      }
      const activeDialog = confirmingDiscard ? discardRef.current : dialogRef.current;
      if (event.key !== "Tab" || !activeDialog) return;

      const focusable = [
        ...activeDialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null && !element.matches(":disabled"));
      if (focusable.length === 0) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (document.activeElement === activeDialog || !activeDialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmingDiscard, keepEditing, requestClose]);

  /* ── Trades ────────────────────────────────────────────────────────────── */

  function validateTrade(raw: string): string | null {
    const trade = raw.trim();
    if (!trade) return "Enter a service before adding it.";
    if (trade.length > MAX_TRADE_LENGTH) {
      return `Keep each service under ${MAX_TRADE_LENGTH} characters.`;
    }
    if (form.trades.some((existing) => existing.toLowerCase() === trade.toLowerCase())) {
      return `${trade} is already on your list.`;
    }
    if (form.trades.length >= MAX_TRADES) {
      return `You can list at most ${MAX_TRADES} services.`;
    }
    return null;
  }

  function addTrade(raw: string) {
    if (saveInFlightRef.current || busy) return;
    const error = validateTrade(raw);
    setTradeError(error);
    if (error) {
      tradeInputRef.current?.focus();
      return;
    }
    setTradeDraft("");
    set("trades", [...form.trades, raw.trim()]);
  }

  /* ── Save ──────────────────────────────────────────────────────────────── */

  async function handleSave() {
    if (saveInFlightRef.current || busy || confirmingDiscard) return;
    // Save and Add must validate the same draft rather than silently dropping it.
    const pending = tradeDraft.trim();
    const error = pending ? validateTrade(pending) : null;
    setTradeError(error);
    if (error) {
      tradeInputRef.current?.focus();
      return;
    }
    const trades = pending ? [...form.trades, pending] : form.trades;

    saveInFlightRef.current = true;
    setSubmitting(true);
    setLocalSaveError(null);
    try {
      const saved = await onSave(
        {
          fullName: form.fullName.trim(),
          phone: form.phone.trim() || null,
          address: form.address.trim() || null,
          neighborhood: form.neighborhood.trim() || null,
        },
        {
          companyName: form.companyName.trim() || null,
          bio: form.bio.trim() || null,
          trades,
          workingDays: form.workingDays,
          workingHoursStart: form.workingHoursStart || null,
          workingHoursEnd: form.workingHoursEnd || null,
          licenseNumber: form.licenseNumber.trim() || null,
          licenseState: form.licenseState.trim() || null,
          insuranceProvider: form.insuranceProvider.trim() || null,
          insurancePolicyNumber: form.insurancePolicyNumber.trim() || null,
        },
      );
      // An externally unmounted editor must never close a newer editor instance.
      if (saved && mountedRef.current) onClose();
    } catch {
      if (mountedRef.current) {
        setLocalSaveError("We couldn't save your business details. Please try again.");
      }
    } finally {
      saveInFlightRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }

  const licenceClaimChanged =
    provider.isLicenseVerified &&
    (form.licenseNumber.trim() !== (provider.licenseNumber ?? "") ||
      form.licenseState.trim() !== (provider.licenseState ?? ""));
  const insuranceClaimChanged =
    provider.isInsuranceVerified &&
    (form.insuranceProvider.trim() !== (provider.insuranceProvider ?? "") ||
      form.insurancePolicyNumber.trim() !== (provider.insurancePolicyNumber ?? ""));

  const titleId = `${reactId}-title`;
  const descriptionId = `${reactId}-description`;

  const textField = (
    key: keyof BusinessForm,
    label: string,
    options: { ref?: typeof firstFieldRef; type?: string; placeholder?: string } = {},
  ) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <input
        ref={options.ref}
        type={options.type ?? "text"}
        placeholder={options.placeholder}
        style={inputStyle}
        value={form[key] as string}
        onChange={(event) => set(key, event.target.value as BusinessForm[typeof key])}
      />
      <FieldError message={fieldErrors[key]} />
    </label>
  );

  return (
    <div
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      className="p-3 sm:p-6"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,16,12,0.32)",
        display: "grid",
        placeItems: "center",
        // Leaflet's panes deliberately use z-index values up to 800. Keep the
        // modal in a higher page-level layer so an underlying coverage map can
        // never paint through its backdrop or over its form fields.
        zIndex: 1000,
        overflowY: "auto",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        aria-hidden={confirmingDiscard || undefined}
        tabIndex={-1}
        className="p-4 sm:p-6"
        style={{
          width: "min(820px, 100%)",
          maxHeight: "92vh",
          overflowY: "auto",
          background: "var(--bg-card)",
          borderRadius: 22,
          border: "1px solid var(--border-warm)",
          boxShadow: "var(--shadow-warm-lg)",
        }}
      >
        <fieldset
          disabled={busy || confirmingDiscard}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2
              id={titleId}
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: 22,
                fontWeight: 500,
                color: "var(--ink-900)",
              }}
            >
              Edit business details
            </h2>
            <p id={descriptionId} style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-500)", lineHeight: 1.5 }}>
              Everything here is yours to change. Verification, payouts, and account status are set
              by Bundleen and are not editable.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={requestClose}
            style={{
              background: "transparent",
              border: 0,
              fontSize: 24,
              lineHeight: 1,
              cursor: "pointer",
              color: "var(--ink-500)",
              width: 44,
              height: 44,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* ── 1. Public business profile ──────────────────────────────── */}
        <Section
          title="Public business profile"
          hint="What customers see next to your quotes."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <AvatarField
              url={profile.avatarUrl}
              name={form.companyName || form.fullName}
              progress={uploadProgress}
              onSelect={onChangeAvatar}
              onRemove={onClearAvatar}
              disabled={busy || confirmingDiscard}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {textField("companyName", "Company name", { ref: firstFieldRef })}
              {textField("fullName", "Your name")}
              {textField("phone", "Phone", { type: "tel" })}
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>Bio</span>
              <textarea
                value={form.bio}
                maxLength={MAX_BIO_LENGTH}
                onChange={(event) => set("bio", event.target.value)}
                rows={5}
                placeholder="Your specialties, experience, and what customers can expect."
                style={{
                  borderRadius: 12,
                  border: "1px solid var(--border-warm)",
                  padding: 12,
                  fontSize: 14,
                  color: "var(--ink-900)",
                  fontFamily: "var(--font-body)",
                  resize: "vertical",
                  background: "var(--bg-card)",
                }}
              />
              <span style={{ fontSize: 11, color: "var(--ink-400)" }}>
                {form.bio.length}/{MAX_BIO_LENGTH}
              </span>
              <FieldError message={fieldErrors.bio} />
            </label>
          </div>
        </Section>

        {/* ── 2. Services offered ─────────────────────────────────────── */}
        <Section
          title="Services offered"
          hint="Bundleen only shows you requests that match one of these."
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {form.trades.length === 0 ? (
              <span style={{ fontSize: 13, color: "var(--ink-500)" }}>
                No services yet. Add at least one to appear in matching.
              </span>
            ) : (
              form.trades.map((trade) => (
                <span
                  key={trade}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 32,
                    padding: "0 6px 0 12px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 600,
                    background: "var(--terracotta-50)",
                    color: "var(--terracotta-600)",
                  }}
                >
                  {trade}
                  <button
                    type="button"
                    aria-label={`Remove ${trade}`}
                    onClick={() =>
                      set(
                        "trades",
                        form.trades.filter((value) => value !== trade),
                      )
                    }
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 999,
                      border: 0,
                      background: "transparent",
                      color: "inherit",
                      cursor: "pointer",
                      fontSize: 16,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px" }}>
              <span style={labelStyle}>Add a service</span>
              <input
                type="text"
                style={inputStyle}
                ref={tradeInputRef}
                value={tradeDraft}
                maxLength={MAX_TRADE_LENGTH}
                placeholder="Lawn care"
                onChange={(event) => {
                  setTradeDraft(event.target.value);
                  setTradeError(null);
                }}
                onKeyDown={(event) => {
                  // Enter or comma commits, so a list can be typed without
                  // reaching for the mouse.
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    addTrade(tradeDraft);
                  }
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => addTrade(tradeDraft)}
              style={{ ...ghostButtonStyle, alignSelf: "flex-end" }}
            >
              Add
            </button>
          </div>
          <div style={{ marginTop: 6 }}>
            <FieldError message={tradeError ?? fieldErrors.trades} />
          </div>
        </Section>

        {/* ── 3. Business location ────────────────────────────────────── */}
        <Section
          title="Business location"
          hint="Where you are based. The area you travel to is set by the service-area map on this page, not here."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {textField("address", "Business address")}
            {textField("neighborhood", "Neighborhood")}
          </div>
        </Section>

        {/* ── 4. Availability ─────────────────────────────────────────── */}
        <Section title="Availability" hint="Shown to customers deciding when to ask for you.">
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend style={{ ...labelStyle, padding: 0 }}>Working days</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {WEEKDAYS.map((day) => {
                const selected = form.workingDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      set(
                        "workingDays",
                        selected
                          ? form.workingDays.filter((value) => value !== day)
                          : [...form.workingDays, day],
                      )
                    }
                    style={{
                      height: 44,
                      minWidth: 56,
                      padding: "0 14px",
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "var(--font-body)",
                      background: selected ? "var(--terracotta-600)" : "var(--cream-100)",
                      color: selected ? "white" : "var(--ink-800)",
                      border: selected
                        ? "1px solid var(--terracotta-600)"
                        : "1px solid var(--border-warm)",
                    }}
                  >
                    {DAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>Opens at</span>
              <input
                type="time"
                style={inputStyle}
                value={form.workingHoursStart}
                onChange={(event) => set("workingHoursStart", event.target.value)}
              />
              <FieldError message={fieldErrors.workingHoursStart} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={labelStyle}>Closes at</span>
              <input
                type="time"
                style={inputStyle}
                value={form.workingHoursEnd}
                onChange={(event) => set("workingHoursEnd", event.target.value)}
              />
              <FieldError message={fieldErrors.workingHoursEnd} />
            </label>
          </div>
        </Section>

        {/* ── 5. Credentials ──────────────────────────────────────────── */}
        <Section
          title="Credentials"
          hint="What you claim to hold. Bundleen checks these before any badge appears — filling a field in never verifies it."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {textField("licenseNumber", "Licence number")}
            {textField("licenseState", "Licence state")}
            {textField("insuranceProvider", "Insurance provider")}
            {textField("insurancePolicyNumber", "Insurance policy number")}
          </div>

          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--ink-500)", lineHeight: 1.5 }}>
              Currently{" "}
              <strong style={{ color: "var(--ink-900)" }}>
                {provider.isLicenseVerified ? "licence verified" : "licence not verified"}
              </strong>{" "}
              and{" "}
              <strong style={{ color: "var(--ink-900)" }}>
                {provider.isInsuranceVerified ? "insurance verified" : "insurance not verified"}
              </strong>
              . Changing a verified claim sends that one credential back for review; the other is
              unaffected.
            </p>
            {licenceClaimChanged || insuranceClaimChanged ? (
              <p
                role="status"
                style={{
                  margin: 0,
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "var(--gold-50)",
                  color: "var(--gold-600)",
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1.5,
                }}
              >
                Saving will return your{" "}
                {licenceClaimChanged && insuranceClaimChanged
                  ? "licence and insurance"
                  : licenceClaimChanged
                    ? "licence"
                    : "insurance"}{" "}
                to pending review.
              </p>
            ) : null}
          </div>
        </Section>

        {localSaveError || saveError ? (
          <div
            role="alert"
            style={{
              marginTop: 18,
              padding: "10px 14px",
              borderRadius: 12,
              background: "rgba(182,68,48,0.08)",
              border: "1px solid rgba(182,68,48,0.24)",
              fontSize: 13,
              color: "var(--danger-600)",
            }}
          >
            {localSaveError || saveError}
          </div>
        ) : null}

        <div
          className="flex flex-col gap-2.5 sm:flex-row sm:justify-end"
          style={{ marginTop: 22 }}
        >
          <button type="button" onClick={requestClose} style={ghostButtonStyle} disabled={busy || confirmingDiscard}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || confirmingDiscard}
            style={{ ...primaryButtonStyle, opacity: busy ? 0.7 : 1, cursor: busy ? "default" : "pointer" }}
          >
            {busy ? "Saving…" : "Save business details"}
          </button>
        </div>
        </fieldset>
      </div>
      {confirmingDiscard ? (
        <div style={{ position: "fixed", inset: 0, zIndex: 1, display: "grid", placeItems: "center", padding: 12, background: "rgba(20,16,12,0.32)" }}>
          <div
            ref={discardRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${reactId}-discard-title`}
            tabIndex={-1}
            style={{ width: "min(420px, 100%)", maxHeight: "92vh", overflowY: "auto", padding: "20px", borderRadius: 14, background: "var(--cream-50)", border: "1px solid var(--border-warm)", boxShadow: "var(--shadow-warm-lg)" }}
          >
            <p id={`${reactId}-discard-title`} style={{ margin: 0, fontSize: 13, color: "var(--ink-900)", fontWeight: 600 }}>
              Discard your unsaved changes?
            </p>
            <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
              <button ref={keepEditingRef} type="button" onClick={keepEditing} style={ghostButtonStyle}>
                Keep editing
              </button>
              <button type="button" onClick={() => { if (!saveInFlightRef.current && !busy) onClose(); }} style={{ ...ghostButtonStyle, color: "var(--danger-600)", borderColor: "rgba(182,68,48,0.3)" }}>
                Discard
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
