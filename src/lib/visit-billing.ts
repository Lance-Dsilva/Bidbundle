/**
 * Allocate an optional request's whole-job quote across the frozen roster and
 * service rounds. Callers must use indices from the same immutable snapshot.
 * Divide by home first so no two households differ by more than one cent over
 * the whole job, then distribute each household's remainder over its visits.
 */
export function allocateVisitCents(
  totalCents: number,
  homeCount: number,
  roundCount: number,
  homeIndex: number,
  roundIndex: number,
): number {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new RangeError("Expected a nonnegative whole-job amount in cents");
  }
  validateIndex(homeIndex, homeCount, "home");
  validateIndex(roundIndex, roundCount, "round");

  const total = BigInt(totalCents);
  const homes = BigInt(homeCount);
  const rounds = BigInt(roundCount);
  const homeCents = total / homes + (BigInt(homeIndex) < total % homes ? BigInt(1) : BigInt(0));
  return Number(homeCents / rounds + (BigInt(roundIndex) < homeCents % rounds ? BigInt(1) : BigInt(0)));
}

function validateIndex(index: number, count: number, label: string): void {
  if (!Number.isSafeInteger(count) || count < 1 ||
      !Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`Invalid ${label} index or count`);
  }
}
