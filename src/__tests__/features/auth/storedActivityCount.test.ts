/**
 * Scenario: a backup restored from the login screen leaves a full library and
 * the engine closed, and `getActivityCount()` on a closed engine answers 0.
 * `accountChangeAction` was then told there was nothing to lose, so Try Demo
 * seeded the demo fixtures into the restored library without asking and the
 * next sign-in wiped it without asking.
 *
 * Expected behaviour: the count a destructive path reads is the library's, not
 * the handle's. An open engine answers it, and a closed one is answered from
 * the mirror the restore leaves behind.
 */

import { resolveStoredActivityCount } from '@/features/auth/lib/storedActivityCount';
import {
  rememberStoredActivityCount,
  readStoredActivityCountMirror,
  forgetStoredActivityCount,
} from '@/shared/storage';
import { accountChangeAction } from '@/features/auth/lib/accountChange';
import { DEMO_ATHLETE_ID } from '@/shared/app/AuthStore';

const mockEngineState = { ready: false, count: 0 };

jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => mockEngineState.ready,
  getEngine: () => ({ getActivityCount: () => mockEngineState.count }),
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

describe('the count a destructive path reads', () => {
  beforeEach(() => {
    mockStore.clear();
    mockEngineState.ready = false;
    mockEngineState.count = 0;
  });

  it('comes from the engine when it is open', async () => {
    mockEngineState.ready = true;
    mockEngineState.count = 412;

    expect(await resolveStoredActivityCount()).toBe(412);
  });

  it('comes from the mirror when the engine is closed', async () => {
    await rememberStoredActivityCount(240);

    expect(await resolveStoredActivityCount()).toBe(240);
  });

  it('is zero on a device that has never held a library', async () => {
    expect(await resolveStoredActivityCount()).toBe(0);
  });

  it('prefers the open engine over a stale mirror', async () => {
    await rememberStoredActivityCount(240);
    mockEngineState.ready = true;
    mockEngineState.count = 0;

    expect(await resolveStoredActivityCount()).toBe(0);
  });

  it('is forgotten with the rest of the account data', async () => {
    await rememberStoredActivityCount(240);
    await forgetStoredActivityCount();

    expect(await readStoredActivityCountMirror()).toBe(0);
  });

  it('turns Try Demo over a restored library into a confirmation', async () => {
    await rememberStoredActivityCount(240);

    const count = await resolveStoredActivityCount();
    expect(accountChangeAction(null, DEMO_ATHLETE_ID, count)).toBe('confirm-then-wipe');
  });
});
