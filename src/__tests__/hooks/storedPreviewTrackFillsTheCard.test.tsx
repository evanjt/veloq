/**
 * Scenario: a fresh install. The bulk GPS run stores the head's tracks within
 * seconds of the head window landing, and the engine announces each one on
 * `gpsTrackStored`. Nothing in the feed was listening: only `gpsTracksMutated`
 * had a subscriber, and that names a track that was *replaced*. So a card sat
 * without a map until its own duplicate body arrived or the sync moved on.
 *
 * Expected behaviour: a stored track re-reads that one card's preview line and
 * no other's, the way a mutated one already does.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useMapPreviewCoordinates,
  useMutatedPreviewTracks,
  useStoredPreviewTracks,
} from '@/features/activity/hooks/useMapPreviewCoordinates';
import { getEngine } from '@/shared/native/engine';
import { decodeCoords } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => require('@/shared/native/engine').getEngine(),
}));

type Payload = { activityIds?: string[]; activityId?: string };
const listeners = new Map<string, Set<(payload?: Payload) => void>>();

const engine = {
  getPreviewTrack: jest.fn(() => ({ encodedCoords: 'xx' })),
  subscribe: jest.fn((event: string, cb: (payload?: Payload) => void) => {
    const set = listeners.get(event) ?? new Set<typeof cb>();
    listeners.set(event, set);
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }),
};

function announceStored(activityId: string) {
  listeners.get('gpsTrackStored')?.forEach((cb) => cb({ activityId }));
}

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockDecode = decodeCoords as jest.MockedFunction<typeof decodeCoords>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A card and both app-lifetime subscribers, as the app mounts them. */
function useCard(activityId: string, startupTrack?: undefined | { coordinates: []; altitude: [] }) {
  useMutatedPreviewTracks();
  useStoredPreviewTracks();
  return useMapPreviewCoordinates(activityId, true, startupTrack as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  mockDecode.mockReturnValue([{ latitude: 46.2, longitude: 7.3 }]);
});

afterEach(() => client.clear());

it('re-reads the card whose track has just been stored', async () => {
  // No line yet, which is a head card the moment before the bulk run reaches it.
  engine.getPreviewTrack.mockReturnValueOnce(null as never);
  const { result } = renderHook(() => useCard('a1'), { wrapper });

  await waitFor(() => expect(engine.getPreviewTrack).toHaveBeenCalledTimes(1));
  expect(result.current.coordinates).toHaveLength(0);

  await act(async () => {
    announceStored('a1');
  });

  await waitFor(() => expect(result.current.coordinates).toHaveLength(1));
});

it('leaves every other card alone', async () => {
  const { result } = renderHook(() => useCard('a1'), { wrapper });

  await waitFor(() => expect(result.current.coordinates).toHaveLength(1));
  expect(engine.getPreviewTrack).toHaveBeenCalledTimes(1);
  const held = result.current.coordinates;

  await act(async () => {
    announceStored('a2');
  });

  expect(engine.getPreviewTrack).toHaveBeenCalledTimes(1);
  expect(result.current.coordinates).toBe(held);
});

it('does not read for a card the startup bundle already filled', async () => {
  renderHook(() => useCard('a1', { coordinates: [], altitude: [] }), { wrapper });

  await act(async () => {
    announceStored('a1');
  });

  expect(engine.getPreviewTrack).not.toHaveBeenCalled();
});

it('costs nothing when the announcement names no activity', async () => {
  renderHook(() => useCard('a1'), { wrapper });
  await waitFor(() => expect(engine.getPreviewTrack).toHaveBeenCalledTimes(1));

  await act(async () => {
    listeners.get('gpsTrackStored')?.forEach((cb) => cb(undefined));
  });

  expect(engine.getPreviewTrack).toHaveBeenCalledTimes(1);
});
