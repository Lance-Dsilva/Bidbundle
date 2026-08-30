-- Individual (non-HOA) homeowner requests.
--
-- These reuse `HoaServiceRequest`, the one request model the marketplace
-- already builds bids, agreements, and visits on. The HOA/non-HOA distinction
-- is carried by `Community.type`, not by a second table: a duplicate request
-- model would split "my requests" across two sources and give providers two
-- feeds to reconcile.
--
-- Only the money the earlier HOA-manager flow never needed is added here. HOA
-- requests are quoted by providers and carry no homeowner budget, so both
-- columns stay nullable and every existing row keeps working untouched.

-- Budget is stored in whole US cents, the same unit as `ServiceBid.amountCents`
-- and `ServiceAgreement`. No fractional cents, no per-row currency: one
-- documented unit across the money columns.
ALTER TABLE "HoaServiceRequest"
  ADD COLUMN IF NOT EXISTS "budgetMinCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "budgetMaxCents" INTEGER;

-- The database keeps the same promise the API validator does, so a future code
-- path cannot store an inverted or negative range by going around the schema.
-- The ceiling is $1,000,000 — far above any real home service, and well inside
-- INTEGER, so the column can never overflow.
ALTER TABLE "HoaServiceRequest"
  DROP CONSTRAINT IF EXISTS "HoaServiceRequest_budget_bounds";
ALTER TABLE "HoaServiceRequest"
  ADD CONSTRAINT "HoaServiceRequest_budget_bounds" CHECK (
    ("budgetMinCents" IS NULL) = ("budgetMaxCents" IS NULL)
    AND ("budgetMinCents" IS NULL OR "budgetMinCents" >= 0)
    AND ("budgetMaxCents" IS NULL OR "budgetMaxCents" <= 100000000)
    AND ("budgetMinCents" IS NULL OR "budgetMaxCents" >= "budgetMinCents")
  );

-- "My requests" reads by owner and orders by recency; without this it is a
-- sequential scan over every request in the marketplace.
CREATE INDEX IF NOT EXISTS "HoaServiceRequest_createdByUserId_createdAt_idx"
  ON "HoaServiceRequest"("createdByUserId", "createdAt");
