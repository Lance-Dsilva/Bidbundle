// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PaymentHistory } from "@/components/billing/PaymentHistory";
afterEach(cleanup);
const payment = { visitId: "visit", requestId: "request", status: "succeeded", amountCents: 1000, refundedCents: 200, providerCents: 900, transferredCents: 900, reversedCents: 180, feeCents: 100, currency: "usd", createdAt: "2026-11-21T00:00:00Z", title: "Pool care", communityName: "Community", visitNumber: 2, receiptAvailable: true };
it("shows resident payment/refund and safe server receipt route without provider fee details", () => {
  render(<PaymentHistory history={{ payments: [payment], nextCursor: null }} audience="resident" baseHref="/billing" />);
  expect(screen.getByText("Pool care")).toBeTruthy();
  expect(screen.getByText("Refunded: $2.00")).toBeTruthy();
  expect(screen.getByRole("link", { name: "View Stripe test receipt" }).getAttribute("href")).toBe("/api/hoa/payments/visit/receipt");
  expect(screen.queryByText(/Original platform fee/)).toBeNull();
});
it("shows providers actual transferred and reversed amounts without exposing resident receipt", () => {
  render(<PaymentHistory history={{ payments: [payment], nextCursor: null }} audience="provider" baseHref="/earnings" />);
  expect(screen.getByText(/Transferred: \$9.00 · Reversed: \$1.80/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: /receipt/i })).toBeNull();
});
it("links failed payments to recovery and keeps the admin request filter when paging", () => {
  const { rerender } = render(<PaymentHistory history={{ payments: [{ ...payment, status: "failed", receiptAvailable: false }], nextCursor: null }} audience="resident" baseHref="/billing" />);
  expect(screen.getByRole("link", { name: "Review payment" }).getAttribute("href")).toBe("/app/homeowner/billing/payments/visit");
  rerender(<PaymentHistory history={{ payments: [payment], nextCursor: "older visit" }} audience="admin" baseHref="/payments?requestId=request" />);
  expect(screen.getByRole("link", { name: "Older payments" }).getAttribute("href")).toBe("/payments?requestId=request&after=older%20visit");
});
