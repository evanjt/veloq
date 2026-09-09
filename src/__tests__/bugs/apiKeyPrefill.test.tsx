/**
 * Scenario: a confirmed 401 signs an API-key athlete out. The login form has
 * one field, the key itself, and the athlete is standing there with a device
 * full of their own library and nothing to paste.
 *
 * Expected behaviour: the key that was in use comes back in the field, so a
 * key that still works is one tap and a regenerated one is a paste over the
 * top. It comes back only when the athlete the key belongs to is the athlete
 * whose library is on the device, so a device handed to someone else shows
 * nothing.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';

import LoginScreen from '@/app/login';
import { ApiKeyLoginForm } from '@/features/auth/components/ApiKeyLoginForm';
import { useAuthStore } from '@/shared/app/AuthStore';
import { rememberCachedAthleteId, forgetCachedAthleteId } from '@/shared/storage/cachedAthleteId';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => {
  const en = jest.requireActual('@/i18n/locales/en-GB.json');
  const lookup = (key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), en);
  return {
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

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => false,
}));

jest.mock('@/features/auth/hooks/useApiKeyLogin', () => ({
  useApiKeyLogin: () => ({ handleApiKeyLogin: jest.fn(), isApiKeyLoading: false }),
}));

const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;

const ATHLETE = 'i123456';
const STORED_KEY = 'stored-key-abc';

function keychain(entries: Record<string, string | null>) {
  mockGetItemAsync.mockImplementation(async (key) => entries[key] ?? null);
}

beforeEach(async () => {
  jest.clearAllMocks();
  keychain({});
  useAuthStore.setState({ sessionExpired: null });
  await forgetCachedAthleteId();
});

/** The screen reads the cached id and then the keychain, one microtask each. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function reEnter() {
  useAuthStore.setState({ sessionExpired: 'key_rejected' });
  render(<LoginScreen />);
  await settle();
}

describe('a re-entry after a rejected key', () => {
  it('brings the key back into the field', async () => {
    await rememberCachedAthleteId(ATHLETE);
    keychain({ intervals_api_key: STORED_KEY, intervals_api_key_athlete_id: ATHLETE });

    await reEnter();

    expect(screen.getByTestId('login-apikey-input').props.value).toBe(STORED_KEY);
  });

  it('opens the key section, or the prefill is behind a tap nobody knows to make', async () => {
    await rememberCachedAthleteId(ATHLETE);
    keychain({ intervals_api_key: STORED_KEY, intervals_api_key_athlete_id: ATHLETE });

    await reEnter();

    expect(screen.getByTestId('login-apikey-button')).toBeTruthy();
  });

  it('keeps the section shut when the key belongs to another athlete', async () => {
    await rememberCachedAthleteId(ATHLETE);
    keychain({ intervals_api_key: STORED_KEY, intervals_api_key_athlete_id: 'i999999' });

    await reEnter();

    expect(screen.queryByTestId('login-apikey-input')).toBeNull();
  });

  it('keeps the section shut when the device holds no library to match against', async () => {
    keychain({ intervals_api_key: STORED_KEY, intervals_api_key_athlete_id: ATHLETE });

    await reEnter();

    expect(screen.queryByTestId('login-apikey-input')).toBeNull();
  });

  it('keeps the section shut after an explicit sign-out, which deletes the key', async () => {
    await rememberCachedAthleteId(ATHLETE);
    keychain({});

    await reEnter();

    expect(screen.queryByTestId('login-apikey-input')).toBeNull();
  });
});

describe('a first sign-in', () => {
  it('leaves the field empty, because there is no re-entry to prefill', async () => {
    await rememberCachedAthleteId(ATHLETE);
    keychain({ intervals_api_key: STORED_KEY, intervals_api_key_athlete_id: ATHLETE });

    render(<LoginScreen />);
    await settle();

    expect(screen.queryByTestId('login-apikey-input')).toBeNull();
  });
});

describe('the form itself', () => {
  const noop = jest.fn();

  function renderForm(prefillApiKey: string | null) {
    return render(
      <ApiKeyLoginForm
        onLogin={noop}
        isLoading={false}
        disabled={false}
        onOpenDeveloperSettings={noop}
        prefillApiKey={prefillApiKey}
      />
    );
  }

  it('starts empty and shut without a prefill', () => {
    renderForm(null);

    expect(screen.queryByTestId('login-apikey-input')).toBeNull();
  });

  // The prefill resolves from the keychain a tick or two after the first
  // render, so it has to seed a field that is already on screen.
  it('seeds a field the athlete has not touched', () => {
    const { rerender } = renderForm(null);

    rerender(
      <ApiKeyLoginForm
        onLogin={noop}
        isLoading={false}
        disabled={false}
        onOpenDeveloperSettings={noop}
        prefillApiKey={STORED_KEY}
      />
    );

    expect(screen.getByTestId('login-apikey-input').props.value).toBe(STORED_KEY);
  });

  it('never types over what the athlete has already pasted', () => {
    renderForm(STORED_KEY);

    fireEvent.changeText(screen.getByTestId('login-apikey-input'), 'a-newer-key');

    expect(screen.getByTestId('login-apikey-input').props.value).toBe('a-newer-key');
  });
});
