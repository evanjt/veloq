/**
 * Scenario: the athlete signs in on the login screen, and the root layout takes
 * them into the app only once the library's identity is settled.
 *
 * Expected behaviour: a settled identity redirects and stamps the athlete on
 * the library, a question still being asked holds the redirect, and an init
 * that gave up (a database from a newer build, an unwritable directory, no
 * path, no engine) still redirects, with no identity stamped, so the athlete
 * reaches the init banner rather than being held on the login screen.
 *
 * The launch is also where an empty library meets what the device holds
 * beside it. A wipe of another athlete's empty library takes that athlete's
 * decisions zip with it, and a zip a device backup brought back is offered
 * with its date, never applied, only when the engine's restore checks would
 * accept it, from the activity count read before the launch sync.
 *
 * Going to the background is the last moment the process is reliably alive, so
 * the root layout's AppState listener runs the background work (the basemap
 * sidecar flush, the autobackup check, the widget refresh) then and only then.
 *
 * A sign-in from the login screen, by either route, lands on the Feed once: the
 * root layout is the one owner of the way in, so the hook that signed the
 * athlete in issues no navigation of its own beside it, and the login screen is
 * not remounted on the way.
 */
import React from 'react';
import { Alert, AppState } from 'react-native';
import * as Notice from '@/shared/ui/Notice';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CallKind, validateCredentials } from 'veloqrs';

import { AuthGate } from '@/app/_layout';
import { useAuthStore } from '@/shared/app/AuthStore';
import { handleAppBackground } from '@/shared/app/appBackground';
import * as storage from '@/shared/storage';
import { rememberStoredActivityCount } from '@/shared/storage';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useApiKeyLogin } from '@/features/auth/hooks/useApiKeyLogin';
import { useOAuthLogin } from '@/features/auth/hooks/useOAuthLogin';
import * as oauth from '@/features/auth/lib/oauth';

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
    useSegments: () => ['login'],
    useRouter: () => router,
  };
});
const mockRouter = jest.requireMock<{ router: Record<string, jest.Mock> }>('expo-router').router;
const mockDismissTo = mockRouter.dismissTo;

jest.mock('veloqrs', () => ({
  ...require('../__shared__/veloqrsStub').withOverrides(),
  validateCredentials: jest.fn(),
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

function signedIn() {
  useAuthStore.setState({
    isLoading: false,
    isAuthenticated: true,
    authMethod: 'apiKey',
    apiKey: 'key',
    athleteId: 'i1',
    isDemoMode: false,
  });
}

function stamped(e: MockEngine | null): boolean {
  return (e?.setSetting.mock.calls ?? []).some(([key]) => key === '__athlete_id');
}

/** Settings for a library held by `athleteId`, with no other key set. */
function heldBy(athleteId: string) {
  return jest.fn((key: string) => (key === '__athlete_id' ? athleteId : undefined));
}

const ZIP_URI = 'file:///docs/veloq-decisions.zip';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({
    exists: false,
    isDirectory: false,
  } as never);
  mockEngineHolder.engine = engine();
  mockEngineHolder.path = '/data/routes.db';
  mockPrompt.mockReturnValue(new Promise<boolean>(() => {}));
  useWhatsNewStore.getState().setRestoreOffer(null);
  signedIn();
});

it('redirects once the identity is settled, and stamps it', async () => {
  await render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
  expect(stamped(mockEngineHolder.engine)).toBe(true);
});

it('holds the redirect while the athlete is asked whose library it is', async () => {
  mockEngineHolder.engine = engine({ getSetting: jest.fn(() => 'i-other') });
  await render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockPrompt).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mockDismissTo).not.toHaveBeenCalledWith('/');
});

it('writes the whole library to the stored-count mirror, not the GPS-backed set', async () => {
  mockEngineHolder.engine = engine({
    launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 7 })),
  });
  await render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
  expect(rememberStoredActivityCount).toHaveBeenCalledWith(7);
});

it("asks before wiping another athlete's library whose activities have no GPS", async () => {
  mockEngineHolder.engine = engine({
    getSetting: heldBy('i-other'),
    getActivityCount: jest.fn(() => 0),
    getStats: jest.fn(() => ({ activityCount: 0, libraryCount: 9 })),
    launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 9 })),
  });
  await render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockPrompt).toHaveBeenCalled());
  expect(mockEngineHolder.engine?.clear).not.toHaveBeenCalled();
});

it('redirects without a stamp when the init gives up', async () => {
  mockEngineHolder.engine = engine({
    initWithPath: jest.fn(() => false),
    initOutcome: jest.fn(() => 6),
  });
  await render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
  expect(stamped(mockEngineHolder.engine)).toBe(false);
});

