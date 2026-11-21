// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_fixture";
  return { setup: vi.fn(), bank: vi.fn(), fetch: vi.fn() };
});
vi.mock("@stripe/stripe-js", () => ({ loadStripe: () => Promise.resolve({ confirmCardPayment: m.bank }) }));
vi.mock("@stripe/react-stripe-js", () => ({ Elements: ({ children }: { children: React.ReactNode }) => children,
  PaymentElement: () => <div>Secure replacement card fields</div>, useStripe: () => ({ confirmSetup: m.setup }), useElements: () => ({}) }));
import { PaymentRecovery } from "@/components/billing/PaymentRecovery";
const ok = (body: unknown) => ({ ok: true, json: async () => body });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function review() {
  render(<PaymentRecovery visitId="visit" amountCents={1501} currency="usd" />);
  fireEvent.click(screen.getByRole("button", { name: "Review payment status" }));
}
it("requires explicit exact-amount consent before replacement setup", async () => {
  m.fetch.mockResolvedValueOnce(ok({ status: "requires_payment_method" })).mockResolvedValueOnce(ok({ clientSecret: "setup_secret" }));
  await review();
  const start = await screen.findByRole("button", { name: "Use another test card" }); expect(start).toBeDisabled();
  expect(screen.getByText(/I authorize a test charge of \$15.01/)).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(start);
  await screen.findByText("Secure replacement card fields");
  expect(JSON.parse(m.fetch.mock.calls[1][1].body)).toMatchObject({ action: "start", accepted: true });
});
it("retries network verification with the same attempt and without reconfirming setup", async () => {
  m.fetch.mockResolvedValueOnce(ok({ status: "requires_payment_method" })).mockResolvedValueOnce(ok({ clientSecret: "setup_secret" }))
    .mockRejectedValueOnce(new Error("Network interrupted" )).mockResolvedValueOnce(ok({ status: "succeeded" }));
  m.setup.mockResolvedValue({ setupIntent: { id: "seti_fixture", status: "succeeded" } });
  await review(); await screen.findByRole("checkbox"); fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Use another test card" }));
  const submit = await screen.findByRole("button", { name: "Save card and retry test payment" }); fireEvent.click(submit);
  await screen.findByText("Network interrupted"); fireEvent.click(submit);
  expect(await screen.findByRole("status")).toHaveTextContent("Your test payment succeeded");
  expect(m.setup).toHaveBeenCalledTimes(1);
  expect(JSON.parse(m.fetch.mock.calls[2][1].body)).toEqual(JSON.parse(m.fetch.mock.calls[3][1].body));
});
it("authenticates the existing payment then refreshes authoritative status", async () => {
  m.fetch.mockResolvedValueOnce(ok({ status: "requires_action", clientSecret: "old_secret" }))
    .mockResolvedValueOnce(ok({ status: "requires_action", clientSecret: "fresh_secret" })).mockResolvedValueOnce(ok({ status: "succeeded" }));
  m.bank.mockResolvedValue({ paymentIntent: { status: "succeeded" } });
  await review(); fireEvent.click(await screen.findByRole("button", { name: "Verify with your bank" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Your test payment succeeded");
  expect(m.bank).toHaveBeenCalledWith("fresh_secret"); expect(m.setup).not.toHaveBeenCalled();
  expect(screen.queryByText(/secret/)).toBeNull();
});
