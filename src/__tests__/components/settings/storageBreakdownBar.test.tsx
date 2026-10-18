/**
 * Scenario: the storage bar coloured each store by its own hue, teal and
 * orange among them, flush against each other, and drew the device's share
 * as a hand-built bar of its own.
 *
 * Expected behaviour: the segments read the sequential ramp, largest first,
 * one key row each with its size, and the device's share is a progress bar
 * whose unfilled track is the free space.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { StorageStatsPanel } from '@/features/settings/components/StorageStatsPanel';
import { formatFileSize } from '@/shared/format/format';
import { sequentialRamp } from '@/theme';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: (pick: (s: { budgetMb: number; setBudgetMb: () => void }) => unknown) =>
    pick({ budgetMb: 200, setBudgetMb: jest.fn() }),
}));
jest.mock('@/features/settings/components/StreamHistoryRow', () => ({
  StreamHistoryRow: () => null,
}));

function panel(isDark: boolean, freeStorage: number | null = 50_000_000) {
  return render(
    <StorageStatsPanel
      isDark={isDark}
      totalActivities={10}
      routeGroupCount={2}
      totalSections={3}
      routeMatchingEnabled
      dateRangeText="range"
      lastSync={null}
      onClearMapCache={jest.fn()}
      routesSize={1_000_000}
      terrainCacheSize={2_000_000}
      heatmapCacheSize={6_000_000}
      basemapTiles={{ totalBytes: 8_000_000, vectorBytes: 3_000_000 }}
      athleteFilesSize={4_000_000}
      freeStorage={freeStorage}
    />
  );
}

function fill(node: ReactTestInstance): string {
  return String(StyleSheet.flatten(node.props.style).backgroundColor).toUpperCase();
}

describe('the storage breakdown bar', () => {
  it.each([false, true])('ranks its segments on the sequential ramp, dark %s', async (isDark) => {
    const { getAllByTestId } = await panel(isDark);
    const ramp = sequentialRamp[isDark ? 'dark' : 'light'];
    const segments = getAllByTestId('storage-bar-segment');
    expect(segments.map(fill)).toEqual(
      [ramp[4], ramp[3], ramp[2], ramp[1], ramp[0]].map((c) => c.toUpperCase())
    );
  });

  it('prints one key row per segment, largest first, each with its size', async () => {
    const { getAllByTestId } = await panel(false);
    const rows = getAllByTestId('storage-legend-label').map((n) =>
      (n.props.children as unknown[]).join('')
    );
    expect(rows).toEqual([
      `settings.storageHeatmap ${formatFileSize(6_000_000)}`,
      `settings.storageGround ${formatFileSize(5_000_000)}`,
      `settings.storageBackups ${formatFileSize(4_000_000)}`,
      `settings.storageVector ${formatFileSize(3_000_000)}`,
      `settings.storageOther ${formatFileSize(3_000_000)}`,
    ]);
    const dots = getAllByTestId('storage-legend-dot').map(fill);
    expect(dots).toEqual(getAllByTestId('storage-bar-segment').map(fill));
  });

  it('draws the device share as a progress bar over Veloq data and free space', async () => {
    const { getByTestId } = await panel(false);
    const bar = getByTestId('storage-device-usage');
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 71_000_000, now: 21_000_000 });
  });

  it('draws no device bar while the free space is unknown', async () => {
    const { queryByTestId } = await panel(false, null);
    expect(queryByTestId('storage-device-usage')).toBeNull();
  });
});
