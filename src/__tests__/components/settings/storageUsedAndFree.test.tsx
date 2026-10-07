/**
 * Scenario: the bar beside the cache legend shows Veloq's data next to the
 * device's free space. Its line used to add the two and print `X of Y used`,
 * which reads as the device's capacity.
 *
 * Expected behaviour: the line passes Veloq's bytes and the free bytes as
 * separate figures and never a sum.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { StorageStatsPanel } from '@/features/settings/components/StorageStatsPanel';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      vars
        ? `${key}|${Object.entries(vars)
            .map(([k, v]) => `${k}=${v}`)
            .join('|')}`
        : key,
  }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: (pick: (s: { budgetMb: number; setBudgetMb: () => void }) => unknown) =>
    pick({ budgetMb: 200, setBudgetMb: jest.fn() }),
}));
jest.mock('@/features/settings/components/StreamHistoryRow', () => ({
  StreamHistoryRow: () => null,
}));

function panel(freeStorage: number | null, athleteFilesSize = 0) {
  return render(
    <StorageStatsPanel
      isDark={false}
      totalActivities={10}
      routeGroupCount={2}
      totalSections={3}
      routeMatchingEnabled
      dateRangeText="range"
      lastSync={null}
      totalQueries={1}
      onClearMapCache={jest.fn()}
      routesSize={300_000_000}
      terrainCacheSize={0}
      heatmapCacheSize={0}
      basemapTiles={null}
      freeStorage={freeStorage}
      athleteFilesSize={athleteFilesSize}
    />
  );
}

describe('the storage bar line', () => {
  it('states Veloq data and free space as two figures', () => {
    const { getByText } = panel(20_000_000_000);
    expect(getByText(/^settings\.storageUsedAndFree\|/)).toBeTruthy();
    const line = getByText(/^settings\.storageUsedAndFree\|/).props.children;
    expect(String(line)).toContain('used=');
    expect(String(line)).toContain('free=');
    expect(String(line)).not.toContain('total=');
  });

  it('draws no line without a free-space reading', () => {
    const { queryByText } = panel(null);
    expect(queryByText(/storageUsed/)).toBeNull();
  });

  it('counts the backups and set-aside copies in the figure and the legend', () => {
    const { getByText, getAllByTestId } = panel(20_000_000_000, 700_000_000);
    const line = String(getByText(/^settings\.storageUsedAndFree\|/).props.children);
    // 300 MB library plus 700 MB of copies, the figure the settings hub reads.
    expect(line).toContain('used=1.0 GB');
    const labels = getAllByTestId('storage-legend-label').map((n) => String(n.props.children));
    expect(labels.some((l) => l.includes('settings.storageBackups'))).toBe(true);
  });

  it('draws no backups segment when there are none', () => {
    const { getAllByTestId } = panel(20_000_000_000, 0);
    const labels = getAllByTestId('storage-legend-label').map((n) => String(n.props.children));
    expect(labels.some((l) => l.includes('settings.storageBackups'))).toBe(false);
  });
});
