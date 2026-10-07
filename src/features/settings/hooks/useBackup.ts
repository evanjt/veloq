import { useState, useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  restoreBackup,
  RESTORE_REFUSAL_KEYS,
  restoreDatabaseBackup,
  restoreRecordBackup,
  exportRecordBackup,
  hasPendingRecordExport,
  importWaitsForSignIn,
  pendingRecordExportSettled,
  resumePendingRecordExport,
  type DatabaseRestoreResult,
  type RecordExportOutcome,
} from '@/features/settings/lib/backup';
import { holdImportWhileSignedOut, isHeldWhileSignedOut } from '@/features/settings/lib/heldImport';
import { isPickerCopy } from '@/shared/storage/cacheFiles';

/** Ask before a backup replaces stored preferences and names. */
export function confirmLegacyImport(copy: {
  title: string;
  message: string;
  cancel: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      copy.title,
      copy.message,
      [
        { text: copy.cancel, style: 'cancel', onPress: () => resolve(false) },
        { text: copy.title, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

export function useExportRecordBackup() {
  const [exporting, setExporting] = useState(false);
  const [stillRunning, setStillRunning] = useState(false);
  const running = useRef(false);
  const waiting = useRef(false);
  const live = useRef(true);
  const { t } = useTranslation();

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const settle = useCallback(
    async function take(outcome: RecordExportOutcome): Promise<void> {
      if (outcome === 'still-running') {
        if (!live.current) return;
        setStillRunning(true);
        // A screen that was left does not take the file: the one that comes
        // back does, on mount.
        if (!waiting.current) {
          waiting.current = true;
          void pendingRecordExportSettled().then(async () => {
            waiting.current = false;
            if (!live.current) return;
            try {
              await take(await resumePendingRecordExport());
            } catch {
              setStillRunning(false);
              Alert.alert(t('common.error'), t('backup.exportError'));
            }
          });
        }
      } else if (live.current && outcome === 'complete') {
        setStillRunning(false);
      }
    },
    [t]
  );

  useEffect(() => {
    if (!hasPendingRecordExport()) return;
    resumePendingRecordExport().then(settle, () => {
      setStillRunning(false);
      Alert.alert(t('common.error'), t('backup.exportError'));
    });
  }, [settle, t]);

  const doExport = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setExporting(true);
    try {
      await settle(await exportRecordBackup());
    } catch {
      setStillRunning(false);
      Alert.alert(t('common.error'), t('backup.exportError'));
    } finally {
      running.current = false;
      if (live.current) setExporting(false);
    }
  }, [settle, t]);

  return { exportRecordBackup: doExport, exporting, stillRunning };
}

/**
 * Import a backup file via document picker.
 * Auto-detects the record archive and supported legacy formats.
 */
export function useImportDatabaseBackup() {
  const [importing, setImporting] = useState(false);
  const { t } = useTranslation();

  const doImport = useCallback(async (): Promise<DatabaseRestoreResult | null> => {
    if (importing) return null;
    setImporting(true);
    // The picker's copy of the chosen file, deleted once the import settles.
    let pickedCopy: string | null = null;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/octet-stream', 'application/json', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return null;
      }

      const fileUri = result.assets[0].uri;
      if (isPickerCopy(fileUri)) pickedCopy = fileUri;
      const fileName = result.assets[0].name ?? '';

      // An older backup picked signed out is held for sign-in below; anything else needs the engine now.
      if (importWaitsForSignIn() && !isHeldWhileSignedOut(fileName)) {
        Alert.alert(t('common.error'), t('backup.signInRequired'));
        return { success: false, activityCount: 0, signInRequired: true };
      }

      const confirmed = await confirmLegacyImport({
        title: t('backup.importBackup'),
        message: t('backup.legacyImportMessage'),
        cancel: t('common.cancel'),
      });
      if (!confirmed) return null;

      // Signed out, an older backup waits for the sign-in that lets it land.
      if (await holdImportWhileSignedOut(fileUri, fileName)) {
        Alert.alert(t('backup.importBackup'), t('backup.heldUntilSignIn'));
        return { success: false, activityCount: 0 };
      }

      // Auto-detect legacy .veloq JSON files
      if (fileName.endsWith('.veloq')) {
        const json = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.UTF8,
        });

        const legacyResult = await restoreBackup(json);
        if (legacyResult.failed) {
          const message = legacyResult.signInRequired
            ? t('backup.signInRequired')
            : (legacyResult.error ?? t('backup.importError'));
          Alert.alert(t('common.error'), message);
          return { success: false, activityCount: 0, error: legacyResult.error ?? message };
        }

        const messages = [t('backup.recordRestored')];
        Alert.alert(t('backup.restoreComplete'), messages.join('\n'));

        return {
          success: true,
          activityCount: 0,
        };
      }

      if (fileName.endsWith('.zip')) {
        await restoreRecordBackup(fileUri);
        Alert.alert(t('backup.restoreComplete'), t('backup.recordRestored'));
        return { success: true, activityCount: 0 };
      }

      const restoreResult = await restoreDatabaseBackup(fileUri);

      if (restoreResult.success) {
        Alert.alert(t('backup.restoreComplete'), t('backup.recordRestored'));
      } else {
        Alert.alert(
          t('common.error'),
          restoreResult.signInRequired
            ? t('backup.signInRequired')
            : restoreResult.athleteIdMismatch
              ? t('backup.backupDifferentAccount')
              : restoreResult.reason
                ? t(RESTORE_REFUSAL_KEYS[restoreResult.reason])
                : (restoreResult.error ?? t('backup.importError'))
        );
      }

      return restoreResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('backup.importError');
      Alert.alert(t('common.error'), msg);
      // empty-on-error: the failure is the alert on the line above; null tells the caller the
      // import did not complete.
      return null;
    } finally {
      if (pickedCopy)
        await FileSystem.deleteAsync(pickedCopy, { idempotent: true }).catch(() => {});
      setImporting(false);
    }
  }, [importing, t]);

  return { importDatabaseBackup: doImport, importing };
}
