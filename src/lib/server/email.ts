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
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: [message.to],
        subject: message.subject,
        text: message.text,
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
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM_ADDRESS);
}

export function getEmailProvider(): EmailProvider {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;
  if (apiKey && fromAddress) return new ResendEmailProvider(apiKey, fromAddress);
  return new ConsoleEmailProvider();
}
