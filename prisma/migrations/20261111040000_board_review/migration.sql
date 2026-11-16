-- AlterEnum
ALTER TYPE "CommunityInvitationRole" ADD VALUE 'hoa_board';

-- CreateTable
CREATE TABLE "CommunityBoardMember" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "invitedByUserId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CommunityBoardMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityBoardPolicy" (
    "communityId" TEXT NOT NULL,
    "rule" TEXT NOT NULL DEFAULT 'manager_only',
    "quorumN" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityBoardPolicy_pkey" PRIMARY KEY ("communityId")
);

-- CreateTable
CREATE TABLE "BoardReviewRound" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "openedByUserId" TEXT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "rule" TEXT NOT NULL,
    "quorumN" INTEGER,
    "threshold" INTEGER NOT NULL,
    "electorate" JSONB NOT NULL,
    "proposals" JSONB NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "awardedBidId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardReviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardProposalVote" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "voterUserId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardProposalVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardDiscussionMessage" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardDiscussionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardAuditEvent" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "requestId" TEXT,
    "roundId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunityBoardMember_userId_status_idx" ON "CommunityBoardMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityBoardMember_communityId_userId_key" ON "CommunityBoardMember"("communityId", "userId");

-- CreateIndex
CREATE INDEX "BoardReviewRound_requestId_createdAt_idx" ON "BoardReviewRound"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoardProposalVote_roundId_bidId_voterUserId_key" ON "BoardProposalVote"("roundId", "bidId", "voterUserId");

-- CreateIndex
CREATE INDEX "BoardDiscussionMessage_roundId_createdAt_idx" ON "BoardDiscussionMessage"("roundId", "createdAt");

-- CreateIndex
CREATE INDEX "BoardAuditEvent_communityId_createdAt_idx" ON "BoardAuditEvent"("communityId", "createdAt");

