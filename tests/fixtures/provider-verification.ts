/** A complete staff-reviewed credential pair for marketplace workflow fixtures. */
export function approvedProviderVerification() {
  const now = new Date();
  const expiresAt = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()));
  return {
    id: "provider-profile-1",
    licenseNumber: "LIC-1", licenseState: "TX",
    insuranceProvider: "Example Mutual", insurancePolicyNumber: "POL-1",
    licenseVerifiedAt: now, insuranceVerifiedAt: now,
    licenseVerifiedByUserId: "reviewer-1", insuranceVerifiedByUserId: "reviewer-1", updatedAt: now,
    licenseExpiresAt: expiresAt, insuranceExpiresAt: expiresAt,
    insuranceCoverageCents: 100_000_000, insuranceAdditionalInsured: true,
    licenseDocumentId: "license-document-1", insuranceDocumentId: "insurance-document-1",
    licenseVerifiedDocumentChecksum: "a".repeat(64), insuranceVerifiedDocumentChecksum: "b".repeat(64),
    licenseDocument: {
      id: "license-document-1", checksum: "a".repeat(64), status: "active",
      providerProfileId: "provider-profile-1", purpose: "provider_license",
      credentialSnapshot: { licenseNumber: "LIC-1", licenseState: "TX" },
      credentialReviewStatus: "approved", credentialExpiresAt: expiresAt,
      credentialCoverageCents: null, credentialAdditionalInsured: null,
    },
    insuranceDocument: {
      id: "insurance-document-1", checksum: "b".repeat(64), status: "active",
      providerProfileId: "provider-profile-1", purpose: "provider_insurance",
      credentialSnapshot: { insuranceProvider: "Example Mutual", insurancePolicyNumber: "POL-1" },
      credentialReviewStatus: "approved", credentialExpiresAt: expiresAt,
      credentialCoverageCents: 100_000_000, credentialAdditionalInsured: true,
    },
  };
}
