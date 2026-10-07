/**
 * Scenario: a settled pan or zoom on the regional map only records the camera.
 *
 * Expected behaviour: no engine query runs, however large the library.
 */

import { renderHook, act } from '@testing-library/react-native';
import React from 'react';

import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import type { MapSurfaceRef } from '@/features/maps/components/MapSurface';
import type { ActivityBoundsItem } from '@/types';

const mockEngine = {
  getActivityCount: jest.fn(() => 2000),
  queryViewport: jest.fn(() => ['a0']),
};

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
    date: '2026-09-01T06:00:00.000Z',
    distance: 30_000,
    duration: 3_600,
    startPoint: [46.5, 6.6],
  }));
}

function settle(count: number, zooms: number[]) {
  const rendered = renderHook(() =>
    useMapHandlers({
      activities: library(count),
      selected: null,
      setSelected: jest.fn(),
      setSelectedSectionId: jest.fn(),
      setSectionChoices: jest.fn(),
      showActivities: true,
      setShowActivities: jest.fn(),
      showSections: true,
      setShowSections: jest.fn(),
      showRoutes: true,
      setShowRoutes: jest.fn(),
      setSelectedRoute: jest.fn(),
      userLocation: null,
      setUserLocation: jest.fn(),
      setLocationLoading: jest.fn(),
      currentZoomRef: { current: zooms[0] },
      currentCenterRef: { current: [6.6, 46.5] },
      surfaceRef: { current: null } as React.RefObject<MapSurfaceRef | null>,
      map3DRef: { current: null } as React.RefObject<null>,
      bearingAnim: { setValue: jest.fn() } as never,
      currentZoomLevel: { current: zooms[0] },
      is3DMode: false,
      markUserInteracted: jest.fn(),
      setSpider: jest.fn(),
    } as never)
  );
  for (const zoom of zooms) {
    act(() => {
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
    mockEngine.queryViewport.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('queries no viewport on a library of 2,000 activities', () => {
    settle(2000, [10, 10.5]);
    expect(mockEngine.queryViewport).not.toHaveBeenCalled();
  });

  it('queries no viewport when crossing zoom 11 on five activities', () => {
    settle(5, [10, 12, 10]);
    expect(mockEngine.queryViewport).not.toHaveBeenCalled();
  });
});
