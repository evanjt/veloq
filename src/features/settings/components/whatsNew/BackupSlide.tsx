/**
 * The tour's backup slide: what a backup holds and where it goes, and the one
 * place outside Settings that asks for automatic backup.
 *
 * Turn on goes the way the Settings switch does, so the first backup is written
 * at once. Never remind me again records the answer alone, so neither this
 * slide nor the tour's leftover card asks again. Swiping past records nothing.
 */

import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { isAutoBackupEnabled, turnOnAutoBackup } from '@/features/settings/lib/autobackup';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { Button } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { tourPanelColour } from './tourPanel';

export function BackupSlide() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [autoEnabled, setAutoEnabled] = useState(() => isAutoBackupEnabled());
  const answered = useWhatsNewStore((s) => s.tourOffer.answers.backup);
  const answerSetup = useWhatsNewStore((s) => s.answerSetup);
  const palette = isDark ? darkColors : colors;
  const panel = tourPanelColour(isDark);

  // The run goes on after the tour moves on, and Settings, Backup reports how it went.
  const turnOn = useCallback(() => {
    setAutoEnabled(true);
    answerSetup('backup', 'on');
    turnOnAutoBackup().catch(() => undefined);
  }, [answerSetup]);

  const never = useCallback(() => answerSetup('backup', 'never'), [answerSetup]);

  // In place of the buttons, the one line that says why there is nothing to answer.
  const status = autoEnabled
    ? t('whatsNew.tutorial.backupOn')
    : answered === 'never'
      ? t('whatsNew.tutorial.backupLater')
      : null;

  return (
    <View style={styles.container}>
      <View style={[styles.panel, { backgroundColor: panel }]}>
        <Icon name="shield-check-outline" size={iconSize.md} color={palette.actionPrimary} />
        <Text style={[styles.panelText, { color: palette.textPrimary }]} testID="tour-backup-holds">
          {t('backup.backupHolds')}
        </Text>
      </View>
      <View style={[styles.panel, { backgroundColor: panel }]}>
        <Icon name="cloud-sync-outline" size={iconSize.md} color={palette.actionPrimary} />
        <Text style={[styles.panelText, { color: palette.textPrimary }]} testID="tour-backup-where">
          {t('whatsNew.tutorial.backupWhere')}
        </Text>
      </View>

      {status ? (
        <Text style={[styles.status, { color: palette.textSecondary }]}>{status}</Text>
      ) : (
        <View style={styles.actions}>
          <Button
            testID="tour-backup-never"
            label={t('whatsNew.tutorial.neverRemind')}
            variant="ghost"
            size="sm"
            onPress={never}
          />
          <Button
            testID="tour-backup-turn-on"
            label={t('whatsNew.tutorial.turnOn')}
            variant="primary"
            size="sm"
            onPress={turnOn}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'stretch',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  panel: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  panelText: {
    ...typography.bodySmall,
    flex: 1,
  },
  status: {
    ...typography.bodySmall,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
});
