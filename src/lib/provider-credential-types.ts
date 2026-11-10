export type ProviderCredentialRef = {
  id: string;
  checksum: string;
  reviewStatus: "pending" | "approved" | "rejected";
  reviewReason: string | null;
  uploadedAt: string;
  url: string;
};

export type ProviderCredentials = {
  license: ProviderCredentialRef | null;
  insurance: ProviderCredentialRef | null;
  licenseExpiresOn: string | null;
  insuranceExpiresOn: string | null;
  insuranceCoverageCents: number | null;
  insuranceAdditionalInsured: boolean;
  updatedAt: string;
};
