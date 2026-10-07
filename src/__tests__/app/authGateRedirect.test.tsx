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
 * decisions zip with it, and a zip a device backup brought back is applied,
 * without asking, only when the engine's restore checks would accept it, from
 * the activity count read before the launch sync.
 *
 * Going to the background is the last moment the process is reliably alive, so
 * the root layout's AppState listener runs the background work (the basemap
 * sidecar flush, the autobackup check, the widget refresh) then and only then.
 */
import React from 'react';
import { Alert, AppState } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { render, waitFor } from '@testing-library/react-native';

import { AuthGate } from '@/app/_layout';
import { useAuthStore } from '@/shared/app/AuthStore';
import { handleAppBackground } from '@/shared/app/appBackground';
import { i18n } from '@/i18n';
import { rememberStoredActivityCount } from '@/shared/storage';

jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  rememberStoredActivityCount: jest.fn(async () => undefined),
}));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useSegments: () => ['login'],
  useRouter: () => ({ replace: mockReplace }),
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
    useUploadQueueProcessor: () => undefined,
  })
);
jest.mock('@/features/recording/hooks/useUploadQueueProcessor', () => ({
  useUploadQueueProcessor: () => undefined,
}));
jest.mock('@/features/routes/hooks/useRouteReoptimization', () => ({
  useRouteReoptimization: () => undefined,
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
    checkRecordZip: jest.fn(async () => undefined),
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
  signedIn();
});

it('redirects once the identity is settled, and stamps it', async () => {
  render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  expect(stamped(mockEngineHolder.engine)).toBe(true);
});

it('holds the redirect while the athlete is asked whose library it is', async () => {
  mockEngineHolder.engine = engine({ getSetting: jest.fn(() => 'i-other') });
  render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockPrompt).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mockReplace).not.toHaveBeenCalledWith('/');
});

it('writes the whole library to the stored-count mirror, not the GPS-backed set', async () => {
  mockEngineHolder.engine = engine({
    launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 7 })),
  });
  render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  expect(rememberStoredActivityCount).toHaveBeenCalledWith(7);
});

it("asks before wiping another athlete's library whose activities have no GPS", async () => {
  mockEngineHolder.engine = engine({
    getSetting: heldBy('i-other'),
    getActivityCount: jest.fn(() => 0),
    getStats: jest.fn(() => ({ activityCount: 0, libraryCount: 9 })),
    launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 9 })),
  });
  render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockPrompt).toHaveBeenCalled());
  expect(mockEngineHolder.engine?.clear).not.toHaveBeenCalled();
});

it('redirects without a stamp when the init gives up', async () => {
  mockEngineHolder.engine = engine({
    initWithPath: jest.fn(() => false),
    initOutcome: jest.fn(() => 6),
  });
  render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  expect(stamped(mockEngineHolder.engine)).toBe(false);
});

it('redirects when there is no path to open the library at', async () => {
  mockEngineHolder.path = null;
  render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  expect(stamped(mockEngineHolder.engine)).toBe(false);
});

it('redirects when there is no engine at all', async () => {
  mockEngineHolder.engine = null;
  render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
});

it("deletes the other athlete's decisions zip when launch wipes their empty library", async () => {
  mockEngineHolder.engine = engine({
    getSetting: heldBy('i-other'),
    getActivityCount: jest.fn(() => 0),
    getStats: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
    launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
  });
  render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
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
  render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
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
  render(<AuthGate>{null}</AuthGate>);

  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
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

  it('is applied without asking on an empty library the engine would restore it into', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const translate = jest.spyOn(i18n, 't').mockImplementation(((key: string) => key) as never);
    mockEngineHolder.engine = engine({
      getSetting: heldBy('i1'),
      getActivityCount: jest.fn(() => 0),
      getStats: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
      launchData: jest.fn(() => ({ activityCount: 0, libraryCount: 0 })),
      restoreRecordZip: jest.fn(async () => ({ placed: 3, unplaced: 0, missingActivityIds: [] })),
    });
    render(<AuthGate>{null}</AuthGate>);

    await waitFor(() => expect(alert).toHaveBeenCalled());
    translate.mockRestore();
    expect(mockEngineHolder.engine?.checkRecordZip).toHaveBeenCalledWith(
      '/docs/veloq-decisions.zip'
    );
    expect(mockEngineHolder.engine?.restoreRecordZip).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]).toEqual(['backup.restoreComplete', 'backup.recordRestored']);
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
    render(<AuthGate>{null}</AuthGate>);

    await waitFor(() => expect(mockEngineHolder.engine?.checkRecordZip).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(alert).not.toHaveBeenCalled();
  });

  it('is not offered on a library that held activities before the launch sync', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockEngineHolder.engine = engine({ getSetting: heldBy('i1') });
    render(<AuthGate>{null}</AuthGate>);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockEngineHolder.engine?.checkRecordZip).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });
});

it('runs the background work when the app goes to the background, and not on a return', async () => {
  const addListener = jest.spyOn(AppState, 'addEventListener');
  render(<AuthGate>{null}</AuthGate>);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));

  const fire = (state: string) => {
    for (const [event, listener] of addListener.mock.calls) {
      if (event === 'change') (listener as (s: string) => void)(state);
    }
  };

  fire('active');
  expect(handleAppBackground).not.toHaveBeenCalled();

  fire('background');
  expect(handleAppBackground).toHaveBeenCalledTimes(1);
  addListener.mockRestore();
});
