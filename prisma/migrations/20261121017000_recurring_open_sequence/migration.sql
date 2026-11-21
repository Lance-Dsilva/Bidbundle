-- Open-ended plans outlive finite request coverage. The existing foreign key
-- and recurring_occurrence_guard validate and freeze the plan/date binding;
-- an arbitrary marker cannot turn a finite occurrence into a recurring one.
ALTER TABLE "ServiceOccurrence" DROP CONSTRAINT "ServiceOccurrence_sequence";
ALTER TABLE "ServiceOccurrence" ADD CONSTRAINT "ServiceOccurrence_sequence"
 CHECK ("sequence" >= 1 AND ("recurringPlanId" IS NOT NULL OR "sequence" <= 104));