-- AddForeignKey
ALTER TABLE "CommunityBoardMember" ADD CONSTRAINT "CommunityBoardMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBoardMember" ADD CONSTRAINT "CommunityBoardMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBoardMember" ADD CONSTRAINT "CommunityBoardMember_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBoardPolicy" ADD CONSTRAINT "CommunityBoardPolicy_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBoardPolicy" ADD CONSTRAINT "CommunityBoardPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardReviewRound" ADD CONSTRAINT "BoardReviewRound_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardReviewRound" ADD CONSTRAINT "BoardReviewRound_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HoaServiceRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardReviewRound" ADD CONSTRAINT "BoardReviewRound_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardProposalVote" ADD CONSTRAINT "BoardProposalVote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BoardReviewRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardProposalVote" ADD CONSTRAINT "BoardProposalVote_voterUserId_fkey" FOREIGN KEY ("voterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardDiscussionMessage" ADD CONSTRAINT "BoardDiscussionMessage_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BoardReviewRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardDiscussionMessage" ADD CONSTRAINT "BoardDiscussionMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardAuditEvent" ADD CONSTRAINT "BoardAuditEvent_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardAuditEvent" ADD CONSTRAINT "BoardAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every board mutation serializes on its community; award/vote paths lock the
-- request first. This prevents roster/policy phantoms during final confirmation.
ALTER TABLE "CommunityBoardMember" ADD CONSTRAINT "BoardMember_state" CHECK
 ("status" IN ('active','revoked') AND (("status"='active' AND "revokedAt" IS NULL) OR ("status"='revoked' AND "revokedAt" IS NOT NULL)));
ALTER TABLE "CommunityBoardPolicy" ADD CONSTRAINT "BoardPolicy_rule" CHECK
 ("version">0 AND "rule" IN ('manager_only','board_majority','board_quorum_n','board_unanimous') AND
 (("rule"='board_quorum_n' AND "quorumN" IS NOT NULL AND "quorumN" BETWEEN 1 AND 100) OR ("rule"<>'board_quorum_n' AND "quorumN" IS NULL)));
ALTER TABLE "BoardReviewRound" ADD CONSTRAINT "BoardRound_state" CHECK
 ("rule" IN ('board_majority','board_quorum_n','board_unanimous') AND "policyVersion">0 AND "threshold" BETWEEN 1 AND 100 AND
 (("rule"='board_quorum_n' AND "quorumN" IS NOT NULL AND "quorumN" BETWEEN 1 AND 100) OR ("rule"<>'board_quorum_n' AND "quorumN" IS NULL)) AND
 jsonb_typeof("electorate")='array' AND jsonb_array_length("electorate") BETWEEN 1 AND 100 AND
 jsonb_typeof("proposals")='array' AND jsonb_array_length("proposals") BETWEEN 1 AND 20 AND
 (("status"='open' AND "closedAt" IS NULL AND "awardedBidId" IS NULL) OR
 ("status"='cancelled' AND "closedAt" IS NOT NULL AND "awardedBidId" IS NULL) OR
 ("status"='awarded' AND "closedAt" IS NOT NULL AND "awardedBidId" IS NOT NULL)));
CREATE UNIQUE INDEX "BoardReviewRound_one_open" ON "BoardReviewRound"("requestId") WHERE "status"='open';
ALTER TABLE "BoardProposalVote" ADD CONSTRAINT "BoardVote_content" CHECK
 ("decision" IN ('approve','reject') AND ("comment" IS NULL OR length("comment")<=2000));
ALTER TABLE "BoardDiscussionMessage" ADD CONSTRAINT "BoardComment_content" CHECK (length(btrim("body")) BETWEEN 1 AND 4000);

CREATE FUNCTION bundleen_assert_board_manager(actor_id text, community_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM "Community" WHERE id=community_id AND type='hoa' AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'An active HOA is required' USING ERRCODE='P1761'; END IF;
 PERFORM 1 FROM "User" WHERE id=actor_id AND "isVerified" FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Board manager authority is required' USING ERRCODE='P1761'; END IF;
 PERFORM 1 FROM "CommunityStaffAssignment" WHERE "communityId"=community_id AND "userId"=actor_id AND role='hoa_manager' AND status='active' FOR SHARE;
 IF FOUND THEN RETURN; END IF;
 PERFORM 1 FROM "User" u JOIN "AdminAccessGrant" a ON a."userId"=u.id AND a.email=lower(u.email)
  WHERE u.id=actor_id AND u.role='admin' AND u."isVerified" AND a.status='active' AND NOT a."isStaffAccount" FOR SHARE OF u,a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Board manager authority is required' USING ERRCODE='P1761'; END IF;
END $$;
CREATE FUNCTION bundleen_assert_board_viewer(actor_id text, community_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM "Community" WHERE id=community_id AND type='hoa' AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'An active HOA is required' USING ERRCODE='P1761'; END IF;
 PERFORM 1 FROM "User" WHERE id=actor_id AND "isVerified" FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Board access is required' USING ERRCODE='P1761'; END IF;
 PERFORM 1 FROM "CommunityBoardMember" WHERE "communityId"=community_id AND "userId"=actor_id AND status='active' FOR SHARE;
 IF FOUND THEN RETURN; END IF;
 PERFORM bundleen_assert_board_manager(actor_id,community_id);
END $$;

CREATE FUNCTION bundleen_guard_board_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Revoke board membership without deleting its history' USING ERRCODE='P1762'; END IF;
 PERFORM 1 FROM "Community" WHERE id=NEW."communityId" FOR UPDATE;
 IF TG_OP='UPDATE' AND (OLD.id,OLD."communityId",OLD."userId") IS DISTINCT FROM (NEW.id,NEW."communityId",NEW."userId") THEN
  RAISE EXCEPTION 'Board membership identity is immutable' USING ERRCODE='P1762'; END IF;
 IF TG_OP='INSERT' OR (OLD.status='revoked' AND NEW.status='active') THEN NEW."joinedAt":=clock_timestamp(); END IF;
 IF TG_OP='UPDATE' AND OLD.status='active' AND NEW.status='revoked' THEN NEW."revokedAt":=clock_timestamp(); END IF;
 IF TG_OP='UPDATE' AND OLD.status='revoked' AND NEW.status='revoked' AND
  (OLD."revokedAt",OLD."joinedAt",OLD."invitedByUserId") IS DISTINCT FROM (NEW."revokedAt",NEW."joinedAt",NEW."invitedByUserId") THEN
  RAISE EXCEPTION 'Revoked membership history is immutable' USING ERRCODE='P1762'; END IF;
 IF NEW.status='active' AND (TG_OP='INSERT' OR OLD.status<>'active' OR OLD."joinedAt" IS DISTINCT FROM NEW."joinedAt") THEN
  PERFORM bundleen_assert_board_manager(NEW."invitedByUserId",NEW."communityId");
  IF NOT EXISTS(SELECT 1 FROM "CommunityInvitation" i JOIN "User" u ON u.id=NEW."userId"
   WHERE i."communityId"=NEW."communityId" AND i.role::text='hoa_board' AND i.status='accepted'
    AND i."acceptedByUserId"=u.id AND lower(i.email)=lower(u.email) AND u."isVerified"
    AND i."invitedByUserId"=NEW."invitedByUserId" AND i."acceptedAt" IS NOT NULL
    AND i."expiresAt">i."acceptedAt" AND NEW."joinedAt">=i."acceptedAt"
    AND (TG_OP='INSERT' OR OLD.status<>'revoked' OR i."acceptedAt">=OLD."revokedAt")) THEN
   RAISE EXCEPTION 'An accepted email-bound board invitation is required' USING ERRCODE='P1761'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='active' AND NEW.status='active' AND
 (OLD."joinedAt",OLD."invitedByUserId") IS DISTINCT FROM (NEW."joinedAt",NEW."invitedByUserId") THEN
  RAISE EXCEPTION 'Active board membership cannot be rewritten' USING ERRCODE='P1762'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "BoardMember_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CommunityBoardMember" FOR EACH ROW EXECUTE FUNCTION bundleen_guard_board_member();
CREATE FUNCTION bundleen_guard_board_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Board policy history cannot be reset' USING ERRCODE='P1762'; END IF;
 PERFORM 1 FROM "Community" WHERE id=NEW."communityId" FOR UPDATE;
 PERFORM bundleen_assert_board_manager(NEW."updatedByUserId",NEW."communityId");
 IF (TG_OP='INSERT' AND NEW.version<>1) OR (TG_OP='UPDATE' AND (NEW."communityId"<>OLD."communityId" OR NEW.version<>OLD.version+1)) THEN
  RAISE EXCEPTION 'Board policy must advance exactly one version' USING ERRCODE='P1762'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "BoardPolicy_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CommunityBoardPolicy" FOR EACH ROW EXECUTE FUNCTION bundleen_guard_board_policy();

-- This helper is also invoked by both SQL award entry points. It validates the
-- entire electorate and shortlist, not just the selected provider.
CREATE FUNCTION bundleen_assert_board_round(round_id text, check_deadline boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r "BoardReviewRound"%ROWTYPE; p "CommunityBoardPolicy"%ROWTYPE; request_status text; cid text; rid text;
BEGIN
 SELECT "requestId","communityId" INTO rid,cid FROM "BoardReviewRound" WHERE id=round_id;
 IF rid IS NULL THEN RAISE EXCEPTION 'Board review not found' USING ERRCODE='P1762'; END IF;
 SELECT status::text INTO request_status FROM "HoaServiceRequest" WHERE id=rid FOR UPDATE;
 PERFORM 1 FROM "Community" WHERE id=cid AND type='hoa' AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This HOA is not active' USING ERRCODE='P1762'; END IF;
 SELECT * INTO r FROM "BoardReviewRound" WHERE id=round_id FOR SHARE;
 SELECT * INTO p FROM "CommunityBoardPolicy" WHERE "communityId"=cid FOR SHARE;
 IF r.status<>'open' OR request_status NOT IN ('open_for_bids','bidding_closed','awarded') OR
 (p.version,p.rule,p."quorumN") IS DISTINCT FROM (r."policyVersion",r.rule,r."quorumN") THEN
  RAISE EXCEPTION 'Board review or policy changed; open a new review' USING ERRCODE='P1762'; END IF;
 IF check_deadline AND (r.deadline<=clock_timestamp() OR request_status='awarded') THEN
  RAISE EXCEPTION 'The board voting deadline has passed' USING ERRCODE='P1762'; END IF;
 PERFORM 1 FROM "CommunityBoardMember" WHERE "communityId"=cid FOR SHARE;
 PERFORM u.id FROM "User" u JOIN "CommunityBoardMember" m ON m."userId"=u.id WHERE m."communityId"=cid AND m.status='active' ORDER BY u.id FOR SHARE OF u;
 IF (SELECT count(*) FROM "CommunityBoardMember" WHERE "communityId"=cid AND status='active')<>jsonb_array_length(r.electorate)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.electorate) e WHERE NOT EXISTS(
  SELECT 1 FROM "CommunityBoardMember" m WHERE m.id=e->>'id' AND m."communityId"=cid AND m."userId"=e->>'userId'
   AND m.status='active' AND m."joinedAt"=(e->>'joinedAt')::timestamptz AND EXISTS(SELECT 1 FROM "User" u WHERE u.id=m."userId" AND u."isVerified"))) THEN
  RAISE EXCEPTION 'Board membership changed; open a new review' USING ERRCODE='P1762'; END IF;
 PERFORM b.id FROM "ServiceBid" b JOIN jsonb_array_elements(r.proposals) s ON b.id=s->>'bidId' FOR SHARE OF b;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.proposals) s WHERE NOT EXISTS(
  SELECT 1 FROM "ServiceBid" b WHERE b.id=s->>'bidId' AND b."requestId"=rid AND b.version=(s->>'version')::integer
  AND (b.status='submitted' OR (request_status='awarded' AND b.status IN ('accepted','rejected'))))) THEN
  RAISE EXCEPTION 'A shortlisted proposal changed; open a new review' USING ERRCODE='P1762'; END IF;
