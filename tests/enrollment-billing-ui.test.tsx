// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => { process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fixture"; return { setup: vi.fn(), fetch: vi.fn() }; });
vi.mock("@stripe/stripe-js", () => ({ loadStripe: () => Promise.resolve({}) }));
vi.mock("@stripe/react-stripe-js", () => ({ Elements: ({ children }: { children: React.ReactNode }) => children, PaymentElement: () => <div>Secure card fields</div>, useStripe: () => ({ confirmSetup: m.setup }), useElements: () => ({}) }));
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
