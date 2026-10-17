/**
 * Scenario: a signed-in athlete opens the app on an empty library and a backup
 * can be seen on their WebDAV server, on the launch the tour also opens on.
 *
 * Expected behaviour: the restore offer is a card on the feed, not a sheet route
 * pushed over the tour. A swipe or a scroll cannot lose it: it stays until it is
 * answered, and once answered no later launch offers it again.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';

import { getEngine } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { offerRestorePrompt } from '@/features/settings/lib/restorePrompt';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { initialiseI18n } from '@/i18n';
import FeedScreen from '@/app/(tabs)/(feed)/index';

const mockSettings = new Map<string, string>();
let mockBackups: { id: string; timestamp: string; sizeBytes: number; appVersion: string }[] = [];

jest.mock('@/shared/native/syncRefresh', () => ({
  requestSyncRefresh: jest.fn(),
  cancelSyncRefresh: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => true,
  Stack: Object.assign(() => null, { Screen: () => null }),
  router: { push: jest.fn(), navigate: jest.fn(), back: jest.fn() },
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useTopSafeArea: () => ({ screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({ decodeCoords: () => [] })
);
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
  isEngineReady: () => true,
  getNativeModule: () => null,
  getRouteDbPath: () => null,
}));
jest.mock('@/features/activity/hooks', () => ({
  ...jest.requireActual('@/features/activity/hooks'),
  useInfiniteActivities: () => ({
    data: { pages: [[]] },
    isLoading: false,
    isError: false,
    error: null,
    isRefetching: false,
    fetchNextPage: jest.fn(),
    fetchPreviousPage: jest.fn(),
    hasPreviousPage: false,
    isFetchingPreviousPage: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/features/insights', () => ({ useInsights: () => ({ insights: [] }) }));
jest.mock('@/features/home', () => ({
  ...jest.requireActual('@/features/settings/stores/summaryCardPreferences'),
  feedEmptyState: jest.requireActual('@/features/home/lib/feedEmptyState').feedEmptyState,
  summaryCardTarget: jest.requireActual('@/features/home/lib/summaryCardTargets').summaryCardTarget,
  useSummaryCardData: () => ({ showSparkline: false, refetch: jest.fn() }),
  useStartupData: () => ({ data: undefined, refresh: jest.fn() }),
  SummaryCard: () => null,
  NotificationOptInCard: () => null,
  SupportCard: () => null,
  FeedFirstSyncStandby: () => null,
  FeedEmptyLibrary: () => null,
}));
jest.mock('@/features/recording', () => ({
  RecordFAB: () => null,
  PendingUploadsCard: () => null,
}));
jest.mock('@/features/maps/components/TerrainSnapshotWebView', () => ({
  TerrainSnapshotWebView: () => null,
}));
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  initTerrainPreviewCache: jest.fn(),
}));
jest.mock('@/features/maps/lib/storage/terrainCameraOverrides', () => ({
  initCameraOverrides: jest.fn(),
}));
jest.mock('@/features/activity/components', () => ({ ActivityCard: () => null }));
jest.mock('@/shared/storage/platformRecord', () => ({ platformRecordUri: () => null }));
jest.mock('@/features/settings/lib/autobackup/webdavConfig', () => ({
  getWebdavConfig: () => ({ url: 'https://example.invalid/backups' }),
  initWebdavConfig: async () => {},
}));
jest.mock('@/features/settings/lib/autobackup/backends', () => ({
  webdavBackend: {
    isAvailable: async () => true,
    listBackups: async () => mockBackups,
  },
  googleDriveBackend: { isAvailable: async () => false, listBackups: async () => [] },
  icloudBackend: { listBackups: async () => [] },
  isIcloudSupported: () => false,
}));
jest.mock('@/features/settings/hooks/useBackup', () => ({
  confirmLegacyImport: jest.fn(),
  useImportDatabaseBackup: () => ({ importDatabaseBackup: jest.fn(), importing: false }),
}));
jest.mock('@/features/settings/components/WebdavConfigForm', () => ({
  WebdavConfigForm: () => null,
}));

function renderFeed() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FeedScreen />
    </QueryClientProvider>
  );
}

beforeAll(async () => {
  await initialiseI18n();
});

beforeEach(() => {
  mockSettings.clear();
  mockBackups = [
    { id: 'b1', timestamp: '2026-06-08T06:30:00.000Z', sizeBytes: 2_400_000, appVersion: '0.4.0' },
  ];
  (router.push as jest.Mock).mockClear();
  (router.navigate as jest.Mock).mockClear();
  useWhatsNewStore.setState({ launchModal: null, restoreOffer: null });
  (getEngine as jest.Mock).mockReturnValue({
    getActivityHighlightsBundle: () => ({ indicators: [], routeHighlights: [], newGround: [] }),
    searchActivityBodies: () => ({ bodies: [], matchedCount: 0, hasMore: false }),
    getSyncStatus: () => ({ state: 0, inFlight: 0, completed: 0, total: 0 }),
    subscribe: () => () => {},
    getSetting: (key: string) => mockSettings.get(key) ?? null,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
  });
  useAuthStore.setState({ isAuthenticated: true, athleteId: 'i1' });
});

describe('the restore offer on an empty feed', () => {
  it('renders as a card on the feed and pushes no sheet route', async () => {
    await offerRestorePrompt(0, () => true);
    await renderFeed();

    expect(screen.getByTestId('restore-offer-card')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('stays through an unmount, since only an answer ends it', async () => {
    await offerRestorePrompt(0, () => true);
    await (await renderFeed()).unmount();

    await renderFeed();
    expect(screen.getByTestId('restore-offer-card')).toBeTruthy();
  });

  it('is gone once dismissed, and no later launch offers it', async () => {
    await offerRestorePrompt(0, () => true);
    await renderFeed();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('restore-offer-dismiss'));
    });
    expect(screen.queryByTestId('restore-offer-card')).toBeNull();

    await offerRestorePrompt(0, () => true);
    expect(useWhatsNewStore.getState().restoreOffer).toBeNull();
  });

  it('is not offered when no backup can be seen', async () => {
    mockBackups = [];
    await offerRestorePrompt(0, () => true);
    await renderFeed();
    expect(screen.queryByTestId('restore-offer-card')).toBeNull();
  });
});