END $$;

CREATE FUNCTION bundleen_guard_board_round() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "CommunityBoardPolicy"%ROWTYPE; n integer; expected integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Board review history is immutable' USING ERRCODE='P1762'; END IF;
 PERFORM 1 FROM "HoaServiceRequest" WHERE id=NEW."requestId" AND "communityId"=NEW."communityId" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Board request scope mismatch' USING ERRCODE='P1762'; END IF;
 PERFORM 1 FROM "Community" WHERE id=NEW."communityId" FOR UPDATE;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','closedAt','awardedBidId']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','closedAt','awardedBidId']) OR
    OLD.status<>'open' OR NEW.status NOT IN ('cancelled','awarded') THEN
   RAISE EXCEPTION 'Board review snapshots and closed history are immutable' USING ERRCODE='P1762'; END IF;
  IF NEW.status='awarded' AND NOT EXISTS(SELECT 1 FROM "ServiceAgreement" WHERE "requestId"=NEW."requestId" AND "bidId"=NEW."awardedBidId") THEN
   RAISE EXCEPTION 'A confirmed agreement is required to close the board award' USING ERRCODE='P1762'; END IF;
  RETURN NEW;
 END IF;
 PERFORM bundleen_assert_board_manager(NEW."openedByUserId",NEW."communityId");
 SELECT * INTO p FROM "CommunityBoardPolicy" WHERE "communityId"=NEW."communityId" FOR SHARE;
 SELECT count(*) INTO n FROM "CommunityBoardMember" WHERE "communityId"=NEW."communityId" AND status='active';
 expected:=CASE p.rule WHEN 'board_majority' THEN n/2+1 WHEN 'board_unanimous' THEN n WHEN 'board_quorum_n' THEN p."quorumN" ELSE 0 END;
 IF NEW.status<>'open' OR (NEW."policyVersion",NEW.rule,NEW."quorumN") IS DISTINCT FROM (p.version,p.rule,p."quorumN") OR
 expected IS NULL OR expected<1 OR expected>n OR NEW.threshold<>expected OR n<>jsonb_array_length(NEW.electorate) OR
 NEW.deadline<=clock_timestamp() OR NEW.deadline>clock_timestamp()+interval '30 days' OR
 NOT EXISTS(SELECT 1 FROM "HoaServiceRequest" WHERE id=NEW."requestId" AND status IN ('open_for_bids','bidding_closed') AND "participantsLockedAt" IS NOT NULL) THEN
  RAISE EXCEPTION 'Invalid board policy, electorate, request or deadline' USING ERRCODE='P1762'; END IF;
 IF (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(NEW.electorate) e)<>n OR
 EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.electorate) e WHERE NOT EXISTS(SELECT 1 FROM "CommunityBoardMember" m
 WHERE m.id=e->>'id' AND m."userId"=e->>'userId' AND m."communityId"=NEW."communityId" AND m.status='active' AND m."joinedAt"=(e->>'joinedAt')::timestamptz AND EXISTS(SELECT 1 FROM "User" u WHERE u.id=m."userId" AND u."isVerified"))) THEN
  RAISE EXCEPTION 'Board electorate must match current active members' USING ERRCODE='P1762'; END IF;
 IF (SELECT count(DISTINCT s->>'bidId') FROM jsonb_array_elements(NEW.proposals) s)<>jsonb_array_length(NEW.proposals) OR
 EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.proposals) s WHERE NOT EXISTS(SELECT 1 FROM "ServiceBid" b
 WHERE b.id=s->>'bidId' AND b."requestId"=NEW."requestId" AND b.status='submitted' AND b.version=(s->>'version')::integer
 AND b."providerUserId"=s->>'providerUserId' AND b."amountCents"=(s->>'amountCents')::integer AND b.currency=s->>'currency'
 AND b.scope=s->>'scope' AND b.exclusions IS NOT DISTINCT FROM s->>'exclusions'
 AND b."proposedStartDate" IS NOT DISTINCT FROM (s->>'startDate')::timestamptz
 AND b."validUntil" IS NOT DISTINCT FROM (s->>'validUntil')::timestamptz
 AND b."poolQuote" IS NOT DISTINCT FROM nullif(s->'poolQuote','null'::jsonb)
 AND (b."validUntil" IS NULL OR b."validUntil">NEW.deadline))) THEN
  RAISE EXCEPTION 'Board shortlist must match current valid proposals' USING ERRCODE='P1762'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "BoardRound_guard" BEFORE INSERT OR UPDATE OR DELETE ON "BoardReviewRound" FOR EACH ROW EXECUTE FUNCTION bundleen_guard_board_round();

