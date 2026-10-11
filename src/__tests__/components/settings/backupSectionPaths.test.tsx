import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, Platform } from 'react-native';
import { SyncState, SyncStep } from 'veloqrs';

import { BackupSection } from '@/features/settings/components/BackupSection';
import { performBackup } from '@/features/settings/lib/autobackup';
import {
  discardRecordImport,
  discardUnplacedRecords,
  restoreRecordBackup,
  restoreDatabaseBackup,
  resumeRecordImport,
} from '@/features/settings/lib/backup';

const mockUnplaced = jest.fn((): { kind: string; name: string | null; reason: string }[] => [
  { kind: 'section_pins', name: 'Alpine climb', reason: 'activity_unavailable' },
  { kind: 'legacy_section_name', name: 'River bend', reason: 'ground_not_detected' },
]);
const mockDownload = jest.fn(async (_id: string, _path: string) => {});
const mockImportBackup = jest.fn(async () => ({ success: true, activityCount: 0 }));
const mockListBackups = jest.fn(async () => [
  {
    id: 'veloq-2026-09-30.zip',
    timestamp: '2026-09-30T10:00:00.000Z',
    sizeBytes: 4096,
    appVersion: '0.4.0',
  },
]);
let mockGeneration = 0;
let mockWebdavUrl: string | null = null;
let mockFolderName: string | null = null;
let mockFailures: Record<string, { kind: string; status: number | null; at: number }> = {};
let mockAutoEnabled = true;
let mockDestinationStamps: Record<string, number> = {};
let mockLocalBackups: unknown[] = [];
let mockAndroidBackup: Record<string, number | null> | null = null;
const FOLDER_BACKUPS = [
  {
    id: 'veloq-2026-10-01T06-00-00-000Z.zip',
    timestamp: '2026-10-01T06:00:00.000Z',
    sizeBytes: 2048,
    appVersion: '',
  },
];
let mockFolderBackups: unknown[] = FOLDER_BACKUPS;
const mockSetAutoEnabled = jest.fn();
const mockPickFolder = jest.fn(async (): Promise<string | null> => null);
const mockForgetFolder = jest.fn();

let mockDriveSupported = false;
let mockDriveAccount: string | null = null;
const DRIVE_BACKUPS = [
  {
    id: 'veloq-2026-10-02T06-00-00-000Z.zip',
    timestamp: '2026-10-02T06:00:00.000Z',
    sizeBytes: 2048,
    appVersion: '',
  },
];
const mockDriveSignIn = jest.fn(async (): Promise<string | null> => null);
const mockDriveForget = jest.fn(async () => {});
const mockCarrierSignedIn = jest.fn(async (_id: string) => ({ wroteZip: false, carriers: {} }));

