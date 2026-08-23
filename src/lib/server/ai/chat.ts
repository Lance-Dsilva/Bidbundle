import "server-only";

import type OpenAI from "openai";

import { db } from "@/lib/server/db";
import type { SessionUser } from "@/lib/server/auth";
import { getAiModel, getOpenAiClient } from "@/lib/server/ai/openai-client";
import { buildSystemPrompt } from "@/lib/server/ai/prompt";
import { buildCallerScope } from "@/lib/server/ai/scope";
import { AI_TOOLS, buildOpenAiTools, runTool } from "@/lib/server/ai/tools";
import type { ToolSource } from "@/lib/server/ai/tools/types";
import { AiToolError } from "@/lib/server/ai/errors";
import { recordAiUsage } from "@/lib/server/ai/usage-log";

const MAX_HISTORY_MESSAGES = 20;
const MAX_RESPONSE_TOKENS = 700;
const MAX_TOOL_ROUNDS = 3;
const REQUEST_TIMEOUT_MS = 20_000;
const CONTEXT_KEY = "general";

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string }
  | { type: "done"; conversationId: string; sources: ToolSource[] }
  | { type: "error"; message: string };

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

async function getOrCreateConversation(userId: string): Promise<{ id: string }> {
  return db.aiConversation.upsert({
    where: { userId_contextKey: { userId, contextKey: CONTEXT_KEY } },
    update: {},
    create: { userId, contextKey: CONTEXT_KEY },
    select: { id: true },
  });
}

async function loadHistory(
  conversationId: string,
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const rows = await db.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: MAX_HISTORY_MESSAGES,
    select: { role: true, content: true },
  });
  return rows
    .reverse()
    .map((row): OpenAI.Chat.Completions.ChatCompletionMessageParam =>
      row.role === "assistant"
        ? { role: "assistant", content: row.content }
        : { role: "user", content: row.content },
    );
}

function classifyError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: number }).status;
    if (status === 429) return "provider_rate_limited";
    if (typeof status === "number" && status >= 500) return "provider_error";
  }
  return "model_error";
}

function dedupeSources(sources: ToolSource[]): ToolSource[] {
  const seen = new Set<string>();
  const result: ToolSource[] = [];
  for (const source of sources) {
    const key = `${source.type}:${source.label}:${source.href ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

/**
 * Runs one assistant turn end-to-end and returns a stream of newline-delimited
 * JSON events ({@link ChatStreamEvent}) ready to send as a Route Handler
 * response body.
 *
 * Persists the user's message immediately (so it survives a later failure),
 * runs a bounded tool-call loop against the fixed {@link AI_TOOLS} registry —
 * every tool independently re-authorizes against `scope`, never trusting the
 * model's arguments — and persists only the assistant's final text plus a
 * content-free usage log row.
 */
export function streamAiChat(user: SessionUser, message: string): ReadableStream<Uint8Array> {
  const scope = buildCallerScope(user);
  const startedAt = Date.now();
  const toolNamesUsed: string[] = [];
  const collectedSources: ToolSource[] = [];
  const model = getAiModel();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
      let conversationId: string | null = null;

      try {
        const client = getOpenAiClient();
        if (!client) {
          controller.enqueue(
            encodeEvent({ type: "error", message: "The AI assistant is not configured yet." }),
          );
          return;
        }

        const conversation = await getOrCreateConversation(user.id);
        conversationId = conversation.id;

        const history = await loadHistory(conversation.id);
        await db.aiMessage.create({
          data: { conversationId: conversation.id, role: "user", content: message },
        });
        await db.aiConversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          { role: "system", content: buildSystemPrompt(scope) },
          ...history,
          { role: "user", content: message },
        ];

        let finalText = "";
        let promptTokens: number | null = null;
        let completionTokens: number | null = null;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
          const isLastRound = round === MAX_TOOL_ROUNDS - 1;

          const stream = await client.chat.completions.create(
            {
              model,
              messages,
              tools: buildOpenAiTools(),
              tool_choice: isLastRound ? "none" : "auto",
              max_tokens: MAX_RESPONSE_TOKENS,
              temperature: 0.2,
              stream: true,
              stream_options: { include_usage: true },
            },
            { signal: timeoutController.signal },
          );

          let roundContent = "";
          const toolCallAccumulator = new Map<
            number,
            { id: string; name: string; arguments: string }
          >();
          let finishReason: string | null = null;

          for await (const chunk of stream) {
            const choice = chunk.choices[0];
            if (choice?.delta.content) {
              roundContent += choice.delta.content;
              finalText += choice.delta.content;
              controller.enqueue(encodeEvent({ type: "delta", text: choice.delta.content }));
            }
            if (choice?.delta.tool_calls) {
              for (const toolCall of choice.delta.tool_calls) {
                const existing = toolCallAccumulator.get(toolCall.index) ?? {
                  id: "",
                  name: "",
                  arguments: "",
                };
                if (toolCall.id) existing.id = toolCall.id;
                if (toolCall.function?.name) existing.name += toolCall.function.name;
                if (toolCall.function?.arguments) existing.arguments += toolCall.function.arguments;
                toolCallAccumulator.set(toolCall.index, existing);
              }
            }
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
              completionTokens = chunk.usage.completion_tokens ?? completionTokens;
            }
          }

          if (finishReason !== "tool_calls" || toolCallAccumulator.size === 0) {
            break;
          }

          const toolCalls = Array.from(toolCallAccumulator.values());
          messages.push({
            role: "assistant",
            content: roundContent || null,
            tool_calls: toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          });

          for (const call of toolCalls) {
            controller.enqueue(encodeEvent({ type: "tool", name: call.name }));
            toolNamesUsed.push(call.name);

            let resultContent: string;
            try {
              const result = await runTool(call.name, scope, call.arguments);
              collectedSources.push(...result.sources);
              resultContent = JSON.stringify(result.data);
            } catch (error) {
              if (error instanceof AiToolError) {
                resultContent = JSON.stringify({ error: error.message });
              } else {
                console.error("[ai] tool execution failed", {
                  tool: call.name,
                  name: error instanceof Error ? error.name : "UnknownError",
                });
                resultContent = JSON.stringify({ error: "This lookup failed. Please try again." });
              }
            }

            messages.push({ role: "tool", tool_call_id: call.id, content: resultContent });
          }
        }

        if (finalText.trim()) {
          await db.aiMessage.create({
            data: { conversationId: conversation.id, role: "assistant", content: finalText },
          });
        }

        await recordAiUsage({
          userId: user.id,
          role: user.role,
          model,
          latencyMs: Date.now() - startedAt,
          toolNames: toolNamesUsed,
          success: true,
          promptTokens,
          completionTokens,
        });

        controller.enqueue(
          encodeEvent({
            type: "done",
            conversationId: conversation.id,
            sources: dedupeSources(collectedSources),
          }),
        );
      } catch (error) {
        console.error("[ai] chat stream failed", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
        controller.enqueue(
          encodeEvent({
            type: "error",
            message: "Something went wrong generating a response. Please try again.",
          }),
        );
        await recordAiUsage({
          userId: user.id,
          role: user.role,
          model,
          latencyMs: Date.now() - startedAt,
          toolNames: toolNamesUsed,
          success: false,
          errorType: classifyError(error),
        });
      } finally {
        clearTimeout(timeout);
        controller.close();
      }
    },
  });
}
