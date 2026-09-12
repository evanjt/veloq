/**
 * Scenario: the sync tree mounts at launch beside every other reader of the
 * activity window.
 * Expected behaviour: it invalidates nothing before the engine has spoken, it
 * writes no metrics Rust already stored with the page, and a route-settings
 * change does not re-render it.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { GlobalDataSync } from '@/shared/app/GlobalDataSync';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { IDLE_EXTENDED_FETCH, isExtendedFetchRunning } from '@/shared/app/extendedFetch';
import { SyncState } from 'veloqrs';
import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { useActivities } from '@/features/activity/hooks';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/features/activity/hooks', () => ({
  useActivities: jest.fn(() => ({ data: [], isFetching: false })),
  useActivityBoundsCache: jest.fn(() => ({ progress: { status: 'idle' } })),
}));
jest.mock('@/features/routes/hooks/useRouteDataSync', () => ({
  useRouteDataSync: jest.fn(() => ({ progress: { status: 'idle' }, isSyncing: false })),
}));
jest.mock('@/features/routes/hooks/useSectionHealthCheck', () => ({
  useSectionHealthCheck: jest.fn(),
}));
jest.mock('@/shared/native/useEngineSync', () => ({ useEngineSync: jest.fn() }));
jest.mock('@/shared/native/useSyncAuthExpiry', () => ({ useSyncAuthExpiry: jest.fn() }));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/features/settings/lib/notificationService', () => ({
  updateSyncNotification: jest.fn(),
  dismissSyncNotification: jest.fn(),
}));
jest.mock('@/features/settings/lib/autobackup', () => ({ onSyncComplete: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const mockUseActivities = useActivities as jest.MockedFunction<typeof useActivities>;
const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

/** What `useSyncStatus` reads, and the listeners it registers for a re-read. */
let syncing = false;
const syncListeners: (() => void)[] = [];

function announceSync(nowSyncing: boolean) {
  syncing = nowSyncing;
  syncListeners.forEach((listener) => listener());
}

const engine = {
  setActivityMetrics: jest.fn(),
  triggerRefresh: jest.fn(),
  getAvailableSportTypes: jest.fn(() => []),
  getPaceCurve: jest.fn(() => null),
  syncPaceCurve: jest.fn(),
  savePaceSnapshot: jest.fn(),
  getSyncStatus: jest.fn(() => ({ state: syncing ? SyncState.Syncing : SyncState.Idle })),
  subscribe: jest.fn((_channel: string, listener: () => void) => {
    syncListeners.push(listener);
    return () => {};
  }),
};

let client: QueryClient;

function renderSyncTree() {
  return render(
    React.createElement(QueryClientProvider, { client }, React.createElement(GlobalDataSync))
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  mockUseActivities.mockReturnValue({ data: [], isFetching: false } as unknown as ReturnType<
    typeof useActivities
  >);
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  syncListeners.length = 0;
  syncing = false;
  useSyncDateRange.setState({ extendedFetch: IDLE_EXTENDED_FETCH });
});

afterEach(() => {
  client.clear();
});

describe('GlobalDataSync', () => {
  it('invalidates nothing on mount, leaving the engine event as the rule', () => {
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    const reset = jest.spyOn(client, 'resetQueries');

    renderSyncTree();

    expect(invalidate).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('writes no metrics back for a page Rust already stored', () => {
    mockUseActivities.mockReturnValue({
      data: [
        {
          id: 'a1',
          name: 'Ride',
          start_date_local: '2026-01-01T08:00:00',
          type: 'Ride',
          icu_training_load: 80,
          icu_ftp: 250,
        },
      ],
      isFetching: false,
    } as unknown as ReturnType<typeof useActivities>);

    renderSyncTree();

    expect(engine.setActivityMetrics).not.toHaveBeenCalled();
  });

  it('keeps the widened range running while the engine still holds the slot', () => {
    renderSyncTree();

    act(() => {
      useSyncDateRange.getState().windowAccepted();
      announceSync(true);
    });

    // The SQLite read behind the feed settles in milliseconds. It used to be
    // what this flag followed, which cleared every banner named after a
    // download that was still seconds from finishing.
    act(() => {
      mockUseActivities.mockReturnValue({ data: [], isFetching: false } as unknown as ReturnType<
        typeof useActivities
      >);
    });

    expect(isExtendedFetchRunning(useSyncDateRange.getState().extendedFetch)).toBe(true);

    act(() => announceSync(false));

    expect(isExtendedFetchRunning(useSyncDateRange.getState().extendedFetch)).toBe(false);
  });

  it('does not re-render when route settings change', () => {
    renderSyncTree();
    const rendersAtMount = mockUseActivities.mock.calls.length;

    act(() => {
      useRouteSettings.setState({ isLoaded: true });
    });

    expect(mockUseActivities.mock.calls.length).toBe(rendersAtMount);
  });
});