jest.mock('@/features/settings/lib/autobackup/backends/googleDriveBackend', () => ({
  googleDriveBackend: {
    id: 'googleDrive',
    name: 'Google Drive',
    isAvailable: async () => mockDriveAccount !== null,
    listBackups: async () => DRIVE_BACKUPS,
    download: (id: string, path: string) => mockDownload(id, path),
  },
  isGoogleDriveSupported: () => mockDriveSupported,
  getGoogleDriveAccount: () => mockDriveAccount,
  loadGoogleDriveAccount: async () => mockDriveAccount,
  signInToGoogleDrive: () => mockDriveSignIn(),
  forgetGoogleDrive: () => mockDriveForget(),
}));
jest.mock('@/features/settings/lib/autobackup/autoBackup', () => ({
  onBackupCarrierSignedIn: (id: string) => mockCarrierSignedIn(id),
}));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
let mockSyncStatus: Record<string, unknown> | null = null;
jest.mock('@/shared/native/useSyncStatus', () => ({ useSyncStatus: () => mockSyncStatus }));
jest.mock('@/shared/native/useActivityCount', () => ({ useActivityCount: () => 402 }));
jest.mock('@/shared/native/useEngineSubscription', () => ({
  useEngineRead: () => (read: (engine: { getUnplacedBackupRecords: () => unknown }) => unknown) =>
    read({ getUnplacedBackupRecords: () => mockUnplaced() }),
  useEngineSubscription: () => mockGeneration,
}));
jest.mock('@/shared/native/androidAutoBackup', () => ({
  getAndroidAutoBackupStatus: () => mockAndroidBackup,
}));
jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn(async () => {}),
}));
jest.mock('@/features/settings/lib/backup', () => ({
  restoreRecordBackup: jest.fn(async () => ({ placed: 2, unplaced: 1, missingActivityIds: [] })),
  restoreDatabaseBackup: jest.fn(),
  resumeRecordImport: jest.fn(async () => ({ placed: 2, unplaced: 0, missingActivityIds: [] })),
  discardRecordImport: jest.fn(async () => {}),
  // Settings is reached signed in, so nothing is held for a sign-in.
  importWaitsForSignIn: () => false,
  discardUnplacedRecords: jest.fn(async () => {}),
}));
jest.mock('@/features/settings/components/ExportPrivacyRow', () => ({
  ExportPrivacyRow: () => null,
}));
jest.mock('@/features/settings/components/WebdavConfigForm', () => ({
  WebdavConfigForm: ({ onRemoved }: { onRemoved: () => void }) => {
    const { Pressable, Text } = require('react-native');
    return (
      <Pressable
        testID="webdav-remove"
        onPress={() => {
          mockWebdavUrl = null;
          onRemoved();
        }}
      >
        <Text>webdav-form</Text>
      </Pressable>
    );
  },
}));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: () => null,
}));
jest.mock('@/features/settings/hooks/exportIndex', () => ({
  useExportRecordBackup: () => ({ exportRecordBackup: jest.fn(), exporting: false }),
  useImportDatabaseBackup: () => ({
    importDatabaseBackup: () => mockImportBackup(),
    importing: false,
  }),
  useBulkExport: () => ({
    exportAll: jest.fn(),
    exportAllGeoJson: jest.fn(),
    isExporting: false,
    stillRunning: false,
    format: 'gpx',
    phase: 'idle',
    sizeBytes: 0,
    current: 0,
    total: 0,
  }),
}));
jest.mock('@/features/settings/lib/autobackup', () => ({
  isAutoBackupEnabled: () => mockAutoEnabled,
  setAutoBackupEnabled: (value: boolean) => mockSetAutoEnabled(value),
  getLastBackupTimestamp: () => null,
  getDestinationLastBackup: (id: string) => mockDestinationStamps[id] ?? null,
  getUnplacedBackupRecords: async () => mockUnplaced(),
  getLastBackupFailure: () => null,
  getBackupFailures: () => mockFailures,
  pickBackupFolder: () => mockPickFolder(),
  getBackupFolderName: () => mockFolderName,
  forgetBackupFolder: () => {
    mockForgetFolder();
    mockFolderName = null;
  },
  folderBackend: {
    id: 'folder',
    name: 'Folder',
    isAvailable: async () => mockFolderName !== null,
    listBackups: async () => mockFolderBackups,
    download: (id: string, path: string) => mockDownload(id, path),
  },
  failureMessageKey: (kind: string) =>
    kind === 'auth' ? 'backup.backupFailedAuth' : 'backup.backupFailedFolder',
  performBackup: jest.fn(async () => ({ wroteZip: true, carriers: {} })),
  localBackend: {
    id: 'local',
    name: 'Local',
    isAvailable: async () => true,
    listBackups: async () => mockLocalBackups,
    download: (id: string, path: string) => mockDownload(id, path),
  },
  webdavBackend: {
    id: 'webdav',
    name: 'WebDAV',
    isAvailable: async () => true,
    listBackups: () => mockListBackups(),
    download: (id: string, path: string) => mockDownload(id, path),
  },
  getWebdavConfig: () =>
    mockWebdavUrl ? { url: mockWebdavUrl, username: 'athlete', password: 'secret' } : null,
  setWebdavConfig: jest.fn(),
  testWebdavConnection: jest.fn(),
  webdavUrlProblem: () => null,
}));

beforeEach(() => {
  mockDriveSupported = false;
  mockDriveAccount = null;
  mockDriveSignIn.mockReset();
  mockDriveSignIn.mockResolvedValue(null);
  mockDriveForget.mockClear();
  mockCarrierSignedIn.mockClear();
  mockGeneration = 0;
  mockWebdavUrl = null;
  mockFolderName = null;
  mockFailures = {};
  mockAutoEnabled = true;
  mockDestinationStamps = {};
  mockLocalBackups = [];
  mockAndroidBackup = null;
  mockFolderBackups = FOLDER_BACKUPS;
  mockSetAutoEnabled.mockClear();
  mockPickFolder.mockReset();
  mockPickFolder.mockResolvedValue(null);
  mockForgetFolder.mockClear();
  mockSyncStatus = null;
  mockUnplaced.mockReset();
  mockUnplaced.mockReturnValue([
    { kind: 'section_pins', name: 'Alpine climb', reason: 'activity_unavailable' },
    { kind: 'legacy_section_name', name: 'River bend', reason: 'ground_not_detected' },
    { kind: 'sections', name: 'Old quarry', reason: 'activity_pending' },
  ]);
  mockDownload.mockClear();
  mockImportBackup.mockClear();
  mockListBackups.mockClear();
  (performBackup as jest.Mock).mockClear();
  (restoreRecordBackup as jest.Mock).mockClear();
  (restoreDatabaseBackup as jest.Mock).mockReset();
  (resumeRecordImport as jest.Mock).mockClear();
  (discardRecordImport as jest.Mock).mockClear();
  (discardUnplacedRecords as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('keeps the backup action busy until its run finishes', async () => {
  let finishBackup:
    | ((result: { wroteZip: boolean; carriers: Record<string, never> }) => void)
    | undefined;
  (performBackup as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishBackup = resolve;
      })
  );
  render(<BackupSection />);

  const backupButton = screen.getByRole('button', { name: 'backup.backupNow' });
  fireEvent.press(backupButton);
  expect(
    screen.getByRole('button', { name: 'backup.backupNow' }).props.accessibilityState.busy
  ).toBe(true);
  fireEvent.press(backupButton);
  expect(performBackup).toHaveBeenCalledTimes(1);

  await act(async () => finishBackup?.({ wroteZip: true, carriers: {} }));
  expect(
    screen.getByRole('button', { name: 'backup.backupNow' }).props.accessibilityState.busy
  ).toBe(false);
});

it('reports the archive destination and an import path after Back Up Now', async () => {
  render(<BackupSection />);

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-now-button'));
  });

  expect(screen.getByTestId('backup-success-message')).toHaveTextContent('backup.recordSavedLocal');
  expect(screen.getByTestId('backup-import-button')).toBeTruthy();
  expect(screen.getByTestId('backup-export-button')).toBeTruthy();
});

