import "server-only";

import { z } from "zod";

import { searchHelp } from "@/lib/server/ai/help-content";
import type { ToolDefinition } from "@/lib/server/ai/tools/types";

const inputSchema = z.object({ query: z.string().trim().min(1).max(200) }).strict();
type Input = z.infer<typeof inputSchema>;

export const searchBundleenHelp: ToolDefinition<Input> = {
  name: "search_bundleen_help",
  description:
    "Searches Bundleen's product/help documentation (how bidding works, HOA onboarding, provider verification, schedules, roles). Available to every role. Use for 'how does X work' questions, not for a specific account's data.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What the user wants to know about Bundleen." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  inputSchema,
  async run(_scope, input) {
    const matches = searchHelp(input.query);
    return {
      data: {
        matches: matches.map((match) => ({ title: match.title, excerpt: match.excerpt })),
      },
      sources: matches.map((match) => ({
        type: "doc" as const,
        label: match.title,
        href: `/help/${match.slug}`,
      })),
    };
  },
};
