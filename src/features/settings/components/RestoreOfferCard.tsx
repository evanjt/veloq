/**
 * The one-time offer to restore on an empty signed-in library.
 *
 * A card on the feed rather than a sheet, so it never stacks over the tour on a
 * first launch and a stray swipe cannot lose it: it stays until a restore or a
 * tap on Not now answers it for good.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { Card } from '@/shared/ui/Card';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';

import { answerRestorePrompt } from '../lib/restorePrompt';
import { useLaunchSurfaces } from '../hooks/useLaunchSurfaces';
import { RestoreChooser } from './RestoreChooser';

export function RestoreOfferCard() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [busy, setBusy] = useState(false);
  const { restoreCard } = useLaunchSurfaces();

  if (!restoreCard) return null;

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
          {t('backup.restorePromptMessage')}
        </Text>
        <RestoreChooser onRestored={answerRestorePrompt} onBusyChange={setBusy} />
        <View style={styles.actions}>
          <Button
            testID="restore-offer-dismiss"
            label={t('backup.restorePromptDismiss')}
            variant="ghost"
            size="sm"
            onPress={answerRestorePrompt}
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
  descriptionDark: {
    color: darkColors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