it('names the WebDAV server as the destination after Back Up Now', async () => {
  mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
  (performBackup as jest.Mock).mockResolvedValueOnce({
    wroteZip: true,
    carriers: { webdav: { status: 'written' } },
  });
  render(<BackupSection />);

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-now-button'));
  });

  expect(screen.getByTestId('backup-success-message')).toHaveTextContent(
    /backup\.recordSavedWebdav:\{"destination":"https:\/\/dav\.example\.org\/remote\.php\/dav\/files\/athlete"\}/
  );
});

it('shows records still waiting for placement as one line with their count', async () => {
  mockUnplaced.mockReturnValue(
    Array.from({ length: 114 }, () => ({
      kind: 'section_history',
      name: null,
      reason: 'ground_not_detected',
    }))
  );
  render(<BackupSection />);

  expect(await screen.findByTestId('backup-unplaced-records')).toBeTruthy();
  expect(screen.getAllByText('backup.unplacedRecords:{"count":114}')).toHaveLength(1);
  expect(screen.queryAllByText(/backup.unplacedGroundNotDetected/)).toHaveLength(0);
  expect(screen.queryAllByText(/backup.unplacedHistory/)).toHaveLength(0);
});

it('names no waiting record on its own line', async () => {
  render(<BackupSection />);

  expect(await screen.findByTestId('backup-unplaced-records')).toBeTruthy();
  expect(screen.getAllByText('backup.unplacedRecords:{"count":2}')).toHaveLength(1);
  expect(screen.queryByText(/Alpine climb/)).toBeNull();
  expect(screen.queryByText(/River bend/)).toBeNull();
});

it('collapses restored records waiting on an activity into one line, never one per record', async () => {
  mockUnplaced.mockReturnValue([
    { kind: 'sections', name: 'Old quarry', reason: 'activity_pending' },
    { kind: 'sections', name: 'Mill road', reason: 'activity_pending' },
    { kind: 'sections', name: null, reason: 'activity_pending' },
  ]);
  render(<BackupSection />);

  expect(await screen.findByTestId('backup-restore-fetch')).toHaveTextContent(
    'backup.unplacedActivityPending'
  );
  expect(screen.getAllByText(/backup.unplacedActivityPending/)).toHaveLength(1);
  expect(screen.queryByText(/Old quarry/)).toBeNull();
  expect(screen.queryByText(/Mill road/)).toBeNull();
  expect(screen.queryByTestId('backup-unplaced-records')).toBeNull();
});

it('shows the shared sync step count as a progress bar while the restore fetch runs', async () => {
  mockSyncStatus = {
    state: SyncState.Syncing,
    step: SyncStep.RecordActivities,
    stepItemsDone: 3,
    stepItemsTotal: 40,
  };
  render(<BackupSection />);

  const bar = await screen.findByTestId('backup-restore-fetch-progress');
  expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 40, now: 3 });
  expect(screen.getByTestId('backup-restore-fetch-counts')).toHaveTextContent('3/40');
});

it('shows no bar when the sync is on another step', async () => {
  mockSyncStatus = {
    state: SyncState.Syncing,
    step: SyncStep.Curves,
    stepItemsDone: 3,
    stepItemsTotal: 40,
  };
  render(<BackupSection />);

  await screen.findByTestId('backup-restore-fetch');
  expect(screen.queryByTestId('backup-restore-fetch-progress')).toBeNull();
});

it('clears the waiting list after detection places the records', async () => {
  const view = render(<BackupSection />);
  expect(await screen.findByTestId('backup-unplaced-records')).toBeTruthy();

  mockUnplaced.mockReturnValue([]);
  mockGeneration += 1;
  view.rerender(<BackupSection />);

  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByTestId('backup-unplaced-records')).toBeNull();
});

it('reports when the waiting list cannot be read', async () => {
  mockUnplaced.mockImplementationOnce(() => {
    throw new Error('read failed');
  });
  render(<BackupSection />);

  expect(await screen.findByTestId('backup-unplaced-read-error')).toHaveTextContent(
    'backup.unplacedReadError'
  );
});

it('refreshes the waiting list after importing a record archive', async () => {
  render(<BackupSection />);
  expect(await screen.findByTestId('backup-unplaced-records')).toBeTruthy();
  expect(mockUnplaced).toHaveBeenCalledTimes(1);

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-import-button'));
  });

  expect(mockUnplaced).toHaveBeenCalledTimes(2);
});

