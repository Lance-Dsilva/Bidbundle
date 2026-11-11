/** The only public-invitation destination accepted across the signup handoff. */
export function vendorBidReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || !/^\/bid\/[A-Za-z0-9_.-]{20,256}$/.test(value)) return null;
  return value;
}

export function vendorOnboardingPath(path: "/get-started" | "/get-started/profile" | "/sign-in", destination: unknown): string {
  const returnTo = vendorBidReturnPath(destination);
  if (!returnTo) return path;
  const query = new URLSearchParams({ returnTo });
  if (path === "/get-started") query.set("role", "provider");
  return `${path}?${query}`;
}
