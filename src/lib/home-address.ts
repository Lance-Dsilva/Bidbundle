/** The profile fields needed to route a provider to a neighborhood home. */
export type HomeAddressFields = {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** A text address alone cannot identify a service stop; both coordinates are required. */
export function hasRouteableHomeAddress<T extends HomeAddressFields>(
  profile: T | null | undefined,
): profile is T & { address: string; latitude: number; longitude: number } {
  return Boolean(profile?.address?.trim()) &&
    typeof profile?.latitude === "number" && Number.isFinite(profile.latitude) &&
    profile.latitude >= -90 && profile.latitude <= 90 &&
    typeof profile.longitude === "number" && Number.isFinite(profile.longitude) &&
    profile.longitude >= -180 && profile.longitude <= 180;
}
