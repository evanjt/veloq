import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Switch, Alert, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Button, Card, Row } from '@/shared/ui';
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
  type BackupFailure,
  type BackupRunResult,
  type BackupBackend,
  type BackupEntry,
} from '@/features/settings/lib/autobackup';
import { discardRecordImport, resumeRecordImport } from '@/features/settings/lib/backup';
import { restoreBackendEntry } from '@/features/settings/lib/restoreBackendEntry';
import { confirmLegacyImport } from '@/features/settings/hooks/useBackup';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { InfoButton } from './InfoButton';
import { BulkExportProgress } from './BulkExportProgress';
import { ExportPrivacyRow } from './ExportPrivacyRow';
import { WebdavConfigForm } from './WebdavConfigForm';
import { describeBackupFailure } from '@/features/settings/lib/backupFailure';
import { getIntlLocale } from '@/shared/format/format';

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
    case 'local':
      return t('backup.carrierOlderOnDevice');
    default:
      return id;
  }
}

function unplacedKindKey(kind: string) {
  switch (kind) {
    case 'section_pins':
      return 'backup.unplacedPin';
    case 'section_history':
      return 'backup.unplacedHistory';
    case 'section_intents':
      return 'backup.unplacedSectionSetting';
    case 'sections':
      return 'backup.unplacedSection';
    case 'legacy_section_name':
      return 'backup.unplacedSectionName';
    case 'settings':
      return 'backup.unplacedSetting';
    case 'route_names':
      return 'backup.unplacedRouteName';
    default:
      return 'backup.unplacedRecord';
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

export function BackupSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // Auto-backup state
  const [autoEnabled, setAutoEnabled] = useState(() => isAutoBackupEnabled());
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<'success' | 'error' | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backendBackups, setBackendBackups] = useState<CarrierEntries[] | null>(null);
  const [webdavSet, setWebdavSet] = useState(() => getWebdavConfig() !== null);
  const [folderName, setFolderName] = useState(() => getBackupFolderName());
  const [runResult, setRunResult] = useState<BackupRunResult | null>(null);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [restoringEntry, setRestoringEntry] = useState<string | null>(null);
  const restoreRunning = useRef(false);
  // A backup on this screen is the only thing that moves either value, so the
  // flag it flips is the key both reads are taken on.
  const readBackupState = useEngineRead([], [backingUp]);
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
  // A failure the user has to act on survives leaving the screen, so an
  // unattended backup that was rejected is not invisible.
  const carrierFailures = useMemo<Record<string, BackupFailure>>(
    () => readBackupState(() => getBackupFailures()) ?? {},
    [readBackupState]
  );
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
      if (firstError) Alert.alert(t('common.error'), describeBackupError(firstError));
    } finally {
      setLoadingBackups(false);
    }
  }, [webdavSet, folderName, describeBackupError, t]);

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
        const messages = await restoreBackendEntry(backend, entry, t);
        Alert.alert(t('backup.restoreComplete'), messages.join('\n'));
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
  const detailStyle = [styles.detail, isDark && settingsStyles.textMuted];
  const errorStyle = [styles.detail, styles.error, isDark && styles.errorDark];
  const divider = (
    <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />
  );
  const anyBusy = restoringEntry !== null;

  const info = (...parts: string[]) => parts.join('\n\n');

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('backup.sectionBackup').toUpperCase()}
      </Text>
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
                ].join('\n')}
              </Text>
            )}
            {backupResult === 'success' &&
              Object.entries(runResult?.carriers ?? {}).map(([id, outcome]) =>
                outcome.status === 'failed' ? (
                  <Text key={id} testID={`backup-carrier-failed-${id}`} style={errorStyle}>
                    {t('backup.carrierNotWritten', { destination: carrierName(t, id) })}
                    {'\n'}
                    {t(failureMessageKey(outcome.kind === 'unknown' ? 'transport' : outcome.kind))}
                  </Text>
                ) : null
              )}
            {backupResult === 'error' && (
              <Text testID="backup-error-message" style={errorStyle}>
                {backupError}
              </Text>
            )}
          </View>
          <Button
            testID="backup-now-button"
            label={backingUp ? t('backup.backingUp') : t('backup.backupNow')}
            variant="secondary"
            size="sm"
            onPress={handleBackupNow}
            disabled={backingUp}
          />
        </Row>
      </Card>

      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('backup.sectionRestore').toUpperCase()}
      </Text>
      <Card variant="flat" padding="none">
        <Row
          testID="backup-list-button"
          onPress={handleListBackups}
          accessibilityLabel={t('backup.restoreFromDestination')}
          disabled={loadingBackups || anyBusy}
        >
          <MaterialCommunityIcons name="cloud-download-outline" size={22} color={iconColor} />
          <Text style={labelStyle}>{t('backup.restoreFromDestination')}</Text>
          <InfoButton
            testID="backup-info-restore"
            title={t('backup.sectionRestore')}
            message={info(t('backup.restoreInfo'), t('backup.manualRestorePath'))}
          />
        </Row>
        {backendBackups?.every((group) => group.entries.length === 0) && (
          <Row>
            <Text testID="backup-none-found" style={detailStyle}>
              {t('backup.noBackupsAtDestination')}
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
                {waitingRecords.map((record, index) => (
                  <Text key={`${record.kind}-${record.name ?? ''}-${index}`} style={detailStyle}>
                    {record.name ?? t(unplacedKindKey(record.kind))}:{' '}
                    {record.reason === 'activity_unavailable'
                      ? t('backup.unplacedActivityUnavailable')
                      : t('backup.unplacedGroundNotDetected')}
                  </Text>
                ))}
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

      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('backup.sectionDestinations').toUpperCase()}
      </Text>
      <Card variant="flat" padding="none">
        <Row testID="backup-carrier-device">
          <MaterialCommunityIcons name="cellphone" size={22} color={iconColor} />
          <Text style={labelStyle}>
            {t(Platform.OS === 'ios' ? 'backup.carrierDeviceIos' : 'backup.carrierDeviceAndroid')}
          </Text>
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
        {divider}
        <View testID="backup-carrier-webdav">
          <Row>
            <MaterialCommunityIcons name="server-network" size={22} color={iconColor} />
            <Text style={labelStyle}>{t('backup.backendWebdav')}</Text>
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

      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('backup.sectionExport').toUpperCase()}
      </Text>
      <Card variant="flat" padding="none">
        <Row
          testID="backup-export-button"
          onPress={exportRecordBackup}
          accessibilityLabel={dbExporting ? t('backup.exporting') : t('backup.exportBackup')}
          disabled={dbExporting}
        >
          <MaterialCommunityIcons name="database-export-outline" size={22} color={iconColor} />
          <Text style={labelStyle}>
            {dbExporting ? t('backup.exporting') : t('backup.exportBackup')}
          </Text>
          <InfoButton
            testID="backup-info-export"
            title={t('backup.exportBackup')}
            message={t('backup.notEncryptedWarning')}
          />
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
