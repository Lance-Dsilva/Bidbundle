CREATE TABLE "RecurringPlan" ("id" TEXT PRIMARY KEY,"agreementId" TEXT NOT NULL UNIQUE REFERENCES "ServiceAgreement"("id") ON DELETE RESTRICT,"requestId" TEXT NOT NULL REFERENCES "HoaServiceRequest"("id") ON DELETE RESTRICT,"communityId" TEXT NOT NULL REFERENCES "Community"("id") ON DELETE RESTRICT,"providerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,"createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,"scope" TEXT NOT NULL,"monthlyPriceCents" INTEGER NOT NULL CHECK("monthlyPriceCents" BETWEEN 50 AND 10000000),"currency" TEXT NOT NULL CHECK("currency"='usd'),"billingMode" TEXT NOT NULL CHECK("billingMode" IN ('monthly','per_visit')),"timezone" TEXT NOT NULL,"anchorDate" TEXT NOT NULL,"cadenceDays" INTEGER NOT NULL CHECK("cadenceDays" BETWEEN 1 AND 31),"requiresAfterPhoto" BOOLEAN NOT NULL,"termsVersion" TEXT NOT NULL,"termsToken" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'proposed' CHECK("status" IN ('proposed','active','ending','ended')),"acceptedAt" TIMESTAMP(3),"endRequestedAt" TIMESTAMP(3),"endEffectiveDate" TEXT,"endedAt" TIMESTAMP(3),"lastGeneratedMonth" TEXT,"lastReminderYear" INTEGER,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "RecurringPlan_status_updatedAt_idx" ON "RecurringPlan"("status","updatedAt");
CREATE TABLE "RecurringSubscription" ("id" TEXT PRIMARY KEY,"planId" TEXT NOT NULL REFERENCES "RecurringPlan"("id") ON DELETE RESTRICT,"payerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,"unitId" TEXT NOT NULL REFERENCES "CommunityUnit"("id") ON DELETE RESTRICT,"membershipId" TEXT NOT NULL REFERENCES "CommunityMembership"("id") ON DELETE RESTRICT,"startDate" TEXT NOT NULL,"monthlyCapCents" INTEGER NOT NULL,"currency" TEXT NOT NULL,"termsVersion" TEXT NOT NULL,"termsToken" TEXT NOT NULL,"acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"receiptEmail" TEXT NOT NULL,"customerId" TEXT,"paymentMethodId" TEXT,"setupIntentId" TEXT UNIQUE,"cardVerifiedAt" TIMESTAMP(3),"status" TEXT NOT NULL DEFAULT 'pending' CHECK("status" IN ('pending','active','paused','cancelled')),"stopKind" TEXT CHECK("stopKind" IN ('pause','cancel')),"stopRequestedAt" TIMESTAMP(3),"stopEffectiveDate" TEXT,"stoppedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "RecurringSubscription_live_unit" ON "RecurringSubscription"("planId","unitId") WHERE "status" IN ('pending','active');
CREATE INDEX "RecurringSubscription_planId_status_idx" ON "RecurringSubscription"("planId","status");
CREATE INDEX "RecurringSubscription_payerUserId_status_idx" ON "RecurringSubscription"("payerUserId","status");
ALTER TABLE "ServiceOccurrence" ADD COLUMN "recurringPlanId" TEXT REFERENCES "RecurringPlan"("id") ON DELETE RESTRICT, ADD COLUMN "recurringLocalDate" TEXT;
CREATE UNIQUE INDEX "ServiceOccurrence_recurringPlanId_recurringLocalDate_key" ON "ServiceOccurrence"("recurringPlanId","recurringLocalDate");
ALTER TABLE "ServiceVisit" ADD COLUMN "recurringSubscriptionId" TEXT REFERENCES "RecurringSubscription"("id") ON DELETE RESTRICT, ADD COLUMN "recurringMonth" TEXT;
CREATE TABLE "RecurringMonthlyBill" ("id" TEXT PRIMARY KEY,"planId" TEXT NOT NULL REFERENCES "RecurringPlan"("id") ON DELETE RESTRICT,"subscriptionId" TEXT NOT NULL REFERENCES "RecurringSubscription"("id") ON DELETE RESTRICT,"unitId" TEXT NOT NULL REFERENCES "CommunityUnit"("id") ON DELETE RESTRICT,"payerUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,"month" TEXT NOT NULL,"timezone" TEXT NOT NULL,"currency" TEXT NOT NULL,"amountCents" INTEGER NOT NULL CHECK("amountCents">=0),"sealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE("planId","subscriptionId","unitId","month"));
CREATE TABLE "RecurringBillLine" ("id" TEXT PRIMARY KEY,"billId" TEXT NOT NULL REFERENCES "RecurringMonthlyBill"("id") ON DELETE RESTRICT,"visitId" TEXT NOT NULL UNIQUE REFERENCES "ServiceVisit"("id") ON DELETE RESTRICT,"allocatedCents" INTEGER NOT NULL,"amountCents" INTEGER NOT NULL,"statusAtSeal" TEXT NOT NULL,"completedAt" TIMESTAMP(3));
CREATE INDEX "RecurringBillLine_billId_idx" ON "RecurringBillLine"("billId");
CREATE FUNCTION recurring_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "ServiceAgreement"; current_day date;
BEGIN
 SELECT * INTO a FROM "ServiceAgreement" WHERE "id"=NEW."agreementId" FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW."timezone") THEN RAISE EXCEPTION 'Invalid recurring timezone'; END IF;
 current_day:=(clock_timestamp() AT TIME ZONE NEW."timezone")::date;
 IF TG_OP='INSERT' THEN
  IF NEW."status"<>'proposed' OR NEW."acceptedAt" IS NOT NULL OR NEW."endRequestedAt" IS NOT NULL OR NEW."endEffectiveDate" IS NOT NULL OR NEW."endedAt" IS NOT NULL OR NEW."anchorDate"::date<current_day OR NEW."anchorDate"<>to_char(NEW."anchorDate"::date,'YYYY-MM-DD') OR NEW."termsVersion"<>'recurring-monthly-cap-v1' THEN RAISE EXCEPTION 'Invalid recurring proposal'; END IF;
  IF NOT COALESCE(a."communityId"=NEW."communityId" AND a."providerUserId"=NEW."providerUserId" AND a."requestId"=NEW."requestId" AND a."scope"=NEW."scope" AND a."status"<>'cancelled',false) OR NOT EXISTS(SELECT 1 FROM "HoaServiceRequest" r JOIN "Community" c ON c."id"=r."communityId" JOIN "HoaProfile" h ON h."communityId"=c."id" WHERE r."id"=NEW."requestId" AND r."kind"='optional_group' AND c."type"='hoa' AND c."status"='active' AND h."timezone"=NEW."timezone" AND r."requiresAfterPhoto"=NEW."requiresAfterPhoto") THEN RAISE EXCEPTION 'Invalid recurring source agreement'; END IF;
  PERFORM 1 FROM "User" WHERE "id"=NEW."createdByUserId" FOR SHARE;
  PERFORM 1 FROM "CommunityStaffAssignment" WHERE "userId"=NEW."createdByUserId" AND "communityId"=NEW."communityId" FOR SHARE;
  PERFORM 1 FROM "AdminAccessGrant" WHERE "userId"=NEW."createdByUserId" FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM "User" u WHERE u."id"=NEW."createdByUserId" AND u."isVerified" AND (EXISTS(SELECT 1 FROM "CommunityStaffAssignment" s WHERE s."userId"=u."id" AND s."communityId"=NEW."communityId" AND s."role"='hoa_manager' AND s."status"='active') OR EXISTS(SELECT 1 FROM "AdminAccessGrant" g WHERE g."userId"=u."id" AND u."role"='admin' AND g."level"='owner' AND g."status"='active' AND NOT g."isStaffAccount" AND g."email"=lower(u."email")))) THEN RAISE EXCEPTION 'Recurring proposal requires scoped manager'; END IF;
  IF EXISTS(SELECT 1 FROM "ServiceOccurrence" WHERE "agreementId"=a."id" AND "recurringPlanId" IS NULL AND ("serviceDate" AT TIME ZONE 'UTC' AT TIME ZONE NEW."timezone")::date>=NEW."anchorDate"::date) THEN RAISE EXCEPTION 'Recurring coverage overlaps finite service'; END IF;
 ELSE
  IF ROW(NEW."id",NEW."agreementId",NEW."requestId",NEW."communityId",NEW."providerUserId",NEW."createdByUserId",NEW."scope",NEW."monthlyPriceCents",NEW."currency",NEW."billingMode",NEW."timezone",NEW."anchorDate",NEW."cadenceDays",NEW."requiresAfterPhoto",NEW."termsVersion",NEW."termsToken",NEW."createdAt") IS DISTINCT FROM ROW(OLD."id",OLD."agreementId",OLD."requestId",OLD."communityId",OLD."providerUserId",OLD."createdByUserId",OLD."scope",OLD."monthlyPriceCents",OLD."currency",OLD."billingMode",OLD."timezone",OLD."anchorDate",OLD."cadenceDays",OLD."requiresAfterPhoto",OLD."termsVersion",OLD."termsToken",OLD."createdAt") THEN RAISE EXCEPTION 'Recurring contract identity is immutable'; END IF;
  IF OLD."acceptedAt" IS NOT NULL AND NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt" THEN RAISE EXCEPTION 'Provider acceptance is immutable'; END IF;
  IF OLD."endRequestedAt" IS NOT NULL AND ROW(NEW."endRequestedAt",NEW."endEffectiveDate") IS DISTINCT FROM ROW(OLD."endRequestedAt",OLD."endEffectiveDate") THEN RAISE EXCEPTION 'Provider notice is immutable'; END IF;
  IF OLD."status"='proposed' AND NEW."status"='active' THEN
   PERFORM 1 FROM "User" WHERE "id"=NEW."providerUserId" FOR SHARE; PERFORM 1 FROM "ProviderProfile" WHERE "userId"=NEW."providerUserId" FOR SHARE;
   IF NOT EXISTS(SELECT 1 FROM "User" u JOIN "ProviderProfile" p ON p."userId"=u."id" WHERE u."id"=NEW."providerUserId" AND u."role"='provider' AND p."accountStatus"='active') THEN RAISE EXCEPTION 'Active awarded provider required'; END IF; NEW."acceptedAt":=clock_timestamp();
  ELSIF OLD."status"='active' AND NEW."status"='ending' THEN
   IF NEW."endEffectiveDate" IS NULL OR NEW."endEffectiveDate"<>to_char(NEW."endEffectiveDate"::date,'YYYY-MM-DD') OR NEW."endEffectiveDate"::date<current_day+30 THEN RAISE EXCEPTION 'Provider ending needs 30 local days notice'; END IF; NEW."endRequestedAt":=clock_timestamp();
  ELSIF OLD."status"='ending' AND NEW."status"='ended' THEN
   IF current_day<OLD."endEffectiveDate"::date THEN RAISE EXCEPTION 'Provider notice has not elapsed'; END IF; NEW."endedAt":=clock_timestamp();
  ELSIF NEW."status"<>OLD."status" OR ROW(NEW."acceptedAt",NEW."endRequestedAt",NEW."endEffectiveDate",NEW."endedAt") IS DISTINCT FROM ROW(OLD."acceptedAt",OLD."endRequestedAt",OLD."endEffectiveDate",OLD."endedAt") THEN RAISE EXCEPTION 'Invalid recurring lifecycle transition'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER "RecurringPlan_guard" BEFORE INSERT OR UPDATE ON "RecurringPlan" FOR EACH ROW EXECUTE FUNCTION recurring_plan_guard();
