import {
  detectCoordinateFormat,
  convertLatLngTuples,
  normalizeBounds,
  getBounds,
  getBoundsCenter,
} from '@/shared/geo/polyline';

describe('detectCoordinateFormat', () => {
  it('should detect coordinate order from which value exceeds 90', () => {
    // Sydney, Australia: lat ~-33.8, lng ~151.2 - longitude > 90 disambiguates.
    expect(
      detectCoordinateFormat([
        [-33.8688, 151.2093],
        [-33.87, 151.21],
      ])
    ).toBe('latLng');
    // Same location but [lng, lat] order - first value > 90.
    expect(
      detectCoordinateFormat([
        [151.2093, -33.8688],
        [151.21, -33.87],
      ])
    ).toBe('lngLat');
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
  it('should convert tuples to LatLng objects, auto-detecting order', () => {
    const expected = [
      { latitude: -33.8688, longitude: 151.2093 },
      { latitude: -33.87, longitude: 151.21 },
    ];
    expect(
      convertLatLngTuples([
        [-33.8688, 151.2093],
        [-33.87, 151.21],
      ])
    ).toEqual(expected);
    // Same coordinates in [lng, lat] order auto-detect to the same objects.
    expect(
      convertLatLngTuples([
        [151.2093, -33.8688],
        [151.21, -33.87],
      ])
    ).toEqual(expected);
  });

  it('should return empty array for empty input', () => {
    expect(convertLatLngTuples([])).toEqual([]);
  });
});

describe('normalizeBounds', () => {
  it('should normalize bounds regardless of corner order', () => {
    const corners: [[number, number], [number, number]][] = [
      [
        [-34.0, 150.5], // SW corner first
        [-33.5, 151.5], // NE corner second
      ],
      [
        [-33.5, 151.5], // NE corner first (swapped)
        [-34.0, 150.5], // SW corner second
      ],
    ];
    for (const bounds of corners) {
      const result = normalizeBounds(bounds);
      expect(result.minLat).toBe(-34.0);
      expect(result.maxLat).toBe(-33.5);
      expect(result.minLng).toBe(150.5);
      expect(result.maxLng).toBe(151.5);
    }
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

  // Gulf of Guinea (0, 0) is a real location - origin coordinates must not
  // be mistaken for "no data".
  it('should return valid bounds for coordinates at the origin', () => {
    const coords = [
      { latitude: 0, longitude: 0 },
      { latitude: 0.001, longitude: 0.001 },
    ];
    const bounds = getBounds(coords);
    expect(bounds).not.toBeNull();
    expect(bounds!.minLat).toBe(0);
    expect(bounds!.maxLat).toBe(0.001);
  });

  it('should distinguish empty array (null) from single point at origin (non-null)', () => {
    expect(getBounds([])).toBeNull();
    expect(getBounds([{ latitude: 0, longitude: 0 }])).not.toBeNull();
  });

  // Scaling smoke test: 10k points must complete quickly and produce correct
  // bounds. Guards against accidental O(n²) regressions.
  it('handles 10000 coordinates under 100ms', () => {
    const coords = Array.from({ length: 10000 }, (_, i) => ({
      latitude: 40 + (i % 100) * 0.001,
      longitude: -74 + Math.floor(i / 100) * 0.001,
    }));
    const start = Date.now();
    const bounds = getBounds(coords);
    const elapsed = Date.now() - start;
    expect(bounds).not.toBeNull();
    expect(bounds!.minLat).toBeCloseTo(40, 1);
    expect(elapsed).toBeLessThan(100);
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
