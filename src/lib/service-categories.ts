/** One service vocabulary for request forms, provider profiles and matching. */
export const SERVICE_CATEGORIES = [
  "cleaning",
  "electrical",
  "gutter",
  "handyman",
  "hvac",
  "lawn",
  "plumbing",
  "roofing",
  "other",
  "painting",
  "pest_control",
  "pool_care",
  "landscaping",
  "seasonal_maintenance",
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  cleaning: "Cleaning",
  electrical: "Electrical",
  gutter: "Gutters",
  handyman: "Handyman",
  hvac: "HVAC",
  lawn: "Lawn care",
  plumbing: "Plumbing",
  roofing: "Roofing",
  other: "Other",
  painting: "Painting",
  pest_control: "Pest control",
  pool_care: "Pool care",
  landscaping: "Landscaping",
  seasonal_maintenance: "Seasonal maintenance",
};

const categories = new Set<string>(SERVICE_CATEGORIES);

/** Only known historical spellings are aliases; unknown work never becomes Other. */
const legacyAliases: Readonly<Record<string, ServiceCategory>> = {
  lawn_care: "lawn",
  gutters: "gutter",
  gutter_cleaning: "gutter",
  gutter_clearing: "gutter",
  gardening: "landscaping",
  pool: "pool_care",
  pool_cleaning: "pool_care",
};

export function normalizeServiceCategory(value: string): ServiceCategory | null {
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (categories.has(key)) return key as ServiceCategory;
  return Object.prototype.hasOwnProperty.call(legacyAliases, key) ? legacyAliases[key] : null;
}

/** For eligibility only: an unrecognized stored trade grants no category access. */
export function normalizeServiceTrades(values: readonly string[]): ServiceCategory[] {
  const normalized = values.map(normalizeServiceCategory);
  return [...new Set(normalized.filter((value): value is ServiceCategory => value !== null))];
}

/** Show readable labels while preserving unrecognized legacy text for remediation. */
export function serviceCategoryLabel(value: string): string {
  const category = normalizeServiceCategory(value);
  return category === null ? value : CATEGORY_LABELS[category];
}
