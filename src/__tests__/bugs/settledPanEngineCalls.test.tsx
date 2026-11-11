/**
 * Scenario: a settled pan or zoom on the regional map only records the camera.
 *
 * Expected behaviour: no engine read runs, however large the library.
 */

import { renderHook, act } from '@testing-library/react-native';
import React from 'react';

import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import type { MapSurfaceRef } from '@/features/maps/components/MapSurface';
import type { ActivityBoundsItem } from '@/types';

const mockUnexpectedCalls: string[] = [];
const mockEngine = new Proxy({ getActivityCount: jest.fn(() => 2000) } as Record<string, unknown>, {
  get: (target, name: string) =>
    name in target
      ? target[name]
      : () => {
          // Recording the camera is a settings write; anything else is a read.
          if (!name.startsWith('set')) mockUnexpectedCalls.push(name);
        },
});

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { Balanced: 3 },
}));

function library(count: number): ActivityBoundsItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    bounds: [
      [46.5, 6.6],
      [46.51, 6.61],
    ],
    type: 'Ride' as ActivityBoundsItem['type'],
    name: `a${i}`,
    date: Date.UTC(2026, 8, 1, 6, 0, 0) / 1000,
    distance: 30_000,
    duration: 3_600,
    startPoint: [46.5, 6.6],
  }));
}

async function settle(count: number, zooms: number[]) {
  const rendered = await renderHook(() =>
    useMapHandlers({
      activities: library(count),
      selected: null,
      setSelected: jest.fn(),
      setSelectedSectionId: jest.fn(),
      chooseSection: jest.fn(),
      showActivities: true,
      setShowActivities: jest.fn(),
      showSections: true,
      setShowSections: jest.fn(),
      showRoutes: true,
      setShowRoutes: jest.fn(),
      setSelectedRouteId: jest.fn(),
      userLocation: null,
      setUserLocation: jest.fn(),
      setLocationLoading: jest.fn(),
      currentZoomRef: { current: zooms[0] },
      currentCenterRef: { current: [6.6, 46.5] },
      surfaceRef: { current: null } as React.RefObject<MapSurfaceRef | null>,
      bearingAnim: { setValue: jest.fn() } as never,
      currentZoomLevel: { current: zooms[0] },
      markUserInteracted: jest.fn(),
      setSpider: jest.fn(),
    } as never)
  );
  for (const zoom of zooms) {
    await act(() => {
      rendered.result.current.handleRegionDidChange({
        zoom,
        center: [6.6 + zoom / 100, 46.5],
        bounds: { sw: [6.5, 46.4], ne: [6.7, 46.6] },
      } as never);
      jest.runAllTimers();
    });
  }
}

describe('a settled region change', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUnexpectedCalls.length = 0;
  });
  afterEach(() => jest.useRealTimers());

  it('makes no engine read on a library of 2,000 activities', async () => {
    await settle(2000, [10, 10.5]);
    expect(mockUnexpectedCalls).toEqual([]);
  });

  it('makes no engine read when crossing zoom 11 on five activities', async () => {
    await settle(5, [10, 12, 10]);
    expect(mockUnexpectedCalls).toEqual([]);
  });
});
