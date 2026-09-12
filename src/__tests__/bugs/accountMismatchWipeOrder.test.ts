/**
 * Scenario: the engine holds athlete A's library, athlete B signs in, and B
 * takes `Clear & Sync` on the mismatch prompt.
 *
 * Expected behaviour: the new athlete id is written after the wipe has
 * finished, not while it is running. `EngineClient.clear()` starts the wipe on
 * a Rust thread, then destroys and re-opens the handle, so a `setSetting` that
 * overlaps it is wiped twice over and the fresh library ends up named by
 * nobody.
 */

import { Alert } from 'react-native';

import { promptAccountMismatch } from '@/features/auth/lib/accountChange';
import { readCachedAthleteIdMirror } from '@/shared/storage/cachedAthleteId';

/** What the engine did, in the order it happened. */
let trace: string[] = [];
let wipeSettles: () => void = () => {};

const mockEngine = {
  clear: jest.fn(),
  setSetting: jest.fn(),
  getSetting: jest.fn(),
  getAthleteProfile: jest.fn().mockReturnValue(''),
};

const mockClearCredentials = jest.fn();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => true,
}));

jest.mock('@/shared/app/AuthStore', () => ({
  DEMO_ATHLETE_ID: 'demo',
  useAuthStore: { getState: () => ({ clearCredentials: mockClearCredentials }) },
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
    });
    // The wipe is in flight. Nothing may be written into a database being
    // emptied, and nothing may be written into the handle it is about to drop.
    await Promise.resolve();
    expect(trace).toEqual(['wipe started']);

    wipeSettles();
    await expect(resolved).resolves.toBe(true);

    expect(trace).toEqual(['wipe started', 'wipe finished', 'set __athlete_id']);
    expect(mockEngine.setSetting).toHaveBeenCalledWith('__athlete_id', 'athlete-b');
    await expect(readCachedAthleteIdMirror()).resolves.toBe('athlete-b');
  });

  it('signs the athlete out and touches nothing when the prompt is cancelled', async () => {
    press('cancel');

    await expect(
      promptAccountMismatch({ storedAthleteId: 'athlete-a', credentialsAthleteId: 'athlete-b' })
    ).resolves.toBe(false);

    expect(mockClearCredentials).toHaveBeenCalled();
    expect(mockEngine.clear).not.toHaveBeenCalled();
    expect(mockEngine.setSetting).not.toHaveBeenCalled();
  });
});
