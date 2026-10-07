import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, typography, spacing } from '@/theme';
import { ZoneHistogram, type ZoneBand } from '@/shared/charts';
import { HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
import type { HrZoneBand } from 'veloqrs';
import { ChartErrorBoundary } from '@/shared/ui';
import { formatDurationHuman } from '@/shared/format/format';
import { DEFAULT_MAX_HR } from '../lib/hrZones';

interface HRZonesChartProps {
  /** The bands and time in each, resolved by the engine with the live classifier */
  hrZones?: HrZoneBand[] | undefined;
  /** The max HR from the detail screen read, the one the heart rate stat card divides by */
  maxHR?: number | undefined;
}

export function HRZonesChart({ hrZones, maxHR: engineMaxHR }: HRZonesChartProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const maxHR = engineMaxHR ?? DEFAULT_MAX_HR;
  const zoneData = hrZones && hrZones.length > 0 ? hrZones : null;

  if (!zoneData) {
    return (
      <View style={styles.placeholder}>
        <Text style={[styles.placeholderText, isDark && styles.textDark]}>
          {t('activity.noHeartRateData')}
        </Text>
      </View>
    );
  }

  const bands: ZoneBand[] = zoneData.map((zone) => ({
    key: zone.zone,
    label: `Z${zone.zone}`,
    colour: HR_ZONE_COLORS[zone.zone - 1] ?? HR_ZONE_COLORS[HR_ZONE_COLORS.length - 1],
    percent: zone.percent,
    primary: formatDurationHuman(zone.seconds),
    secondary: `${zone.minBpm}-${zone.maxBpm}`,
  }));

  return (
    <ChartErrorBoundary height={200} label="Heart Rate Zones">
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('activity.timeInHRZones')}
          </Text>
          <Text style={[styles.maxHRLabel, isDark && styles.maxHRLabelDark]}>
            {t('activity.maxHR', { value: maxHR })}
          </Text>
        </View>
        <ZoneHistogram bands={bands} />
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
  maxHRLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
  },
  maxHRLabelDark: {
    color: darkColors.textSecondary,
  },
  placeholder: {
    minHeight: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
