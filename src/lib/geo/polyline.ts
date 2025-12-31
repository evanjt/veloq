import polyline from '@mapbox/polyline';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export function decodePolyline(encoded: string): LatLng[] {
  try {
    const decoded = polyline.decode(encoded);
    return decoded.map(([lat, lng]) => ({
      latitude: lat,
      longitude: lng,
    }));
  } catch {
    return [];
  }
}

export function getBounds(coordinates: LatLng[]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  // Filter out invalid coordinates (NaN values)
  const validCoords = coordinates.filter(
    c => !isNaN(c.latitude) && !isNaN(c.longitude)
  );

  if (validCoords.length === 0) {
    return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
  }

  let minLat = validCoords[0].latitude;
  let maxLat = validCoords[0].latitude;
  let minLng = validCoords[0].longitude;
  let maxLng = validCoords[0].longitude;

  for (const coord of validCoords) {
    minLat = Math.min(minLat, coord.latitude);
    maxLat = Math.max(maxLat, coord.latitude);
    minLng = Math.min(minLng, coord.longitude);
    maxLng = Math.max(maxLng, coord.longitude);
  }

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Detect if coordinate tuples are in [lat, lng] or [lng, lat] format.
 * Uses the fact that latitude must be between -90 and 90,
 * while longitude can be between -180 and 180.
 */
export function detectCoordinateFormat(tuples: [number, number][]): 'latLng' | 'lngLat' {
  // Check first few valid coordinates
  for (const [first, second] of tuples.slice(0, 10)) {
    if (first == null || second == null || isNaN(first) || isNaN(second)) continue;

    // If first value is outside latitude range (-90 to 90), it must be longitude
    if (first > 90 || first < -90) {
      return 'lngLat';
    }
    // If second value is outside latitude range, format is [lat, lng]
    if (second > 90 || second < -90) {
      return 'latLng';
    }
  }

  // Default to [lat, lng] if we can't determine (both values in valid lat range)
  return 'latLng';
}

export function convertLatLngTuples(tuples: [number, number][]): LatLng[] {
  if (tuples.length === 0) return [];

  // Auto-detect coordinate format
  const format = detectCoordinateFormat(tuples);

  // Map directly without filtering to preserve index alignment with stream data
  // Invalid coordinates are handled in the map view when displaying markers
  return tuples.map((coord) => {
    const [first, second] = coord;

    // Assign lat/lng based on detected format
    const lat = format === 'latLng' ? first : second;
    const lng = format === 'latLng' ? second : first;

    // Check for valid coordinates
    const isValid = lat != null &&
      lng != null &&
      !isNaN(lat) &&
      !isNaN(lng) &&
      lat >= -90 && lat <= 90 &&
      lng >= -180 && lng <= 180;

    if (isValid) {
      return { latitude: lat, longitude: lng };
    }
    // Return a sentinel value for invalid coordinates (will be filtered when used)
    return { latitude: NaN, longitude: NaN };
  });
}

/**
 * Convert bounds from API format to consistent { minLat, maxLat, minLng, maxLng }.
 * Auto-detects if bounds are in [[lat, lng], [lat, lng]] or [[lng, lat], [lng, lat]] format.
 */
export function normalizeBounds(bounds: [[number, number], [number, number]]): {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
} {
  const [[a, b], [c, d]] = bounds;

  // Detect format by checking which values are outside latitude range (-90 to 90)
  // Latitude must be in [-90, 90], longitude can be in [-180, 180]
  const firstOutsideLatRange = a > 90 || a < -90 || c > 90 || c < -90;
  const secondOutsideLatRange = b > 90 || b < -90 || d > 90 || d < -90;

  let lat1: number, lng1: number, lat2: number, lng2: number;

  if (firstOutsideLatRange && !secondOutsideLatRange) {
    // First values are longitudes (outside lat range), second are latitudes
    // Format is [[lng, lat], [lng, lat]]
    lng1 = a; lat1 = b;
    lng2 = c; lat2 = d;
  } else if (!firstOutsideLatRange && secondOutsideLatRange) {
    // First values are latitudes (in range), second are longitudes (outside range)
    // Format is [[lat, lng], [lat, lng]]
    lat1 = a; lng1 = b;
    lat2 = c; lng2 = d;
  } else if (firstOutsideLatRange && secondOutsideLatRange) {
    // Both outside lat range - unusual, but treat as [lng, lat]
    // (both could be longitudes if bounds span 0,0)
    lng1 = a; lat1 = b;
    lng2 = c; lat2 = d;
  } else {
    // All values within lat range - ambiguous, default to [lat, lng]
    lat1 = a; lng1 = b;
    lat2 = c; lng2 = d;
  }

  return {
    minLat: Math.min(lat1, lat2),
    maxLat: Math.max(lat1, lat2),
    minLng: Math.min(lng1, lng2),
    maxLng: Math.max(lng1, lng2),
  };
}

/**
 * Get center point from bounds as [longitude, latitude] for MapLibre.
 */
export function getBoundsCenter(bounds: [[number, number], [number, number]]): [number, number] {
  const { minLat, maxLat, minLng, maxLng } = normalizeBounds(bounds);
  return [
    (minLng + maxLng) / 2, // longitude
    (minLat + maxLat) / 2, // latitude
  ];
}

export function getRegion(coordinates: LatLng[], padding = 0.1) {
  const bounds = getBounds(coordinates);

  const latDelta = (bounds.maxLat - bounds.minLat) * (1 + padding);
  const lngDelta = (bounds.maxLng - bounds.minLng) * (1 + padding);

  return {
    latitude: (bounds.minLat + bounds.maxLat) / 2,
    longitude: (bounds.minLng + bounds.maxLng) / 2,
    latitudeDelta: Math.max(latDelta, 0.01),
    longitudeDelta: Math.max(lngDelta, 0.01),
  };
}

/**
 * Compute bounds from a polyline string.
 * Returns bounds in [[minLat, minLng], [maxLat, maxLng]] format for API compatibility.
 */
export function getBoundsFromPolyline(encoded: string): [[number, number], [number, number]] | null {
  const coords = decodePolyline(encoded);
  if (coords.length === 0) return null;

  const { minLat, maxLat, minLng, maxLng } = getBounds(coords);
  if (minLat === 0 && maxLat === 0 && minLng === 0 && maxLng === 0) return null;

  return [[minLat, minLng], [maxLat, maxLng]];
}
