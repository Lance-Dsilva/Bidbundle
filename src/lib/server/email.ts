import "server-only";

/**
 * Email delivery abstraction behind the outbox.
 *
 * The database commit never depends on this module: services enqueue
 * `OutboxEvent` rows and the outbox worker calls {@link getEmailProvider} when
 * it drains the queue. Swapping providers is a config change, not a schema or
 * service change.
 */

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  /** Stable outbox identity, forwarded to Resend for provider-side deduping. */
  idempotencyKey?: string;
};

export type EmailDeliveryResult = {
  /** Provider-assigned message id, stored for support. Never a secret. */
  providerMessageId: string | null;
};

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailDeliveryResult>;
}

/**
 * Resend REST delivery. Chosen because it needs no SDK dependency — one
 * authenticated POST — and the key stays server-only.
 */
class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (message.idempotencyKey) headers["Idempotency-Key"] = message.idempotencyKey;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: this.fromAddress,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`resend delivery failed with status ${response.status}`);
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { providerMessageId: body?.id ?? null };
  }
}

/**
 * Development fallback: records the send in the server log so local flows are
 * observable without an email account. Never used when a real key is present.
 */
class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(message: EmailMessage): Promise<EmailDeliveryResult> {
    console.info("[email:console]", {
      to: message.to,
      subject: message.subject,
    });
    return { providerMessageId: null };
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && resolveFromAddress());
}

export function getEmailProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = resolveFromAddress();
  if (apiKey && fromAddress) return new ResendEmailProvider(apiKey, fromAddress);
  // A production outbox must never mark an email delivered merely because a
  // sender variable was omitted. Throwing leaves the row retryable and makes
  // the deployment problem visible in logs and the admin outbox.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM_ADDRESS or RESEND_EMAIL_DOMAIN.",
    );
  }
  return new ConsoleEmailProvider();
}

function resolveFromAddress(): string | null {
  const explicit = process.env.EMAIL_FROM_ADDRESS?.trim();
  if (explicit) return explicit;

  // The Vercel Resend integration supplies the verified domain. This default
  // means the integration works without a second, redundant sender variable.
  const domain = process.env.RESEND_EMAIL_DOMAIN?.trim().toLowerCase();
  if (!domain || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    return null;
  }
  return `Bundleen <notifications@${domain}>`;
}
