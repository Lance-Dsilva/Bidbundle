-- Trigger records have table-specific fields; avoid binding both branches of CASE.
CREATE OR REPLACE FUNCTION recurring_charge_sum_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE charge_id text; c "RecurringCharge"; n integer; g bigint; f bigint; p bigint; h bigint;
BEGIN
 IF TG_TABLE_NAME='RecurringCharge' THEN charge_id:=NEW.id; ELSE charge_id:=NEW."chargeId"; END IF;
 SELECT * INTO c FROM "RecurringCharge" WHERE id=charge_id;
 SELECT count(*),sum("grossCents"),sum("feeCents"),sum("providerCents"),sum("hoaCents") INTO n,g,f,p,h FROM "RecurringChargeLine" WHERE "chargeId"=charge_id;
 IF n=0 OR (g,f,p,h) IS DISTINCT FROM (c."amountCents"::bigint,c."platformFeeCents"::bigint,c."providerAmountCents"::bigint,c."hoaShareCents"::bigint) OR
 (c."sourceVisitId" IS NOT NULL AND n<>1) OR (c."monthlyBillId" IS NOT NULL AND n<>(SELECT count(*) FROM "RecurringBillLine" WHERE "billId"=c."monthlyBillId" AND "amountCents">0)) THEN RAISE EXCEPTION 'Recurring charge constituent total mismatch'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION recurring_financial_totals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid text; c "RecurringCharge"; bad boolean; refund_total bigint; reversed_total bigint;
BEGIN
 IF TG_TABLE_NAME='RecurringCharge' THEN cid:=NEW.id; ELSE cid:=NEW."chargeId"; END IF;
 SELECT * INTO c FROM "RecurringCharge" WHERE id=cid;
 SELECT EXISTS(SELECT 1 FROM "RecurringChargeLine" l WHERE l."chargeId"=cid AND l."refundedCents"<>COALESCE((SELECT sum(r."amountCents") FROM "RecurringChargeRefund" r WHERE r."lineId"=l.id AND r.status IN('reversal_pending','succeeded')),0)) INTO bad;
 SELECT COALESCE(sum("refundedCents"),0) INTO refund_total FROM "RecurringChargeLine" WHERE "chargeId"=cid;
 SELECT COALESCE(sum("providerReversalCents"),0) INTO reversed_total FROM "RecurringChargeRefund" WHERE "chargeId"=cid AND status='succeeded';
 IF bad OR c."refundedCents"<>refund_total OR c."providerReversedCents"<>reversed_total THEN RAISE EXCEPTION 'Recurring settled financial ledger mismatch'; END IF;
 RETURN NULL;
END $$;
