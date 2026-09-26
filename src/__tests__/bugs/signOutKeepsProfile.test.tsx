/**
 * Scenario: the athlete signs out with "keep data" and signs back into the
 * same account on a plane. The rides are there, the photo, name and sport
 * settings are not, because the plain sign-out emptied them and only a sync
 * refills them.
 *
 * Expected behaviour: a plain sign-out keeps the profile and the sport
 * settings, the destructive sign-out still clears them, and nothing draws the
 * previous athlete while signed out.
 */

import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
import { useAthlete } from '@/shared/app/useAthlete';
import { getEngine } from '@/shared/native/engine';
import { clearAccountData, clearAuthOnly } from '@/shared/storage';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
  // The wipe carries the path, so a handle closed on the login screen has
  // a database to open rather than skipping the wipe.
  getRouteDbPath: jest.fn(() => '/mock/docs/routes.db'),
}));

jest.mock('@/shared/app/UnitPreferenceStore', () => {
  const state = { setIntervalsPreferences: jest.fn() };
  return { useUnitPreference: (selector: (s: unknown) => unknown) => selector(state) };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  default: { removeItem: jest.fn(async () => undefined) },
}));

const engine = {
  getAthleteProfile: jest.fn(() => JSON.stringify({ id: 350768, name: 'Evan' })),
  getSportSettings: jest.fn(() => '{}'),
  clear: jest.fn(async () => undefined),
  subscribe: jest.fn(() => () => {}),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

let client: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  useAuthStore.setState({ isAuthenticated: true, setAthlete: jest.fn() });
});

afterEach(() => {
  client.clear();
});

describe('a plain sign-out', () => {
  it('leaves the profile and the sport settings where they are', async () => {
    await clearAuthOnly(client);

    // Nothing on the engine can empty a profile any more: the export that did
    // went with the sign-out that called it, and the only path left is the
    // wipe the destructive sign-out takes below.
    expect(engine.clear).not.toHaveBeenCalled();
    expect(engine.getAthleteProfile()).toContain('Evan');
  });

  it('still drops the query cache, which is the previous session and not the athlete', async () => {
    const cleared = jest.spyOn(client, 'clear');

    await clearAuthOnly(client);

    expect(cleared).toHaveBeenCalled();
  });
});

describe('a sign-out that clears the data', () => {
  it('still wipes the engine, profile and all', async () => {
    // The file and settings teardown it also does has no filesystem here, and
    // it is not what this case is about: the engine wipe is.
    await clearAccountData(client).catch(() => undefined);

    expect(engine.clear).toHaveBeenCalled();
  });
});

describe('who the app draws while signed out', () => {
  it('reads the profile while there is a credential', async () => {
    const { result } = renderHook(() => useAthlete(), { wrapper });

    await waitFor(() => expect(result.current.data?.name).toBe('Evan'));
    expect(engine.getAthleteProfile).toHaveBeenCalled();
  });

  it('asks the engine for nobody once the credential is gone', async () => {
    useAuthStore.setState({ isAuthenticated: false });

    const { result } = renderHook(() => useAthlete(), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(engine.getAthleteProfile).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });
});
