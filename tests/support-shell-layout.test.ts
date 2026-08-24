import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("customer support dashboard layout", () => {
  it("does not wrap the role-specific support shell in the legacy app topbar", () => {
    const layout = read("src/app/app/layout.tsx");
    expect(layout).toContain('pathname.startsWith("/app/support")');
  });

  it("keeps provider support inside the standard ProviderShell", () => {
    const layout = read("src/app/app/support/layout.tsx");
    expect(layout).toContain('user.role === "provider"');
    expect(layout).toContain("<ProviderShell");
  });

  it("uses the same dashboard canvas and spacing as the provider tab pages", () => {
    const support = read("src/components/support/SupportCenter.tsx");
    expect(support).toContain('background: "var(--bg-app)"');
    expect(support).toContain("md:px-9 md:pb-5 md:pt-7");
    expect(support).toContain("md:px-9 md:pb-9");
    expect(support).not.toContain("max-w-3xl");
  });
});
