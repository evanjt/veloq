/**
 * The ways a library comes back, offered wherever a restore is: a file, a
 * WebDAV server entered inline, Veloq's own Google Drive folder on Android, and
 * a line on the phone's own backup, which the app can neither list nor fetch
 * because the platform returns it only while a new phone is set up. Signed out,
 * a chosen backup is held for the sign-in.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography } from '@/theme';
import { getIntlLocale } from '@/shared/format/format';

import { confirmLegacyImport, useImportDatabaseBackup } from '../hooks/useBackup';
import { webdavBackend, type BackupBackend, type BackupEntry } from '../lib/autobackup/backends';
import {
  googleDriveBackend,
  isGoogleDriveSupported,
  signInToGoogleDrive,
} from '../lib/autobackup/backends/googleDriveBackend';
import { describeBackupFailure } from '../lib/backupFailure';
import { restoreBackendEntry } from '../lib/restoreBackendEntry';
import { WebdavConfigForm } from './WebdavConfigForm';

interface RestoreChooserProps {
  /** A backup was restored, or held for the sign-in. */
  onRestored?: () => void;
  /** A restore started or settled, so the host can hold its own controls. */
  onBusyChange?: (busy: boolean) => void;
}

export function RestoreChooser({ onRestored, onBusyChange }: RestoreChooserProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { importDatabaseBackup, importing } = useImportDatabaseBackup();
  const [showWebdav, setShowWebdav] = useState(false);
  const [entries, setEntries] = useState<BackupEntry[] | null>(null);
  const [listing, setListing] = useState(false);
  const [driveAccount, setDriveAccount] = useState<string | null>(null);
  const [driveEntries, setDriveEntries] = useState<BackupEntry[] | null>(null);
  const [driveListing, setDriveListing] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const running = useRef(false);

  const busy = importing || restoring !== null;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const handleFile = useCallback(async () => {
    const result = await importDatabaseBackup();
    if (result?.success) onRestored?.();
  }, [importDatabaseBackup, onRestored]);

  const handleList = useCallback(async () => {
    setListing(true);
    try {
      if (!(await webdavBackend.isAvailable())) {
        throw new Error(t('backup.destinationUnavailable'));
      }
      setEntries(await webdavBackend.listBackups());
    } catch (error) {
      Alert.alert(t('common.error'), error instanceof Error ? error.message : '');
    } finally {
      setListing(false);
    }
  }, [t]);

  // Signing in here is what sets Google Drive up as a destination, so the
  // backups after sign-in to intervals.icu go there too.
  const handleGoogleDrive = useCallback(async () => {
    setDriveListing(true);
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
      setDriveEntries(await googleDriveBackend.listBackups());
    } catch (error) {
      const described = describeBackupFailure(error);
      Alert.alert(
        t('common.error'),
        described.kind === 'key' ? t(described.key) : described.message
      );
    } finally {
      setDriveListing(false);
    }
  }, [t]);

  const handleRestore = useCallback(
    async (backend: BackupBackend, entry: BackupEntry) => {
      if (running.current) return;
      running.current = true;
      const confirmed = await confirmLegacyImport({
        title: t('backup.importBackup'),
        message: t('backup.legacyImportMessage'),
        cancel: t('common.cancel'),
      });
      if (!confirmed) {
        running.current = false;
        return;
      }
      setRestoring(entry.id);
      try {
        const notice = await restoreBackendEntry(backend, entry, t);
        Alert.alert(notice.title, notice.message);
        onRestored?.();
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('backup.importError')
        );
      } finally {
        running.current = false;
        setRestoring(null);
      }
    },
    [t, onRestored]
  );

  const secondary = isDark ? styles.textSecondaryDark : null;

  return (
    <View testID="restore-chooser" style={styles.chooser}>
      <Button
        testID="restore-chooser-file"
        label={importing ? t('backup.importing') : t('backup.restoreFromFile')}
        variant="secondary"
        onPress={handleFile}
        disabled={busy}
      />
      <Button
        testID="restore-chooser-webdav"
        label={t('backup.restoreFromWebdav')}
        variant="secondary"
        onPress={() => setShowWebdav((shown) => !shown)}
        disabled={busy}
      />
      {showWebdav && (
        <>
          <WebdavConfigForm
            onConfigChange={() => setEntries(null)}
            onRemoved={() => setEntries(null)}
          />
          <Button
            testID="restore-chooser-list"
            label={t('backup.restoreFromDestination')}
            variant="secondary"
            onPress={handleList}
            loading={listing}
            disabled={busy}
          />
          {entries?.length === 0 && (
            <Text testID="restore-chooser-none" style={[styles.detail, secondary]}>
              {t('backup.noBackupsAtDestination')}
            </Text>
          )}
          {entries?.map((entry) => (
            <Button
              key={entry.id}
              testID={`restore-chooser-entry-${entry.id}`}
              label={t('backup.restoreDatedBackup', {
                date: new Date(entry.timestamp).toLocaleDateString(getIntlLocale()),
              })}
              variant="ghost"
              onPress={() => handleRestore(webdavBackend, entry)}
              loading={restoring === entry.id}
              disabled={busy}
            />
          ))}
        </>
      )}
      {isGoogleDriveSupported() && (
        <>
          <Button
            testID="restore-chooser-google-drive"
            label={t('backup.restoreFromGoogleDrive')}
            variant="secondary"
            onPress={handleGoogleDrive}
            loading={driveListing}
            disabled={busy}
          />
          {driveAccount !== null && (
            <Text testID="restore-chooser-google-drive-account" style={[styles.detail, secondary]}>
              {driveAccount}
            </Text>
          )}
          {driveEntries?.length === 0 && (
            <Text testID="restore-chooser-google-drive-none" style={[styles.detail, secondary]}>
              {t('backup.noBackupsAtDestination')}
            </Text>
          )}
          {driveEntries?.map((entry) => (
            <Button
              key={entry.id}
              testID={`restore-chooser-entry-${googleDriveBackend.id}-${entry.id}`}
              label={t('backup.restoreDatedBackup', {
                date: new Date(entry.timestamp).toLocaleDateString(getIntlLocale()),
              })}
              variant="ghost"
              onPress={() => handleRestore(googleDriveBackend, entry)}
              loading={restoring === entry.id}
              disabled={busy}
            />
          ))}
        </>
      )}
      <View testID="restore-chooser-device-backup" style={styles.deviceRow}>
        <MaterialCommunityIcons
          name="cellphone"
          size={18}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
        <View style={styles.fill}>
          <Text style={[styles.label, isDark && styles.textDark]}>
            {t(Platform.OS === 'ios' ? 'backup.carrierDeviceIos' : 'backup.carrierDeviceAndroid')}
          </Text>
          <Text style={[styles.detail, secondary]}>{t('backup.carrierDeviceRestore')}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chooser: {
    gap: spacing.md,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fill: {
    flex: 1,
  },
  label: {
    ...typography.body,
    color: colors.textPrimary,
  },
  detail: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textPrimary,
  },
  textSecondaryDark: {
    color: darkColors.textSecondary,
  },
});
