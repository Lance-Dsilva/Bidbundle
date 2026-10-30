// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ProviderBusinessDetailsDialog } from "@/components/provider/ProviderBusinessDetailsDialog";
import type { CommonProfile, ProviderProfile } from "@/lib/profile-types";
import { SERVICE_CATEGORIES } from "@/lib/service-categories";

/**
 * The one provider business editor.
 *
 * The screen behind it shows licence, insurance, trades, address, and working
 * hours, so the button that opens this has to lead somewhere that edits all of
 * them — and the dialog has to be honest about what it *cannot* change.
 *
 * Three properties matter here: every editable field reaches the save, no
 * administrator-owned field does, and unsaved work is not thrown away by a
 * stray click on the backdrop.
 */

const PROFILE: CommonProfile = {
  id: "user-1",
  email: "pat@example.com",
  fullName: "Pat Rivera",
  phone: "+1 512 555 0100",
  role: "provider",
  isVerified: true,
  address: "1 Oak St",
  neighborhood: "North Austin",
  latitude: 30.4,
  longitude: -97.7,
  avatarUrl: null,
  avatarUpdatedAt: null,
  createdAt: "2026-01-02T03:04:05.000Z",
  communityRadiusMi: 4,
};

const PROVIDER: ProviderProfile = {
  companyName: "ProFix Plumbing",
  bio: "Two decades of drains.",
  trades: ["Plumbing"],
  serviceRadiusMi: 4,
  workingDays: ["mon"],
  workingHoursStart: "08:00",
  workingHoursEnd: "17:00",
  licenseNumber: "LIC-1",
  licenseState: "TX",
  insuranceProvider: "Acme Mutual",
  insurancePolicyNumber: "POL-1",
  isLicenseVerified: true,
  isInsuranceVerified: true,
  licenseVerifiedAt: "2026-02-01T00:00:00.000Z",
  insuranceVerifiedAt: "2026-02-01T00:00:00.000Z",
  payoutStatus: "active",
  payoutLast4: "4242",
  payoutProvider: "stripe",
  payoutUpdatedAt: "2026-02-01T00:00:00.000Z",
  notifyNewJobs: true,
  notifyMessages: true,
  notifyPayouts: true,
};

type Saved = { common: Record<string, unknown>; business: Record<string, unknown> };

