/**
 * The one-time offer to restore on an empty signed-in library.
 *
 * Shown over the feed when no platform record was applied, so an athlete on a
 * new phone is told that a backup in a file or on a WebDAV server can come back.
 * Dismissing it, or restoring, answers it for good.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, opacity, spacing, typography } from '@/theme';
import { getIntlLocale } from '@/shared/format/format';

import { useImportDatabaseBackup } from '../hooks/useBackup';
import { webdavBackend, type BackupEntry } from '../lib/autobackup/backends';
import { answerRestorePrompt } from '../lib/restorePrompt';
import { restoreBackendEntry } from '../lib/restoreBackendEntry';
import { WebdavConfigForm } from './WebdavConfigForm';

interface RestorePromptSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function RestorePromptSheet({ visible, onClose }: RestorePromptSheetProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { importDatabaseBackup, importing } = useImportDatabaseBackup();
  const [showWebdav, setShowWebdav] = useState(false);
  const [entries, setEntries] = useState<BackupEntry[] | null>(null);
  const [listing, setListing] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const running = useRef(false);

  const finish = useCallback(() => {
    answerRestorePrompt();
    onClose();
  }, [onClose]);

  const handleFile = useCallback(async () => {
    const result = await importDatabaseBackup();
    if (result?.success) finish();
  }, [importDatabaseBackup, finish]);

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

  const handleRestore = useCallback(
    async (entry: BackupEntry) => {
      if (running.current) return;
      running.current = true;
      setRestoring(entry.id);
      try {
        const messages = await restoreBackendEntry(webdavBackend, entry, t);
        Alert.alert(t('backup.restoreComplete'), messages.join('\n'));
        finish();
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
    [t, finish]
  );

  const busy = importing || restoring !== null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={finish}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View testID="restore-prompt-sheet" style={[styles.sheet, isDark && styles.sheetDark]}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text style={[styles.title, isDark && styles.textLight]}>
              {t('backup.restorePromptTitle')}
            </Text>
            <Text style={[styles.body, isDark && styles.textMuted]}>
              {t('backup.restorePromptMessage')}
            </Text>
            <Button
              testID="restore-prompt-file"
              label={importing ? t('backup.importing') : t('backup.restoreFromFile')}
              variant="secondary"
              onPress={handleFile}
              disabled={busy}
            />
            <Button
              testID="restore-prompt-webdav"
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
                  testID="restore-prompt-list"
                  label={t('backup.restoreFromDestination')}
                  variant="secondary"
                  onPress={handleList}
                  loading={listing}
                  disabled={busy}
                />
                {entries?.length === 0 && (
                  <Text style={[styles.body, isDark && styles.textMuted]}>
                    {t('backup.noBackupsAtDestination')}
                  </Text>
                )}
                {entries?.map((entry) => (
                  <Button
                    key={entry.id}
                    testID={`restore-prompt-entry-${entry.id}`}
                    label={t('backup.restoreDatedBackup', {
                      date: new Date(entry.timestamp).toLocaleDateString(getIntlLocale()),
                    })}
                    variant="ghost"
                    onPress={() => handleRestore(entry)}
                    loading={restoring === entry.id}
                    disabled={busy}
                  />
                ))}
              </>
            )}
            <Button
              testID="restore-prompt-dismiss"
              label={t('backup.restorePromptDismiss')}
              variant="ghost"
              onPress={finish}
              disabled={busy}
            />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: opacity.overlay.scrim,
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: layout.borderRadius,
    borderTopRightRadius: layout.borderRadius,
    backgroundColor: colors.surface,
  },
  sheetDark: {
    backgroundColor: darkColors.surface,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
