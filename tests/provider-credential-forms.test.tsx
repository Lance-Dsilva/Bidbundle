// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderCredentialsPanel } from "@/components/provider/ProviderCredentialsPanel";
import { ProviderCredentialReview } from "@/components/admin/ProviderCredentialReview";
import { ProviderAdminControls } from "@/components/admin/ProviderAdminControls";
import { ProviderPolicyEditor } from "@/components/hoa/ProviderPolicyEditor";
import type { ProviderCredentials, ProviderCredentialRef } from "@/lib/provider-credential-types";
import type { ProviderDetail } from "@/lib/community-types";

const state = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("@/lib/admin-client", async (importActual) => ({
  ...await importActual<typeof import("@/lib/admin-client")>(), updateProvider: state.update,
}));

const fetchMock = vi.fn();
const NativeFormData = globalThis.FormData;
function credentials(): ProviderCredentials {
  return { license: null, insurance: null, licenseExpiresOn: null, insuranceExpiresOn: null,
    insuranceCoverageCents: null, insuranceAdditionalInsured: false, updatedAt: "2026-11-08T12:00:00Z" };
}
function evidence(kind = "license", id = "document-1"): ProviderCredentialRef {
  return { id, checksum: "a".repeat(64), reviewStatus: "pending", reviewReason: null,
    uploadedAt: "2026-11-08T10:00:00Z", url: `/api/provider/credentials/${id}` };
}
function reviewProps(kind: "license" | "insurance" = "license"): ComponentProps<typeof ProviderCredentialReview> {
  return { kind, details: [["Claim", "Provider-entered claim"]], document: evidence(kind), expiresOn: null,
    coverage: null, additionalInsured: false, verified: false, verifiedAt: null,
    expectedUpdatedAt: "2026-11-08T12:00:00Z", pending: false, onApply: vi.fn().mockResolvedValue(undefined) };
}
function provider(): ProviderDetail {
  return { userId: "provider-1", user: { id: "provider-1", fullName: "Example Provider", initials: "EP",
    email: "provider@example.invalid", role: "provider", avatarUrl: null },
    companyName: "Example company", trades: ["cleaning"], serviceArea: null,
    accountStatus: "active", accountStatusUpdatedAt: null, accountStatusUpdatedBy: null, accountStatusNote: null,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-11-08T12:00:00Z", bio: null, phone: null,
    licenseNumber: "LIC-1", licenseState: "TX", insuranceProvider: "Example Mutual", insurancePolicyNumber: "POL-1",
    isLicenseVerified: false, isInsuranceVerified: false, licenseVerifiedAt: null, licenseVerifiedBy: null,
    insuranceVerifiedAt: null, insuranceVerifiedBy: null, approvedCommunities: [], recentAudit: [],
    credentials: { ...credentials(), license: evidence() } };
}
function reviewForm() { return screen.getByRole("heading", { name: "License review" }).closest("form")!; }

beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => Response.json(credentials()));
  // jsdom does not transfer fireEvent's selected FileList into FormData(form).
  // Preserve native FormData behavior and supply that one missing browser step.
  vi.stubGlobal("FormData", class extends NativeFormData {
    constructor(form?: HTMLFormElement) {
      super(form);
      const file = form?.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0];
      if (file) this.set("file", file);
    }
  });
});