CREATE FUNCTION recurring_subscription_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "RecurringPlan"; current_day date;
BEGIN
 SELECT * INTO p FROM "RecurringPlan" WHERE "id"=NEW."planId";
 PERFORM 1 FROM "ServiceAgreement" WHERE "id"=p."agreementId" FOR UPDATE;
 SELECT * INTO p FROM "RecurringPlan" WHERE "id"=NEW."planId" FOR UPDATE;
 current_day:=(clock_timestamp() AT TIME ZONE p."timezone")::date;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD."status"='pending' AND NEW."status"='active') THEN
  PERFORM 1 FROM "User" WHERE "id"=NEW."payerUserId" FOR SHARE; PERFORM 1 FROM "Community" WHERE "id"=p."communityId" FOR SHARE; PERFORM 1 FROM "CommunityMembership" WHERE "id"=NEW."membershipId" FOR SHARE;
  IF p."status"<>'active' OR p."acceptedAt" IS NULL OR NEW."monthlyCapCents"<>p."monthlyPriceCents" OR NEW."currency"<>p."currency" OR NEW."termsVersion"<>'recurring-monthly-cap-v1' OR (NEW."startDate"<>to_char(NEW."startDate"::date,'YYYY-MM-DD') OR NEW."startDate"::date<p."anchorDate"::date OR (TG_OP='INSERT' AND NEW."startDate"::date<current_day)) OR NOT EXISTS(SELECT 1 FROM "User" u JOIN "CommunityMembership" m ON m."userId"=u."id" JOIN "Community" c ON c."id"=m."communityId" WHERE u."id"=NEW."payerUserId" AND u."role"='homeowner' AND u."isVerified" AND lower(trim(u."email"))=NEW."receiptEmail" AND m."id"=NEW."membershipId" AND m."unitId"=NEW."unitId" AND m."status"='active' AND c."id"=p."communityId" AND c."status"='active') THEN RAISE EXCEPTION 'Recurring consent authority changed'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."status"<>'pending' OR NEW."customerId" IS NOT NULL OR NEW."paymentMethodId" IS NOT NULL OR NEW."setupIntentId" IS NOT NULL OR NEW."cardVerifiedAt" IS NOT NULL OR NEW."stopKind" IS NOT NULL OR NEW."stopEffectiveDate" IS NOT NULL OR NEW."stopRequestedAt" IS NOT NULL OR NEW."stoppedAt" IS NOT NULL THEN RAISE EXCEPTION 'New recurring consent requires unverified card'; END IF; NEW."acceptedAt":=clock_timestamp();
 ELSE
  IF ROW(NEW."id",NEW."planId",NEW."payerUserId",NEW."unitId",NEW."membershipId",NEW."startDate",NEW."monthlyCapCents",NEW."currency",NEW."termsVersion",NEW."termsToken",NEW."acceptedAt",NEW."receiptEmail",NEW."createdAt") IS DISTINCT FROM ROW(OLD."id",OLD."planId",OLD."payerUserId",OLD."unitId",OLD."membershipId",OLD."startDate",OLD."monthlyCapCents",OLD."currency",OLD."termsVersion",OLD."termsToken",OLD."acceptedAt",OLD."receiptEmail",OLD."createdAt") THEN RAISE EXCEPTION 'Recurring consent identity is immutable'; END IF;
  IF OLD."cardVerifiedAt" IS NOT NULL AND ROW(NEW."customerId",NEW."paymentMethodId",NEW."setupIntentId",NEW."cardVerifiedAt") IS DISTINCT FROM ROW(OLD."customerId",OLD."paymentMethodId",OLD."setupIntentId",OLD."cardVerifiedAt") THEN RAISE EXCEPTION 'Recurring card identity is immutable'; END IF;
  IF OLD."stopKind" IS NOT NULL AND ROW(NEW."stopKind",NEW."stopRequestedAt",NEW."stopEffectiveDate") IS DISTINCT FROM ROW(OLD."stopKind",OLD."stopRequestedAt",OLD."stopEffectiveDate") THEN RAISE EXCEPTION 'Recurring notice is immutable'; END IF;
  IF OLD."status"='pending' AND NEW."status"='active' THEN
   IF NEW."customerId" IS NULL OR coalesce(length(NEW."paymentMethodId"),0)=0 OR coalesce(length(NEW."setupIntentId"),0)=0 OR NOT EXISTS(SELECT 1 FROM "User" WHERE "id"=NEW."payerUserId" AND "stripeTestCustomerId"=NEW."customerId") THEN RAISE EXCEPTION 'Recurring activation requires owned verified card'; END IF;NEW."cardVerifiedAt":=clock_timestamp();
  ELSIF OLD."status"='pending' AND NEW."status"='cancelled' THEN NEW."stoppedAt":=clock_timestamp();
  ELSIF OLD."status"='active' AND NEW."status" IN ('paused','cancelled') THEN
   IF OLD."stopEffectiveDate" IS NULL OR current_day<OLD."stopEffectiveDate"::date OR (NEW."status"='paused') IS DISTINCT FROM (OLD."stopKind"='pause') THEN RAISE EXCEPTION 'Subscription notice has not elapsed'; END IF; NEW."stoppedAt":=clock_timestamp();
  ELSIF NEW."status"<>OLD."status" OR ROW(NEW."customerId",NEW."paymentMethodId",NEW."setupIntentId",NEW."cardVerifiedAt",NEW."stoppedAt") IS DISTINCT FROM ROW(OLD."customerId",OLD."paymentMethodId",OLD."setupIntentId",OLD."cardVerifiedAt",OLD."stoppedAt") THEN RAISE EXCEPTION 'Invalid subscription transition'; END IF;
  IF OLD."stopKind" IS NULL AND NEW."stopKind" IS NOT NULL THEN
   IF NEW."status"<>'active' OR NEW."stopEffectiveDate" IS NULL OR NEW."stopEffectiveDate"<>to_char(NEW."stopEffectiveDate"::date,'YYYY-MM-DD') OR NEW."stopEffectiveDate"::date<current_day+30 THEN RAISE EXCEPTION 'Subscription needs 30 local days notice'; END IF;NEW."stopRequestedAt":=clock_timestamp();
  ELSIF OLD."stopKind" IS NULL AND ROW(NEW."stopRequestedAt",NEW."stopEffectiveDate") IS DISTINCT FROM ROW(OLD."stopRequestedAt",OLD."stopEffectiveDate") THEN RAISE EXCEPTION 'Notice requires explicit action'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER "RecurringSubscription_guard" BEFORE INSERT OR UPDATE ON "RecurringSubscription" FOR EACH ROW EXECUTE FUNCTION recurring_subscription_guard();
