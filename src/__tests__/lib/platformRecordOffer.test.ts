/**
 * Scenario: an athlete sets up a new phone from their device backup. The
 * record zip auto-backup keeps in the documents directory comes back, the
 * library does not. The backup screen told them this route restores their
 * names, pins, cuts and exclusions.
 *
 * Expected behaviour: the first signed-in launch on an empty library restores
 * that zip through the record importer without asking, once, and says what
 * came back. A zip this
 * library wrote itself, one already answered, or any on a library that
 * already holds activities is never applied. A zip the engine's restore checks
 * would refuse, another athlete's or a newer format's, is left alone silently,
 * and one refused at restore is named as another account's.
 */

import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import {
  applyPlatformRecord,
  platformRecordToOffer,
} from '@/features/settings/lib/platformRecordOffer';
import { restoreRecordBackup } from '@/features/settings/lib/backup';

const mockSettings = new Map<string, string>();
const mockCheckRecordBackup = jest.fn(async (_uri: string) => undefined);

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key) ?? null,
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
  }),
}));

jest.mock('@/features/settings/lib/backup', () => ({
  checkRecordBackup: (uri: string) => mockCheckRecordBackup(uri),
  restoreRecordBackup: jest.fn(async () => ({ placed: 3, unplaced: 1, missingActivityIds: [] })),
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: true, size: 4096 })),
}));

const t = ((key: string, options?: { count?: number }) =>
  options?.count === undefined ? key : `${key}:${options.count}`) as never;

const getInfoAsync = FileSystem.getInfoAsync as jest.MockedFunction<typeof FileSystem.getInfoAsync>;
const restore = restoreRecordBackup as jest.MockedFunction<typeof restoreRecordBackup>;

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockSettings.clear();
  mockCheckRecordBackup.mockReset().mockResolvedValue(undefined);
  getInfoAsync.mockResolvedValue({ exists: true, size: 4096 } as never);
});

describe('the record zip a device backup brings back', () => {
  it('is restored through the record importer on an empty library with no prompt', async () => {
    expect(await platformRecordToOffer(0)).toBe('file:///docs/veloq-decisions.zip');
    const alert = jest.spyOn(Alert, 'alert');

    await applyPlatformRecord(0, t);
    await settle();

    expect(restore).toHaveBeenCalledWith('file:///docs/veloq-decisions.zip');
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('backup.restoreComplete', 'backup.recordRestored');
    expect(await platformRecordToOffer(0)).toBeNull();
  });

  it('is not applied on a library that already holds activities', async () => {
    expect(await platformRecordToOffer(12)).toBeNull();
  });

  it("is not applied when the engine would refuse it as another athlete's", async () => {
    mockCheckRecordBackup.mockRejectedValue(new Error('Record belongs to another athlete'));
    const alert = jest.spyOn(Alert, 'alert');

    expect(await platformRecordToOffer(0)).toBeNull();
    await applyPlatformRecord(0, t);
    await settle();

    expect(mockCheckRecordBackup).toHaveBeenCalledWith('file:///docs/veloq-decisions.zip');
    expect(alert).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it('is not applied when the engine cannot read it', async () => {
    mockCheckRecordBackup.mockRejectedValue(
      new Error('Record backup version 2 is newer than supported version 1')
    );
    expect(await platformRecordToOffer(0)).toBeNull();
  });

  it('is applied on a later launch once the engine accepts it', async () => {
    mockCheckRecordBackup.mockRejectedValueOnce(new Error('Sign in before importing a backup'));
    expect(await platformRecordToOffer(0)).toBeNull();
    expect(await platformRecordToOffer(0)).toBe('file:///docs/veloq-decisions.zip');
  });

  it('is not applied when there is no zip', async () => {
    getInfoAsync.mockResolvedValue({ exists: false } as never);
    expect(await platformRecordToOffer(0)).toBeNull();
  });

  it('is not applied once this library wrote it or it was answered', async () => {
    mockSettings.set('__platform_record_answered', '1');
    expect(await platformRecordToOffer(0)).toBeNull();
  });

  it("refuses another athlete's zip and names it as another account's", async () => {
    restore.mockRejectedValueOnce(new Error('Record belongs to another athlete'));
    const alert = jest.spyOn(Alert, 'alert');

    await applyPlatformRecord(0, t);
    await settle();

    expect(alert).toHaveBeenCalledWith('common.error', 'backup.backupDifferentAccount');
    expect(await platformRecordToOffer(0)).toBeNull();
  });
});
