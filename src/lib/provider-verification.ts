/** Credential dates are inclusive UTC calendar dates, not local-time instants. */
export function credentialIsCurrent(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return expiresAt instanceof Date && Number.isFinite(expiresAt.getTime()) &&
    expiresAt.getTime() >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export type CredentialDocumentFacts = {
  id: string;
  checksum: string;
  status: string;
  providerProfileId: string | null;
  purpose: string;
  credentialSnapshot: unknown;
  credentialReviewStatus: string;
  credentialExpiresAt: Date | null;
  credentialCoverageCents: number | null;
  credentialAdditionalInsured: boolean | null;
};

export type VerificationProfile = Partial<{
  id: string;
  licenseNumber: string | null;
  licenseState: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  licenseVerifiedAt: Date | null;
  insuranceVerifiedAt: Date | null;
  licenseExpiresAt: Date | null;
  insuranceExpiresAt: Date | null;
  insuranceCoverageCents: number | null;
  insuranceAdditionalInsured: boolean;
  licenseDocumentId: string | null;
  insuranceDocumentId: string | null;
  licenseVerifiedDocumentChecksum: string | null;
  insuranceVerifiedDocumentChecksum: string | null;
  licenseDocument: CredentialDocumentFacts | null;
  insuranceDocument: CredentialDocumentFacts | null;
}>;

type CredentialClaims = Pick<VerificationProfile, "licenseNumber" | "licenseState" | "insuranceProvider" | "insurancePolicyNumber">;

export function credentialClaimSnapshot(profile: CredentialClaims, kind: "license" | "insurance") {
  return kind === "license"
    ? { licenseNumber: profile.licenseNumber ?? null, licenseState: profile.licenseState ?? null }
    : { insuranceProvider: profile.insuranceProvider ?? null, insurancePolicyNumber: profile.insurancePolicyNumber ?? null };
}

export function credentialSnapshotMatches(snapshot: unknown, profile: CredentialClaims, kind: "license" | "insurance"): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const expected = credentialClaimSnapshot(profile, kind);
  const actual = snapshot as Record<string, unknown>;
  return Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => actual[key] === value);
}

/** No document, changed claim/version, null expiry or old timestamp grants a badge. */
export function providerVerificationState(profile: VerificationProfile | null | undefined, now = new Date()) {
  const valid = (kind: "license" | "insurance") => {
    if (!profile?.id) return false;
    const document = kind === "license" ? profile.licenseDocument : profile.insuranceDocument;
    const documentId = kind === "license" ? profile.licenseDocumentId : profile.insuranceDocumentId;
    const checksum = kind === "license" ? profile.licenseVerifiedDocumentChecksum : profile.insuranceVerifiedDocumentChecksum;
    const expiresAt = kind === "license" ? profile.licenseExpiresAt : profile.insuranceExpiresAt;
    const verifiedAt = kind === "license" ? profile.licenseVerifiedAt : profile.insuranceVerifiedAt;
    if (!verifiedAt || !credentialIsCurrent(expiresAt, now) || !document || !checksum) return false;
    if (document.id !== documentId || document.checksum !== checksum || document.providerProfileId !== profile.id ||
      document.purpose !== `provider_${kind}` || document.status !== "active" || document.credentialReviewStatus !== "approved" ||
      document.credentialExpiresAt?.getTime() !== expiresAt?.getTime() || !credentialSnapshotMatches(document.credentialSnapshot, profile, kind)) return false;
    if (kind === "license") return Boolean(profile.licenseNumber);
    return Boolean(profile.insuranceProvider) && Number.isSafeInteger(profile.insuranceCoverageCents) &&
      (profile.insuranceCoverageCents ?? -1) >= 0 && document.credentialCoverageCents === profile.insuranceCoverageCents &&
      document.credentialAdditionalInsured === profile.insuranceAdditionalInsured;
  };
  const license = valid("license");
  const insurance = valid("insurance");
  return { license, insurance, verified: license && insurance };
}

export const credentialDocumentSelect = {
  id: true, checksum: true, status: true, providerProfileId: true, purpose: true,
  credentialSnapshot: true, credentialReviewStatus: true, credentialExpiresAt: true,
  credentialCoverageCents: true, credentialAdditionalInsured: true,
} as const;

export const providerVerificationSelect = {
  id: true, licenseNumber: true, licenseState: true, insuranceProvider: true, insurancePolicyNumber: true,
  licenseVerifiedAt: true, insuranceVerifiedAt: true, licenseExpiresAt: true, insuranceExpiresAt: true,
  insuranceCoverageCents: true, insuranceAdditionalInsured: true,
  licenseDocumentId: true, insuranceDocumentId: true,
  licenseVerifiedDocumentChecksum: true, insuranceVerifiedDocumentChecksum: true,
  licenseDocument: { select: credentialDocumentSelect }, insuranceDocument: { select: credentialDocumentSelect },
} as const;
