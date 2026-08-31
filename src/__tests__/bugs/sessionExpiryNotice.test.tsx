/**
 * Scenario: an OAuth token expires or is revoked, so the athlete is dropped
 * back to the login screen with a full database still on the device.
 *
 * Expected behaviour: the expiry is not dressed as a login failure. It gets
 * its own notice, that notice says the activities, sections and settings are
 * still here, and it names the athlete a sign-in will restore. A genuine
 * login failure keeps the red error slot to itself.
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';

import LoginScreen from '@/app/login';
import { useAuthStore } from '@/shared/app/AuthStore';
import { rememberCachedAthleteId, forgetCachedAthleteId } from '@/shared/storage/cachedAthleteId';

jest.mock('react-i18next', () => {
  const en = jest.requireActual('@/i18n/locales/en-GB.json');
  const lookup = (key: string): unknown =>
    key.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as never)[k]), en);
  return {
    useTranslation: () => ({
      t: (key: string, opts?: unknown) => {
        const raw = lookup(key);
        const options = typeof opts === 'object' && opts !== null ? (opts as never) : {};
        const fallback = typeof opts === 'string' ? opts : options['defaultValue'];
        let out: string = typeof raw === 'string' ? raw : ((fallback as string) ?? key);
        for (const [name, value] of Object.entries(options)) {
          out = out.replace(`{{${name}}}`, String(value));
        }
        return out;
      },
    }),
  };
});

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ clear: jest.fn() }) }));

jest.mock('@/features/settings/hooks/exportIndex', () => ({
  useImportDatabaseBackup: () => ({ importDatabaseBackup: jest.fn(), importing: false }),
}));

jest.mock('@/features/auth/hooks/useBackupRestore', () => ({
  useBackupRestore: () => ({
    detectedBackup: null,
    restoringDetected: false,
    dismissedRestore: false,
    setDismissedRestore: jest.fn(),
    handleRestoreDetected: jest.fn(),
  }),
}));

// The engine is closed at the login screen on a cold start, so identity comes
// from the AsyncStorage mirror. That is the shape SB10 left behind.
jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => null,
  isRouteEngineReady: () => false,
}));

let reportLoginError: ((message: string) => void) | null = null;
jest.mock('@/features/auth/hooks/useApiKeyLogin', () => ({
  useApiKeyLogin: ({ setError }: { setError: (message: string) => void }) => {
    reportLoginError = setError;
    return { handleApiKeyLogin: jest.fn(), isApiKeyLoading: false };
  },
}));

const ATHLETE = 'i123456';

beforeEach(async () => {
  reportLoginError = null;
  useAuthStore.setState({ sessionExpired: null });
  await forgetCachedAthleteId();
});

async function showExpiry(reason: 'token_expired' | 'token_revoked') {
  useAuthStore.setState({ sessionExpired: reason });
  render(<LoginScreen />);
  await waitFor(() => expect(screen.getByTestId('login-session-notice')).toBeTruthy());
}

describe('an expired session', () => {
  it('does not use the login failure slot', async () => {
    await rememberCachedAthleteId(ATHLETE);
    await showExpiry('token_expired');

    expect(screen.queryByTestId('login-error-text')).toBeNull();
  });

  it('says the library is still on the device', async () => {
    await rememberCachedAthleteId(ATHLETE);
    await showExpiry('token_expired');

    expect(
      screen.getByText('Your activities, sections and settings are still on this device.')
    ).toBeTruthy();
  });

  it('names the athlete a sign-in restores', async () => {
    await rememberCachedAthleteId(ATHLETE);
    await showExpiry('token_expired');

    expect(screen.getByText(`Sign in again as ${ATHLETE} to get them back.`)).toBeTruthy();
  });

  it('still reassures when the mirror holds no athlete', async () => {
    await showExpiry('token_expired');

    expect(
      screen.getByText('Your activities, sections and settings are still on this device.')
    ).toBeTruthy();
    expect(screen.getByText('Sign in again to get them back.')).toBeTruthy();
    expect(screen.queryByText(/as i/)).toBeNull();
  });

  it('separates a revoked token from an expired one', async () => {
    await rememberCachedAthleteId(ATHLETE);
    await showExpiry('token_revoked');

    expect(screen.getByText('Your access was revoked.')).toBeTruthy();
    expect(screen.queryByText('Your session has expired.')).toBeNull();
  });

  it('clears the flag so a later visit to the screen is clean', async () => {
    await rememberCachedAthleteId(ATHLETE);
    await showExpiry('token_expired');

    expect(useAuthStore.getState().sessionExpired).toBeNull();

    screen.unmount();
    render(<LoginScreen />);
    await waitFor(() => expect(screen.queryByTestId('login-session-notice')).toBeNull());
  });
});

describe('a login failure', () => {
  it('keeps the red error slot to itself', async () => {
    await rememberCachedAthleteId(ATHLETE);
    render(<LoginScreen />);

    act(() => reportLoginError?.('Invalid API key'));

    expect(screen.getByTestId('login-error-text')).toHaveTextContent('Invalid API key');
    expect(screen.queryByTestId('login-session-notice')).toBeNull();
  });

  it('takes the slot back from a notice that came first', async () => {
    await rememberCachedAthleteId(ATHLETE);
    await showExpiry('token_expired');

    act(() => reportLoginError?.('Invalid API key'));

    expect(screen.queryByTestId('login-session-notice')).toBeNull();
    expect(screen.getByTestId('login-error-text')).toHaveTextContent('Invalid API key');
  });

  it('does not survive an expiry that arrives after it', async () => {
    await rememberCachedAthleteId(ATHLETE);
    render(<LoginScreen />);
    act(() => reportLoginError?.('Invalid API key'));

    act(() => useAuthStore.setState({ sessionExpired: 'token_expired' }));

    await waitFor(() => expect(screen.getByTestId('login-session-notice')).toBeTruthy());
    expect(screen.queryByTestId('login-error-text')).toBeNull();
  });
});
