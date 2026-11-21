ALTER TABLE "Community" ADD COLUMN "hoaRevenueShareBps" INTEGER NOT NULL DEFAULT 0 CHECK ("hoaRevenueShareBps" BETWEEN 0 AND 1000), ADD COLUMN "stripeTestHoaAccountId" TEXT, ADD COLUMN "stripeTestHoaPayoutStatus" TEXT NOT NULL DEFAULT 'not_started';
CREATE UNIQUE INDEX "Community_stripeTestHoaAccountId_key" ON "Community"("stripeTestHoaAccountId");
ALTER TABLE "StripeTestPayment" ADD COLUMN "hoaRevenueShareBps" INTEGER, ADD COLUMN "residentSavingsCents" INTEGER NOT NULL DEFAULT 0 CHECK ("residentSavingsCents">=0);
ALTER TABLE "StripeTestPayment" ADD CONSTRAINT "hoa_share_snapshot_check" CHECK (("hoaRevenueShareBps" IS NULL AND "hoaShareCents"=0) OR ("hoaRevenueShareBps" IS NOT NULL AND "hoaShareCents">=0 AND "hoaRevenueShareBps" BETWEEN 0 AND 1000 AND "hoaShareCents"=("amountCents"::bigint*"hoaRevenueShareBps"/10000) AND "hoaShareCents"<="platformFeeCents"));
CREATE TABLE "HoaShareEntry" ("id" TEXT PRIMARY KEY, "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE RESTRICT, "paymentVisitId" TEXT NOT NULL REFERENCES "StripeTestPayment"("visitId") ON DELETE RESTRICT, "sequence" INTEGER NOT NULL, "kind" TEXT NOT NULL, "amountCents" INTEGER NOT NULL, "savingsCents" INTEGER NOT NULL, "refundedCents" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("paymentVisitId","sequence"));
CREATE INDEX "HoaShareEntry_communityId_createdAt_idx" ON "HoaShareEntry"("communityId","createdAt");
CREATE TABLE "HoaShareStatement" ("id" TEXT PRIMARY KEY, "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE RESTRICT, "periodStart" TIMESTAMP(3) NOT NULL, "periodEnd" TIMESTAMP(3) NOT NULL, "totalCents" INTEGER NOT NULL, "savingsCents" INTEGER NOT NULL, "openingBalanceCents" INTEGER NOT NULL, "closingBalanceCents" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'accruing', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("communityId","periodStart"));
CREATE TABLE "HoaSharePayout" ("id" TEXT PRIMARY KEY, "statementId" TEXT NOT NULL UNIQUE REFERENCES "HoaShareStatement"("id") ON DELETE RESTRICT, "communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE RESTRICT, "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, "method" TEXT NOT NULL CHECK("method" IN ('manual','stripe')), "amountCents" INTEGER NOT NULL CHECK("amountCents">0), "accountId" TEXT, "reference" TEXT, "status" TEXT NOT NULL DEFAULT 'pending' CHECK("status" IN ('pending','paid')), "stripeTransferId" TEXT UNIQUE, "attemptedAt" TIMESTAMP(3), "paidAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "HoaSharePayout_communityId_status_idx" ON "HoaSharePayout"("communityId","status");
CREATE FUNCTION hoa_share_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'HOA financial audit rows are immutable'; END $$;
CREATE TRIGGER hoa_entry_immutable BEFORE UPDATE OR DELETE ON "HoaShareEntry" FOR EACH ROW EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER hoa_statement_immutable BEFORE UPDATE OR DELETE ON "HoaShareStatement" FOR EACH ROW EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER hoa_entry_no_truncate BEFORE TRUNCATE ON "HoaShareEntry" EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER hoa_statement_no_truncate BEFORE TRUNCATE ON "HoaShareStatement" EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER hoa_payout_no_delete BEFORE DELETE ON "HoaSharePayout" FOR EACH ROW EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER hoa_payout_no_truncate BEFORE TRUNCATE ON "HoaSharePayout" EXECUTE FUNCTION hoa_share_immutable();
-- Every paid balance mutation serializes with association payout reservations.
CREATE FUNCTION hoa_payment_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cap integer; count integer; seq integer; expected integer;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW."hoaRevenueShareBps",NEW."hoaShareCents",NEW."residentSavingsCents") IS DISTINCT FROM ROW(OLD."hoaRevenueShareBps",OLD."hoaShareCents",OLD."residentSavingsCents") THEN RAISE EXCEPTION 'HOA payment snapshot is immutable'; END IF;
 PERFORM 1 FROM "Community" WHERE "id"=NEW."communityId" FOR UPDATE;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM "Community" WHERE "id"=NEW."communityId" AND "type"='hoa' AND "hoaRevenueShareBps"=coalesce(NEW."hoaRevenueShareBps",0)) THEN RAISE EXCEPTION 'HOA rate snapshot mismatch'; END IF;
 IF TG_OP='INSERT' THEN
  expected:=0;
  IF NEW."enrollmentAuthorizationId" IS NOT NULL THEN
   SELECT c."maximumCents",r."totalOccurrences",o."sequence" INTO cap,count,seq FROM "AgreementBillingAuthorization" a JOIN "EnrollmentBillingConsent" c ON c."id"=a."enrollmentConsentId" JOIN "HoaServiceRequest" r ON r."id"=c."requestId" JOIN "ServiceVisit" v ON v."id"=NEW."visitId" JOIN "ServiceOccurrence" o ON o."id"=v."occurrenceId" WHERE a."id"=NEW."enrollmentAuthorizationId";
   IF count>0 THEN expected:=greatest(0,cap/count+CASE WHEN seq<=cap%count THEN 1 ELSE 0 END-NEW."amountCents"); END IF;
  END IF;
  IF NEW."residentSavingsCents"<>expected THEN RAISE EXCEPTION 'Resident savings snapshot mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hoa_payment_snapshot_guard BEFORE INSERT OR UPDATE ON "StripeTestPayment" FOR EACH ROW EXECUTE FUNCTION hoa_payment_snapshot_guard();
CREATE FUNCTION hoa_refund_lock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM 1 FROM "Community" WHERE "id"=(SELECT "communityId" FROM "StripeTestPayment" WHERE "visitId"=NEW."visitId") FOR UPDATE; RETURN NEW;
END $$;
CREATE TRIGGER hoa_refund_lock BEFORE INSERT OR UPDATE ON "StripeTestRefund" FOR EACH ROW EXECUTE FUNCTION hoa_refund_lock();
CREATE FUNCTION hoa_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "StripeTestPayment"; r integer; old_h bigint; old_s bigint; seq integer;
BEGIN
 SELECT * INTO p FROM "StripeTestPayment" WHERE "visitId"=NEW."paymentVisitId" FOR UPDATE;
 PERFORM 1 FROM "Community" WHERE "id"=p."communityId" FOR UPDATE;
 IF p."communityId" IS DISTINCT FROM NEW."communityId" OR p."status" NOT IN ('succeeded','partially_refunded','refunded') OR NOT EXISTS(SELECT 1 FROM "ServiceVisit" WHERE "id"=p."visitId" AND "status"='completed' AND "completedAt" IS NOT NULL AND "redoOfVisitId" IS NULL) THEN RAISE EXCEPTION 'No completed paid HOA revenue'; END IF;
 r:=greatest(p."amountRefundedCents",p."observedChargeRefundedCents");
 SELECT coalesce(sum("amountCents"),0),coalesce(sum("savingsCents"),0),coalesce(max("sequence"),0)+1 INTO old_h,old_s,seq FROM "HoaShareEntry" WHERE "paymentVisitId"=p."visitId";
 IF NEW."sequence"<>seq OR NEW."refundedCents"<>r OR NEW."amountCents"<>p."hoaShareCents"-(p."hoaShareCents"::bigint*r/p."amountCents")-old_h OR NEW."savingsCents"<>p."residentSavingsCents"-(p."residentSavingsCents"::bigint*r/p."amountCents")-old_s OR (NEW."amountCents"=0 AND NEW."savingsCents"=0) THEN RAISE EXCEPTION 'HOA earned ledger mismatch'; END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER hoa_entry_guard BEFORE INSERT ON "HoaShareEntry" FOR EACH ROW EXECUTE FUNCTION hoa_entry_guard();
CREATE FUNCTION hoa_payment_accrue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h bigint; s bigint; r integer; seq integer;
BEGIN
 IF NEW."status" NOT IN ('succeeded','partially_refunded','refunded') OR NEW."hoaRevenueShareBps" IS NULL OR NEW."reconciliationHoldReason" IS NOT NULL THEN RETURN NEW; END IF;
 SELECT coalesce(sum("amountCents"),0),coalesce(sum("savingsCents"),0),coalesce(max("sequence"),0)+1 INTO h,s,seq FROM "HoaShareEntry" WHERE "paymentVisitId"=NEW."visitId";
 r:=greatest(NEW."amountRefundedCents",NEW."observedChargeRefundedCents");
 h:=NEW."hoaShareCents"-(NEW."hoaShareCents"::bigint*r/NEW."amountCents")-h;
 s:=NEW."residentSavingsCents"-(NEW."residentSavingsCents"::bigint*r/NEW."amountCents")-s;
 IF h<>0 OR s<>0 THEN INSERT INTO "HoaShareEntry" VALUES(NEW."visitId"||':'||seq,NEW."communityId",NEW."visitId",seq,CASE WHEN seq=1 THEN 'earned' ELSE 'refund_adjustment' END,h,s,r,clock_timestamp()); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hoa_payment_accrue AFTER INSERT OR UPDATE ON "StripeTestPayment" FOR EACH ROW EXECUTE FUNCTION hoa_payment_accrue();
CREATE FUNCTION hoa_statement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE earned bigint; saved bigint; opening bigint; paid bigint;
BEGIN
 PERFORM 1 FROM "Community" WHERE "id"=NEW."communityId" FOR UPDATE;
 IF NEW."periodStart"<>date_trunc('month',NEW."periodStart") OR NEW."periodEnd"<>NEW."periodStart"+interval '1 month' OR NEW."periodEnd">clock_timestamp() THEN RAISE EXCEPTION 'Invalid completed statement month'; END IF;
 SELECT coalesce(sum("amountCents"),0),coalesce(sum("savingsCents"),0) INTO earned,saved FROM "HoaShareEntry" WHERE "communityId"=NEW."communityId" AND "createdAt">=NEW."periodStart" AND "createdAt"<NEW."periodEnd";
 SELECT coalesce(sum("amountCents"),0) INTO opening FROM "HoaShareEntry" WHERE "communityId"=NEW."communityId" AND "createdAt"<NEW."periodStart";
 opening:=opening-(SELECT coalesce(sum("amountCents"),0) FROM "HoaSharePayout" WHERE "communityId"=NEW."communityId" AND "status"='paid' AND "paidAt"<NEW."periodStart");
 SELECT coalesce(sum("amountCents"),0) INTO paid FROM "HoaSharePayout" WHERE "communityId"=NEW."communityId" AND "status"='paid' AND "paidAt">=NEW."periodStart" AND "paidAt"<NEW."periodEnd";
 IF ROW(NEW."totalCents",NEW."savingsCents",NEW."openingBalanceCents",NEW."closingBalanceCents") IS DISTINCT FROM ROW(earned::int,saved::int,opening::int,(opening+earned-paid)::int) THEN RAISE EXCEPTION 'Statement ledger total mismatch'; END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER hoa_statement_guard BEFORE INSERT ON "HoaShareStatement" FOR EACH ROW EXECUTE FUNCTION hoa_statement_guard();
CREATE FUNCTION hoa_payout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE available bigint; ceiling integer; needs_authority boolean;
BEGIN
 needs_authority:=TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN needs_authority:=(OLD."attemptedAt" IS NULL AND NEW."attemptedAt" IS NOT NULL) OR (OLD."status"<>'paid' AND NEW."status"='paid'); END IF;
 IF needs_authority THEN
  PERFORM 1 FROM "User" WHERE "id"=NEW."actorUserId" FOR SHARE;
  PERFORM 1 FROM "AdminAccessGrant" WHERE "userId"=NEW."actorUserId" FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM "User" u JOIN "AdminAccessGrant" a ON a."userId"=u."id" WHERE u."id"=NEW."actorUserId" AND u."role"='admin' AND u."isVerified" AND a."status"='active' AND a."level"='owner' AND NOT a."isStaffAccount" AND a."email"=lower(u."email")) THEN RAISE EXCEPTION 'HOA payout requires verified owner'; END IF;
 END IF;
 PERFORM 1 FROM "Community" WHERE "id"=NEW."communityId" FOR UPDATE;
 IF TG_OP='UPDATE' AND ((OLD."attemptedAt" IS NULL AND NEW."attemptedAt" IS NOT NULL) OR (NEW."method"='manual' AND OLD."status"<>'paid' AND NEW."status"='paid')) THEN
  SELECT coalesce(sum("amountCents"),0) INTO available FROM "HoaShareEntry" WHERE "communityId"=NEW."communityId";
  available:=available-(SELECT coalesce(sum("amountCents"),0) FROM "HoaSharePayout" WHERE "communityId"=NEW."communityId" AND "id"<>NEW."id");
  IF NEW."amountCents">available OR EXISTS(SELECT 1 FROM "StripeTestPayment" p WHERE p."communityId"=NEW."communityId" AND p."hoaShareCents">0 AND (p."reconciliationHoldReason" IS NOT NULL OR p."status"='disputed' OR EXISTS(SELECT 1 FROM "StripeTestRefund" r WHERE r."visitId"=p."visitId" AND r."state" NOT IN ('succeeded','failed')) OR EXISTS(SELECT 1 FROM "ServiceQualityClaim" c WHERE c."visitId"=p."visitId" AND c."resolution" IN ('reported','redo_pending','refund_pending')))) THEN RAISE EXCEPTION 'HOA payout balance is held or changed'; END IF;
  IF OLD."attemptedAt" IS NULL AND NEW."attemptedAt" IS NOT NULL THEN
   IF NEW."method"<>'stripe' OR OLD."status"<>'pending' OR NEW."status"<>'pending' THEN RAISE EXCEPTION 'Invalid HOA attempt transition'; END IF;
   NEW."attemptedAt":=clock_timestamp();
  END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW."id",NEW."statementId",NEW."communityId",NEW."actorUserId",NEW."method",NEW."amountCents",NEW."accountId",NEW."reference",NEW."createdAt") IS DISTINCT FROM ROW(OLD."id",OLD."statementId",OLD."communityId",OLD."actorUserId",OLD."method",OLD."amountCents",OLD."accountId",OLD."reference",OLD."createdAt") OR (OLD."attemptedAt" IS NOT NULL AND NEW."attemptedAt" IS DISTINCT FROM OLD."attemptedAt") OR (OLD."stripeTransferId" IS NOT NULL AND NEW."stripeTransferId" IS DISTINCT FROM OLD."stripeTransferId") OR (OLD."status"='paid' AND ROW(NEW."status",NEW."paidAt",NEW."stripeTransferId") IS DISTINCT FROM ROW(OLD."status",OLD."paidAt",OLD."stripeTransferId")) THEN RAISE EXCEPTION 'HOA payout identity is immutable'; END IF;
 ELSE
  SELECT "closingBalanceCents" INTO ceiling FROM "HoaShareStatement" WHERE "id"=NEW."statementId" AND "communityId"=NEW."communityId";
  IF ceiling IS NULL OR NEW."amountCents">ceiling OR NEW."status"<>'pending' OR NEW."paidAt" IS NOT NULL OR NEW."attemptedAt" IS NOT NULL OR NEW."stripeTransferId" IS NOT NULL THEN RAISE EXCEPTION 'Invalid new HOA payout'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "User" u JOIN "AdminAccessGrant" a ON a."userId"=u."id" WHERE u."id"=NEW."actorUserId" AND u."role"='admin' AND u."isVerified" AND a."status"='active' AND a."level"='owner' AND NOT a."isStaffAccount" AND a."email"=lower(u."email")) THEN RAISE EXCEPTION 'HOA payout requires verified owner'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO available FROM "HoaShareEntry" WHERE "communityId"=NEW."communityId";
  available:=available-(SELECT coalesce(sum("amountCents"),0) FROM "HoaSharePayout" WHERE "communityId"=NEW."communityId");
  IF NEW."amountCents">available THEN RAISE EXCEPTION 'HOA payout exceeds current liability'; END IF;
  IF EXISTS(SELECT 1 FROM "StripeTestPayment" p WHERE p."communityId"=NEW."communityId" AND p."hoaShareCents">0 AND (p."reconciliationHoldReason" IS NOT NULL OR p."status"='disputed' OR EXISTS(SELECT 1 FROM "StripeTestRefund" r WHERE r."visitId"=p."visitId" AND r."state" NOT IN ('succeeded','failed')) OR EXISTS(SELECT 1 FROM "ServiceQualityClaim" c WHERE c."visitId"=p."visitId" AND c."resolution" IN ('reported','redo_pending','refund_pending')))) THEN RAISE EXCEPTION 'HOA payout is held'; END IF;
  IF NEW."method"='stripe' AND NOT EXISTS(SELECT 1 FROM "Community" WHERE "id"=NEW."communityId" AND "stripeTestHoaAccountId"=NEW."accountId" AND "stripeTestHoaPayoutStatus"='active') THEN RAISE EXCEPTION 'HOA payout account mismatch'; END IF;
  NEW."createdAt":=clock_timestamp();
 END IF;
 IF NEW."method"='manual' AND (NEW."reference" IS NULL OR length(trim(NEW."reference")) NOT BETWEEN 1 AND 200 OR NEW."accountId" IS NOT NULL OR NEW."attemptedAt" IS NOT NULL OR NEW."stripeTransferId" IS NOT NULL) THEN RAISE EXCEPTION 'Invalid manual payout reference'; END IF;
 IF NEW."method"='stripe' AND (NEW."accountId" IS NULL OR NEW."reference" IS NOT NULL OR (NEW."status"='paid' AND (NEW."stripeTransferId" IS NULL OR NEW."attemptedAt" IS NULL))) THEN RAISE EXCEPTION 'Invalid Stripe payout identity'; END IF;
 IF NEW."status"='paid' AND NEW."paidAt" IS NULL THEN NEW."paidAt":=clock_timestamp(); END IF;
 IF TG_OP='UPDATE' AND OLD."status"<>'paid' AND NEW."status"='paid' THEN NEW."paidAt":=clock_timestamp(); END IF;
 IF NEW."status"='pending' AND NEW."paidAt" IS NOT NULL THEN RAISE EXCEPTION 'Pending payout cannot have paid timestamp'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hoa_payout_guard BEFORE INSERT OR UPDATE ON "HoaSharePayout" FOR EACH ROW EXECUTE FUNCTION hoa_payout_guard();
-- Claims acquire the same financial authority lock, even when no payment field changes.
CREATE FUNCTION hoa_claim_lock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM 1 FROM "ServiceVisit" WHERE "id"=NEW."visitId" FOR UPDATE;
 PERFORM 1 FROM "StripeTestPayment" WHERE "visitId"=NEW."visitId" FOR UPDATE;
 PERFORM 1 FROM "Community" WHERE "id"=(SELECT "communityId" FROM "StripeTestPayment" WHERE "visitId"=NEW."visitId") FOR UPDATE;
 RETURN NEW;
END $$;
CREATE TRIGGER z_hoa_claim_lock BEFORE INSERT OR UPDATE ON "ServiceQualityClaim" FOR EACH ROW EXECUTE FUNCTION hoa_claim_lock();