CREATE FUNCTION recurring_occurrence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "RecurringPlan";
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW."recurringPlanId",NEW."recurringLocalDate") IS DISTINCT FROM ROW(OLD."recurringPlanId",OLD."recurringLocalDate") OR (OLD."recurringPlanId" IS NOT NULL AND ROW(NEW."agreementId",NEW."serviceDate",NEW."sequence") IS DISTINCT FROM ROW(OLD."agreementId",OLD."serviceDate",OLD."sequence")) THEN RAISE EXCEPTION 'Recurring occurrence identity is immutable'; END IF;RETURN NEW;
 END IF;
 IF NEW."recurringPlanId" IS NULL THEN IF NEW."recurringLocalDate" IS NOT NULL THEN RAISE EXCEPTION 'Recurring date requires plan'; END IF;RETURN NEW;END IF;
 PERFORM 1 FROM "ServiceAgreement" WHERE "id"=NEW."agreementId" FOR UPDATE;
 SELECT * INTO p FROM "RecurringPlan" WHERE "id"=NEW."recurringPlanId" FOR UPDATE;
 IF NOT COALESCE(NEW."recurringLocalDate"=to_char(NEW."recurringLocalDate"::date,'YYYY-MM-DD') AND p."agreementId"=NEW."agreementId" AND p."acceptedAt" IS NOT NULL AND p."status" IN ('active','ending') AND NEW."recurringLocalDate">=p."anchorDate" AND (p."endEffectiveDate" IS NULL OR NEW."recurringLocalDate"<p."endEffectiveDate") AND ((NEW."recurringLocalDate"::date-p."anchorDate"::date)%p."cadenceDays")=0 AND NEW."serviceDate"=((NEW."recurringLocalDate"::date+time '12:00') AT TIME ZONE p."timezone" AT TIME ZONE 'UTC'),false) THEN RAISE EXCEPTION 'Invalid recurring service date'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER "ServiceOccurrence_recurring_guard" BEFORE INSERT OR UPDATE ON "ServiceOccurrence" FOR EACH ROW EXECUTE FUNCTION recurring_occurrence_guard();
