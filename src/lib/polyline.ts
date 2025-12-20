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
  if (coordinates.length === 0) {
    return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
  }

  let minLat = coordinates[0].latitude;
  let maxLat = coordinates[0].latitude;
  let minLng = coordinates[0].longitude;
  let maxLng = coordinates[0].longitude;

  for (const coord of coordinates) {
    minLat = Math.min(minLat, coord.latitude);
    maxLat = Math.max(maxLat, coord.latitude);
    minLng = Math.min(minLng, coord.longitude);
    maxLng = Math.max(maxLng, coord.longitude);
  }

  return { minLat, maxLat, minLng, maxLng };
}

export function convertLatLngTuples(tuples: [number, number][]): LatLng[] {
  return tuples.map(([lat, lng]) => ({
    latitude: lat,
    longitude: lng,
  }));
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
