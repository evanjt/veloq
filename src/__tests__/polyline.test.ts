import {
  detectCoordinateFormat,
  convertLatLngTuples,
  normalizeBounds,
  getBounds,
  getBoundsCenter,
} from '../lib/polyline';

describe('detectCoordinateFormat', () => {
  it('should detect [lat, lng] format when longitude exceeds 90', () => {
    // Sydney, Australia: lat ~-33.8, lng ~151.2
    const coords: [number, number][] = [
      [-33.8688, 151.2093],
      [-33.8700, 151.2100],
    ];
    expect(detectCoordinateFormat(coords)).toBe('latLng');
  });

  it('should detect [lng, lat] format when first value exceeds 90', () => {
    // Same location but [lng, lat] order
    const coords: [number, number][] = [
      [151.2093, -33.8688],
      [151.2100, -33.8700],
    ];
    expect(detectCoordinateFormat(coords)).toBe('lngLat');
  });

  it('should detect [lat, lng] for European coordinates where both could be valid latitudes', () => {
    // Zurich: lat ~47.3, lng ~8.5 - both are valid latitude values
    // Should default to latLng when ambiguous
    const coords: [number, number][] = [
      [47.3769, 8.5417],
      [47.3800, 8.5500],
    ];
    expect(detectCoordinateFormat(coords)).toBe('latLng');
  });

  it('should handle coordinates crossing the antimeridian', () => {
    // Near date line: lat ~0, lng ~179
    const coords: [number, number][] = [
      [0, 179],
      [1, -179],
    ];
    expect(detectCoordinateFormat(coords)).toBe('latLng');
  });

  it('should skip invalid coordinates when detecting format', () => {
    const coords: [number, number][] = [
      [NaN, NaN],
      [null as unknown as number, null as unknown as number],
      [-33.8688, 151.2093], // Valid Sydney coord
    ];
    expect(detectCoordinateFormat(coords)).toBe('latLng');
  });
});

describe('convertLatLngTuples', () => {
  it('should convert [lat, lng] tuples to LatLng objects', () => {
    const tuples: [number, number][] = [
      [-33.8688, 151.2093],
      [-33.8700, 151.2100],
    ];
    const result = convertLatLngTuples(tuples);

    expect(result[0]).toEqual({ latitude: -33.8688, longitude: 151.2093 });
    expect(result[1]).toEqual({ latitude: -33.8700, longitude: 151.2100 });
  });

  it('should auto-detect and convert [lng, lat] tuples', () => {
    const tuples: [number, number][] = [
      [151.2093, -33.8688],
      [151.2100, -33.8700],
    ];
    const result = convertLatLngTuples(tuples);

    expect(result[0]).toEqual({ latitude: -33.8688, longitude: 151.2093 });
    expect(result[1]).toEqual({ latitude: -33.8700, longitude: 151.2100 });
  });

  it('should preserve array length for invalid coordinates (NaN sentinel)', () => {
    const tuples: [number, number][] = [
      [-33.8688, 151.2093],
      [NaN, NaN],
      [-33.8700, 151.2100],
    ];
    const result = convertLatLngTuples(tuples);

    expect(result.length).toBe(3);
    expect(result[0]).toEqual({ latitude: -33.8688, longitude: 151.2093 });
    expect(isNaN(result[1].latitude)).toBe(true);
    expect(result[2]).toEqual({ latitude: -33.8700, longitude: 151.2100 });
  });

  it('should return empty array for empty input', () => {
    expect(convertLatLngTuples([])).toEqual([]);
  });
});

describe('normalizeBounds', () => {
  it('should normalize [[lat, lng], [lat, lng]] bounds', () => {
    // Sydney area bounds in [lat, lng] format
    const bounds: [[number, number], [number, number]] = [
      [-34.0, 150.5], // SW corner
      [-33.5, 151.5], // NE corner
    ];
    const result = normalizeBounds(bounds);

    expect(result.minLat).toBe(-34.0);
    expect(result.maxLat).toBe(-33.5);
    expect(result.minLng).toBe(150.5);
    expect(result.maxLng).toBe(151.5);
  });

  it('should normalize [[lng, lat], [lng, lat]] bounds (GeoJSON format)', () => {
    // Same bounds but in [lng, lat] format (GeoJSON style)
    const bounds: [[number, number], [number, number]] = [
      [150.5, -34.0], // SW corner
      [151.5, -33.5], // NE corner
    ];
    const result = normalizeBounds(bounds);

    expect(result.minLat).toBe(-34.0);
    expect(result.maxLat).toBe(-33.5);
    expect(result.minLng).toBe(150.5);
    expect(result.maxLng).toBe(151.5);
  });

  it('should handle bounds where corners are swapped', () => {
    // NE before SW
    const bounds: [[number, number], [number, number]] = [
      [-33.5, 151.5], // NE corner
      [-34.0, 150.5], // SW corner
    ];
    const result = normalizeBounds(bounds);

    expect(result.minLat).toBe(-34.0);
    expect(result.maxLat).toBe(-33.5);
    expect(result.minLng).toBe(150.5);
    expect(result.maxLng).toBe(151.5);
  });

  it('should handle ambiguous European bounds (both values valid latitudes)', () => {
    // Zurich area: lat ~47, lng ~8 - both could be latitudes
    const bounds: [[number, number], [number, number]] = [
      [47.0, 8.0],
      [47.5, 8.5],
    ];
    const result = normalizeBounds(bounds);

    // Should default to [lat, lng] interpretation
    expect(result.minLat).toBe(47.0);
    expect(result.maxLat).toBe(47.5);
    expect(result.minLng).toBe(8.0);
    expect(result.maxLng).toBe(8.5);
  });
});

describe('getBounds', () => {
  it('should calculate bounds from coordinates', () => {
    const coords = [
      { latitude: -33.8, longitude: 151.0 },
      { latitude: -34.0, longitude: 151.5 },
      { latitude: -33.5, longitude: 151.2 },
    ];
    const result = getBounds(coords);

    expect(result.minLat).toBe(-34.0);
    expect(result.maxLat).toBe(-33.5);
    expect(result.minLng).toBe(151.0);
    expect(result.maxLng).toBe(151.5);
  });

  it('should filter out NaN coordinates', () => {
    const coords = [
      { latitude: -33.8, longitude: 151.0 },
      { latitude: NaN, longitude: NaN },
      { latitude: -34.0, longitude: 151.5 },
    ];
    const result = getBounds(coords);

    expect(result.minLat).toBe(-34.0);
    expect(result.maxLat).toBe(-33.8);
    expect(result.minLng).toBe(151.0);
    expect(result.maxLng).toBe(151.5);
  });

  it('should return zeros for empty array', () => {
    const result = getBounds([]);
    expect(result).toEqual({ minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 });
  });

  it('should return zeros when all coordinates are NaN', () => {
    const coords = [
      { latitude: NaN, longitude: NaN },
      { latitude: NaN, longitude: NaN },
    ];
    const result = getBounds(coords);
    expect(result).toEqual({ minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 });
  });
});

describe('getBoundsCenter', () => {
  it('should return center of bounds as [lng, lat] for MapLibre', () => {
    const bounds: [[number, number], [number, number]] = [
      [-34.0, 151.0],
      [-33.0, 152.0],
    ];
    const [lng, lat] = getBoundsCenter(bounds);

    expect(lat).toBe(-33.5);
    expect(lng).toBe(151.5);
  });
});
