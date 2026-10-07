/**
 * Scenario: the athlete taps the demo banner to sign in, which signs them out
 * of demo mode at once and discards the fixtures after the navigation settles.
 * Expected behaviour: a discard that fails says so. The banner has already
 * gone, so a silent failure leaves the fixtures on disk with nothing on screen.
 */

import React from 'react';
import { Alert } from 'react-native';
import { stubIdleScheduler } from '../__shared__/idleScheduler';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { DemoBanner } from '@/shared/app/DemoBanner';

const mockClearDemoData = jest.fn();
const mockExitDemoMode = jest.fn();

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ isDemoMode: true, hideDemoBanner: false, exitDemoMode: mockExitDemoMode }),
}));
jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ reset: () => {} }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ clear: () => {} }),
}));
jest.mock('@/shared/storage', () => ({
  clearDemoData: (...args: unknown[]) => mockClearDemoData(...args),
}));

/** Tap the banner and let the deferred discard run to its end. */
async function tapAndSettle(): Promise<void> {
  const idle = stubIdleScheduler('immediate');
  try {
    const { getByTestId } = render(<DemoBanner />);
    fireEvent.press(getByTestId('demo-mode-banner'));
    await waitFor(() => expect(mockClearDemoData).toHaveBeenCalled());
    await act(async () => {});
  } finally {
    idle.restore();
  }
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
