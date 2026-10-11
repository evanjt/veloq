import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Switch, Alert, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Button, Card, ListSectionHeader, Row } from '@/shared/ui';
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
  type BackupDestination,
  type BackupFailure,
  type BackupRunResult,
  type BackupBackend,
  type BackupEntry,
} from '@/features/settings/lib/autobackup';
import {
  discardRecordImport,
  discardUnplacedRecords,
  resumeRecordImport,
} from '@/features/settings/lib/backup';
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
import { confirmLegacyImport } from '@/features/settings/hooks/useBackup';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { InfoButton } from './InfoButton';
import { BulkExportProgress } from './BulkExportProgress';
import { ExportPrivacyRow } from './ExportPrivacyRow';
import { WebdavConfigForm } from './WebdavConfigForm';
import { describeBackupFailure } from '@/features/settings/lib/backupFailure';
import { formatFileSize, getIntlLocale } from '@/shared/format/format';
import { getAndroidAutoBackupStatus } from '@/shared/native/androidAutoBackup';
import { androidAutoBackupLines } from '@/features/settings/lib/androidAutoBackupLines';

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
    case 'local':
      return t('backup.carrierOlderOnDevice');
    default:
      return id;
  }
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
  if (!failure) return null;
  return (
    <Text testID={testID} style={[styles.detail, styles.error]}>
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
              <Text
                key={line.kind}
                testID="backup-carrier-device-quota"
                style={[styles.detail, styles.error]}
              >
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
      })) ?? { device: null, webdav: null, folder: null, googleDrive: null },
    // A carrier set up or removed changes which stamp applies.
    [readBackupState, webdavSet, folderName, driveAccount]
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
    setRunResult(null);
    try {
      const result = await performBackup(true);
      const success = result.wroteZip;
      setRunResult(result);
      setBackupResult(success ? 'success' : 'error');
      if (!success) setBackupError(t('backup.backupFailedMessage'));
    } catch (error) {
      setBackupResult('error');
      setBackupError(describeBackupError(error));
    } finally {
      setBackingUp(false);
    }
  }, [describeBackupError, t]);

  const handleToggleAutoBackup = useCallback(
    async (value: boolean) => {
      setAutoBackupEnabled(value);
      setAutoEnabled(value);
      // Trigger immediate backup when enabling auto-backup
      if (value) await runBackup();
    },
    [runBackup]
  );

  const handleBackupNow = useCallback(async () => {
    if (backingUp) return;
    await runBackup();
  }, [backingUp, runBackup]);

  const handleListBackups = useCallback(async () => {
    setLoadingBackups(true);
    try {
      const candidates: BackupBackend[] = [
        ...(webdavSet ? [webdavBackend] : []),
        ...(folderName ? [folderBackend] : []),
        ...(driveAccount ? [googleDriveBackend] : []),
        localBackend,
      ];
      const groups: CarrierEntries[] = [];
      let firstError: unknown = null;
      for (const backend of candidates) {
        try {
          if (!(await backend.isAvailable())) {
            if (backend.id !== 'local') throw new Error(t('backup.destinationUnavailable'));
            continue;
          }
          const entries = await backend.listBackups();
          // Older backups on this device are listed only when there are any.
          if (entries.length > 0 || backend.id !== 'local') groups.push({ backend, entries });
        } catch (error) {
          firstError ??= error;
        }
      }
      setBackendBackups(groups);
      setListedSetUpDestination(candidates.some((backend) => backend.id !== 'local'));
      if (firstError) Alert.alert(t('common.error'), describeBackupError(firstError));
    } finally {
      setLoadingBackups(false);
    }
  }, [webdavSet, folderName, driveAccount, describeBackupError, t]);

  const handleRestoreEntry = useCallback(
    async (backend: BackupBackend, entry: BackupEntry) => {
      if (restoreRunning.current) return;
      restoreRunning.current = true;
      const confirmed = await confirmLegacyImport({
        title: t('backup.importBackup'),
        message: t('backup.legacyImportMessage'),
        cancel: t('common.cancel'),
      });
      if (!confirmed) {
        restoreRunning.current = false;
        return;
      }
      setRestoringEntry(entry.id);
      try {
        const notice = await restoreBackendEntry(backend, entry, t);
        Alert.alert(notice.title, notice.message);
        setBackendBackups(null);
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('backup.importError')
        );
      } finally {
        restoreRunning.current = false;
        setRestoringEntry(null);
        // A restore that failed part way leaves its import paused, and the
        // list is where that shows.
        setRestoreGeneration((generation) => generation + 1);
      }
    },
    [t]
  );

  const handleResumeImport = useCallback(async () => {
    if (restoreRunning.current) return;
    restoreRunning.current = true;
    setResumingImport(true);
    try {
      const result = await resumeRecordImport();
      if (result) {
        Alert.alert(t('backup.restoreComplete'), t('backup.recordRestored'));
      }
    } catch {
      Alert.alert(t('common.error'), t('backup.importPausedError'));
    } finally {
      restoreRunning.current = false;
      setResumingImport(false);
      setRestoreGeneration((generation) => generation + 1);
    }
  }, [t]);

  const handleDiscardImport = useCallback(() => {
    Alert.alert(t('backup.discardImportTitle'), t('backup.discardImportMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('backup.discardImport'),
        style: 'destructive',
        onPress: async () => {
          if (restoreRunning.current) return;
          restoreRunning.current = true;
          try {
            await discardRecordImport();
          } catch {
            Alert.alert(t('common.error'), t('backup.discardImportError'));
          } finally {
            restoreRunning.current = false;
            setRestoreGeneration((generation) => generation + 1);
          }
        },
      },
    ]);
  }, [t]);

  const handleDiscardWaiting = useCallback(() => {
    Alert.alert(t('backup.discardWaitingTitle'), t('backup.discardWaitingMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('backup.discardImport'),
        style: 'destructive',
        onPress: async () => {
          if (restoreRunning.current) return;
          restoreRunning.current = true;
          try {
            await discardUnplacedRecords();
          } catch {
            Alert.alert(t('common.error'), t('backup.discardWaitingError'));
          } finally {
            restoreRunning.current = false;
            setRestoreGeneration((generation) => generation + 1);
          }
        },
      },
    ]);
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
      Alert.alert(t('common.error'), describeBackupError(error));
    }
  }, [describeBackupError, t]);

  const handleGoogleDriveSignIn = useCallback(async () => {
    setSigningInToDrive(true);
    try {
      let account: string | null;
      try {
        account = await signInToGoogleDrive();
      } catch {
        Alert.alert(t('common.error'), t('backup.carrierGoogleDriveSignInFailed'));
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
      Alert.alert(t('common.error'), describeBackupError(error));
    } finally {
      setSigningInToDrive(false);
    }
  }, [describeBackupError, t]);

  const handleGoogleDriveSignOut = useCallback(() => {
    forgetGoogleDrive().catch(() => {});
    setDriveAccount(null);
    setBackendBackups(null);
  }, []);

  const handleRemoveFolder = useCallback(() => {
    forgetBackupFolder();
    setFolderName(null);
    setBackendBackups(null);
  }, []);

  const {
    exportRecordBackup,
    exporting: dbExporting,
    stillRunning: exportStillRunning,
  } = useExportRecordBackup();
  const { importDatabaseBackup, importing: dbImporting } = useImportDatabaseBackup();
  const handleImportBackup = useCallback(async () => {
    await importDatabaseBackup();
    // Read either way: an import that failed part way is paused, and shows here.
    setRestoreGeneration((generation) => generation + 1);
  }, [importDatabaseBackup]);

  // Bulk export
  const {
    exportAll,
    exportAllGeoJson,
    isExporting: bulkExporting,
    stillRunning: bulkStillRunning,
    format: bulkFormat,
    phase: bulkPhase,
    sizeBytes: bulkSizeBytes,
    current: bulkCurrent,
    total: bulkTotal,
  } = useBulkExport();

  const totalActivities = useActivityCount();

  const lastBackupText = lastBackupTs
    ? t('backup.lastBackup', { date: new Date(lastBackupTs).toLocaleDateString(getIntlLocale()) })
    : t('backup.lastBackupNever');

  const iconColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const labelStyle = [settingsStyles.actionRowText, isDark && settingsStyles.textLight];
  const detailStyle = [styles.detail, isDark && settingsStyles.textSecondary];
  const errorStyle = [styles.detail, styles.error, isDark && styles.errorDark];
  const divider = (
    <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />
  );
  const anyBusy = restoringEntry !== null;

  const info = (...parts: string[]) => parts.join('\n\n');

  return (
    <>
      <ListSectionHeader>{t('backup.sectionBackup')}</ListSectionHeader>
      <Card variant="flat" padding="none">
        <Row>
          <MaterialCommunityIcons name="cloud-sync-outline" size={22} color={iconColor} />
          <Text style={labelStyle}>{t('backup.autoBackup')}</Text>
          <InfoButton
            testID="backup-info-auto"
            title={t('backup.autoBackup')}
            message={info(t('backup.autoBackupDescription'), t('backup.recordContents'))}
          />
          <Switch
            testID="backup-auto-switch"
            value={autoEnabled}
            onValueChange={handleToggleAutoBackup}
            trackColor={{ false: colors.border, true: colors.primary }}
          />
        </Row>
        {divider}
        <Row>
          <MaterialCommunityIcons name="history" size={22} color={iconColor} />
          <View style={styles.fill}>
            <Text testID="backup-last-run-text" style={labelStyle}>
              {lastBackupText}
            </Text>
            {backupResult === 'success' && (
              <Text
                testID="backup-success-message"
                style={[styles.detail, styles.success, isDark && styles.successDark]}
              >
                {[
                  t('backup.recordSavedLocal'),
                  ...(runResult?.carriers.webdav?.status === 'written'
                    ? [t('backup.recordSavedWebdav', { destination: getWebdavConfig()?.url ?? '' })]
                    : []),
                  ...(runResult?.carriers.folder?.status === 'written'
                    ? [t('backup.recordSavedFolder', { destination: folderName ?? '' })]
                    : []),
                  ...(runResult?.carriers.googleDrive?.status === 'written'
                    ? [t('backup.recordSavedGoogleDrive', { destination: driveAccount ?? '' })]
                    : []),
                ].join('\n')}
              </Text>
            )}
            {backupResult === 'success' &&
              Object.entries(runResult?.carriers ?? {}).map(([id, outcome]) => {
                if (outcome.status === 'failed') {
                  return (
                    <Text key={id} testID={`backup-carrier-failed-${id}`} style={errorStyle}>
                      {t('backup.carrierNotWritten', { destination: carrierName(t, id) })}
                      {'\n'}
                      {t(
                        failureMessageKey(outcome.kind === 'unknown' ? 'transport' : outcome.kind)
                      )}
                    </Text>
                  );
                }
                if (outcome.status === 'skipped' && outcome.reason === 'no-radio') {
                  return (
                    <Text key={id} testID={`backup-carrier-owed-${id}`} style={errorStyle}>
                      {t('backup.carrierNotWritten', { destination: carrierName(t, id) })}
                      {'\n'}
                      {t('backup.carrierSentWhenOnline')}
                    </Text>
                  );
                }
                return null;
              })}
            {backupResult === 'error' && (
              <Text testID="backup-error-message" style={errorStyle}>
                {backupError}
              </Text>
            )}
          </View>
          <Button
            testID="backup-now-button"
            label={t('backup.backupNow')}
            variant="secondary"
            size="sm"
            onPress={handleBackupNow}
            loading={backingUp}
          />
        </Row>
      </Card>

      <ListSectionHeader>{t('backup.sectionRestore')}</ListSectionHeader>
      <Card variant="flat" padding="none">
        <Row
          testID="backup-list-button"
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
          <MaterialCommunityIcons name="cloud-download-outline" size={22} color={iconColor} />
          <Text style={labelStyle}>{t('backup.restoreFromDestination')}</Text>
        </Row>
        {backendBackups?.every((group) => group.entries.length === 0) && (
          <Row>
            {/* The device backup cannot be read from here: the platform hands it
                back only while a new phone is set up. */}
            <Text testID="backup-none-found" style={detailStyle}>
              {listedSetUpDestination
                ? t('backup.noBackupsAtDestination')
                : t('backup.noBrowsableDestination')}
            </Text>
          </Row>
        )}
        {backendBackups?.map(({ backend, entries }) =>
          entries.length === 0 ? null : (
            <View key={backend.id} testID={`backup-group-${backend.id}`}>
              {divider}
              <View style={styles.groupLabel}>
                <Text style={detailStyle}>{carrierName(t, backend.id)}</Text>
              </View>
              {entries.map((entry) => (
                <Row
                  key={entry.id}
                  testID={`backup-entry-${backend.id}-${entry.id}`}
                  onPress={() => handleRestoreEntry(backend, entry)}
                  accessibilityLabel={t('backup.restoreDatedBackup', {
                    date: new Date(entry.timestamp).toLocaleDateString(getIntlLocale()),
                  })}
                  disabled={anyBusy}
                >
                  <Text style={labelStyle}>
                    {t('backup.restoreDatedBackup', {
                      date: new Date(entry.timestamp).toLocaleDateString(getIntlLocale()),
                    })}
                  </Text>
                </Row>
              ))}
            </View>
          )
        )}
        {divider}
        <Row
          testID="backup-import-button"
          onPress={handleImportBackup}
          accessibilityLabel={dbImporting ? t('backup.importing') : t('backup.importBackup')}
          disabled={dbImporting}
        >
          <MaterialCommunityIcons name="database-import-outline" size={22} color={iconColor} />
          <Text style={labelStyle}>
            {dbImporting ? t('backup.importing') : t('backup.importBackup')}
          </Text>
        </Row>
        {importPaused && (
          <>
            {divider}
            <Row>
              <MaterialCommunityIcons name="pause-circle-outline" size={22} color={iconColor} />
              <View style={styles.fill}>
                <Text testID="backup-import-paused" style={labelStyle}>
                  {t('backup.importPaused')}
                </Text>
                <View style={styles.actions}>
                  <Button
                    testID="backup-import-resume-button"
                    label={t('errorState.tryAgain')}
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
        )}
        {fetchingActivities && (
          <>
            {divider}
            <Row testID="backup-restore-fetch">
              <MaterialCommunityIcons name="download-outline" size={22} color={iconColor} />
              <View style={styles.fill}>
                <Text style={labelStyle}>{t('backup.unplacedActivityPending')}</Text>
                {fetchTotal > 0 && (
                  <>
                    <View
                      testID="backup-restore-fetch-progress"
                      accessibilityRole="progressbar"
                      accessibilityValue={{ min: 0, max: fetchTotal, now: fetchDone }}
                      style={[styles.fetchTrack, isDark && styles.fetchTrackDark]}
                    >
                      <View
                        style={[
                          styles.fetchFill,
                          { width: `${Math.round((fetchDone / fetchTotal) * 100)}%` },
                        ]}
                      />
                    </View>
                    <Text testID="backup-restore-fetch-counts" style={detailStyle}>
                      {`${fetchDone}/${fetchTotal}`}
                    </Text>
                  </>
                )}
              </View>
            </Row>
          </>
        )}
        {waitingRecords.length > 0 && (
          <>
            {divider}
            <Row testID="backup-unplaced-records">
              <MaterialCommunityIcons name="timer-sand" size={22} color={iconColor} />
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
        {unplacedReadError && (
          <Row>
            <Text testID="backup-unplaced-read-error" style={errorStyle}>
              {t('backup.unplacedReadError')}
            </Text>
          </Row>
        )}
      </Card>

      <ListSectionHeader>{t('backup.sectionDestinations')}</ListSectionHeader>
      <Card variant="flat" padding="none">
        <Row testID="backup-carrier-device">
          <MaterialCommunityIcons name="cellphone" size={22} color={iconColor} />
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
        {divider}
        <View testID="backup-carrier-folder">
          <Row>
            <MaterialCommunityIcons name="folder-outline" size={22} color={iconColor} />
            <View style={styles.fill}>
              <Text style={labelStyle}>{t('backup.carrierFolder')}</Text>
              <Text style={detailStyle}>{folderName ?? t('backup.carrierFolderNone')}</Text>
              {folderName && (
                <DestinationLastBackup
                  at={destinationStamps.folder}
                  testID="backup-carrier-last-folder"
                />
              )}
            </View>
            {folderName && (
              <Button
                testID="backup-folder-remove"
                label={t('backup.carrierFolderRemove')}
                variant="ghost"
                size="sm"
                onPress={handleRemoveFolder}
              />
            )}
            <Button
              testID="backup-folder-choose"
              label={folderName ? t('backup.carrierFolderChange') : t('backup.carrierFolderChoose')}
              variant="secondary"
              size="sm"
              onPress={handleChooseFolder}
            />
          </Row>
          {carrierFailures.folder && (
            <View style={styles.failure}>
              <CarrierFailure
                failure={carrierFailures.folder}
                testID="backup-carrier-failure-folder"
              />
            </View>
          )}
        </View>
        {driveSupported && (
          <>
            {divider}
            <View testID="backup-carrier-google-drive">
              <Row>
                <MaterialCommunityIcons name="google-drive" size={22} color={iconColor} />
                <View style={styles.fill}>
                  <Text style={labelStyle}>{t('backup.carrierGoogleDrive')}</Text>
                  <Text testID="backup-google-drive-account" style={detailStyle}>
                    {driveAccount ?? t('backup.carrierGoogleDriveNone')}
                  </Text>
                  {driveAccount && (
                    <DestinationLastBackup
                      at={destinationStamps.googleDrive}
                      testID="backup-carrier-last-google-drive"
                    />
                  )}
                </View>
                {driveAccount && (
                  <Button
                    testID="backup-google-drive-sign-out"
                    label={t('backup.carrierGoogleDriveSignOut')}
                    variant="ghost"
                    size="sm"
                    onPress={handleGoogleDriveSignOut}
                    disabled={signingInToDrive}
                  />
                )}
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
              {driveAccount && carrierFailures.googleDrive && (
                <View style={styles.failure}>
                  <CarrierFailure
                    failure={carrierFailures.googleDrive}
                    testID="backup-carrier-failure-google-drive"
                  />
                </View>
              )}
              <View style={styles.failure}>
                <Text style={detailStyle}>{t('backup.carrierGoogleDriveDescription')}</Text>
              </View>
            </View>
          </>
        )}
        {divider}
        <View testID="backup-carrier-webdav">
          <Row>
            <MaterialCommunityIcons name="server-network" size={22} color={iconColor} />
            <View style={styles.fill}>
              <Text style={labelStyle}>{t('backup.backendWebdav')}</Text>
              {webdavSet && (
                <DestinationLastBackup
                  at={destinationStamps.webdav}
                  testID="backup-carrier-last-webdav"
                />
              )}
            </View>
          </Row>
          {carrierFailures.webdav && (
            <View style={styles.failure}>
              <CarrierFailure
                failure={carrierFailures.webdav}
                testID="backup-carrier-failure-webdav"
              />
            </View>
          )}
          <WebdavConfigForm onConfigChange={handleWebdavChanged} onRemoved={handleWebdavChanged} />
        </View>
      </Card>

      <ListSectionHeader>{t('backup.sectionExport')}</ListSectionHeader>
      <Card variant="flat" padding="none">
        <Row
          testID="backup-export-button"
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
          <MaterialCommunityIcons name="database-export-outline" size={22} color={iconColor} />
          <Text style={labelStyle}>
            {dbExporting ? t('backup.exporting') : t('backup.exportBackup')}
          </Text>
        </Row>
        {exportStillRunning && (
          <Row>
            <Text testID="backup-export-still-running" style={detailStyle}>
              {t('settings.stillRunning')}
            </Text>
          </Row>
        )}
        {divider}
        <Row>
          <MaterialCommunityIcons name="map-marker-path" size={22} color={iconColor} />
          {bulkExporting || bulkStillRunning ? (
            <BulkExportProgress
              phase={bulkPhase}
              format={bulkFormat}
              current={bulkCurrent}
              total={bulkTotal}
              sizeBytes={bulkSizeBytes}
              isDark={isDark}
            />
          ) : (
            <>
              <Text style={labelStyle}>{t('export.bulkExport', { count: totalActivities })}</Text>
              <Button
                testID="backup-export-gpx"
                label="GPX"
                variant="secondary"
                size="sm"
                onPress={exportAll}
              />
              <Button
                testID="backup-export-geojson"
                label="GeoJSON"
                variant="secondary"
                size="sm"
                onPress={exportAllGeoJson}
              />
            </>
          )}
        </Row>
        {/* A late share is the run ending, not one the athlete can leave. */}
        {bulkStillRunning && bulkPhase !== 'sharing' && (
          <Row>
            <Text testID="bulk-export-still-running" style={detailStyle}>
              {t('settings.stillRunning')}
            </Text>
          </Row>
        )}
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
    color: colors.successDeep,
  },
  successDark: {
    color: darkColors.successDeep,
  },
  error: {
    color: colors.errorDeep,
  },
  errorDark: {
    color: darkColors.errorDeep,
  },
  fetchTrack: {
    height: spacing.xs,
    borderRadius: layout.borderRadiusXs,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  fetchTrackDark: {
    backgroundColor: darkColors.border,
  },
  fetchFill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
});
