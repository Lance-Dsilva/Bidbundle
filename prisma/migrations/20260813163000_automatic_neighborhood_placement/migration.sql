-- Automatic neighborhood placement is an application decision, but these
-- checks must survive concurrent serverless requests. A per-community slot
-- makes the 50-homeowner capacity a unique-key invariant, while a current
-- automatic-placement key prevents one homeowner from being placed into two
-- generated neighborhoods by concurrent signups.

ALTER TABLE "CommunityMembership"
  ADD COLUMN "neighborhoodSlot" INTEGER;

ALTER TABLE "CommunityMembership"
  ADD CONSTRAINT "CommunityMembership_neighborhood_slot_bounds"
  CHECK (
    "neighborhoodSlot" IS NULL
    OR ("neighborhoodSlot" >= 1 AND "neighborhoodSlot" <= 50)
  );

-- Preserve existing memberships conservatively. Only one current automatic
-- placement per homeowner and the first 50 per community receive slots; any
-- grandfathered duplicates/overflow remain visible for admin review.
WITH ranked AS (
  SELECT
    membership."id",
    ROW_NUMBER() OVER (
      PARTITION BY membership."communityId"
      ORDER BY membership."createdAt", membership."id"
    ) AS slot,
    ROW_NUMBER() OVER (
      PARTITION BY membership."userId"
      ORDER BY membership."createdAt", membership."id"
    ) AS user_position
  FROM "CommunityMembership" membership
  JOIN "Community" community ON community."id" = membership."communityId"
  WHERE community."type" = 'neighborhood'
    AND membership."status" IN ('active', 'pending')
    AND NOT membership."isAdminOverride"
)
UPDATE "CommunityMembership" membership
SET "neighborhoodSlot" = ranked.slot
FROM ranked
WHERE membership."id" = ranked."id"
  AND ranked.slot <= 50
  AND ranked.user_position = 1;

CREATE UNIQUE INDEX "CommunityMembership_current_neighborhood_slot_key"
  ON "CommunityMembership" ("communityId", "neighborhoodSlot")
  WHERE "status" IN ('active', 'pending')
    AND NOT "isAdminOverride"
    AND "neighborhoodSlot" IS NOT NULL;

CREATE UNIQUE INDEX "CommunityMembership_one_current_automatic_neighborhood_key"
  ON "CommunityMembership" ("userId")
  WHERE "status" IN ('active', 'pending')
    AND NOT "isAdminOverride"
    AND "neighborhoodSlot" IS NOT NULL;

CREATE OR REPLACE FUNCTION "bundleen_validate_automatic_neighborhood_membership"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  community_type TEXT;
  available_slot INTEGER;
BEGIN
  -- Removed history does not reserve neighborhood capacity.
  IF NEW."status" NOT IN ('active', 'pending') THEN
    NEW."neighborhoodSlot" := NULL;
    RETURN NEW;
  END IF;

  -- A status-only update on an existing HOA or explicit override must not
  -- wait on community/user locks: those rows do not participate in automatic
  -- matching or its capacity accounting.
  IF NEW."isAdminOverride" THEN
    NEW."neighborhoodSlot" := NULL;
    RETURN NEW;
  END IF;

  SELECT "type"::text INTO community_type
  FROM "Community"
  WHERE "id" = NEW."communityId"
  FOR UPDATE;

  -- Serialize automatic placement against an HOA membership being added for
  -- the same homeowner. Lock order is Community then User everywhere here.
  PERFORM 1
  FROM "User"
  WHERE "id" = NEW."userId"
  FOR UPDATE;

  -- Multiple HOA rows remain allowed for legitimate overlapping associations
  -- and historical product cases. If an admin adds an HOA membership, the
  -- neighborhood row is handled through the ordinary audited removal flow;
  -- this trigger only governs automatic neighborhood writes.
  IF community_type = 'hoa' THEN
    IF EXISTS (
      SELECT 1
      FROM "CommunityMembership"
      WHERE "userId" = NEW."userId"
        AND "status" IN ('active', 'pending')
        AND "neighborhoodSlot" IS NOT NULL
        AND "id" <> NEW."id"
    ) THEN
      RAISE EXCEPTION 'homeowner has a current neighborhood membership'
        USING
          ERRCODE = 'check_violation',
          CONSTRAINT = 'CommunityMembership_hoa_neighborhood_exclusive';
    END IF;

    NEW."neighborhoodSlot" := NULL;
    RETURN NEW;
  END IF;

  IF community_type IS DISTINCT FROM 'neighborhood' THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1
    FROM "CommunityMembership" membership
    JOIN "Community" community ON community."id" = membership."communityId"
    WHERE membership."userId" = NEW."userId"
      AND membership."status" IN ('active', 'pending')
      AND membership."id" <> NEW."id"
      AND community."type" = 'hoa'
  ) THEN
    RAISE EXCEPTION 'HOA resident cannot join a location-based neighborhood'
      USING
        ERRCODE = 'check_violation',
        CONSTRAINT = 'CommunityMembership_hoa_neighborhood_exclusive';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CommunityMembership"
    WHERE "userId" = NEW."userId"
      AND "status" IN ('active', 'pending')
      AND "id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'homeowner already has a current community membership'
      USING
        ERRCODE = 'unique_violation',
        CONSTRAINT = 'CommunityMembership_one_automatic_current_community';
  END IF;

  -- Preserve a valid slot during an update. New/reactivated rows take the
  -- first free slot; a concurrent request selecting the same slot loses the
  -- partial-unique-index race and the whole placement transaction rolls back.
  IF NEW."neighborhoodSlot" IS NULL THEN
    SELECT candidate.slot INTO available_slot
    FROM GENERATE_SERIES(1, 50) AS candidate(slot)
    WHERE NOT EXISTS (
      SELECT 1
      FROM "CommunityMembership"
      WHERE "communityId" = NEW."communityId"
        AND "status" IN ('active', 'pending')
        AND NOT "isAdminOverride"
        AND "neighborhoodSlot" = candidate.slot
        AND "id" <> NEW."id"
    )
    ORDER BY candidate.slot
    LIMIT 1;

    IF available_slot IS NULL THEN
      RAISE EXCEPTION 'neighborhood has reached automatic placement capacity'
        USING
          ERRCODE = 'unique_violation',
          CONSTRAINT = 'CommunityMembership_automatic_neighborhood_capacity';
    END IF;

    NEW."neighborhoodSlot" := available_slot;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "CommunityMembership_validate_automatic_neighborhood"
  BEFORE INSERT OR UPDATE OF "communityId", "userId", "status", "isAdminOverride"
  ON "CommunityMembership"
  FOR EACH ROW
  EXECUTE FUNCTION "bundleen_validate_automatic_neighborhood_membership"();

-- Bounding boxes are the first stage of nearby-homeowner lookup. The partial
-- index contains only accounts the automatic matcher is allowed to consider.
CREATE INDEX "User_verified_homeowner_location_idx"
  ON "User" ("latitude", "longitude")
  WHERE "role" = 'homeowner'
    AND "isVerified" = true
    AND "latitude" IS NOT NULL
    AND "longitude" IS NOT NULL;
