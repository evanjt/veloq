/**
 * Background geocoding for routes and sections with generic "Route N" / "Section N" names.
 * Uses OpenStreetMap Nominatim (https://nominatim.org/release-docs/latest/api/Reverse/)
 *
 * DISABLED: Geocoding is disabled to comply with Nominatim Usage Policy.
 * The policy prohibits periodic automated requests from mobile apps without a proxy.
 * See: https://operations.osmfoundation.org/policies/nominatim/
 * This hook is kept as a no-op so it can be re-enabled once a caching proxy is in place.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useRouteNameGeocoding(_enabled: boolean = true) {
  // No-op: geocoding disabled for Nominatim ToS compliance
}
