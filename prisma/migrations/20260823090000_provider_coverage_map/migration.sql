-- Provider coverage map: a service area is now a real, editable circle with
-- enough saved address context to redraw the provider's own selection later.

ALTER TABLE "ProviderServiceArea"
  ADD COLUMN IF NOT EXISTS "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "formattedAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "locality" TEXT,
  ADD COLUMN IF NOT EXISTS "region" TEXT,
  ADD COLUMN IF NOT EXISTS "postalCode" TEXT,
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT;

-- Coordinate sanity and the product radius ceiling, enforced by the database
-- rather than only by Zod. 100 miles is the encoded product limit; see
-- SERVICE_RADIUS_MAX_MILES in src/lib/provider-coverage.ts. Rows written under
-- the older 200-mile schema are clamped first so the CHECK can be added.
UPDATE "ProviderServiceArea" SET "radiusMiles" = 100 WHERE "radiusMiles" > 100;
UPDATE "ProviderServiceArea" SET "radiusMiles" = 1 WHERE "radiusMiles" IS NOT NULL AND "radiusMiles" < 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'provider_service_area_geometry_check'
  ) THEN
    ALTER TABLE "ProviderServiceArea"
      ADD CONSTRAINT "provider_service_area_geometry_check" CHECK (
        (
          "centerLatitude" IS NULL
          AND "centerLongitude" IS NULL
          AND "radiusMiles" IS NULL
        )
        OR (
          "centerLatitude" IS NOT NULL
          AND "centerLongitude" IS NOT NULL
          AND "radiusMiles" IS NOT NULL
          AND "centerLatitude" BETWEEN -90 AND 90
          AND "centerLongitude" BETWEEN -180 AND 180
          AND "radiusMiles" BETWEEN 1 AND 100
        )
      );
  END IF;
END
$$;

-- A provider has at most one active primary area. Prisma cannot express a
-- partial unique index, so it lives here; a future `prisma migrate dev` will
-- not know about it and must not be allowed to drop it.
CREATE UNIQUE INDEX IF NOT EXISTS "provider_service_area_one_active_primary"
  ON "ProviderServiceArea" ("providerUserId")
  WHERE "isPrimary" = true AND "status" = 'active';

-- The bounding-box prefilter used by opportunity matching reads active
-- circles by provider; this index keeps that scan off a sequential read.
CREATE INDEX IF NOT EXISTS "ProviderServiceArea_status_center_idx"
  ON "ProviderServiceArea" ("status", "centerLatitude", "centerLongitude");

-- Existing providers who have exactly one active area keep it as their
-- primary, so the profile editor opens on something real rather than forcing
-- them to re-pick an area they already saved.
UPDATE "ProviderServiceArea" a
SET "isPrimary" = true
WHERE a."status" = 'active'
  AND a."centerLatitude" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ProviderServiceArea" b
    WHERE b."providerUserId" = a."providerUserId"
      AND b."status" = 'active'
      AND b."isPrimary" = true
  )
  AND a."id" = (
    SELECT c."id" FROM "ProviderServiceArea" c
    WHERE c."providerUserId" = a."providerUserId"
      AND c."status" = 'active'
      AND c."centerLatitude" IS NOT NULL
    ORDER BY c."createdAt" ASC, c."id" ASC
    LIMIT 1
  );
