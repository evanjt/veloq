/**
 * Scenario: an athlete picks an older settings-and-names backup. Its values
 * replace stored preferences and custom names.
 *
 * Expected behaviour: nothing is read or written until the athlete accepts a
 * dialog naming what is replaced; declining leaves everything untouched.
 */
import { act, renderHook } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { useImportDatabaseBackup } from '@/features/settings/hooks/useBackup';
import {
  restoreBackup,
  restoreDatabaseBackup,
  restoreRecordBackup,
} from '@/features/settings/lib/backup';
import { holdImportWhileSignedOut } from '@/features/settings/lib/heldImport';
import { i18n, initializeI18n } from '@/i18n';

jest.mock('@/features/settings/lib/backup', () => ({
  restoreBackup: jest.fn(async () => ({ unplacedCount: 0 })),
  restoreDatabaseBackup: jest.fn(),
  restoreRecordBackup: jest.fn(),
  exportRecordBackup: jest.fn(),
  importWaitsForSignIn: () => !mockEngineState.ready,
}));
jest.mock('@/features/settings/lib/heldImport', () => ({
  holdImportWhileSignedOut: jest.fn(async () => false),
  isHeldWhileSignedOut: jest.requireActual('@/features/settings/lib/heldImport')
    .isHeldWhileSignedOut,
}));
const mockEngineState = { ready: true };
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
  readAsStringAsync: jest.fn().mockResolvedValue('{}'),
}));

beforeAll(async () => {
  await initializeI18n('en-GB');
});

beforeEach(() => {
  jest.clearAllMocks();
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

it('reads and restores nothing until the confirmation is accepted', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  const { result } = renderHook(() => useImportDatabaseBackup());

  let pending!: Promise<unknown>;
  await act(async () => {
    pending = result.current.importDatabaseBackup();
    await Promise.resolve();
  });

  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  expect(restoreBackup).not.toHaveBeenCalled();

  await act(async () => {
    pressButton(i18n.t('backup.importBackup'));
    await pending;
  });
  expect(restoreBackup).toHaveBeenCalledTimes(1);
});

it('changes nothing when the confirmation is declined', async () => {
  jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  const { result } = renderHook(() => useImportDatabaseBackup());

  let pending!: Promise<unknown>;
  await act(async () => {
    pending = result.current.importDatabaseBackup();
    await Promise.resolve();
  });
  await act(async () => {
    pressButton(i18n.t('common.cancel'));
    await pending;
  });

  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  expect(restoreBackup).not.toHaveBeenCalled();
});

describe.each(['veloq-backup-2026-09-30.zip', 'older.veloqdb'])('a picked %s', (name) => {
  beforeEach(() => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: `file:///cache/DocumentPicker/${name}`, name }],
    });
    (restoreRecordBackup as jest.Mock).mockResolvedValue({ placed: 1, unplaced: 0 });
    (restoreDatabaseBackup as jest.Mock).mockResolvedValue({ success: true, activityCount: 0 });
  });

  async function startImport() {
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result } = renderHook(() => useImportDatabaseBackup());
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.importDatabaseBackup();
      await Promise.resolve();
    });
    return { pending };
  }

  it('restores nothing until the confirmation is accepted', async () => {
    const { pending } = await startImport();
    expect(restoreRecordBackup).not.toHaveBeenCalled();
    expect(restoreDatabaseBackup).not.toHaveBeenCalled();

    await act(async () => {
      pressButton(i18n.t('backup.importBackup'));
      await pending;
    });
    expect(
      (restoreRecordBackup as jest.Mock).mock.calls.length +
        (restoreDatabaseBackup as jest.Mock).mock.calls.length
    ).toBe(1);
  });

  it('restores nothing and deletes the picked copy when declined', async () => {
    const { pending } = await startImport();
    await act(async () => {
      pressButton(i18n.t('common.cancel'));
      await pending;
    });
    expect(restoreRecordBackup).not.toHaveBeenCalled();
    expect(restoreDatabaseBackup).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(`file:///cache/DocumentPicker/${name}`, {
      idempotent: true,
    });
  });
});

describe.each(['old.veloq', 'older.veloqdb'])('a %s picked while signed out', (name) => {
  beforeEach(() => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: `file:///cache/DocumentPicker/${name}`, name }],
    });
    (holdImportWhileSignedOut as jest.Mock).mockResolvedValueOnce(true);
    mockEngineState.ready = false;
  });

  it('is held for sign-in after the confirmation, and restores nothing', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result } = renderHook(() => useImportDatabaseBackup());
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = result.current.importDatabaseBackup();
      await Promise.resolve();
    });
    expect(holdImportWhileSignedOut).not.toHaveBeenCalled();

    await act(async () => {
      pressButton(i18n.t('backup.importBackup'));
      await pending;
    });

    expect(holdImportWhileSignedOut).toHaveBeenCalledWith(
      `file:///cache/DocumentPicker/${name}`,
      name
    );
    expect(restoreBackup).not.toHaveBeenCalled();
    expect(restoreDatabaseBackup).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenLastCalledWith(
      i18n.t('backup.importBackup'),
      i18n.t('backup.heldUntilSignIn')
    );
    expect(Alert.alert).not.toHaveBeenCalledWith(i18n.t('common.error'), expect.anything());
  });
});

describe.each(['veloq-backup-2026-09-30.zip'])('a picked %s while signed out', (name) => {
  it('shows the sign-in prompt without a confirmation or a restore', async () => {
    mockEngineState.ready = false;
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: `file:///cache/DocumentPicker/${name}`, name }],
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const { result } = renderHook(() => useImportDatabaseBackup());

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.importDatabaseBackup();
    });

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(i18n.t('common.error'), i18n.t('backup.signInRequired'));
    expect(outcome).toMatchObject({ success: false });
    expect(restoreBackup).not.toHaveBeenCalled();
    expect(restoreRecordBackup).not.toHaveBeenCalled();
    expect(restoreDatabaseBackup).not.toHaveBeenCalled();
    expect(FileSystem.deleteAsync).toHaveBeenCalled();
  });
});
