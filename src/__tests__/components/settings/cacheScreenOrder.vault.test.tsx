/**
 * Scenario: the cache screen opened on the red Clear all & reload row, above
 * the counts and sizes it would destroy, under a header repeating the screen
 * title, and listed the in-memory query cache's entry count among the facts.
 *
 * Expected behaviour: the facts come first and the wipe sits at their foot,
 * no header repeats the title, and nothing an athlete cannot act on is listed.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import { DataCacheSection } from '@/features/settings/components/DataCacheSection';
import { SCREEN_HEADERS } from '@/shared/app/screenHeaders';

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

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useIsOnline: () => true,
}));

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

jest.mock('@/features/settings/components/StreamHistoryRow', () => ({
  StreamHistoryRow: () => null,
}));

jest.mock('@/features/settings/components/StreamBackfillRow', () => ({
  StreamBackfillRow: () => null,
}));

jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

/** Every testID in the tree, in the order it renders. */
function testIdsInOrder(tree: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    const el = node as { props?: Record<string, unknown>; children?: unknown };
    if (typeof el.props?.testID === 'string') found.push(el.props.testID);
    walk(el.children);
  };
  walk(tree);
  return found;
}

describe('the cache screen', () => {
  beforeEach(() => {
    jest.requireMock('@/shared/native/engine').getEngine.mockReturnValue(null);
  });

  it('lists the counts and sizes before the wipe', async () => {
    const view = await render(<DataCacheSection />);
    await waitFor(() => expect(view.getByTestId('settings-clear-cache')).toBeTruthy());

    const ids = testIdsInOrder(view.toJSON());
    expect(ids.indexOf('settings-storage-stats')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('settings-storage-stats')).toBeLessThan(ids.indexOf('settings-clear-cache'));
  });

  it('does not repeat the screen title as a header', async () => {
    const view = await render(<DataCacheSection />);
    await waitFor(() => expect(view.getByTestId('settings-clear-cache')).toBeTruthy());

    const headers = view.queryAllByRole('header').map((node) => node.props.children);
    expect(headers).not.toContain(SCREEN_HEADERS['cache-settings']?.titleKey);
  });

  it('lists no query cache count', async () => {
    const view = await render(<DataCacheSection />);
    await waitFor(() => expect(view.getByTestId('settings-clear-cache')).toBeTruthy());

    expect(view.queryByText('settings.cachedQueries')).toBeNull();
  });
});
