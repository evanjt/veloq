import {
  detectCoordinateFormat,
  convertLatLngTuples,
  normalizeBounds,
  getBounds,
  getBoundsCenter,
} from '../lib/geo/polyline';

describe('detectCoordinateFormat', () => {
  it('should detect [lat, lng] format when longitude exceeds 90', () => {
    // Sydney, Australia: lat ~-33.8, lng ~151.2
    const coords: [number, number][] = [
      [-33.8688, 151.2093],
      [-33.87, 151.21],
    ];
    expect(detectCoordinateFormat(coords)).toBe('latLng');
  });

  it('should detect [lng, lat] format when first value exceeds 90', () => {
    // Same location but [lng, lat] order
    const coords: [number, number][] = [
      [151.2093, -33.8688],
      [151.21, -33.87],
    ];
    expect(detectCoordinateFormat(coords)).toBe('lngLat');
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
      [-33.87, 151.21],
    ];
    const result = convertLatLngTuples(tuples);

    expect(result[0]).toEqual({ latitude: -33.8688, longitude: 151.2093 });
    expect(result[1]).toEqual({ latitude: -33.87, longitude: 151.21 });
  });

  it('should auto-detect and convert [lng, lat] tuples', () => {
    const tuples: [number, number][] = [
      [151.2093, -33.8688],
      [151.21, -33.87],
    ];
    const result = convertLatLngTuples(tuples);

    expect(result[0]).toEqual({ latitude: -33.8688, longitude: 151.2093 });
    expect(result[1]).toEqual({ latitude: -33.87, longitude: 151.21 });
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
});

describe('getBounds', () => {
  it('should calculate bounds from coordinates', () => {
    const coords = [
      { latitude: -33.8, longitude: 151.0 },
      { latitude: -34.0, longitude: 151.5 },
      { latitude: -33.5, longitude: 151.2 },
    ];
    const result = getBounds(coords);

    expect(result).not.toBeNull();
    expect(result!.minLat).toBe(-34.0);
    expect(result!.maxLat).toBe(-33.5);
    expect(result!.minLng).toBe(151.0);
    expect(result!.maxLng).toBe(151.5);
  });

  it('should filter out NaN coordinates', () => {
    const coords = [
      { latitude: -33.8, longitude: 151.0 },
      { latitude: NaN, longitude: NaN },
      { latitude: -34.0, longitude: 151.5 },
    ];
    const result = getBounds(coords);

    expect(result).not.toBeNull();
    expect(result!.minLat).toBe(-34.0);
    expect(result!.maxLat).toBe(-33.8);
    expect(result!.minLng).toBe(151.0);
    expect(result!.maxLng).toBe(151.5);
  });

  it('should return null for empty array', () => {
    const result = getBounds([]);
    expect(result).toBeNull();
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
