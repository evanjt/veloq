import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as FileSystem from 'expo-file-system/legacy';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { getAvailableBackends, type BackupEntry } from '@/lib/backup';
import { restoreDatabaseBackup } from '@/lib/export/backup';

export interface DetectedBackup {
  entry: BackupEntry;
  backendId: string;
  backendName: string;
}

export function useBackupRestore() {
  const { t } = useTranslation();

  // Auto-detect available backups on fresh install
  const [detectedBackup, setDetectedBackup] = useState<DetectedBackup | null>(null);
  const [restoringDetected, setRestoringDetected] = useState(false);
  const [dismissedRestore, setDismissedRestore] = useState(false);

  useEffect(() => {
    const engine = getRouteEngine();
    const activityCount = engine?.getActivityCount() ?? 0;
    if (activityCount > 0) return;

    (async () => {
      try {
        const backends = await getAvailableBackends();
        for (const backend of backends) {
          try {
            const backups = await backend.listBackups();
            if (backups.length > 0) {
              setDetectedBackup({
                entry: backups[0],
                backendId: backend.id,
                backendName: backend.name,
              });
              return;
            }
          } catch {
            // Skip backends that fail
          }
        }
      } catch {
        // Silently fail - auto-detect is best-effort
      }
    })();
  }, []);

  const handleRestoreDetected = useCallback(async () => {
    if (!detectedBackup || restoringDetected) return;
    setRestoringDetected(true);
    try {
      const backends = await getAvailableBackends();
      const backend = backends.find((b) => b.id === detectedBackup.backendId);
      if (!backend) throw new Error('Backend not available');

      const tempPath = `${FileSystem.cacheDirectory}restore-temp.veloqdb`;
      await backend.download(detectedBackup.entry.id, tempPath);

      const result = await restoreDatabaseBackup(tempPath);
      await FileSystem.deleteAsync(tempPath, { idempotent: true });

      if (result.success) {
        const messages = [t('backup.databaseRestored', { count: result.activityCount })];
        if (result.athleteIdMismatch) {
          messages.push(
            `\n${t('backup.differentAccount', { defaultValue: 'Warning: This backup belongs to a different account.' })}`
          );
        }
        Alert.alert(t('backup.restoreComplete'), messages.join(''));
        setDetectedBackup(null);
      } else {
        Alert.alert(t('common.error'), result.error ?? t('backup.importError'));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('backup.importError');
      Alert.alert(t('common.error'), msg);
    } finally {
      setRestoringDetected(false);
    }
  }, [detectedBackup, restoringDetected, t]);

  return {
    detectedBackup,
    restoringDetected,
    dismissedRestore,
    setDismissedRestore,
    handleRestoreDetected,
  };
}
