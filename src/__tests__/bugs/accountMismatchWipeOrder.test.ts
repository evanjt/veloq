/**
 * Scenario: the engine holds athlete A's library, athlete B signs in, and B
 * takes `Clear & Sync` on the mismatch prompt.
 *
 * Expected behaviour: the new athlete id is written after the wipe has
 * finished, not while it is running. `EngineClient.clear()` starts the wipe on
 * a Rust thread, then destroys and re-opens the handle, so a `setSetting` that
 * overlaps it is wiped twice over and the fresh library ends up named by
 * nobody. The wipe takes the files the library left as well as its tables:
 * the decisions zip names athlete A and the device backup would carry it.
 */

import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';

import { promptAccountMismatch } from '@/features/auth/lib/accountChange';
import {
  readCachedAthleteIdMirror,
  rememberCachedAthleteId,
} from '@/shared/storage/cachedAthleteId';

/** What the engine did, in the order it happened. */
let trace: string[] = [];
let wipeSettles: () => void = () => {};

const mockEngine = {
  clear: jest.fn(),
  setSetting: jest.fn(),
  getSetting: jest.fn(),
  deleteSetting: jest.fn(),
  getAthleteProfile: jest.fn().mockReturnValue(''),
};

const mockClearCredentials = jest.fn();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  getRouteDbPath: () => '/data/routes.db',
  isEngineReady: () => true,
}));

// No locale is loaded here, so the translator answers with the key it was asked.
jest.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));

jest.mock('@/shared/app/AuthStore', () => ({
  DEMO_ATHLETE_ID: 'demo',
  useAuthStore: { getState: () => ({ clearCredentials: mockClearCredentials }) },
  releasePushRegistration: jest.fn(async () => undefined),
}));

/** Press the prompt's destructive or cancelling button. */
function press(label: 'cancel' | 'clear') {
  (Alert.alert as jest.Mock).mockImplementation((_title, _body, buttons) => {
    const button = buttons?.find((b: { style?: string }) =>
      label === 'cancel' ? b.style === 'cancel' : b.style === 'destructive'
    );
    button?.onPress?.();
  });
}

beforeEach(() => {
  trace = [];
  jest.mocked(FileSystem.deleteAsync).mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockClearCredentials.mockReset();
  mockEngine.setSetting.mockReset().mockImplementation((key: string) => trace.push(`set ${key}`));
  // The real clear() returns at its first await with the wipe still running on
  // a Rust thread, and only then destroys and re-opens the handle.
  mockEngine.clear.mockReset().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        trace.push('wipe started');
        wipeSettles = () => {
          trace.push('wipe finished');
          resolve();
        };
      })
  );
});

describe('Clear & Sync on the account mismatch prompt', () => {
  it('writes the new athlete id only after the wipe has finished', async () => {
    press('clear');

    const resolved = promptAccountMismatch({
      storedAthleteId: 'athlete-a',
      credentialsAthleteId: 'athlete-b',
      activityCount: 500,
    });
    // The wipe is in flight. Nothing may be written into a database being
    // emptied, and nothing may be written into the handle it is about to drop.
    await new Promise((resolve) => setImmediate(resolve));
    expect(trace).toEqual(['wipe started']);

    wipeSettles();
    await expect(resolved).resolves.toBe(true);

    // The wipe resets the notification consent once the handle is back.
    expect(trace).toEqual([
      'wipe started',
      'wipe finished',
      'set veloq-notification-preferences',
      'set __athlete_id',
    ]);
    expect(mockEngine.setSetting).toHaveBeenCalledWith('__athlete_id', 'athlete-b');
    await expect(readCachedAthleteIdMirror()).resolves.toBe('athlete-b');
  });

  it("deletes the previous athlete's decisions zip with the library", async () => {
    press('clear');
    mockEngine.clear.mockReset().mockResolvedValue(undefined);

    await expect(
      promptAccountMismatch({
        storedAthleteId: 'athlete-a',
        credentialsAthleteId: 'athlete-b',
        activityCount: 500,
      })
    ).resolves.toBe(true);

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///docs/veloq-decisions.zip', {
      idempotent: true,
    });
  });

  it("forgets the previous athlete's backups and where they went", async () => {
    press('clear');
    mockEngine.clear.mockReset().mockResolvedValue(undefined);
    mockEngine.deleteSetting.mockReset();

    await expect(
      promptAccountMismatch({
        storedAthleteId: 'athlete-a',
        credentialsAthleteId: 'athlete-b',
        activityCount: 500,
      })
    ).resolves.toBe(true);

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///docs/backups/', {
      idempotent: true,
    });
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('veloq-webdav-password');
    expect(mockEngine.deleteSetting).toHaveBeenCalledWith('__backup_backend');
    expect(mockEngine.deleteSetting).toHaveBeenCalledWith('__auto_backup_enabled');
  });

  it('signs the athlete out and touches nothing when the prompt is cancelled', async () => {
    press('cancel');

    await expect(
      promptAccountMismatch({
        storedAthleteId: 'athlete-a',
        credentialsAthleteId: 'athlete-b',
        activityCount: 500,
      })
    ).resolves.toBe(false);

    expect(mockClearCredentials).toHaveBeenCalled();
    expect(mockEngine.clear).not.toHaveBeenCalled();
    expect(mockEngine.setSetting).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });

  it('signs the athlete out, says so, and settles false when the wipe fails', async () => {
    press('clear');
    mockEngine.clear.mockReset().mockRejectedValue(new Error('Engine wipe did not finish in time'));
    await rememberCachedAthleteId('athlete-a');

    await expect(
      promptAccountMismatch({
        storedAthleteId: 'athlete-a',
        credentialsAthleteId: 'athlete-b',
        activityCount: 500,
      })
    ).resolves.toBe(false);

    expect(Alert.alert).toHaveBeenCalledWith('alerts.error', 'alerts.failedToClear');
    expect(mockClearCredentials).toHaveBeenCalledTimes(1);
    expect(mockEngine.setSetting).not.toHaveBeenCalled();
    await expect(readCachedAthleteIdMirror()).resolves.toBe('athlete-a');
  });
});
