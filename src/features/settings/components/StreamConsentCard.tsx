/**
 * The one-time ask before a large automatic series download.
 *
 * Past the large-download threshold the engine holds the pass instead of
 * starting it. The card states the activity count and megabytes the engine
 * reports and carries the answer back: Download records a yes, so later passes
 * start without asking, and Not now holds the pass until the retention window
 * next changes. It is a card in the feed rather than a modal, and it is absent
 * whenever the engine is not waiting for an answer.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { Button } from '@/shared/ui';

import { useStreamBackfill } from '../hooks/useStreamBackfill';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { Card } from '@/shared/ui/Card';

export function StreamConsentCard() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const { awaitingConsent, estimateRequests, estimateMegabytes, start, stop } = useStreamBackfill();

  if (!awaitingConsent) return null;

  return (
    <View testID="stream-consent-card" style={styles.cardFrame} accessibilityRole="alert">
      <Card variant="raised" style={{ gap: spacing.sm }}>
        <View style={styles.header}>
          <MaterialCommunityIcons
            name="cloud-download-outline"
            size={22}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('feed.streamConsentTitle')}
          </Text>
        </View>
        <Text
          testID="stream-consent-body"
          style={[styles.description, isDark && styles.descriptionDark]}
        >
          {t('feed.streamConsentBody', { count: estimateRequests, megabytes: estimateMegabytes })}
        </Text>
        <View style={styles.actions}>
          <Button
            testID="stream-consent-decline"
            label={t('feed.streamConsentDecline')}
            onPress={stop}
            variant="ghost"
          />
          <Button
            testID="stream-consent-download"
            label={t('feed.streamConsentDownload')}
            onPress={start}
          />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  cardFrame: {
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
  },
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
    lineHeight: 20,
  },
  descriptionDark: {
    color: darkColors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
});