describe("HOA provider insurance policy form", () => {
  it("saves exact USD cents and the endorsement condition once, without credential authority fields", async () => {
    const policy = { minimumInsuranceCoverageCents: 100_000_000, requiresAdditionalInsured: false };
    let finish!: (response: Response) => void;
    const saving = new Promise<Response>((resolve) => { finish = resolve; });
    fetchMock.mockImplementation(async (_url, options) => options?.method === "PATCH" ? saving : Response.json(policy));
    const onSaved = vi.fn(); render(<ProviderPolicyEditor communityId="hoa-1" onSaved={onSaved} />);
    const minimum = screen.getByLabelText(/Minimum insurance coverage \(USD\)/);
    await waitFor(() => expect(minimum).toBeEnabled());
    expect(minimum).toHaveValue("1000000.00");
    fireEvent.change(minimum, { target: { value: "1000000.25" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Require an additional-insured endorsement/ }));
    const form = minimum.closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    const patches = fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0][0]).toBe("/api/hoa/communities/hoa-1/provider-policy");
    expect(JSON.parse(patches[0][1].body)).toEqual({ minimumInsuranceCoverageCents: 100_000_025, requiresAdditionalInsured: true });
    await act(async () => { finish(Response.json(policy)); });
    expect(await screen.findByRole("status")).toHaveTextContent("Provider requirements saved");
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("does not offer a policy mutation when the current actor lacks access", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Forbidden" }, { status: 403 }));
    render(<ProviderPolicyEditor communityId="hoa-1" />);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Provider insurance requirements" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Save provider requirements" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("provider document upload form", () => {
  it("enforces the 4 MiB hosted-request limit before any upload", async () => {
    render(<ProviderCredentialsPanel onUpdated={vi.fn()} />);
    const input = screen.getByLabelText("Upload license document");
    await waitFor(() => expect(input).toBeEnabled());
    expect(screen.getByText(/PDF, JPEG, PNG or WebP/)).toHaveTextContent("up to 4 MiB");
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(4 * 1024 * 1024 + 1)], "license.pdf")] } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("4 MiB");
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  });

  it("submits one evidence file and kind despite duplicate submission, then refreshes review state", async () => {
    let finish!: (response: Response) => void;
    const upload = new Promise<Response>((resolve) => { finish = resolve; });
    fetchMock.mockImplementation(async (_url, options) => options?.method === "POST" ? upload : Response.json(credentials()));
    const onUpdated = vi.fn(); render(<ProviderCredentialsPanel onUpdated={onUpdated} />);
    const input = screen.getByLabelText("Upload license document");
    await waitFor(() => expect(input).toBeEnabled());
    const file = new File(["%PDF-1.7\n%%EOF"], "license.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });
    const form = input.closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    const posts = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][1]).toMatchObject({ credentials: "same-origin" });
    const sent = posts[0][1].body as FormData;
    expect([...sent.keys()].sort()).toEqual(["file", "kind"]);
    expect(sent.get("kind")).toBe("license"); expect(sent.get("file")).toBeInstanceOf(File);
    expect(input).toBeDisabled();
    await act(async () => { finish(Response.json({}, { status: 201 })); });
    expect(await screen.findByRole("status")).toHaveTextContent("License document uploaded for review");
    expect(onUpdated).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.filter(([, options]) => !options?.method)).toHaveLength(2);
  });

  it("shows a rejected review note and only its authorized download path", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...credentials(), license: {
      ...evidence(), reviewStatus: "rejected", reviewReason: "Upload a readable current license.",
    } }));
    render(<ProviderCredentialsPanel onUpdated={vi.fn()} />);
    expect(await screen.findByText(/Review note:/)).toHaveTextContent("Upload a readable current license.");
    expect(screen.getByRole("link", { name: "Download current license document" })).toHaveAttribute("href", "/api/provider/credentials/document-1");
    expect(screen.getByText(/Rejected — replacement needed/)).toBeInTheDocument();
  });
});

