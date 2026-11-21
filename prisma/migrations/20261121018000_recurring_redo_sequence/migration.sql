-- A quality redo is a distinct zero-charge occurrence, not a new cadence visit.
ALTER TABLE "ServiceOccurrence" ADD COLUMN "recurringRedoOfVisitId" text UNIQUE REFERENCES "ServiceVisit"(id) ON DELETE RESTRICT;
ALTER TABLE "ServiceOccurrence" DROP CONSTRAINT "ServiceOccurrence_sequence";
ALTER TABLE "ServiceOccurrence" ADD CONSTRAINT "ServiceOccurrence_sequence"
 CHECK ("sequence">=1 AND ("recurringPlanId" IS NOT NULL OR "recurringRedoOfVisitId" IS NOT NULL OR "sequence"<=104));
CREATE FUNCTION recurring_redo_occurrence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "ServiceVisit"; original "ServiceOccurrence";
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD."recurringRedoOfVisitId" IS NOT NULL THEN RAISE EXCEPTION 'Recurring redo audit cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW."recurringRedoOfVisitId" IS DISTINCT FROM OLD."recurringRedoOfVisitId" OR (OLD."recurringRedoOfVisitId" IS NOT NULL AND (NEW."agreementId",NEW."serviceDate",NEW.sequence) IS DISTINCT FROM (OLD."agreementId",OLD."serviceDate",OLD.sequence)) THEN RAISE EXCEPTION 'Recurring redo occurrence identity is immutable'; END IF;
  RETURN NEW;
 END IF;
 IF NEW."recurringRedoOfVisitId" IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO v FROM "ServiceVisit" WHERE id=NEW."recurringRedoOfVisitId" FOR SHARE;
 SELECT * INTO original FROM "ServiceOccurrence" WHERE id=v."occurrenceId";
 PERFORM id FROM "ServiceAgreement" WHERE id=NEW."agreementId" FOR UPDATE;
 IF v.id IS NULL OR v."recurringSubscriptionId" IS NULL OR v."redoOfVisitId" IS NOT NULL OR v.status<>'completed' OR v."completedAt" IS NULL OR original."recurringPlanId" IS NULL OR original."agreementId" IS DISTINCT FROM NEW."agreementId" OR NEW."recurringPlanId" IS NOT NULL OR NEW."recurringLocalDate" IS NOT NULL OR NEW.status<>'planned' OR NEW."closedAt" IS NOT NULL OR NEW."serviceDate"<clock_timestamp() OR NOT EXISTS(SELECT 1 FROM "ServiceQualityClaim" WHERE "visitId"=v.id AND resolution='redo_pending' AND "refundOperationId" IS NULL AND "recurringRefundOperationId" IS NULL) THEN RAISE EXCEPTION 'Recurring redo occurrence requires original completed service and an open redo claim'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recurring_redo_occurrence_guard BEFORE INSERT OR UPDATE OR DELETE ON "ServiceOccurrence" FOR EACH ROW EXECUTE FUNCTION recurring_redo_occurrence_guard();
CREATE FUNCTION recurring_redo_visit_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source text;
BEGIN
 IF TG_OP='UPDATE' AND NEW."occurrenceId" IS DISTINCT FROM OLD."occurrenceId" AND EXISTS(SELECT 1 FROM "ServiceOccurrence" WHERE id=OLD."occurrenceId" AND "recurringRedoOfVisitId" IS NOT NULL) THEN RAISE EXCEPTION 'Recurring redo visit occurrence is immutable'; END IF;
 SELECT "recurringRedoOfVisitId" INTO source FROM "ServiceOccurrence" WHERE id=NEW."occurrenceId";
 IF source IS NOT NULL AND (NEW."redoOfVisitId" IS DISTINCT FROM source OR NEW."allocatedVisitCents" IS DISTINCT FROM 0 OR NEW."recurringSubscriptionId" IS NOT NULL OR NEW."recurringMonth" IS NOT NULL) THEN RAISE EXCEPTION 'Recurring redo occurrence accepts only its original no-charge redo'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recurring_redo_visit_scope BEFORE INSERT OR UPDATE ON "ServiceVisit" FOR EACH ROW EXECUTE FUNCTION recurring_redo_visit_scope();
CREATE FUNCTION recurring_redo_complete_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid text; o "ServiceOccurrence"; child "ServiceVisit"; n integer;
BEGIN
 IF TG_TABLE_NAME='ServiceOccurrence' THEN oid:=NEW.id;
 ELSIF TG_OP='DELETE' THEN oid:=OLD."occurrenceId";
 ELSE oid:=NEW."occurrenceId"; END IF;
 SELECT * INTO o FROM "ServiceOccurrence" WHERE id=oid;
 IF o."recurringRedoOfVisitId" IS NULL THEN RETURN NULL; END IF;
 SELECT count(*) INTO n FROM "ServiceVisit" WHERE "occurrenceId"=oid;
 SELECT * INTO child FROM "ServiceVisit" WHERE "occurrenceId"=oid;
 IF n<>1 OR child."redoOfVisitId" IS DISTINCT FROM o."recurringRedoOfVisitId" OR child."allocatedVisitCents" IS DISTINCT FROM 0 OR NOT EXISTS(SELECT 1 FROM "ServiceQualityClaim" WHERE "visitId"=o."recurringRedoOfVisitId" AND "redoVisitId"=child.id AND resolution IN('redo_pending','redo_complete') AND "refundOperationId" IS NULL AND "recurringRefundOperationId" IS NULL) THEN RAISE EXCEPTION 'Recurring redo occurrence requires its unique linked no-charge visit'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER recurring_redo_occurrence_complete AFTER INSERT OR UPDATE ON "ServiceOccurrence" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION recurring_redo_complete_identity();
CREATE CONSTRAINT TRIGGER recurring_redo_visit_complete AFTER INSERT OR UPDATE OR DELETE ON "ServiceVisit" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION recurring_redo_complete_identity();
