/**
 * Scenario: the athlete picks an activity from the map's name search.
 *
 * Expected behaviour: the popup opens for it and the camera fits its bounds,
 * so a ride far from the current view is brought on screen.
 */

import { renderHook, act } from '@testing-library/react-native';
import React from 'react';

import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import type { MapSurfaceRef } from '@/features/maps/components/MapSurface';
import type { ActivityBoundsItem } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const ventoux: ActivityBoundsItem = {
  id: 'a-ventoux',
  bounds: [
    [44.1, 5.2],
    [44.2, 5.3],
  ],
  type: 'Ride',
  name: 'Mont Ventoux',
  date: '2026-04-10T08:00:00Z',
  distance: 60_000,
  duration: 12_000,
};

function mount(surface: Partial<MapSurfaceRef>, setSelected = jest.fn()) {
  const ref = { fitBounds: jest.fn(), setCamera: jest.fn(), ...surface } as MapSurfaceRef;
  const rendered = renderHook(() =>
    useMapHandlers({
      activities: [ventoux],
      selected: null,
      setSelected,
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
      currentZoomRef: { current: 8 },
      currentCenterRef: { current: [7, 46] },
      surfaceRef: { current: ref } as React.RefObject<MapSurfaceRef | null>,
      map3DRef: { current: null } as React.RefObject<null>,
      bearingAnim: { setValue: jest.fn() } as never,
      currentZoomLevel: { current: 8 },
      is3DMode: false,
      markUserInteracted: jest.fn(),
      setSpider: jest.fn(),
    } as never)
  );
  return { rendered, ref, setSelected };
}

describe('handleFocusActivity', () => {
  it('opens the popup and fits the camera to the activity bounds', () => {
    const { rendered, ref, setSelected } = mount({});

    act(() => {
      rendered.result.current.handleFocusActivity(ventoux);
    });

    expect(setSelected).toHaveBeenCalledWith(
      expect.objectContaining({ activity: ventoux, isLoading: true })
    );
    expect(ref.fitBounds).toHaveBeenCalledTimes(1);
    expect((ref.fitBounds as jest.Mock).mock.calls[0][0]).toEqual({
      sw: [5.2, 44.1],
      ne: [5.3, 44.2],
    });
  });
});
