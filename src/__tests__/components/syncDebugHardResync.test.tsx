/**
 * Scenario: Hard Re-sync on the sync debug tab wipes the whole engine, and the
 * wipe fails on a Rust error, a stopped worker or its own deadline.
 * Expected behaviour: the failure is reported, and nothing claims a re-sync
 * that never started.
 */

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { SyncDebugTab } from '@/features/routes/components/SyncDebugTab';

const mockInvalidate = jest.fn();
const mockEngine = {
  clear: jest.fn(),
  getActivityIds: jest.fn(() => []),
  getStats: jest.fn(() => undefined),
  subscribe: jest.fn(() => () => {}),
};

// No locale is loaded here, so the translator answers with the key it was asked.
jest.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/activity', () => ({ useActivities: () => ({ data: [] }) }));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      oldest: '2026-01-01',
      newest: '2026-09-01',
      gpsSyncProgress: { status: 'idle', completed: 0, total: 0, percent: 0, message: '' },
      lastSyncTimestamp: null,
      isGpsSyncing: false,
    }),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => mockEngine }));
jest.mock('@/shared/storage/gpsStorage', () => ({ deleteGpsTracks: jest.fn() }));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

/** Tap Hard Re-sync, confirm it, and let the wipe settle. */
async function hardResync(): Promise<void> {
  let wipe: Promise<unknown> = Promise.resolve();
  mockEngine.clear.mockImplementation(() => {
    wipe = mockClearOutcome();
    return wipe;
  });
  (Alert.alert as jest.Mock).mockImplementation((_title, _body, buttons) => {
    buttons?.find((b: { style?: string }) => b.style === 'destructive')?.onPress?.();
  });
  const { getByText } = render(<SyncDebugTab />);
  fireEvent.press(getByText('Hard Re-sync'));
  await wipe.catch(() => {});
  await new Promise(process.nextTick);
}

let mockClearOutcome: () => Promise<void> = () => Promise.resolve();

describe('Hard Re-sync', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockInvalidate.mockReset();
    mockEngine.clear.mockReset();
  });

  it('says the engine could not be cleared when the wipe fails', async () => {
    mockClearOutcome = () => Promise.reject(new Error('Engine wipe did not finish in time'));

    await hardResync();

    expect(mockEngine.clear).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenLastCalledWith('alerts.error', 'alerts.failedToClear');
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  it('triggers the re-sync once the wipe lands', async () => {
    mockClearOutcome = () => Promise.resolve();

    await hardResync();

    expect(mockInvalidate).toHaveBeenCalledTimes(1);
    expect(Alert.alert).toHaveBeenLastCalledWith('Done', 'Engine cleared. Full re-sync triggered.');
  });
});
