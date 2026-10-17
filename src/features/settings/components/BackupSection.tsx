import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, type ViewInstance } from 'react-native';
import { Text } from 'react-native-paper';
import {
  Button,
  Card,
  ListSectionHeader,
  ProgressRow,
  Row,
  StatusLine,
  SwitchRow,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { RowDivider } from '@/shared/ui/RowGroup';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SyncState, SyncStep } from 'veloqrs';
import type { FfiUnplacedRecord } from 'veloqrs';
import {
  useExportRecordBackup,
  useImportDatabaseBackup,
  useBulkExport,
} from '@/features/settings/hooks/exportIndex';
import { useTheme } from '@/shared/app';
import { useActivityCount } from '@/shared/native/useActivityCount';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { useEngineRead, useEngineSubscription } from '@/shared/native/useEngineSubscription';
import {
  isAutoBackupEnabled,
  setAutoBackupEnabled,
  getLastBackupTimestamp,
  getDestinationLastBackup,
  getUnplacedBackupRecords,
  getBackupFailures,
  failureMessageKey,
  performBackup,
  localBackend,
  webdavBackend,
  folderBackend,
  pickBackupFolder,
  getBackupFolderName,
  forgetBackupFolder,
  getWebdavConfig,
  icloudBackend,
  icloudBackupState,
  isIcloudBackupOn,
  isIcloudSupported,
  setIcloudBackupOn,
  type BackupDestination,
  type BackupFailure,
  type BackupRunResult,
  type BackupBackend,
  type BackupEntry,
  type IcloudBackupState,
} from '@/features/settings/lib/autobackup';
import {
  cancelRecordBackup,
  discardRecordImport,
  discardUnplacedRecords,
  resumeRecordImport,
} from '@/features/settings/lib/backup';
import { engineErrorTag } from '@/shared/native/engineError';
import {
  forgetGoogleDrive,
  getGoogleDriveAccount,
  googleDriveBackend,
  isGoogleDriveSupported,
  loadGoogleDriveAccount,
  signInToGoogleDrive,
} from '@/features/settings/lib/autobackup/backends/googleDriveBackend';
import { onBackupCarrierSignedIn } from '@/features/settings/lib/autobackup/autoBackup';
import { restoreBackendEntry } from '@/features/settings/lib/restoreBackendEntry';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { InfoButton } from './InfoButton';
import { BulkExportProgress } from './BulkExportProgress';
import { BULK_EXPORT_FORMAT_NAME } from '@/features/settings/lib/bulkExportFormat';
import { ExportPrivacyRow } from './ExportPrivacyRow';
import { BackupEntryRow } from './BackupEntryRow';
import {
  WebdavConfigForm,
  type WebdavCommit,
  type WebdavConfigFormHandle,
} from './WebdavConfigForm';
import { describeBackupFailure } from '@/features/settings/lib/backupFailure';
import { formatFileSize, getIntlLocale } from '@/shared/format/format';
import { getAndroidAutoBackupStatus } from '@/shared/native/androidAutoBackup';
import { androidAutoBackupLines } from '@/features/settings/lib/androidAutoBackupLines';
import { confirmAction, inform } from '@/shared/ui/dialog';
import { restoreDropLines, showRestoreNotice } from '@/features/settings/lib/restoreNotice';

/** The entries one carrier listed, restored through that carrier. */
interface CarrierEntries {
  backend: BackupBackend;
  entries: BackupEntry[];
}

function carrierName(t: TFunction, id: string): string {
  switch (id) {
    case 'webdav':
      return t('backup.backendWebdav');
    case 'folder':
      return t('backup.carrierFolder');
    case 'googleDrive':
      return t('backup.carrierGoogleDrive');
    case 'icloud':
      return t('backup.carrierIcloud');
    case 'local':
      return t('backup.carrierOlderOnDevice');
    default:
      return id;
  }
}

/** Every failure line in this section, in the error tone of the active theme. */
function errorStyle(isDark: boolean) {
  return [styles.detail, styles.error, isDark && styles.errorDark];
}

interface BackupRunStatus {
  tone: 'error' | 'success';
  spoken: (string | null)[];
  saved: string[] | null;
  carriers: { id: string; state: 'failed' | 'owed'; lines: string[] }[];
  error: string | null;
}

/**
 * What the last Back Up Now left to say: where it was saved, each carrier it
 * did not reach, or the error. One announcement for the lot, assertive when
 * any part of it failed.
 */
