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
import { resolvedLocale } from '../../i18n/resolvedLocale';

// The maps barrel reaches the engine binding, which registers a TurboModule at
// import time, so the graph this renders cannot load without the stub.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
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
  'storageVector',
  'storageGround',
  'storagePreviews',
  'storageBackups',
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
      onClearMapCache={jest.fn()}
      routesSize={1_000_000}
      terrainCacheSize={2_000_000}
      heatmapCacheSize={3_000_000}
      basemapTiles={{ totalBytes: 5_000_000, vectorBytes: 3_000_000 }}
      athleteFilesSize={4_000_000}
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

  // Every other locale is held to the reference one in translations.test.ts,
  // key for key and leaf for leaf.
  it('names every segment in the reference locale', () => {
    const settings = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, 'en-GB.json'), 'utf-8')
    ).settings;
    for (const name of SEGMENT_KEYS.map((key) => settings[key])) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('leaves no locale with the whole legend in English', () => {
    const locales = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
    const english = resolvedLocale('en-AU').settings;
    for (const file of locales.filter((f) => !f.startsWith('en-'))) {
      const settings = resolvedLocale(file.replace('.json', '')).settings;
      // Individual names are compared as a set, not one by one: `Database` and
      // `Heatmap` are the real words in Danish, Dutch and Italian, so a
      // per-key comparison flags a correct translation. A locale whose whole
      // legend equals the English one has translated none of it, which is the
      // defect this file exists for.
      expect(SEGMENT_KEYS.map((key) => settings[key])).not.toEqual(
        SEGMENT_KEYS.map((key) => english[key])
      );
    }
  });
});
