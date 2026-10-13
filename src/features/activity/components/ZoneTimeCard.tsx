import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography, spacing } from '@/theme';
import { ZoneHistogram, type ZoneBand } from '@/shared/charts';
import { ChartErrorBoundary, CardHeader } from '@/shared/ui';
import { formatDurationHuman } from '@/shared/format/format';

/** One zone as the engine resolved it, in the unit the card's formatter prints. */
export interface ZoneTimeBand {
  zone: number;
  min: number;
  /** Absent for an open top zone */
  max?: number | undefined;
  seconds: number;
  percent: number;
}

interface ZoneTimeCardProps {
  title: string;
  /** The reference the bands are drawn against, already formatted with its unit */
  headerLabel?: string | undefined;
  /** Lines under the header that qualify the reference, such as an assumed default */
  notes?: readonly string[] | undefined;
  /** The totals line's label for the time spent in the zones */
  zoneTotalLabel: (duration: string) => string;
  movingTime: number;
  bands: readonly ZoneTimeBand[];
  /** The range a zone covers with its unit once, the upper edge null for an open top zone */
  formatRange: (min: number, max: number | null) => string;
  chartName: string;
}

/** Time in each zone of one activity, with the range each zone covers. */
export function ZoneTimeCard({
  title,
  headerLabel,
  notes,
  zoneTotalLabel,
  movingTime,
  bands,
  formatRange,
  chartName,
}: ZoneTimeCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  if (bands.length === 0) return null;

  const zoneTotal = bands.reduce((total, band) => total + band.seconds, 0);
  const histogram: ZoneBand[] = bands.map((band) => ({
    key: `Z${band.zone}`,
    label: `Z${band.zone}`,
    zone: band.zone,
    percent: band.percent,
    primary: formatDurationHuman(band.seconds),
    secondary: formatRange(band.min, band.max ?? null),
  }));

  return (
    <ChartErrorBoundary height={200} chartName={chartName}>
      <View style={styles.container}>
        <CardHeader
          title={title}
          accessory={
            headerLabel != null ? (
              <Text style={[styles.label, isDark && styles.labelDark]}>{headerLabel}</Text>
            ) : null
          }
        />
        {notes != null && notes.length > 0 && (
          <View style={styles.notes}>
            {notes.map((note) => (
              <Text key={note} style={[styles.label, isDark && styles.labelDark]}>
                {note}
              </Text>
            ))}
          </View>
        )}
        <View style={styles.totalsRow}>
          <Text style={[styles.label, isDark && styles.labelDark]}>
            {zoneTotalLabel(formatDurationHuman(zoneTotal))}
          </Text>
          <Text style={[styles.label, isDark && styles.labelDark]}>
            {t('activity.movingTime', { duration: formatDurationHuman(movingTime) })}
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
  label: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  notes: {
    marginBottom: spacing.sm,
  },
  totalsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
});