CREATE FUNCTION recurring_visit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "RecurringPlan"; s "RecurringSubscription"; o "ServiceOccurrence"; n integer; rank integer; expected integer;
BEGIN
 SELECT * INTO o FROM "ServiceOccurrence" WHERE "id"=NEW."occurrenceId";
 IF TG_OP='UPDATE' AND (ROW(NEW."recurringSubscriptionId",NEW."recurringMonth") IS DISTINCT FROM ROW(OLD."recurringSubscriptionId",OLD."recurringMonth") OR (OLD."recurringSubscriptionId" IS NOT NULL AND ROW(NEW."occurrenceId",NEW."unitId",NEW."billingPayerUserId",NEW."allocatedVisitCents",NEW."requiresAfterPhoto",NEW."redoOfVisitId") IS DISTINCT FROM ROW(OLD."occurrenceId",OLD."unitId",OLD."billingPayerUserId",OLD."allocatedVisitCents",OLD."requiresAfterPhoto",OLD."redoOfVisitId"))) THEN RAISE EXCEPTION 'Recurring visit identity is immutable';END IF;
 IF o."recurringPlanId" IS NULL THEN IF NEW."recurringSubscriptionId" IS NOT NULL OR NEW."recurringMonth" IS NOT NULL THEN RAISE EXCEPTION 'Recurring visit requires recurring occurrence'; END IF;RETURN NEW;END IF;
 PERFORM 1 FROM "ServiceAgreement" WHERE "id"=o."agreementId" FOR UPDATE;
 SELECT * INTO p FROM "RecurringPlan" WHERE "id"=o."recurringPlanId" FOR UPDATE;
 SELECT * INTO s FROM "RecurringSubscription" WHERE "id"=NEW."recurringSubscriptionId" FOR SHARE;
 IF TG_OP='UPDATE' THEN
  IF EXISTS(SELECT 1 FROM "RecurringBillLine" WHERE "visitId"=NEW."id") AND ROW(NEW."status",NEW."completedAt",NEW."allocatedVisitCents",NEW."billingPayerUserId") IS DISTINCT FROM ROW(OLD."status",OLD."completedAt",OLD."allocatedVisitCents",OLD."billingPayerUserId") THEN RAISE EXCEPTION 'Sealed monthly service is immutable';END IF;RETURN NEW;
 END IF;
 IF NOT COALESCE(p."status" IN ('active','ending') AND p."acceptedAt" IS NOT NULL AND o."recurringLocalDate">=p."anchorDate" AND (p."endEffectiveDate" IS NULL OR o."recurringLocalDate"<p."endEffectiveDate") AND s."planId"=p."id" AND s."status"='active' AND s."cardVerifiedAt" IS NOT NULL AND s."startDate"<=o."recurringLocalDate" AND (s."stopEffectiveDate" IS NULL OR o."recurringLocalDate"<s."stopEffectiveDate") AND NEW."unitId"=s."unitId" AND NEW."billingPayerUserId"=s."payerUserId" AND NEW."recurringMonth"=substring(o."recurringLocalDate",1,7) AND NEW."requiresAfterPhoto"=p."requiresAfterPhoto" AND NEW."redoOfVisitId" IS NULL,false) THEN RAISE EXCEPTION 'Invalid recurring visit authorization';END IF;
 SELECT count(*),count(*) FILTER(WHERE day::date<=o."recurringLocalDate"::date) INTO n,rank FROM generate_series((NEW."recurringMonth"||'-01')::date,((NEW."recurringMonth"||'-01')::date+interval '1 month-1 day')::date,interval '1 day') day WHERE ((day::date-p."anchorDate"::date)%p."cadenceDays")=0;
 expected:=p."monthlyPriceCents"/n+CASE WHEN rank<=p."monthlyPriceCents"%n THEN 1 ELSE 0 END;
 IF NEW."allocatedVisitCents" IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Recurring monthly allocation mismatch';END IF;
 IF EXISTS(SELECT 1 FROM "RecurringMonthlyBill" WHERE "subscriptionId"=s."id" AND "month"=NEW."recurringMonth") THEN RAISE EXCEPTION 'Cannot add service to a sealed month';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "ServiceVisit_recurring_guard" BEFORE INSERT OR UPDATE ON "ServiceVisit" FOR EACH ROW EXECUTE FUNCTION recurring_visit_guard();
