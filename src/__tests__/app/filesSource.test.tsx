/**
 * Scenario: an athlete enters the files source from the sign-in screen, with no
 * account and no credential, to fill the library from activity files.
 *
 * Expected behaviour: the root layout opens the library, moves the ready count
 * that joins the linked browser's rooms, and lands on the tabs instead of
 * redirecting to the login screen. No credential reaches the engine. An athlete
 * who signs in over that library later keeps every row, and is asked nothing,
 * because the library names nobody.
 */
import React from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import { act, render, waitFor } from '@testing-library/react-native';

import { AuthGate } from '@/app/_layout';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';
import { rememberStoredActivityCount } from '@/shared/storage';
import { launchIdentityAction } from '@/features/auth/lib/launchIdentity';

jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  rememberStoredActivityCount: jest.fn(async () => undefined),
}));

// One router, as expo-router hands out: the hooks reach it through the module's
// `router` and the root layout through `useRouter`.
jest.mock('expo-router', () => {
  const router = {
    replace: jest.fn(),
    dismissTo: jest.fn(),
    dismissAll: jest.fn(),
    push: jest.fn(),
    navigate: jest.fn(),
    canGoBack: jest.fn(() => false),
  };
  return {
    ...jest.requireActual('expo-router'),
    router,
    useSegments: () => mockSegments.current,
    useRouter: () => router,
  };
});
const mockSegments: { current: string[] } = { current: ['login'] };
const mockRouter = jest.requireMock<{ router: Record<string, jest.Mock> }>('expo-router').router;
const mockDismissTo = mockRouter.dismissTo;

jest.mock('veloqrs', () => ({
  ...require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() => mockEngineHolder.engine)
  ),
}));
jest.mock('@/features/auth/lib/loginLibrary', () => ({
  resolveLoginLibrary: jest.fn(async () => 'keep'),
}));
jest.mock('@/shared/app/NetworkContext', () => ({
  ...jest.requireActual('@/shared/app/NetworkContext'),
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));

const mockPrompt = jest.fn();
jest.mock('@/features/auth', () => ({
  ...jest.requireActual('@/features/auth/lib/launchIdentity'),
  promptAccountMismatch: () => mockPrompt(),
  getCachedAthleteId: async () => mockEngineHolder.engine?.getSetting('__athlete_id') ?? null,
  nameLibrary: jest.requireActual('@/features/auth/lib/accountChange').nameLibrary,
}));

type MockEngine = Record<string, jest.Mock>;
const mockEngineHolder: { engine: MockEngine | null; path: string | null } = {
  engine: null,
  path: '/data/routes.db',
};
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngineHolder.engine,
  getRouteDbPath: () => mockEngineHolder.path,
  isEngineReady: () => mockEngineHolder.engine !== null,
}));

const mockAdoptOwnerless = jest.fn(async (_athleteId: string | null) => undefined);
const mockAdoptOwnerlessRecordings = jest.fn(async (_athleteId: string | null) => undefined);
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    adoptOwnerlessRecordings: async (libraryAthlete: () => Promise<string | null>) =>
      mockAdoptOwnerlessRecordings(await libraryAthlete()),
    adoptOwnerlessRecordingBackup: async (libraryAthlete: () => Promise<string | null>) =>
      mockAdoptOwnerless(await libraryAthlete()),
    settleOwnerlessAdoptions: jest.fn(async () => undefined),
    RecordingTitle: () => null,
    resumeHeldRecordingForAthlete: jest.fn(async () => null),
    startUploadQueue: jest.fn(async () => undefined),
  })
);
jest.mock('@/features/routes/hooks/useRouteReoptimisation', () => ({
  useRouteReoptimisation: () => undefined,
}));
jest.mock('@/features/routes/hooks/useRouteSettingsFollowsEngine', () => ({
  useRouteSettingsFollowsEngine: () => undefined,
}));
jest.mock('@/shared/app/appBackground', () => ({ handleAppBackground: jest.fn() }));
jest.mock('@/features/settings/lib/autobackup', () => ({
  onAppForeground: jest.fn(),
  initWebdavConfig: jest.fn(async () => undefined),
}));

