/**
 * Scenario: the activity and section screens hand their bundle to a hook as an
 * object literal built in the render body, so every render supplies a fresh
 * wrapper around the same fields.
 * Expected behaviour: the hooks key on the fields, not the wrapper, so a
 * re-render that changes nothing decodes nothing again and returns the same
 * references downstream.
 */

import { renderHook } from '@testing-library/react-native';

import { useSectionMatches } from '@/features/routes/hooks/useSectionMatches';
import { useSectionOverlays } from '@/features/activity/hooks/useSectionOverlays';
import { useSectionActivityData } from '@/features/routes/hooks/useSectionActivityData';
import { getEngine } from '@/shared/native/engine';
import { decodeCoords } from 'veloqrs';
import type { ActivityMetrics, FfiMapSignature, Section as NativeSection } from 'veloqrs';
import type { FrequentSection, Section } from '@/types';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: jest.fn(() => [
      { latitude: -37.8, longitude: 144.9 },
      { latitude: -37.81, longitude: 144.91 },
    ]),
  })
);

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const mockDecodeCoords = decodeCoords as jest.MockedFunction<typeof decodeCoords>;

function nativeSection(id: string): NativeSection {
  return {
    id,
    sectionType: 'auto',
    sportType: 'Ride',
    encodedPolyline: new ArrayBuffer(0),
    representativeActivityId: 'act-1',
    activityIds: ['act-1'],
    visitCount: 3,
    distanceMeters: 1200,
    isLift: false,
    isUserDefined: false,
    disabled: false,
    createdAt: '2026-01-01T00:00:00Z',
  } as unknown as NativeSection;
}

beforeEach(() => {
  jest.clearAllMocks();
  (getEngine as jest.Mock).mockReturnValue({
    getSectionsForActivity: jest.fn(() => []),
    getSectionCount: jest.fn(() => 0),
    getActivityMetricsForIds: jest.fn(() => []),
    getMapSignaturesForIds: jest.fn(() => []),
    subscribe: jest.fn(() => () => {}),
  });
});

describe('useSectionMatches over a rebuilt bundle wrapper', () => {
  const sections = [nativeSection('s1'), nativeSection('s2')];

  it('decodes each matched section once across re-renders', () => {
    const { result, rerender } = renderHook(
      ({ count }: { count: number }) =>
        useSectionMatches('act-1', { sections, sectionCount: count }),
      { initialProps: { count: 2 } }
    );

    const first = result.current.sections;
    expect(first).toHaveLength(2);
    expect(mockDecodeCoords).toHaveBeenCalledTimes(2);

    rerender({ count: 2 });
    rerender({ count: 2 });

    expect(result.current.sections).toBe(first);
    expect(mockDecodeCoords).toHaveBeenCalledTimes(2);
  });

  it('recomputes when the matched sections themselves change', () => {
    const { result, rerender } = renderHook(
      ({ list }: { list: NativeSection[] }) =>
        useSectionMatches('act-1', { sections: list, sectionCount: list.length }),
      { initialProps: { list: sections } }
    );

    const first = result.current.sections;
    rerender({ list: [...sections, nativeSection('s3')] });

    expect(result.current.sections).not.toBe(first);
    expect(result.current.sections).toHaveLength(3);
    expect(mockDecodeCoords).toHaveBeenCalledTimes(5);
  });

  it('holds an empty result stable and reports the bundle count', () => {
    const empty: NativeSection[] = [];
    const { result, rerender } = renderHook(() =>
      useSectionMatches('act-1', { sections: empty, sectionCount: 7 })
    );

    const first = result.current.sections;
    expect(first).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.isReady).toBe(true);

    rerender(undefined);

    expect(result.current.sections).toBe(first);
    expect(mockDecodeCoords).not.toHaveBeenCalled();
  });
});

