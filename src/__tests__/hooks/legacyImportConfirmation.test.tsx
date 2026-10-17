/**
 * Scenario: an athlete picks a backup. Its values replace stored preferences
 * and custom names.
 *
 * Expected behaviour: the file is read and checked first, and nothing is
 * written until the athlete accepts a dialog naming what is replaced, on a
 * button that says so; declining leaves everything untouched.
 */
import { act, renderHook } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import * as Notice from '@/shared/ui/Notice';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { useImportDatabaseBackup } from '@/features/settings/hooks/useBackup';
import {
  convertLegacyDatabaseFile,
  restoreBackup,
  restoreRecordBackup,
} from '@/features/settings/lib/backup';
import { discardHeldImport, holdImportWhileSignedOut } from '@/features/settings/lib/heldImport';
import { i18n, initialiseI18n } from '@/i18n';

jest.mock('@/features/settings/lib/backup', () => ({
  SignInRequiredError: class extends Error {},
  checkRecordBackup: (uri: string) => mockChecks.checkRecordBackup(uri),
  checkLegacyBackup: (json: string) => mockChecks.checkLegacyBackup(json),
  convertLegacyDatabaseFile: jest.fn(async () => {}),
  restoreBackup: jest.fn(async () => ({
    unplacedCount: 0,
    drops: { notRestored: 0, namesNotRestored: 0 },
  })),
  restoreRecordBackup: jest.fn(),
  exportRecordBackup: jest.fn(),
  importWaitsForSignIn: () => !mockEngineState.ready,
}));
jest.mock('@/features/settings/lib/heldImport', () => ({
  holdImportWhileSignedOut: jest.fn(async () => false),
  discardHeldImport: jest.fn(async () => {}),
  isHeldWhileSignedOut: jest.requireActual('@/features/settings/lib/heldImport')
    .isHeldWhileSignedOut,
}));
const mockEngineState = { ready: true };
const mockCheck = {
  writtenAt: null,
  namesAccount: false,
  names: 2,
  settings: 5,
  decisions: 0,
};
const mockChecks = {
  checkRecordBackup: jest.fn(async (_uri: string) => mockCheck),
  checkLegacyBackup: jest.fn(async (_json: string) => mockCheck),
};
jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => mockEngineState.ready,
}));
jest.mock('expo-document-picker', () => ({
  ...jest.requireActual('expo-document-picker'),
  getDocumentAsync: jest.fn(),
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 512 }),
  readAsStringAsync: jest.fn().mockResolvedValue('{}'),
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Notice, 'showNotice');
  mockEngineState.ready = true;
  (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///cache/DocumentPicker/old.veloq', name: 'old.veloq' }],
  });
});

function pressButton(label: string) {
  const call = (Alert.alert as jest.Mock).mock.calls.find(
    (args) => args[0] === i18n.t('backup.importBackup') && Array.isArray(args[2])
  );
  expect(call).toBeDefined();
  const button = (call![2] as AlertButton[]).find((b) => b.text === label);
  expect(button).toBeDefined();
  return button!.onPress?.();
}

it('checks the file first, and restores nothing until the confirmation is accepted', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  const { result } = await renderHook(() => useImportDatabaseBackup());

  let pending!: Promise<unknown>;
  await act(async () => {
    pending = result.current.importDatabaseBackup();
    await Promise.resolve();
  });

  expect(mockChecks.checkLegacyBackup).toHaveBeenCalledTimes(1);
  expect(restoreBackup).not.toHaveBeenCalled();

  await act(async () => {
    pressButton(i18n.t('backup.replaceSettings'));
    await pending;
  });
  expect(restoreBackup).toHaveBeenCalledTimes(1);
});

it('names what the backup holds in the confirmation', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  const { result } = await renderHook(() => useImportDatabaseBackup());

  await act(async () => {
    void result.current.importDatabaseBackup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const call = (Alert.alert as jest.Mock).mock.calls.find(
    (args) => args[0] === i18n.t('backup.importBackup')
  );
  expect(call?.[1]).toContain(i18n.t('backup.checkedNames', { value: 2 }));
  expect(call?.[1]).toContain(i18n.t('backup.checkedSettings', { value: 5 }));
  expect(call?.[1]).toContain(i18n.t('backup.checkedUndated'));
  expect(call?.[1]).toContain(i18n.t('backup.checkedNoAccount'));
});

it('changes nothing when the confirmation is declined', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  const { result } = await renderHook(() => useImportDatabaseBackup());

  let pending!: Promise<unknown>;
  await act(async () => {
    pending = result.current.importDatabaseBackup();
    await Promise.resolve();
  });
  await act(async () => {
    pressButton(i18n.t('common.cancel'));
    await pending;
  });

  expect(restoreBackup).not.toHaveBeenCalled();
});