function engine(overrides: Partial<MockEngine> = {}): MockEngine {
  return {
    initWithPath: jest.fn(() => true),
    initOutcome: jest.fn(() => 1),
    getSetting: jest.fn(() => 'i1'),
    setSetting: jest.fn(),
    deleteSetting: jest.fn(),
    getActivityCount: jest.fn(() => 5),
    getStats: jest.fn(() => ({ activityCount: 5, libraryCount: 5 })),
    launchData: jest.fn(() => ({ activityCount: 5, libraryCount: 5 })),
    setSyncCredentials: jest.fn(),
    clearSyncCredentials: jest.fn(),
    clear: jest.fn(async () => undefined),
    checkRecordZip: jest.fn(async () => ({})),
    ...overrides,
  };
}

function stamped(e: MockEngine | null): boolean {
  return (e?.setSetting.mock.calls ?? []).some(([key]) => key === '__athlete_id');
}

function noCredentials() {
  useAuthStore.setState({
    isLoading: false,
    isAuthenticated: false,
    isDemoMode: false,
    authMethod: null,
    apiKey: null,
    accessToken: null,
    athleteId: null,
  } as never);
}

/** The library of a device that has only ever held files: it names no athlete. */
function unnamedLibrary(overrides: Partial<MockEngine> = {}): MockEngine {
  return engine({ getSetting: jest.fn(() => undefined), ...overrides });
}

function toLogin(): number {
  return [mockRouter.replace, mockRouter.navigate, mockRouter.push, mockDismissTo]
    .flatMap((call) => call.mock.calls)
    .filter(([path]) => path === '/login').length;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ advanceTimers: true });
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({
    exists: false,
    isDirectory: false,
  } as never);
  mockEngineHolder.engine = unnamedLibrary();
  mockEngineHolder.path = '/data/routes.db';
  mockSegments.current = ['login'];
  mockPrompt.mockReturnValue(new Promise<boolean>(() => {}));
  noCredentials();
});

afterEach(() => {
  jest.useRealTimers();
});

it('opens the library and takes the athlete to the tabs, with no credential', async () => {
  await render(<AuthGate>{null}</AuthGate>);

  await act(async () => {
    useAuthStore.getState().enterFilesMode();
  });

  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
  const held = mockEngineHolder.engine!;
  expect(held.initWithPath).toHaveBeenCalledTimes(1);
  expect(useEngineStatus.getState().readyNonce).toBeGreaterThan(0);
  expect(held.clear).not.toHaveBeenCalled();
  expect(stamped(held)).toBe(false);
  expect(held.setSyncCredentials).not.toHaveBeenCalled();
});

it('stays on the tabs rather than redirecting to the login screen', async () => {
  mockSegments.current = ['(tabs)'];
  await render(<AuthGate>{null}</AuthGate>);

  await act(async () => {
    useAuthStore.getState().enterFilesMode();
  });
  await waitFor(() => expect(mockEngineHolder.engine!.initWithPath).toHaveBeenCalled());
  await act(async () => {
    jest.advanceTimersByTime(500);
  });

  expect(toLogin()).toBe(0);
});

it('sends an athlete with no session to the login screen, as before', async () => {
  mockSegments.current = ['(tabs)'];
  await render(<AuthGate>{null}</AuthGate>);

  await act(async () => {
    jest.advanceTimersByTime(500);
  });

  expect(toLogin()).toBe(1);
  expect(mockEngineHolder.engine!.initWithPath).not.toHaveBeenCalled();
});

it('keeps every row when an athlete signs in over the library, and names it for them', async () => {
  await render(<AuthGate>{null}</AuthGate>);
  await act(async () => {
    useAuthStore.getState().enterFilesMode();
  });
  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));

  await act(async () => {
    await useAuthStore.getState().exitFilesMode();
  });
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(useAuthStore.getState().authMethod).toBeNull();

  mockDismissTo.mockClear();
  await act(async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      authMethod: 'apiKey',
      apiKey: 'key',
      athleteId: 'i1',
    });
  });

  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
  const held = mockEngineHolder.engine!;
  expect(launchIdentityAction(undefined, 'i1', 5)).toBe('proceed');
  expect(held.clear).not.toHaveBeenCalled();
  expect(mockPrompt).not.toHaveBeenCalled();
  expect(stamped(held)).toBe(true);
  expect(rememberStoredActivityCount).toHaveBeenCalledWith(5);
});
