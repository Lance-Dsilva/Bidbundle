ALTER TABLE "ServiceVisit"
  ADD COLUMN "allocatedVisitCents" INTEGER,
  ADD CONSTRAINT "ServiceVisit_allocatedVisitCents_nonnegative"
    CHECK ("allocatedVisitCents" >= 0);

CREATE FUNCTION "prevent_visit_allocation_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."allocatedVisitCents" IS DISTINCT FROM OLD."allocatedVisitCents"
    OR (OLD."allocatedVisitCents" IS NOT NULL AND
      ROW(NEW."occurrenceId", NEW."unitId", NEW."homeownerUserId")
        IS DISTINCT FROM ROW(OLD."occurrenceId", OLD."unitId", OLD."homeownerUserId")) THEN
    RAISE EXCEPTION 'The visit billing allocation is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'ServiceVisit_allocatedVisitCents_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ServiceVisit_allocatedVisitCents_immutable"
  BEFORE UPDATE ON "ServiceVisit"
  FOR EACH ROW EXECUTE FUNCTION "prevent_visit_allocation_change"();
