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
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';

import { StorageStatsPanel } from '@/features/settings/components/StorageStatsPanel';
import { formatFileSize } from '@/shared/format/format';
import { answerSheet } from '../../__shared__/answerSheet';

// The maps barrel reaches the engine binding, which registers a TurboModule at
// import time, so the graph this renders cannot load without the stub.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
const mockSetBudgetMb = jest.fn();
const mockBudget = { mb: 50 };
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    canGoBack: () => true,
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && typeof vars.size === 'string' ? `${key}:${vars.size}` : key,
  }),
}));

jest.mock('@/shared/app/navigation', () => ({
  navigateTo: jest.fn(),
  goBack: jest.requireActual('@/shared/app/navigation').goBack,
}));

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
    mockPush.mockClear();
    mockBack.mockClear();
    delete mockParams.request;
    mockBudget.mb = 50;
  });

  it('opens the budget sheet with the current value rather than cycling it', async () => {
    const view = await renderPanel();
    void fireEvent.press(view.getByTestId('settings-tile-cache-limit'));
    expect(mockPush.mock.calls.at(-1)[0].pathname).toBe('sheets/tile-cache-budget');
    expect(mockSetBudgetMb).not.toHaveBeenCalled();
  });

  it('applies the value returned through the sheet channel', async () => {
    const view = await renderPanel();
    void fireEvent.press(view.getByTestId('settings-tile-cache-limit'));
    await answerSheet(mockPush, mockParams, 400);
    await waitFor(() => expect(mockSetBudgetMb).toHaveBeenCalledWith(400));
  });

  it('leaves the budget alone when the sheet is dismissed', async () => {
    const view = await renderPanel();
    void fireEvent.press(view.getByTestId('settings-tile-cache-limit'));
    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(mockSetBudgetMb).not.toHaveBeenCalled();
  });

  it('reports the new limit as applied only once the store has taken it', async () => {
    let takeLimit: () => void = () => {};
    mockSetBudgetMb.mockReturnValueOnce(new Promise<void>((resolve) => (takeLimit = resolve)));
    const onBudgetApplied = jest.fn();
    const view = await render(
      <StorageStatsPanel {...baseProps} onBudgetApplied={onBudgetApplied} />
    );
    void fireEvent.press(view.getByTestId('settings-tile-cache-limit'));

    await answerSheet(mockPush, mockParams, 50);
    expect(onBudgetApplied).not.toHaveBeenCalled();

    takeLimit();
    await waitFor(() => expect(onBudgetApplied).toHaveBeenCalledTimes(1));
  });

  it('says what raising the limit buys', async () => {
    const view = await renderPanel();

    expect(view.getByTestId('settings-tile-cache-subtitle').props.children).toBe(
      'settings.tileCacheLimitHint'
    );
  });

  it('draws what the store holds against the budget, with free space beside it', async () => {
    const view = await renderPanel();
    const used = view.getByTestId('settings-tile-cache-used');

    // 12 MB held against a 50 MB budget.
    expect(used.props.children).toBe('settings.tileCacheUsedOfBudget');
    expect(view.getByTestId('settings-tile-cache-free')).toBeTruthy();
  });

  it('does not claim a usage figure while a store has not answered', async () => {
    const view = await render(<StorageStatsPanel {...baseProps} basemapTiles={null} />);

    expect(view.getByTestId('settings-tile-cache-used').props.children).toBe(
      'settings.tileCacheUsedOfBudgetAtLeast'
    );
  });
});

describe('what a screen reader hears in the storage stats', () => {
  beforeEach(() => {
    mockBudget.mb = 50;
  });

  it('speaks the tile limit by name with the size it draws, and never the chevron', () => {
    const view = renderPanel();

    const label: string = view.getByTestId('settings-tile-cache-limit').props.accessibilityLabel;
    expect(label).toBe(`settings.tileCacheLimit, ${formatFileSize(50_000_000)}`);
    expect(label).not.toContain('›');
  });

  it('speaks each count beside its name', () => {
    const view = renderPanel();

    expect(view.getByRole('button', { name: 'settings.activities, 10' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'settings.routesCount, 2' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'settings.sectionsCount, 3' })).toBeTruthy();
  });

  it('speaks a zero count, which is a reading', () => {
    const view = render(<StorageStatsPanel {...baseProps} totalActivities={0} totalSections={0} />);

    expect(view.getByRole('button', { name: 'settings.activities, 0' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'settings.sectionsCount, 0' })).toBeTruthy();
  });

  it('speaks no dash for route and section counts while matching is off', () => {
    const view = render(<StorageStatsPanel {...baseProps} routeMatchingEnabled={false} />);

    expect(view.getByRole('button', { name: 'settings.routesCount' })).toBeTruthy();
    expect(view.getByRole('button', { name: 'settings.sectionsCount' })).toBeTruthy();
  });
});