it('redirects when there is no path to open the library at', async () => {
  mockEngineHolder.path = null;
  await render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
  expect(stamped(mockEngineHolder.engine)).toBe(false);
});

it('redirects when there is no engine at all', async () => {
  mockEngineHolder.engine = null;
  await render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
});

it("deletes the other athlete's decisions zip when launch wipes their empty library", async () => {
  mockEngineHolder.engine = engine({
    getSetting: heldBy('i-other'),
    getActivityCount: jest.fn(() => 0),
    getStats: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
    launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
  });
  await render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
  expect(mockEngineHolder.engine?.clear).toHaveBeenCalled();
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(ZIP_URI, { idempotent: true });
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///docs/backups/', {
    idempotent: true,
  });
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('veloq-webdav-password');
  expect(mockEngineHolder.engine?.deleteSetting).toHaveBeenCalledWith('__backup_backend');
  expect(mockEngineHolder.engine?.deleteSetting).toHaveBeenCalledWith('__auto_backup_enabled');
  // The wipe finished, so launch re-opened the library and stamped the new athlete.
  expect(mockEngineHolder.engine?.initWithPath).toHaveBeenCalledTimes(2);
  expect(stamped(mockEngineHolder.engine)).toBe(true);
});

it("stamps an older build's ownerless library recordings for the library's athlete before any wipe", async () => {
  mockEngineHolder.engine = engine({
    getSetting: heldBy('i-other'),
    getActivityCount: jest.fn(() => 0),
    getStats: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
    launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
  });
  await render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
  expect(mockAdoptOwnerlessRecordings).toHaveBeenCalledWith('i-other');
  const [stamped] = mockAdoptOwnerlessRecordings.mock.invocationCallOrder;
  const [wiped] = mockEngineHolder.engine!.clear.mock.invocationCallOrder;
  expect(stamped).toBeLessThan(wiped);
});

it("hands an older build's ownerless crash backup to the library's athlete before any wipe", async () => {
  mockEngineHolder.engine = engine({
    getSetting: heldBy('i-other'),
    getActivityCount: jest.fn(() => 0),
    getStats: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
    launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
  });
  await render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
  expect(mockAdoptOwnerless).toHaveBeenCalledWith('i-other');
  const [adopted] = mockAdoptOwnerless.mock.invocationCallOrder;
  const [wiped] = mockEngineHolder.engine!.clear.mock.invocationCallOrder;
  expect(adopted).toBeLessThan(wiped);
});

describe('the decisions zip a device backup brought back', () => {
  beforeEach(() => {
    jest
      .mocked(FileSystem.getInfoAsync)
      .mockImplementation(
        async (uri: string) =>
          (uri === ZIP_URI ? { exists: true, size: 4096 } : { exists: false }) as never
      );
  });

  it('is offered with its date on an empty library, and nothing from it is restored', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const notice = jest.spyOn(Notice, 'showNotice');
    mockEngineHolder.engine = engine({
      getSetting: heldBy('i1'),
      getActivityCount: jest.fn(() => 0),
      getStats: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
      launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
      checkRecordZip: jest.fn(async () => ({ writtenAt: '2026-06-01T08:30:00.000Z' })),
      restoreRecordZip: jest.fn(async () => ({ placed: 3, unplaced: 0, missingActivityIds: [] })),
    });
    await render(<AuthGate>{null}</AuthGate>);

    await waitFor(() => expect(useWhatsNewStore.getState().restoreOffer).not.toBeNull());
    expect(mockEngineHolder.engine?.checkRecordZip).toHaveBeenCalledWith(
      '/docs/veloq-decisions.zip'
    );
    expect(useWhatsNewStore.getState().restoreOffer).toEqual(
      expect.objectContaining({
        source: 'device',
        entry: expect.objectContaining({ id: ZIP_URI, timestamp: '2026-06-01T08:30:00.000Z' }),
      })
    );
    expect(mockEngineHolder.engine?.restoreRecordZip).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(notice).not.toHaveBeenCalled();
  });

  it("is not offered when the engine would refuse it as another athlete's", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockEngineHolder.engine = engine({
      getSetting: heldBy('i1'),
      getActivityCount: jest.fn(() => 0),
      getStats: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
      launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
      checkRecordZip: jest.fn(async () => {
        throw new Error('Record belongs to another athlete');
      }),
    });
    await render(<AuthGate>{null}</AuthGate>);

    await waitFor(() => expect(mockEngineHolder.engine?.checkRecordZip).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alert).not.toHaveBeenCalled();
    expect(useWhatsNewStore.getState().restoreOffer).toBeNull();
  });

  it('is not offered on a library that held activities before the launch sync', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockEngineHolder.engine = engine({ getSetting: heldBy('i1') });
    await render(<AuthGate>{null}</AuthGate>);

    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockEngineHolder.engine?.checkRecordZip).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
    expect(useWhatsNewStore.getState().restoreOffer).toBeNull();
  });
});