CREATE OR REPLACE FUNCTION bundleen_protected_visit_authorization() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agreement_id TEXT; protected BOOLEAN; a "AgreementBillingAuthorization"; allocated BIGINT;
BEGIN
 IF NEW."recurringSubscriptionId" IS NOT NULL OR (NEW."redoOfVisitId" IS NOT NULL AND EXISTS(SELECT 1 FROM "ServiceVisit" WHERE "id"=NEW."redoOfVisitId" AND "recurringSubscriptionId" IS NOT NULL)) THEN RETURN NEW; END IF;
 SELECT g."id",r."stripeTestEnrollmentRequired" INTO agreement_id,protected FROM "ServiceOccurrence" o JOIN "ServiceAgreement" g ON g."id"=o."agreementId" JOIN "HoaServiceRequest" r ON r."id"=g."requestId" WHERE o."id"=NEW."occurrenceId";
 IF NOT protected THEN RETURN NEW;END IF;
 SELECT * INTO a FROM "AgreementBillingAuthorization" WHERE "agreementId"=agreement_id AND "unitId"=NEW."unitId";
 IF NOT COALESCE(a."payerUserId"=NEW."billingPayerUserId" AND NEW."allocatedVisitCents" IS NOT NULL,false) THEN RAISE EXCEPTION 'Visit requires original enrollment authorization';END IF;
 SELECT sum(v."allocatedVisitCents") INTO allocated FROM "ServiceVisit" v JOIN "ServiceOccurrence" o ON o."id"=v."occurrenceId" WHERE o."agreementId"=agreement_id AND v."unitId"=NEW."unitId" AND v."recurringSubscriptionId" IS NULL;
 IF allocated>a."authorizedTotalCents" THEN RAISE EXCEPTION 'Visit allocations exceed authorized total';END IF;RETURN NEW;
