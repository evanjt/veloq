/**
 * Scenario: connected but degraded. `isOnline` only says the radio is up, so a
 * captive portal or a sustained 5xx showed no banner and no error, which reads
 * as "I have no activities" rather than "the sync is failing".
 *
 * Expected behaviour: the banner appears whenever the engine holds a sync error
 * and the device believes it is online, naming the error and when the last sync
 * actually landed. It stays out of the way when the offline banner has the case.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { useAuthStore } from '@/shared/app/AuthStore';
import { SyncErrorBanner } from '@/shared/ui/SyncErrorBanner';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));

let mockIsOnline = true;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline, isInternetReachable: null, connectionType: null }),
}));

let mockHealth: { lastError: string | null; lastSuccessAt: string | null } = {
  lastError: null,
  lastSuccessAt: null,
};
jest.mock('@/shared/native/useSyncHealth', () => ({
  useSyncHealth: () => mockHealth,
}));

describe('SyncErrorBanner', () => {
  beforeEach(() => {
    mockIsOnline = true;
    mockHealth = { lastError: null, lastSuccessAt: null };
    useAuthStore.setState({ isAuthenticated: true });
  });

  it('stays hidden while the sync is healthy', () => {
    const { queryByTestId } = render(<SyncErrorBanner />);
    expect(queryByTestId('sync-error-banner')).toBeNull();
  });

  it('names the error when the device reads as online', () => {
    mockHealth = { lastError: 'HTTP 503 from intervals.icu', lastSuccessAt: null };
    const { getByTestId, getByText } = render(<SyncErrorBanner />);

    expect(getByTestId('sync-error-banner')).toBeTruthy();
    expect(getByText('HTTP 503 from intervals.icu')).toBeTruthy();
  });

  it('says no sync has ever landed when there is no success time', () => {
    mockHealth = { lastError: 'timed out', lastSuccessAt: null };
    const { getByText } = render(<SyncErrorBanner />);

    expect(getByText('emptyState.syncError.neverSynced')).toBeTruthy();
  });

  it('dates the last successful sync when there is one', () => {
    mockHealth = { lastError: 'timed out', lastSuccessAt: '2026-08-01T10:00:00.000Z' };
    const { getByText } = render(<SyncErrorBanner />);

    expect(getByText(/emptyState\.syncError\.lastSynced:/)).toBeTruthy();
  });

  it('defers to the offline banner when the device is offline', () => {
    mockIsOnline = false;
    mockHealth = { lastError: 'timed out', lastSuccessAt: null };
    const { queryByTestId } = render(<SyncErrorBanner />);

    expect(queryByTestId('sync-error-banner')).toBeNull();
  });

  it('says nothing to a signed-out user', () => {
    useAuthStore.setState({ isAuthenticated: false });
    mockHealth = { lastError: 'timed out', lastSuccessAt: null };
    const { queryByTestId } = render(<SyncErrorBanner />);

    expect(queryByTestId('sync-error-banner')).toBeNull();
  });

  it('hides again once a later sync clears the error', () => {
    mockHealth = { lastError: 'timed out', lastSuccessAt: null };
    const { queryByTestId, rerender } = render(<SyncErrorBanner />);
    expect(queryByTestId('sync-error-banner')).toBeTruthy();

    mockHealth = { lastError: null, lastSuccessAt: '2026-08-01T10:00:00.000Z' };
    rerender(<SyncErrorBanner />);
    expect(queryByTestId('sync-error-banner')).toBeNull();
  });
});