CREATE FUNCTION bundleen_board_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Board votes, discussion and audit records are append-only' USING ERRCODE='P1762'; END $$;
CREATE TRIGGER "BoardVote_immutable" BEFORE UPDATE OR DELETE ON "BoardProposalVote" FOR EACH ROW EXECUTE FUNCTION bundleen_board_append_only();
CREATE TRIGGER "BoardComment_immutable" BEFORE UPDATE OR DELETE ON "BoardDiscussionMessage" FOR EACH ROW EXECUTE FUNCTION bundleen_board_append_only();
CREATE TRIGGER "BoardAudit_immutable" BEFORE UPDATE OR DELETE ON "BoardAuditEvent" FOR EACH ROW EXECUTE FUNCTION bundleen_board_append_only();
CREATE TRIGGER "BoardVote_no_truncate" BEFORE TRUNCATE ON "BoardProposalVote" FOR EACH STATEMENT EXECUTE FUNCTION bundleen_board_append_only();
CREATE TRIGGER "BoardComment_no_truncate" BEFORE TRUNCATE ON "BoardDiscussionMessage" FOR EACH STATEMENT EXECUTE FUNCTION bundleen_board_append_only();
CREATE TRIGGER "BoardAudit_no_truncate" BEFORE TRUNCATE ON "BoardAuditEvent" FOR EACH STATEMENT EXECUTE FUNCTION bundleen_board_append_only();
CREATE TRIGGER "BoardRound_no_truncate" BEFORE TRUNCATE ON "BoardReviewRound" FOR EACH STATEMENT EXECUTE FUNCTION bundleen_board_append_only();
CREATE FUNCTION bundleen_guard_board_vote() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "BoardReviewRound"%ROWTYPE;
BEGIN
 PERFORM bundleen_assert_board_round(NEW."roundId",true);
 SELECT * INTO r FROM "BoardReviewRound" WHERE id=NEW."roundId";
 PERFORM bundleen_assert_board_viewer(NEW."voterUserId",r."communityId");
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.electorate) e WHERE e->>'userId'=NEW."voterUserId") OR
 NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.proposals) s WHERE s->>'bidId'=NEW."bidId") THEN
 RAISE EXCEPTION 'Only the snapshot electorate may vote on shortlisted proposals' USING ERRCODE='P1761'; END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER "BoardVote_guard" BEFORE INSERT ON "BoardProposalVote" FOR EACH ROW EXECUTE FUNCTION bundleen_guard_board_vote();
