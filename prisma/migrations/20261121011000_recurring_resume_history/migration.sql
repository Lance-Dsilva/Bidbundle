DROP INDEX "ServiceVisit_occurrenceId_unitId_key";
CREATE INDEX "ServiceVisit_occurrenceId_unitId_idx" ON "ServiceVisit"("occurrenceId","unitId");
CREATE UNIQUE INDEX "ServiceVisit_legacy_occurrence_unit" ON "ServiceVisit"("occurrenceId","unitId") WHERE "recurringSubscriptionId" IS NULL;
CREATE UNIQUE INDEX "ServiceVisit_occurrenceId_unitId_recurringSubscriptionId_key" ON "ServiceVisit"("occurrenceId","unitId","recurringSubscriptionId");
CREATE UNIQUE INDEX "ServiceVisit_recurring_active_unit" ON "ServiceVisit"("occurrenceId","unitId") WHERE "recurringSubscriptionId" IS NOT NULL AND "status"<>'cancelled';
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
  IF OLD."status" IN ('completed','skipped','blocked','cancelled') AND NEW."status"<>OLD."status" THEN RAISE EXCEPTION 'Resolved recurring service cannot be reopened';END IF;
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