it('refreshes the waiting list after an import that failed', async () => {
  mockImportBackup.mockResolvedValueOnce(null as never);
  render(<BackupSection />);
  expect(await screen.findByTestId('backup-unplaced-records')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-import-button'));
  });

  expect(mockUnplaced).toHaveBeenCalledTimes(2);
});

const PAUSED = { kind: 'import', name: null, reason: 'import_paused' };

it('shows a paused import apart from the waiting records, with Try again', async () => {
  mockUnplaced.mockReturnValue([
    PAUSED,
    { kind: 'section_pins', name: 'Alpine climb', reason: 'activity_unavailable' },
  ]);
  render(<BackupSection />);

  expect(await screen.findByTestId('backup-import-paused')).toHaveTextContent(
    'backup.importPaused'
  );
  expect(screen.getByText('backup.unplacedRecords:{"count":1}')).toBeTruthy();
  expect(screen.getByTestId('backup-import-resume-button')).toBeTruthy();
});

it('resumes the paused import on Try again and reads the list again', async () => {
  mockUnplaced.mockReturnValue([PAUSED]);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<BackupSection />);
  expect(await screen.findByTestId('backup-import-paused')).toBeTruthy();
  expect(screen.queryByTestId('backup-unplaced-records')).toBeNull();

  mockUnplaced.mockReturnValue([]);
  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-import-resume-button'));
  });

  expect(resumeRecordImport).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledWith('backup.restoreComplete', 'backup.recordRestored');
  expect(screen.queryByTestId('backup-import-paused')).toBeNull();
});

it('keeps the import paused when Try again fails', async () => {
  mockUnplaced.mockReturnValue([PAUSED]);
  (resumeRecordImport as jest.Mock).mockRejectedValueOnce(new Error('database or disk is full'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<BackupSection />);
  expect(await screen.findByTestId('backup-import-paused')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-import-resume-button'));
  });

  expect(alert).toHaveBeenCalledWith('common.error', 'backup.importPausedError');
  expect(screen.getByTestId('backup-import-paused')).toBeTruthy();
});

/** Accept the replacement confirmation every record restore asks first. */
function acceptReplacement(alert: jest.SpyInstance) {
  alert.mockImplementation((_title, _message, buttons) => {
    (buttons as AlertButtons | undefined)?.find((b) => b.style === 'destructive')?.onPress?.();
  });
}

type AlertButtons = { text?: string; style?: string; onPress?: () => void }[];

/** The buttons of the one confirmation Discard raised. */
function discardButtons(alert: jest.SpyInstance): AlertButtons {
  const call = alert.mock.calls.find(([title]) => title === 'backup.discardImportTitle');
  expect(call).toBeDefined();
  return call![2] as AlertButtons;
}

it('discards the paused import only once the athlete confirms', async () => {
  mockUnplaced.mockReturnValue([PAUSED]);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<BackupSection />);
  expect(await screen.findByTestId('backup-import-paused')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-import-discard-button'));
  });
  expect(discardRecordImport).not.toHaveBeenCalled();
  const buttons = discardButtons(alert);
  expect(buttons.map((button) => button.style)).toEqual(['cancel', 'destructive']);

  mockUnplaced.mockReturnValue([]);
  await act(async () => {
    buttons[1].onPress?.();
  });
  expect(discardRecordImport).toHaveBeenCalledTimes(1);
  expect(resumeRecordImport).not.toHaveBeenCalled();
  expect(screen.queryByTestId('backup-import-paused')).toBeNull();
});

it('keeps the paused import when Discard is declined', async () => {
  mockUnplaced.mockReturnValue([PAUSED]);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<BackupSection />);
  expect(await screen.findByTestId('backup-import-paused')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-import-discard-button'));
  });
  await act(async () => {
    discardButtons(alert)[0].onPress?.();
  });
  expect(discardRecordImport).not.toHaveBeenCalled();
  expect(screen.getByTestId('backup-import-paused')).toBeTruthy();
});

it('says so when the discard fails, and keeps the import paused', async () => {
  mockUnplaced.mockReturnValue([PAUSED]);
  (discardRecordImport as jest.Mock).mockRejectedValueOnce(new Error('disk I/O error'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<BackupSection />);
  expect(await screen.findByTestId('backup-import-paused')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-import-discard-button'));
  });
  await act(async () => {
    discardButtons(alert)[1].onPress?.();
  });
  expect(alert).toHaveBeenCalledWith('common.error', 'backup.discardImportError');
  expect(screen.getByTestId('backup-import-paused')).toBeTruthy();
});

/** The buttons of the one confirmation discarding the waiting records raised. */
function discardWaitingButtons(alert: jest.SpyInstance): AlertButtons {
  const call = alert.mock.calls.find(([title]) => title === 'backup.discardWaitingTitle');
  expect(call).toBeDefined();
  return call![2] as AlertButtons;
}

it('discards the waiting records only once the athlete confirms, then reads the list again', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<BackupSection />);
  expect(await screen.findByTestId('backup-unplaced-records')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-unplaced-discard-button'));
  });
  expect(discardUnplacedRecords).not.toHaveBeenCalled();
  const buttons = discardWaitingButtons(alert);
  expect(buttons.map((button) => button.style)).toEqual(['cancel', 'destructive']);

  mockUnplaced.mockReturnValue([]);
  await act(async () => {
    buttons[1].onPress?.();
  });
  expect(discardUnplacedRecords).toHaveBeenCalledTimes(1);
  expect(discardRecordImport).not.toHaveBeenCalled();
  expect(screen.queryByTestId('backup-unplaced-records')).toBeNull();
});

