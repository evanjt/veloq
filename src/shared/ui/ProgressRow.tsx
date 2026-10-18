/**
 * Progress for work with a known total, drawn and read one way everywhere.
 *
 * `ProgressBar` is a determinate linear track that a screen reader reads as a
 * progress bar with its range and position. `ProgressRow` puts a label above
 * it, the counts below and an optional action at the trailing edge, and
 * announces the start, each quarter and the end. A count that moves several
 * times a second would otherwise be spoken on every tick, or not at all.
 */

import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { layout, spacing, stroke, themePalette, typography } from '@/theme';

/**
 * The last quarter `done` has reached, as a percentage: 0, 25, 50, 75 or 100.
 * Null while the total is unknown.
 */
export function progressMilestone(done: number, total: number): number | null {
  if (!(total > 0)) return null;
  const fraction = Math.min(1, Math.max(0, done / total));
  return Math.floor(fraction * 4) * 25;
}

/** The range and position a screen reader reads, with `now` held inside the range. */
export function progressValue(done: number, total: number) {
  return { min: 0, max: total, now: Math.min(total, Math.max(0, done)) };
}

interface ProgressBarProps {
  done: number;
  /** Greater than 0; a caller with no total yet draws no bar. */
  total: number;
  /** What the bar measures, read before its value. */
  label?: string | undefined;
  testID?: string | undefined;
  trackTestID?: string | undefined;
  fillTestID?: string | undefined;
}

/**
 * A hairline track through the middle of the bar and a fill at the bar's full
 * height, told apart by thickness. Both are marks on the theme's own roles, so
 * neither depends on the other's colour to be seen.
 */
export function ProgressBar({
  done,
  total,
  label,
  testID,
  trackTestID,
  fillTestID,
}: ProgressBarProps) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const value = progressValue(done, total);
  const percent = Math.round((value.now / total) * 100);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={value}
      style={styles.bar}
    >
      <View testID={trackTestID} style={[styles.track, { backgroundColor: palette.track }]} />
      <View
        testID={fillTestID}
        style={[styles.fill, { backgroundColor: palette.controlOn, width: `${percent}%` }]}
      />
    </View>
  );
}

/** Speaks `label` and its percentage each time the work reaches a new quarter. */
function useMilestoneAnnouncement(label: string, done: number, total: number, enabled: boolean) {
  const { t } = useTranslation();
  const spoken = useRef<number | null>(null);
  const milestone = progressMilestone(done, total);

  useEffect(() => {
    if (!enabled || milestone === null || milestone === spoken.current) return;
    spoken.current = milestone;
    AccessibilityInfo.announceForAccessibility(
      t('common.progressAnnouncement', { label, percent: milestone }) as string
    );
  }, [enabled, label, milestone, t]);
}

interface ProgressRowProps {
  label: string;
  done: number;
  /** 0 while the total is not known yet, which draws the label alone. */
  total: number;
  /** The count as the row writes it, such as "120 of 480". */
  counts?: string | undefined;
  /** Anything else under the counts, such as a size. */
  children?: React.ReactNode;
  /** A control at the trailing edge, such as Cancel. */
  action?: React.ReactNode;
  /** Off where something else on screen already speaks this progress. */
  announce?: boolean;
  labelStyle?: StyleProp<TextStyle>;
  detailStyle?: StyleProp<TextStyle>;
  barTestID?: string | undefined;
  countsTestID?: string | undefined;
}

export function ProgressRow({
  label,
  done,
  total,
  counts,
  children,
  action,
  announce = true,
  labelStyle,
  detailStyle,
  barTestID,
  countsTestID,
}: ProgressRowProps) {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  useMilestoneAnnouncement(label, done, total, announce);
  const known = total > 0;

  return (
    <View style={styles.row}>
      <View style={styles.labels}>
        <Text style={labelStyle ?? [styles.label, { color: palette.textPrimary }]}>{label}</Text>
        {known ? <ProgressBar done={done} total={total} label={label} testID={barTestID} /> : null}
        {known && counts !== undefined ? (
          <Text
            testID={countsTestID}
            style={detailStyle ?? [styles.detail, { color: palette.textSecondary }]}
          >
            {counts}
          </Text>
        ) : null}
        {children}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  labels: {
    flex: 1,
  },
  bar: {
    height: spacing.xs,
    marginTop: spacing.xs,
    justifyContent: 'center',
  },
  track: {
    height: stroke.one,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: spacing.xs,
    borderRadius: layout.borderRadiusXs,
  },
  label: {
    ...typography.body,
  },
  detail: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
});