CREATE FUNCTION bundleen_guard_board_comment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "BoardReviewRound"%ROWTYPE;
BEGIN
 SELECT * INTO r FROM "BoardReviewRound" WHERE id=NEW."roundId";
 PERFORM 1 FROM "HoaServiceRequest" WHERE id=r."requestId" FOR UPDATE;
 PERFORM 1 FROM "Community" WHERE id=r."communityId" FOR UPDATE;
 SELECT * INTO r FROM "BoardReviewRound" WHERE id=NEW."roundId";
 PERFORM bundleen_assert_board_viewer(NEW."authorUserId",r."communityId");
 IF r.status<>'open' THEN RAISE EXCEPTION 'Board discussion is closed' USING ERRCODE='P1762'; END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER "BoardComment_guard" BEFORE INSERT ON "BoardDiscussionMessage" FOR EACH ROW EXECUTE FUNCTION bundleen_guard_board_comment();

CREATE FUNCTION bundleen_assert_board_award(request_id text,bid_id text,bid_version integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cid text; ctype text; p "CommunityBoardPolicy"%ROWTYPE; r "BoardReviewRound"%ROWTYPE;
BEGIN
 SELECT "communityId" INTO cid FROM "HoaServiceRequest" WHERE id=request_id FOR UPDATE;
 SELECT type::text INTO ctype FROM "Community" WHERE id=cid FOR UPDATE;
 IF ctype<>'hoa' THEN RETURN; END IF;
 SELECT * INTO p FROM "CommunityBoardPolicy" WHERE "communityId"=cid;
 SELECT * INTO r FROM "BoardReviewRound" WHERE "requestId"=request_id AND status='open';
 -- Changing policy never silently discards an already-open vote.
 IF r.id IS NULL AND (p."communityId" IS NULL OR p.rule='manager_only') THEN RETURN; END IF;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Open a board review and obtain the required approvals before awarding' USING ERRCODE='P1762'; END IF;
 PERFORM bundleen_assert_board_round(r.id,false);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.proposals) s WHERE s->>'bidId'=bid_id AND (s->>'version')::integer=bid_version) OR
 (SELECT count(*) FROM "BoardProposalVote" WHERE "roundId"=r.id AND "bidId"=bid_id AND decision='approve')<r.threshold THEN
 RAISE EXCEPTION 'This proposal has not received the required board approvals' USING ERRCODE='P1762'; END IF;