it('keeps the waiting records when their discard is declined', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<BackupSection />);
  expect(await screen.findByTestId('backup-unplaced-records')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-unplaced-discard-button'));
  });
  await act(async () => {
    discardWaitingButtons(alert)[0].onPress?.();
  });
  expect(discardUnplacedRecords).not.toHaveBeenCalled();
  expect(screen.getByTestId('backup-unplaced-records')).toBeTruthy();
});

it('says so when discarding the waiting records fails, and keeps them', async () => {
  (discardUnplacedRecords as jest.Mock).mockRejectedValueOnce(new Error('disk I/O error'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<BackupSection />);
  expect(await screen.findByTestId('backup-unplaced-records')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-unplaced-discard-button'));
  });
  await act(async () => {
    discardWaitingButtons(alert)[1].onPress?.();
  });
  expect(alert).toHaveBeenCalledWith('common.error', 'backup.discardWaitingError');
  expect(screen.getByTestId('backup-unplaced-records')).toBeTruthy();
});

it('downloads and restores a selected archive from WebDAV', async () => {
  mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
  acceptReplacement(jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
  render(<BackupSection />);

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-list-button'));
  });
  expect(screen.getByTestId('backup-entry-webdav-veloq-2026-09-30.zip')).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-entry-webdav-veloq-2026-09-30.zip'));
  });

  expect(mockDownload).toHaveBeenCalledWith(
    'veloq-2026-09-30.zip',
    expect.stringMatching(/^file:\/\/\/cache\/restores\/restore-selected-\d+\.zip$/)
  );
  expect(restoreRecordBackup).toHaveBeenCalledWith(mockDownload.mock.calls[0][1]);
});

it('starts one restore when a selected archive is tapped twice', async () => {
  mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
  acceptReplacement(jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
  render(<BackupSection />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-list-button'));
  });

  await act(async () => {
    const entry = screen.getByTestId('backup-entry-webdav-veloq-2026-09-30.zip');
    fireEvent.press(entry);
    fireEvent.press(entry);
  });

  expect(mockDownload).toHaveBeenCalledTimes(1);
  expect(restoreRecordBackup).toHaveBeenCalledTimes(1);
});

it('shows an account warning when a selected legacy database belongs to another athlete', async () => {
  mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
  mockListBackups.mockResolvedValueOnce([
    {
      id: 'older.veloqdb',
      timestamp: '2026-09-30T10:00:00.000Z',
      sizeBytes: 4096,
      appVersion: '0.3.0',
    },
  ]);
  (restoreDatabaseBackup as jest.Mock).mockResolvedValue({
    success: false,
    activityCount: 0,
    athleteIdMismatch: true,
    error: 'Account mismatch',
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  acceptReplacement(alert);
  render(<BackupSection />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-list-button'));
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('backup-entry-webdav-older.veloqdb'));
  });

  expect(alert).toHaveBeenCalledWith('common.error', 'backup.backupDifferentAccount');
});

it.each(['veloq-2026-09-30.zip', 'older.veloqdb'])(
  'downloads and restores nothing from %s when the replacement is declined',
  async (id) => {
    mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
    mockListBackups.mockResolvedValueOnce([
      { id, timestamp: '2026-09-30T10:00:00.000Z', sizeBytes: 4096, appVersion: '0.3.0' },
    ]);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      (buttons as AlertButtons | undefined)?.find((b) => b.style === 'cancel')?.onPress?.();
    });
    render(<BackupSection />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-list-button'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId(`backup-entry-webdav-${id}`));
    });

    expect(alert).toHaveBeenCalledWith(
      'backup.importBackup',
      'backup.legacyImportMessage',
      expect.any(Array),
      expect.anything()
    );
    expect(mockDownload).not.toHaveBeenCalled();
    expect(restoreRecordBackup).not.toHaveBeenCalled();
    expect(restoreDatabaseBackup).not.toHaveBeenCalled();
  }
);

