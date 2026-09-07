/**
 * Scenario: the terrain snapshot pipeline reports it is rendering two previews
 * and then stalls.
 *
 * Expected behaviour: nothing is posted to the system notification. The
 * formatter hardcoded `indeterminate: false`, so the 1.5 s debounce that
 * suppresses short-lived states never applied to it: a two-item job posted
 * "Rendering previews 0/2" on its first tick, and the notification is
 * dismissed only when the display info goes null, so a stalled render left it
 * standing for good.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { GlobalDataSync } from '@/shared/app/GlobalDataSync';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { updateSyncNotification } from '@/features/settings/lib/notificationService';

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
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn(() => null) }));
jest.mock('@/features/settings/lib/notificationService', () => ({
  updateSyncNotification: jest.fn(),
  dismissSyncNotification: jest.fn(),
}));
jest.mock('@/features/settings/lib/autobackup', () => ({ onSyncComplete: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const mockUpdate = updateSyncNotification as jest.MockedFunction<typeof updateSyncNotification>;

let client: QueryClient;

function renderSyncTree() {
  return render(
    React.createElement(QueryClientProvider, { client }, React.createElement(GlobalDataSync))
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useAuthStore.setState({ isAuthenticated: true, authMethod: 'oauth' });
  useSyncDateRange.getState().setTerrainSnapshotProgress({
    status: 'idle',
    completed: 0,
    total: 0,
  });
});

describe('the terrain preview render', () => {
  it('posts no notification when a render starts', () => {
    renderSyncTree();
    mockUpdate.mockClear();

    act(() => {
      useSyncDateRange.getState().setTerrainSnapshotProgress({
        status: 'rendering',
        completed: 0,
        total: 2,
      });
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('posts no notification while a render is part way through', () => {
    renderSyncTree();
    mockUpdate.mockClear();

    act(() => {
      useSyncDateRange.getState().setTerrainSnapshotProgress({
        status: 'rendering',
        completed: 1,
        total: 2,
      });
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
