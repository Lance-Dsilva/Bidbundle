BEGIN READ ONLY;
SELECT count(*) AS duplicate_active_hoa_manager_communities
FROM (
  SELECT "communityId"
  FROM public."CommunityStaffAssignment"
  WHERE "status" = 'active' AND "role" = 'hoa_manager'
  GROUP BY "communityId"
  HAVING count(*) > 1
) duplicates;

SELECT
  count(*) FILTER (
    WHERE s."role" = 'neighborhood_manager'
      AND (u."role"::text IS DISTINCT FROM 'homeowner'
        OR c."type"::text IS DISTINCT FROM 'neighborhood')
  ) AS invalid_neighborhood_manager_identity_or_community,
  count(*) FILTER (
    WHERE s."role" = 'neighborhood_manager'
      AND m."status"::text IS DISTINCT FROM 'active'
  ) AS neighborhood_manager_without_active_membership,
  count(*) FILTER (
    WHERE s."role" IN ('hoa_manager', 'hoa_team')
      AND (u."role"::text IS DISTINCT FROM 'hoa_staff'
        OR c."type"::text IS DISTINCT FROM 'hoa')
  ) AS invalid_hoa_staff_identity_or_community
FROM public."CommunityStaffAssignment" s
LEFT JOIN public."Community" c ON c."id" = s."communityId"
LEFT JOIN public."User" u ON u."id" = s."userId"
LEFT JOIN public."CommunityMembership" m
  ON m."communityId" = s."communityId" AND m."userId" = s."userId"
WHERE s."status" = 'active';
COMMIT;