it('runs the background work when the app goes to the background, and not on a return', async () => {
  // react-native's own mock, read rather than spied: restoring a spy on a mock
  // strips its implementation, and every later render then gets no subscription.
  const addListener = jest.mocked(AppState.addEventListener);
  await render(<AuthGate>{null}</AuthGate>);
  await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));

  const fire = (state: string) => {
    for (const [event, listener] of addListener.mock.calls) {
      if (event === 'change') (listener as (s: string) => void)(state);
    }
  };

  fire('active');
  expect(handleAppBackground).not.toHaveBeenCalled();

  fire('background');
  expect(handleAppBackground).toHaveBeenCalledTimes(1);
});

describe('a sign-in from the login screen', () => {
  let mounts: number;
  let screen: { oauth: () => Promise<void>; apiKey: (key: string) => Promise<void> };

  function LoginScreen() {
    const setError = React.useCallback(() => {}, []);
    const { handleOAuthLogin } = useOAuthLogin({ setError });
    const { handleApiKeyLogin } = useApiKeyLogin({ setError });
    screen = { oauth: handleOAuthLogin, apiKey: handleApiKeyLogin };
    React.useEffect(() => {
      mounts += 1;
    }, []);
    return null;
  }

  async function renderLogin() {
    await render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthGate>
          <LoginScreen />
        </AuthGate>
      </QueryClientProvider>
    );
  }

  /** Every navigation that took the athlete to the Feed, whichever call made it. */
  function toFeed(): number {
    return [mockRouter.replace, mockDismissTo, mockRouter.push, mockRouter.navigate]
      .flatMap((call) => call.mock.calls)
      .filter(([path]) => path === '/').length;
  }

  beforeEach(() => {
    mounts = 0;
    useAuthStore.setState({
      isLoading: false,
      isAuthenticated: false,
      authMethod: null,
      apiKey: null,
      accessToken: null,
      athleteId: null,
      isDemoMode: false,
    } as never);
    jest.spyOn(storage, 'clearAuthOnly').mockResolvedValue(undefined);
    jest.spyOn(storage, 'clearAccountData').mockResolvedValue(undefined);
  });

  it('through intervals.icu lands on the Feed once', async () => {
    jest.spyOn(oauth, 'isOAuthConfigured').mockReturnValue(true);
    jest.spyOn(oauth, 'getAppRedirectUri').mockReturnValue('veloq://oauth/callback');
    jest.spyOn(oauth, 'startOAuthFlow').mockResolvedValue({
      outcome: 'success',
      url: 'veloq://oauth/callback?success=true&code=onetime&state=s',
    } as never);
    jest.spyOn(oauth, 'handleOAuthCallback').mockResolvedValue({
      access_token: 'token',
      athlete_id: 'i1',
      athlete_name: 'Ana',
      scope: 'ACTIVITY:READ',
    } as never);
    await renderLogin();

    await act(() => screen.oauth());

    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(useAuthStore.getState().authMethod).toBe('oauth');
    expect(toFeed()).toBe(1);
    expect(mounts).toBe(1);
  });

  it('with an API key lands on the Feed once', async () => {
    jest.mocked(validateCredentials).mockResolvedValue({ kind: CallKind.Ok, id: 'i1' } as never);
    await renderLogin();

    await act(() => screen.apiKey('a-valid-key'));

    await waitFor(() => expect(mockDismissTo).toHaveBeenCalledWith('/'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(useAuthStore.getState().authMethod).toBe('apiKey');
    expect(toFeed()).toBe(1);
    expect(mounts).toBe(1);
  });

  it('holds the way in while the athlete is asked whose library it is', async () => {
    mockEngineHolder.engine = engine({ getSetting: jest.fn(() => 'i-other') });
    jest.mocked(validateCredentials).mockResolvedValue({ kind: CallKind.Ok, id: 'i1' } as never);
    await renderLogin();

    await act(() => screen.apiKey('a-valid-key'));

    await waitFor(() => expect(mockPrompt).toHaveBeenCalled());
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(toFeed()).toBe(0);
  });
});
