/**
 * Scenario: a zoom directory of heatmap tiles could not be removed when the
 * athlete tapped Clear cache or cleared the map cache. The engine logged it and
 * answered as though the set was empty, so the screen said the cache was
 * cleared with the heat still on disk.
 *
 * Expected behaviour: both buttons report the failure, and a clear that went
 * says so as before.
 */

import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';

import { DataCacheSection } from '@/features/settings/components/DataCacheSection';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({
    cancelQueries: async () => {},
    refetchQueries: async () => {},
  }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({ isDemoMode: false }),
}));

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (select: (s: unknown) => unknown) => select({ reset: () => {} }),
}));

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  useRouteSettings: () => ({ settings: { enabled: true } }),
}));

jest.mock('@/features/routes/hooks/useRouteGroups', () => ({
  useRouteGroups: () => ({ groups: [], processedCount: 0 }),
}));

jest.mock('@/features/routes/hooks/useEngine', () => ({
  useSectionSummaries: () => ({ totalCount: 0 }),
}));

jest.mock('@/shared/storage/gpsStorage', () => ({
  estimateRoutesDatabaseSize: async () => 0,
  getAthleteFilesSize: async () => 0,
}));

jest.mock('@/features/settings/hooks/useQueryCacheCount', () => ({
  useQueryCacheCount: () => 0,
}));

jest.mock('@/features/activity', () => ({
  useActivityBoundsCache: () => ({
    cacheStats: { totalActivities: 0, oldestDate: null, newestDate: null, lastSync: null },
    clearCache: async () => true,
  }),
}));

jest.mock('@/features/maps', () => ({
  ...jest.requireActual('@/features/maps/lib/heatmapTiles'),
  ...jest.requireActual('@/features/maps/lib/basemapCache'),
  HEATMAP_TILES_DIR: '/cache/heatmap-tiles/',
  readHeatmapTilesCacheSize: async () => 0,
  clearTerrainPreviews: async () => {},
  getTerrainPreviewCacheSize: async () => 0,
}));

const mockPanels: {
  onClearCache?: () => void;
  onClearMapCache?: () => Promise<void>;
  onBudgetApplied?: () => void;
  basemapTiles?: { totalBytes: number } | null;
} = {};

jest.mock('@/features/settings/components/CacheManagementPanel', () => ({
  CacheManagementPanel: (props: { onClearCache: () => void }) => {
    mockPanels.onClearCache = props.onClearCache;
    return null;
  },
}));

jest.mock('@/features/settings/components/StorageStatsPanel', () => ({
  StorageStatsPanel: (props: {
    onClearMapCache: () => Promise<void>;
    onBudgetApplied: () => void;
    basemapTiles: { totalBytes: number } | null;
  }) => {
    mockPanels.onClearMapCache = props.onClearMapCache;
    mockPanels.onBudgetApplied = props.onBudgetApplied;
    mockPanels.basemapTiles = props.basemapTiles;
    return null;
  },
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function engineWhoseTileClear(outcome: 'goes' | 'fails') {
  return {
    cancelHeatmapWork: jest.fn(() => false),
    clearHeatmapTiles: jest.fn(() =>
      outcome === 'goes'
        ? Promise.resolve()
        : Promise.reject(new Error('Could not remove heatmap tiles'))
    ),
  };
}

/** Tap Clear cache and accept the confirmation, as the athlete does. */
function confirmClearCache(alert: jest.SpyInstance) {
  mockPanels.onClearCache?.();
  const buttons = alert.mock.calls[0][2] as AlertButton[];
  const destructive = buttons.find((button) => button.style === 'destructive');
  alert.mockClear();
  return destructive?.onPress?.();
}

describe('clearing the cache with the heatmap tiles', () => {
  let alert: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alert.mockRestore();
  });

  it('reports a Clear cache that left heatmap tiles on disk', async () => {
    const engine = engineWhoseTileClear('fails');
    mockedGetEngine.mockReturnValue(engine as never);
    render(<DataCacheSection />);

    await confirmClearCache(alert);

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(engine.clearHeatmapTiles).toHaveBeenCalledWith('/cache/heatmap-tiles/');
    expect(alert).toHaveBeenLastCalledWith('alerts.error', 'alerts.failedToClear');
  });

  it('says the cache was cleared when the tiles went', async () => {
    mockedGetEngine.mockReturnValue(engineWhoseTileClear('goes') as never);
    render(<DataCacheSection />);

    await confirmClearCache(alert);

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert).toHaveBeenLastCalledWith('alerts.cacheCleared');
  });

  it('reports a map cache clear that left heatmap tiles on disk', async () => {
    const engine = engineWhoseTileClear('fails');
    mockedGetEngine.mockReturnValue(engine as never);
    render(<DataCacheSection />);

    await mockPanels.onClearMapCache?.();

    expect(engine.clearHeatmapTiles).toHaveBeenCalledWith('/cache/heatmap-tiles/');
    expect(alert).toHaveBeenCalledWith('alerts.error', 'alerts.failedToClear');
  });

  it('reports nothing when the map cache clear went', async () => {
    mockedGetEngine.mockReturnValue(engineWhoseTileClear('goes') as never);
    render(<DataCacheSection />);

    await mockPanels.onClearMapCache?.();

    expect(alert).not.toHaveBeenCalled();
  });

  it('leaves the pinned offline tiles in the Rust store on both clears', async () => {
    mockedGetEngine.mockReturnValue(engineWhoseTileClear('goes') as never);
    render(<DataCacheSection />);

    await mockPanels.onClearMapCache?.();
    await confirmClearCache(alert);
    await waitFor(() => expect(alert).toHaveBeenCalled());

    expect(basemap().clearTiles).not.toHaveBeenCalled();
  });

  it('clears the unpinned Rust tiles on both clears', async () => {
    mockedGetEngine.mockReturnValue(engineWhoseTileClear('goes') as never);
    render(<DataCacheSection />);

    await mockPanels.onClearMapCache?.();
    expect(basemap().clearUnpinnedTiles).toHaveBeenCalledTimes(1);

    await confirmClearCache(alert);
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(basemap().clearUnpinnedTiles).toHaveBeenCalledTimes(2);
  });

  it('still finishes the clear where the tile store is absent or refuses', async () => {
    mockedGetEngine.mockReturnValue(engineWhoseTileClear('goes') as never);
    basemap().clearUnpinnedTiles.mockRejectedValueOnce(new Error('no path set'));
    render(<DataCacheSection />);

    await mockPanels.onClearMapCache?.();

    expect(alert).not.toHaveBeenCalled();
  });
});

describe('lowering the tile limit', () => {
  it('re-reads what the store holds once the limit has been applied', async () => {
    mockedGetEngine.mockReturnValue(engineWhoseTileClear('goes') as never);
    basemap().getCacheSize.mockResolvedValue(300 * 1024 * 1024);
    render(<DataCacheSection />);
    await waitFor(() => expect(mockPanels.basemapTiles?.totalBytes).toBe(300 * 1024 * 1024));

    basemap().getCacheSize.mockResolvedValue(50 * 1024 * 1024);
    mockPanels.onBudgetApplied?.();

    await waitFor(() => expect(mockPanels.basemapTiles?.totalBytes).toBe(50 * 1024 * 1024));
  });
});

function basemap() {
  return jest.requireMock('veloqrs').basemapStore();
}
