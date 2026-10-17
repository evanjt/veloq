import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { colors, darkColors, layout, opacity, spacing, typography, zoneColour } from '@/theme';
import { ABSENT, absentLabel } from '@/shared/format/absent';
import { DenseText, denseExtent } from '@/shared/ui/DenseText';

import { ChartSurface } from './ChartSurface';
import { partsSummary, partsTable, type SummaryPart } from './chartSummary';

/** One bar of a zone histogram. */
export interface ZoneBand {
  key: string | number;
  label: string;
  /** The training zone, 1 to 7, which picks the bar's fill and the label's tone. */
  zone: number;
  /** Seconds in the zone, which set the bar's length. */
  seconds: number;
  /** The engine's whole-percent share of the time, printed as it is. */
  share: number;
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

/** Column widths in ems of their own text: a zone name, a share up to "100%", a time and its range. */
const LABEL_EMS = 1.6;
const PERCENT_EMS = 2.5;
const STATS_EMS = 5.2;

/** Horizontal bars, one per zone, with the share on the left and the time and range on the right. */
export function ZoneHistogram({ title, bands, testID }: ZoneHistogramProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // Each zone named in full with its time and share. An empty zone is listed in the table and
  // left out of the sentence.
  const reading = useMemo(() => {
    const parts = bands.map((band): SummaryPart & { filled: boolean } => {
      const filled = band.share > 0;
      return {
        label: band.secondary != null ? `${band.label} ${band.secondary}` : band.label,
        value: filled ? `${band.primary ?? ABSENT} (${band.share}%)` : ABSENT,
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

  const totalSeconds = bands.reduce((sum, band) => sum + band.seconds, 0);
  const compact = bands.length > 5;
  const barHeight = compact ? 14 : 16;
  const rowPadding = compact ? 2 : 3;

  return (
    <ChartSurface summary={reading.summary} table={reading.table} style={styles.plot}>
      <View testID={testID}>
        {bands.map((band) => {
          // A band the engine gives no whole share reads as empty.
          const filled = band.share > 0;
          const share = filled ? `${band.share}%` : ABSENT;
          const length = totalSeconds > 0 ? (band.seconds / totalSeconds) * 100 : 0;
          const primary = filled ? (band.primary ?? ABSENT) : ABSENT;
          return (
            <View key={band.key} style={[styles.row, { paddingVertical: rowPadding }]}>
              <DenseText
                style={[
                  styles.label,
                  compact && styles.labelCompact,
                  { color: zoneColour(band.zone, isDark, 'text') },
                ]}
              >
                {band.label}
              </DenseText>
              <DenseText
                style={[
                  styles.percent,
                  compact && styles.percentCompact,
                  isDark && styles.textOnDark,
                ]}
                accessibilityLabel={absentLabel(share, t)}
              >
                {share}
              </DenseText>
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
                      width: `${Math.min(length, 100)}%`,
                      backgroundColor: zoneColour(band.zone, isDark, 'fill'),
                      borderRadius: barHeight / 2,
                    },
                  ]}
                />
              </View>
              <View style={[styles.stats, compact && styles.statsCompact]}>
                <DenseText
                  style={[
                    styles.primary,
                    compact && styles.primaryCompact,
                    isDark && styles.textOnDark,
                  ]}
                  accessibilityLabel={absentLabel(primary, t)}
                >
                  {primary}
                </DenseText>
                {band.secondary != null && (
                  <DenseText style={[styles.secondary, isDark && styles.secondaryDark]}>
                    {band.secondary}
                  </DenseText>
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
    width: denseExtent(typography.caption.fontSize, LABEL_EMS),
  },
  labelCompact: {
    fontSize: typography.label.fontSize,
    width: denseExtent(typography.label.fontSize, LABEL_EMS),
  },
  percent: {
    ...typography.badge,
    width: denseExtent(typography.badge.fontSize, PERCENT_EMS),
    textAlign: 'right',
    color: colors.textPrimary,
    marginRight: spacing.xsPlus,
  },
  percentCompact: {
    fontSize: typography.micro.fontSize,
    width: denseExtent(typography.micro.fontSize, PERCENT_EMS),
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
    width: denseExtent(typography.badge.fontSize, STATS_EMS),
    marginLeft: spacing.xsPlus,
    alignItems: 'flex-end',
  },
  statsCompact: {
    width: denseExtent(typography.micro.fontSize, STATS_EMS),
    marginLeft: spacing.xs,
  },
  primary: {
    ...typography.badge,
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