END $$;
CREATE FUNCTION recurring_no_legacy_charge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM "ServiceVisit" WHERE "id"=NEW."visitId" AND "recurringSubscriptionId" IS NOT NULL) THEN RAISE EXCEPTION 'Recurring visits require their distinct billing adapter';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "StripeTestPayment_recurring_guard" BEFORE INSERT ON "StripeTestPayment" FOR EACH ROW EXECUTE FUNCTION recurring_no_legacy_charge();
CREATE FUNCTION recurring_no_legacy_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."kind"='stripe_test_visit_charge' AND EXISTS(SELECT 1 FROM "ServiceVisit" WHERE "id"=NEW."payload"->>'visitId' AND "recurringSubscriptionId" IS NOT NULL) THEN RAISE EXCEPTION 'Recurring visits cannot enqueue legacy charges';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "OutboxEvent_recurring_guard" BEFORE INSERT OR UPDATE ON "OutboxEvent" FOR EACH ROW EXECUTE FUNCTION recurring_no_legacy_outbox();
CREATE FUNCTION recurring_agreement_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."status" IN ('completed','cancelled') AND EXISTS(SELECT 1 FROM "RecurringPlan" WHERE "agreementId"=NEW."id" AND "status" IN ('active','ending')) THEN RAISE EXCEPTION 'Use recurring plan notice before ending agreement';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "ServiceAgreement_recurring_lifecycle" BEFORE UPDATE ON "ServiceAgreement" FOR EACH ROW EXECUTE FUNCTION recurring_agreement_lifecycle();
CREATE FUNCTION recurring_bill_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "RecurringPlan"; s "RecurringSubscription"; total bigint;
BEGIN
 SELECT * INTO p FROM "RecurringPlan" WHERE "id"=NEW."planId";
 PERFORM 1 FROM "ServiceAgreement" WHERE "id"=p."agreementId" FOR UPDATE;
 SELECT * INTO p FROM "RecurringPlan" WHERE "id"=NEW."planId" FOR UPDATE;
 SELECT * INTO s FROM "RecurringSubscription" WHERE "id"=NEW."subscriptionId";
 IF NOT COALESCE(p."billingMode"='monthly' AND s."planId"=p."id" AND s."unitId"=NEW."unitId" AND s."payerUserId"=NEW."payerUserId" AND p."timezone"=NEW."timezone" AND p."currency"=NEW."currency" AND NEW."month"~'^\d{4}-(0[1-9]|1[0-2])$' AND (((NEW."month"||'-01')::date+interval '1 month') AT TIME ZONE p."timezone")<=clock_timestamp(),false) THEN RAISE EXCEPTION 'Invalid ended recurring month';END IF;
 IF EXISTS(SELECT 1 FROM "ServiceVisit" WHERE "recurringSubscriptionId"=s."id" AND "recurringMonth"=NEW."month" AND "status" NOT IN ('completed','skipped','blocked','cancelled')) THEN RAISE EXCEPTION 'Recurring month has unresolved service';END IF;
 SELECT coalesce(sum(CASE WHEN "status"='completed' THEN "allocatedVisitCents" ELSE 0 END),0) INTO total FROM "ServiceVisit" WHERE "recurringSubscriptionId"=s."id" AND "recurringMonth"=NEW."month" AND "redoOfVisitId" IS NULL;
 IF NEW."amountCents"<>total OR total>s."monthlyCapCents" THEN RAISE EXCEPTION 'Recurring bill exceeds completed allocations';END IF;
 NEW."sealedAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER "RecurringMonthlyBill_guard" BEFORE INSERT ON "RecurringMonthlyBill" FOR EACH ROW EXECUTE FUNCTION recurring_bill_guard();
