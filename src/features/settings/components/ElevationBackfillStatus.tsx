/**
 * Status line for the elevation backfill.
 *
 * The backfill starts on its own after an update, so this is a read-only
 * surface. The queue length is only known once a run has started, so the line
 * reports a count rather than a bar, and each terminal state reads distinctly.
 */

import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';
import { colors, darkColors, spacing, typography } from '@/theme';

export function ElevationBackfillStatus() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { phase, completed, total, failed } = useElevationBackfill();

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const danger = isDark ? darkColors.error : colors.error;

  if (phase === 'idle') return null;

  if (phase === 'fetching') {
    return (
      <View style={styles.runningRow} testID="elevation-backfill-status">
        <ActivityIndicator size="small" color={textSecondary} />
        <View style={styles.runningText}>
          <Text style={[styles.line, { color: textSecondary }]}>
            {t('settings.elevationBackfillRunning')}
          </Text>
          <Text style={[styles.line, { color: textSecondary }]}>
            {t('settings.elevationBackfillProgress', { completed, total })}
          </Text>
        </View>
      </View>
    );
  }

  if (phase === 'failed') {
    return (
      <Text
        style={[styles.line, styles.centred, { color: danger }]}
        testID="elevation-backfill-status"
      >
        {t('settings.elevationBackfillFailed')}
      </Text>
    );
  }

  const message =
    phase === 'complete'
      ? t('settings.elevationBackfillComplete')
      : failed > 0
        ? t('settings.elevationBackfillRetrying', { value: failed })
        : t('settings.elevationBackfillPartial');

  return (
    <Text
      style={[styles.line, styles.centred, { color: textSecondary }]}
      testID="elevation-backfill-status"
    >
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  runningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  runningText: {
    gap: 2,
  },
  line: {
    ...typography.bodySmall,
  },
  centred: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
