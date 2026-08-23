import { afterEach, describe, expect, it, vi } from "vitest";

import { getEmailProvider, isEmailConfigured } from "@/lib/server/email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Resend email provider", () => {
  it("uses the verified Vercel integration domain when no explicit sender is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("RESEND_EMAIL_DOMAIN", "notify.bundleen.com");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "");
    vi.stubEnv("EMAIL_REPLY_TO", "support@bundleen.com");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "email_123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(isEmailConfigured()).toBe(true);
    const result = await getEmailProvider().send({
      to: "resident@example.com",
      subject: "Upcoming service",
      text: "Your service is tomorrow.",
      idempotencyKey: "email:reminder:visit-1",
    });

    expect(result.providerMessageId).toBe("email_123");
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toMatchObject({
      Authorization: "Bearer re_test_key",
      "Idempotency-Key": "email:reminder:visit-1",
    });
    expect(JSON.parse(request.body as string)).toMatchObject({
      from: "Bundleen <notifications@notify.bundleen.com>",
      to: ["resident@example.com"],
      reply_to: "support@bundleen.com",
    });
  });

  it("fails closed in production instead of marking console output delivered", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_EMAIL_DOMAIN", "");
    vi.stubEnv("EMAIL_FROM_ADDRESS", "");

    expect(isEmailConfigured()).toBe(false);
    expect(() => getEmailProvider()).toThrow("Email delivery is not configured");
  });
});
