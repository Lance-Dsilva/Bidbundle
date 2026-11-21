CREATE OR REPLACE FUNCTION recurring_occurrence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "RecurringPlan";
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD."recurringPlanId" IS NOT NULL THEN
   PERFORM 1 FROM "ServiceAgreement" WHERE "id"=OLD."agreementId" FOR UPDATE;
   SELECT * INTO p FROM "RecurringPlan" WHERE "id"=OLD."recurringPlanId";
   IF NEW."status" IN ('completed','cancelled') AND OLD."status"<>NEW."status" AND EXISTS(SELECT 1 FROM "ServiceVisit" WHERE "occurrenceId"=OLD."id" AND "status" NOT IN ('completed','skipped','blocked','cancelled')) THEN RAISE EXCEPTION 'Resolve all recurring visits before closing';END IF;
   IF OLD."status" IN ('completed','cancelled') AND NEW."status"<>OLD."status" THEN RAISE EXCEPTION 'Closed recurring days remain closed';END IF;
   IF NEW."status" IN ('completed','cancelled') AND OLD."status"<>NEW."status" AND OLD."recurringLocalDate"::date>(clock_timestamp() AT TIME ZONE p."timezone")::date THEN RAISE EXCEPTION 'Future recurring days cannot close';END IF;
  END IF;
  IF ROW(NEW."recurringPlanId",NEW."recurringLocalDate") IS DISTINCT FROM ROW(OLD."recurringPlanId",OLD."recurringLocalDate") OR (OLD."recurringPlanId" IS NOT NULL AND ROW(NEW."agreementId",NEW."serviceDate",NEW."sequence") IS DISTINCT FROM ROW(OLD."agreementId",OLD."serviceDate",OLD."sequence")) THEN RAISE EXCEPTION 'Recurring occurrence identity is immutable'; END IF;RETURN NEW;
 END IF;
 IF NEW."recurringPlanId" IS NULL THEN IF NEW."recurringLocalDate" IS NOT NULL THEN RAISE EXCEPTION 'Recurring date requires plan'; END IF;RETURN NEW;END IF;
 IF NEW."status"<>'planned' OR NEW."closedAt" IS NOT NULL THEN RAISE EXCEPTION 'New recurring day must start planned';END IF;
 PERFORM 1 FROM "ServiceAgreement" WHERE "id"=NEW."agreementId" FOR UPDATE;
 SELECT * INTO p FROM "RecurringPlan" WHERE "id"=NEW."recurringPlanId" FOR UPDATE;
 IF NOT COALESCE(NEW."recurringLocalDate"=to_char(NEW."recurringLocalDate"::date,'YYYY-MM-DD') AND p."agreementId"=NEW."agreementId" AND p."acceptedAt" IS NOT NULL AND p."status" IN ('active','ending') AND NEW."recurringLocalDate">=p."anchorDate" AND (p."endEffectiveDate" IS NULL OR NEW."recurringLocalDate"<p."endEffectiveDate") AND ((NEW."recurringLocalDate"::date-p."anchorDate"::date)%p."cadenceDays")=0 AND NEW."serviceDate"=((NEW."recurringLocalDate"::date+time '12:00') AT TIME ZONE p."timezone" AT TIME ZONE 'UTC'),false) THEN RAISE EXCEPTION 'Invalid recurring service date'; END IF;RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION recurring_visit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "RecurringPlan"; s "RecurringSubscription"; o "ServiceOccurrence"; n integer; rank integer; expected integer;
