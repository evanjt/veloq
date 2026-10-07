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
import {
  IDLE_EXTENDED_FETCH,
  PICKUP_DEADLINE_MS,
  isExtendedFetchRunning,
} from '@/shared/app/extendedFetch';
import { SyncState } from 'veloqrs';
import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
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
// The tree mounts under NetworkProvider in the app. Here only the value the
// reconnect subscribers read is needed, not the NetInfo listener behind it.
jest.mock('@/shared/app/NetworkContext', () => ({
  ...jest.requireActual('@/shared/app/NetworkContext'),
  useNetwork: () => ({ isOnline: true }),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const mockUseActivities = useActivities as jest.MockedFunction<typeof useActivities>;
const mockUseRouteDataSync = useRouteDataSync as jest.MockedFunction<typeof useRouteDataSync>;
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
  getAvailableSportTypes: jest.fn((): string[] => []),
  getPaceCurve: jest.fn((): { criticalSpeed: number; endDate: string } | null => null),
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
  mockUseRouteDataSync.mockReturnValue({ progress: { status: 'idle' } } as ReturnType<
    typeof useRouteDataSync
  >);
  engine.getAvailableSportTypes.mockReturnValue([]);
  engine.getPaceCurve.mockReturnValue(null);
  mockUseActivities.mockReturnValue({ data: [], isFetching: false } as unknown as ReturnType<
    typeof useActivities
  >);
  mockUseRouteDataSync.mockReturnValue({
    progress: { status: 'idle' },
    isSyncing: false,
  } as unknown as ReturnType<typeof useRouteDataSync>);
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
  syncListeners.length = 0;
  syncing = false;
  useSyncDateRange.setState({ extendedFetch: IDLE_EXTENDED_FETCH });
});

afterEach(() => {
  client.clear();
});

describe('GlobalDataSync', () => {
  it.each([
    [['TrailRun'], 'Run'],
    [['OpenWaterSwim'], 'Swim'],
  ])('leaves the %s variant library curve for %s to Rust', (sportTypes) => {
    mockUseRouteDataSync.mockReturnValue({ progress: { status: 'complete' } } as ReturnType<
      typeof useRouteDataSync
    >);
    engine.getAvailableSportTypes.mockReturnValue(sportTypes);
    engine.getPaceCurve.mockReturnValue({ criticalSpeed: 3.5, endDate: '2026-08-20' });

    renderSyncTree();

    expect(mockUseRouteDataSync).toHaveBeenCalled();
    expect(engine.savePaceSnapshot).not.toHaveBeenCalled();
    expect(engine.syncPaceCurve).not.toHaveBeenCalled();
  });

  it('leaves both canonical curves to Rust for plain and variant sports', () => {
    mockUseRouteDataSync.mockReturnValue({ progress: { status: 'complete' } } as ReturnType<
      typeof useRouteDataSync
    >);
    engine.getAvailableSportTypes.mockReturnValue(['Run', 'TrailRun', 'Swim', 'OpenWaterSwim']);
    engine.getPaceCurve.mockReturnValue({ criticalSpeed: 3.5, endDate: '2026-08-20' });

    renderSyncTree();

    expect(mockUseRouteDataSync).toHaveBeenCalled();
    expect(engine.savePaceSnapshot).not.toHaveBeenCalled();
  });

  it('leaves a missing curve request to Rust', () => {
    mockUseRouteDataSync.mockReturnValue({ progress: { status: 'complete' } } as ReturnType<
      typeof useRouteDataSync
    >);
    engine.getAvailableSportTypes.mockReturnValue(['Run']);

    renderSyncTree();

    expect(mockUseRouteDataSync).toHaveBeenCalled();
    expect(engine.syncPaceCurve).not.toHaveBeenCalled();
    expect(engine.savePaceSnapshot).not.toHaveBeenCalled();
  });

  it('requests no curves in JavaScript when the library and curve store are empty', () => {
    mockUseRouteDataSync.mockReturnValue({ progress: { status: 'complete' } } as ReturnType<
      typeof useRouteDataSync
    >);

    renderSyncTree();

    expect(engine.syncPaceCurve).not.toHaveBeenCalled();
    expect(engine.savePaceSnapshot).not.toHaveBeenCalled();
  });

  it('expires an accepted window when the mounted sync tree sees no pickup', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    try {
      renderSyncTree();
      act(() => useSyncDateRange.getState().windowAccepted());
      act(() => jest.advanceTimersByTime(PICKUP_DEADLINE_MS - 1));
      expect(useSyncDateRange.getState().extendedFetch.phase).toBe('awaitingPickup');
      act(() => jest.advanceTimersByTime(1));
      expect(useSyncDateRange.getState().extendedFetch.phase).toBe('expired');
    } finally {
      jest.useRealTimers();
    }
  });

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

  it('does not write a pace snapshot when the GPS pass completes', () => {
    mockUseRouteDataSync.mockReturnValue({
      progress: { status: 'complete' },
    } as unknown as ReturnType<typeof useRouteDataSync>);
    engine.getAvailableSportTypes.mockReturnValue(['Run']);
    engine.getPaceCurve.mockReturnValue({ criticalSpeed: 4.2, endDate: '2026-08-20' });

    renderSyncTree();

    expect(engine.savePaceSnapshot).not.toHaveBeenCalled();
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
