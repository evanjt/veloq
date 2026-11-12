/**
 * Scenario: an intervals.icu sign-in adopted a Garmin library and the athlete
 * signed out, keeping the Garmin key. The login screen then has the engine
 * closed, and a Garmin sign-in by the same account meets a library named for
 * intervals.icu.
 *
 * Expected behaviour: the account the library was adopted from is read from the
 * engine when it is open and from its device mirror when it is not, so that
 * sign-in keeps the library rather than asking to delete it.
 */

import { resolveLoginLibrary } from '@/features/auth/lib/loginLibrary';
import {
  accountChangeAction,
  getGarminLibraryId,
  nameLibrary,
  recordConnectedGarminAccount,
} from '@/features/auth/lib/accountChange';
import { rememberCachedAthleteId } from '@/shared/storage/cachedAthleteId';
import { confirmAction } from '@/shared/ui/dialog';

const mockEngineState = { ready: false, settings: new Map<string, string>(), count: 0 };

jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => mockEngineState.ready,
  getEngine: () => ({
    getAthleteProfile: () => null,
    getSetting: (key: string) => mockEngineState.settings.get(key),
    setSetting: (key: string, value: string) => {
      mockEngineState.settings.set(key, value);
      // The engine records the account it leaves when the identity moves.
      if (key === '__athlete_id' && !value.startsWith('garmin:')) {
        mockEngineState.settings.set('__garmin_library_id', 'garmin:8841');
      }
    },
    getStats: () => ({ activityCount: 0, libraryCount: mockEngineState.count }),
  }),
}));

jest.mock('@/shared/ui/dialog', () => ({
  confirmAction: jest.fn(),
  chooseAction: jest.fn(),
  inform: jest.fn(),
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

describe('a Garmin sign-in over the library intervals.icu adopted from it', () => {
  beforeEach(() => {
    mockStore.clear();
    mockEngineState.settings.clear();
    mockEngineState.ready = false;
    mockEngineState.count = 400;
    (confirmAction as jest.Mock).mockClear();
  });

  it('keeps the library without asking, from the device mirror, with the engine closed', async () => {
    mockEngineState.ready = true;
    mockEngineState.settings.set('__athlete_id', 'garmin:8841');
    await nameLibrary('i77');
    mockEngineState.ready = false;

    await expect(getGarminLibraryId()).resolves.toBe('garmin:8841');
    await expect(resolveLoginLibrary('garmin:8841')).resolves.toBe('keep');
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('is asked about for another Garmin account', async () => {
    mockEngineState.ready = true;
    mockEngineState.settings.set('__athlete_id', 'garmin:8841');
    await nameLibrary('i77');
    mockEngineState.ready = false;
    (confirmAction as jest.Mock).mockImplementation(({ onCancel }) => onCancel());

    await expect(resolveLoginLibrary('garmin:9000')).resolves.toBe('refused');
    expect(confirmAction).toHaveBeenCalled();
  });

  it('is asked about when the library never held a Garmin account', async () => {
    await rememberCachedAthleteId('i77');
    (confirmAction as jest.Mock).mockImplementation(({ onCancel }) => onCancel());

    await expect(getGarminLibraryId()).resolves.toBeNull();
    await expect(resolveLoginLibrary('garmin:8841')).resolves.toBe('refused');
  });
});

describe('a Garmin key connected on an intervals.icu library', () => {
  beforeEach(() => {
    mockStore.clear();
    mockEngineState.settings.clear();
    mockEngineState.ready = true;
    (confirmAction as jest.Mock).mockClear();
  });

  it('records the account, so a Garmin sign-in by it keeps the library', async () => {
    mockEngineState.settings.set('__athlete_id', 'i77');

    await recordConnectedGarminAccount('8841');

    expect(mockEngineState.settings.get('__garmin_library_id')).toBe('garmin:8841');
    mockEngineState.ready = false;
    await expect(getGarminLibraryId()).resolves.toBe('garmin:8841');
    expect(accountChangeAction('i77', 'garmin:8841', 400, 'garmin:8841')).toBe('keep');
  });

  it('records nothing on a library already named for a Garmin account', async () => {
    mockEngineState.settings.set('__athlete_id', 'garmin:8841');

    await recordConnectedGarminAccount('8841');

    expect(mockEngineState.settings.has('__garmin_library_id')).toBe(false);
  });

  it('records nothing on an unnamed library or with the engine closed, or for a blank account', async () => {
    await recordConnectedGarminAccount('8841');
    mockEngineState.settings.set('__athlete_id', 'i77');
    await recordConnectedGarminAccount('  ');
    mockEngineState.ready = false;
    await recordConnectedGarminAccount('8841');

    expect(mockEngineState.settings.has('__garmin_library_id')).toBe(false);
  });
});
