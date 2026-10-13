import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  exportRecordBackup,
  hasPendingRecordExport,
  pendingRecordExportSettled,
  resumePendingRecordExport,
  type DatabaseRestoreResult,
  type RecordExportOutcome,
} from '@/features/settings/lib/backup';
import { importBackupFile } from '@/features/settings/lib/importBackupFile';
import type { ShareAnchor } from '@/features/settings/lib/shareFile';
import { isPickerCopy } from '@/shared/storage/cacheFiles';
import { inform } from '@/shared/ui/dialog';

export { confirmLegacyImport } from '@/features/settings/lib/importBackupFile';

/** `anchor` is the control the export starts from, which the share sheet points at on iPad. */
export function useExportRecordBackup(anchor?: ShareAnchor) {
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
              await take(await resumePendingRecordExport(anchor));
            } catch {
              setStillRunning(false);
              inform({ title: t('backup.notSavedTitle'), message: t('backup.exportError') });
            }
          });
        }
      } else if (live.current && outcome === 'complete') {
        setStillRunning(false);
      }
    },
    [anchor, t]
  );

  useEffect(() => {
    if (!hasPendingRecordExport()) return;
    resumePendingRecordExport(anchor).then(settle, () => {
      setStillRunning(false);
      inform({ title: t('backup.notSavedTitle'), message: t('backup.exportError') });
    });
  }, [anchor, settle, t]);

  /**
   * Answers what became of the export: `busy` when one was already running,
   * `failed` once the failure has been reported.
   */
  const doExport = useCallback(async (): Promise<RecordExportOutcome | 'busy' | 'failed'> => {
    if (running.current) return 'busy';
    running.current = true;
    setExporting(true);
    try {
      const outcome = await exportRecordBackup(anchor);
      await settle(outcome);
      return outcome;
    } catch {
      setStillRunning(false);
      inform({ title: t('backup.notSavedTitle'), message: t('backup.exportError') });
      return 'failed';
    } finally {
      running.current = false;
      if (live.current) setExporting(false);
    }
  }, [anchor, settle, t]);

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

      return await importBackupFile(fileUri, fileName, t);
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('backup.importError');
      inform({ title: t('backup.notRestoredTitle'), message: msg });
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
