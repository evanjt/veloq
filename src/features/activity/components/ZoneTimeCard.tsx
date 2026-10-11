import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography, spacing } from '@/theme';
import { ZoneHistogram, type ZoneBand } from '@/shared/charts';
import { ChartErrorBoundary } from '@/shared/ui';
import { formatDuration, formatDurationHuman } from '@/shared/format/format';

/** One zone as the engine resolved it, in the unit the card's formatter prints. */
export interface ZoneTimeBand {
  zone: number;
  min: number;
  /** Absent for an open top zone */
  max?: number | undefined;
  seconds: number;
  percent: number;
}

/**
 * The range a zone covers: both edges and the unit once, or the lower edge and a
 * plus for an open top zone.
 */
export function zoneRangeLabel(band: ZoneTimeBand, format: (value: number) => string): string {
  if (band.max == null) return `${format(band.min)}+`;
  return `${Math.round(band.min)}-${format(band.max)}`;
}

interface ZoneTimeCardProps {
  title: string;
  /** The reference the bands are drawn against, already formatted with its unit */
  headerLabel?: string | undefined;
  /** The totals line's label for the time spent in the zones */
  zoneTotalLabel: (duration: string) => string;
  movingTime: number;
  bands: readonly ZoneTimeBand[];
  colours: readonly string[];
  formatEdge: (value: number) => string;
  chartName: string;
}

/** Time in each zone of one activity, with the range each zone covers. */
export function ZoneTimeCard({
  title,
  headerLabel,
  zoneTotalLabel,
  movingTime,
  bands,
  colours,
  formatEdge,
  chartName,
}: ZoneTimeCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  if (bands.length === 0) return null;

  const zoneTotal = bands.reduce((total, band) => total + band.seconds, 0);
  const histogram: ZoneBand[] = bands.map((band) => ({
    key: `Z${band.zone}`,
    label: `Z${band.zone}`,
    colour: colours[band.zone - 1] ?? colours[colours.length - 1],
    percent: band.percent,
    primary: formatDurationHuman(band.seconds),
    secondary: zoneRangeLabel(band, formatEdge),
  }));

  return (
    <ChartErrorBoundary height={200} chartName={chartName}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, isDark && styles.titleDark]}>{title}</Text>
          {headerLabel != null && (
            <Text style={[styles.label, isDark && styles.labelDark]}>{headerLabel}</Text>
          )}
        </View>
        <View style={styles.totalsRow}>
          <Text style={[styles.label, isDark && styles.labelDark]}>
            {zoneTotalLabel(formatDuration(zoneTotal))}
          </Text>
          <Text style={[styles.label, isDark && styles.labelDark]}>
            {t('activity.movingTime', { duration: formatDuration(movingTime) })}
          </Text>
        </View>
        <ZoneHistogram bands={histogram} />
      </View>
    </ChartErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleDark: {
    color: colors.textOnDark,
  },
  label: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  totalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
});
