// @vitest-environment jsdom
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PriceLadder } from "../src/components/ui/PriceLadder";
afterEach(cleanup);
const tiers = [{ minHomes: 1, perHomeCents: 12000 }, { minHomes: 10, perHomeCents: 10000 }];
it("shows the current tier and exact remaining homes with full-term units", () => {
  render(<PriceLadder tiers={tiers} joinedHomes={9} />);
  expect(screen.getByText("9 homes joined")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("1 more home to unlock $100.00");
  expect(screen.getAllByRole("listitem")[0].getAttribute("aria-current")).toBe("step");
  expect(screen.getAllByRole("listitem")[0].textContent).toContain("full service term");
});
it("highlights the newly unlocked price and states the cap", () => {
  render(<PriceLadder tiers={tiers} joinedHomes={10} />);
  expect(screen.getByRole("status").textContent).toBe("Lowest group price unlocked");
  expect(screen.getAllByRole("listitem")[1].getAttribute("aria-current")).toBe("step");
  expect(screen.getByText(/never exceed/)).toBeTruthy();
});