function describeBackupRun(
  t: TFunction,
  result: 'success' | 'error' | null,
  error: string | null,
  run: BackupRunResult | null,
  destinations: { webdav: string; folder: string; googleDrive: string }
): BackupRunStatus | null {
  if (result === 'error') {
    return { tone: 'error', spoken: [error], saved: null, carriers: [], error };
  }
  if (result !== 'success') return null;
  const carriers = run?.carriers;
  const saved = [
    t('backup.recordSavedLocal'),
    ...(carriers?.webdav?.status === 'written'
      ? [t('backup.recordSavedWebdav', { destination: destinations.webdav })]
      : []),
    ...(carriers?.folder?.status === 'written'
      ? [t('backup.recordSavedFolder', { destination: destinations.folder })]
      : []),
    ...(carriers?.googleDrive?.status === 'written'
      ? [t('backup.recordSavedGoogleDrive', { destination: destinations.googleDrive })]
      : []),
    ...(carriers?.icloud?.status === 'written' ? [t('backup.recordSavedIcloud')] : []),
  ];
  const missed: BackupRunStatus['carriers'] = [];
  for (const [id, outcome] of Object.entries(carriers ?? {})) {
    const notWritten = t('backup.carrierNotWritten', { destination: carrierName(t, id) });
    if (outcome.status === 'failed') {
      const kind = outcome.kind === 'unknown' ? 'transport' : outcome.kind;
      missed.push({ id, state: 'failed', lines: [notWritten, t(failureMessageKey(kind))] });
    } else if (outcome.status === 'skipped' && outcome.reason === 'no-radio') {
      missed.push({ id, state: 'owed', lines: [notWritten, t('backup.carrierSentWhenOnline')] });
    }
  }
  return {
    tone: missed.length > 0 ? 'error' : 'success',
    spoken: [...saved, ...missed.flatMap((carrier) => carrier.lines)],
    saved,
    carriers: missed,
    error: null,
  };
}

/** The failure a carrier's last run left, in words the athlete can act on. */
function CarrierFailure({
  failure,
  testID,
}: {
  failure: BackupFailure | undefined;
  testID: string;
}) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  if (!failure) return null;
  return (
    <Text testID={testID} style={errorStyle(isDark)}>
      {t('backup.lastAttemptFailed', {
        date: new Date(failure.at).toLocaleDateString(getIntlLocale()),
      })}
      {'\n'}
      {t(failureMessageKey(failure.kind))}
    </Text>
  );
}

/** When one destination last took a backup, or that it has not yet. */
function DestinationLastBackup({ at, testID }: { at: number | null; testID: string }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  return (
    <Text testID={testID} style={[styles.detail, isDark && settingsStyles.textSecondary]}>
      {at === null
        ? t('backup.lastBackupNever')
        : t('backup.lastBackup', { date: new Date(at).toLocaleDateString(getIntlLocale()) })}
    </Text>
  );
}

/**
 * What Android's Auto Backup last did, as its backup agent recorded it. Veloq
 * writing its zip says nothing about whether Android took it, so on Android the
 * device row reads this rather than that stamp.
 */
function AndroidAutoBackupState() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [lines] = useState(() => androidAutoBackupLines(getAndroidAutoBackupStatus()));
  const day = (at: number) => new Date(at).toLocaleDateString(getIntlLocale());
  const detailStyle = [styles.detail, isDark && settingsStyles.textSecondary];
  return (
    <>
      {lines.map((line) => {
        switch (line.kind) {
          case 'never':
            return (
              <Text key={line.kind} testID="backup-carrier-last-device" style={detailStyle}>
                {t('backup.androidBackupNever')}
              </Text>
            );
          case 'backedUp':
            return (
              <Text key={line.kind} testID="backup-carrier-last-device" style={detailStyle}>
                {t('backup.androidLastBackup', {
                  date: day(line.at),
                  size: formatFileSize(line.bytes),
                })}
              </Text>
            );
          case 'quotaExceeded':
            return (
              <Text key={line.kind} testID="backup-carrier-device-quota" style={errorStyle(isDark)}>
                {t('backup.androidQuotaExceeded', {
                  date: day(line.at),
                  size: formatFileSize(line.bytes),
                  quota: formatFileSize(line.quotaBytes),
                })}
              </Text>
            );
        }
        return (
          <Text key={line.kind} testID="backup-carrier-device-restored" style={detailStyle}>
            {t('backup.androidRestored', { date: day(line.at) })}
          </Text>
        );
      })}
    </>
  );
}

