import { useState, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as FileSystem from 'expo-file-system/legacy';
import {
  restoreBackup,
  exportDatabaseBackup,
  resumePendingDatabaseExport,
  restoreDatabaseBackup,
  type DatabaseRestoreResult,
} from '@/features/settings/lib/backup';

/**
 * Export full SQLite database snapshot via share sheet.
 *
 * The wait is capped at a minute. A copy still going past it is not a failure:
 * the row says so, and the file is offered when the screen next mounts, which
 * is what `resumePendingDatabaseExport` reads.
 */
export function useExportDatabaseBackup() {
  const [exporting, setExporting] = useState(false);
  const [stillRunning, setStillRunning] = useState(false);
  const { t } = useTranslation();

  const doExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      setStillRunning((await exportDatabaseBackup()) === 'still-running');
    } catch {
      setStillRunning(false);
      Alert.alert(t('common.error'), t('backup.exportError'));
    } finally {
      setExporting(false);
    }
  }, [exporting, t]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const outcome = await resumePendingDatabaseExport();
        if (!live) return;
        // Only the two outcomes about an owed file say anything.
        // `nothing-pending` means the resume found nothing owed, not that
        // nothing is running: reporting it as not running lands after an
        // export started since this mount and clears the row it just set.
        if (outcome === 'still-running') setStillRunning(true);
        else if (outcome === 'shared') setStillRunning(false);
      } catch {
        if (live) setStillRunning(false);
        Alert.alert(t('common.error'), t('backup.exportError'));
      }
    })();
    return () => {
      live = false;
    };
  }, [t]);

  return { exportDatabaseBackup: doExport, exporting, stillRunning };
}

/**
 * Import a backup file via document picker.
 * Auto-detects format: .veloqdb (SQLite snapshot) or .veloq (legacy JSON).
 */
export function useImportDatabaseBackup() {
  const [importing, setImporting] = useState(false);
  const { t } = useTranslation();

  const doImport = useCallback(async (): Promise<DatabaseRestoreResult | null> => {
    if (importing) return null;
    setImporting(true);
    try {
      const DocumentPicker = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/octet-stream', 'application/json', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return null;
      }

      const fileUri = result.assets[0].uri;
      const fileName = result.assets[0].name ?? '';

      // Auto-detect legacy .veloq JSON files
      if (fileName.endsWith('.veloq')) {
        const json = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        const legacyResult = await restoreBackup(json);

        const messages: string[] = [];
        if (legacyResult.namesApplied > 0) {
          messages.push(t('backup.namesRestored', { count: legacyResult.namesApplied }));
        }
        if (legacyResult.preferencesRestored > 0) {
          messages.push(
            t('backup.preferencesRestored', { count: legacyResult.preferencesRestored })
          );
        }
        if (legacyResult.sectionsRestored > 0) {
          messages.push(t('backup.sectionsRestored', { count: legacyResult.sectionsRestored }));
        }
        if (legacyResult.sectionsFailed.length > 0) {
          messages.push(t('backup.sectionsSkipped', { count: legacyResult.sectionsFailed.length }));
        }
        messages.push('');
        messages.push(t('backup.legacyImportNotice'));

        Alert.alert(t('backup.restoreComplete'), messages.join('\n'));

        return {
          success: true,
          activityCount: 0,
        };
      }

      // Default: .veloqdb SQLite restore
      const restoreResult = await restoreDatabaseBackup(fileUri);

      if (restoreResult.success) {
        const messages = [t('backup.databaseRestored', { count: restoreResult.activityCount })];
        if (restoreResult.athleteIdMismatch) {
          messages.push(
            `\n${t('backup.differentAccount', { defaultValue: 'Warning: This backup belongs to a different account ({{id}}).' }).replace('{{id}}', restoreResult.backupAthleteId ?? '?')}`
          );
        }
        Alert.alert(t('backup.restoreComplete'), messages.join(''));
      } else {
        Alert.alert(t('common.error'), restoreResult.error ?? t('backup.importError'));
      }

      return restoreResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('backup.importError');
      Alert.alert(t('common.error'), msg);
      return null;
    } finally {
      setImporting(false);
    }
  }, [importing, t]);

  return { importDatabaseBackup: doImport, importing };
}
