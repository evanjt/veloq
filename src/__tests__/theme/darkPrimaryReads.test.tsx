/**
 * Scenario: three screens draw the primary as a mark on a dark card: the tile
 * budget bar in storage settings, the history sync progress bar, and the
 * selected sort chip on the Routes list. Each read `colors.primary`, which is
 * the light theme's primary, so the dark theme drew the light value.
 *
 * Expected behaviour: in the dark theme each draws the dark primary, and that
 * holds the 3:1 a mark owes against the card it sits on.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { render, screen, within } from '@testing-library/react-native';
import type { FfiCatalogueEmptyReason, GroupWithPolyline } from 'veloqrs';

import { StorageStatsPanel } from '@/features/settings/components/StorageStatsPanel';
import { SyncRangePanel } from '@/features/settings/components/SyncRangePanel';
import { RoutesList } from '@/features/routes/components/RoutesList';
import { colors, darkColors } from '@/theme';
import { contrastRatio } from '../__shared__/contrast';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => {
    const theme = require('@/theme');
    return { isDark: true, colors: theme.darkColors, palette: theme.darkColors };
  },
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 30 }));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), canGoBack: () => true, back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: (pick: (s: { budgetMb: number; setBudgetMb: () => void }) => unknown) =>
    pick({ budgetMb: 50, setBudgetMb: jest.fn() }),
}));
jest.mock('@/features/settings/components/StreamHistoryRow', () => ({
  StreamHistoryRow: () => null,
}));

jest.mock('@/features/maps', () => ({
  ...jest.requireActual('@/features/maps'),
  TimelineSlider: () => null,
}));
jest.mock('@/features/activity/hooks', () => ({
  useActivityBoundsCache: () => ({
    progress: { status: 'idle' },
    cacheStats: { totalActivities: 120, oldestDate: null, newestDate: null },
    syncDateRange: jest.fn(),
  }),
}));
jest.mock('@/shared/app/useOldestActivityDate', () => ({
  useOldestActivityDate: () => ({ data: new Date('2015-01-01T00:00:00') }),
}));
jest.mock('@/features/settings/hooks/useActivityYearCounts', () => ({
  useActivityYearCounts: () => ({ data: [] }),
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (s: unknown) => unknown) =>
    selector({
      oldest: '2026-06-03',
      extendedFetch: { phase: 'idle', since: 0 },
      isGpsSyncing: true,
      gpsSyncProgress: { percent: 40, message: '', completed: 4, total: 10 },
      isExpansionLocked: false,
    }),
}));

jest.mock('@/features/routes/components/DataRangeFooter', () => ({
  DataRangeFooter: () => null,
}));
jest.mock('@/features/routes/components/RouteRow', () => ({ RouteRow: () => null }));
jest.mock('@/features/routes/lib/batchGroupToRouteGroup', () => ({
  batchGroupToRouteGroup: (group: { groupId: string }) => ({ id: group.groupId }),
}));

/** WCAG 2.2 AA for a graphical object the athlete needs to read the screen. */
const AA_MARK = 3;

/** Every dark ground a settings card or a list chip sits on. */
const DARK_GROUNDS = [darkColors.background, darkColors.surface, darkColors.surfaceCard];

function expectDarkMark(colour: unknown) {
  expect(colour).toBe(darkColors.primary);
  for (const ground of DARK_GROUNDS) {
    expect(contrastRatio(colour as string, ground)).toBeGreaterThanOrEqual(AA_MARK);
  }
}

describe('the primary drawn as a mark in the dark theme', () => {
  it('fills the tile budget bar with the dark primary', async () => {
    await render(
      <StorageStatsPanel
        isDark
        totalActivities={10}
        routeGroupCount={2}
        totalSections={3}
        routeMatchingEnabled
        dateRangeText="range"
        lastSync={null}
        onClearMapCache={jest.fn()}
        routesSize={100}
        athleteFilesSize={0}
        freeStorage={4_000_000_000}
        terrainCacheSize={4_000_000}
        heatmapCacheSize={2_000_000}
        basemapTiles={{ totalBytes: 6_000_000, vectorBytes: 4_000_000 }}
      />
    );

    const fill = screen.getByTestId('settings-tile-cache-fill');
    expectDarkMark(StyleSheet.flatten(fill.props.style).backgroundColor);
  });

  it('fills the history sync progress bar with the dark primary', async () => {
    await render(<SyncRangePanel />);

    const fill = screen.getByTestId('settings-sync-range-progress-fill');
    expectDarkMark(StyleSheet.flatten(fill.props.style).backgroundColor);
  });

  it('marks the selected sort chip with the dark primary', async () => {
    const groups = ['loop-a', 'loop-b'].map((groupId) => ({ groupId })) as GroupWithPolyline[];
    await render(
      <RoutesList
        onRefresh={jest.fn()}
        batchGroups={groups}
        sortOption="activities"
        onSortChange={jest.fn()}
        searchQuery=""
        onSearchChange={jest.fn()}
        totalGroupCount={groups.length}
        shownGroupCount={groups.length}
        emptyReason={null as FfiCatalogueEmptyReason | null}
      />
    );

    const selected = screen.getByRole('button', { selected: true });
    const chip = StyleSheet.flatten(selected.props.style);
    expectDarkMark(chip.borderColor);
    const [icon] = within(selected).UNSAFE_getAllByType(MaterialCommunityIcons);
    expectDarkMark(icon.props.color);
    expect(chip.borderColor).not.toBe(colors.primary);
  });
});
