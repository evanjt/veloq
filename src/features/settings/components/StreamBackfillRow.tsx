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
 * The engine starts the pass by itself after a settled sync. The row shows its
 * progress and stops it, and the stop lands at the next batch rather than at the
 * end of the library. A stop holds the automatic start until the window next
 * changes, so Download is offered only after a stop, or while the engine waits
 * for the athlete's consent.
 */

import React from 'react';
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, darkColors, spacing, typography } from '@/theme';

import { streamBackfillRefusalKey } from '../lib/streamBackfillRefusal';
import { useStreamBackfill } from '../hooks/useStreamBackfill';
import { Row, pressable, pressRipple } from '@/shared/ui';

interface StreamBackfillRowProps {
  isDark: boolean;
}

export function StreamBackfillRow({ isDark }: StreamBackfillRowProps) {
  const { t } = useTranslation();
  const {
    isRunning,
    completed,
    total,
    remaining,
    phase,
    start,
    stop,
    awaitingConsent,
    estimateMegabytes,
    refusal,
  } = useStreamBackfill();

  // A null count is an engine that could not answer, not a stocked library, so
  // the row stays away rather than claiming the work is done.
  if (!isRunning && (remaining === null || remaining === 0)) return null;

  const value = isRunning
    ? t('settings.streamBackfillProgress', { completed, total })
    : t('settings.streamBackfillOwed', { count: remaining ?? 0 });
  // Download starts a pass by hand, which only an athlete's stop or the
  // engine's wait for consent leaves undone; otherwise the engine starts it.
  const offersDownload = phase === 'stopped' || awaitingConsent;
  const detail = awaitingConsent ? `${value}, ${estimateMegabytes} MB` : value;

  const refusalKey = streamBackfillRefusalKey(refusal);

  return (
    <Row testID="settings-stream-backfill">
      <View style={styles.block}>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, isDark && styles.textMuted]}>
            {t('settings.streamBackfill')}
          </Text>
          <View style={styles.infoValueRow}>
            <Text
              testID="settings-stream-backfill-count"
              style={[styles.infoValue, isDark && styles.textLight]}
            >
              {detail}
            </Text>
            {(isRunning || offersDownload) && (
              <Pressable
                testID="settings-stream-backfill-action"
                onPress={isRunning ? stop : start}
                accessibilityRole="button"
                style={pressable()}
                android_ripple={pressRipple}
              >
                <Text
                  style={[
                    styles.infoValue,
                    styles.valueClickable,
                    isDark && { color: darkColors.linkTeal },
                  ]}
                >
                  {isRunning
                    ? t('settings.streamBackfillStop')
                    : t('settings.streamBackfillDownload')}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
        {refusalKey !== null && (
          <Text
            testID="settings-stream-backfill-refusal"
            style={[styles.refusal, isDark && styles.textMuted]}
          >
            {t(refusalKey)}
          </Text>
        )}
      </View>
    </Row>
  );
}

const styles = StyleSheet.create({
  block: {
    flex: 1,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  refusal: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.xs,
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
    color: colors.linkTeal,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
