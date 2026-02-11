import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { exportBackup, restoreBackup, type RestoreResult } from '@/lib/export/backup';

export function useExportBackup() {
  const [exporting, setExporting] = useState(false);
  const { t } = useTranslation();

  const doExport = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportBackup();
    } catch {
      Alert.alert(t('common.error'), t('backup.exportError'));
    } finally {
      setExporting(false);
    }
  }, [exporting, t]);

  return { exportBackup: doExport, exporting };
}

export function useImportBackup() {
  const [importing, setImporting] = useState(false);
  const { t } = useTranslation();

  const doImport = useCallback(async (): Promise<RestoreResult | null> => {
    if (importing) return null;
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return null;
      }

      const fileUri = result.assets[0].uri;
      const json = await FileSystem.readAsStringAsync(fileUri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const restoreResult = await restoreBackup(json);

      const messages: string[] = [];
      if (restoreResult.sectionsRestored > 0) {
        messages.push(t('backup.sectionsRestored', { count: restoreResult.sectionsRestored }));
      }
      if (restoreResult.namesApplied > 0) {
        messages.push(t('backup.namesRestored', { count: restoreResult.namesApplied }));
      }
      if (restoreResult.preferencesRestored > 0) {
        messages.push(
          t('backup.preferencesRestored', { count: restoreResult.preferencesRestored })
        );
      }
      if (restoreResult.sectionsFailed.length > 0) {
        messages.push(t('backup.sectionsSkipped', { count: restoreResult.sectionsFailed.length }));
      }

      Alert.alert(t('backup.restoreComplete'), messages.join('\n') || t('backup.nothingToRestore'));

      return restoreResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('backup.importError');
      Alert.alert(t('common.error'), msg);
      return null;
    } finally {
      setImporting(false);
    }
  }, [importing, t]);

  return { importBackup: doImport, importing };
}
