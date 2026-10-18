/**
 * Scenario: every stored page announces `activities`, and the sync tree used
 * to answer each announcement by reading and parsing every activity body in
 * the athlete's whole window, to use only its length and its identity.
 *
 * Expected behaviour: a live library runs one route sync pass per
 * announcement from the engine's own candidate read and reads no feed card.
 * Demo mode pulls no census, so its pass reads the fixtures' cards.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';
import { feedCard } from '../__shared__/feedCard';

import { GlobalDataSync } from '@/shared/app/GlobalDataSync';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { resetGlobalSyncState } from '@/features/routes/hooks/useRouteSyncContext';
import { getEngine, getNativeModule } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(), getNativeModule: jest.fn() }));
jest.mock('@/shared/native/useEngineSync', () => ({ useEngineSync: jest.fn() }));
jest.mock('@/shared/native/useSyncAuthExpiry', () => ({ useSyncAuthExpiry: jest.fn() }));
jest.mock('@/shared/native/usePushedWritesOnForeground', () => ({
  usePushedWritesOnForeground: jest.fn(),
}));
jest.mock('@/features/strength/hooks/useExerciseSets', () => ({ useStrengthReconnect: jest.fn() }));
jest.mock('@/features/activity/hooks/useMapPreviewCoordinates', () => ({
  useMutatedPreviewTracks: jest.fn(),
  useStoredPreviewTracks: jest.fn(),
}));
jest.mock('@/features/routes/hooks/useSectionHealthCheck', () => ({
  useSectionHealthCheck: jest.fn(),
}));
jest.mock('@/features/settings/lib/notificationService', () => ({
  updateSyncNotification: jest.fn(),
  dismissSyncNotification: jest.fn(),
}));
jest.mock('@/features/settings/lib/autobackup', () => ({
  onSyncComplete: jest.fn(),
  onBackupReconnect: jest.fn(),
}));
jest.mock('@/features/routes/lib/timeStreamBackfill', () => ({
  backfillTimeStreams: jest.fn(async () => ({ total: 0, remaining: 0 })),
  timeStreamsProgress: jest.fn(),
}));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
const mockFetchApiGps = jest.fn(async (..._args: unknown[]) => undefined);
const mockFetchDemoGps = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock('@/features/routes/hooks/useGpsDataFetcher', () => ({
  useGpsDataFetcher: () => ({ fetchDemoGps: mockFetchDemoGps, fetchApiGps: mockFetchApiGps }),
}));

const listeners = new Map<string, Set<() => void>>();

function announce(channel: string) {
  listeners.get(channel)?.forEach((listener) => listener());
}

const fixtureCards = [
  feedCard({ id: 'kite-1', sportType: 'Ride', hasGps: true }),
  feedCard({ id: 'kite-2', sportType: 'Run', hasGps: false }),
];

const fakeEngine = {
  getFeedCards: jest.fn((_oldest: number, _newest: number) => fixtureCards),
  // No track has landed yet, which is when a first sync owes its pass.
  getActivityCount: jest.fn(() => 0),
  getStats: jest.fn(() => ({ libraryCount: 2 })),
  getActivityIds: jest.fn((): string[] => []),
  getGpsFetchCandidates: jest.fn((_oldest: string, _newest: string) => []),
  getUnprocessedStrengthIds: jest.fn((): string[] => []),
  batchFetchOwedFitFiles: jest.fn(() => 0),
  pollSectionDetection: jest.fn(() => 'idle'),
  getSectionDetectionProgress: jest.fn(() => null),
  syncActivitiesWindow: jest.fn(() => 'notOwed'),
  getSyncStatus: jest.fn(() => null),
  triggerRefresh: jest.fn(),
  subscribe: jest.fn((channel: string, listener: () => void) => {
    const set = listeners.get(channel) ?? new Set();
    set.add(listener);
    listeners.set(channel, set);
    return () => set.delete(listener);
  }),
};

let client: QueryClient;
let idle: IdleScheduler;

async function mountSyncTree() {
  await render(
    React.createElement(QueryClientProvider, { client }, React.createElement(GlobalDataSync))
  );
  await act(async () => {});
  await act(async () => {});
}

async function announceActivities() {
  await act(async () => {
    announce('activities');
  });
  await act(async () => {});
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  resetGlobalSyncState();
  idle = stubIdleScheduler('immediate');
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  fakeEngine.getStats.mockReturnValue({ libraryCount: 2 });
  fakeEngine.getFeedCards.mockReturnValue(fixtureCards);
  (getEngine as jest.Mock).mockReturnValue(fakeEngine);
  (getNativeModule as jest.Mock).mockReturnValue({ engine: fakeEngine });
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false, athleteId: 'i1' });
  useSyncDateRange.setState({ oldest: '2026-01-01', newest: '2026-03-31' });
});

afterEach(() => {
  idle.restore();
  client.clear();
});

describe('the sync tree on an activities announcement', () => {
  it('runs one route pass per announcement and reads no feed card', async () => {
    await mountSyncTree();
    const passesAtMount = fakeEngine.getGpsFetchCandidates.mock.calls.length;
    expect(passesAtMount).toBe(1);

    await announceActivities();
    await announceActivities();
    await announceActivities();

    expect(fakeEngine.getGpsFetchCandidates).toHaveBeenCalledTimes(passesAtMount + 3);
    expect(fakeEngine.getGpsFetchCandidates).toHaveBeenLastCalledWith('2026-01-01', '2026-03-31');
    expect(fakeEngine.getFeedCards).not.toHaveBeenCalled();
  });

  it('still asks the engine for the selected window', async () => {
    await mountSyncTree();

    expect(fakeEngine.syncActivitiesWindow).toHaveBeenCalledWith('2026-01-01', '2026-03-31');
  });

  it('runs no pass while the library is empty', async () => {
    fakeEngine.getStats.mockReturnValue({ libraryCount: 0 });
    fakeEngine.getFeedCards.mockReturnValue([]);
    await mountSyncTree();
    await announceActivities();

    expect(fakeEngine.getGpsFetchCandidates).not.toHaveBeenCalled();
  });

  it('hands the demo fixtures from the feed cards to the demo download', async () => {
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: true, athleteId: 'demo' });
    await mountSyncTree();
    mockFetchDemoGps.mockClear();

    await announceActivities();

    expect(fakeEngine.getFeedCards).toHaveBeenCalled();
    expect(fakeEngine.getGpsFetchCandidates).not.toHaveBeenCalled();
    const handed = mockFetchDemoGps.mock.calls[0]?.[0] as { activityId: string }[];
    expect(handed.map((c) => c.activityId)).toEqual(['kite-1']);
  });
});
