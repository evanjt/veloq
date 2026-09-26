/**
 * Scenario: the athlete taps the demo banner to sign in, which signs them out
 * of demo mode at once and discards the fixtures after the navigation settles.
 * Expected behaviour: a discard that fails says so. The banner has already
 * gone, so a silent failure leaves the fixtures on disk with nothing on screen.
 */

import React from 'react';
import { Alert, InteractionManager } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { DemoBanner } from '@/shared/app/DemoBanner';

const mockClearDemoData = jest.fn();
const mockExitDemoMode = jest.fn();

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ isDemoMode: true, hideDemoBanner: false, exitDemoMode: mockExitDemoMode }),
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ reset: () => {} }),
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: () => {} }) }));
jest.mock('@/shared/storage', () => ({
  clearDemoData: (...args: unknown[]) => mockClearDemoData(...args),
}));

/** Tap the banner and let the deferred discard run to its end. */
async function tapAndSettle(): Promise<void> {
  let deferred: Promise<unknown> = Promise.resolve();
  jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((task) => {
    deferred = Promise.resolve((task as () => unknown)());
    return { then: jest.fn(), done: jest.fn(), cancel: jest.fn() } as never;
  });
  const { getByTestId } = render(<DemoBanner />);
  fireEvent.press(getByTestId('demo-mode-banner'));
  await deferred;
}

describe('leaving demo mode from the banner', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockClearDemoData.mockReset();
    mockExitDemoMode.mockReset();
  });

  it('says the fixtures could not be cleared when the wipe fails', async () => {
    mockClearDemoData.mockRejectedValue(new Error('Engine wipe stopped without finishing (idle)'));

    await tapAndSettle();

    expect(mockExitDemoMode).toHaveBeenCalledTimes(1);
    expect(mockClearDemoData).toHaveBeenCalledTimes(1);
    // No locale is loaded here, so the translator answers with the key.
    expect(Alert.alert).toHaveBeenCalledWith('alerts.error', 'alerts.failedToClear');
  });

  it('says nothing when the wipe lands', async () => {
    mockClearDemoData.mockResolvedValue(undefined);

    await tapAndSettle();

    expect(mockClearDemoData).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
