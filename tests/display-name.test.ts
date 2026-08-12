import { describe, expect, it } from "vitest";

import { fullNameFromSignUp, initialsFromName } from "@/lib/display-name";

describe("display name helpers", () => {
  it("uses the first name and surname for initials", () => {
    expect(initialsFromName("Mary Jane Watson")).toBe("MW");
  });

  it("handles a single name and an empty fallback", () => {
    expect(initialsFromName("Prince")).toBe("P");
    expect(initialsFromName("  ")).toBe("NB");
  });

  it("normalizes the collected first name and surname", () => {
    expect(fullNameFromSignUp({ firstName: "  Ada", lastName: "Lovelace  " })).toBe("Ada Lovelace");
  });
});
