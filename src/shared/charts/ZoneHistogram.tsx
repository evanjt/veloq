import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, opacity, spacing, typography } from '@/theme';

/** One bar of a zone histogram. `percent` is of the whole, 0 to 100. */
export interface ZoneBand {
  key: string | number;
  label: string;
  colour: string;
  percent: number;
  /** Bold value beside the bar, the time in zone. */
  primary?: string;
  /** Muted value beneath it, the zone's range. */
  secondary?: string;
}

interface ZoneHistogramProps {
  bands: readonly ZoneBand[];
  testID?: string;
}

/** Below this share a band reads as empty and its numbers are replaced by a dash. */
const EMPTY_BELOW_PERCENT = 0.5;

/** Horizontal bars, one per zone, with the share on the left and the time and range on the right. */
export function ZoneHistogram({ bands, testID }: ZoneHistogramProps) {
  const { isDark } = useTheme();
  const compact = bands.length > 5;
  const barHeight = compact ? 14 : 16;
  const rowPadding = compact ? 2 : 3;

  return (
    <View testID={testID}>
      {bands.map((band) => {
        const filled = band.percent > EMPTY_BELOW_PERCENT;
        return (
          <View key={band.key} style={[styles.row, { paddingVertical: rowPadding }]}>
            <Text style={[styles.label, compact && styles.labelCompact, { color: band.colour }]}>
              {band.label}
            </Text>
            <Text
              style={[
                styles.percent,
                compact && styles.percentCompact,
                isDark && styles.textOnDark,
              ]}
            >
              {filled ? `${Math.round(band.percent)}%` : '-'}
            </Text>
            <View
              style={[
                styles.track,
                { height: barHeight, borderRadius: barHeight / 2 },
                isDark && styles.trackDark,
              ]}
            >
              <View
                style={[
                  styles.bar,
                  {
                    width: `${Math.min(band.percent, 100)}%`,
                    backgroundColor: band.colour,
                    borderRadius: barHeight / 2,
                  },
                ]}
              />
            </View>
            <View style={[styles.stats, compact && styles.statsCompact]}>
              <Text
                style={[
                  styles.primary,
                  compact && styles.primaryCompact,
                  isDark && styles.textOnDark,
                ]}
              >
                {filled ? (band.primary ?? '-') : '-'}
              </Text>
              {band.secondary != null && (
                <Text style={[styles.secondary, isDark && styles.secondaryDark]}>
                  {band.secondary}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    fontSize: typography.caption.fontSize,
    fontWeight: '700',
    width: 24,
  },
  labelCompact: {
    fontSize: typography.label.fontSize,
    width: 22,
  },
  percent: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    width: 32,
    textAlign: 'right',
    color: colors.textPrimary,
    marginRight: 6,
  },
  percentCompact: {
    fontSize: typography.micro.fontSize,
    width: 28,
    marginRight: spacing.xs,
  },
  textOnDark: {
    color: colors.textOnDark,
  },
  track: {
    flex: 1,
    backgroundColor: opacity.overlay.medium,
    borderRadius: layout.borderRadiusSm,
    overflow: 'hidden',
  },
  trackDark: {
    backgroundColor: opacity.overlayDark.medium,
  },
  bar: {
    height: '100%',
    borderRadius: layout.borderRadiusSm,
  },
  stats: {
    width: 75,
    marginLeft: 6,
    alignItems: 'flex-end',
  },
  statsCompact: {
    width: 65,
    marginLeft: spacing.xs,
  },
  primary: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  primaryCompact: {
    fontSize: typography.micro.fontSize,
  },
  secondary: {
    fontSize: typography.pillLabel.fontSize,
    color: colors.textSecondary,
  },
  secondaryDark: {
    color: darkColors.textSecondary,
  },
});
