// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { HoaManagerWorkspace } from "@/components/hoa/HoaManagerWorkspace";
import type { HoaManagerDashboard } from "@/lib/hoa-types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

const dashboard: HoaManagerDashboard = { communities: [{
  id: "hoa-1", name: "Test HOA", profile: null, activeMemberCount: 0,
  units: [], invitations: [], requests: [], bidsByRequest: {}, agreements: [],
  occurrencesByAgreement: {}, surveys: [],
}] };

describe("HOA manager service category", () => {
  it("uses a required catalog selector and emits canonical values instead of arbitrary text", () => {
    render(<HoaManagerWorkspace dashboard={dashboard} />);
    const category = screen.getByRole("combobox", { name: "Service category" });
    expect(category).toBeRequired();
    expect(category).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "Service category" })).not.toBeInTheDocument();
    for (const [label, slug] of [
      ["Lawn care", "lawn"], ["Pool care", "pool_care"], ["Gutters", "gutter"],
      ["Landscaping", "landscaping"], ["Seasonal maintenance", "seasonal_maintenance"],
      ["Painting", "painting"], ["Pest control", "pest_control"],
    ]) {
      expect(within(category).getByRole("option", { name: label })).toHaveValue(slug);
      fireEvent.change(category, { target: { value: slug } });
      expect(category).toHaveValue(slug);
    }
  });
});
