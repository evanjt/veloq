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
  } catch (error) {
    console.warn('Failed to decode polyline:', error);
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

export function convertLatLngTuples(tuples: [number, number][]): LatLng[] {
  // Map directly without filtering to preserve index alignment with stream data
  // Invalid coordinates are handled in the map view when displaying markers
  return tuples.map(([lat, lng]) => {
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