describe('carriers', () => {
  it('shows the device backup, WebDAV and folder rows with no destination picker', () => {
    render(<BackupSection />);

    expect(screen.queryByText('backup.selectBackend')).toBeNull();
    expect(screen.getByTestId('backup-carrier-device')).toBeTruthy();
    expect(screen.getByTestId('backup-carrier-webdav')).toBeTruthy();
    expect(screen.getByTestId('backup-carrier-folder')).toBeTruthy();
  });

  it('leaves the switch on when WebDAV is removed', async () => {
    mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('webdav-remove'));
    });

    expect(mockSetAutoEnabled).not.toHaveBeenCalled();
    expect(screen.getByTestId('backup-auto-switch').props.value).toBe(true);
  });

  it('names every destination a Back Up Now run wrote', async () => {
    mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
    mockFolderName = 'Records';
    (performBackup as jest.Mock).mockResolvedValueOnce({
      wroteZip: true,
      carriers: { webdav: { status: 'written' }, folder: { status: 'written' } },
    });
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-now-button'));
    });

    const text = screen.getByTestId('backup-success-message');
    expect(text).toHaveTextContent(/backup\.recordSavedWebdav/);
    expect(text).toHaveTextContent(/backup\.recordSavedFolder:\{"destination":"Records"\}/);
  });

  it('names a destination that failed beside the ones that wrote', async () => {
    mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
    mockFolderName = 'Records';
    (performBackup as jest.Mock).mockResolvedValueOnce({
      wroteZip: true,
      carriers: {
        webdav: { status: 'written' },
        folder: { status: 'failed', kind: 'folder_unavailable' },
      },
    });
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-now-button'));
    });

    expect(screen.getByTestId('backup-success-message')).toHaveTextContent(
      /backup\.recordSavedWebdav/
    );
    expect(screen.getByTestId('backup-carrier-failed-folder')).toBeTruthy();
  });

  it('says a WebDAV copy skipped offline was not written and goes once the device is online', async () => {
    mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
    mockAutoEnabled = false;
    (performBackup as jest.Mock).mockResolvedValueOnce({
      wroteZip: true,
      carriers: { webdav: { status: 'skipped', reason: 'no-radio' } },
    });
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-now-button'));
    });

    expect(screen.getByTestId('backup-success-message')).not.toHaveTextContent(
      /backup\.recordSavedWebdav/
    );
    const owed = screen.getByTestId('backup-carrier-owed-webdav');
    expect(owed).toHaveTextContent(/backup\.carrierNotWritten/);
    expect(owed).toHaveTextContent(/backup\.carrierSentWhenOnline/);
  });

  it('says nothing about a carrier that is not set up', async () => {
    (performBackup as jest.Mock).mockResolvedValueOnce({
      wroteZip: true,
      carriers: { folder: { status: 'skipped', reason: 'unavailable' } },
    });
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-now-button'));
    });

    expect(screen.queryByTestId('backup-carrier-owed-folder')).toBeNull();
    expect(screen.queryByTestId('backup-carrier-failed-folder')).toBeNull();
  });

  it('shows the chosen folder, and Remove clears only the folder', async () => {
    mockPickFolder.mockImplementation(async () => {
      mockFolderName = 'Records';
      return 'Records';
    });
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-folder-choose'));
    });
    expect(screen.getByTestId('backup-carrier-folder')).toHaveTextContent(/Records/);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-folder-remove'));
    });
    expect(mockForgetFolder).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('backup-carrier-folder')).not.toHaveTextContent(/Records/);
    expect(mockSetAutoEnabled).not.toHaveBeenCalled();
  });

  it('keeps the folder when the picker is dismissed', async () => {
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-folder-choose'));
    });

    expect(screen.queryByTestId('backup-folder-remove')).toBeNull();
  });

  it('shows each carrier its own failure', () => {
    mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
    mockFolderName = 'Records';
    mockFailures = {
      webdav: { kind: 'auth', status: 401, at: Date.now() },
      folder: { kind: 'folder_unavailable', status: null, at: Date.now() },
    };
    render(<BackupSection />);

    expect(screen.getByTestId('backup-carrier-webdav')).toHaveTextContent(
      /backup\.backupFailedAuth/
    );
    expect(screen.getByTestId('backup-carrier-folder')).toHaveTextContent(
      /backup\.backupFailedFolder/
    );
    expect(screen.getByTestId('backup-carrier-device')).not.toHaveTextContent(
      /backup\.backupFailed/
    );
  });

  it('groups the restore list by carrier and restores from the carrier of the entry', async () => {
    mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
    mockFolderName = 'Records';
    acceptReplacement(jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-list-button'));
    });

    expect(screen.getByTestId('backup-group-webdav')).toBeTruthy();
    expect(screen.getByTestId('backup-group-folder')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-entry-folder-veloq-2026-10-01T06-00-00-000Z.zip'));
    });
    expect(mockDownload).toHaveBeenCalledWith(
      'veloq-2026-10-01T06-00-00-000Z.zip',
      expect.stringMatching(/restore-selected-\d+\.zip$/)
    );
  });
});

describe('restoring with only the device backup', () => {
  it('says the device backup comes back on a new phone rather than that nothing was found', async () => {
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-list-button'));
    });

    const message = screen.getByTestId('backup-none-found');
    expect(message).toHaveTextContent(/^backup\.noBrowsableDestination/);
    expect(message).not.toHaveTextContent(/backup\.noBackupsAtDestination/);
    expect(mockListBackups).not.toHaveBeenCalled();
  });

  it('still lists older backups kept on this device', async () => {
    mockLocalBackups = [
      { id: 'older.zip', timestamp: '2026-03-01T10:00:00.000Z', sizeBytes: 1, appVersion: '' },
    ];
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-list-button'));
    });

    expect(screen.getByTestId('backup-entry-local-older.zip')).toBeTruthy();
    expect(screen.queryByTestId('backup-none-found')).toBeNull();
  });

  it.each([
    ['WebDAV', () => (mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete')],
    ['a folder', () => (mockFolderName = 'Records')],
  ])('reports nothing found when %s is set up and empty', async (_name, setUp) => {
    setUp();
    mockListBackups.mockResolvedValueOnce([]);
    mockFolderBackups = [];
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-list-button'));
    });

    expect(screen.getByTestId('backup-none-found')).toHaveTextContent(
      /^backup\.noBackupsAtDestination/
    );
  });

  it('says on the device backup row that it is restored when a new phone is set up', () => {
    render(<BackupSection />);

    expect(screen.getByTestId('backup-carrier-device')).toHaveTextContent(
      /backup\.carrierDeviceRestore/
    );
  });
});

