import "server-only";

import { db } from "@/lib/server/db";
import type { UserRole } from "@/generated/prisma/enums";

export type AiUsageLogInput = {
  userId: string | null;
  role: UserRole;
  model: string;
  latencyMs: number;
  toolNames: string[];
  success: boolean;
  /** Coarse failure class only — never a raw error message or prompt/result content. */
  errorType?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
};

/**
 * Writes one usage row for cost/latency observability.
 *
 * Deliberately never given prompt text, tool arguments, or tool results —
 * see `AiUsageLog` in `schema.prisma`. A logging failure must not fail the
 * chat request itself, so this only logs-and-swallows.
 */
export async function recordAiUsage(input: AiUsageLogInput): Promise<void> {
  try {
    await db.aiUsageLog.create({
      data: {
        userId: input.userId,
        role: input.role,
        model: input.model,
        latencyMs: input.latencyMs,
        toolNames: input.toolNames,
        success: input.success,
        errorType: input.errorType ?? null,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
      },
    });
  } catch (error) {
    console.error("[ai] usage log write failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }
}
