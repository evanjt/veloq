/**
 * Scenario: a handset that has browsed the map for a week holds 40 MB of tiles
 * in the Rust store. The cache screen measured the page-side buckets instead,
 * which the native transport no longer fills, so the limit bar read near zero,
 * or an "at least" floor when no map page was up to answer.
 *
 * Expected behaviour: with no map page mounted, the used figure, the bar and
 * the breakdown are the store's own.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import { DataCacheSection } from '@/features/settings/components/DataCacheSection';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join('|')}` : key,
  }),
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
  ...jest.requireActual('@/features/maps/lib/storage/tileCacheSettings'),
  ...jest.requireActual('@/features/maps/lib/tileCacheBudget'),
  HEATMAP_TILES_DIR: '/cache/heatmap-tiles/',
  readHeatmapTilesCacheSize: async () => 0,
  clearTerrainPreviews: async () => {},
  getTerrainPreviewCacheSize: async () => 0,
}));

jest.mock('@/features/settings/components/CacheManagementPanel', () => ({
  CacheManagementPanel: () => null,
}));

jest.mock('@/features/settings/components/StreamHistoryRow', () => ({
  StreamHistoryRow: () => null,
}));

jest.mock('@/features/settings/components/StreamBackfillRow', () => ({
  StreamBackfillRow: () => null,
}));

jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const MB = 1024 * 1024;

function storeHolding(totalBytes: number, vectorBytes: number) {
  const basemap = jest.requireMock('veloqrs').basemapStore();
  basemap.getCacheSize.mockImplementation(() => Promise.resolve(totalBytes));
  basemap.getSourceSize.mockImplementation((source: string) =>
    Promise.resolve(source === 'openmaptiles' ? vectorBytes : 0)
  );
}

describe('the cache screen measures the Rust tile store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.requireMock('@/shared/native/engine').getEngine.mockReturnValue(null);
  });

  it('reads the used figure from the store with no map page to answer', async () => {
    storeHolding(40 * MB, 30 * MB);
    const view = render(<DataCacheSection />);

    await waitFor(() =>
      expect(view.getByTestId('settings-tile-cache-used').props.children).toBe(
        'settings.tileCacheUsedOfBudget:41.9 MB|50.0 MB'
      )
    );
  });

  it('breaks the store down into vector and ground', async () => {
    storeHolding(40 * MB, 30 * MB);
    const view = render(<DataCacheSection />);

    await waitFor(() => {
      const legend = view
        .getAllByTestId('storage-legend-label')
        .map((node) => node.props.children.join(''));
      expect(legend).toEqual(
        expect.arrayContaining(['settings.storageVector 31.5 MB', 'settings.storageGround 10.5 MB'])
      );
    });
  });

  it('counts the store in the map cache total as a complete figure', async () => {
    storeHolding(40 * MB, 30 * MB);
    const view = render(<DataCacheSection />);

    await waitFor(() =>
      expect(view.getByTestId('settings-map-cache-value').props.children).toBe('41.9 MB')
    );
  });

  it('says a store that holds nothing holds nothing, not at least nothing', async () => {
    storeHolding(0, 0);
    const view = render(<DataCacheSection />);

    await waitFor(() =>
      expect(view.getByTestId('settings-tile-cache-used').props.children).toBe(
        'settings.tileCacheUsedOfBudget:0 B|50.0 MB'
      )
    );
  });
});
