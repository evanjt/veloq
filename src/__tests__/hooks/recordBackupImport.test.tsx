import { act, renderHook } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import * as Notice from '@/shared/ui/Notice';
import * as FileSystem from 'expo-file-system/legacy';

import { useImportDatabaseBackup } from '@/features/settings/hooks/useBackup';
import {
  restoreBackup,
  restoreDatabaseBackup,
  restoreRecordBackup,
} from '@/features/settings/lib/backup';

let mockFileName = 'older.veloq';
/** Where the picker put its copy: its own directory in the cache, on both platforms. */
let mockPickedUri = (name: string) => `file:///cache/DocumentPicker/5d0c9e1a-77b4/${name}`;

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('expo-document-picker', () => ({
  ...jest.requireActual('expo-document-picker'),
  getDocumentAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: mockPickedUri(mockFileName), name: mockFileName }],
  })),
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  EncodingType: { UTF8: 'utf8' },
  readAsStringAsync: jest.fn(async () => '{"version":1}'),
  deleteAsync: jest.fn(async () => undefined),
}));
// Signed in throughout, so nothing is held for a sign-in.
jest.mock('@/features/settings/lib/heldImport', () => ({
  holdImportWhileSignedOut: jest.fn(async () => false),
}));
jest.mock('@/features/settings/lib/backup', () => ({
  restoreBackup: jest.fn(),
  restoreDatabaseBackup: jest.fn(),
  restoreRecordBackup: jest.fn(),
  importWaitsForSignIn: () => false,
}));

const mockRestore = restoreBackup as jest.MockedFunction<typeof restoreBackup>;

/** Answer the prompt a legacy settings import asks before replacing anything. */
function acceptLegacyPrompt() {
  jest.mocked(Alert.alert).mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });
}

beforeEach(() => {
  jest.spyOn(Notice, 'showNotice');
  mockFileName = 'older.veloq';
  mockPickedUri = (name: string) => `file:///cache/DocumentPicker/5d0c9e1a-77b4/${name}`;
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  acceptLegacyPrompt();
});

it('explains an account mismatch when a legacy database cannot be converted', async () => {
  mockFileName = 'older.veloqdb';
  (restoreDatabaseBackup as jest.Mock).mockResolvedValue({
    success: false,
    activityCount: 0,
    refusal: 'differentAccount',
  });
  const { result } = await renderHook(() => useImportDatabaseBackup());

  await act(async () => {
    await result.current.importDatabaseBackup();
  });

  expect(Alert.alert).toHaveBeenCalledWith(
    'backup.notRestoredTitle',
    'backup.backupDifferentAccount',
    undefined,
    expect.objectContaining({ cancelable: true })
  );
});

it('titles a failed restore for what failed, and back on Android dismisses it', async () => {
  const originalOs = Platform.OS;
  Platform.OS = 'android';
  try {
    mockFileName = 'veloq-backup-2026-09-30.zip';
    (restoreRecordBackup as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Database error: corrupt'), { tag: 'Database' })
    );
    const { result } = renderHook(() => useImportDatabaseBackup());

    await act(async () => {
      await result.current.importDatabaseBackup();
    });

    const [title, message, , options] = jest.mocked(Alert.alert).mock.calls.at(-1) ?? [];
    expect(title).not.toBe('common.error');
    expect(title).toBe('backup.notRestoredTitle');
    expect(message).toBe('backup.importError');
    expect(options?.cancelable).toBe(true);
  } finally {
    Platform.OS = originalOs;
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

it("words the engine's account refusal of a record zip in the athlete's language", async () => {
  mockFileName = 'veloq-backup-2026-09-30.zip';
  (restoreRecordBackup as jest.Mock).mockRejectedValue(
    Object.assign(new Error('Record belongs to another athlete'), { tag: 'Database' })
  );
  const { result } = renderHook(() => useImportDatabaseBackup());

  await act(async () => {
    await result.current.importDatabaseBackup();
  });

  const [, message] = jest.mocked(Alert.alert).mock.calls.at(-1) ?? [];
  expect(message).toBe('backup.backupDifferentAccount');
});

it('words a refused legacy database by its refusal, never by a thrown message', async () => {
  mockFileName = 'older.veloqdb';
  (restoreDatabaseBackup as jest.Mock).mockResolvedValue({
    success: false,
    activityCount: 0,
    refusal: 'failed',
  });
  const { result } = renderHook(() => useImportDatabaseBackup());

  await act(async () => {
    await result.current.importDatabaseBackup();
  });

  const [, message] = jest.mocked(Alert.alert).mock.calls.at(-1) ?? [];
  expect(message).toBe('backup.importError');
});

it('reports a legacy record restore and the records still waiting', async () => {
  acceptLegacyPrompt();
  mockRestore.mockResolvedValue({
    unplacedCount: 2,
    drops: { notRestored: 0, namesNotRestored: 0 },
  });
  const { result } = await renderHook(() => useImportDatabaseBackup());

  const outcome: { current: Awaited<ReturnType<typeof result.current.importDatabaseBackup>> } = {
    current: null,
  };
  await act(async () => {
    outcome.current = await result.current.importDatabaseBackup();
  });

  expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith(mockPickedUri('older.veloq'), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  expect(outcome.current?.success).toBe(true);
  expect(Notice.showNotice).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'backup.recordRestored' })
  );
});

describe("the picker's copy of an imported backup", () => {
  const imports: [string, () => void][] = [
    [
      'a legacy record file',
      () => {
        mockFileName = 'older.veloq';
        acceptLegacyPrompt();
        mockRestore.mockResolvedValue({
          unplacedCount: 0,
          drops: { notRestored: 0, namesNotRestored: 0 },
        });
      },
    ],
    [
      'a record zip',
      () => {
        mockFileName = 'veloq-backup-2026-09-30.zip';
        (restoreRecordBackup as jest.Mock).mockResolvedValue({
          placed: 3,
          unplaced: 0,
          notRestored: 0,
          namesNotRestored: 0,
        });
      },
    ],
    [
      'a whole-database copy',
      () => {
        mockFileName = 'older.veloqdb';
        (restoreDatabaseBackup as jest.Mock).mockResolvedValue({ success: true, activityCount: 0 });
      },
    ],
    [
      'a restore that throws',
      () => {
        mockFileName = 'veloq-backup-2026-09-30.zip';
        (restoreRecordBackup as jest.Mock).mockRejectedValue(new Error('corrupt'));
      },
    ],
  ];

  it.each(imports)('is deleted once %s is imported', async (_kind, arrange) => {
    arrange();
    const { result } = await renderHook(() => useImportDatabaseBackup());

    await act(async () => {
      await result.current.importDatabaseBackup();
    });

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(mockPickedUri(mockFileName), {
      idempotent: true,
    });
  });

  it('never deletes a picked file outside the picker directory', async () => {
    mockFileName = 'veloq-backup-2026-09-30.zip';
    mockPickedUri = (name: string) => `file:///docs/backups/${name}`;
    (restoreRecordBackup as jest.Mock).mockResolvedValue({ placed: 3, unplaced: 0 });
    const { result } = await renderHook(() => useImportDatabaseBackup());

    await act(async () => {
      await result.current.importDatabaseBackup();
    });

    expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
  });
});
