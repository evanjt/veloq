/**
 * Tests for convertNativeSectionToApp from sectionConversions.ts.
 */

/**
 * Encode coordinates in the same delta+zigzag-varint format as the Rust side,
 * so mock FFI data matches the real ArrayBuffer shape.
 */
import {
  convertNativeSectionToApp,
  convertSectionSummaryToApp,
  convertSectionWithPolylineToApp,
} from '@/features/routes/lib/sectionConversions';
import type { Section as NativeSection } from 'veloqrs';

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

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
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
      const points: { latitude: number; longitude: number; elevation?: number }[] = [];
      let lat = 0;
      let lng = 0;
      for (let i = 0; i < count; i++) {
        if (pos >= bytes.length) break;
        lat += readZigzag();
        lng += readZigzag();
        points.push({ latitude: lat / SCALE, longitude: lng / SCALE });
      }

      // Optional trailing elevation section: 0xE1 tag, mode byte (bit 0 =
      // presence bitmap, bit 1 = exact f64 LE), then per-point payloads.
      if (pos >= bytes.length || bytes[pos] !== 0xe1) return points;
      pos++;
      if (pos >= bytes.length) return points;
      const mode = bytes[pos++];
      const exact = (mode & 0b10) !== 0;
      let bitmap: Uint8Array | null = null;
      if ((mode & 0b01) !== 0) {
        const len = Math.ceil(points.length / 8);
        if (bytes.length < pos + len) return points;
        bitmap = bytes.subarray(pos, pos + len);
        pos += len;
      }
      const view = new DataView(buf);
      let prev = 0;
      for (let i = 0; i < points.length; i++) {
        if (bitmap !== null && (bitmap[i >> 3] & (1 << (i % 8))) === 0) continue;
        if (exact) {
          if (bytes.length < pos + 8) return points;
          points[i].elevation = view.getFloat64(pos, true);
          pos += 8;
        } else {
          if (pos >= bytes.length) return points;
          prev += readZigzag();
          points[i].elevation = prev / 10;
        }
      }
      return points;
    },
  })
);

jest.mock('@/shared/ffi/ffiConversions', () => ({
  convertActivityPortions: (portions: { direction: string }[]) =>
    portions.map((p) => ({
      ...p,
      direction: p.direction === 'reverse' ? 'reverse' : 'same',
    })),
}));

// ---------------------------------------------------------------------------
// Both producers send the one section record: the in-memory catalogue
// (getSections, getSectionById) and the database (getSectionsForActivity).
// ---------------------------------------------------------------------------

function makeCatalogueSection(overrides: Record<string, unknown> = {}): NativeSection {
  return {
    id: 'section-1',
    sectionType: 'auto',
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
    isUserDefined: false,
    disabled: false,
    supersededBy: null,
    ...overrides,
  } as unknown as NativeSection;
}

function makeDatabaseSection(overrides: Record<string, unknown> = {}): NativeSection {
  return {
    id: 'section-2',
    sectionType: 'custom',
    sportType: 'Run',
    encodedPolyline: encodeCoords([{ latitude: 47.0, longitude: 10.0 }]),
    representativeActivityId: null,
    activityIds: ['act-3'],
    activityPortions: [],
    routeIds: null,
    visitCount: 1,
    distanceMeters: 500,
    name: null,
    confidence: null,
    observationCount: null,
    averageSpread: null,
    pointDensity: null,
    createdAt: '',
    isUserDefined: false,
    disabled: false,
    supersededBy: null,
    ...overrides,
  } as unknown as NativeSection;
}

// ---------------------------------------------------------------------------
// convertNativeSectionToApp
// ---------------------------------------------------------------------------

