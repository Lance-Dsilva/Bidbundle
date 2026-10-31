import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABELS,
  SERVICE_CATEGORIES,
  normalizeServiceCategory,
  normalizeServiceTrades,
  serviceCategoryLabel,
} from "@/lib/service-categories";
import { createHomeownerRequestSchema } from "@/lib/validation/homeowner-requests";
import { hoaRequestCreateSchema } from "@/lib/validation/hoa";
import { providerProfileUpdateSchema } from "@/lib/validation/profile";

const request = {
  title: "Shared home service",
  description: "A complete description of the work requested.",
  budgetMinCents: 10_000,
  budgetMaxCents: 20_000,
};

describe("the common service-category contract", () => {
  it.each([
    ["Lawn care", "lawn"],
    ["Cleaning", "cleaning"],
    ["Pool care", "pool_care"],
    ["Landscaping", "landscaping"],
    ["Gutters", "gutter"],
    ["Seasonal maintenance", "seasonal_maintenance"],
    ["Painting", "painting"],
    ["Pest control", "pest_control"],
  ])("lets a provider and homeowner choose the advertised service %s", (label, category) => {
    expect(SERVICE_CATEGORIES).toContain(category);
    expect(normalizeServiceCategory(label)).toBe(category);
    expect(serviceCategoryLabel(category)).toBe(label);
    expect(providerProfileUpdateSchema.parse({ trades: [label] }).trades).toEqual([category]);
    expect(createHomeownerRequestSchema.parse({ ...request, category }).category).toBe(category);
  });

  it.each([
    ["  LAWN CARE ", "lawn"],
    ["Lawn-care", "lawn"],
    ["Gutter clearing", "gutter"],
    ["Gardening", "landscaping"],
    ["Pool", "pool_care"],
    ["Pool cleaning", "pool_care"],
    ["Pest-control", "pest_control"],
    ["seasonal_maintenance", "seasonal_maintenance"],
  ])("recognizes the historical value %s", (value, category) => {
    expect(normalizeServiceCategory(value)).toBe(category);
    const hoa = hoaRequestCreateSchema.parse({
      title: request.title,
      description: request.description,
      kind: "optional_group",
      category: value,
      publish: false,
    });
    expect(hoa.category).toBe(category);
  });

  it("preserves the existing Other category rather than implementing issue #8", () => {
    expect(normalizeServiceCategory("Other")).toBe("other");
    expect(createHomeownerRequestSchema.safeParse({ ...request, category: "other" }).success).toBe(true);
  });

  it.each(["", "Drain clearing", "all", "__proto__", "constructor", "lawn care and plumbing"])(
    "rejects unsupported new service %j instead of routing it as Other",
    (value) => {
      expect(normalizeServiceCategory(value)).toBeNull();
      expect(providerProfileUpdateSchema.safeParse({ trades: [value] }).success).toBe(false);
      expect(createHomeownerRequestSchema.safeParse({ ...request, category: value }).success).toBe(false);
      expect(hoaRequestCreateSchema.safeParse({
        title: request.title,
        description: request.description,
        kind: "optional_group",
        category: value,
        publish: false,
      }).success).toBe(false);
    },
  );

  it("canonicalizes aliases once and preserves the order of recognized provider trades", () => {
    expect(normalizeServiceTrades(["Lawn care", "PLUMBING", "lawn", "Drain clearing", "Gutters"]))
      .toEqual(["lawn", "plumbing", "gutter"]);
    expect(providerProfileUpdateSchema.parse({ trades: ["Lawn care", "lawn", "PLUMBING"] }).trades)
      .toEqual(["lawn", "plumbing"]);
  });

  it("does not silently drop an unsupported value when saving a mixed trade list", () => {
    expect(providerProfileUpdateSchema.safeParse({ trades: ["lawn", "Drain clearing"] }).success).toBe(false);
    expect(serviceCategoryLabel("Drain clearing")).toBe("Drain clearing");
  });

  it("retains the existing trade-count limit even though the catalog has grown", () => {
    expect(providerProfileUpdateSchema.safeParse({ trades: SERVICE_CATEGORIES.slice(0, 12) }).success).toBe(true);
    expect(providerProfileUpdateSchema.safeParse({ trades: SERVICE_CATEGORIES.slice(0, 13) }).success).toBe(false);
  });

  it("has a human-readable label for every canonical category", () => {
    expect(new Set(SERVICE_CATEGORIES).size).toBe(SERVICE_CATEGORIES.length);
    for (const category of SERVICE_CATEGORIES) {
      expect(CATEGORY_LABELS[category].trim()).not.toBe("");
      expect(normalizeServiceCategory(CATEGORY_LABELS[category])).toBe(category);
    }
  });
});
