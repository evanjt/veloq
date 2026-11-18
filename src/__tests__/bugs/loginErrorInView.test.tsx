/**
 * Scenario: the athlete scrolls down to the API key button, taps it and the
 * server refuses the key.
 *
 * Expected behaviour: the error sits at the top of the card, so the screen
 * scrolls back to it. An error above the fold is an error nobody sees.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

import LoginScreen from '@/app/login';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => {
  const en = jest.requireActual('@/i18n/locales/en-GB.json');
  const lookup = (key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), en);
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
      t: (key: string, opts?: string | Record<string, unknown>) => {
        const raw = lookup(key);
        const options = typeof opts === 'object' && opts !== null ? opts : {};
        const fallback = typeof opts === 'string' ? opts : (options.defaultValue as string);
        let out = typeof raw === 'string' ? raw : (fallback ?? key);
        for (const [name, value] of Object.entries(options)) {
          out = out.replace(`{{${name}}}`, String(value));
        }
        return out;
      },
    }),
  };
});

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ clear: jest.fn() }),
}));

jest.mock('@/features/settings/hooks/exportIndex', () => ({
  useImportDatabaseBackup: () => ({ importDatabaseBackup: jest.fn(), importing: false }),
}));

// The engine is closed at the login screen on a cold start, so identity comes
// from the AsyncStorage mirror. That is the shape SB10 left behind.
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => false,
}));

let reportLoginError: ((message: string) => void) | null = null;
jest.mock('@/features/auth/hooks/useApiKeyLogin', () => ({
  useApiKeyLogin: ({ setError }: { setError: (message: string) => void }) => {
    reportLoginError = setError;
    return { handleApiKeyLogin: jest.fn(), isApiKeyLoading: false };
  },
}));

const scrollTo = jest.fn();

beforeEach(() => {
  scrollTo.mockClear();
  jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(scrollTo);
});

describe('a login error', () => {
  it('scrolls the screen back to the top so the error is in view', async () => {
    await render(<LoginScreen />);

    await act(() => reportLoginError?.('Invalid API key'));

    expect(screen.getByTestId('login-error-text')).toBeTruthy();
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it('does not scroll when there is no error', async () => {
    await render(<LoginScreen />);

    await act(() => reportLoginError?.('Invalid API key'));
    scrollTo.mockClear();
    await act(() => reportLoginError?.(null as never));

    expect(scrollTo).not.toHaveBeenCalled();
  });
});
