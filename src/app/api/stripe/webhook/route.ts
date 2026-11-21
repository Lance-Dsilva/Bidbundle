import { receiveStripeTestWebhook } from "@/lib/server/stripe-webhook-inbox";

export const runtime = "nodejs";

export function POST(request: Request): Promise<Response> {
  return receiveStripeTestWebhook(request, "platform");
}
