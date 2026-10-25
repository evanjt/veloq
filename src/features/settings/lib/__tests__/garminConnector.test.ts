/**
 * Scenario: the athlete pastes a Garmin Personal key. It is a credential, so
 * it lives in the keychain under the shared options and in the engine's
 * memory, and in no store or setting.
 */

import { GarminKeyStatus } from 'veloqrs';

import {
  CREDENTIAL_KEYCHAIN_OPTIONS,
  type CredentialKeychainIo,
} from '@/shared/app/credentialKeychain';
import {
  GARMIN_KEY_STORAGE_KEY,
  connectGarminKey,
  disconnectGarmin,
  garminDuplicateWarning,
  restoreGarminKey,
} from '../garminConnector';

function keychain(initial: Record<string, string> = {}) {
  const held = new Map(Object.entries(initial));
  const io: CredentialKeychainIo = {
    read: jest.fn(async (key) => held.get(key) ?? null),
    write: jest.fn(async (key, value) => {
      held.set(key, value);
    }),
    remove: jest.fn(async (key) => {
      held.delete(key);
    }),
  };
  return { io, held };
}

function engine(status: GarminKeyStatus) {
  return {
    connectGarmin: jest.fn(async () => status),
    holdGarminKey: jest.fn(),
    clearGarminKey: jest.fn(),
  };
}

const mockSetSetting = jest.fn();
jest.mock('@/shared/storage', () => ({
  ...jest.requireActual('@/shared/storage'),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

describe('where the key goes', () => {
  it('reaches the keychain alone: no setting and no console line carries it', async () => {
    const secret = 'invented-key-91b2c7';
    const logs = (['log', 'info', 'warn', 'error'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    );
    const { io, held } = keychain();
    await connectGarminKey(secret, { io, engine: engine(GarminKeyStatus.Connected) });
    await connectGarminKey(secret, { io, engine: engine(GarminKeyStatus.Rejected) });
    expect([...held.values()]).toEqual([secret]);
    expect(JSON.stringify(mockSetSetting.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(logs.map((l) => l.mock.calls))).not.toContain(secret);
    logs.forEach((l) => l.mockRestore());
  });

  it('is removed with the engine copy on disconnect, whatever the settings do', async () => {
    const { io, held } = keychain({ [GARMIN_KEY_STORAGE_KEY]: 'invented-key-91b2c7' });
    const e = engine(GarminKeyStatus.Connected);
    await disconnectGarmin({ io, engine: e, removeSetting: jest.fn() });
    expect(held.size).toBe(0);
    expect(e.clearGarminKey).toHaveBeenCalledTimes(1);
  });
});

describe('connecting a Garmin key', () => {
  it('keeps an accepted key in the keychain under the credential options, trimmed', async () => {
    const { io } = keychain();
    const e = engine(GarminKeyStatus.Connected);
    const result = await connectGarminKey('  abc123 \n', { io, engine: e });
    expect(result).toBe(GarminKeyStatus.Connected);
    expect(e.connectGarmin).toHaveBeenCalledWith('abc123');
    expect(io.write).toHaveBeenCalledWith(
      GARMIN_KEY_STORAGE_KEY,
      'abc123',
      CREDENTIAL_KEYCHAIN_OPTIONS
    );
  });

  it.each([GarminKeyStatus.Rejected, GarminKeyStatus.Malformed, GarminKeyStatus.Unreachable])(
    'writes nothing when Garmin answers %s',
    async (status) => {
      const { io, held } = keychain();
      const e = engine(status);
      expect(await connectGarminKey('abc', { io, engine: e })).toBe(status);
      expect(io.write).not.toHaveBeenCalled();
      expect(held.size).toBe(0);
    }
  );

  it('does not ask Garmin about an empty paste', async () => {
    const { io } = keychain();
    const e = engine(GarminKeyStatus.Connected);
    expect(await connectGarminKey('   ', { io, engine: e })).toBe(GarminKeyStatus.Malformed);
    expect(e.connectGarmin).not.toHaveBeenCalled();
    expect(io.write).not.toHaveBeenCalled();
  });
});

describe('disconnecting', () => {
  it('clears the keychain entry, the engine key and the device choices', async () => {
    const { io, held } = keychain({ [GARMIN_KEY_STORAGE_KEY]: 'abc' });
    const e = engine(GarminKeyStatus.Connected);
    const removeSetting = jest.fn();
    await disconnectGarmin({ io, engine: e, removeSetting });
    expect(held.has(GARMIN_KEY_STORAGE_KEY)).toBe(false);
    expect(e.clearGarminKey).toHaveBeenCalledTimes(1);
    expect(removeSetting.mock.calls.map(([k]) => k).sort()).toEqual([
      'veloq-garmin-feed',
      'veloq-garmin-key-expiry',
      'veloq-garmin-upload',
    ]);
  });
});

describe('disconnecting when one place fails', () => {
  it('still clears the others and then reports the failure', async () => {
    const { io, held } = keychain({ [GARMIN_KEY_STORAGE_KEY]: 'abc' });
    const e = engine(GarminKeyStatus.Connected);
    e.clearGarminKey.mockImplementation(() => {
      throw new Error('engine closed');
    });
    const removeSetting = jest.fn();
    await expect(disconnectGarmin({ io, engine: e, removeSetting })).rejects.toThrow(
      'engine closed'
    );
    expect(held.has(GARMIN_KEY_STORAGE_KEY)).toBe(false);
    expect(removeSetting).toHaveBeenCalledTimes(3);
  });
});

describe('restoring at launch', () => {
  it('hands the keychain key to the engine without asking Garmin', async () => {
    const { io } = keychain({ [GARMIN_KEY_STORAGE_KEY]: 'abc' });
    const e = engine(GarminKeyStatus.Connected);
    await restoreGarminKey({ io, engine: e });
    expect(e.holdGarminKey).toHaveBeenCalledWith('abc');
    expect(e.connectGarmin).not.toHaveBeenCalled();
  });

  it('hands over nothing when no key is kept', async () => {
    const { io } = keychain();
    const e = engine(GarminKeyStatus.Connected);
    await restoreGarminKey({ io, engine: e });
    expect(e.holdGarminKey).not.toHaveBeenCalled();
  });
});

describe('the duplicate warning', () => {
  it('shows only when uploads are on while intervals.icu imports Garmin itself', () => {
    expect(garminDuplicateWarning({ syncsActivities: true, uploadOn: true })).toBe(true);
    expect(garminDuplicateWarning({ syncsActivities: true, uploadOn: false })).toBe(false);
    expect(garminDuplicateWarning({ syncsActivities: false, uploadOn: true })).toBe(false);
    expect(garminDuplicateWarning({ syncsActivities: null, uploadOn: true })).toBe(false);
  });
});
