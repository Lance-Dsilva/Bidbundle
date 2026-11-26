// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fixture";
  return { confirm: vi.fn(), fetch: vi.fn() };
});
vi.mock("@stripe/stripe-js", () => ({ loadStripe: () => Promise.resolve({}) }));
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => children,
  PaymentElement: () => <div>Secure card fields</div>,
  useStripe: () => ({ confirmSetup: mocks.confirm }),
  useElements: () => ({}),
}));
import { ResidentBillingCard } from "@/components/billing/ResidentBillingCard";
const offer = { termsToken: "terms", currency: "usd", totalCents: 3001, visits: [{ visitNumber: 1, amountCents: 1501 }, { visitNumber: 2, amountCents: 1500 }], terms: "I consent to these visit charges.", acceptedAt: null };
const ok = (body: unknown) => ({ ok: true, json: async () => body });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", mocks.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function start() {
  render(<ResidentBillingCard agreementId="agreement" title="Lawn care" offer={offer} />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continue to test card" }));
  await screen.findByText("Secure card fields");
}
it("shows exact allocated prices and requires explicit consent before setup", async () => {
  mocks.fetch.mockResolvedValueOnce(ok(offer)).mockResolvedValueOnce(ok({ clientSecret: "fixture" }));
  render(<ResidentBillingCard agreementId="agreement" title="Lawn care" offer={offer} />);
  expect(screen.getByText(/Visit 1: \$15.01/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continue to test card" })).toBeDisabled();
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continue to test card" }));
  await screen.findByText("Secure card fields");
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ accepted: true, termsToken: "terms" });
});
it("does not collect card details when current consent is rejected", async () => {
  mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: "Review current prices." }) });
  render(<ResidentBillingCard agreementId="agreement" title="Lawn care" offer={offer} />);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Continue to test card" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Review current prices.");
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Secure card fields")).toBeNull();
});
it("retries server verification without confirming the Stripe intent a second time", async () => {
  mocks.fetch.mockResolvedValueOnce(ok(offer)).mockResolvedValueOnce(ok({ clientSecret: "fixture" }))
    .mockRejectedValueOnce(new Error("Network unavailable"))
    .mockResolvedValueOnce(ok({ brand: "visa", last4: "4242" }));
  mocks.confirm.mockResolvedValue({ setupIntent: { id: "seti_fixture", status: "succeeded" } });
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Save test card" }));
  await screen.findByText("Network unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Save test card" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("visa ending 4242"));
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mocks.fetch.mock.calls[3][1].body)).toEqual({ action: "verify", setupIntentId: "seti_fixture" });
});
it("does not announce saved card before Stripe succeeds", async () => {
  mocks.fetch.mockResolvedValueOnce(ok(offer)).mockResolvedValueOnce(ok({ clientSecret: "fixture" }));
  mocks.confirm.mockResolvedValue({ error: { message: "Card declined" } });
  await start();
  fireEvent.click(screen.getByRole("button", { name: "Save test card" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Card declined");
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("status")).toBeNull();
});
