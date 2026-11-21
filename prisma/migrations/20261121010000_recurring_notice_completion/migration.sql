CREATE OR REPLACE FUNCTION recurring_subscription_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
   IF NOT (NEW."status"='cancelled' AND p."status"='ended' AND p."endEffectiveDate" IS NOT NULL AND current_day>=p."endEffectiveDate"::date) AND (OLD."stopEffectiveDate" IS NULL OR current_day<OLD."stopEffectiveDate"::date OR (NEW."status"='paused') IS DISTINCT FROM (OLD."stopKind"='pause')) THEN RAISE EXCEPTION 'Subscription notice has not elapsed'; END IF; NEW."stoppedAt":=clock_timestamp();
  ELSIF NEW."status"<>OLD."status" OR ROW(NEW."customerId",NEW."paymentMethodId",NEW."setupIntentId",NEW."cardVerifiedAt",NEW."stoppedAt") IS DISTINCT FROM ROW(OLD."customerId",OLD."paymentMethodId",OLD."setupIntentId",OLD."cardVerifiedAt",OLD."stoppedAt") THEN RAISE EXCEPTION 'Invalid subscription transition'; END IF;
  IF OLD."stopKind" IS NULL AND NEW."stopKind" IS NOT NULL THEN
   IF NEW."status"<>'active' OR NEW."stopEffectiveDate" IS NULL OR NEW."stopEffectiveDate"<>to_char(NEW."stopEffectiveDate"::date,'YYYY-MM-DD') OR NEW."stopEffectiveDate"::date<current_day+30 THEN RAISE EXCEPTION 'Subscription needs 30 local days notice'; END IF;NEW."stopRequestedAt":=clock_timestamp();
  ELSIF OLD."stopKind" IS NULL AND ROW(NEW."stopRequestedAt",NEW."stopEffectiveDate") IS DISTINCT FROM ROW(OLD."stopRequestedAt",OLD."stopEffectiveDate") THEN RAISE EXCEPTION 'Notice requires explicit action'; END IF;
 END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION recurring_visit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "RecurringPlan"; s "RecurringSubscription"; o "ServiceOccurrence"; n integer; rank integer; expected integer;
BEGIN
 SELECT * INTO o FROM "ServiceOccurrence" WHERE "id"=NEW."occurrenceId";
 IF TG_OP='UPDATE' AND (ROW(NEW."recurringSubscriptionId",NEW."recurringMonth") IS DISTINCT FROM ROW(OLD."recurringSubscriptionId",OLD."recurringMonth") OR (OLD."recurringSubscriptionId" IS NOT NULL AND ROW(NEW."occurrenceId",NEW."unitId",NEW."billingPayerUserId",NEW."allocatedVisitCents",NEW."requiresAfterPhoto",NEW."redoOfVisitId") IS DISTINCT FROM ROW(OLD."occurrenceId",OLD."unitId",OLD."billingPayerUserId",OLD."allocatedVisitCents",OLD."requiresAfterPhoto",OLD."redoOfVisitId"))) THEN RAISE EXCEPTION 'Recurring visit identity is immutable';END IF;
 IF o."recurringPlanId" IS NULL THEN IF NEW."recurringSubscriptionId" IS NOT NULL OR NEW."recurringMonth" IS NOT NULL THEN RAISE EXCEPTION 'Recurring visit requires recurring occurrence'; END IF;RETURN NEW;END IF;
 PERFORM 1 FROM "ServiceAgreement" WHERE "id"=o."agreementId" FOR UPDATE;
 SELECT * INTO p FROM "RecurringPlan" WHERE "id"=o."recurringPlanId" FOR UPDATE;
 SELECT * INTO s FROM "RecurringSubscription" WHERE "id"=NEW."recurringSubscriptionId" FOR SHARE;
 IF TG_OP='UPDATE' THEN
  IF NEW."status"='completed' AND OLD."status"<>'completed' AND (o."recurringLocalDate"::date>(clock_timestamp() AT TIME ZONE p."timezone")::date OR (s."stopEffectiveDate" IS NOT NULL AND o."recurringLocalDate">=s."stopEffectiveDate") OR (p."endEffectiveDate" IS NOT NULL AND o."recurringLocalDate">=p."endEffectiveDate")) THEN RAISE EXCEPTION 'Recurring service is future or outside notice coverage';END IF;
  IF EXISTS(SELECT 1 FROM "RecurringBillLine" WHERE "visitId"=NEW."id") AND ROW(NEW."status",NEW."completedAt",NEW."allocatedVisitCents",NEW."billingPayerUserId") IS DISTINCT FROM ROW(OLD."status",OLD."completedAt",OLD."allocatedVisitCents",OLD."billingPayerUserId") THEN RAISE EXCEPTION 'Sealed monthly service is immutable';END IF;RETURN NEW;
 END IF;
 IF NEW."status"<>'unscheduled' OR NEW."completedAt" IS NOT NULL THEN RAISE EXCEPTION 'New recurring service must start unscheduled';END IF;
 IF NOT COALESCE(p."status" IN ('active','ending') AND p."acceptedAt" IS NOT NULL AND o."recurringLocalDate">=p."anchorDate" AND (p."endEffectiveDate" IS NULL OR o."recurringLocalDate"<p."endEffectiveDate") AND s."planId"=p."id" AND s."status"='active' AND s."cardVerifiedAt" IS NOT NULL AND s."startDate"<=o."recurringLocalDate" AND (s."stopEffectiveDate" IS NULL OR o."recurringLocalDate"<s."stopEffectiveDate") AND NEW."unitId"=s."unitId" AND NEW."billingPayerUserId"=s."payerUserId" AND NEW."recurringMonth"=substring(o."recurringLocalDate",1,7) AND NEW."requiresAfterPhoto"=p."requiresAfterPhoto" AND NEW."redoOfVisitId" IS NULL,false) THEN RAISE EXCEPTION 'Invalid recurring visit authorization';END IF;
 SELECT count(*),count(*) FILTER(WHERE day::date<=o."recurringLocalDate"::date) INTO n,rank FROM generate_series((NEW."recurringMonth"||'-01')::date,((NEW."recurringMonth"||'-01')::date+interval '1 month - 1 day')::date,interval '1 day') day WHERE ((day::date-p."anchorDate"::date)%p."cadenceDays")=0;
 expected:=p."monthlyPriceCents"/n+CASE WHEN rank<=p."monthlyPriceCents"%n THEN 1 ELSE 0 END;
 IF NEW."allocatedVisitCents" IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Recurring monthly allocation mismatch';END IF;
 IF EXISTS(SELECT 1 FROM "RecurringMonthlyBill" WHERE "subscriptionId"=s."id" AND "month"=NEW."recurringMonth") THEN RAISE EXCEPTION 'Cannot add service to a sealed month';END IF;RETURN NEW;
END $$;