describe("staff document review form", () => {
  it("keeps operations staff account and support controls while hiding private review and download actions", () => {
    render(<ProviderAdminControls initialProvider={{ ...provider(), credentials: null }} />);
    expect(screen.getByRole("heading", { name: "Account status" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Provider communication" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create ticket" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Change history" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Credential verification" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download current .* document/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve license|Approve insurance|Revoke approval/ })).not.toBeInTheDocument();
  });

  it("requires acknowledgement and submits the exact current document, checksum, expiry and version", async () => {
    const props = reviewProps(); render(<ProviderCredentialReview {...props} />);
    const form = screen.getByRole("heading", { name: "License review" }).closest("form")!;
    fireEvent.change(screen.getByLabelText(/Valid through \(UTC date\)/), { target: { value: "2099-01-01" } });
    fireEvent.submit(form);
    expect(screen.getByRole("alert")).toHaveTextContent("review the current document");
    expect(props.onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this current document/ }));
    fireEvent.submit(form);
    await waitFor(() => expect(props.onApply).toHaveBeenCalledWith({ license: "verify", licenseDocumentId: "document-1",
      licenseDocumentChecksum: "a".repeat(64), licenseExpiresOn: "2099-01-01", expectedUpdatedAt: props.expectedUpdatedAt }, undefined));
  });

  it("converts reviewed USD coverage to exact integer cents and explicitly sends the endorsement decision", async () => {
    const props = reviewProps("insurance"); render(<ProviderCredentialReview {...props} />);
    fireEvent.change(screen.getByLabelText(/Valid through \(UTC date\)/), { target: { value: "2099-01-01" } });
    fireEvent.change(screen.getByLabelText("Reviewed coverage (USD)"), { target: { value: "1000000.25" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Additional-insured endorsement/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed this current document/ }));
    fireEvent.submit(screen.getByRole("heading", { name: "Insurance review" }).closest("form")!);
    await waitFor(() => expect(props.onApply).toHaveBeenCalledWith(expect.objectContaining({ insurance: "verify",
      insuranceDocumentId: "document-1", insuranceDocumentChecksum: "a".repeat(64), insuranceExpiresOn: "2099-01-01",
      insuranceCoverageCents: 100_000_025, insuranceAdditionalInsured: true, expectedUpdatedAt: props.expectedUpdatedAt }), undefined));
  });

  it("requires a reason for rejection and binds it to the reviewed document", async () => {
    const props = reviewProps(); render(<ProviderCredentialReview {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject document" }));
    expect(screen.getByRole("alert")).toHaveTextContent("reason"); expect(props.onApply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Review reason (required to reject)"), { target: { value: "  This document names another provider.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Reject document" }));
    await waitFor(() => expect(props.onApply).toHaveBeenCalledWith({ license: "reject", note: "This document names another provider.",
      licenseDocumentId: "document-1", licenseDocumentChecksum: "a".repeat(64), expectedUpdatedAt: props.expectedUpdatedAt }, undefined));
  });

  it("allows revoking a historical timestamp without allowing approval without a current document", async () => {
    const props = { ...reviewProps(), document: null, verifiedAt: "2026-01-01T00:00:00Z" };
    render(<ProviderCredentialReview {...props} />);
    expect(screen.getByRole("button", { name: "Approve license" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke previous verification" }));
    await waitFor(() => expect(props.onApply).toHaveBeenCalledWith({ license: "revoke", expectedUpdatedAt: props.expectedUpdatedAt }, expect.stringContaining("Revoke")));
  });

  it("resets the acknowledgement when a reload reveals replacement evidence and uses its new version", async () => {
    const next = provider(); next.updatedAt = "2026-11-08T12:01:00Z";
    next.credentials = { ...credentials(), updatedAt: next.updatedAt, license: { ...evidence("license", "document-2"), checksum: "b".repeat(64) } };
    fetchMock.mockResolvedValueOnce(Response.json(next));
    state.update.mockResolvedValue({ ...next, changed: true });
    render(<ProviderAdminControls initialProvider={provider()} />);
    fireEvent.click(within(reviewForm()).getByRole("checkbox", { name: /I reviewed this current document/ }));
    fireEvent.change(within(reviewForm()).getByLabelText(/Valid through \(UTC date\)/), { target: { value: "2099-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Reload provider & documents" }));
    await screen.findByText(/Current provider and document review loaded/);
    const current = within(reviewForm());
    expect(current.getByRole("link", { name: "Download current license document" })).toHaveAttribute("href", "/api/provider/credentials/document-2");
    expect(current.getByRole("checkbox", { name: /I reviewed this current document/ })).not.toBeChecked();
    fireEvent.submit(reviewForm());
    expect(screen.getByRole("alert")).toHaveTextContent("review the current document");
    expect(state.update).not.toHaveBeenCalled();
    fireEvent.click(current.getByRole("checkbox", { name: /I reviewed this current document/ }));
    fireEvent.change(current.getByLabelText(/Valid through \(UTC date\)/), { target: { value: "2099-01-01" } });
    fireEvent.submit(reviewForm());
    await waitFor(() => expect(state.update).toHaveBeenCalledExactlyOnceWith("provider-1", {
      license: "verify", licenseDocumentId: "document-2", licenseDocumentChecksum: "b".repeat(64),
      licenseExpiresOn: "2099-01-01", expectedUpdatedAt: next.updatedAt,
    }));
  });
});
