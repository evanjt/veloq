import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { navigateTo } from '@/shared/app/navigation';
import { IconButton } from '@/shared/ui';
import { Badge } from '@/shared/ui/Badge';
import { colors, darkColors, iconSize, layout, spacing } from '@/theme';
import { formatClockOrDate } from '@/shared/format/format';
import { useBackgroundJobs } from '../hooks/useBackgroundJobs';
import { summariseBackgroundJobs } from '../lib/backgroundJobsSummary';

/**
 * The jobs entry in the Settings title bar: an icon that carries the state of
 * every background job, so the athlete can see whether anything runs without
 * opening a list. It opens the jobs screen.
 */
export function BackgroundJobsHeaderItem() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const summary = summariseBackgroundJobs(useBackgroundJobs());
  const label = (() => {
    switch (summary.kind) {
      case 'running':
        return t('backgroundJobs.headerRunning', { count: summary.count });
      case 'failed':
        return t('backgroundJobs.headerStopped', { count: summary.count });
      case 'waiting':
        return summary.until === null
          ? t('backgroundJobs.headerWaitingNoTime')
          : t('backgroundJobs.headerWaiting', { time: formatClockOrDate(summary.until) });
      default:
        return t('backgroundJobs.headerIdle');
    }
  })();
  const palette = isDark ? darkColors : colors;
  const ink =
    summary.kind === 'failed'
      ? palette.errorText
      : summary.kind === 'waiting'
        ? palette.warningText
        : palette.iconSecondary;

  return (
    <IconButton
      testID="background-jobs-header-item"
      accessibilityLabel={label}
      onPress={() => navigateTo('/background-jobs')}
    >
      <View style={styles.glyph}>
        {summary.kind === 'running' ? (
          <IconButton.Spinner testID="background-jobs-header-spinner" />
        ) : (
          <IconButton.Glyph
            name={summary.kind === 'idle' ? 'check-circle-outline' : 'progress-clock'}
            size={iconSize.md}
          />
        )}
        {summary.kind === 'failed' || summary.kind === 'waiting' ? (
          <View
            testID={`background-jobs-header-${summary.kind}`}
            style={[styles.dot, { backgroundColor: ink }]}
          />
        ) : null}
        {summary.kind === 'running' ? (
          <Badge
            tone="count"
            size="sm"
            text={summary.count}
            isDark={isDark}
            style={styles.badge}
            testID="background-jobs-header-count"
          />
        ) : null}
      </View>
    </IconButton>
  );
}

const styles = StyleSheet.create({
  glyph: { alignItems: 'center', justifyContent: 'center' },
  dot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: layout.borderRadiusFull,
  },
  badge: { position: 'absolute', top: -spacing.sm, right: -spacing.md },
});