CREATE FUNCTION recurring_bill_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "RecurringMonthlyBill"; v "ServiceVisit";
BEGIN
 SELECT * INTO b FROM "RecurringMonthlyBill" WHERE "id"=NEW."billId";
 SELECT * INTO v FROM "ServiceVisit" WHERE "id"=NEW."visitId";
 IF NOT COALESCE(v."recurringSubscriptionId"=b."subscriptionId" AND v."recurringMonth"=b."month" AND v."unitId"=b."unitId" AND v."billingPayerUserId"=b."payerUserId" AND v."redoOfVisitId" IS NULL AND NEW."allocatedCents"=v."allocatedVisitCents" AND NEW."statusAtSeal"=v."status"::text AND NEW."completedAt" IS NOT DISTINCT FROM v."completedAt" AND NEW."amountCents"=(CASE WHEN v."status"='completed' THEN v."allocatedVisitCents" ELSE 0 END),false) THEN RAISE EXCEPTION 'Recurring bill constituent mismatch';END IF;RETURN NEW;
END $$;
CREATE TRIGGER "RecurringBillLine_guard" BEFORE INSERT ON "RecurringBillLine" FOR EACH ROW EXECUTE FUNCTION recurring_bill_line_guard();
CREATE FUNCTION recurring_bill_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint; m bigint; total bigint;
BEGIN
 SELECT count(*) INTO n FROM "ServiceVisit" WHERE "recurringSubscriptionId"=NEW."subscriptionId" AND "recurringMonth"=NEW."month" AND "redoOfVisitId" IS NULL;
 SELECT count(*),coalesce(sum("amountCents"),0) INTO m,total FROM "RecurringBillLine" WHERE "billId"=NEW."id";
 IF n<>m OR total<>NEW."amountCents" THEN RAISE EXCEPTION 'Recurring bill must freeze every constituent';END IF;RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "RecurringMonthlyBill_complete" AFTER INSERT ON "RecurringMonthlyBill" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION recurring_bill_complete();