describe.each(['veloq-backup-2026-09-30.zip', 'older.veloqdb'])('a picked %s', (name) => {
  beforeEach(() => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: `file:///cache/DocumentPicker/${name}`, name }],
    });
    (restoreRecordBackup as jest.Mock).mockResolvedValue({
      placed: 1,
      unplaced: 0,
      notRestored: 0,
      namesNotRestored: 0,
    });
  });

  async function startImport() {
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result } = await renderHook(() => useImportDatabaseBackup());
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.importDatabaseBackup();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { pending };
  }

  it('is checked, and restores nothing until the confirmation is accepted', async () => {
    const { pending } = await startImport();
    expect(mockChecks.checkRecordBackup).toHaveBeenCalledTimes(1);
    expect(convertLegacyDatabaseFile).toHaveBeenCalledTimes(name.endsWith('.veloqdb') ? 1 : 0);
    expect(restoreRecordBackup).not.toHaveBeenCalled();

    await act(async () => {
      pressButton(i18n.t('backup.replaceSettings'));
      await pending;
    });
    expect(restoreRecordBackup).toHaveBeenCalledTimes(1);
  });

  it('restores nothing and deletes the picked copy when declined', async () => {
    const { pending } = await startImport();
    await act(async () => {
      pressButton(i18n.t('common.cancel'));
      await pending;
    });
    expect(restoreRecordBackup).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(`file:///cache/DocumentPicker/${name}`, {
      idempotent: true,
    });
  });
});

describe.each(['old.veloq', 'older.veloqdb', 'veloq-backup-2026-09-30.zip'])(
  'a %s picked while signed out',
  (name) => {
    beforeEach(() => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [{ uri: `file:///cache/DocumentPicker/${name}`, name }],
      });
      (holdImportWhileSignedOut as jest.Mock).mockResolvedValueOnce(true);
      mockEngineState.ready = false;
    });

    async function startHeldImport() {
      jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
      const { result } = await renderHook(() => useImportDatabaseBackup());
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = result.current.importDatabaseBackup();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      return { pending };
    }

    it('is held for sign-in once its checks pass and the confirmation is accepted', async () => {
      const { pending } = await startHeldImport();
      expect(holdImportWhileSignedOut).toHaveBeenCalledWith(
        `file:///cache/DocumentPicker/${name}`,
        name
      );

      await act(async () => {
        pressButton(i18n.t('backup.replaceSettings'));
        await pending;
      });

      expect(discardHeldImport).not.toHaveBeenCalled();
      expect(restoreBackup).not.toHaveBeenCalled();
      expect(restoreRecordBackup).not.toHaveBeenCalled();
      expect(Notice.showNotice).toHaveBeenCalledWith(
        expect.objectContaining({ message: i18n.t('backup.heldUntilSignIn') })
      );
      expect(Alert.alert).not.toHaveBeenCalledWith(
        i18n.t('backup.notRestoredTitle'),
        expect.anything(),
        undefined,
        expect.anything()
      );
    });

    it('declined, keeps nothing held', async () => {
      const { pending } = await startHeldImport();
      await act(async () => {
        pressButton(i18n.t('common.cancel'));
        await pending;
      });

      expect(discardHeldImport).toHaveBeenCalledTimes(1);
      expect(Notice.showNotice).not.toHaveBeenCalled();
    });
  }
);

describe.each(['notes.json'])('a picked %s while signed out', (name) => {
  it('shows the sign-in prompt without a confirmation or a restore', async () => {
    mockEngineState.ready = false;
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: `file:///cache/DocumentPicker/${name}`, name }],
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result } = await renderHook(() => useImportDatabaseBackup());

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.importDatabaseBackup();
    });

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      i18n.t('backup.notRestoredTitle'),
      i18n.t('backup.signInRequired'),
      undefined,
      expect.objectContaining({ cancelable: true })
    );
    expect(outcome).toMatchObject({ success: false });
    expect(restoreBackup).not.toHaveBeenCalled();
    expect(restoreRecordBackup).not.toHaveBeenCalled();
    expect(mockChecks.checkRecordBackup).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalled();
  });
});