END $$;
CREATE FUNCTION bundleen_guard_board_award() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
 IF TG_TABLE_NAME='ServiceBid' THEN
  IF NEW.status='accepted' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
   PERFORM bundleen_assert_board_award(NEW."requestId",NEW.id,NEW.version);
  END IF;
 ELSE
  SELECT version INTO v FROM "ServiceBid" WHERE id=NEW."bidId";
  IF EXISTS(SELECT 1 FROM "BoardReviewRound" WHERE "requestId"=NEW."requestId" AND status='open') THEN
   PERFORM bundleen_assert_board_manager(NEW."awardedByUserId",NEW."communityId"); END IF;
  PERFORM bundleen_assert_board_award(NEW."requestId",NEW."bidId",v);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "zzz_ServiceBid_board_award_guard" BEFORE INSERT OR UPDATE OF status ON "ServiceBid" FOR EACH ROW EXECUTE FUNCTION bundleen_guard_board_award();
CREATE TRIGGER "zzz_ServiceAgreement_board_award_guard" BEFORE INSERT ON "ServiceAgreement" FOR EACH ROW EXECUTE FUNCTION bundleen_guard_board_award();

-- Preserve homeowner unit binding and staff no-unit behavior while adding the
-- separate board role; board membership never grants operational staff access.
CREATE OR REPLACE FUNCTION bundleen_validate_invitation_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.role::text='homeowner' AND NEW.status='pending' THEN
  IF NEW."unitId" IS NULL THEN RAISE EXCEPTION 'a homeowner invitation requires a unit' USING ERRCODE='check_violation',CONSTRAINT='CommunityInvitation_unit_required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "CommunityUnit" WHERE id=NEW."unitId" AND "communityId"=NEW."communityId") THEN
   RAISE EXCEPTION 'invitation unit must belong to the same HOA' USING ERRCODE='check_violation',CONSTRAINT='CommunityInvitation_unit_same_hoa'; END IF;
 END IF;
 IF NEW.role::text IN ('hoa_manager','hoa_team','hoa_board') AND NEW."unitId" IS NOT NULL THEN
  RAISE EXCEPTION 'a staff or board invitation must not reference a unit' USING ERRCODE='check_violation',CONSTRAINT='CommunityInvitation_staff_no_unit'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION bundleen_guard_board_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.role::text='hoa_board' AND
 (OLD.id,OLD."communityId",OLD.email,OLD.role) IS DISTINCT FROM (NEW.id,NEW."communityId",NEW.email,NEW.role) THEN
  RAISE EXCEPTION 'Board invitation identity is immutable' USING ERRCODE='P1762'; END IF;
 IF NEW.role::text<>'hoa_board' THEN RETURN NEW; END IF;
 PERFORM 1 FROM "Community" WHERE id=NEW."communityId" FOR UPDATE;
 IF NEW.status='pending' THEN
  PERFORM bundleen_assert_board_manager(NEW."invitedByUserId",NEW."communityId");
  IF NEW."expiresAt" IS NULL OR NEW."expiresAt"<=clock_timestamp() OR NEW."acceptedAt" IS NOT NULL OR NEW."acceptedByUserId" IS NOT NULL THEN
   RAISE EXCEPTION 'A fresh expiring board invitation is required' USING ERRCODE='P1762'; END IF;
  IF TG_OP='UPDATE' AND OLD.status='accepted' AND EXISTS(SELECT 1 FROM "CommunityBoardMember" WHERE "communityId"=NEW."communityId" AND "userId"=OLD."acceptedByUserId" AND status='active') THEN
   RAISE EXCEPTION 'Revoke the existing board member before reinviting' USING ERRCODE='P1762'; END IF;
 ELSIF NEW.status='accepted' THEN
  IF (NEW."invitedByUserId",NEW."expiresAt",NEW."invitedAt",NEW."clerkInvitationId") IS DISTINCT FROM (OLD."invitedByUserId",OLD."expiresAt",OLD."invitedAt",OLD."clerkInvitationId") THEN RAISE EXCEPTION 'Board invitation cannot change while accepting' USING ERRCODE='P1762'; END IF;
  IF TG_OP='INSERT' OR OLD.status<>'pending' OR OLD."expiresAt"<=clock_timestamp() OR
   NOT EXISTS(SELECT 1 FROM "User" WHERE id=NEW."acceptedByUserId" AND "isVerified" AND lower(email)=lower(NEW.email)) THEN
   RAISE EXCEPTION 'Accept a current email-bound board invitation' USING ERRCODE='P1761'; END IF;
  PERFORM bundleen_assert_board_manager(NEW."invitedByUserId",NEW."communityId");
  NEW."acceptedAt":=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "BoardInvitation_guard" BEFORE INSERT OR UPDATE ON "CommunityInvitation" FOR EACH ROW EXECUTE FUNCTION bundleen_guard_board_invitation();

