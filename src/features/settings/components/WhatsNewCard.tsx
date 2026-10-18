/**
 * What's New after an update, offered on the feed rather than opened over it.
 *
 * It names the version and how many slides were added since the seen one. Open
 * runs the What's New tour, which marks the version seen when it is closed, and
 * the dismiss marks it seen at once, so the card is never offered twice for one
 * version. Whether it shows is the launch verdict's to say.
 */
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { Card } from '@/shared/ui/Card';
import { useTheme } from '@/shared/app';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';

import { useLaunchSurfaces } from '../hooks/useLaunchSurfaces';
import { useWhatsNewStore } from '../stores/WhatsNewStore';

export function WhatsNewCard() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const card = useLaunchSurfaces().whatsNewCard;
  const startTour = useWhatsNewStore((s) => s.startTour);
  const markSeen = useWhatsNewStore((s) => s.markSeen);
  const version = card?.version;

  const open = useCallback(() => startTour('whatsNew'), [startTour]);
  const dismiss = useCallback(() => {
    if (version) markSeen(version);
  }, [markSeen, version]);

  if (!card) return null;

  return (
    <View testID="whats-new-update-card">
      <Card variant="raised" style={{ gap: spacing.sm }}>
        <View style={styles.header}>
          <Icon
            name="new-box"
            size={iconSize.lg}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('whatsNew.updateCardTitle', { version: card.version })}
          </Text>
        </View>
        <Text style={[styles.description, isDark && styles.descriptionDark]}>
          {t('whatsNew.updateCardBody', { count: card.slideCount })}
        </Text>
        <View style={styles.actions}>
          <Button
            testID="whats-new-update-dismiss"
            label={t('whatsNew.updateCardDismiss')}
            variant="ghost"
            size="sm"
            onPress={dismiss}
          />
          <Button
            testID="whats-new-update-open"
            label={t('whatsNew.updateCardOpen')}
            variant="primary"
            size="sm"
            onPress={open}
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
  descriptionDark: {
    color: darkColors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
