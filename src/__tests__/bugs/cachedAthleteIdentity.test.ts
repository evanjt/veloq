/**
 * Scenario: the login screen on a cold start, where the engine never
 * initialised because there are no credentials.
 *
 * Expected behaviour: `getCachedAthleteId` still names the account whose data
 * is on disk, so the destructive demo and account-switch paths ask first.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  rememberCachedAthleteId,
  forgetCachedAthleteId,
  readCachedAthleteIdMirror,
} from '@/shared/storage/cachedAthleteId';
import { getCachedAthleteId } from '@/features/auth/lib/accountChange';

const mockEngine = {
  getAthleteProfile: jest.fn(),
  getSetting: jest.fn(),
};
let mockEngineReady = true;

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => (mockEngineReady ? mockEngine : null),
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
});
