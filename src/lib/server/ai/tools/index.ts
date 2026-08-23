import "server-only";

import type OpenAI from "openai";

import { AiToolError } from "@/lib/server/ai/errors";
import type { AiCallerScope } from "@/lib/server/ai/scope";
import { getAdminOperationsSummary } from "@/lib/server/ai/tools/admin-summary";
import { getHoaOverview } from "@/lib/server/ai/tools/hoa-overview";
import { getProviderPipeline } from "@/lib/server/ai/tools/provider-pipeline";
import { getRequestBids } from "@/lib/server/ai/tools/request-bids";
import { getServiceRequests } from "@/lib/server/ai/tools/service-requests";
import { getServiceSchedule } from "@/lib/server/ai/tools/service-schedule";
import { searchBundleenHelp } from "@/lib/server/ai/tools/help-search";
import type { ToolDefinition, ToolResult } from "@/lib/server/ai/tools/types";

/**
 * The complete, closed set of tools the model may call. There is no
 * general-purpose SQL tool — every read the model can request is one of
 * these small, individually authorized, predefined business queries.
 */
// `any` here (not `unknown`) deliberately: each tool's own file is fully
// typed by its specific `ToolDefinition<Input>`, and this registry only ever
// calls a tool through `runTool`, which re-derives the input type from the
// same tool's `inputSchema.safeParse` result before calling `run`.
export const AI_TOOLS: ToolDefinition<any>[] = [
  getAdminOperationsSummary,
  getHoaOverview,
  getServiceRequests,
  getRequestBids,
  getServiceSchedule,
  getProviderPipeline,
  searchBundleenHelp,
];

const TOOLS_BY_NAME = new Map(AI_TOOLS.map((tool) => [tool.name, tool]));

export function buildOpenAiTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return AI_TOOLS.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Parses the model's raw JSON arguments, validates them against the tool's
 * schema, authorizes, and runs it. Never trusts `rawArguments` beyond what
 * the schema accepts, and every tool re-derives authorization from `scope`
 * (the verified session) rather than anything in `rawArguments`.
 */
export async function runTool(
  name: string,
  scope: AiCallerScope,
  rawArguments: string,
): Promise<ToolResult<unknown>> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) throw new AiToolError(`Unknown tool: ${name}.`, 400);

  let parsedJson: unknown;
  try {
    parsedJson = rawArguments.trim() ? JSON.parse(rawArguments) : {};
  } catch {
    throw new AiToolError(`Invalid arguments for ${name}.`, 400);
  }

  const parsed = tool.inputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new AiToolError(`Invalid arguments for ${name}.`, 400);
  }

  return tool.run(scope, parsed.data);
}
