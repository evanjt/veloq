/**
 * Tests for convertNativeSectionToApp from sectionConversions.ts.
 */

import {
  convertNativeSectionToApp,
  convertSectionWithPolylineToApp,
} from '@/shared/ffi/sectionConversions';
import type { Section as NativeSection } from 'veloqrs';

import { encodeTrack } from '../__shared__/trackBytes';

// Real decoder, native binding stubbed out: the encoded bytes are the point.
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: jest.requireActual('../../../modules/veloqrs/src/coords').decodeCoords,
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
    sportTypes: ['Ride'],
    encodedPolyline: encodeTrack([
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
    sportTypes: ['Run'],
    encodedPolyline: encodeTrack([{ latitude: 47.0, longitude: 10.0 }]),
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
    expect(result.sportTypes).toEqual(['Ride']);
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
      encodedPolyline: encodeTrack([
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

  it('decodes a polyline carrying elevations to the same coordinates', () => {
    const native = makeCatalogueSection({
      encodedPolyline: encodeTrack([
        { latitude: 1.0, longitude: 2.0, elevation: 100.0 },
        { latitude: 3.0, longitude: 4.0 },
      ]),
    });
    const result = convertNativeSectionToApp(native);

    expect(result.polyline).toHaveLength(2);
    expect(result.polyline[0]).toEqual({ lat: 1.0, lng: 2.0 });
    expect(result.polyline[1]).toEqual({ lat: 3.0, lng: 4.0 });
  });
});

// ---------------------------------------------------------------------------
// One builder per engine record, each spreading rather than listing, so an
// enrichment column reaches every screen the day it lands. `isLift` is the case
// in point: a listed builder had it on the detail screen and not on the list,
// which is what listing does to the column nobody remembered to add.
// ---------------------------------------------------------------------------

describe('every builder carries the enrichment columns', () => {
  const ENRICHMENT = {
    elevationGainM: 120.5,
    elevationLossM: 60.25,
    avgGradePercent: 4.2,
    maxGradePercent: 11.7,
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
      visitCount: 3,
      activityCount: 3,
      distanceMeters: 900,
      confidence: 0.7,
      encodedPolyline: encodeTrack([{ latitude: 46.0, longitude: 7.0 }]),
      sportTypes: ['Ride'],
      isUserDefined: false,
      disabled: false,
      ...ENRICHMENT,
    } as unknown as Parameters<typeof convertSectionWithPolylineToApp>[0]);

    expect(section).toMatchObject(ENRICHMENT);
  });
});

describe('the list builder', () => {
  const LIST_RECORD = {
    id: 'section-5',
    visitCount: 4,
    activityCount: 4,
    distanceMeters: 1500,
    confidence: 0.6,
    encodedPolyline: encodeTrack([{ latitude: 46.0, longitude: 7.0 }]),
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

  it('takes custom type from the engine even when the id has no custom prefix', () => {
    expect(build({ id: 'foreign-id', sectionType: 'custom' }).sectionType).toBe('custom');
  });

  it('takes auto type from the engine even when the id has a custom prefix', () => {
    expect(build({ id: 'custom_legacy', sectionType: 'auto' }).sectionType).toBe('auto');
  });

  it('reports no superseding section as null, not as absent', () => {
    expect(build({ supersededBy: undefined }).supersededBy).toBeNull();
  });

  it('decodes the polyline the row draws', () => {
    expect(build().polyline).toEqual([{ lat: 46.0, lng: 7.0 }]);
  });
});
