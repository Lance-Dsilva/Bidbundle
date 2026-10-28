import type { z } from "zod";
import type { communityInterestItemSchema, communityInterestListSchema } from "@/lib/validation/community-interest";

export type CommunityInterestItem = z.infer<typeof communityInterestItemSchema>;
export type CommunityInterestList = z.infer<typeof communityInterestListSchema>;
