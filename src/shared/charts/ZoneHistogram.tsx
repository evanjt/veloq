import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, opacity, spacing, typography, zoneColour } from '@/theme';
import { ABSENT, absentLabel } from '@/shared/format/absent';

import { ChartSurface } from './ChartSurface';
import { partsSummary, partsTable, type SummaryPart } from './chartSummary';

/** One bar of a zone histogram. `percent` is of the whole, 0 to 100. */
export interface ZoneBand {
  key: string | number;
  label: string;
  /** The training zone, 1 to 7, which picks the bar's fill and the label's tone. */
  zone: number;
  percent: number;
  /** Bold value beside the bar, the time in zone. */
  primary?: string;
  /** Muted value beneath it, the zone's range. */
  secondary?: string;
}

interface ZoneHistogramProps {
  /** Names the chart in its spoken summary and its Show data sheet. */
  title: string;
  bands: readonly ZoneBand[];
  testID?: string;
}

/** Below this share a band reads as empty and its numbers are replaced by the absent mark. */
const EMPTY_BELOW_PERCENT = 0.5;

/** Horizontal bars, one per zone, with the share on the left and the time and range on the right. */
export function ZoneHistogram({ title, bands, testID }: ZoneHistogramProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // Each zone named in full with its time and share. An empty zone is listed in the table and
  // left out of the sentence.
  const reading = useMemo(() => {
    const parts = bands.map((band): SummaryPart & { filled: boolean } => {
      const filled = band.percent > EMPTY_BELOW_PERCENT;
      return {
        label: band.secondary != null ? `${band.label} ${band.secondary}` : band.label,
        value: filled ? `${band.primary ?? ABSENT} (${Math.round(band.percent)}%)` : ABSENT,
        filled,
      };
    });
    return {
      summary: partsSummary(
        title,
        parts.filter((part) => part.filled),
        t
      ),
      table: partsTable(title, t('charts.column.zone'), t('charts.column.time'), parts),
    };
  }, [bands, title, t]);

  const compact = bands.length > 5;
  const barHeight = compact ? 14 : 16;
  const rowPadding = compact ? 2 : 3;

  return (
    <ChartSurface summary={reading.summary} table={reading.table} style={styles.plot}>
      <View testID={testID}>
        {bands.map((band) => {
          const filled = band.percent > EMPTY_BELOW_PERCENT;
          const share = filled ? `${Math.round(band.percent)}%` : ABSENT;
          const primary = filled ? (band.primary ?? ABSENT) : ABSENT;
          return (
            <View key={band.key} style={[styles.row, { paddingVertical: rowPadding }]}>
              <Text
                style={[
                  styles.label,
                  compact && styles.labelCompact,
                  { color: zoneColour(band.zone, isDark, 'text') },
                ]}
              >
                {band.label}
              </Text>
              <Text
                style={[
                  styles.percent,
                  compact && styles.percentCompact,
                  isDark && styles.textOnDark,
                ]}
                accessibilityLabel={absentLabel(share, t)}
              >
                {share}
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
                      backgroundColor: zoneColour(band.zone, isDark, 'fill'),
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
                  accessibilityLabel={absentLabel(primary, t)}
                >
                  {primary}
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
    </ChartSurface>
  );
}

const styles = StyleSheet.create({
  // The rows set their own height, so the surface is sized by them rather than filling.
  plot: {
    flex: 0,
  },
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
    marginRight: spacing.xsPlus,
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
    marginLeft: spacing.xsPlus,
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
