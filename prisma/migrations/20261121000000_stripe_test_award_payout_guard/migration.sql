-- Application awards invoke this after the request/manager lock and before
-- accepting a bid. The app's environment flag is not a database-wide policy.
CREATE FUNCTION bundleen_assert_stripe_test_award_payouts(provider_id TEXT, verified_account_id TEXT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "User" WHERE "id" = provider_id AND "role"::text = 'provider' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Provider identity is no longer active' USING ERRCODE = 'P1743';
  END IF;
  PERFORM 1 FROM "ProviderProfile" WHERE "userId" = provider_id
    AND "accountStatus"::text = 'active'
    AND "stripeTestAccountId" = verified_account_id
    AND "stripeTestPayoutStatus" = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verified sandbox payout account changed or is not active' USING ERRCODE = 'P1743';
  END IF;
END;
$$;
