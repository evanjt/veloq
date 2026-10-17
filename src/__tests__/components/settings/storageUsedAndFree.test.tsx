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

function panel(freeStorage: number | null, athleteFilesSize = 0, routeMatchingEnabled = true) {
  return render(
    <StorageStatsPanel
      isDark={false}
      totalActivities={10}
      routeGroupCount={2}
      totalSections={3}
      routeMatchingEnabled={routeMatchingEnabled}
      dateRangeText="range"
      lastSync={null}
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
  it('states Veloq data and free space as two figures', async () => {
    const { getByText } = await panel(20_000_000_000);
    expect(getByText(/^settings\.storageUsedAndFree\|/)).toBeTruthy();
    const line = getByText(/^settings\.storageUsedAndFree\|/).props.children;
    expect(String(line)).toContain('used=');
    expect(String(line)).toContain('free=');
    expect(String(line)).not.toContain('total=');
  });

  it('draws no line without a free-space reading', async () => {
    const { queryByText } = await panel(null);
    expect(queryByText(/storageUsed/)).toBeNull();
  });

  it('counts the backups and set-aside copies in the figure and the legend', async () => {
    const { getByText, getAllByTestId } = await panel(20_000_000_000, 700_000_000);
    const line = String(getByText(/^settings\.storageUsedAndFree\|/).props.children);
    // 300 MB library plus 700 MB of copies, the figure the settings hub reads.
    expect(line).toContain('used=1.0 GB');
    const labels = getAllByTestId('storage-legend-label').map((n) => String(n.props.children));
    expect(labels.some((l) => l.includes('settings.storageBackups'))).toBe(true);
  });

  it('draws no backups segment when there are none', async () => {
    const { getAllByTestId } = await panel(20_000_000_000, 0);
    const labels = getAllByTestId('storage-legend-label').map((n) => String(n.props.children));
    expect(labels.some((l) => l.includes('settings.storageBackups'))).toBe(false);
  });
});

/**
 * Scenario: with route matching off, the route and section counts print '-'
 * and refuse the press. A screen reader heard the bare name and nothing of why.
 *
 * Expected behaviour: each reports itself disabled and says route matching is
 * off; with matching on it is a live link that says its count and not the
 * reason.
 */
describe('the route and section counts with matching off', () => {
  it.each(['settings.routesCount', 'settings.sectionsCount'])('says why %s is out', async (key) => {
    const { getByTestId } = await panel(null, 0, false);
    const stat = getByTestId(`storage-stat-${key}`);

    expect(stat.props.accessibilityState).toMatchObject({ disabled: true });
    expect(stat.props.accessibilityLabel).toContain(key);
    expect(stat.props.accessibilityLabel).toContain('settings.routeMatchingOff');
  });

  it.each([
    ['settings.routesCount', 2],
    ['settings.sectionsCount', 3],
  ])('keeps %s live with matching on, saying its count %i', async (key, count) => {
    const { getByTestId } = await panel(null);
    const stat = getByTestId(`storage-stat-${key}`);

    expect(stat.props.accessibilityState?.disabled ?? false).toBe(false);
    expect(stat.props.accessibilityLabel).toBe(`${key}, ${count}`);
  });
});
