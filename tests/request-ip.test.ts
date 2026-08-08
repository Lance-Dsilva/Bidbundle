import { describe, expect, it } from "vitest";

import { getRequestIp, isUnknownIp, UNKNOWN_IP } from "@/lib/server/request-ip";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://bundleen.example/api/auth/register", { headers });
}

describe("getRequestIp", () => {
  it("prefers the Vercel-set header over x-forwarded-for", () => {
    const request = requestWith({
      "x-vercel-forwarded-for": "203.0.113.5",
      "x-forwarded-for": "198.51.100.9",
    });
    expect(getRequestIp(request)).toBe("203.0.113.5");
  });

  it("prefers x-real-ip over x-forwarded-for", () => {
    const request = requestWith({
      "x-real-ip": "203.0.113.5",
      "x-forwarded-for": "198.51.100.9",
    });
    expect(getRequestIp(request)).toBe("203.0.113.5");
  });

  it("falls back to x-forwarded-for when it is the only header", () => {
    expect(getRequestIp(requestWith({ "x-forwarded-for": "203.0.113.5" }))).toBe("203.0.113.5");
  });

  it("takes only the leftmost x-forwarded-for entry", () => {
    // The platform appends the true client IP first; anything a client
    // injected ends up to the right of it and must be ignored.
    const request = requestWith({
      "x-forwarded-for": "203.0.113.5, 198.51.100.9, 192.0.2.1",
    });
    expect(getRequestIp(request)).toBe("203.0.113.5");
  });

  it("ignores a spoofed value appended after the real client IP", () => {
    const request = requestWith({ "x-forwarded-for": "203.0.113.5, 1.1.1.1" });
    expect(getRequestIp(request)).not.toBe("1.1.1.1");
  });

  it("strips the port from an IPv4 address", () => {
    expect(getRequestIp(requestWith({ "x-real-ip": "203.0.113.5:44321" }))).toBe("203.0.113.5");
  });

  it("preserves a bare IPv6 address", () => {
    const ipv6 = "2001:db8:85a3::8a2e:370:7334";
    expect(getRequestIp(requestWith({ "x-real-ip": ipv6 }))).toBe(ipv6);
  });

  it("unwraps a bracketed IPv6 address with a port", () => {
    const request = requestWith({ "x-real-ip": "[2001:db8::1]:44321" });
    expect(getRequestIp(request)).toBe("2001:db8::1");
  });

  it("trims whitespace around a forwarded address", () => {
    expect(getRequestIp(requestWith({ "x-forwarded-for": "  203.0.113.5  " }))).toBe("203.0.113.5");
  });

  it("returns the unknown marker when no header is present", () => {
    expect(getRequestIp(requestWith({}))).toBe(UNKNOWN_IP);
  });

  it("skips an empty header value and falls through", () => {
    const request = requestWith({ "x-real-ip": "", "x-forwarded-for": "203.0.113.5" });
    expect(getRequestIp(request)).toBe("203.0.113.5");
  });

  it("returns the unknown marker when every header is blank", () => {
    expect(getRequestIp(requestWith({ "x-forwarded-for": "  ,  " }))).toBe(UNKNOWN_IP);
  });
});

describe("isUnknownIp", () => {
  it("recognises the marker", () => {
    expect(isUnknownIp(UNKNOWN_IP)).toBe(true);
  });

  it("does not flag a real address", () => {
    expect(isUnknownIp("203.0.113.5")).toBe(false);
  });
});