-- Called inside the existing award transaction after the agreement has been
-- inserted. Failure rolls back the accepted bid, visits and all notifications.
CREATE FUNCTION bundleen_finalize_board_award(request_id text,bid_id text,actor_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE cid text; provider_id text; round_id text; v integer; member jsonb; agreement_id text;
BEGIN
 SELECT a."communityId",a."providerUserId",a.id,b.version INTO cid,provider_id,agreement_id,v
 FROM "ServiceAgreement" a JOIN "ServiceBid" b ON b.id=a."bidId" WHERE a."requestId"=request_id AND a."bidId"=bid_id AND a."awardedByUserId"=actor_id;
 IF agreement_id IS NULL THEN RAISE EXCEPTION 'A matching confirmed award is required' USING ERRCODE='P1762'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "Community" WHERE id=cid AND type='hoa') THEN RETURN; END IF;
 PERFORM bundleen_assert_board_award(request_id,bid_id,v);
 SELECT id INTO round_id FROM "BoardReviewRound" WHERE "requestId"=request_id AND status='open';
 IF round_id IS NOT NULL THEN
  PERFORM bundleen_assert_board_manager(actor_id,cid);
  UPDATE "BoardReviewRound" SET status='awarded',"awardedBidId"=bid_id,"closedAt"=clock_timestamp() WHERE id=round_id;
  INSERT INTO "BoardAuditEvent"(id,"communityId","actorUserId",kind,"requestId","roundId",data)
   VALUES(gen_random_uuid()::text,cid,actor_id,'award_confirmed',request_id,round_id,jsonb_build_object('bidId',bid_id,'bidVersion',v,'agreementId',agreement_id));
  FOR member IN SELECT value FROM "BoardReviewRound" r,jsonb_array_elements(r.electorate) WHERE r.id=round_id LOOP
   INSERT INTO "Notification"(id,"userId",kind,title,body,"linkPath","dedupeKey")
    VALUES(gen_random_uuid()::text,member->>'userId','award','Board review result confirmed','The HOA manager confirmed the approved proposal. View the recorded decision.',
    '/app/board?request='||request_id,'board-result:'||round_id||':'||(member->>'userId')) ON CONFLICT("dedupeKey") DO NOTHING;
  END LOOP;
 END IF;
 INSERT INTO "ProviderCommunityApproval"(id,"communityId","providerUserId","createdByUserId")
 VALUES(gen_random_uuid()::text,cid,provider_id,actor_id) ON CONFLICT("communityId","providerUserId") DO NOTHING;
END $$;
