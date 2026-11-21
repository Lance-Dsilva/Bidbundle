CREATE TABLE "RecurringFinancialObservation" (
 id text PRIMARY KEY,"eventId" text NOT NULL UNIQUE REFERENCES "StripeTestEvent"(id) ON DELETE RESTRICT,"chargeId" text NOT NULL REFERENCES "RecurringCharge"(id) ON DELETE RESTRICT,"eventType" text NOT NULL,"objectId" text NOT NULL,"processorChargeId" text,"processorTransferId" text,"refundedCents" integer NOT NULL CHECK("refundedCents">=0),"reversedCents" integer NOT NULL CHECK("reversedCents">=0),disputed boolean NOT NULL,"disputeId" text,"disputeStatus" text,"holdReason" text,"observedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX recurring_observation_charge_time ON "RecurringFinancialObservation"("chargeId","observedAt");
CREATE FUNCTION recurring_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "RecurringCharge"; e "StripeTestEvent";
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Recurring financial observations are immutable'; END IF;
 SELECT * INTO c FROM "RecurringCharge" WHERE id=NEW."chargeId" FOR UPDATE;
 SELECT * INTO e FROM "StripeTestEvent" WHERE id=NEW."eventId";
 IF c.id IS NULL OR e.id IS NULL OR e."accountId" IS NOT NULL OR (NEW."eventType",NEW."objectId") IS DISTINCT FROM (e."eventType",e."objectId") OR NEW."processorChargeId" IS DISTINCT FROM c."stripeChargeId" OR NEW."refundedCents"<>c."observedRefundedCents" OR NEW."reversedCents"<>c."observedReversedCents" OR NEW."holdReason" IS DISTINCT FROM c."reconciliationHoldReason" THEN RAISE EXCEPTION 'Recurring observation scope mismatch'; END IF;
 IF NEW."processorTransferId" IS DISTINCT FROM c."stripeTransferId" OR NEW.disputed IS DISTINCT FROM (c.status='disputed') THEN RAISE EXCEPTION 'Recurring observation financial identity mismatch'; END IF;
 IF e."eventType" LIKE 'charge.dispute.%' THEN
  IF NEW."disputeId" IS DISTINCT FROM e."objectId" OR NEW."disputeStatus" IS NULL OR length(NEW."disputeStatus")=0 THEN RAISE EXCEPTION 'Recurring dispute observation identity mismatch'; END IF;
 ELSIF NEW."disputeId" IS NOT NULL OR NEW."disputeStatus" IS NOT NULL THEN RAISE EXCEPTION 'Unexpected recurring dispute observation'; END IF;
 NEW."observedAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER recurring_observation_guard BEFORE INSERT OR UPDATE OR DELETE ON "RecurringFinancialObservation" FOR EACH ROW EXECUTE FUNCTION recurring_observation_guard();
CREATE TRIGGER recurring_observation_no_truncate BEFORE TRUNCATE ON "RecurringFinancialObservation" FOR EACH STATEMENT EXECUTE FUNCTION recurring_no_truncate();
