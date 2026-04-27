/**
 * Tests for convertNativeSectionToApp from sectionConversions.ts.
 */

/**
 * Encode coordinates in the same delta+zigzag-varint format as the Rust side,
 * so mock FFI data matches the real ArrayBuffer shape.
 */
function encodeCoords(points: { latitude: number; longitude: number }[]): ArrayBuffer {
  const SCALE = 1e7;
  const bytes: number[] = [];

  function writeVarint(v: number) {
    v = v >>> 0;
    while (v > 0x7f) {
      bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(v & 0x7f);
  }

  function writeZigzag(v: number) {
    writeVarint((v << 1) ^ (v >> 31));
  }

  writeVarint(points.length);
  let prevLat = 0;
  let prevLng = 0;
  for (const p of points) {
    const lat = Math.round(p.latitude * SCALE);
    const lng = Math.round(p.longitude * SCALE);
    writeZigzag(lat - prevLat);
    writeZigzag(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }

  return new Uint8Array(bytes).buffer;
}

jest.mock('veloqrs', () => ({
  decodeCoords: (buf: ArrayBuffer) => {
    const SCALE = 1e7;
    const bytes = new Uint8Array(buf);
    let pos = 0;

    function readVarint(): number {
      let result = 0;
      let shift = 0;
      while (pos < bytes.length) {
        const byte = bytes[pos++];
        result |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      return result >>> 0;
    }

    function readZigzag(): number {
      const v = readVarint();
      return (v >>> 1) ^ -(v & 1);
    }

    const count = readVarint();
    const points: { latitude: number; longitude: number }[] = [];
    let lat = 0;
    let lng = 0;
    for (let i = 0; i < count; i++) {
      lat += readZigzag();
      lng += readZigzag();
      points.push({ latitude: lat / SCALE, longitude: lng / SCALE });
    }
    return points;
  },
}));

jest.mock('@/lib/utils/ffiConversions', () => ({
  convertActivityPortions: (portions: any[]) =>
    portions.map((p) => ({
      ...p,
      direction: p.direction === 'reverse' ? 'reverse' : 'same',
    })),
}));

import { convertNativeSectionToApp } from '@/lib/utils/sectionConversions';

// ---------------------------------------------------------------------------
// Helper: build a minimal NativeFrequentSection-like object
// ---------------------------------------------------------------------------

function makeNativeFrequentSection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'section-1',
    sportType: 'Ride',
    encodedPolyline: encodeCoords([
      { latitude: 48.0, longitude: 11.0 },
      { latitude: 48.1, longitude: 11.1 },
    ]),
    representativeActivityId: 'act-1',
    activityIds: ['act-1', 'act-2'],
    activityPortions: [{ activityId: 'act-1', direction: 'same', startIndex: 0, endIndex: 10 }],
    routeIds: ['route-1'],
    visitCount: 5,
    distanceMeters: 1200,
    name: 'Hill Climb',
    confidence: 0.85,
    observationCount: 4,
    averageSpread: 12.5,
    pointDensity: [3, 4, 5],
    stability: 0.9,
    version: 2,
    updatedAt: '2026-01-15T10:00:00Z',
    createdAt: '2026-01-01T08:00:00Z',
    ...overrides,
  };
}

// A minimal NativeSection-like object (from getSectionsForActivity, many optional fields)
function makeNativeSection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'section-2',
    sectionType: 'custom',
    sportType: 'Run',
    encodedPolyline: encodeCoords([{ latitude: 47.0, longitude: 10.0 }]),
    representativeActivityId: null,
    activityIds: ['act-3'],
    visitCount: 1,
    distanceMeters: 500,
    name: null,
    confidence: null,
    observationCount: null,
    averageSpread: null,
    pointDensity: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// convertNativeSectionToApp
// ---------------------------------------------------------------------------

describe('convertNativeSectionToApp', () => {
  it('converts a full NativeFrequentSection with all fields', () => {
    const native = makeNativeFrequentSection();
    const result = convertNativeSectionToApp(native as any);

    expect(result.id).toBe('section-1');
    expect(result.sectionType).toBe('auto'); // FfiFrequentSection defaults to 'auto'
    expect(result.sportType).toBe('Ride');
    expect(result.polyline).toHaveLength(2);
    expect(result.representativeActivityId).toBe('act-1');
    expect(result.activityIds).toEqual(['act-1', 'act-2']);
    expect(result.visitCount).toBe(5);
    expect(result.distanceMeters).toBe(1200);
    expect(result.name).toBe('Hill Climb');
    expect(result.confidence).toBe(0.85);
    expect(result.observationCount).toBe(4);
    expect(result.averageSpread).toBe(12.5);
    expect(result.pointDensity).toEqual([3, 4, 5]);
    expect(result.stability).toBe(0.9);
    expect(result.version).toBe(2);
    expect(result.updatedAt).toBe('2026-01-15T10:00:00Z');
    expect(result.createdAt).toBe('2026-01-01T08:00:00Z');
    expect(result.routeIds).toEqual(['route-1']);
  });

  it('converts activityPortions with direction casting', () => {
    const native = makeNativeFrequentSection({
      activityPortions: [
        { activityId: 'a1', direction: 'same', startIndex: 0, endIndex: 5 },
        { activityId: 'a2', direction: 'reverse', startIndex: 3, endIndex: 8 },
      ],
    });
    const result = convertNativeSectionToApp(native as any);

    expect(result.activityPortions).toHaveLength(2);
    expect(result.activityPortions![0].direction).toBe('same');
    expect(result.activityPortions![1].direction).toBe('reverse');
  });

  it('converts NativeSection with sectionType "custom"', () => {
    const native = makeNativeSection({ sectionType: 'custom' });
    const result = convertNativeSectionToApp(native as any);

    expect(result.sectionType).toBe('custom');
  });

  it('defaults sectionType to "auto" for any non-"custom" value', () => {
    const native = makeNativeSection({ sectionType: 'something_else' });
    const result = convertNativeSectionToApp(native as any);

    expect(result.sectionType).toBe('auto');
  });

  it('uses empty string for representativeActivityId when null', () => {
    const native = makeNativeFrequentSection({ representativeActivityId: null });
    const result = convertNativeSectionToApp(native as any);

    expect(result.representativeActivityId).toBe('');
  });

  it('defaults confidence to 0 when null', () => {
    const native = makeNativeSection();
    const result = convertNativeSectionToApp(native as any);

    expect(result.confidence).toBe(0);
  });

  it('defaults pointDensity to empty array when null', () => {
    const native = makeNativeSection();
    const result = convertNativeSectionToApp(native as any);

    expect(result.pointDensity).toEqual([]);
  });

  it('returns empty string for createdAt when input has no createdAt (bug fix)', () => {
    const native = makeNativeSection();
    const result = convertNativeSectionToApp(native as any);

    expect(result.createdAt).toBe('');
  });

  it('preserves name as undefined when null', () => {
    const native = makeNativeFrequentSection({ name: null });
    const result = convertNativeSectionToApp(native as any);

    expect(result.name).toBeUndefined();
  });

  it('decodes encodedPolyline to RoutePoint array', () => {
    const native = makeNativeFrequentSection({
      encodedPolyline: encodeCoords([
        { latitude: 1.0, longitude: 2.0 },
        { latitude: 3.0, longitude: 4.0 },
        { latitude: 5.0, longitude: 6.0 },
      ]),
    });
    const result = convertNativeSectionToApp(native as any);

    expect(result.polyline).toHaveLength(3);
    expect(result.polyline[0]).toEqual({ lat: 1.0, lng: 2.0 });
    expect(result.polyline[1]).toEqual({ lat: 3.0, lng: 4.0 });
    expect(result.polyline[2]).toEqual({ lat: 5.0, lng: 6.0 });
  });
});
