import { z } from "zod";

export const MAX_AI_MESSAGE_LENGTH = 2000;

export const aiChatMessageSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, "Message is required.")
      .max(MAX_AI_MESSAGE_LENGTH, "Message is too long."),
  })
  .strict();
