import { describe, expect, it } from "vitest";

import { isOnboardingDraft, type OnboardingDraft } from "@/lib/onboarding-draft";

const validDraft: OnboardingDraft = {
  name: { firstName: "Ada", lastName: "Lovelace" },
  role: "homeowner",
  address: "742 Evergreen Terrace, Springfield",
  neighborhood: "Springfield",
  latitude: 34.05,
  longitude: -118.24,
  providerBusiness: {
    companyName: "",
    bio: "",
    services: [],
    serviceArea: "",
    licenseNumber: "",
    insuranceProvider: "",
  },
};

describe("isOnboardingDraft", () => {
  it("accepts a complete same-tab onboarding handoff", () => {
    expect(isOnboardingDraft(validDraft)).toBe(true);
  });

  it("rejects drafts without verified coordinates", () => {
    expect(isOnboardingDraft({ ...validDraft, latitude: null })).toBe(false);
  });

  it("rejects privileged and unknown roles", () => {
    expect(isOnboardingDraft({ ...validDraft, role: "admin" })).toBe(false);
  });

  it("rejects malformed provider service lists", () => {
    expect(
      isOnboardingDraft({
        ...validDraft,
        role: "provider",
        providerBusiness: { ...validDraft.providerBusiness, services: ["Plumbing", 1] },
      }),
    ).toBe(false);
  });
});
