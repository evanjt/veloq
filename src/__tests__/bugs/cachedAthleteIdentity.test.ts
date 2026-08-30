/**
 * Scenario: the login screen on a cold start, where the engine never
 * initialised because there are no credentials.
 *
 * Expected behaviour: `getCachedAthleteId` still names the account whose data
 * is on disk, so the destructive demo and account-switch paths ask first.
 *
 * The engine mock models production: `getRouteEngine` hands back a singleton
 * that exists from the first require and is never null once the native module
 * loads, and readiness is a separate flag. A mock that returns null for the
 * not-ready case tests a shape the app never has.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  rememberCachedAthleteId,
  forgetCachedAthleteId,
  readCachedAthleteIdMirror,
} from '@/shared/storage/cachedAthleteId';
import { accountChangeAction, getCachedAthleteId } from '@/features/auth/lib/accountChange';

const mockEngine = {
  getAthleteProfile: jest.fn(),
  getSetting: jest.fn(),
};
let mockEngineReady = true;

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => mockEngine,
  isRouteEngineReady: () => mockEngineReady,
}));

describe('getCachedAthleteId', () => {
  beforeEach(async () => {
    mockEngineReady = true;
    mockEngine.getAthleteProfile.mockReset().mockReturnValue('');
    mockEngine.getSetting.mockReset().mockReturnValue(undefined);
    await AsyncStorage.clear();
  });

  it('reads the profile blob when the engine is up', async () => {
    mockEngine.getAthleteProfile.mockReturnValue(JSON.stringify({ id: 42 }));
    await expect(getCachedAthleteId()).resolves.toBe('42');
  });

  it('mirrors the engine identity so a later cold start can read it', async () => {
    mockEngine.getAthleteProfile.mockReturnValue(JSON.stringify({ id: 42 }));
    await getCachedAthleteId();
    await expect(readCachedAthleteIdMirror()).resolves.toBe('42');
  });

  it('falls back to __athlete_id when the profile blob was dropped', async () => {
    mockEngine.getSetting.mockReturnValue('42');
    await expect(getCachedAthleteId()).resolves.toBe('42');
  });

  it('reads the mirror when the engine is not ready', async () => {
    await rememberCachedAthleteId('42');
    mockEngineReady = false;
    await expect(getCachedAthleteId()).resolves.toBe('42');
  });

  it('reports no cached account once the mirror is cleared', async () => {
    await rememberCachedAthleteId('42');
    await forgetCachedAthleteId();
    mockEngineReady = false;
    await expect(getCachedAthleteId()).resolves.toBeNull();
  });

  it('does not ask an unready engine, which answers empty by contract', async () => {
    await rememberCachedAthleteId('42');
    mockEngineReady = false;
    await expect(getCachedAthleteId()).resolves.toBe('42');
    expect(mockEngine.getAthleteProfile).not.toHaveBeenCalled();
    expect(mockEngine.getSetting).not.toHaveBeenCalled();
  });

  it('falls back to the mirror when the engine is up but holds no identity', async () => {
    await rememberCachedAthleteId('42');
    await expect(getCachedAthleteId()).resolves.toBe('42');
  });

  it('reports no cached account when neither the engine nor the mirror has one', async () => {
    await expect(getCachedAthleteId()).resolves.toBeNull();
  });
});

/**
 * What a sign-in owes the data already on the device. The rule lives in one
 * place because three screens ask it: the two login paths and `Try demo`.
 */
describe('accountChangeAction', () => {
  it('keeps the library when the same athlete signs in again', () => {
    expect(accountChangeAction('42', '42')).toBe('keep');
  });

  it('keeps it when the device holds no account at all', () => {
    expect(accountChangeAction(null, '42')).toBe('keep');
  });

  it('confirms before wiping another real account', () => {
    expect(accountChangeAction('42', '7')).toBe('confirm-then-wipe');
  });

  it('wipes demo fixtures without asking, they are not an account', () => {
    expect(accountChangeAction('demo', '42')).toBe('wipe');
  });

  it('still confirms when a real account meets demo entry', () => {
    expect(accountChangeAction('42', 'demo')).toBe('confirm-then-wipe');
  });

  it('keeps demo fixtures when demo is re-entered', () => {
    expect(accountChangeAction('demo', 'demo')).toBe('keep');
  });
});
