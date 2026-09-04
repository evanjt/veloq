/**
 * Scenario: the storage bar's legend named its segments with literals, so the
 * one chart on the cache screen read `3D previews` in every locale while every
 * label around it was translated.
 *
 * Expected behaviour: every segment name is a key, and a literal reaching the
 * legend fails here rather than on a device in Japanese.
 */

import * as fs from 'fs';
import * as path from 'path';

import React from 'react';
import { render } from '@testing-library/react-native';

import { StorageStatsPanel } from '@/features/settings/components/StorageStatsPanel';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => `t(${key})` }),
}));

jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: (pick: (s: { budgetMb: number; setBudgetMb: () => void }) => unknown) =>
    pick({ budgetMb: 200, setBudgetMb: jest.fn() }),
}));

jest.mock('@/features/settings/components/StreamHistoryRow', () => ({
  StreamHistoryRow: () => null,
}));

const LOCALES_DIR = path.join(__dirname, '../../../i18n/locales');

const SEGMENT_KEYS = [
  'storageDatabase',
  'storageHeatmap',
  'storageSatellite',
  'storageTerrain',
  'storageVector',
  'storageGround',
  'storagePreviews',
] as const;

function fullPanel() {
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
      databaseSize={1_000_000}
      onClearMapCache={jest.fn()}
      routesSize={1_000_000}
      terrainCacheSize={2_000_000}
      heatmapCacheSize={3_000_000}
      tileCacheStats={{
        tileCount: 40,
        totalBytes: 10_000_000,
        terrain: { tileCount: 10, totalBytes: 1_000_000 },
        satellite: { tileCount: 10, totalBytes: 4_000_000 },
        vector: { tileCount: 10, totalBytes: 3_000_000 },
        ground: { tileCount: 10, totalBytes: 2_000_000 },
      }}
      freeStorage={5_000_000}
    />
  );
}

describe('the storage legend', () => {
  it('names every segment through a key', () => {
    const { getAllByTestId } = fullPanel();
    const names = getAllByTestId('storage-legend-label').map((n) => String(n.props.children[0]));
    expect(names).toHaveLength(SEGMENT_KEYS.length);
    for (const name of names) {
      expect(name).toMatch(/^t\(settings\./);
    }
  });

  it('draws a segment for every store that holds something', () => {
    const { getAllByTestId } = fullPanel();
    const names = getAllByTestId('storage-legend-label').map((n) => String(n.props.children[0]));
    expect(names).toEqual(SEGMENT_KEYS.map((key) => `t(settings.${key})`));
  });

  it('translates every segment name in all seventeen locales', () => {
    const locales = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
    expect(locales).toHaveLength(17);
    const english = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, 'en-AU.json'), 'utf-8')
    ).settings;
    for (const file of locales) {
      const settings = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf-8')).settings;
      const names = SEGMENT_KEYS.map((key) => settings[key]);
      for (const name of names) {
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
      // Individual names are compared as a set, not one by one: `Database` and
      // `Heatmap` are the real words in Danish, Dutch and Italian, so a
      // per-key comparison flags a correct translation. A locale whose whole
      // legend equals the English one has translated none of it, which is the
      // defect this file exists for.
      if (!file.startsWith('en-')) {
        expect(names).not.toEqual(SEGMENT_KEYS.map((key) => english[key]));
      }
    }
  });
});
