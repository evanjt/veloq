/**
 * Scenario: the tile budget is the one storage control the athlete has, and it
 * was a tap that cycled four values in a fixed order. Four rungs on a tap is a
 * guessing game: to reach 400 MB from 50 you tap three times past two values
 * you did not want, and nothing on screen says what the rungs are.
 *
 * Expected behaviour: the row opens a picker showing every choice with the
 * current one marked, says what raising it buys, and draws what the store holds
 * against the budget with the device's free space beside it, so the athlete
 * sees both what Veloq keeps and what raising the limit would cost.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { StorageStatsPanel } from '@/features/settings/components/StorageStatsPanel';
import { TILE_CACHE_BUDGET_CHOICES_MB } from '@/features/maps/lib/tileCacheBudget';

// The maps barrel reaches the engine binding, which registers a TurboModule at
// import time, so the graph this renders cannot load without the stub.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
const mockSetBudgetMb = jest.fn();
const mockBudget = { mb: 50 };

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && typeof vars.size === 'string' ? `${key}:${vars.size}` : key,
  }),
}));

jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

jest.mock('@/features/maps/lib/storage/tileCacheSettings', () => ({
  useTileCacheSettings: (pick: (s: { budgetMb: number; setBudgetMb: () => void }) => unknown) =>
    pick({ budgetMb: mockBudget.mb, setBudgetMb: mockSetBudgetMb }),
}));

jest.mock('@/features/settings/components/StreamHistoryRow', () => ({
  StreamHistoryRow: () => null,
}));

const baseProps = {
  isDark: false,
  totalActivities: 10,
  routeGroupCount: 2,
  totalSections: 3,
  routeMatchingEnabled: true,
  dateRangeText: 'range',
  lastSync: null,
  totalQueries: 1,
  onClearMapCache: jest.fn(),
  routesSize: 100,
  athleteFilesSize: 0,
  freeStorage: 4_000_000_000,
  terrainCacheSize: 4_000_000,
  heatmapCacheSize: 2_000_000,
  basemapTiles: { totalBytes: 6_000_000, vectorBytes: 4_000_000 },
};

function renderPanel() {
  return render(<StorageStatsPanel {...baseProps} />);
}

describe('the tile budget row', () => {
  beforeEach(() => {
    mockSetBudgetMb.mockClear();
    mockBudget.mb = 50;
  });

  it('opens a picker rather than cycling the value', () => {
    const view = renderPanel();

    expect(view.queryByTestId('settings-tile-cache-picker')).toBeNull();
    fireEvent.press(view.getByTestId('settings-tile-cache-limit'));

    expect(view.getByTestId('settings-tile-cache-picker')).toBeTruthy();
    expect(mockSetBudgetMb).not.toHaveBeenCalled();
  });

  it('offers every rung, so the athlete can see what the choices are', () => {
    const view = renderPanel();
    fireEvent.press(view.getByTestId('settings-tile-cache-limit'));

    for (const mb of TILE_CACHE_BUDGET_CHOICES_MB) {
      expect(view.getByTestId(`settings-tile-cache-choice-${mb}`)).toBeTruthy();
    }
  });

  it('takes the rung the athlete picked, not the next one along', () => {
    const view = renderPanel();
    fireEvent.press(view.getByTestId('settings-tile-cache-limit'));

    fireEvent.press(view.getByTestId('settings-tile-cache-choice-400'));

    expect(mockSetBudgetMb).toHaveBeenCalledWith(400);
    expect(view.queryByTestId('settings-tile-cache-picker')).toBeNull();
  });

  it('reports the new limit as applied only once the store has taken it', async () => {
    let takeLimit: () => void = () => {};
    mockSetBudgetMb.mockReturnValueOnce(new Promise<void>((resolve) => (takeLimit = resolve)));
    const onBudgetApplied = jest.fn();
    const view = render(<StorageStatsPanel {...baseProps} onBudgetApplied={onBudgetApplied} />);
    fireEvent.press(view.getByTestId('settings-tile-cache-limit'));

    fireEvent.press(view.getByTestId('settings-tile-cache-choice-50'));
    expect(onBudgetApplied).not.toHaveBeenCalled();

    takeLimit();
    await waitFor(() => expect(onBudgetApplied).toHaveBeenCalledTimes(1));
  });

  it('says what raising the limit buys', () => {
    const view = renderPanel();

    expect(view.getByTestId('settings-tile-cache-subtitle').props.children).toBe(
      'settings.tileCacheLimitHint'
    );
  });

  it('draws what the store holds against the budget, with free space beside it', () => {
    const view = renderPanel();
    const used = view.getByTestId('settings-tile-cache-used');

    // 12 MB held against a 50 MB budget.
    expect(used.props.children).toBe('settings.tileCacheUsedOfBudget');
    expect(view.getByTestId('settings-tile-cache-free')).toBeTruthy();
  });

  it('does not claim a usage figure while a store has not answered', () => {
    const view = render(<StorageStatsPanel {...baseProps} basemapTiles={null} />);

    expect(view.getByTestId('settings-tile-cache-used').props.children).toBe(
      'settings.tileCacheUsedOfBudgetAtLeast'
    );
  });
});