describe('convertNativeSectionToApp', () => {
  it('converts a full catalogue section with all fields', () => {
    const native = makeCatalogueSection();
    const result = convertNativeSectionToApp(native);

    expect(result.id).toBe('section-1');
    expect(result.sectionType).toBe('auto');
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

  it('carries the elevation loss the engine recorded', () => {
    const native = makeCatalogueSection({ elevationGainM: 12, elevationLossM: 640 });
    const result = convertNativeSectionToApp(native);

    expect(result.elevationGainM).toBe(12);
    expect(result.elevationLossM).toBe(640);
  });

  it('leaves elevationLossM undefined when the engine has none', () => {
    const result = convertNativeSectionToApp(makeDatabaseSection());

    expect(result.elevationLossM).toBeUndefined();
  });

  it('converts activityPortions with direction casting', () => {
    const native = makeCatalogueSection({
      activityPortions: [
        { activityId: 'a1', direction: 'same', startIndex: 0, endIndex: 5 },
        { activityId: 'a2', direction: 'reverse', startIndex: 3, endIndex: 8 },
      ],
    });
    const result = convertNativeSectionToApp(native);

    expect(result.activityPortions).toHaveLength(2);
    expect(result.activityPortions![0].direction).toBe('same');
    expect(result.activityPortions![1].direction).toBe('reverse');
  });

  it('gives a database section an empty portion list, never a missing one', () => {
    const result = convertNativeSectionToApp(makeDatabaseSection());

    expect(result.activityPortions).toEqual([]);
  });

  it('defaults routeIds to an empty array when the producer has none', () => {
    const result = convertNativeSectionToApp(makeDatabaseSection());

    expect(result.routeIds).toEqual([]);
  });

  it('converts a database section with sectionType "custom"', () => {
    const native = makeDatabaseSection({ sectionType: 'custom' });
    const result = convertNativeSectionToApp(native);

    expect(result.sectionType).toBe('custom');
  });

  it('defaults sectionType to "auto" for any non-"custom" value', () => {
    const native = makeDatabaseSection({ sectionType: 'something_else' });
    const result = convertNativeSectionToApp(native);

    expect(result.sectionType).toBe('auto');
  });

  it('uses empty string for representativeActivityId when null', () => {
    const native = makeCatalogueSection({ representativeActivityId: null });
    const result = convertNativeSectionToApp(native);

    expect(result.representativeActivityId).toBe('');
  });

  it('defaults confidence to 0 when null', () => {
    const native = makeDatabaseSection();
    const result = convertNativeSectionToApp(native);

    expect(result.confidence).toBe(0);
  });

  it('defaults pointDensity to empty array when null', () => {
    const native = makeDatabaseSection();
    const result = convertNativeSectionToApp(native);

    expect(result.pointDensity).toEqual([]);
  });

  it('returns empty string for createdAt when input has no createdAt (bug fix)', () => {
    const native = makeDatabaseSection();
    const result = convertNativeSectionToApp(native);

    expect(result.createdAt).toBe('');
  });

  it('preserves name as undefined when null', () => {
    const native = makeCatalogueSection({ name: null });
    const result = convertNativeSectionToApp(native);

    expect(result.name).toBeUndefined();
  });

  it('decodes encodedPolyline to RoutePoint array', () => {
    const native = makeCatalogueSection({
      encodedPolyline: encodeCoords([
        { latitude: 1.0, longitude: 2.0 },
        { latitude: 3.0, longitude: 4.0 },
        { latitude: 5.0, longitude: 6.0 },
      ]),
    });
    const result = convertNativeSectionToApp(native);

    expect(result.polyline).toHaveLength(3);
    expect(result.polyline[0]).toEqual({ lat: 1.0, lng: 2.0 });
    expect(result.polyline[1]).toEqual({ lat: 3.0, lng: 4.0 });
    expect(result.polyline[2]).toEqual({ lat: 5.0, lng: 6.0 });
  });

  it('decodes a polyline carrying the trailing elevation section unchanged', () => {
    const base = new Uint8Array(
      encodeCoords([
        { latitude: 1.0, longitude: 2.0 },
        { latitude: 3.0, longitude: 4.0 },
      ])
    );
    const suffix = [0xe1, 0x00, 0xd0, 0x0f, 0x0a];
    const withElevation = new Uint8Array(base.length + suffix.length);
    withElevation.set(base);
    withElevation.set(suffix, base.length);

    const native = makeCatalogueSection({ encodedPolyline: withElevation.buffer });
    const result = convertNativeSectionToApp(native);

    expect(result.polyline).toHaveLength(2);
    expect(result.polyline[0]).toEqual({ lat: 1.0, lng: 2.0 });
    expect(result.polyline[1]).toEqual({ lat: 3.0, lng: 4.0 });
  });
});

// ---------------------------------------------------------------------------
// One builder per engine record, each spreading rather than listing, so an
// enrichment column reaches every screen the day it lands. `straightness` is
// the case in point: it has been on the engine's records with no app field
// at all, which is what a listed builder does to the fourth column nobody
// remembered to add.
// ---------------------------------------------------------------------------

describe('every builder carries the enrichment columns', () => {
  const ENRICHMENT = {
    elevationGainM: 120.5,
    elevationLossM: 60.25,
    avgGradePercent: 4.2,
    maxGradePercent: 11.7,
    straightness: 0.83,
    klass: 'climb',
    isLift: true,
    rankScore: 0.91,
    sportRankScore: 0.77,
  };

  it('off the full section record', () => {
    const section = convertNativeSectionToApp(makeCatalogueSection(ENRICHMENT));

    expect(section).toMatchObject(ENRICHMENT);
  });

  it('off the list record, which had been dropping half of them', () => {
    const section = convertSectionWithPolylineToApp({
      id: 'section-3',
      sportType: 'Ride',
      visitCount: 3,
      activityCount: 3,
      distanceMeters: 900,
      confidence: 0.7,
      encodedPolyline: encodeCoords([{ latitude: 46.0, longitude: 7.0 }]),
      sportTypes: ['Ride'],
      isUserDefined: false,
      disabled: false,
      ...ENRICHMENT,
    } as unknown as Parameters<typeof convertSectionWithPolylineToApp>[0]);

    expect(section).toMatchObject(ENRICHMENT);
  });

  it('off the summary record, for the columns a summary carries', () => {
    const section = convertSectionSummaryToApp({
      id: 'section-4',
      sectionType: 'auto',
      sportType: 'Run',
      distanceMeters: 400,
      visitCount: 2,
      activityCount: 2,
      createdAt: '2026-01-01T00:00:00Z',
      elevationGainM: ENRICHMENT.elevationGainM,
      avgGradePercent: ENRICHMENT.avgGradePercent,
      klass: ENRICHMENT.klass,
      rankScore: ENRICHMENT.rankScore,
    } as unknown as Parameters<typeof convertSectionSummaryToApp>[0]);

    expect(section).toMatchObject({
      elevationGainM: ENRICHMENT.elevationGainM,
      avgGradePercent: ENRICHMENT.avgGradePercent,
      klass: ENRICHMENT.klass,
      rankScore: ENRICHMENT.rankScore,
    });
  });
});

describe('the list builder', () => {
  const LIST_RECORD = {
    id: 'section-5',
    sportType: 'Ride',
    visitCount: 4,
    activityCount: 4,
    distanceMeters: 1500,
    confidence: 0.6,
    encodedPolyline: encodeCoords([{ latitude: 46.0, longitude: 7.0 }]),
    sportTypes: ['Ride'],
    isUserDefined: true,
    disabled: true,
    supersededBy: 'custom_9',
  };

  function build(overrides: Record<string, unknown> = {}) {
    return convertSectionWithPolylineToApp({
      ...LIST_RECORD,
      ...overrides,
    } as unknown as Parameters<typeof convertSectionWithPolylineToApp>[0]);
  }

  it('reads the flags off the record rather than casting for them', () => {
    expect(build()).toMatchObject({
      isUserDefined: true,
      disabled: true,
      supersededBy: 'custom_9',
    });
  });

  it('reports no superseding section as null, not as absent', () => {
    expect(build({ supersededBy: undefined }).supersededBy).toBeNull();
  });

  it('decodes the polyline the row draws', () => {
    expect(build().polyline).toEqual([{ lat: 46.0, lng: 7.0 }]);
  });
});
