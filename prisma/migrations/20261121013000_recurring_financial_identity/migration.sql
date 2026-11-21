-- CreateTable
CREATE TABLE "RecurringCharge" (
    "id" TEXT NOT NULL,
    "monthlyBillId" TEXT,
    "sourceVisitId" TEXT,
    "planId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "localMonth" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "receiptEmail" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "termsToken" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "amountCents" INTEGER NOT NULL,
    "platformFeeCents" INTEGER NOT NULL,
    "providerAmountCents" INTEGER NOT NULL,
    "hoaShareCents" INTEGER NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "hoaBps" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failureCode" TEXT,
    "reconciliationHoldReason" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "createAttemptedAt" TIMESTAMP(3),
    "confirmAttemptedAt" TIMESTAMP(3),
    "lastRecoveryAttemptId" TEXT,
    "stripeTransferId" TEXT,
    "transferAttemptedAt" TIMESTAMP(3),
    "transferAmountCents" INTEGER,
    "transferBaseProviderDebitCents" INTEGER,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "providerReversedCents" INTEGER NOT NULL DEFAULT 0,
    "observedRefundedCents" INTEGER NOT NULL DEFAULT 0,
    "observedReversedCents" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringChargeLine" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "providerCents" INTEGER NOT NULL,
    "hoaCents" INTEGER NOT NULL,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringChargeLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringChargeRecovery" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "setupIntentId" TEXT NOT NULL,
    "termsToken" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL DEFAULT 'recurring-recovery-exact-v1',
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringChargeRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringChargeRefund" (
    "id" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "previousLineRefundCents" INTEGER NOT NULL,
    "providerDebitCents" INTEGER NOT NULL,
    "hoaDebitCents" INTEGER NOT NULL,
    "providerReversalCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stripeRefundId" TEXT,
    "stripeReversalId" TEXT,
    "refundAttemptedAt" TIMESTAMP(3),
    "reversalAttemptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringChargeRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCharge_monthlyBillId_key" ON "RecurringCharge"("monthlyBillId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCharge_sourceVisitId_key" ON "RecurringCharge"("sourceVisitId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCharge_stripePaymentIntentId_key" ON "RecurringCharge"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCharge_stripeChargeId_key" ON "RecurringCharge"("stripeChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringCharge_stripeTransferId_key" ON "RecurringCharge"("stripeTransferId");

-- CreateIndex
CREATE INDEX "RecurringCharge_planId_createdAt_idx" ON "RecurringCharge"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "RecurringCharge_status_updatedAt_idx" ON "RecurringCharge"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringChargeLine_visitId_key" ON "RecurringChargeLine"("visitId");

-- CreateIndex
CREATE INDEX "RecurringChargeLine_chargeId_idx" ON "RecurringChargeLine"("chargeId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringChargeRecovery_setupIntentId_key" ON "RecurringChargeRecovery"("setupIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringChargeRecovery_chargeId_sequence_key" ON "RecurringChargeRecovery"("chargeId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringChargeRefund_stripeRefundId_key" ON "RecurringChargeRefund"("stripeRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringChargeRefund_stripeReversalId_key" ON "RecurringChargeRefund"("stripeReversalId");

-- CreateIndex
CREATE INDEX "RecurringChargeRefund_chargeId_status_idx" ON "RecurringChargeRefund"("chargeId", "status");

-- This migration is draft: dispatch remains disconnected until all money guards pass review.
ALTER TABLE "RecurringCharge" ADD CONSTRAINT recurring_charge_source CHECK (("monthlyBillId" IS NULL) <> ("sourceVisitId" IS NULL)),
 ADD CONSTRAINT recurring_charge_amounts CHECK ("amountCents">0 AND "platformFeeCents">=0 AND "providerAmountCents"="amountCents"-"platformFeeCents" AND "hoaShareCents" BETWEEN 0 AND "platformFeeCents" AND "feeBps" BETWEEN 0 AND 1000 AND "hoaBps" BETWEEN 0 AND "feeBps" AND "refundedCents" BETWEEN 0 AND "amountCents"),
 ADD FOREIGN KEY ("monthlyBillId") REFERENCES "RecurringMonthlyBill"("id") ON DELETE RESTRICT,
 ADD FOREIGN KEY ("sourceVisitId") REFERENCES "ServiceVisit"("id") ON DELETE RESTRICT,
 ADD FOREIGN KEY ("subscriptionId") REFERENCES "RecurringSubscription"("id") ON DELETE RESTRICT,
 ADD FOREIGN KEY ("planId") REFERENCES "RecurringPlan"("id") ON DELETE RESTRICT;
ALTER TABLE "RecurringChargeLine" ADD FOREIGN KEY ("chargeId") REFERENCES "RecurringCharge"("id") ON DELETE RESTRICT,
 ADD FOREIGN KEY ("visitId") REFERENCES "ServiceVisit"("id") ON DELETE RESTRICT,
 ADD CONSTRAINT recurring_line_amounts CHECK ("grossCents">0 AND "feeCents">=0 AND "providerCents"="grossCents"-"feeCents" AND "hoaCents" BETWEEN 0 AND "feeCents" AND "refundedCents" BETWEEN 0 AND "grossCents");
ALTER TABLE "RecurringChargeRefund" ADD FOREIGN KEY ("chargeId") REFERENCES "RecurringCharge"("id") ON DELETE RESTRICT,
 ADD FOREIGN KEY ("lineId") REFERENCES "RecurringChargeLine"("id") ON DELETE RESTRICT;
ALTER TABLE "RecurringChargeRecovery" ADD FOREIGN KEY ("chargeId") REFERENCES "RecurringCharge"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX recurring_one_unfinished_refund ON "RecurringChargeRefund"("chargeId") WHERE "status"<>'succeeded';

CREATE FUNCTION recurring_charge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "RecurringPlan"; s "RecurringSubscription"; b "RecurringMonthlyBill"; v "ServiceVisit"; c "Community"; pp "ProviderProfile"; visit_id text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recurring charge audit cannot be deleted'; END IF;
 IF TG_OP='UPDATE' THEN
  PERFORM id FROM "Community" WHERE id=NEW."communityId" FOR UPDATE;
  IF (to_jsonb(NEW)-ARRAY['status','failureCode','reconciliationHoldReason','stripePaymentIntentId','stripeChargeId','createAttemptedAt','confirmAttemptedAt','lastRecoveryAttemptId','stripeTransferId','transferAttemptedAt','transferAmountCents','transferBaseProviderDebitCents','refundedCents','providerReversedCents','observedRefundedCents','observedReversedCents','paidAt','updatedAt']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','failureCode','reconciliationHoldReason','stripePaymentIntentId','stripeChargeId','createAttemptedAt','confirmAttemptedAt','lastRecoveryAttemptId','stripeTransferId','transferAttemptedAt','transferAmountCents','transferBaseProviderDebitCents','refundedCents','providerReversedCents','observedRefundedCents','observedReversedCents','paidAt','updatedAt']) THEN RAISE EXCEPTION 'Recurring charge identity is immutable'; END IF;
  IF (OLD."stripePaymentIntentId" IS NOT NULL AND NEW."stripePaymentIntentId" IS DISTINCT FROM OLD."stripePaymentIntentId") OR (OLD."stripeChargeId" IS NOT NULL AND NEW."stripeChargeId" IS DISTINCT FROM OLD."stripeChargeId") OR (OLD."stripeTransferId" IS NOT NULL AND NEW."stripeTransferId" IS DISTINCT FROM OLD."stripeTransferId") OR (OLD."createAttemptedAt" IS NOT NULL AND NEW."createAttemptedAt" IS DISTINCT FROM OLD."createAttemptedAt") OR (OLD."confirmAttemptedAt" IS NOT NULL AND NEW."confirmAttemptedAt" IS DISTINCT FROM OLD."confirmAttemptedAt") OR (OLD."transferAttemptedAt" IS NOT NULL AND (NEW."transferAttemptedAt",NEW."transferAmountCents",NEW."transferBaseProviderDebitCents") IS DISTINCT FROM (OLD."transferAttemptedAt",OLD."transferAmountCents",OLD."transferBaseProviderDebitCents")) THEN RAISE EXCEPTION 'Recurring operation identity is immutable'; END IF;
  IF OLD."paidAt" IS NOT NULL AND NEW."paidAt" IS DISTINCT FROM OLD."paidAt" THEN RAISE EXCEPTION 'Recurring paid timestamp is immutable'; END IF;
  IF NEW."refundedCents"<OLD."refundedCents" OR NEW."providerReversedCents"<OLD."providerReversedCents" THEN RAISE EXCEPTION 'Recurring financial totals cannot decrease'; END IF;
  IF NEW."transferAttemptedAt" IS NOT NULL AND OLD."transferAttemptedAt" IS NULL THEN
   IF NEW.status NOT IN('succeeded','partially_refunded') OR NEW."stripeChargeId" IS NULL OR NEW."reconciliationHoldReason" IS NOT NULL OR
    EXISTS(SELECT 1 FROM "RecurringChargeRefund" WHERE "chargeId"=NEW.id AND status<>'succeeded') OR
    EXISTS(SELECT 1 FROM "ServiceQualityClaim" q JOIN "RecurringChargeLine" l ON l."visitId"=q."visitId" WHERE l."chargeId"=NEW.id AND q.resolution IN('reported','redo_pending','refund_pending')) THEN RAISE EXCEPTION 'Recurring transfer is held'; END IF;
   IF NEW."transferAmountCents" IS NULL OR NEW."transferBaseProviderDebitCents" IS NULL OR NEW."transferAmountCents" IS DISTINCT FROM (SELECT sum("providerCents"-floor("providerCents"::numeric*"refundedCents"/"grossCents"))::integer FROM "RecurringChargeLine" WHERE "chargeId"=NEW.id) OR NEW."transferBaseProviderDebitCents" IS DISTINCT FROM NEW."providerAmountCents"-NEW."transferAmountCents" OR NEW."transferAmountCents"<=0 THEN RAISE EXCEPTION 'Recurring transfer entitlement mismatch'; END IF;
   SELECT * INTO pp FROM "ProviderProfile" WHERE "userId"=NEW."providerUserId" FOR SHARE;
   IF NOT COALESCE(pp."accountStatus"='active' AND pp."stripeTestPayoutStatus"='active' AND pp."stripeTestAccountId"=NEW."providerAccountId",false) THEN RAISE EXCEPTION 'Original recurring provider payout account unavailable'; END IF;
   NEW."transferAttemptedAt":=clock_timestamp();
  END IF;
  IF NEW."transferAttemptedAt" IS NULL AND (NEW."transferAmountCents" IS NOT NULL OR NEW."transferBaseProviderDebitCents" IS NOT NULL OR NEW."stripeTransferId" IS NOT NULL) THEN RAISE EXCEPTION 'Recurring transfer needs a reserved baseline'; END IF;
  IF OLD."createAttemptedAt" IS NULL AND NEW."createAttemptedAt" IS NOT NULL THEN NEW."createAttemptedAt":=clock_timestamp(); END IF;
  IF OLD."confirmAttemptedAt" IS NULL AND NEW."confirmAttemptedAt" IS NOT NULL THEN NEW."confirmAttemptedAt":=clock_timestamp(); END IF;
  IF NEW."lastRecoveryAttemptId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "RecurringChargeRecovery" WHERE id=NEW."lastRecoveryAttemptId" AND "chargeId"=NEW.id) THEN RAISE EXCEPTION 'Recurring recovery pointer mismatch'; END IF;
  RETURN NEW;
 END IF;
 IF NEW."sourceVisitId" IS NOT NULL THEN
  PERFORM id FROM "ServiceVisit" WHERE id=NEW."sourceVisitId" FOR UPDATE;
 ELSE
  FOR visit_id IN SELECT "visitId" FROM "RecurringBillLine" WHERE "billId"=NEW."monthlyBillId" AND "amountCents">0 ORDER BY "visitId" LOOP
   PERFORM id FROM "ServiceVisit" WHERE id=visit_id FOR UPDATE;
  END LOOP;
 END IF;
 SELECT * INTO p FROM "RecurringPlan" WHERE id=NEW."planId";
 PERFORM id FROM "ServiceAgreement" WHERE id=p."agreementId" FOR UPDATE;
 SELECT * INTO p FROM "RecurringPlan" WHERE id=NEW."planId" FOR UPDATE;
 SELECT * INTO s FROM "RecurringSubscription" WHERE id=NEW."subscriptionId" FOR SHARE;
 IF p.id IS NULL OR s.id IS NULL OR s."planId"<>p.id OR p."acceptedAt" IS NULL OR s."cardVerifiedAt" IS NULL OR
  (NEW."agreementId",NEW."communityId",NEW."providerUserId",NEW."payerUserId",NEW."unitId",NEW."customerId",NEW."paymentMethodId",NEW."receiptEmail",NEW."termsToken",NEW.currency) IS DISTINCT FROM
  (p."agreementId",p."communityId",p."providerUserId",s."payerUserId",s."unitId",s."customerId",s."paymentMethodId",s."receiptEmail",s."termsToken",p.currency) THEN RAISE EXCEPTION 'Recurring source authorization mismatch'; END IF;
 IF NEW."monthlyBillId" IS NOT NULL THEN
  SELECT * INTO b FROM "RecurringMonthlyBill" WHERE id=NEW."monthlyBillId";
  IF p."billingMode"<>'monthly' OR b.id IS NULL OR (b."planId",b."subscriptionId",b."unitId",b."payerUserId",b.month,b."amountCents") IS DISTINCT FROM (p.id,s.id,s."unitId",s."payerUserId",NEW."localMonth",NEW."amountCents") THEN RAISE EXCEPTION 'Recurring sealed bill mismatch'; END IF;
 ELSE
  SELECT * INTO v FROM "ServiceVisit" WHERE id=NEW."sourceVisitId" FOR UPDATE;
  IF p."billingMode"<>'per_visit' OR v.id IS NULL OR v.status<>'completed' OR v."completedAt" IS NULL OR v."redoOfVisitId" IS NOT NULL OR
   (v."recurringSubscriptionId",v."unitId",v."billingPayerUserId",v."recurringMonth",v."allocatedVisitCents") IS DISTINCT FROM (s.id,s."unitId",s."payerUserId",NEW."localMonth",NEW."amountCents") THEN RAISE EXCEPTION 'Recurring per-visit source mismatch'; END IF;
 END IF;
 PERFORM id FROM "User" WHERE id=s."payerUserId" FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM "User" WHERE id=s."payerUserId" AND "isVerified" AND "stripeTestCustomerId"=s."customerId") THEN RAISE EXCEPTION 'Original payer customer mismatch'; END IF;
 SELECT * INTO pp FROM "ProviderProfile" WHERE "userId"=p."providerUserId" FOR SHARE;
 IF NOT COALESCE(pp."accountStatus"='active' AND pp."stripeTestPayoutStatus"='active' AND pp."stripeTestAccountId"=NEW."providerAccountId",false) THEN RAISE EXCEPTION 'Recurring provider account mismatch'; END IF;
 SELECT * INTO c FROM "Community" WHERE id=p."communityId" FOR UPDATE;
 IF NEW."hoaBps"<>c."hoaRevenueShareBps" THEN RAISE EXCEPTION 'Recurring HOA rate mismatch'; END IF;
 IF NEW.status<>'pending' OR NEW."stripePaymentIntentId" IS NOT NULL OR NEW."stripeChargeId" IS NOT NULL OR NEW."stripeTransferId" IS NOT NULL OR NEW."createAttemptedAt" IS NOT NULL OR NEW."confirmAttemptedAt" IS NOT NULL OR NEW."transferAttemptedAt" IS NOT NULL OR NEW."transferAmountCents" IS NOT NULL OR NEW."transferBaseProviderDebitCents" IS NOT NULL OR NEW."paidAt" IS NOT NULL OR NEW."lastRecoveryAttemptId" IS NOT NULL OR NEW."observedRefundedCents"<>0 OR NEW."observedReversedCents"<>0 OR NEW."refundedCents"<>0 OR NEW."providerReversedCents"<>0 THEN RAISE EXCEPTION 'Recurring financial identity must start unattempted'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recurring_charge_guard BEFORE INSERT OR UPDATE OR DELETE ON "RecurringCharge" FOR EACH ROW EXECUTE FUNCTION recurring_charge_guard();

CREATE FUNCTION recurring_charge_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "RecurringCharge"; v "ServiceVisit"; s "RecurringSubscription"; o "ServiceOccurrence";
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recurring charge lines are immutable'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'refundedCents') IS DISTINCT FROM (to_jsonb(OLD)-'refundedCents') OR NEW."refundedCents"<OLD."refundedCents" THEN RAISE EXCEPTION 'Recurring line identity is immutable'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO c FROM "RecurringCharge" WHERE id=NEW."chargeId" FOR UPDATE;
 SELECT * INTO v FROM "ServiceVisit" WHERE id=NEW."visitId";
 SELECT * INTO s FROM "RecurringSubscription" WHERE id=c."subscriptionId";
 SELECT * INTO o FROM "ServiceOccurrence" WHERE id=v."occurrenceId";
 IF c.id IS NULL OR v.id IS NULL OR v.status<>'completed' OR v."completedAt" IS NULL OR v."redoOfVisitId" IS NOT NULL OR s."acceptedAt">v."completedAt" OR s."cardVerifiedAt">v."completedAt" OR
  (v."recurringSubscriptionId",v."unitId",v."billingPayerUserId",v."recurringMonth",v."allocatedVisitCents",o."agreementId",o."recurringPlanId",o."recurringLocalDate") IS DISTINCT FROM
  (c."subscriptionId",c."unitId",c."payerUserId",c."localMonth",NEW."grossCents",c."agreementId",c."planId",NEW."localDate") OR
  NEW."feeCents"<>floor(NEW."grossCents"::numeric*c."feeBps"/10000) OR NEW."hoaCents"<>floor(NEW."grossCents"::numeric*c."hoaBps"/10000) OR NEW."refundedCents"<>0 THEN RAISE EXCEPTION 'Recurring constituent identity mismatch'; END IF;
 IF c."monthlyBillId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "RecurringBillLine" WHERE "billId"=c."monthlyBillId" AND "visitId"=v.id AND "amountCents"=NEW."grossCents") THEN RAISE EXCEPTION 'Recurring line not in sealed bill'; END IF;
 IF c."sourceVisitId" IS NOT NULL AND c."sourceVisitId"<>v.id THEN RAISE EXCEPTION 'Recurring per-visit line mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recurring_charge_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "RecurringChargeLine" FOR EACH ROW EXECUTE FUNCTION recurring_charge_line_guard();
CREATE FUNCTION recurring_charge_sum_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE charge_id text; c "RecurringCharge"; n integer; g bigint; f bigint; p bigint; h bigint;
BEGIN
 charge_id:=CASE WHEN TG_TABLE_NAME='RecurringCharge' THEN NEW.id ELSE NEW."chargeId" END;
 SELECT * INTO c FROM "RecurringCharge" WHERE id=charge_id;
 SELECT count(*),sum("grossCents"),sum("feeCents"),sum("providerCents"),sum("hoaCents") INTO n,g,f,p,h FROM "RecurringChargeLine" WHERE "chargeId"=charge_id;
 IF n=0 OR (g,f,p,h) IS DISTINCT FROM (c."amountCents"::bigint,c."platformFeeCents"::bigint,c."providerAmountCents"::bigint,c."hoaShareCents"::bigint) OR
 (c."sourceVisitId" IS NOT NULL AND n<>1) OR (c."monthlyBillId" IS NOT NULL AND n<>(SELECT count(*) FROM "RecurringBillLine" WHERE "billId"=c."monthlyBillId" AND "amountCents">0)) THEN RAISE EXCEPTION 'Recurring charge constituent total mismatch'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER recurring_charge_sum_guard AFTER INSERT ON "RecurringCharge" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION recurring_charge_sum_guard();
CREATE CONSTRAINT TRIGGER recurring_line_sum_guard AFTER INSERT ON "RecurringChargeLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION recurring_charge_sum_guard();

CREATE FUNCTION recurring_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "RecurringCharge"; l "RecurringChargeLine"; u "User"; a "AdminAccessGrant"; pd integer; hd integer; visit_id text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recurring refund audit cannot be deleted'; END IF;
 IF TG_OP='UPDATE' THEN
  SELECT * INTO c FROM "RecurringCharge" WHERE id=NEW."chargeId" FOR UPDATE;
  PERFORM id FROM "Community" WHERE id=c."communityId" FOR UPDATE;
  IF (to_jsonb(NEW)-ARRAY['status','stripeRefundId','stripeReversalId','refundAttemptedAt','reversalAttemptedAt','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','stripeRefundId','stripeReversalId','refundAttemptedAt','reversalAttemptedAt','updatedAt']) OR
   (OLD."stripeRefundId" IS NOT NULL AND NEW."stripeRefundId" IS DISTINCT FROM OLD."stripeRefundId") OR (OLD."stripeReversalId" IS NOT NULL AND NEW."stripeReversalId" IS DISTINCT FROM OLD."stripeReversalId") OR
   (OLD."refundAttemptedAt" IS NOT NULL AND NEW."refundAttemptedAt" IS DISTINCT FROM OLD."refundAttemptedAt") OR (OLD."reversalAttemptedAt" IS NOT NULL AND NEW."reversalAttemptedAt" IS DISTINCT FROM OLD."reversalAttemptedAt") OR (OLD.status='succeeded' AND NEW.status<>'succeeded') THEN RAISE EXCEPTION 'Recurring refund identity is immutable'; END IF;
  IF OLD."refundAttemptedAt" IS NULL AND NEW."refundAttemptedAt" IS NOT NULL THEN NEW."refundAttemptedAt":=clock_timestamp(); END IF;
  IF OLD."reversalAttemptedAt" IS NULL AND NEW."reversalAttemptedAt" IS NOT NULL THEN NEW."reversalAttemptedAt":=clock_timestamp(); END IF;
  RETURN NEW;
 END IF;
 FOR visit_id IN SELECT "visitId" FROM "RecurringChargeLine" WHERE "chargeId"=NEW."chargeId" ORDER BY "visitId" LOOP
  PERFORM id FROM "ServiceVisit" WHERE id=visit_id FOR UPDATE;
 END LOOP;
 SELECT * INTO c FROM "RecurringCharge" WHERE id=NEW."chargeId" FOR UPDATE;
 SELECT * INTO l FROM "RecurringChargeLine" WHERE id=NEW."lineId";
 SELECT * INTO u FROM "User" WHERE id=NEW."actorUserId" FOR SHARE;
 SELECT * INTO a FROM "AdminAccessGrant" WHERE "userId"=NEW."actorUserId" FOR SHARE;
 IF NOT COALESCE(u.role='admin' AND u."isVerified" AND a.status='active' AND a.level='owner' AND NOT a."isStaffAccount" AND a.email=lower(u.email),false) THEN RAISE EXCEPTION 'Verified owner required'; END IF;
 IF c.id IS NULL OR l.id IS NULL OR l."chargeId"<>c.id OR c.status NOT IN('succeeded','partially_refunded') OR c."stripeChargeId" IS NULL OR c."stripePaymentIntentId" IS NULL OR c."reconciliationHoldReason" IS NOT NULL OR (c."transferAttemptedAt" IS NOT NULL AND c."stripeTransferId" IS NULL) OR NEW."amountCents"<1 OR NEW."previousLineRefundCents"<>l."refundedCents" OR NEW."amountCents">l."grossCents"-l."refundedCents" THEN RAISE EXCEPTION 'Recurring refund source or balance mismatch'; END IF;
 PERFORM id FROM "Community" WHERE id=c."communityId" FOR UPDATE;
 pd:=floor(l."providerCents"::numeric*(l."refundedCents"+NEW."amountCents")/l."grossCents")-floor(l."providerCents"::numeric*l."refundedCents"/l."grossCents");
 hd:=floor(l."hoaCents"::numeric*(l."refundedCents"+NEW."amountCents")/l."grossCents")-floor(l."hoaCents"::numeric*l."refundedCents"/l."grossCents");
 IF NEW."providerDebitCents"<>pd OR NEW."hoaDebitCents"<>hd OR NEW."providerReversalCents"<>(CASE WHEN c."stripeTransferId" IS NULL THEN 0 ELSE pd END) OR NEW.status<>'pending' OR NEW."stripeRefundId" IS NOT NULL OR NEW."stripeReversalId" IS NOT NULL OR NEW."refundAttemptedAt" IS NOT NULL OR NEW."reversalAttemptedAt" IS NOT NULL THEN RAISE EXCEPTION 'Recurring refund allocation or initial state mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recurring_refund_guard BEFORE INSERT OR UPDATE OR DELETE ON "RecurringChargeRefund" FOR EACH ROW EXECUTE FUNCTION recurring_refund_guard();
ALTER TABLE "RecurringCharge" ADD CONSTRAINT recurring_charge_state CHECK (
 status IN('pending','processing','succeeded','failed','requires_action','partially_refunded','refunded','disputed','canceled') AND
 (status NOT IN('succeeded','partially_refunded','refunded') OR ("stripePaymentIntentId" IS NOT NULL AND "stripeChargeId" IS NOT NULL AND "paidAt" IS NOT NULL)) AND
 ("stripeChargeId" IS NULL OR "stripePaymentIntentId" IS NOT NULL) AND "providerReversedCents">=0 AND "observedRefundedCents">=0 AND "observedReversedCents">=0 AND
 ("transferAmountCents" IS NULL OR "providerReversedCents"<="transferAmountCents") AND
 ("amountCents">=50 OR "reconciliationHoldReason" IS NOT NULL)
);
ALTER TABLE "RecurringChargeRefund" ADD CONSTRAINT recurring_refund_state CHECK (
 reason IN('service_quality','duplicate','requested_by_customer') AND status IN('pending','reversal_pending','succeeded','reconciliation_required') AND
 "amountCents">0 AND "previousLineRefundCents">=0 AND "providerDebitCents">=0 AND "hoaDebitCents">=0 AND "providerReversalCents" BETWEEN 0 AND "providerDebitCents" AND
 (status NOT IN('reversal_pending','succeeded') OR ("stripeRefundId" IS NOT NULL AND "refundAttemptedAt" IS NOT NULL)) AND
 (status<>'succeeded' OR "providerReversalCents"=0 OR ("stripeReversalId" IS NOT NULL AND "reversalAttemptedAt" IS NOT NULL))
);
CREATE FUNCTION recurring_financial_totals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid text; c "RecurringCharge"; bad boolean; refund_total bigint; reversed_total bigint;
BEGIN
 cid:=CASE WHEN TG_TABLE_NAME='RecurringCharge' THEN NEW.id ELSE NEW."chargeId" END;
 SELECT * INTO c FROM "RecurringCharge" WHERE id=cid;
 SELECT EXISTS(SELECT 1 FROM "RecurringChargeLine" l WHERE l."chargeId"=cid AND l."refundedCents"<>COALESCE((SELECT sum(r."amountCents") FROM "RecurringChargeRefund" r WHERE r."lineId"=l.id AND r.status IN('reversal_pending','succeeded')),0)) INTO bad;
 SELECT COALESCE(sum("refundedCents"),0) INTO refund_total FROM "RecurringChargeLine" WHERE "chargeId"=cid;
 SELECT COALESCE(sum("providerReversalCents"),0) INTO reversed_total FROM "RecurringChargeRefund" WHERE "chargeId"=cid AND status='succeeded';
 IF bad OR c."refundedCents"<>refund_total OR c."providerReversedCents"<>reversed_total THEN RAISE EXCEPTION 'Recurring settled financial ledger mismatch'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER recurring_charge_totals AFTER INSERT OR UPDATE ON "RecurringCharge" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION recurring_financial_totals_guard();
CREATE CONSTRAINT TRIGGER recurring_line_totals AFTER INSERT OR UPDATE ON "RecurringChargeLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION recurring_financial_totals_guard();
CREATE CONSTRAINT TRIGGER recurring_refund_totals AFTER INSERT OR UPDATE ON "RecurringChargeRefund" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION recurring_financial_totals_guard();
CREATE FUNCTION recurring_recovery_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "RecurringCharge"; n integer; visit_id text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Recurring recovery consent is append-only'; END IF;
 FOR visit_id IN SELECT "visitId" FROM "RecurringChargeLine" WHERE "chargeId"=NEW."chargeId" ORDER BY "visitId" LOOP
  PERFORM id FROM "ServiceVisit" WHERE id=visit_id FOR UPDATE;
 END LOOP;
 SELECT * INTO c FROM "RecurringCharge" WHERE id=NEW."chargeId" FOR UPDATE;
 SELECT COALESCE(max(sequence),0)+1 INTO n FROM "RecurringChargeRecovery" WHERE "chargeId"=NEW."chargeId";
 IF c.id IS NULL OR c."payerUserId"<>NEW."payerUserId" OR c."stripePaymentIntentId" IS NULL OR c."reconciliationHoldReason" IS NOT NULL OR c.status NOT IN('failed','pending','processing') OR NEW.sequence<>n OR NEW."termsVersion"<>'recurring-recovery-exact-v1' OR NEW."termsToken"!~'^[a-f0-9]{64}$' OR length(NEW."paymentMethodId")=0 OR length(NEW."setupIntentId")=0 THEN RAISE EXCEPTION 'Recurring recovery consent identity mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "RecurringRecoverySetup" WHERE "chargeId"=NEW."chargeId" AND sequence=NEW.sequence AND "setupIntentId"=NEW."setupIntentId" AND "termsToken"=NEW."termsToken") THEN RAISE EXCEPTION 'Recurring recovery needs its durable setup'; END IF;
 PERFORM id FROM "User" WHERE id=NEW."payerUserId" AND "isVerified" FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Verified original payer required'; END IF;
 NEW."acceptedAt":=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER recurring_recovery_guard BEFORE INSERT OR UPDATE OR DELETE ON "RecurringChargeRecovery" FOR EACH ROW EXECUTE FUNCTION recurring_recovery_guard();
CREATE FUNCTION recurring_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Recurring financial audit cannot be truncated'; END $$;
CREATE TRIGGER recurring_charge_no_truncate BEFORE TRUNCATE ON "RecurringCharge" FOR EACH STATEMENT EXECUTE FUNCTION recurring_no_truncate();
CREATE TRIGGER recurring_line_no_truncate BEFORE TRUNCATE ON "RecurringChargeLine" FOR EACH STATEMENT EXECUTE FUNCTION recurring_no_truncate();
CREATE TRIGGER recurring_refund_no_truncate BEFORE TRUNCATE ON "RecurringChargeRefund" FOR EACH STATEMENT EXECUTE FUNCTION recurring_no_truncate();
CREATE TRIGGER recurring_recovery_no_truncate BEFORE TRUNCATE ON "RecurringChargeRecovery" FOR EACH STATEMENT EXECUTE FUNCTION recurring_no_truncate();
CREATE FUNCTION recurring_claim_financial_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid text;
BEGIN
 SELECT "chargeId" INTO cid FROM "RecurringChargeLine" WHERE "visitId"=NEW."visitId";
 IF cid IS NOT NULL THEN
 PERFORM id FROM "RecurringCharge" WHERE id=cid FOR UPDATE;
 PERFORM id FROM "Community" WHERE id=(SELECT "communityId" FROM "RecurringCharge" WHERE id=cid) FOR UPDATE;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_recurring_claim_financial_lock BEFORE INSERT OR UPDATE ON "ServiceQualityClaim" FOR EACH ROW EXECUTE FUNCTION recurring_claim_financial_lock();
CREATE TABLE "RecurringRecoverySetup" (
 id text PRIMARY KEY,"chargeId" text NOT NULL REFERENCES "RecurringCharge"(id) ON DELETE RESTRICT,sequence integer NOT NULL,"payerUserId" text NOT NULL,"customerId" text NOT NULL,"termsToken" text NOT NULL,"attemptedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"setupIntentId" text UNIQUE,UNIQUE("chargeId",sequence)
);
CREATE FUNCTION recurring_recovery_setup_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "RecurringCharge"; n integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recurring recovery setup audit is immutable'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'setupIntentId') IS DISTINCT FROM (to_jsonb(OLD)-'setupIntentId') OR (OLD."setupIntentId" IS NOT NULL AND NEW."setupIntentId" IS DISTINCT FROM OLD."setupIntentId") THEN RAISE EXCEPTION 'Recurring setup identity is immutable'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO c FROM "RecurringCharge" WHERE id=NEW."chargeId" FOR UPDATE;
 SELECT COALESCE(max(sequence),0)+1 INTO n FROM "RecurringChargeRecovery" WHERE "chargeId"=NEW."chargeId";
 IF c.id IS NULL OR (NEW."payerUserId",NEW."customerId") IS DISTINCT FROM (c."payerUserId",c."customerId") OR NEW.sequence<>n OR NEW."setupIntentId" IS NOT NULL OR c."reconciliationHoldReason" IS NOT NULL OR c."refundedCents">0 OR c.status NOT IN('pending','processing','failed') THEN RAISE EXCEPTION 'Recurring setup authority mismatch'; END IF;
 PERFORM id FROM "User" WHERE id=NEW."payerUserId" AND "isVerified" FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Verified original payer required'; END IF;
 NEW."attemptedAt":=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER recurring_recovery_setup_guard BEFORE INSERT OR UPDATE OR DELETE ON "RecurringRecoverySetup" FOR EACH ROW EXECUTE FUNCTION recurring_recovery_setup_guard();
CREATE TRIGGER recurring_recovery_setup_no_truncate BEFORE TRUNCATE ON "RecurringRecoverySetup" FOR EACH STATEMENT EXECUTE FUNCTION recurring_no_truncate();

ALTER TABLE "HoaShareEntry" ALTER COLUMN "paymentVisitId" DROP NOT NULL;
ALTER TABLE "HoaShareEntry" ADD COLUMN "recurringChargeId" text REFERENCES "RecurringCharge"(id) ON DELETE RESTRICT;
ALTER TABLE "HoaShareEntry" ADD CONSTRAINT hoa_exact_one_source CHECK (("paymentVisitId" IS NULL)<>("recurringChargeId" IS NULL));
CREATE UNIQUE INDEX hoa_recurring_source_sequence ON "HoaShareEntry"("recurringChargeId",sequence);
DROP TRIGGER hoa_entry_guard ON "HoaShareEntry";
CREATE TRIGGER hoa_entry_guard BEFORE INSERT ON "HoaShareEntry" FOR EACH ROW WHEN (NEW."paymentVisitId" IS NOT NULL) EXECUTE FUNCTION hoa_entry_guard();
CREATE OR REPLACE FUNCTION hoa_payment_accrue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h bigint; s bigint; r integer; seq integer;
BEGIN
 IF NEW."status" NOT IN ('succeeded','partially_refunded','refunded') OR NEW."hoaRevenueShareBps" IS NULL OR NEW."reconciliationHoldReason" IS NOT NULL THEN RETURN NEW; END IF;
 SELECT coalesce(sum("amountCents"),0),coalesce(sum("savingsCents"),0),coalesce(max("sequence"),0)+1 INTO h,s,seq FROM "HoaShareEntry" WHERE "paymentVisitId"=NEW."visitId";
 r:=greatest(NEW."amountRefundedCents",NEW."observedChargeRefundedCents");
 h:=NEW."hoaShareCents"-(NEW."hoaShareCents"::bigint*r/NEW."amountCents")-h;
 s:=NEW."residentSavingsCents"-(NEW."residentSavingsCents"::bigint*r/NEW."amountCents")-s;
 IF h<>0 OR s<>0 THEN INSERT INTO "HoaShareEntry" (id,"communityId","paymentVisitId",sequence,kind,"amountCents","savingsCents","refundedCents","createdAt") VALUES(NEW."visitId"||':'||seq,NEW."communityId",NEW."visitId",seq,CASE WHEN seq=1 THEN 'earned' ELSE 'refund_adjustment' END,h,s,r,clock_timestamp()); END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION recurring_hoa_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c "RecurringCharge"; prior bigint; target bigint; seq integer;
BEGIN
 SELECT * INTO c FROM "RecurringCharge" WHERE id=NEW."recurringChargeId" FOR UPDATE;
 PERFORM id FROM "Community" WHERE id=c."communityId" FOR UPDATE;
 IF c.id IS NULL OR NEW."communityId"<>c."communityId" OR c.status NOT IN('succeeded','partially_refunded','refunded') OR c."reconciliationHoldReason" IS NOT NULL THEN RAISE EXCEPTION 'Recurring HOA revenue requires reconciled payment'; END IF;
 SELECT COALESCE(sum("amountCents"),0),COALESCE(max(sequence),0)+1 INTO prior,seq FROM "HoaShareEntry" WHERE "recurringChargeId"=c.id;
 SELECT COALESCE(sum("hoaCents"-floor("hoaCents"::numeric*"refundedCents"/"grossCents")),0) INTO target FROM "RecurringChargeLine" WHERE "chargeId"=c.id;
 IF NEW.sequence<>seq OR NEW.kind<>(CASE WHEN seq=1 THEN 'earned' ELSE 'refund_adjustment' END) OR NEW."amountCents"<>target-prior OR NEW."amountCents"=0 OR NEW."savingsCents"<>0 OR NEW."refundedCents"<>c."refundedCents" THEN RAISE EXCEPTION 'Recurring HOA earned ledger mismatch'; END IF;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER recurring_hoa_entry_guard BEFORE INSERT ON "HoaShareEntry" FOR EACH ROW WHEN(NEW."recurringChargeId" IS NOT NULL) EXECUTE FUNCTION recurring_hoa_entry_guard();
CREATE FUNCTION recurring_hoa_accrue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior bigint; target bigint; seq integer;
BEGIN
 IF NEW.status NOT IN('succeeded','partially_refunded','refunded') OR NEW."reconciliationHoldReason" IS NOT NULL THEN RETURN NEW; END IF;
 PERFORM id FROM "Community" WHERE id=NEW."communityId" FOR UPDATE;
 SELECT COALESCE(sum("amountCents"),0),COALESCE(max(sequence),0)+1 INTO prior,seq FROM "HoaShareEntry" WHERE "recurringChargeId"=NEW.id;
 SELECT COALESCE(sum("hoaCents"-floor("hoaCents"::numeric*"refundedCents"/"grossCents")),0) INTO target FROM "RecurringChargeLine" WHERE "chargeId"=NEW.id;
 IF target<>prior THEN INSERT INTO "HoaShareEntry"(id,"communityId","recurringChargeId",sequence,kind,"amountCents","savingsCents","refundedCents") VALUES('recurring:'||NEW.id||':'||seq,NEW."communityId",NEW.id,seq,CASE WHEN seq=1 THEN 'earned' ELSE 'refund_adjustment' END,target-prior,0,NEW."refundedCents"); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recurring_hoa_accrue AFTER UPDATE ON "RecurringCharge" FOR EACH ROW EXECUTE FUNCTION recurring_hoa_accrue();
CREATE FUNCTION recurring_hoa_payout_hold() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE check_hold boolean;
BEGIN
 check_hold:=TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN check_hold:=(OLD."attemptedAt" IS NULL AND NEW."attemptedAt" IS NOT NULL) OR (NEW.method='manual' AND OLD.status<>'paid' AND NEW.status='paid'); END IF;
 IF check_hold AND EXISTS(SELECT 1 FROM "RecurringCharge" c WHERE c."communityId"=NEW."communityId" AND c."hoaShareCents">0 AND (c."reconciliationHoldReason" IS NOT NULL OR c.status='disputed' OR EXISTS(SELECT 1 FROM "RecurringChargeRefund" r WHERE r."chargeId"=c.id AND r.status<>'succeeded') OR EXISTS(SELECT 1 FROM "RecurringChargeLine" l JOIN "ServiceQualityClaim" q ON q."visitId"=l."visitId" WHERE l."chargeId"=c.id AND q.resolution IN('reported','redo_pending','refund_pending')))) THEN RAISE EXCEPTION 'Recurring HOA liability is held'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_recurring_hoa_payout_hold BEFORE INSERT OR UPDATE ON "HoaSharePayout" FOR EACH ROW EXECUTE FUNCTION recurring_hoa_payout_hold();

ALTER TABLE "RecurringCharge" ADD CONSTRAINT recurring_transfer_reserved_baseline CHECK (
 ("transferAttemptedAt" IS NULL AND "transferAmountCents" IS NULL AND "transferBaseProviderDebitCents" IS NULL AND "stripeTransferId" IS NULL)
 OR ("transferAttemptedAt" IS NOT NULL AND "transferAmountCents" IS NOT NULL AND "transferAmountCents">0 AND "transferBaseProviderDebitCents" IS NOT NULL AND "transferBaseProviderDebitCents">=0 AND "transferAmountCents"+"transferBaseProviderDebitCents"="providerAmountCents")
);
