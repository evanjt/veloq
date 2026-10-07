/**
 * Scenario: the feed's preview line is the stored route signature, and a
 * re-ingest can replace the track it is cut from. The read was keyed on the
 * coarse `activities` trigger, so every mounted card re-read its own track and
 * handed back a new array whenever anything in the library moved.
 *
 * Expected behaviour: the read is keyed on the activity, and only an
 * announcement naming that activity makes it read again.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useMapPreviewCoordinates,
  useMutatedPreviewTracks,
} from '@/features/activity/hooks/useMapPreviewCoordinates';
import { getEngine } from '@/shared/native/engine';
import { decodeCoords } from 'veloqrs';
import { deleteTerrainPreviewsForActivity } from '@/features/maps';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => require('@/shared/native/engine').getEngine(),
}));
jest.mock('@/features/maps', () => ({
  deleteTerrainPreviewsForActivity: jest.fn().mockResolvedValue(undefined),
}));

const listeners = new Map<string, Set<(payload?: { activityIds: string[] }) => void>>();

const engine = {
  getPreviewTrack: jest.fn(() => ({ encodedCoords: 'xx' })),
  subscribe: jest.fn((event: string, cb: (payload?: { activityIds: string[] }) => void) => {
    const set = listeners.get(event) ?? new Set<typeof cb>();
    listeners.set(event, set);
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }),
};

function announceMutated(activityIds: string[]) {
  listeners.get('gpsTracksMutated')?.forEach((cb) => cb({ activityIds }));
}

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockDecode = decodeCoords as jest.MockedFunction<typeof decodeCoords>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A card and the app-lifetime subscriber, as the app mounts them. */
function useCard(activityId: string) {
  useMutatedPreviewTracks();
  return useMapPreviewCoordinates(activityId, true, undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  mockDecode.mockReturnValue([
    { latitude: 46.2, longitude: 7.3 },
    { latitude: 46.21, longitude: 7.31 },
  ]);
});

afterEach(() => {
  client.clear();
});

it('reads the preview line once and holds it', async () => {
  const { result, rerender } = renderHook(() => useCard('a1'), { wrapper });

  await waitFor(() => expect(result.current.coordinates).toHaveLength(2));
  expect(engine.getPreviewTrack).toHaveBeenCalledTimes(1);

  const first = result.current.coordinates;
  await act(async () => {
    rerender({});
  });

  expect(engine.getPreviewTrack).toHaveBeenCalledTimes(1);
  expect(result.current.coordinates).toBe(first);
});

it('re-reads the activity whose track was replaced', async () => {
  const { result } = renderHook(() => useCard('a1'), { wrapper });

  await waitFor(() => expect(engine.getPreviewTrack).toHaveBeenCalledTimes(1));

  mockDecode.mockReturnValue([
    { latitude: 47.5, longitude: 7.3 },
    { latitude: 47.51, longitude: 7.31 },
    { latitude: 47.52, longitude: 7.32 },
  ]);
  await act(async () => {
    announceMutated(['a1']);
  });

  await waitFor(() => expect(result.current.coordinates).toHaveLength(3));
  expect(engine.getPreviewTrack).toHaveBeenCalledTimes(2);
  expect(deleteTerrainPreviewsForActivity).toHaveBeenCalledWith('a1');
});

it('leaves every other card alone', async () => {
  const { result } = renderHook(() => useCard('a1'), { wrapper });

  // On the render where the read has been called once the coordinates are
  // still empty, so holding the array here holds the empty one and the
  // identity claim below is about nothing. Settle on the array itself.
  await waitFor(() => expect(result.current.coordinates).toHaveLength(2));
  expect(engine.getPreviewTrack).toHaveBeenCalledTimes(1);
  const held = result.current.coordinates;

  await act(async () => {
    announceMutated(['a2', 'a3']);
  });

  expect(engine.getPreviewTrack).toHaveBeenCalledTimes(1);
  expect(result.current.coordinates).toBe(held);
  expect(deleteTerrainPreviewsForActivity).toHaveBeenCalledWith('a2');
  expect(deleteTerrainPreviewsForActivity).toHaveBeenCalledWith('a3');
});
