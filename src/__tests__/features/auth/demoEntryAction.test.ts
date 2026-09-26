/**
 * Scenario: a backup restored from the login screen leaves a full library that
 * no credential names, and the engine closed. `getActivityCount()` on a closed
 * handle answers 0, the same as an empty device, so Try Demo decided there was
 * nothing to lose: it seeded the demo fixtures into the restored library
 * without asking, and the sign-in after that wiped it without asking either.
 *
 * Expected behaviour: Try Demo over a library it cannot name asks first, and
 * over a device that holds nothing it still does not.
 */

import { demoEntryAction } from '@/features/auth/lib/storedActivityCount';
import { rememberStoredActivityCount } from '@/shared/storage';

const mockEngineState = { ready: false, count: 0, athleteId: '' };

jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => mockEngineState.ready,
  getEngine: () => ({
    getActivityCount: () => mockEngineState.count,
    getAthleteProfile: () => '',
    getSetting: () => mockEngineState.athleteId,
  }),
}));

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  removeItem: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));

describe('Try Demo', () => {
  beforeEach(() => {
    mockStore.clear();
    mockEngineState.ready = false;
    mockEngineState.count = 0;
    mockEngineState.athleteId = '';
  });

  it('asks before seeding over a library restored while the engine was closed', async () => {
    await rememberStoredActivityCount(240);

    expect(await demoEntryAction()).toBe('confirm-then-wipe');
  });

  it('does not ask on a device that holds nothing', async () => {
    expect(await demoEntryAction()).toBe('keep');
  });

  it('still asks when the engine is open and holds the library itself', async () => {
    mockEngineState.ready = true;
    mockEngineState.count = 412;

    expect(await demoEntryAction()).toBe('confirm-then-wipe');
  });

  it('does not ask when the engine is open and empty, whatever a stale mirror says', async () => {
    await rememberStoredActivityCount(240);
    mockEngineState.ready = true;
    mockEngineState.count = 0;

    expect(await demoEntryAction()).toBe('keep');
  });
});
