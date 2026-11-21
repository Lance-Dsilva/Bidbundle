// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => { process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fixture"; return { setup: vi.fn(), savedSetup: vi.fn(), fetch: vi.fn() }; });
vi.mock("@stripe/stripe-js", () => ({ loadStripe: () => Promise.resolve({}) }));
vi.mock("@stripe/react-stripe-js", () => ({ Elements: ({ children }: { children: React.ReactNode }) => children, PaymentElement: () => <div>Secure card fields</div>, useStripe: () => ({ confirmSetup: m.setup, confirmCardSetup: m.savedSetup }), useElements: () => ({}) }));
import { EnrollmentBilling } from "@/components/billing/EnrollmentBilling";
const offer = { title: "Pool service", scope: "Full term service", maximumCents: 12000, currency: "usd", totalOccurrences: 3, recurrenceLabel: "Monthly", termsToken: "a".repeat(64) };
const ok = (body: unknown) => ({ ok: true, json: async () => body });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function start() { render(<EnrollmentBilling requestId="request" offer={offer} />); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save card and join" })); await screen.findByText("Secure card fields"); }
it("requires explicit capped full-term consent and never announces enrollment after setup alone", async () => {
  m.fetch.mockResolvedValue(ok({ clientSecret: "setup" })); render(<EnrollmentBilling requestId="request" offer={offer} />);
  expect(screen.getByRole("button", { name: "Save card and join" })).toBeDisabled(); expect(screen.getByText(/Maximum \$120.00 for the full service term/)).toBeTruthy();
  expect(screen.getByText(/No charge if the group/)).toBeTruthy(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save card and join" }));
  await screen.findByText("Secure card fields"); expect(screen.queryByRole("status")).toBeNull();
  expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toMatchObject({ action: "start", accepted: true, termsToken: offer.termsToken });
});
it("retries atomic enrollment without confirming the saved card twice", async () => {
  m.fetch.mockResolvedValueOnce(ok({ clientSecret: "setup" })).mockRejectedValueOnce(new Error("Network interrupted")).mockResolvedValueOnce(ok({ joined: true }));
  m.setup.mockResolvedValue({ setupIntent: { id: "seti_fixture", status: "succeeded" } }); await start();
  const button = screen.getByRole("button", { name: "Confirm card and join" }); fireEvent.click(button); await screen.findByText("Network interrupted"); fireEvent.click(button);
  expect(await screen.findByRole("status")).toHaveTextContent("nothing has been charged"); expect(m.setup).toHaveBeenCalledTimes(1);
  expect(m.fetch.mock.calls[1][1].body).toBe(m.fetch.mock.calls[2][1].body);
});
it("does not join when Stripe fails to verify the card", async () => {
  m.fetch.mockResolvedValueOnce(ok({ clientSecret: "setup" })); m.setup.mockResolvedValue({ error: { message: "Card setup failed" } }); await start();
  fireEvent.click(screen.getByRole("button", { name: "Confirm card and join" })); expect(await screen.findByRole("alert")).toHaveTextContent("Card setup failed");
  expect(m.fetch).toHaveBeenCalledTimes(1); expect(screen.queryByRole("status")).toBeNull();
});
it("does not claim enrollment if capacity closes during card setup", async () => {
  m.fetch.mockResolvedValueOnce(ok({ clientSecret: "setup" })).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "This service has reached its maximum number of homes." }) });
  m.setup.mockResolvedValue({ setupIntent: { id: "seti_fixture", status: "succeeded" } }); await start(); fireEvent.click(screen.getByRole("button", { name: "Confirm card and join" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("maximum number"); expect(screen.queryByRole("status")).toBeNull();
});

it("requires new consent for saved-card selection and completes bank verification before join", async () => {
 m.fetch.mockResolvedValueOnce(ok({ clientSecret: "new_secret", usingSavedCard: true })).mockResolvedValueOnce(ok({ joined: true }));
 m.savedSetup.mockResolvedValue({ setupIntent: { id: "seti_new", status: "succeeded" } });
 render(<EnrollmentBilling requestId="request" offer={{ ...offer, savedCards: [{ reference: "b".repeat(64), brand: "visa", last4: "4242" }] }} />);
 fireEvent.click(screen.getByRole("checkbox")); fireEvent.change(screen.getByRole("combobox"), { target: { value: "b".repeat(64) } });
 expect(screen.getByRole("button", { name: "Save card and join" })).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save card and join" }));
 await screen.findByText(/Your saved card will be verified/); expect(screen.queryByText("Secure card fields")).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Confirm card and join" }));
 await screen.findByRole("status"); expect(m.savedSetup).toHaveBeenCalledWith("new_secret"); expect(m.setup).not.toHaveBeenCalled();
 expect(JSON.parse(m.fetch.mock.calls[1][1].body)).toMatchObject({ action: "join", setupIntentId: "seti_new" });
});
it("saved-card bank verification failure never joins", async () => {
 m.fetch.mockResolvedValue(ok({ clientSecret: "new_secret", usingSavedCard: true }));
 m.savedSetup.mockResolvedValue({ error: { message: "Verification cancelled" } });
 render(<EnrollmentBilling requestId="request" offer={{ ...offer, savedCards: [{ reference: "b".repeat(64), brand: "visa", last4: "4242" }] }} />);
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "b".repeat(64) } }); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save card and join" }));
 await screen.findByText(/Your saved card will be verified/); fireEvent.click(screen.getByRole("button", { name: "Confirm card and join" }));
 expect(await screen.findByRole("alert")).toHaveTextContent("Verification cancelled"); expect(m.fetch).toHaveBeenCalledTimes(1);
});
it("changing selection after setup failure generates a new consent identity", async () => {
 m.fetch.mockRejectedValueOnce(new Error("Setup unavailable")).mockResolvedValueOnce(ok({ clientSecret: "new_secret" }));
 render(<EnrollmentBilling requestId="request" offer={{ ...offer, savedCards: [{ reference: "b".repeat(64), brand: "visa", last4: "4242" }] }} />);
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "b".repeat(64) } }); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save card and join" }));
 await screen.findByRole("alert"); const initial = JSON.parse(m.fetch.mock.calls[0][1].body);
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } }); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save card and join" }));
 await screen.findByText("Secure card fields"); const next = JSON.parse(m.fetch.mock.calls[1][1].body);
 expect(next.consentId).not.toBe(initial.consentId); expect(next).not.toHaveProperty("savedCardReference");
});
it("saved-card join retry retains the new verified setup without another bank confirmation", async () => {
 m.fetch.mockResolvedValueOnce(ok({ clientSecret: "new_secret", usingSavedCard: true })).mockRejectedValueOnce(new Error("Join interrupted")).mockResolvedValueOnce(ok({ joined: true }));
 m.savedSetup.mockResolvedValue({ setupIntent: { id: "seti_new", status: "succeeded" } });
 render(<EnrollmentBilling requestId="request" offer={{ ...offer, savedCards: [{ reference: "b".repeat(64), brand: "visa", last4: "4242" }] }} />);
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "b".repeat(64) } }); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save card and join" }));
 await screen.findByText(/Your saved card will be verified/); fireEvent.click(screen.getByRole("button", { name: "Confirm card and join" }));
 await screen.findByText("Join interrupted"); fireEvent.click(screen.getByRole("button", { name: "Confirm card and join" })); await screen.findByRole("status");
 expect(m.savedSetup).toHaveBeenCalledTimes(1); expect(m.fetch.mock.calls[1][1].body).toBe(m.fetch.mock.calls[2][1].body);
});

it("can restart after saved-card verification fails with fresh explicit consent", async () => {
 m.fetch.mockResolvedValue(ok({ clientSecret: "new_secret", usingSavedCard: true })); m.savedSetup.mockResolvedValue({ error: { message: "Verification cancelled" } });
 render(<EnrollmentBilling requestId="request" offer={{ ...offer, savedCards: [{ reference: "b".repeat(64), brand: "visa", last4: "4242" }] }} />);
 fireEvent.change(screen.getByRole("combobox"), { target: { value: "b".repeat(64) } }); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Save card and join" }));
 await screen.findByText(/Your saved card will be verified/); fireEvent.click(screen.getByRole("button", { name: "Confirm card and join" })); await screen.findByRole("alert");
 fireEvent.click(screen.getByRole("button", { name: "Choose a different card" }));
 expect(screen.getByRole("combobox")).toHaveValue(""); expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(screen.getByRole("button", { name: "Save card and join" })).toBeDisabled();
});
