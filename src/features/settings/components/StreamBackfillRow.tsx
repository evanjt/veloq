/**
 * Fetch the per-metric series the retention window already threw away.
 *
 * The window defaulted to ninety days, so on an install older than that most of
 * the library downloaded only the three series the track needs. Widening the
 * default fixed what the next sync stores and nothing about what is already on
 * the device. This row is what goes back for them.
 *
 * It sits under the window control because the window is what decides its
 * queue: narrowing the window narrows what is owed, in the same breath.
 *
 * Nothing starts this at launch. It is tens of megabytes on the athlete's own
 * connection, so the count is offered and the athlete decides, and the stop
 * lands at the next batch rather than at the end of the library.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, spacing, typography } from '@/theme';

import { useStreamBackfill } from '../hooks/useStreamBackfill';

interface StreamBackfillRowProps {
  isDark: boolean;
}

export function StreamBackfillRow({ isDark }: StreamBackfillRowProps) {
  const { t } = useTranslation();
  const { isRunning, completed, total, remaining, start, stop } = useStreamBackfill();

  // A null count is an engine that could not answer, not a stocked library, so
  // the row stays away rather than claiming the work is done.
  if (!isRunning && (remaining === null || remaining === 0)) return null;

  const value = isRunning
    ? t('settings.streamBackfillProgress', { completed, total })
    : t('settings.streamBackfillOwed', { count: remaining ?? 0 });

  return (
    <View testID="settings-stream-backfill" style={[styles.infoRow, isDark && styles.infoRowDark]}>
      <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
        {t('settings.streamBackfill')}
      </Text>
      <View style={styles.infoValueRow}>
        <Text
          testID="settings-stream-backfill-count"
          style={[styles.infoValue, isDark && styles.textLight]}
        >
          {value}
        </Text>
        <TouchableOpacity
          testID="settings-stream-backfill-action"
          onPress={isRunning ? stop : start}
          accessibilityRole="button"
        >
          <Text style={[styles.infoValue, styles.valueClickable]}>
            {isRunning ? t('settings.streamBackfillStop') : t('settings.streamBackfillDownload')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoRowDark: {
    borderTopColor: darkColors.border,
  },
  infoLabel: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  infoValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  valueClickable: {
    color: colors.primary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