describe('each destination shows when it last received a backup', () => {
  it('dates every destination that has received one', () => {
    mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
    mockFolderName = 'Records';
    mockDestinationStamps = {
      device: Date.parse('2026-05-04T06:30:00Z'),
      webdav: Date.parse('2026-05-03T06:30:00Z'),
      folder: Date.parse('2026-05-02T06:30:00Z'),
    };
    render(<BackupSection />);

    for (const id of ['device', 'webdav', 'folder']) {
      expect(screen.getByTestId(`backup-carrier-last-${id}`)).toHaveTextContent(
        /^backup\.lastBackup:\{"date":".+"\}$/
      );
    }
  });

  it('says a set up destination has not received one yet', () => {
    mockWebdavUrl = 'https://dav.example.org/remote.php/dav/files/athlete';
    mockFolderName = 'Records';
    render(<BackupSection />);

    for (const id of ['device', 'webdav', 'folder']) {
      expect(screen.getByTestId(`backup-carrier-last-${id}`)).toHaveTextContent(
        'backup.lastBackupNever'
      );
    }
  });

  it('shows no date on a destination that is not set up', () => {
    render(<BackupSection />);

    expect(screen.getByTestId('backup-carrier-last-device')).toBeTruthy();
    expect(screen.queryByTestId('backup-carrier-last-webdav')).toBeNull();
    expect(screen.queryByTestId('backup-carrier-last-folder')).toBeNull();
  });
});

describe("the device row on Android reads what Android's backup did", () => {
  const originalOS = Platform.OS;
  const status = {
    backedUpAt: null,
    backedUpBytes: null,
    quotaExceededAt: null,
    quotaExceededBytes: null,
    quotaBytes: null,
    restoredAt: null,
  };

  beforeEach(() => {
    Platform.OS = 'android';
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it("dates the row by Android's backup, not by when Veloq wrote its zip", () => {
    mockDestinationStamps = { device: Date.parse('2026-05-04T06:30:00Z') };
    mockAndroidBackup = {
      ...status,
      backedUpAt: Date.parse('2026-05-01T02:00:00Z'),
      backedUpBytes: 4_200_000,
    };
    render(<BackupSection />);

    expect(screen.getByTestId('backup-carrier-last-device')).toHaveTextContent(
      /^backup\.androidLastBackup:\{"date":".+","size":"4\.2 MB"\}$/
    );
    expect(screen.queryByText(/^backup\.lastBackup:/)).toBeNull();
  });

  it('says Android has not backed Veloq up when it never has, whatever Veloq wrote', () => {
    mockDestinationStamps = { device: Date.parse('2026-05-04T06:30:00Z') };
    mockAndroidBackup = status;
    render(<BackupSection />);

    expect(screen.getByTestId('backup-carrier-last-device')).toHaveTextContent(
      'backup.androidBackupNever'
    );
  });

  it('shows a quota overrun as a failure with both sizes', () => {
    mockAndroidBackup = {
      ...status,
      backedUpAt: Date.parse('2026-05-01T02:00:00Z'),
      backedUpBytes: 4_200_000,
      quotaExceededAt: Date.parse('2026-05-02T02:00:00Z'),
      quotaExceededBytes: 30_000_000,
      quotaBytes: 25_000_000,
    };
    render(<BackupSection />);

    expect(screen.getByTestId('backup-carrier-device-quota')).toHaveTextContent(
      /^backup\.androidQuotaExceeded:\{"date":".+","size":"30\.0 MB","quota":"25\.0 MB"\}$/
    );
  });

  it('says when Veloq was restored from an Android backup', () => {
    mockAndroidBackup = { ...status, restoredAt: Date.parse('2026-04-30T09:00:00Z') };
    render(<BackupSection />);

    expect(screen.getByTestId('backup-carrier-device-restored')).toHaveTextContent(
      /^backup\.androidRestored:\{"date":".+"\}$/
    );
  });

  it('shows no failure or restore that did not happen', () => {
    mockAndroidBackup = { ...status, backedUpAt: 1_000, backedUpBytes: 4_096 };
    render(<BackupSection />);

    expect(screen.queryByTestId('backup-carrier-device-quota')).toBeNull();
    expect(screen.queryByTestId('backup-carrier-device-restored')).toBeNull();
  });
});

describe('one layout', () => {
  const explanations = [
    'backup.autoBackupDescription',
    'backup.recordContents',
    'backup.platformRestorePath',
    'backup.carrierDeviceDescription',
    'backup.manualRestorePath',
    'backup.notEncryptedWarning',
    'backup.localRestorePath',
  ];

  it('draws no explanation inline, only labels and states', () => {
    render(<BackupSection />);

    for (const key of explanations) {
      expect(screen.queryByText(new RegExp(`^${key}`))).toBeNull();
    }
    expect(screen.queryByTestId('backup-not-encrypted-notice')).toBeNull();
    expect(screen.queryByTestId('backup-automatic-restore-path')).toBeNull();
    expect(screen.queryByTestId('backup-manual-restore-path')).toBeNull();
  });

  it.each([
    ['backup-info-auto', ['backup.autoBackupDescription', 'backup.recordContents']],
    ['backup-info-restore', ['backup.restoreInfo', 'backup.manualRestorePath']],
    ['backup-info-destinations', ['backup.carrierDeviceDescription', 'backup.platformRestorePath']],
    ['backup-info-export', ['backup.notEncryptedWarning']],
  ])('keeps the explanation behind %s', (testID, keys) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<BackupSection />);

    fireEvent.press(screen.getByTestId(testID));

    expect(alert).toHaveBeenCalledTimes(1);
    const message = String(alert.mock.calls[0]?.[1]);
    for (const key of keys) expect(message).toContain(key);
  });

  it('names every info button after its topic, each one a control of its own', () => {
    render(<BackupSection />);

    const names = ['auto', 'restore', 'destinations', 'export'].map((id) => {
      const name = screen.getByTestId(`backup-info-${id}`).props.accessibilityLabel as string;
      expect(name).toMatch(/^backup\.aboutTopic/);
      expect(screen.getByRole('button', { name })).toBeTruthy();
      return name;
    });
    expect(new Set(names).size).toBe(names.length);

    for (const [row, info] of [
      ['backup-list-button', 'backup-info-restore'],
      ['backup-export-button', 'backup-info-export'],
    ] as const) {
      expect(within(screen.getByTestId(row)).queryByTestId(info)).toBeNull();
    }
  });
});

