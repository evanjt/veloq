/**
 * Tests for convertNativeSectionToApp from sectionConversions.ts.
 */

jest.mock('veloqrs', () => ({
  gpsPointsToRoutePoints: (points: unknown[]) =>
    (points || []).map((p: any) => ({
      lat: p.lat ?? p.latitude ?? 0,
      lng: p.lng ?? p.longitude ?? 0,
      ele: p.ele ?? p.elevation ?? 0,
    })),
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
    polyline: [
      { lat: 48.0, lng: 11.0, ele: 500 },
      { lat: 48.1, lng: 11.1, ele: 510 },
    ],
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
    polyline: [{ lat: 47.0, lng: 10.0, ele: 300 }],
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

  it('converts NativeSection with sectionType "auto"', () => {
    const native = makeNativeSection({ sectionType: 'auto' });
    const result = convertNativeSectionToApp(native as any);

    expect(result.sectionType).toBe('auto');
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

  it('defaults observationCount to 0 when null', () => {
    const native = makeNativeSection();
    const result = convertNativeSectionToApp(native as any);

    expect(result.observationCount).toBe(0);
  });

  it('defaults averageSpread to 0 when null', () => {
    const native = makeNativeSection();
    const result = convertNativeSectionToApp(native as any);

    expect(result.averageSpread).toBe(0);
  });

  it('defaults pointDensity to empty array when null', () => {
    const native = makeNativeSection();
    const result = convertNativeSectionToApp(native as any);

    expect(result.pointDensity).toEqual([]);
  });

  it('defaults routeIds to empty array when not present', () => {
    const native = makeNativeSection(); // NativeSection doesn't have routeIds
    const result = convertNativeSectionToApp(native as any);

    expect(result.routeIds).toEqual([]);
  });

  it('sets activityPortions to undefined when not present', () => {
    const native = makeNativeSection(); // NativeSection doesn't have activityPortions
    const result = convertNativeSectionToApp(native as any);

    expect(result.activityPortions).toBeUndefined();
  });

  it('returns empty string for createdAt when input has no createdAt (bug fix)', () => {
    // Historical sections should not get a "now" timestamp
    const native = makeNativeSection();
    const result = convertNativeSectionToApp(native as any);

    // After the fix: should be empty string, not new Date().toISOString()
    expect(result.createdAt).toBe('');
  });

  it('preserves name as undefined when null', () => {
    const native = makeNativeFrequentSection({ name: null });
    const result = convertNativeSectionToApp(native as any);

    expect(result.name).toBeUndefined();
  });

  it('handles polyline conversion via gpsPointsToRoutePoints', () => {
    const native = makeNativeFrequentSection({
      polyline: [
        { lat: 1.0, lng: 2.0, ele: 100 },
        { lat: 3.0, lng: 4.0, ele: 200 },
        { lat: 5.0, lng: 6.0, ele: 300 },
      ],
    });
    const result = convertNativeSectionToApp(native as any);

    expect(result.polyline).toHaveLength(3);
    expect(result.polyline[0]).toEqual({ lat: 1.0, lng: 2.0, ele: 100 });
  });
});
