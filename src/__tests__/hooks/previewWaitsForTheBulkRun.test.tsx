/**
 * Scenario: a first launch. The head cards mount with no preview line, so each
 * one asks the engine for its own `latlng` and `altitude` body on the
 * Interactive lane, while the bulk GPS run is fetching the same track for the
 * same ids off the same endpoint. Two downloads per card, and the per-card one
 * competes with the run for the lane the rest of the app's taps use.
 *
 * Expected behaviour: a card whose id the run already holds asks for nothing.
 * It is filled by the track's own arrival. A card outside the run asks as it
 * always did, and so does the same card once the run has ended without
 * bringing it a line.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useMapPreviewCoordinates } from '@/features/activity/hooks/useMapPreviewCoordinates';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { getEngine } from '@/shared/native/engine';
import { requestStreams } from '@/features/activity/lib/engineStreams';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => require('@/shared/native/engine').getEngine(),
}));
jest.mock('@/features/activity/lib/engineStreams', () => ({
  ...jest.requireActual('@/features/activity/lib/engineStreams'),
  readStreams: jest.fn(() => null),
  requestStreams: jest.fn(),
}));

const engine = {
  // No stored line, which is every head card before the run reaches it.
  getPreviewTrack: jest.fn(() => null),
  getBodiesStored: jest.fn(() => 0),
  subscribe: jest.fn(() => () => {}),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;
const mockRequestStreams = requestStreams as jest.MockedFunction<typeof requestStreams>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function pending(ids: string[]) {
  useSyncDateRange.getState().setGpsSyncPendingIds(ids);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  pending([]);
});

afterEach(() => {
  client.clear();
  pending([]);
});

it('asks for nothing while the bulk run holds the same id', async () => {
  pending(['a1', 'a2']);

  renderHook(() => useMapPreviewCoordinates('a1', true, undefined), { wrapper });

  await waitFor(() => expect(engine.getPreviewTrack).toHaveBeenCalled());
  expect(mockRequestStreams).not.toHaveBeenCalled();
});

it('asks as before for a card the run does not cover', async () => {
  pending(['a2']);

  renderHook(() => useMapPreviewCoordinates('a1', true, undefined), { wrapper });

  await waitFor(() => expect(mockRequestStreams).toHaveBeenCalledWith('a1', expect.anything()));
});

it('asks once the run ends with no line stored', async () => {
  pending(['a1']);

  renderHook(() => useMapPreviewCoordinates('a1', true, undefined), { wrapper });
  await waitFor(() => expect(engine.getPreviewTrack).toHaveBeenCalled());
  expect(mockRequestStreams).not.toHaveBeenCalled();

  useSyncDateRange.getState().setGpsSyncProgress({
    status: 'complete',
    completed: 1,
    total: 1,
    percent: 100,
    message: '',
  });

  await waitFor(() => expect(mockRequestStreams).toHaveBeenCalledWith('a1', expect.anything()));
});

it('opens the gate for good when a run ends without publishing a status', async () => {
  // An aborted run skips its progress update, so the store never sees a
  // terminal status. The run clears its own ids on the way out for exactly
  // this: a gate left standing is a card that never asks for a map again.
  pending(['a1']);
  useSyncDateRange.getState().setGpsSyncPendingIds([]);

  renderHook(() => useMapPreviewCoordinates('a1', true, undefined), { wrapper });

  await waitFor(() => expect(mockRequestStreams).toHaveBeenCalledWith('a1', expect.anything()));
});

it('asks for nothing for a card the startup bundle already filled', async () => {
  renderHook(
    () => useMapPreviewCoordinates('a1', true, { coordinates: [], altitude: [] } as never),
    { wrapper }
  );

  await waitFor(() => expect(engine.getPreviewTrack).not.toHaveBeenCalled());
  expect(mockRequestStreams).not.toHaveBeenCalled();
});
