import "server-only";

import type { ZodType } from "zod";

import type { AiCallerScope } from "@/lib/server/ai/scope";

/** A pointer the client can render as "From your data" or "From Bundleen Help". */
export type ToolSource = {
  type: "data" | "doc";
  label: string;
  href?: string;
};

export type ToolResult<T> = {
  /** Small, structured, redacted JSON — this is what the model sees. */
  data: T;
  /** Server-built only; never derived from model or document content. */
  sources: ToolSource[];
};

export type ToolDefinition<TInput = unknown> = {
  name: string;
  description: string;
  /** JSON Schema for the OpenAI function-calling tool definition. */
  parameters: Record<string, unknown>;
  inputSchema: ZodType<TInput>;
  run: (scope: AiCallerScope, input: TInput) => Promise<ToolResult<unknown>>;
};