CREATE TRIGGER "RecurringPlan_no_delete" BEFORE DELETE ON "RecurringPlan" FOR EACH ROW EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER "RecurringSubscription_no_delete" BEFORE DELETE ON "RecurringSubscription" FOR EACH ROW EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER "RecurringMonthlyBill_immutable" BEFORE UPDATE OR DELETE ON "RecurringMonthlyBill" FOR EACH ROW EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER "RecurringBillLine_immutable" BEFORE UPDATE OR DELETE ON "RecurringBillLine" FOR EACH ROW EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER "RecurringPlan_no_truncate" BEFORE TRUNCATE ON "RecurringPlan" EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER "RecurringSubscription_no_truncate" BEFORE TRUNCATE ON "RecurringSubscription" EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER "RecurringMonthlyBill_no_truncate" BEFORE TRUNCATE ON "RecurringMonthlyBill" EXECUTE FUNCTION hoa_share_immutable();
CREATE TRIGGER "RecurringBillLine_no_truncate" BEFORE TRUNCATE ON "RecurringBillLine" EXECUTE FUNCTION hoa_share_immutable();
CREATE FUNCTION recurring_service_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='ServiceVisit' THEN IF OLD."recurringSubscriptionId" IS NOT NULL THEN RAISE EXCEPTION 'Cancel recurring visits; do not delete billing history';END IF;
 ELSE IF OLD."recurringPlanId" IS NOT NULL THEN RAISE EXCEPTION 'Cancel recurring occurrences; do not delete history';END IF;END IF;RETURN OLD;
END $$;
CREATE TRIGGER "ServiceVisit_recurring_no_delete" BEFORE DELETE ON "ServiceVisit" FOR EACH ROW EXECUTE FUNCTION recurring_service_no_delete();
CREATE TRIGGER "ServiceOccurrence_recurring_no_delete" BEFORE DELETE ON "ServiceOccurrence" FOR EACH ROW EXECUTE FUNCTION recurring_service_no_delete();
