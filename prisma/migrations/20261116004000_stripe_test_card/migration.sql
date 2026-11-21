CREATE TABLE "StripeTestCard" (
  "agreementId" TEXT NOT NULL,
  "payerUserId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "paymentMethodId" TEXT NOT NULL,
  "setupIntentId" TEXT NOT NULL,
  "brand" TEXT NOT NULL,
  "last4" TEXT NOT NULL CHECK ("last4" ~ '^[0-9]{4}$'),
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("agreementId", "payerUserId", "unitId"),
  FOREIGN KEY ("agreementId", "payerUserId", "unitId") REFERENCES "VisitBillingConsent"("agreementId", "payerUserId", "unitId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StripeTestCard_setupIntentId_key" ON "StripeTestCard"("setupIntentId");
