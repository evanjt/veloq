/**
 * Scenario: a marker tap opens the popup at once and reads the track on the
 * next frame. Back, or a tap on bare terrain, inside that frame dismissed the
 * popup, and the frame then wrote the popup back with the track in it.
 *
 * Expected behaviour: the frame fills in the popup that is on screen, and
 * writes nothing once it has been dismissed or another marker has taken its
 * place.
 */

import { act, renderHook } from '@testing-library/react-native';
import React, { useState } from 'react';

import type { SelectedActivity } from '@/features/maps/components/regional/ActivityPopup';
import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import type { MapSurfaceRef } from '@/features/maps/components/MapSurface';
import type { ActivityBoundsItem } from '@/types';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { latitude: 44.1, longitude: 5.2 },
      { latitude: 44.2, longitude: 5.3 },
    ],
  })
);
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getGpsTrack: () => 'encoded', startFetchAndStore: jest.fn() }),
}));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

function ride(id: string): ActivityBoundsItem {
  return {
    id,
    bounds: [
      [44.1, 5.2],
      [44.2, 5.3],
    ],
    type: 'Ride',
    name: `Ride ${id}`,
    date: '2026-04-10T08:00:00Z',
    distance: 60_000,
    duration: 12_000,
  };
}

const first = ride('a-first');
const second = ride('a-second');

let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function runFrames() {
  const pending = frames;
  frames = [];
  await act(() => {
    for (const frame of pending) frame(0);
  });
}

async function mountHandlers() {
  const surface = { fitBounds: jest.fn(), setCamera: jest.fn() } as unknown as MapSurfaceRef;
  return renderHook(() => {
    const [selected, setSelected] = useState<SelectedActivity | null>(null);
    const handlers = useMapHandlers({
      activities: [first, second],
      selected,
      setSelected,
      setSelectedSectionId: jest.fn(),
      chooseSection: jest.fn(),
      showActivities: true,
      setShowActivities: jest.fn(),
      showSections: true,
      setShowSections: jest.fn(),
      showRoutes: true,
      setShowRoutes: jest.fn(),
      setSelectedRouteId: jest.fn(),
      currentZoomRef: { current: 8 },
      currentCenterRef: { current: [7, 46] },
      surfaceRef: { current: surface } as React.RefObject<MapSurfaceRef | null>,
      map3DRef: { current: null },
      bearingAnim: { setValue: jest.fn() } as never,
      currentZoomLevel: { current: 8 },
      is3DMode: false,
      markUserInteracted: jest.fn(),
      setSpider: jest.fn(),
    });
    return { selected, handlers };
  });
}

it('fills in the track for the popup still on screen', async () => {
  const { result } = await mountHandlers();

  await act(() => result.current.handlers.handleMarkerTap(first));
  expect(result.current.selected).toEqual(expect.objectContaining({ isLoading: true }));

  await runFrames();

  expect(result.current.selected?.activity.id).toBe('a-first');
  expect(result.current.selected?.isLoading).toBe(false);
  expect(result.current.selected?.routeCoords).toHaveLength(2);
});

it('leaves the popup closed when it is dismissed before the frame', async () => {
  const { result } = await mountHandlers();

  await act(() => result.current.handlers.handleMarkerTap(first));
  await act(() => result.current.handlers.handleClosePopup());
  await runFrames();

  expect(result.current.selected).toBeNull();
});

it('keeps the second marker when it is tapped before the first frame', async () => {
  const { result } = await mountHandlers();

  await act(() => result.current.handlers.handleMarkerTap(first));
  await act(() => result.current.handlers.handleMarkerTap(second));
  const [firstFrame, secondFrame] = frames;
  frames = [];

  await act(() => firstFrame?.(0));
  expect(result.current.selected?.activity.id).toBe('a-second');
  expect(result.current.selected?.isLoading).toBe(true);

  await act(() => secondFrame?.(0));
  expect(result.current.selected?.activity.id).toBe('a-second');
  expect(result.current.selected?.isLoading).toBe(false);
});
