ALTER TABLE "User" ADD COLUMN "stripeTestCustomerId" TEXT;
CREATE UNIQUE INDEX "User_stripeTestCustomerId_key" ON "User" ("stripeTestCustomerId");
