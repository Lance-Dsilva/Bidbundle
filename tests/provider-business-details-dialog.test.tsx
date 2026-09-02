// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ProviderBusinessDetailsDialog } from "@/components/provider/ProviderBusinessDetailsDialog";
import type { CommonProfile, ProviderProfile } from "@/lib/profile-types";

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

    // Trades are chips, so a duplicate and a blank are refused where the
    // provider can see it rather than silently dropped by the server.
    const tradeInput = screen.getByLabelText("Add a service");
    fireEvent.change(tradeInput, { target: { value: "plumbing" } });
    fireEvent.keyDown(tradeInput, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent(/already on your list/i);

    fireEvent.change(tradeInput, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Enter a service/i);

    fireEvent.change(tradeInput, { target: { value: "Drain clearing" } });
    fireEvent.keyDown(tradeInput, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Remove Drain clearing" })).toBeInTheDocument();

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
      trades: ["Plumbing", "Drain clearing"],
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
