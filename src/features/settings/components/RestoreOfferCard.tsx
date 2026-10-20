/**
 * The one-time offer to restore on an empty signed-in library.
 *
 * A card on the feed rather than a sheet, so it never stacks over the tour on a
 * first launch and a stray swipe cannot lose it. It names the backup it found,
 * where and when, and restores that one. Only a finished restore or a tap on the
 * dismiss answers it for good: leaving the feed mid-restore does not.
 */
import React, { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { Card } from '@/shared/ui/Card';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';

import { inform } from '@/shared/ui/dialog';

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

/**
 * Where the card says the backup was found. Android's own backup is off for the
 * app, so a record zip found there is the one Veloq last wrote on this phone.
 */
function foundKey(source: BackupSource) {
  return source === 'device' && Platform.OS === 'android'
    ? 'backup.restoreOfferFoundOnPhone'
    : FOUND_KEYS[source];
}

export function RestoreOfferCard() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const holdsAsk = useLaunchSurfaces().ask === 'restore';
  const found = useWhatsNewStore((s) => s.restoreOffer);

  const handleRestore = useCallback(async () => {
    if (!found || running.current) return;
    running.current = true;
    try {
      setBusy(true);
      const outcome = await restoreFoundBackup(found, t);
      if (outcome === 'declined') return;
      // Answered here rather than by the card, which the athlete may have left.
      showRestoreNotice(outcome, t);
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

  if (!holdsAsk || !found) return null;

  return (
    <View testID="restore-offer-card">
      <Card variant="raised" style={{ gap: spacing.sm }}>
        <View style={styles.header}>
          <Icon
            name="backup-restore"
            size={iconSize.lg}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('backup.restorePromptTitle')}
          </Text>
        </View>
        <Text style={[styles.description, isDark && styles.descriptionDark]}>
          {t(foundKey(found.source))}
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
    ...typography.bodyBold,
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