describe('the Google Drive destination', () => {
  it('is not offered where the build cannot reach Google Drive', () => {
    render(<BackupSection />);
    expect(screen.queryByTestId('backup-carrier-google-drive')).toBeNull();
  });

  it('signs in from its row, names the account and sends a copy it was owed', async () => {
    mockDriveSupported = true;
    mockDriveSignIn.mockResolvedValue('rider@example.org');
    render(<BackupSection />);
    expect(screen.getByTestId('backup-google-drive-account')).toHaveTextContent(
      'backup.carrierGoogleDriveNone'
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-google-drive-sign-in'));
    });

    expect(screen.getByTestId('backup-google-drive-account')).toHaveTextContent(
      'rider@example.org'
    );
    expect(mockCarrierSignedIn).toHaveBeenCalledWith('googleDrive');
    expect(screen.getByTestId('backup-google-drive-sign-out')).toBeTruthy();
    expect(screen.queryByTestId('backup-google-drive-sign-in')).toBeNull();
  });

  it('keeps the row signed out when the athlete dismisses the picker', async () => {
    mockDriveSupported = true;
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-google-drive-sign-in'));
    });

    expect(screen.getByTestId('backup-google-drive-account')).toHaveTextContent(
      'backup.carrierGoogleDriveNone'
    );
    expect(mockCarrierSignedIn).not.toHaveBeenCalled();
  });

  it('offers a sign-in beside the failure when the sign-in lapsed', async () => {
    mockDriveSupported = true;
    mockDriveAccount = 'rider@example.org';
    mockFailures = { googleDrive: { kind: 'signin', status: 401, at: Date.now() } };
    render(<BackupSection />);

    expect(await screen.findByTestId('backup-carrier-failure-google-drive')).toBeTruthy();
    expect(screen.getByTestId('backup-google-drive-sign-in')).toBeTruthy();
    expect(screen.getByTestId('backup-google-drive-sign-out')).toBeTruthy();
  });

  it('lists its backups among the restore choices once signed in, and restores one', async () => {
    mockDriveSupported = true;
    mockDriveAccount = 'rider@example.org';
    acceptReplacement(jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
    render(<BackupSection />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-list-button'));
    });
    expect(screen.getByTestId('backup-group-googleDrive')).toBeTruthy();

    await act(async () => {
      fireEvent.press(
        screen.getByTestId('backup-entry-googleDrive-veloq-2026-10-02T06-00-00-000Z.zip')
      );
    });
    expect(mockDownload).toHaveBeenCalledWith(
      'veloq-2026-10-02T06-00-00-000Z.zip',
      expect.stringMatching(/restore-selected-\d+\.zip$/)
    );
  });

  it('signs out and forgets the account, which leaves the row signed out', async () => {
    mockDriveSupported = true;
    mockDriveAccount = 'rider@example.org';
    render(<BackupSection />);
    await act(async () => {});

    await act(async () => {
      fireEvent.press(screen.getByTestId('backup-google-drive-sign-out'));
    });

    expect(mockDriveForget).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('backup-google-drive-account')).toHaveTextContent(
      'backup.carrierGoogleDriveNone'
    );
  });
});
