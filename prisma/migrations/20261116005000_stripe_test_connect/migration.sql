ALTER TABLE "ProviderProfile" ADD COLUMN "stripeTestAccountId" TEXT,
 ADD COLUMN "stripeTestPayoutStatus" TEXT NOT NULL DEFAULT 'not_connected'
 CHECK ("stripeTestPayoutStatus" IN ('not_connected', 'pending', 'active', 'restricted'));
CREATE UNIQUE INDEX "ProviderProfile_stripeTestAccountId_key" ON "ProviderProfile"("stripeTestAccountId");