describe('useSectionOverlays over a rebuilt bundle wrapper', () => {
  const match = {
    section: {
      id: 's1',
      visitCount: 3,
      activityIds: ['act-1'],
      distanceMeters: 1200,
      polyline: [
        { lat: -37.8, lng: 144.9 },
        { lat: -37.81, lng: 144.91 },
      ],
    } as unknown as FrequentSection,
    direction: 'same' as const,
    distance: 1200,
  };
  const matches = [match];
  const noCustom: Section[] = [];
  const coordinates = [
    { latitude: -37.8, longitude: 144.9 },
    { latitude: -37.81, longitude: 144.91 },
  ];
  const sectionTraces = { s1: coordinates };
  const prSectionIds = new Set(['s1']);

  it('returns the same overlays across re-renders that rebuild the wrapper', () => {
    const { result, rerender } = renderHook(() =>
      useSectionOverlays('sections', 'act-1', matches, noCustom, coordinates, {
        sectionTraces,
        prSectionIds,
      })
    );

    const first = result.current.sectionOverlays;
    expect(first).toHaveLength(1);
    expect(first?.[0].isPR).toBe(true);

    rerender(undefined);
    rerender(undefined);

    expect(result.current.sectionOverlays).toBe(first);
  });

  it('recomputes when the record holders change', () => {
    const { result, rerender } = renderHook(
      ({ prs }: { prs: Set<string> }) =>
        useSectionOverlays('sections', 'act-1', matches, noCustom, coordinates, {
          sectionTraces,
          prSectionIds: prs,
        }),
      { initialProps: { prs: prSectionIds } }
    );

    const first = result.current.sectionOverlays;
    rerender({ prs: new Set<string>() });

    expect(result.current.sectionOverlays).not.toBe(first);
    expect(result.current.sectionOverlays?.[0].isPR).toBe(false);
  });
});

describe('useSectionActivityData over a rebuilt bundle wrapper', () => {
  const section = {
    id: 's1',
    sportType: 'Ride',
    activityIds: ['act-1'],
    visitCount: 3,
    distanceMeters: 1200,
  } as unknown as FrequentSection;
  const activityMetrics = [
    {
      activityId: 'act-1',
      name: 'Morning ride',
      date: 1_700_000_000,
      distance: 20_000,
      movingTime: 3600,
      elapsedTime: 3700,
      elevationGain: 120,
      sportType: 'Ride',
      avgHr: 148,
    } as unknown as ActivityMetrics,
  ];
  const mapSignatures = [
    { activityId: 'act-1', encodedCoords: new ArrayBuffer(0) } as unknown as FfiMapSignature,
  ];

  it('decodes each signature once across re-renders', () => {
    const { result, rerender } = renderHook(
      ({ sport }: { sport: string | undefined }) =>
        useSectionActivityData(section, sport, { activityMetrics, mapSignatures }),
      { initialProps: { sport: undefined as string | undefined } }
    );

    const first = result.current.allActivityTraces;
    expect(first?.['act-1']).toHaveLength(2);
    expect(mockDecodeCoords).toHaveBeenCalledTimes(1);

    rerender({ sport: undefined });
    rerender({ sport: undefined });

    expect(result.current.allActivityTraces).toBe(first);
    expect(mockDecodeCoords).toHaveBeenCalledTimes(1);
  });

  it('does not re-decode when only the sport filter changes', () => {
    const { result, rerender } = renderHook(
      ({ sport }: { sport: string | undefined }) =>
        useSectionActivityData(section, sport, { activityMetrics, mapSignatures }),
      { initialProps: { sport: undefined as string | undefined } }
    );

    const first = result.current.allActivityTraces;
    rerender({ sport: 'Run' });

    expect(result.current.allActivityTraces).toBe(first);
    expect(result.current.filteredActivities).toEqual([]);
    expect(mockDecodeCoords).toHaveBeenCalledTimes(1);
  });

  it('re-decodes when the signatures change', () => {
    const { result, rerender } = renderHook(
      ({ sigs }: { sigs: FfiMapSignature[] }) =>
        useSectionActivityData(section, undefined, { activityMetrics, mapSignatures: sigs }),
      { initialProps: { sigs: mapSignatures } }
    );

    const first = result.current.allActivityTraces;
    rerender({
      sigs: [
        ...mapSignatures,
        { activityId: 'act-2', encodedCoords: new ArrayBuffer(0) } as unknown as FfiMapSignature,
      ],
    });

    expect(result.current.allActivityTraces).not.toBe(first);
    expect(mockDecodeCoords).toHaveBeenCalledTimes(3);
  });
});
