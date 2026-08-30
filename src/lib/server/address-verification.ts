import "server-only";

import type { AddressCandidate } from "@/lib/hoa-types";
import {
  type CanonicalAddress,
  canonicalAddressLine,
  Geocoder,
  GeocoderError,
  type NormalizedAddress,
} from "@/lib/server/geocoding";
import { HoaWorkflowError } from "@/lib/server/hoa";

/**
 * The policy layer between admin address writes and the raw geocoder.
 *
 * The geocoder answers questions; this decides what an answer means for a save:
 * when to store, when to ask the admin to choose, and when to refuse and let
 * them retry. Keeping the decision here means the HOA profile writer, the unit
 * writer, and the batch importer cannot drift apart on it.
 */

export class AddressAmbiguousError extends HoaWorkflowError {
  readonly candidates: AddressCandidate[];

  constructor(candidates: AddressCandidate[]) {
    super(
      "That address matched more than one place. Choose the correct one and save again.",
      409,
    );
    this.name = "AddressAmbiguousError";
    this.candidates = candidates;
  }
}

export class AddressUnresolvedError extends HoaWorkflowError {
  /** Whether the same save is worth repeating without changing the address. */
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(message, status);
    this.name = "AddressUnresolvedError";
    this.retryable = retryable;
  }
}

/**
 * A candidate as the browser sees it: an address and an opaque handle.
 *
 * The handle is the normalized one-line rendering, which is also what the
 * confirmation sends back. It is not a coordinate and cannot be used to
 * smuggle one in — the server re-resolves and picks the matching candidate
 * from its own fresh list.
 */
function toCandidate(address: NormalizedAddress): AddressCandidate {
  return {
    token: address.formatted,
    formatted: address.formatted,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    locality: address.locality,
    region: address.region,
    postalCode: address.postalCode,
    country: address.country,
  };
}

/** Maps a geocoder failure onto the answer the admin should get. */
function asUnresolved(error: GeocoderError): AddressUnresolvedError {
  switch (error.kind) {
    case "not_configured":
      return new AddressUnresolvedError(
        "Address verification is not available right now. Bundleen engineering has been notified; your entries are preserved.",
        503,
        true,
      );
    case "invalid_address":
      return new AddressUnresolvedError(
        "That address could not be read. Check the street, city, and postal code and try again.",
        400,
        false,
      );
    case "rate_limited":
      return new AddressUnresolvedError(
        "Address verification is busy. Wait a moment and save again — your entries are preserved.",
        429,
        true,
      );
    case "timeout":
      return new AddressUnresolvedError(
        "Address verification timed out. Save again to retry — your entries are preserved.",
        504,
        true,
      );
    default:
      return new AddressUnresolvedError(
        "Address verification is temporarily unavailable. Save again to retry — your entries are preserved.",
        503,
        true,
      );
  }
}

export type ResolvedLocation = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  placeId: string | null;
  confidence: number;
  /** Normalized parts, written alongside the coordinates in one statement. */
  addressLine1: string;
  addressLine2: string | null;
  locality: string;
  region: string;
  postalCode: string;
  country: string;
};

/**
 * Resolves one address for storage, or explains why it cannot be stored.
 *
 * Three outcomes, three distinct behaviors:
 *
 * - one confident routeable match → returns it, and the caller writes the
 *   normalized address and the coordinates in the same statement;
 * - several plausible matches → throws {@link AddressAmbiguousError} carrying
 *   candidates, and *nothing is written*, so a wrong location can never be
 *   stored by accident;
 * - provider unavailable, timed out, rate-limited, or unconfigured → throws
 *   {@link AddressUnresolvedError} with `retryable`, and again nothing is
 *   written, so the admin retries with their form intact.
 *
 * `confirmedFormattedAddress` is how the second outcome is closed: the admin
 * picks a candidate, the save comes back with its one-line form, and this
 * matches it against a fresh candidate list (served from the module cache, so
 * usually with no second provider call).
 */
export async function resolveForStorage(
  entered: CanonicalAddress,
  confirmedFormattedAddress?: string | null,
): Promise<ResolvedLocation> {
  let candidates: NormalizedAddress[];
  try {
    candidates = await Geocoder.search(entered);
  } catch (error) {
    if (error instanceof GeocoderError) throw asUnresolved(error);
    throw error;
  }

  if (candidates.length === 0) {
    throw new AddressUnresolvedError(
      "We could not find that address. Check the street number, city, and postal code.",
      400,
      false,
    );
  }

  const confirmed = confirmedFormattedAddress?.trim();
  const chosen = confirmed
    ? candidates.find((candidate) => candidate.formatted === confirmed)
    : undefined;

  if (confirmed && !chosen) {
    // The candidate list moved between the two saves. Ask again rather than
    // guessing which of the new answers the admin meant.
    throw new AddressAmbiguousError(candidates.map(toCandidate));
  }

  const outcome = chosen ? null : await resolveOutcome(entered);
  const address = chosen ?? outcome;
  if (!address) {
    throw new AddressAmbiguousError(candidates.map(toCandidate));
  }

  return {
    latitude: address.latitude,
    longitude: address.longitude,
    formattedAddress: address.formatted,
    placeId: address.placeId,
    confidence: address.confidence,
    // Prefer the provider's normalization, fall back to what was typed. The
    // stored address and the stored coordinates then describe the same place.
    addressLine1: address.addressLine1 ?? entered.addressLine1,
    addressLine2: address.addressLine2 ?? entered.addressLine2 ?? null,
    locality: address.locality ?? entered.locality,
    region: address.region ?? entered.region,
    postalCode: address.postalCode ?? entered.postalCode,
    country: (address.country ?? entered.country).toUpperCase().slice(0, 2),
  };
}

/** The confident answer, or `null` when the admin must choose. */
async function resolveOutcome(entered: CanonicalAddress): Promise<NormalizedAddress | null> {
  try {
    const outcome = await Geocoder.resolve(entered);
    return outcome.status === "exact" ? outcome.address : null;
  } catch (error) {
    if (error instanceof GeocoderError) throw asUnresolved(error);
    throw error;
  }
}

/** Candidate list for the admin's "did you mean" step. Never stores anything. */
export async function searchAddressCandidates(
  entered: CanonicalAddress | string,
): Promise<AddressCandidate[]> {
  try {
    const candidates = await Geocoder.search(entered);
    return candidates.map(toCandidate);
  } catch (error) {
    if (error instanceof GeocoderError) throw asUnresolved(error);
    throw error;
  }
}

/**
 * Whether two saves describe the same place.
 *
 * Only a *material* change re-geocodes. Fixing a typo in the HOA's legal name,
 * or its timezone, must not spend a provider call or reset a verified status;
 * changing the street, city, region, postal code, or country must do both.
 */
export function isMaterialAddressChange(
  before: CanonicalAddress | null,
  after: CanonicalAddress,
): boolean {
  if (!before) return true;
  return canonicalAddressLine(before) !== canonicalAddressLine(after);
}

/** True when a unit carries an address of its own rather than inheriting. */
export function hasDistinctAddress(unit: {
  addressLine1?: string | null;
  locality?: string | null;
  region?: string | null;
  postalCode?: string | null;
}): boolean {
  return Boolean(unit.addressLine1?.trim());
}
