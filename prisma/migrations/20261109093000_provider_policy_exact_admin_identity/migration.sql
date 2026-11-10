-- Preserve the reviewed grant’s exact user binding, not just its email.
-- A prepared policy edit must retain its manager/admin authority at commit.
CREATE OR REPLACE FUNCTION bundleen_assert_provider_policy_manager(actor_id text, community_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c_status text; c_type text; actor_email text;
BEGIN
  SELECT "status"::text, "type"::text INTO c_status, c_type FROM "Community" WHERE "id" = community_id FOR SHARE;
  IF c_type IS DISTINCT FROM 'hoa' THEN
    RAISE EXCEPTION 'Provider policy requires an HOA' USING ERRCODE = 'P1703';
  END IF;
  SELECT "email" INTO actor_email FROM "User" WHERE "id" = actor_id AND "role" = 'admin' AND "isVerified" = true FOR SHARE;
  IF FOUND THEN
    PERFORM 1 FROM "AdminAccessGrant" WHERE "userId" = actor_id AND "email" = lower(actor_email) AND "status" = 'active' AND "isStaffAccount" = false FOR SHARE;
    IF FOUND THEN RETURN; END IF;
  END IF;
  IF c_status = 'active' THEN
    PERFORM 1 FROM "User" WHERE "id" = actor_id FOR SHARE;
    IF FOUND THEN
      PERFORM 1 FROM "CommunityStaffAssignment" WHERE "communityId" = community_id AND "userId" = actor_id
        AND "role" = 'hoa_manager' AND "status" = 'active' FOR SHARE;
      IF FOUND THEN RETURN; END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Prepared provider policy authority changed' USING ERRCODE = 'P1703';
END;
$$;
