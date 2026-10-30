// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  ProviderBusinessStep,
  type ProviderBusinessData,
} from "@/components/onboarding/ProviderBusinessStep";
import { SERVICE_CATEGORIES } from "@/lib/service-categories";

afterEach(cleanup);

function Harness({ services = [] }: { services?: string[] }) {
  const [data, setData] = useState<ProviderBusinessData>({
    companyName: "Green Crew",
    bio: "Home services",
    serviceArea: "Austin",
    licenseNumber: "",
    insuranceProvider: "",
    services,
  });
  return <>
    <ProviderBusinessStep data={data} address="Austin, TX" onBack={vi.fn()}
      onContinue={vi.fn()} onChange={(field, value) => setData((current) => ({ ...current, [field]: value }))} />
    <output aria-label="Selected service values">{JSON.stringify(data.services)}</output>
  </>;
}

describe("provider onboarding service choices", () => {
  it("offers advertised and previously missing services and emits canonical slugs", () => {
    render(<Harness />);
    const finish = screen.getByRole("button", { name: "Finish provider setup" });
    expect(finish).toBeDisabled();
    for (const label of ["Lawn care", "Pool care", "Landscaping", "Gutters", "Seasonal maintenance", "Painting", "Pest control"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Lawn care" }));
    expect(screen.getByLabelText("Selected service values")).toHaveTextContent('["lawn"]');
    expect(finish).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Pool care" }));
    expect(screen.getByLabelText("Selected service values")).toHaveTextContent('["lawn","pool_care"]');
  });

  it("recognizes a legacy draft choice and can deselect it without creating a duplicate", () => {
    render(<Harness services={["Lawn care"]} />);
    const lawn = screen.getByRole("button", { name: "Lawn care" });
    expect(lawn).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(lawn);
    expect(screen.getByLabelText("Selected service values")).toHaveTextContent("[]");
    expect(screen.getByRole("button", { name: "Finish provider setup" })).toBeDisabled();
  });

  it("stops adding a thirteenth service but still permits removing an existing selection", () => {
    render(<Harness services={SERVICE_CATEGORIES.slice(0, 12)} />);
    expect(screen.getByRole("button", { name: "Landscaping" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Seasonal maintenance" })).toBeDisabled();
    const lawn = screen.getByRole("button", { name: "Lawn care" });
    expect(lawn).toBeEnabled();
    fireEvent.click(lawn);
    expect(screen.getByRole("button", { name: "Landscaping" })).toBeEnabled();
  });
});
