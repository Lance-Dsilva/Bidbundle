import "server-only";

import OpenAI from "openai";

/**
 * Lazily constructed so `next build` (which imports every route to collect
 * page data) never needs `OPENAI_API_KEY` to succeed — mirrors the Prisma
 * client's deferred-construction pattern in `lib/server/db.ts`.
 */
let cachedClient: OpenAI | null | undefined;

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

/** Null when `OPENAI_API_KEY` is unset — callers must degrade gracefully. */
export function getOpenAiClient(): OpenAI | null {
  if (!isAiConfigured()) return null;
  cachedClient ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cachedClient;
}

/**
 * Fast, low-cost chat model, configurable without a code change. `gpt-4o-mini`
 * is the default: OpenAI's current well-established fast/cheap model.
 */
export function getAiModel(): string {
  return process.env.AI_MODEL?.trim() || "gpt-4o-mini";
}

/** Test seam: drops the cached client so env changes take effect. */
export function resetOpenAiClientCache(): void {
  cachedClient = undefined;
}
