/**
 * The one-time offer to restore on an empty signed-in library.
 *
 * A card on the feed rather than a sheet, so it never stacks over the tour on a
 * first launch and a stray swipe cannot lose it. It names the backup it found,
 * where and when, and restores that one. Only a finished restore or a tap on the
 * dismiss answers it for good: leaving the feed mid-restore does not.
 */
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { Card } from '@/shared/ui/Card';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';

import { inform } from '@/shared/ui/dialog';

import { confirmLegacyImport } from '../lib/importBackupFile';
import { backupEntryLabel } from '../lib/backupEntryLabel';
import { describeBackupFailure } from '../lib/backupFailure';
import { answerRestorePrompt, restoreFoundBackup, type BackupSource } from '../lib/restorePrompt';
import { showRestoreNotice } from '../lib/restoreNotice';
import { useLaunchSurfaces } from '../hooks/useLaunchSurfaces';
import { useWhatsNewStore } from '../stores/WhatsNewStore';

const FOUND_KEYS = {
  device: 'backup.restoreOfferFoundDevice',
  webdav: 'backup.restoreOfferFoundWebdav',
  googleDrive: 'backup.restoreOfferFoundGoogleDrive',
  icloud: 'backup.restoreOfferFoundIcloud',
} as const satisfies Record<BackupSource, string>;

export function RestoreOfferCard() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const { restoreCard } = useLaunchSurfaces();
  const found = useWhatsNewStore((s) => s.restoreOffer);

  const handleRestore = useCallback(async () => {
    if (!found || running.current) return;
    running.current = true;
    try {
      const confirmed = await confirmLegacyImport({
        title: t('backup.importBackup'),
        message: t('backup.legacyImportMessage'),
        cancel: t('common.cancel'),
      });
      if (!confirmed) return;
      setBusy(true);
      // Answered here rather than by the card, which the athlete may have left.
      showRestoreNotice(await restoreFoundBackup(found), t);
      answerRestorePrompt();
    } catch (error) {
      const described = describeBackupFailure(error);
      inform({
        title: t('backup.notRestoredTitle'),
        message: described.kind === 'key' ? t(described.key) : described.message,
      });
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [found, t]);

  if (!restoreCard || !found) return null;

  return (
    <View testID="restore-offer-card">
      <Card variant="raised" style={{ gap: spacing.sm }}>
        <View style={styles.header}>
          <MaterialCommunityIcons
            name="backup-restore"
            size={iconSize.lg}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('backup.restorePromptTitle')}
          </Text>
        </View>
        <Text style={[styles.description, isDark && styles.descriptionDark]}>
          {t(FOUND_KEYS[found.source])}
        </Text>
        <Text testID="restore-offer-entry" style={[styles.entry, isDark && styles.titleDark]}>
          {backupEntryLabel(found.entry, t)}
        </Text>
        {busy ? (
          <Text
            testID="restore-offer-progress"
            style={[styles.description, isDark && styles.descriptionDark]}
          >
            {t('backup.restoreOfferRestoring')}
          </Text>
        ) : (
          <Text style={[styles.description, isDark && styles.descriptionDark]}>
            {t('backup.restoreOfferLater')}
          </Text>
        )}
        <View style={styles.actions}>
          <Button
            testID="restore-offer-dismiss"
            label={t('backup.restorePromptDismiss')}
            variant="ghost"
            size="sm"
            onPress={answerRestorePrompt}
            disabled={busy}
          />
          <Button
            testID="restore-offer-restore"
            label={t('common.restore')}
            variant="primary"
            size="sm"
            onPress={handleRestore}
            loading={busy}
            disabled={busy}
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  description: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  entry: {
    ...typography.body,
    color: colors.textPrimary,
  },
  descriptionDark: {
    color: darkColors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