BEGIN
 SELECT * INTO o FROM "ServiceOccurrence" WHERE "id"=NEW."occurrenceId";
 IF TG_OP='UPDATE' AND (ROW(NEW."recurringSubscriptionId",NEW."recurringMonth") IS DISTINCT FROM ROW(OLD."recurringSubscriptionId",OLD."recurringMonth") OR (OLD."recurringSubscriptionId" IS NOT NULL AND ROW(NEW."occurrenceId",NEW."unitId",NEW."billingPayerUserId",NEW."allocatedVisitCents",NEW."requiresAfterPhoto",NEW."redoOfVisitId") IS DISTINCT FROM ROW(OLD."occurrenceId",OLD."unitId",OLD."billingPayerUserId",OLD."allocatedVisitCents",OLD."requiresAfterPhoto",OLD."redoOfVisitId"))) THEN RAISE EXCEPTION 'Recurring visit identity is immutable';END IF;
 IF o."recurringPlanId" IS NULL THEN IF NEW."recurringSubscriptionId" IS NOT NULL OR NEW."recurringMonth" IS NOT NULL THEN RAISE EXCEPTION 'Recurring visit requires recurring occurrence'; END IF;RETURN NEW;END IF;
 PERFORM 1 FROM "ServiceAgreement" WHERE "id"=o."agreementId" FOR UPDATE;
 SELECT * INTO o FROM "ServiceOccurrence" WHERE "id"=NEW."occurrenceId";
 SELECT * INTO p FROM "RecurringPlan" WHERE "id"=o."recurringPlanId" FOR UPDATE;
 SELECT * INTO s FROM "RecurringSubscription" WHERE "id"=NEW."recurringSubscriptionId" FOR SHARE;
 IF TG_OP='UPDATE' THEN
  IF OLD."status" IN ('completed','skipped','blocked','cancelled') AND NEW."status"<>OLD."status" THEN RAISE EXCEPTION 'Resolved recurring service cannot be reopened';END IF;
  IF NEW."status"='completed' AND OLD."status"<>'completed' AND (o."recurringLocalDate"::date>(clock_timestamp() AT TIME ZONE p."timezone")::date OR (s."stopEffectiveDate" IS NOT NULL AND o."recurringLocalDate">=s."stopEffectiveDate") OR (p."endEffectiveDate" IS NOT NULL AND o."recurringLocalDate">=p."endEffectiveDate")) THEN RAISE EXCEPTION 'Recurring service is future or outside notice coverage';END IF;
  IF EXISTS(SELECT 1 FROM "RecurringBillLine" WHERE "visitId"=NEW."id") AND ROW(NEW."status",NEW."completedAt",NEW."allocatedVisitCents",NEW."billingPayerUserId") IS DISTINCT FROM ROW(OLD."status",OLD."completedAt",OLD."allocatedVisitCents",OLD."billingPayerUserId") THEN RAISE EXCEPTION 'Sealed monthly service is immutable';END IF;RETURN NEW;
 END IF;
 IF o."status" IN ('completed','cancelled') OR NEW."status"<>'unscheduled' OR NEW."completedAt" IS NOT NULL THEN RAISE EXCEPTION 'New recurring service must start unscheduled';END IF;
 IF NOT COALESCE(p."status" IN ('active','ending') AND p."acceptedAt" IS NOT NULL AND o."recurringLocalDate">=p."anchorDate" AND (p."endEffectiveDate" IS NULL OR o."recurringLocalDate"<p."endEffectiveDate") AND s."planId"=p."id" AND s."status"='active' AND s."cardVerifiedAt" IS NOT NULL AND s."startDate"<=o."recurringLocalDate" AND (s."stopEffectiveDate" IS NULL OR o."recurringLocalDate"<s."stopEffectiveDate") AND NEW."unitId"=s."unitId" AND NEW."billingPayerUserId"=s."payerUserId" AND NEW."recurringMonth"=substring(o."recurringLocalDate",1,7) AND NEW."requiresAfterPhoto"=p."requiresAfterPhoto" AND NEW."redoOfVisitId" IS NULL,false) THEN RAISE EXCEPTION 'Invalid recurring visit authorization';END IF;
 SELECT count(*),count(*) FILTER(WHERE day::date<=o."recurringLocalDate"::date) INTO n,rank FROM generate_series((NEW."recurringMonth"||'-01')::date,((NEW."recurringMonth"||'-01')::date+interval '1 month - 1 day')::date,interval '1 day') day WHERE ((day::date-p."anchorDate"::date)%p."cadenceDays")=0;
 expected:=p."monthlyPriceCents"/n+CASE WHEN rank<=p."monthlyPriceCents"%n THEN 1 ELSE 0 END;
 IF NEW."allocatedVisitCents" IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Recurring monthly allocation mismatch';END IF;
 IF EXISTS(SELECT 1 FROM "RecurringMonthlyBill" WHERE "subscriptionId"=s."id" AND "month"=NEW."recurringMonth") THEN RAISE EXCEPTION 'Cannot add service to a sealed month';END IF;RETURN NEW;
END $$;
