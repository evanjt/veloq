/**
 * Scenario: connected but degraded. `isOnline` only says the radio is up, so a
 * captive portal or a sustained 5xx showed no banner and no error, which reads
 * as "I have no activities" rather than "the sync is failing".
 *
 * Expected behaviour: the banner appears whenever the engine holds a sync error
 * and the offline banner is not up, naming the error and when the last sync
 * actually landed. It stays out of the way once the offline banner has the case.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { useAuthStore } from '@/shared/app/AuthStore';
import { SyncErrorBanner } from '@/shared/ui/SyncErrorBanner';
import { PausedSyncPill } from '@/shared/ui/StatusPills';
import { SyncErrorReason } from '../__shared__/veloqrsStub';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/shared/app/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}));

const mockRequestSyncRefresh = jest.fn();
jest.mock('@/shared/native/syncRefresh', () => ({
  requestSyncRefresh: () => mockRequestSyncRefresh(),
}));

let mockOfflineBannerShown = false;
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ offlineBannerShown: mockOfflineBannerShown }),
}));

let mockHealth: {
  lastError: string | null;
  lastErrorReason: SyncErrorReason | null;
  lastSuccessAt: string | null;
  retryAtMs?: number | null;
} = {
  lastError: null,
  lastErrorReason: null,
  lastSuccessAt: null,
};
jest.mock('@/shared/native/useSyncHealth', () => ({
  useSyncHealth: () => mockHealth,
}));

describe('SyncErrorBanner', () => {
  beforeEach(() => {
    mockOfflineBannerShown = false;
    mockRequestSyncRefresh.mockClear();
    mockHealth = {
      lastError: null,
      lastErrorReason: null,
      lastSuccessAt: null,
    };
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
  });

  it('stays hidden while the sync is healthy', async () => {
    const { queryByTestId } = await render(<SyncErrorBanner />);
    expect(queryByTestId('sync-error-banner')).toBeNull();
  });

  it('hides missing-credentials errors in demo mode', async () => {
    useAuthStore.setState({ isDemoMode: true });
    mockHealth = {
      lastError: 'No intervals.icu login stored',
      lastErrorReason: SyncErrorReason.NotConfigured,
      lastSuccessAt: null,
    };
    const { queryByTestId } = await render(<SyncErrorBanner />);

    expect(queryByTestId('sync-error-banner')).toBeNull();
  });

  it('names the error when the device reads as online', async () => {
    mockHealth = {
      lastError: 'HTTP 503 from intervals.icu',
      lastErrorReason: null,
      lastSuccessAt: null,
    };
    const { getByTestId, getByText } = await render(<SyncErrorBanner />);

    expect(getByTestId('sync-error-banner')).toBeTruthy();
    expect(getByText('HTTP 503 from intervals.icu')).toBeTruthy();
  });

  it('says no sync has ever landed when there is no success time', async () => {
    mockHealth = {
      lastError: 'timed out',
      lastErrorReason: null,
      lastSuccessAt: null,
    };
    const { getByText } = await render(<SyncErrorBanner />);

    expect(getByText('emptyState.syncError.neverSynced')).toBeTruthy();
  });

  it('dates the last successful sync when there is one', async () => {
    mockHealth = {
      lastError: 'timed out',
      lastErrorReason: null,
      lastSuccessAt: '2026-08-01T10:00:00.000Z',
    };
    const { getByText } = await render(<SyncErrorBanner />);

    expect(getByText(/emptyState\.syncError\.lastSynced:/)).toBeTruthy();
  });

  it('defers to the offline banner once it shows', async () => {
    mockOfflineBannerShown = true;
    mockHealth = {
      lastError: 'timed out',
      lastErrorReason: null,
      lastSuccessAt: null,
    };
    const { queryByTestId } = await render(<SyncErrorBanner />);

    expect(queryByTestId('sync-error-banner')).toBeNull();
  });

  it('says nothing to a signed-out user', async () => {
    useAuthStore.setState({ isAuthenticated: false });
    mockHealth = {
      lastError: 'timed out',
      lastErrorReason: null,
      lastSuccessAt: null,
    };
    const { queryByTestId } = await render(<SyncErrorBanner />);

    expect(queryByTestId('sync-error-banner')).toBeNull();
  });

  it.each([
    [SyncErrorReason.Unauthorized, 'unauthorized'],
    [SyncErrorReason.RateLimited, 'rateLimited'],
    [SyncErrorReason.Server, 'server'],
    [SyncErrorReason.Network, 'network'],
    [SyncErrorReason.Storage, 'storage'],
    [SyncErrorReason.NotConfigured, 'notConfigured'],
    [SyncErrorReason.Internal, 'internal'],
    [SyncErrorReason.StorageFull, 'storageFull'],
  ])('translates reason %s rather than printing the engine string', async (reason, key) => {
    mockHealth = {
      lastError: 'HTTP 503: upstream refused',
      lastErrorReason: reason,
      lastSuccessAt: null,
    };
    const { getByText, queryByText } = await render(<SyncErrorBanner />);

    expect(getByText(`emptyState.syncError.reason.${key}`)).toBeTruthy();
    expect(queryByText('HTTP 503: upstream refused')).toBeNull();
  });

  it('offers to free space when the device is full, and goes where space is freed', async () => {
    mockHealth = {
      lastError: 'device storage is full: athlete profile store failed',
      lastErrorReason: SyncErrorReason.StorageFull,
      lastSuccessAt: null,
    };
    const { getByTestId } = await render(<SyncErrorBanner />);

    await fireEvent.press(getByTestId('sync-error-free-space'));

    expect(router.push).toHaveBeenCalledWith('/cache-settings');
  });

  it.each([SyncErrorReason.Storage, SyncErrorReason.Network, null])(
    'offers no space action for reason %s',
    async (reason) => {
      mockHealth = { lastError: 'timed out', lastErrorReason: reason, lastSuccessAt: null };
      const { queryByTestId } = await render(<SyncErrorBanner />);

      expect(queryByTestId('sync-error-free-space')).toBeNull();
    }
  );

  describe('every fault has a next step', () => {
    it.each([
      SyncErrorReason.Network,
      SyncErrorReason.Server,
      SyncErrorReason.RateLimited,
      SyncErrorReason.Internal,
      SyncErrorReason.Storage,
      SyncErrorReason.EngineClosed,
      null,
      99 as SyncErrorReason,
    ])('offers Retry for reason %s, which asks the engine for a sync', async (reason) => {
      mockHealth = { lastError: 'failed', lastErrorReason: reason, lastSuccessAt: null };
      const { getByTestId, queryByTestId } = await render(<SyncErrorBanner />);

      expect(queryByTestId('sync-error-sign-in')).toBeNull();
      await fireEvent.press(getByTestId('sync-error-banner-retry'));

      expect(mockRequestSyncRefresh).toHaveBeenCalledTimes(1);
    });

    it.each([SyncErrorReason.Unauthorized, SyncErrorReason.NotConfigured])(
      'offers Sign in again for reason %s, and goes to the login screen',
      async (reason) => {
        mockHealth = { lastError: 'refused', lastErrorReason: reason, lastSuccessAt: null };
        const { getByTestId, queryByTestId } = await render(<SyncErrorBanner />);

        expect(queryByTestId('sync-error-banner-retry')).toBeNull();
        await fireEvent.press(getByTestId('sync-error-sign-in'));

        expect(router.push).toHaveBeenCalledWith('/login');
      }
    );

    it('keeps Free up space as the one action for a full device', async () => {
      mockHealth = {
        lastError: 'full',
        lastErrorReason: SyncErrorReason.StorageFull,
        lastSuccessAt: null,
      };
      const { getByTestId, queryByTestId } = await render(<SyncErrorBanner />);

      expect(getByTestId('sync-error-free-space')).toBeTruthy();
      expect(queryByTestId('sync-error-banner-retry')).toBeNull();
      expect(queryByTestId('sync-error-sign-in')).toBeNull();
    });
  });

  describe('closing the banner', () => {
    it.each([
      SyncErrorReason.Network,
      SyncErrorReason.Storage,
      SyncErrorReason.EngineClosed,
      SyncErrorReason.Unauthorized,
      SyncErrorReason.NotConfigured,
      SyncErrorReason.StorageFull,
      null,
    ])('can be closed for reason %s', async (reason) => {
      mockHealth = { lastError: 'failed', lastErrorReason: reason, lastSuccessAt: null };
      const { getByTestId, queryByTestId } = await render(<SyncErrorBanner />);

      await fireEvent.press(getByTestId('sync-error-banner-dismiss'));

      expect(queryByTestId('sync-error-banner')).toBeNull();
    });

    it('stays closed while the same reason is reported again', async () => {
      mockHealth = {
        lastError: 'disk I/O error',
        lastErrorReason: SyncErrorReason.Storage,
        lastSuccessAt: null,
      };
      const { getByTestId, queryByTestId, rerender } = await render(<SyncErrorBanner />);
      await fireEvent.press(getByTestId('sync-error-banner-dismiss'));

      mockHealth = { ...mockHealth, lastError: 'disk I/O error (retry 2)' };
      await rerender(<SyncErrorBanner />);

      expect(queryByTestId('sync-error-banner')).toBeNull();
    });

    it('shows again when the reason changes', async () => {
      mockHealth = {
        lastError: 'disk I/O error',
        lastErrorReason: SyncErrorReason.Storage,
        lastSuccessAt: null,
      };
      const { getByTestId, queryByTestId, rerender } = await render(<SyncErrorBanner />);
      await fireEvent.press(getByTestId('sync-error-banner-dismiss'));

      mockHealth = {
        lastError: 'refused',
        lastErrorReason: SyncErrorReason.Unauthorized,
        lastSuccessAt: null,
      };
      await rerender(<SyncErrorBanner />);

      expect(queryByTestId('sync-error-banner')).toBeTruthy();
    });

    it('shows again when a sync succeeds and then fails with the same reason', async () => {
      mockHealth = {
        lastError: 'disk I/O error',
        lastErrorReason: SyncErrorReason.Storage,
        lastSuccessAt: null,
      };
      const { getByTestId, queryByTestId, rerender } = await render(<SyncErrorBanner />);
      await fireEvent.press(getByTestId('sync-error-banner-dismiss'));

      mockHealth = {
        lastError: null,
        lastErrorReason: null,
        lastSuccessAt: '2026-08-01T10:00:00.000Z',
      };
      await rerender(<SyncErrorBanner />);
      mockHealth = {
        lastError: 'disk I/O error',
        lastErrorReason: SyncErrorReason.Storage,
        lastSuccessAt: '2026-08-01T10:00:00.000Z',
      };
      await rerender(<SyncErrorBanner />);

      expect(queryByTestId('sync-error-banner')).toBeTruthy();
    });

    it('shows again when a later sync succeeds between two failures of one reason', async () => {
      mockHealth = {
        lastError: 'disk I/O error',
        lastErrorReason: SyncErrorReason.Storage,
        lastSuccessAt: '2026-08-01T10:00:00.000Z',
      };
      const { getByTestId, queryByTestId, rerender } = await render(<SyncErrorBanner />);
      await fireEvent.press(getByTestId('sync-error-banner-dismiss'));

      // The success and the next failure land inside one render, so the
      // healthy reading is never drawn; the new success time still marks it.
      mockHealth = { ...mockHealth, lastSuccessAt: '2026-08-02T10:00:00.000Z' };
      await rerender(<SyncErrorBanner />);

      expect(queryByTestId('sync-error-banner')).toBeTruthy();
    });
  });

  /// A refusal from intervals.icu is not a fault on the device, and the
  /// engine resumes on its own at the time it names.
  it('leaves a pause until a time to the paused-sync pill, not a failure banner', async () => {
    const retryAtMs = new Date(2026, 2, 4, 14, 30).getTime();
    mockHealth = {
      lastError: 'Athlete: rate limited (429) after retries',
      lastErrorReason: SyncErrorReason.RateLimited,
      lastSuccessAt: null,
      retryAtMs,
    };
    const { getByTestId, getByText, queryByTestId, queryByText } = await render(
      <>
        <SyncErrorBanner />
        <PausedSyncPill />
      </>
    );

    expect(queryByTestId('sync-error-banner')).toBeNull();
    expect(queryByText('emptyState.syncError.title')).toBeNull();
    expect(queryByTestId('sync-error-banner-retry')).toBeNull();
    expect(getByText(/^emptyState\.syncError\.paused:\{"time":"[^"]+"\}$/)).toBeTruthy();
    expect(getByText('emptyState.syncError.pausedDetail')).toBeTruthy();
    expect(getByTestId('paused-sync-pill').props.accessibilityLiveRegion).toBe('polite');
  });

  it('falls back to the engine string for a reason it does not know', async () => {
    mockHealth = {
      lastError: 'something new the engine learnt to say',
      lastErrorReason: 99 as SyncErrorReason,
      lastSuccessAt: null,
    };
    const { getByText } = await render(<SyncErrorBanner />);

    expect(getByText('something new the engine learnt to say')).toBeTruthy();
  });

  it('still says something when the engine gives neither a reason nor a message', async () => {
    mockHealth = {
      lastError: '',
      lastErrorReason: SyncErrorReason.Internal,
      lastSuccessAt: null,
    };
    const { getByText } = await render(<SyncErrorBanner />);

    expect(getByText('emptyState.syncError.reason.internal')).toBeTruthy();
  });

  it('hides again once a later sync clears the error', async () => {
    mockHealth = {
      lastError: 'timed out',
      lastErrorReason: null,
      lastSuccessAt: null,
    };
    const { queryByTestId, rerender } = await render(<SyncErrorBanner />);
    expect(queryByTestId('sync-error-banner')).toBeTruthy();

    mockHealth = {
      lastError: null,
      lastErrorReason: null,
      lastSuccessAt: '2026-08-01T10:00:00.000Z',
    };
    await rerender(<SyncErrorBanner />);
    expect(queryByTestId('sync-error-banner')).toBeNull();
  });
});
