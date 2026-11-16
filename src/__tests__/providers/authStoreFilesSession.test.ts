/**
 * Scenario: an athlete keeps a library filled from files, with no account, and
 * relaunches the app. Later they sign in, or delete everything.
 *
 * Expected behaviour: the choice survives a relaunch and reads as a files
 * session with no credential and no athlete id. A sign-in, a sign-out and
 * leaving the source each end it, and the engine holds no credential while it
 * lasts.
 */

import * as SecureStore from 'expo-secure-store';

import { useAuthStore } from '@/shared/app/AuthStore';
import { getEngine } from '@/shared/native/engine';
import { readFilesSession } from '@/shared/storage/filesSession';

jest.mock('@/features/recording/lib/holdRecordingOnSignOut', () => ({
  holdRecordingOnSignOut: jest.fn(async () => undefined),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const mockGetItemAsync = SecureStore.getItemAsync as jest.MockedFunction<
  typeof SecureStore.getItemAsync
>;
const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

function reset() {
  useAuthStore.setState({
    apiKey: null,
    accessToken: null,
    athleteId: null,
    athlete: null,
    isLoading: true,
    isAuthenticated: false,
    isDemoMode: false,
    authMethod: null,
    sessionExpired: null,
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockGetItemAsync.mockResolvedValue(null);
  mockGetEngine.mockReturnValue(null);
  reset();
  await useAuthStore.getState().exitFilesMode();
});

it('is a session with no credential and no athlete id', () => {
  useAuthStore.getState().enterFilesMode();

  expect(useAuthStore.getState()).toMatchObject({
    isAuthenticated: true,
    isDemoMode: false,
    authMethod: 'files',
    athleteId: null,
    apiKey: null,
    accessToken: null,
  });
});

it('hands the engine no credential, clearing one it held', () => {
  const engine = { setSyncCredentials: jest.fn(), clearSyncCredentials: jest.fn() };
  mockGetEngine.mockReturnValue(engine as never);

  useAuthStore.getState().enterFilesMode();

  expect(engine.clearSyncCredentials).toHaveBeenCalledTimes(1);
  expect(engine.setSyncCredentials).not.toHaveBeenCalled();
});

it('survives a relaunch', async () => {
  useAuthStore.getState().enterFilesMode();
  await Promise.resolve();
  reset();

  await useAuthStore.getState().initialise();

  expect(useAuthStore.getState()).toMatchObject({
    isLoading: false,
    isAuthenticated: true,
    authMethod: 'files',
    athleteId: null,
  });
});

it('is not a session on a device that never chose it', async () => {
  await useAuthStore.getState().initialise();

  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, authMethod: null });
});

it('ends when the athlete leaves it for the sign-in screen', async () => {
  useAuthStore.getState().enterFilesMode();
  await Promise.resolve();

  await useAuthStore.getState().exitFilesMode();

  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, authMethod: null });
  expect(await readFilesSession()).toBe(false);
});

it('ends at a sign-in, so a later relaunch reads that account', async () => {
  useAuthStore.getState().enterFilesMode();
  await Promise.resolve();

  await useAuthStore.getState().setCredentials('key', 'i1');

  expect(await readFilesSession()).toBe(false);
  expect(useAuthStore.getState()).toMatchObject({ authMethod: 'apiKey', athleteId: 'i1' });
});

it('ends at a sign-out that deletes the data', async () => {
  useAuthStore.getState().enterFilesMode();
  await Promise.resolve();

  await useAuthStore.getState().clearCredentials();

  expect(await readFilesSession()).toBe(false);
  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, authMethod: null });
});