export function BackupSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // Auto-backup state
  const [autoEnabled, setAutoEnabled] = useState(() => isAutoBackupEnabled());
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<'success' | 'error' | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  // The athlete stopped the last Back Up Now. Kept until the next one starts.
  const [backupCancelled, setBackupCancelled] = useState(false);
  const [backendBackups, setBackendBackups] = useState<CarrierEntries[] | null>(null);
  // Whether the last listing read a destination the athlete set up, rather
  // than only the older backups on this device.
  const [listedSetUpDestination, setListedSetUpDestination] = useState(false);
  const [webdavSet, setWebdavSet] = useState(() => getWebdavConfig() !== null);
  const [folderName, setFolderName] = useState(() => getBackupFolderName());
  const driveSupported = isGoogleDriveSupported();
  const [driveAccount, setDriveAccount] = useState(() =>
    driveSupported ? getGoogleDriveAccount() : null
  );
  const [signingInToDrive, setSigningInToDrive] = useState(false);
  const icloudSupported = isIcloudSupported();
  const [icloudOn, setIcloudOn] = useState(() => icloudSupported && isIcloudBackupOn());
  const [icloudState, setIcloudState] = useState<IcloudBackupState | null>(null);
  // Moves when a sign-in clears a carrier's failure or pays a copy it was owed,
  // which no backup on this screen did.
  const [carrierGeneration, setCarrierGeneration] = useState(0);
  const [runResult, setRunResult] = useState<BackupRunResult | null>(null);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [restoringEntry, setRestoringEntry] = useState<string | null>(null);
  const restoreRunning = useRef(false);
  // A backup on this screen, or a sign-in that clears a failure or pays an owed
  // copy, is the only thing that moves either value, so those are the keys
  // both reads are taken on.
  const readBackupState = useEngineRead([], [backingUp, carrierGeneration]);
  const unplacedGeneration = useEngineSubscription(['sections', 'detectionApplied']);
  const [restoreGeneration, setRestoreGeneration] = useState(0);
  const [unplacedRecords, setUnplacedRecords] = useState<FfiUnplacedRecord[]>([]);
  const [unplacedReadError, setUnplacedReadError] = useState(false);
  // What the latest restore gave up on stays told after its notice has gone,
  // since a later pass can add to it.
  const readRestoreDrops = useEngineRead(['sections', 'detectionApplied'], [restoreGeneration]);
  const restoreDrops = useMemo(() => {
    const data = readRestoreDrops((engine) => engine.getBackupScreenData());
    return data ? restoreDropLines(data, t) : [];
  }, [readRestoreDrops, t]);
  const [resumingImport, setResumingImport] = useState(false);
  // The engine lists a paused import with the waiting records, and it is
  // shown apart from them because Try again is its action, not theirs.
  const importPaused = unplacedRecords.some((record) => record.reason === 'import_paused');
  const waitingRecords = useMemo(
    () =>
      unplacedRecords.filter(
        (record) => record.reason !== 'import_paused' && record.reason !== 'activity_pending'
      ),
    [unplacedRecords]
  );
  // Records waiting on an activity are one fetch, reported once through the
  // shared sync status rather than as a line per record.
  const fetchingActivities = unplacedRecords.some((record) => record.reason === 'activity_pending');
  const syncStatus = useSyncStatus();
  const fetchTotal =
    syncStatus?.state === SyncState.Syncing && syncStatus.step === SyncStep.RecordActivities
      ? syncStatus.stepItemsTotal
      : 0;
  const fetchDone = Math.min(syncStatus?.stepItemsDone ?? 0, fetchTotal);
  const lastBackupTs = useMemo(
    () => readBackupState(() => getLastBackupTimestamp()) ?? null,
    [readBackupState]
  );
  const destinationStamps = useMemo<Record<BackupDestination, number | null>>(
    () =>
      readBackupState(() => ({
        device: getDestinationLastBackup('device'),
        webdav: webdavSet ? getDestinationLastBackup('webdav') : null,
        folder: folderName ? getDestinationLastBackup('folder') : null,
        googleDrive: driveAccount ? getDestinationLastBackup('googleDrive') : null,
        icloud: icloudOn ? getDestinationLastBackup('icloud') : null,
      })) ?? { device: null, webdav: null, folder: null, googleDrive: null, icloud: null },
    // A carrier set up or removed changes which stamp applies.
    [readBackupState, webdavSet, folderName, driveAccount, icloudOn]
  );
  // A failure the user has to act on survives leaving the screen, so an
  // unattended backup that was rejected is not invisible.
  const carrierFailures = useMemo<Record<string, BackupFailure>>(
    () => readBackupState(() => getBackupFailures()) ?? {},
    [readBackupState]
  );
  useEffect(() => {
    let active = true;
    if (driveSupported) {
      loadGoogleDriveAccount().then((account) => {
        if (active) setDriveAccount(account);
      });
    }
    return () => {
      active = false;
    };
  }, [driveSupported]);
  // Whether iCloud can be written to is the phone's to say, and is read again
  // whenever the athlete turns the destination back on.
  useEffect(() => {
    let active = true;
    if (icloudSupported) {
      icloudBackupState().then((state) => {
        if (active) setIcloudState(state);
      });
    }
    return () => {
      active = false;
    };
  }, [icloudSupported, icloudOn]);
  useEffect(() => {
    let active = true;
    getUnplacedBackupRecords()
      .then((records) => {
        if (active) {
          setUnplacedRecords(records);
          setUnplacedReadError(false);
        }
      })
      .catch(() => {
        if (active) setUnplacedReadError(true);
      });
    return () => {
      active = false;
    };
  }, [unplacedGeneration, restoreGeneration]);

  // Every action that reads the WebDAV details stores what the form shows
  // first, since a tap that leaves a field with focus skips its blur.
  const webdavForm = useRef<WebdavConfigFormHandle>(null);
  const commitWebdav = useCallback(
    async (): Promise<WebdavCommit> => (await webdavForm.current?.commit()) ?? { kind: 'empty' },
    []
  );

  const describeBackupError = useCallback(
    (error: unknown): string => {
      const described = describeBackupFailure(error);
      return described.kind === 'key' ? t(described.key) : described.message;
    },
    [t]
  );

  const runBackup = useCallback(async () => {
    setBackingUp(true);
    setBackupResult(null);
    setBackupError(null);
    setBackupCancelled(false);
    setRunResult(null);
    try {
      // A half-typed server is a destination the athlete meant to include, so
      // its refusal stops the run rather than leaving WebDAV quietly out.
      const committed = await commitWebdav();
      if (committed.kind === 'refused') {
        setBackupResult('error');
        setBackupError(committed.message);
        return;
      }
      const result = await performBackup(true);
      const success = result.wroteZip;
      setRunResult(result);
      setBackupResult(success ? 'success' : 'error');
      if (!success) setBackupError(t('backup.backupFailedMessage'));
    } catch (error) {
      // A stop the athlete asked for wrote nothing and is not a failure.
      if (engineErrorTag(error) === 'Cancelled') {
        setBackupCancelled(true);
        return;
      }
      setBackupResult('error');
      setBackupError(describeBackupError(error));
    } finally {
      setBackingUp(false);
    }
  }, [commitWebdav, describeBackupError, t]);

  const handleToggleAutoBackup = useCallback(
    async (value: boolean) => {
      setAutoBackupEnabled(value);
      setAutoEnabled(value);
      // Trigger immediate backup when enabling auto-backup
      if (value) await runBackup();
    },
    [runBackup]
  );

  // While a backup runs the button is its Cancel. The outcome arrives as the
  // run's own rejection.
  const handleBackupNow = useCallback(async () => {
    if (backingUp) {
      cancelRecordBackup();
      return;
    }
    await runBackup();
  }, [backingUp, runBackup]);

  const handleListBackups = useCallback(async () => {
    setLoadingBackups(true);
    try {
      const committed = await commitWebdav();
      if (committed.kind === 'refused') {
        inform({ title: t('backup.notListedTitle'), message: committed.message });
        return;
      }
      const candidates: BackupBackend[] = [
        ...(getWebdavConfig() !== null ? [webdavBackend] : []),
        ...(folderName ? [folderBackend] : []),
        ...(driveAccount ? [googleDriveBackend] : []),
        ...(icloudSupported ? [icloudBackend] : []),
        localBackend,
      ];
      const groups: CarrierEntries[] = [];
      let firstError: unknown = null;
      for (const backend of candidates) {
        // iCloud is listed even while turned off, since the backups an earlier
        // install wrote are still there, and only a destination that is on
        // reports that it cannot be reached.
        const listedWhenOff = backend.id === icloudBackend.id;
        try {
          if (!listedWhenOff && !(await backend.isAvailable())) {
            if (backend.id !== 'local') throw new Error(t('backup.destinationUnavailable'));
            continue;
          }
          const entries = await backend.listBackups();
          // Older backups on this device are listed only when there are any.
          if (entries.length > 0 || backend.id !== 'local') groups.push({ backend, entries });
        } catch (error) {
          if (!listedWhenOff || icloudOn) firstError ??= error;
        }
      }
      setBackendBackups(groups);
      setListedSetUpDestination(candidates.some((backend) => backend.id !== 'local'));
      if (firstError)
        inform({ title: t('backup.notListedTitle'), message: describeBackupError(firstError) });
    } finally {
      setLoadingBackups(false);
    }
  }, [commitWebdav, folderName, driveAccount, icloudSupported, icloudOn, describeBackupError, t]);

  const handleRestoreEntry = useCallback(
    async (backend: BackupBackend, entry: BackupEntry) => {
      if (restoreRunning.current) return;
      restoreRunning.current = true;
      setRestoringEntry(entry.id);
      try {
        const outcome = await restoreBackendEntry(backend, entry, t);
        if (outcome !== 'declined') {
          showRestoreNotice(outcome, t);
          setBackendBackups(null);
        }
      } catch (error) {
        inform({ title: t('backup.notRestoredTitle'), message: describeBackupError(error) });
      } finally {
        restoreRunning.current = false;
        setRestoringEntry(null);
        // A restore that failed part way leaves its import paused, and the
        // list is where that shows.
        setRestoreGeneration((generation) => generation + 1);
      }
    },
    [describeBackupError, t]
  );

  const handleResumeImport = useCallback(async () => {
    if (restoreRunning.current) return;
    restoreRunning.current = true;
    setResumingImport(true);
    try {
      const result = await resumeRecordImport();
      if (result) {
        showRestoreNotice(result, t);
      }
    } catch {
      inform({ title: t('backup.notRestoredTitle'), message: t('backup.importPausedError') });
    } finally {
      restoreRunning.current = false;
      setResumingImport(false);
      setRestoreGeneration((generation) => generation + 1);
    }
  }, [t]);

  const handleDiscardImport = useCallback(() => {
    confirmAction({
      title: t('backup.discardImportTitle'),
      message: t('backup.discardImportMessage'),
      confirmLabel: t('backup.discardImport'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: async () => {
        if (restoreRunning.current) return;
        restoreRunning.current = true;
        try {
          await discardRecordImport();
        } catch {
          inform({
            title: t('backup.importNotDiscardedTitle'),
            message: t('backup.discardImportError'),
          });
        } finally {
          restoreRunning.current = false;
          setRestoreGeneration((generation) => generation + 1);
        }
      },
    });
  }, [t]);

  const handleDiscardWaiting = useCallback(() => {
    confirmAction({
      title: t('backup.discardWaitingTitle'),
      message: t('backup.discardWaitingMessage'),
      confirmLabel: t('backup.discardImport'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: async () => {
        if (restoreRunning.current) return;
        restoreRunning.current = true;
        try {
          await discardUnplacedRecords();
        } catch {
          inform({
            title: t('backup.importNotDiscardedTitle'),
            message: t('backup.discardWaitingError'),
          });
        } finally {
          restoreRunning.current = false;
          setRestoreGeneration((generation) => generation + 1);
        }
      },
    });
  }, [t]);

  // Removing one carrier leaves the switch and the other carriers as they were.
  const handleWebdavChanged = useCallback(() => {
    setWebdavSet(getWebdavConfig() !== null);
    setBackendBackups(null);
  }, []);

  const handleChooseFolder = useCallback(async () => {
    try {
      const picked = await pickBackupFolder();
      if (picked !== null) {
        setFolderName(picked);
        setBackendBackups(null);
      }
    } catch (error) {
      inform({ title: t('backup.folderNotChosenTitle'), message: describeBackupError(error) });
    }
  }, [describeBackupError, t]);

  const handleGoogleDriveSignIn = useCallback(async () => {
    setSigningInToDrive(true);
    try {
      let account: string | null;
      try {
        account = await signInToGoogleDrive();
      } catch {
        inform({
          title: t('backup.driveNotSetUpTitle'),
          message: t('backup.carrierGoogleDriveSignInFailed'),
        });
        return;
      }
      if (account === null) return;
      setDriveAccount(account);
      setBackendBackups(null);
      const paid = onBackupCarrierSignedIn('googleDrive');
      setCarrierGeneration((generation) => generation + 1);
      await paid;
      setCarrierGeneration((generation) => generation + 1);
    } catch (error) {
      inform({ title: t('backup.driveNotSetUpTitle'), message: describeBackupError(error) });
    } finally {
      setSigningInToDrive(false);
    }
  }, [describeBackupError, t]);

  const handleGoogleDriveSignOut = useCallback(() => {
    forgetGoogleDrive().catch(() => {});
    setDriveAccount(null);
    setBackendBackups(null);
  }, []);

  // Turning iCloud off leaves its backups where they are.
  const handleToggleIcloud = useCallback((value: boolean) => {
    setIcloudBackupOn(value);
    setIcloudOn(value);
    setBackendBackups(null);
  }, []);

  const handleRemoveFolder = useCallback(() => {
    forgetBackupFolder();
    setFolderName(null);
    setBackendBackups(null);
  }, []);

  const exportAnchor = useRef<ViewInstance>(null);
  const {
    exportRecordBackup,
    cancel: cancelRecordExport,
    cancelled: recordExportCancelled,
    exporting: dbExporting,
    stillRunning: exportStillRunning,
  } = useExportRecordBackup(exportAnchor);
  const { importDatabaseBackup, importing: dbImporting } = useImportDatabaseBackup();
  const handleImportBackup = useCallback(async () => {
    await importDatabaseBackup();
    // Read either way: an import that failed part way is paused, and shows here.
    setRestoreGeneration((generation) => generation + 1);
  }, [importDatabaseBackup]);

  // Bulk export. The pills give way to progress while it runs, so the share
  // sheet anchors to their row.
  const bulkAnchor = useRef<ViewInstance>(null);
  const {
    exportAll,
    exportAllGeoJson,
    cancel: cancelBulk,
    cancelled: bulkCancelled,
    isExporting: bulkExporting,
    stillRunning: bulkStillRunning,
    format: bulkFormat,
    phase: bulkPhase,
    sizeBytes: bulkSizeBytes,
    current: bulkCurrent,
    total: bulkTotal,
  } = useBulkExport(bulkAnchor);

  const totalActivities = useActivityCount();

  const lastBackupText = lastBackupTs
    ? t('backup.lastBackup', { date: new Date(lastBackupTs).toLocaleDateString(getIntlLocale()) })
    : t('backup.lastBackupNever');

  const iconColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const labelStyle = [settingsStyles.actionRowText, isDark && settingsStyles.textLight];
  const detailStyle = [styles.detail, isDark && settingsStyles.textSecondary];
  const errorLine = errorStyle(isDark);
  const divider = <RowDivider />;
  const anyBusy = restoringEntry !== null;

  const info = (...parts: string[]) => parts.join('\n\n');

  const runStatus = describeBackupRun(t, backupResult, backupError, runResult, {
    webdav: getWebdavConfig()?.url ?? '',
    folder: folderName ?? '',
    googleDrive: driveAccount ?? '',
  });

  return (
    <>
      <ListSectionHeader>{t('backup.sectionBackup')}</ListSectionHeader>
      <Card variant="flat" padding="none">
        <SwitchRow
          icon="cloud-sync-outline"
          title={t('backup.autoBackup')}
          value={autoEnabled}
          onValueChange={handleToggleAutoBackup}
          accessory={
            <InfoButton
              testID="backup-info-auto"
              title={t('backup.autoBackup')}
              message={info(t('backup.autoBackupDescription'), t('backup.recordContents'))}
            />
          }
          testID="backup-auto-switch"
        />
        {divider}
        <Row>
          <Icon name="history" size={iconSize.lg} color={iconColor} />
          <View style={styles.fill}>
            <Text testID="backup-last-run-text" style={labelStyle}>
              {lastBackupText}
            </Text>
            {backupCancelled ? (
              <StatusLine tone="info" message={t('common.cancelled')}>
                <Text testID="backup-cancelled" style={detailStyle}>
                  {t('common.cancelled')}
                </Text>
              </StatusLine>
            ) : null}
            {runStatus ? (
              <StatusLine tone={runStatus.tone} message={runStatus.spoken}>
                {runStatus.saved ? (
                  <Text
                    testID="backup-success-message"
                    style={[styles.detail, styles.success, isDark && styles.successDark]}
                  >
                    {runStatus.saved.join('\n')}
                  </Text>
                ) : null}
                {runStatus.carriers.map((carrier) => (
                  <Text
                    key={carrier.id}
                    testID={`backup-carrier-${carrier.state}-${carrier.id}`}
                    style={errorLine}
                  >
                    {carrier.lines.join('\n')}
                  </Text>
                ))}
                {runStatus.error !== null && (
                  <Text testID="backup-error-message" style={errorLine}>
                    {runStatus.error}
                  </Text>
                )}
              </StatusLine>
            ) : null}
          </View>
          <Button
            testID="backup-now-button"
            label={backingUp ? t('common.cancel') : t('backup.backupNow')}
            variant="secondary"
            size="sm"
            onPress={handleBackupNow}
          />
        </Row>
      </Card>

      <ListSectionHeader>{t('backup.sectionRestore')}</ListSectionHeader>
      <Card variant="flat" padding="none">
        <Row
          testID="backup-list-button"
          behaviour="act"
          onPress={handleListBackups}
          accessibilityLabel={t('backup.restoreFromDestination')}
          disabled={loadingBackups || anyBusy}
          accessory={
            <InfoButton
              testID="backup-info-restore"
              title={t('backup.sectionRestore')}
              message={info(t('backup.restoreInfo'), t('backup.manualRestorePath'))}
            />
          }
        >
          <Icon name="cloud-download-outline" size={iconSize.lg} color={iconColor} />
          <Text style={labelStyle}>{t('backup.restoreFromDestination')}</Text>
        </Row>
        {backendBackups?.every((group) => group.entries.length === 0) ? (
          <Row>
            {/* The device backup cannot be read from here: the platform hands it
                back only while a new phone is set up. */}
            <Text testID="backup-none-found" style={detailStyle}>
              {listedSetUpDestination
                ? t('backup.noBackupsAtDestination')
                : t('backup.noBrowsableDestination')}
            </Text>
          </Row>
        ) : null}
        {backendBackups?.map(({ backend, entries }) =>
          entries.length === 0 ? null : (
            <View key={backend.id} testID={`backup-group-${backend.id}`}>
              {divider}
              <View style={styles.groupLabel}>
                <Text style={detailStyle}>{carrierName(t, backend.id)}</Text>
              </View>
              {entries.map((entry) => (
                <BackupEntryRow
                  key={entry.id}
                  entry={entry}
                  testID={`backup-entry-${backend.id}-${entry.id}`}
                  onPress={() => handleRestoreEntry(backend, entry)}
                  busy={restoringEntry === entry.id}
                  disabled={anyBusy}
                />
              ))}
            </View>
          )
        )}
        {divider}
        <Row
          testID="backup-import-button"
          behaviour="act"
          onPress={handleImportBackup}
          accessibilityLabel={dbImporting ? t('backup.importing') : t('backup.importBackup')}
          disabled={dbImporting}
          busy={dbImporting}
        >
          <Icon name="database-import-outline" size={iconSize.lg} color={iconColor} />
          <Text style={labelStyle}>
            {dbImporting ? t('backup.importing') : t('backup.importBackup')}
          </Text>
        </Row>
        {importPaused ? (
          <>
            {divider}
            <Row>
              <Icon name="pause-circle-outline" size={iconSize.lg} color={iconColor} />
              <View style={styles.fill}>
                <Text testID="backup-import-paused" style={labelStyle}>
                  {t('backup.importPaused')}
                </Text>
                <View style={styles.actions}>
                  <Button
                    testID="backup-import-resume-button"
                    label={t('common.retry')}
                    variant="secondary"
                    size="sm"
                    onPress={handleResumeImport}
                    loading={resumingImport}
                    disabled={anyBusy}
                  />
                  <Button
                    testID="backup-import-discard-button"
                    label={t('backup.discardImport')}
                    variant="ghost"
                    size="sm"
                    onPress={handleDiscardImport}
                    disabled={resumingImport || anyBusy}
                  />
                </View>
              </View>
            </Row>
          </>
        ) : null}
        {fetchingActivities ? (
          <>
            {divider}
            <Row testID="backup-restore-fetch">
              <Icon name="download-outline" size={iconSize.lg} color={iconColor} />
              <ProgressRow
                label={t('backup.unplacedActivityPending')}
                done={fetchDone}
                total={fetchTotal}
                counts={`${fetchDone}/${fetchTotal}`}
                countsTestID="backup-restore-fetch-counts"
                barTestID="backup-restore-fetch-progress"
                labelStyle={labelStyle}
                detailStyle={detailStyle}
              />
            </Row>
          </>
        ) : null}
        {waitingRecords.length > 0 && (
          <>
            {divider}
            <Row testID="backup-unplaced-records">
              <Icon name="timer-sand" size={iconSize.lg} color={iconColor} />
              <View style={styles.fill}>
                <Text style={labelStyle}>
                  {t('backup.unplacedRecords', { count: waitingRecords.length })}
                </Text>
                <View style={styles.actions}>
                  <Button
                    testID="backup-unplaced-discard-button"
                    label={t('backup.discardImport')}
                    variant="ghost"
                    size="sm"
                    onPress={handleDiscardWaiting}
                    disabled={anyBusy}
                  />
                </View>
              </View>
            </Row>
          </>
        )}
        {restoreDrops.length > 0 && (
          <>
            {divider}
            <Row testID="backup-restore-drops">
              <Icon name="information-outline" size={iconSize.lg} color={iconColor} />
              <View style={styles.fill}>
                {restoreDrops.map((line) => (
                  <Text key={line} style={labelStyle}>
                    {line}
                  </Text>
                ))}
              </View>
            </Row>
          </>
        )}
        {unplacedReadError ? (
          <Row>
            <Text testID="backup-unplaced-read-error" style={errorLine}>
              {t('backup.unplacedReadError')}
            </Text>
          </Row>
        ) : null}
      </Card>

      <ListSectionHeader>{t('backup.sectionDestinations')}</ListSectionHeader>
      <Card variant="flat" padding="none">
        <Row testID="backup-carrier-device">
          <Icon name="cellphone" size={iconSize.lg} color={iconColor} />
          <View style={styles.fill}>
            <Text style={labelStyle}>
              {t(Platform.OS === 'ios' ? 'backup.carrierDeviceIos' : 'backup.carrierDeviceAndroid')}
            </Text>
            <Text style={detailStyle}>{t('backup.carrierDeviceRestore')}</Text>
            {Platform.OS === 'android' ? (
              <AndroidAutoBackupState />
            ) : (
              <DestinationLastBackup
                at={destinationStamps.device}
                testID="backup-carrier-last-device"
              />
            )}
          </View>
          <InfoButton
            testID="backup-info-destinations"
            title={t('backup.sectionDestinations')}
            message={info(
              t('backup.carrierDeviceDescription'),
              t('backup.platformRestorePath'),
              webdavSet ? t('backup.webdavRestorePath') : t('backup.localRestorePath')
            )}
          />
        </Row>
        {icloudSupported ? (
          <>
            {divider}
            <View testID="backup-carrier-icloud">
              <SwitchRow
                icon="apple-icloud"
                title={t('backup.carrierIcloud')}
                description={t('backup.carrierIcloudDescription')}
                value={icloudOn}
                onValueChange={handleToggleIcloud}
                testID="backup-icloud-switch"
              />
              {icloudOn ? (
                <View style={styles.failure}>
                  {icloudState === 'unavailable' ? (
                    <Text testID="backup-icloud-unavailable" style={errorLine}>
                      {t(failureMessageKey('icloud_unavailable'))}
                    </Text>
                  ) : (
                    <DestinationLastBackup
                      at={destinationStamps.icloud}
                      testID="backup-carrier-last-icloud"
                    />
                  )}
                  <CarrierFailure
                    failure={carrierFailures.icloud}
                    testID="backup-carrier-failure-icloud"
                  />
                </View>
              ) : null}
            </View>
          </>
        ) : null}
        {divider}
        <View testID="backup-carrier-folder">
          <Row>
            <Icon name="folder-outline" size={iconSize.lg} color={iconColor} />
            <View style={styles.fill}>
              <Text style={labelStyle}>{t('backup.carrierFolder')}</Text>
              <Text style={detailStyle}>{folderName ?? t('backup.carrierFolderNone')}</Text>
              {folderName ? (
                <DestinationLastBackup
                  at={destinationStamps.folder}
                  testID="backup-carrier-last-folder"
                />
              ) : null}
            </View>
            {folderName ? (
              <Button
                testID="backup-folder-remove"
                label={t('backup.carrierFolderRemove')}
                variant="ghost"
                size="sm"
                onPress={handleRemoveFolder}
              />
            ) : null}
            <Button
              testID="backup-folder-choose"
              label={folderName ? t('backup.carrierFolderChange') : t('backup.carrierFolderChoose')}
              variant="secondary"
              size="sm"
              onPress={handleChooseFolder}
            />
          </Row>
          {carrierFailures.folder ? (
            <View style={styles.failure}>
              <CarrierFailure
                failure={carrierFailures.folder}
                testID="backup-carrier-failure-folder"
              />
            </View>
          ) : null}
        </View>
        {driveSupported ? (
          <>
            {divider}
            <View testID="backup-carrier-google-drive">
              <Row>
                <Icon name="google-drive" size={iconSize.lg} color={iconColor} />
                <View style={styles.fill}>
                  <Text style={labelStyle}>{t('backup.carrierGoogleDrive')}</Text>
                  <Text testID="backup-google-drive-account" style={detailStyle}>
                    {driveAccount ?? t('backup.carrierGoogleDriveNone')}
                  </Text>
                  {driveAccount ? (
                    <DestinationLastBackup
                      at={destinationStamps.googleDrive}
                      testID="backup-carrier-last-google-drive"
                    />
                  ) : null}
                </View>
                {driveAccount ? (
                  <Button
                    testID="backup-google-drive-sign-out"
                    label={t('backup.carrierGoogleDriveSignOut')}
                    variant="ghost"
                    size="sm"
                    onPress={handleGoogleDriveSignOut}
                    disabled={signingInToDrive}
                  />
                ) : null}
                {(!driveAccount || carrierFailures.googleDrive?.kind === 'signin') && (
                  <Button
                    testID="backup-google-drive-sign-in"
                    label={t('backup.carrierGoogleDriveSignIn')}
                    variant="secondary"
                    size="sm"
                    onPress={handleGoogleDriveSignIn}
                    loading={signingInToDrive}
                  />
                )}
              </Row>
              {driveAccount && carrierFailures.googleDrive ? (
                <View style={styles.failure}>
                  <CarrierFailure
                    failure={carrierFailures.googleDrive}
                    testID="backup-carrier-failure-google-drive"
                  />
                </View>
              ) : null}
              <View style={styles.failure}>
                <Text style={detailStyle}>{t('backup.carrierGoogleDriveDescription')}</Text>
              </View>
            </View>
          </>
        ) : null}
        {divider}
        <View testID="backup-carrier-webdav">
          <Row>
            <Icon name="server-network" size={iconSize.lg} color={iconColor} />
            <View style={styles.fill}>
              <Text style={labelStyle}>{t('backup.backendWebdav')}</Text>
              {webdavSet ? (
                <DestinationLastBackup
                  at={destinationStamps.webdav}
                  testID="backup-carrier-last-webdav"
                />
              ) : null}
            </View>
          </Row>
          {carrierFailures.webdav ? (
            <View style={styles.failure}>
              <CarrierFailure
                failure={carrierFailures.webdav}
                testID="backup-carrier-failure-webdav"
              />
            </View>
          ) : null}
          <WebdavConfigForm
            ref={webdavForm}
            onConfigChange={handleWebdavChanged}
            onRemoved={handleWebdavChanged}
          />
        </View>
      </Card>

      <ListSectionHeader>{t('backup.sectionExport')}</ListSectionHeader>
      <Card variant="flat" padding="none">
        <Row
          ref={exportAnchor}
          testID="backup-export-button"
          behaviour="act"
          onPress={exportRecordBackup}
          accessibilityLabel={dbExporting ? t('backup.exporting') : t('backup.exportBackup')}
          disabled={dbExporting}
          accessory={
            <InfoButton
              testID="backup-info-export"
              title={t('backup.exportBackup')}
              message={t('backup.notEncryptedWarning')}
            />
          }
        >
          <Icon name="database-export-outline" size={iconSize.lg} color={iconColor} />
          <Text style={labelStyle}>
            {dbExporting ? t('backup.exporting') : t('backup.exportBackup')}
          </Text>
        </Row>
        {exportStillRunning ? (
          <Row>
            <View style={styles.fill}>
              <StatusLine tone="pending" message={t('settings.stillRunning')}>
                <Text testID="backup-export-still-running" style={detailStyle}>
                  {t('settings.stillRunning')}
                </Text>
              </StatusLine>
            </View>
            <Button
              testID="backup-export-cancel"
              label={t('common.cancel')}
              variant="secondary"
              size="sm"
              onPress={cancelRecordExport}
            />
          </Row>
        ) : null}
        {recordExportCancelled && !dbExporting ? (
          <Row>
            <StatusLine tone="info" message={t('common.cancelled')}>
              <Text testID="backup-export-cancelled" style={detailStyle}>
                {t('common.cancelled')}
              </Text>
            </StatusLine>
          </Row>
        ) : null}
        {divider}
        <Row ref={bulkAnchor}>
          <Icon name="map-marker-path" size={iconSize.lg} color={iconColor} />
          {bulkExporting || bulkStillRunning ? (
            <BulkExportProgress
              phase={bulkPhase}
              format={bulkFormat}
              current={bulkCurrent}
              total={bulkTotal}
              sizeBytes={bulkSizeBytes}
              isDark={isDark}
              onCancel={cancelBulk}
            />
          ) : (
            <>
              <Text style={labelStyle}>{t('export.bulkExport', { count: totalActivities })}</Text>
              <Button
                testID="backup-export-gpx"
                label={BULK_EXPORT_FORMAT_NAME.gpx}
                accessibilityLabel={t('export.exportAllAs', {
                  format: BULK_EXPORT_FORMAT_NAME.gpx,
                })}
                variant="secondary"
                size="sm"
                onPress={exportAll}
              />
              <Button
                testID="backup-export-geojson"
                label={BULK_EXPORT_FORMAT_NAME.geojson}
                accessibilityLabel={t('export.exportAllAs', {
                  format: BULK_EXPORT_FORMAT_NAME.geojson,
                })}
                variant="secondary"
                size="sm"
                onPress={exportAllGeoJson}
              />
            </>
          )}
        </Row>
        {bulkCancelled && !bulkExporting && !bulkStillRunning ? (
          <Row>
            <StatusLine tone="info" message={t('common.cancelled')}>
              <Text testID="bulk-export-cancelled" style={detailStyle}>
                {t('common.cancelled')}
              </Text>
            </StatusLine>
          </Row>
        ) : null}
        {/* A late share is the run ending, not one the athlete can leave. */}
        {bulkStillRunning && bulkPhase !== 'sharing' ? (
          <Row>
            <StatusLine tone="pending" message={t('settings.stillRunning')}>
              <Text testID="bulk-export-still-running" style={detailStyle}>
                {t('settings.stillRunning')}
              </Text>
            </StatusLine>
          </Row>
        ) : null}
        {divider}
        <ExportPrivacyRow />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  groupLabel: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  failure: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  success: {
    color: colors.successText,
  },
  successDark: {
    color: darkColors.successText,
  },
  error: {
    color: colors.errorText,
  },
  errorDark: {
    color: darkColors.errorText,
  },
});