function renderDialog(
  overrides: Partial<{
    saving: boolean;
    saveError: string | null;
    fieldErrors: Record<string, string>;
    onSaveResult: boolean;
    provider: ProviderProfile;
  }> = {},
) {
  const saves: Saved[] = [];
  const onClose = vi.fn();
  const onSave = vi.fn(async (common: unknown, business: unknown) => {
    saves.push({
      common: common as Record<string, unknown>,
      business: business as Record<string, unknown>,
    });
    return overrides.onSaveResult ?? true;
  });

  render(
    <ProviderBusinessDetailsDialog
      profile={PROFILE}
      provider={overrides.provider ?? PROVIDER}
      saving={overrides.saving ?? false}
      saveError={overrides.saveError ?? null}
      fieldErrors={overrides.fieldErrors ?? {}}
      uploadProgress={null}
      onChangeAvatar={() => {}}
      onClearAvatar={() => {}}
      onSave={onSave}
      onClose={onClose}
    />,
  );

  return { saves, onClose, onSave };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("provider business details editor", () => {
  it("does not silently discard a pending thirteenth service on save", () => {
    const { saves } = renderDialog({ provider: { ...PROVIDER, trades: SERVICE_CATEGORIES.slice(0, 12) } });
    fireEvent.change(screen.getByRole("combobox", { name: "Add a service" }), { target: { value: "landscaping" } });
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    expect(saves).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(/at most 12 services/i);
  });

  it("preserves unsupported legacy services visibly and requires explicit remediation", async () => {
    const { saves } = renderDialog({ provider: { ...PROVIDER, trades: ["Plumbing", "Drain clearing"] } });
    expect(screen.getByRole("button", { name: "Remove Drain clearing" })).toBeInTheDocument();
    expect(screen.getByText(/Your saved choices have not been removed automatically/i)).toBeInTheDocument();
    const choice = screen.getByRole("combobox", { name: "Add a service" });
    expect(within(choice).queryByRole("option", { name: "Drain clearing" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    expect(saves).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent(/Replace unsupported saved services/i);
    fireEvent.change(choice, { target: { value: "lawn" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Drain clearing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]!.business.trades).toEqual(["plumbing", "lawn"]);
  });

  it("edits every section and saves them together, with no admin-owned field", async () => {
    const { saves, onClose } = renderDialog();

    // All five sections are present and named, rather than one flat grid.
    for (const heading of [
      "Public business profile",
      "Services offered",
      "Business location",
      "Availability",
      "Credentials",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }

    fireEvent.change(screen.getByLabelText("Company name"), {
      target: { value: "ProFix & Co" },
    });
    fireEvent.change(screen.getByLabelText("Business address"), {
      target: { value: "9 Elm Ave" },
    });
    fireEvent.change(screen.getByLabelText("Closes at"), { target: { value: "18:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Wed" }));

    // Issue #7 replaces arbitrary free text with the shared category catalog.
    // Duplicate and empty selections still fail visibly, and saves use slugs.
    const tradeInput = screen.getByLabelText("Add a service");
    fireEvent.change(tradeInput, { target: { value: "plumbing" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/already on your list/i);

    fireEvent.change(tradeInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Choose a supported service/i);

    fireEvent.change(tradeInput, { target: { value: "lawn" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Remove Lawn care" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save business details" }));
    await waitFor(() => expect(saves).toHaveLength(1));

    expect(saves[0]!.common).toMatchObject({
      fullName: "Pat Rivera",
      phone: "+1 512 555 0100",
      address: "9 Elm Ave",
      neighborhood: "North Austin",
    });
    expect(saves[0]!.business).toMatchObject({
      companyName: "ProFix & Co",
      bio: "Two decades of drains.",
      trades: ["plumbing", "lawn"],
      workingDays: ["mon", "wed"],
      workingHoursStart: "08:00",
      workingHoursEnd: "18:30",
      licenseNumber: "LIC-1",
      licenseState: "TX",
      insuranceProvider: "Acme Mutual",
      insurancePolicyNumber: "POL-1",
    });

    // Nothing a provider must not own can ride along, even though the dialog
    // was handed the current values for display.
    const payload = JSON.stringify(saves[0]);
    for (const field of [
      "licenseVerifiedAt",
      "insuranceVerifiedAt",
      "isLicenseVerified",
      "payoutStatus",
      "payoutLast4",
      "accountStatus",
      "serviceRadiusMi",
    ]) {
      expect(payload, `${field} reached the save payload`).not.toContain(field);
    }

    // A successful save closes; the page owns the confirmation banner.
    expect(onClose).toHaveBeenCalled();
  });

  it("warns before discarding unsaved work, and only when there is some", () => {
    const { onClose } = renderDialog();

    // Clean form: the backdrop just closes.
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Changed" } });
    fireEvent.mouseDown(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent(/Discard your unsaved changes/i);

    // Keeping the edits leaves them in place.
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveValue("Changed");

    // Escape asks the same question, and discarding then closes.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the pending-review warning, the saving state, and a server failure", () => {
    const { onClose } = renderDialog({
      saving: true,
      saveError: "We could not save your changes.",
      fieldErrors: { licenseState: "Add the licence number this state belongs to." },
    });

    // Verified today, so editing the claim is a consequence worth stating.
    expect(screen.getByText(/licence verified/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Licence number"), { target: { value: "LIC-2" } });
    expect(screen.getByRole("status")).toHaveTextContent(/return your licence to pending review/i);

    // Only the licence is named: the untouched insurance is not implicated.
    expect(screen.getByRole("status")).not.toHaveTextContent(/insurance to pending/i);

    const saveButton = screen.getByRole("button", { name: "Saving…" });
    expect(saveButton).toBeDisabled();

    const alerts = screen.getAllByRole("alert").map((node) => node.textContent);
    expect(alerts).toContain("We could not save your changes.");
    expect(alerts).toContain("Add the licence number this state belongs to.");

    expect(onClose).not.toHaveBeenCalled();
  });
});
