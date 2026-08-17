-- Bundleen admin-portal demo fixtures.
--
-- These rows are intentionally synthetic:
-- - `.example` email addresses cannot receive mail.
-- - `demo_clerk_*` identifiers do not represent Clerk accounts and cannot sign in.
-- - addresses are broad Austin area labels, not private residences.
--
-- The script is idempotent for its fixed `demo_*` records. Run explicitly with:
--   npm run seed:demo-communities

BEGIN;

INSERT INTO "Community" (
  "id",
  "name",
  "type",
  "status",
  "centerLatitude",
  "centerLongitude",
  "radiusMiles",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'demo_community_domain',
    'Domain Area Demo Neighborhood',
    'neighborhood',
    'active',
    30.4020,
    -97.7250,
    4,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_community_north_austin_hoa',
    'North Austin Demo HOA',
    'hoa',
    'active',
    NULL,
    NULL,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "type" = EXCLUDED."type",
  "status" = EXCLUDED."status",
  "centerLatitude" = EXCLUDED."centerLatitude",
  "centerLongitude" = EXCLUDED."centerLongitude",
  "radiusMiles" = EXCLUDED."radiusMiles",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "User" (
  "id",
  "clerkUserId",
  "email",
  "fullName",
  "role",
  "isVerified",
  "address",
  "neighborhood",
  "latitude",
  "longitude",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'demo_user_domain_01',
    'demo_clerk_domain_01',
    'domain.homeowner01@example.com',
    'Domain Demo Homeowner 1',
    'homeowner',
    true,
    'The Domain area, Austin, TX 78758',
    'The Domain',
    30.4020,
    -97.7250,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_user_domain_02',
    'demo_clerk_domain_02',
    'domain.homeowner02@example.com',
    'Domain Demo Homeowner 2',
    'homeowner',
    true,
    'North Burnet area, Austin, TX 78758',
    'North Burnet',
    30.3928,
    -97.7200,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_user_domain_03',
    'demo_clerk_domain_03',
    'domain.homeowner03@example.com',
    'Domain Demo Homeowner 3',
    'homeowner',
    true,
    'McKalla area, Austin, TX 78758',
    'McKalla',
    30.3879,
    -97.7190,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_user_domain_04',
    'demo_clerk_domain_04',
    'domain.homeowner04@example.com',
    'Domain Demo Homeowner 4',
    'homeowner',
    true,
    'Balcones Woods area, Austin, TX 78759',
    'Balcones Woods',
    30.4080,
    -97.7440,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_user_domain_05',
    'demo_clerk_domain_05',
    'domain.homeowner05@example.com',
    'Domain Demo Homeowner 5',
    'homeowner',
    true,
    'Gracywoods area, Austin, TX 78758',
    'Gracywoods',
    30.4150,
    -97.7060,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_user_hoa_01',
    'demo_clerk_hoa_01',
    'northhoa.resident01@example.com',
    'North HOA Demo Resident 1',
    'homeowner',
    true,
    'Wells Branch area, Austin, TX 78728',
    'Wells Branch',
    30.4450,
    -97.6790,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_user_hoa_02',
    'demo_clerk_hoa_02',
    'northhoa.resident02@example.com',
    'North HOA Demo Resident 2',
    'homeowner',
    true,
    'Scofield Farms area, Austin, TX 78727',
    'Scofield Farms',
    30.4310,
    -97.6990,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_user_hoa_03',
    'demo_clerk_hoa_03',
    'northhoa.resident03@example.com',
    'North HOA Demo Resident 3',
    'homeowner',
    true,
    'Tech Ridge area, Austin, TX 78753',
    'Tech Ridge',
    30.4100,
    -97.6650,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_user_hoa_04',
    'demo_clerk_hoa_04',
    'northhoa.resident04@example.com',
    'North HOA Demo Resident 4',
    'homeowner',
    true,
    'North Austin area, Austin, TX 78727',
    'North Austin',
    30.4250,
    -97.7130,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_user_hoa_05',
    'demo_clerk_hoa_05',
    'northhoa.resident05@example.com',
    'North HOA Demo Resident 5',
    'homeowner',
    true,
    'Wells Branch area, Austin, TX 78728',
    'Wells Branch',
    30.4510,
    -97.6900,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_user_hoa_manager',
    'demo_clerk_hoa_manager',
    'northhoa.manager@example.com',
    'North HOA Demo Manager',
    'homeowner',
    true,
    NULL,
    NULL,
    NULL,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE
SET
  "clerkUserId" = EXCLUDED."clerkUserId",
  "email" = EXCLUDED."email",
  "fullName" = EXCLUDED."fullName",
  "role" = EXCLUDED."role",
  "isVerified" = EXCLUDED."isVerified",
  "address" = EXCLUDED."address",
  "neighborhood" = EXCLUDED."neighborhood",
  "latitude" = EXCLUDED."latitude",
  "longitude" = EXCLUDED."longitude",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "HomeownerProfile" (
  "id",
  "userId",
  "serviceRadiusMi",
  "createdAt",
  "updatedAt"
)
SELECT
  'demo_profile_' || fixture."id",
  fixture."id",
  4,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    ('demo_user_domain_01'),
    ('demo_user_domain_02'),
    ('demo_user_domain_03'),
    ('demo_user_domain_04'),
    ('demo_user_domain_05'),
    ('demo_user_hoa_01'),
    ('demo_user_hoa_02'),
    ('demo_user_hoa_03'),
    ('demo_user_hoa_04'),
    ('demo_user_hoa_05'),
    ('demo_user_hoa_manager')
) AS fixture("id")
ON CONFLICT ("userId") DO UPDATE
SET
  "serviceRadiusMi" = EXCLUDED."serviceRadiusMi",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "CommunityMembership" (
  "id",
  "communityId",
  "userId",
  "status",
  "joinedAt",
  "isPrimary",
  "isAdminOverride",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'demo_membership_domain_01',
    'demo_community_domain',
    'demo_user_domain_01',
    'active',
    CURRENT_TIMESTAMP,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_membership_domain_02',
    'demo_community_domain',
    'demo_user_domain_02',
    'active',
    CURRENT_TIMESTAMP,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_membership_domain_03',
    'demo_community_domain',
    'demo_user_domain_03',
    'active',
    CURRENT_TIMESTAMP,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_membership_domain_04',
    'demo_community_domain',
    'demo_user_domain_04',
    'active',
    CURRENT_TIMESTAMP,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_membership_domain_05',
    'demo_community_domain',
    'demo_user_domain_05',
    'active',
    CURRENT_TIMESTAMP,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_membership_hoa_01',
    'demo_community_north_austin_hoa',
    'demo_user_hoa_01',
    'active',
    CURRENT_TIMESTAMP,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_membership_hoa_02',
    'demo_community_north_austin_hoa',
    'demo_user_hoa_02',
    'active',
    CURRENT_TIMESTAMP,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_membership_hoa_03',
    'demo_community_north_austin_hoa',
    'demo_user_hoa_03',
    'active',
    CURRENT_TIMESTAMP,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_membership_hoa_04',
    'demo_community_north_austin_hoa',
    'demo_user_hoa_04',
    'active',
    CURRENT_TIMESTAMP,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_membership_hoa_05',
    'demo_community_north_austin_hoa',
    'demo_user_hoa_05',
    'active',
    CURRENT_TIMESTAMP,
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("communityId", "userId") DO UPDATE
SET
  "status" = EXCLUDED."status",
  "joinedAt" = EXCLUDED."joinedAt",
  "isPrimary" = EXCLUDED."isPrimary",
  "isAdminOverride" = EXCLUDED."isAdminOverride",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "CommunityStaffAssignment" (
  "id",
  "communityId",
  "userId",
  "role",
  "status",
  "assignedByUserId",
  "assignedAt"
)
VALUES
  (
    'demo_assignment_domain_manager',
    'demo_community_domain',
    'demo_user_domain_01',
    'neighborhood_manager',
    'active',
    NULL,
    CURRENT_TIMESTAMP
  ),
  (
    'demo_assignment_hoa_manager',
    'demo_community_north_austin_hoa',
    'demo_user_hoa_manager',
    'hoa_manager',
    'active',
    NULL,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("id") DO UPDATE
SET
  "status" = 'active',
  "assignedAt" = CURRENT_TIMESTAMP,
  "revokedAt" = NULL,
  "revokedByUserId" = NULL;

INSERT INTO "AdminAuditLog" (
  "id",
  "actorUserId",
  "action",
  "targetType",
  "targetId",
  "communityId",
  "metadata",
  "createdAt"
)
SELECT
  fixture."auditId",
  NULL,
  'community_created',
  'community',
  fixture."communityId",
  fixture."communityId",
  fixture."metadata"::jsonb,
  CURRENT_TIMESTAMP
FROM (
  VALUES
    (
      'demo_audit_domain_community_created',
      'demo_community_domain',
      '{"type":"neighborhood","radiusMiles":4}'
    ),
    (
      'demo_audit_hoa_community_created',
      'demo_community_north_austin_hoa',
      '{"type":"hoa"}'
    )
) AS fixture("auditId", "communityId", "metadata")
WHERE NOT EXISTS (
  SELECT 1
  FROM "AdminAuditLog" audit
  WHERE audit."id" = fixture."auditId"
);

COMMIT;
