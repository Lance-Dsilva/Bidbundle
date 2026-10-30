import { z } from "zod";

/**
 * Neighbourhood marketplace request bodies.
 *
 * Every schema is `.strict()`, so a body that names an owner, a community, a
 * status, a participant count, or a coordinate is rejected outright rather
 * than silently ignored — the server derives all of those itself.
 */

export const MAX_NEIGHBORHOOD_BODY_BYTES = 16 * 1024;

export const participationSchema = z
  .object({ response: z.enum(["joined", "declined"]) })
  .strict();

export type ParticipationInput = z.infer<typeof participationSchema>;

/**
 * Lifecycle actions the neighbourhood manager may take.
 *
 * An *action*, never a target status: the transition table lives on the
 * server, so a client cannot ask for `awarded` and skip the bidding it
 * requires.
 */
export const neighborhoodTransitionSchema = z
  .object({
    action: z.enum(["open_bidding", "close_bidding", "complete", "cancel"]),
    biddingClosesAt: z
      .union([z.string().datetime({ offset: true }), z.null()])
      .optional(),
  })
  .strict();

export type NeighborhoodTransitionInput = z.infer<typeof neighborhoodTransitionSchema>;

export const neighborhoodAwardSchema = z
  .object({
    bidId: z.string().trim().min(1).max(64),
    expectedBidVersion: z.number().int().positive().optional(),
  })
  .strict();

export type NeighborhoodAwardInput = z.infer<typeof neighborhoodAwardSchema>;
