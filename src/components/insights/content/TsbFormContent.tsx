import React, { useMemo } from 'react';
import { View, StyleSheet, Pressable, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { useWellness } from '@/hooks/fitness/useWellness';
import { navigateTo } from '@/lib';
import { getFormZone, FORM_ZONE_COLORS, FORM_ZONE_LABELS } from '@/lib/algorithms/fitness';
import { SummaryCardSparkline } from '@/components/home/SummaryCardSparkline';
import { colors, darkColors, spacing, opacity } from '@/theme';
import type { Insight } from '@/types';

const CHART_WIDTH = Dimensions.get('window').width - spacing.lg * 4;

interface TsbFormContentProps {
  insight: Insight;
  onClose: () => void;
}

export const TsbFormContent = React.memo(function TsbFormContent({
  insight,
  onClose,
}: TsbFormContentProps) {
  const { isDark } = useTheme();
  const { data: wellnessData } = useWellness('1m');

  // Extract CTL/ATL/TSB arrays from wellness
  const { fitnessData, fatigueData, formData } = useMemo(() => {
    if (!wellnessData || wellnessData.length === 0) {
      return { fitnessData: [], fatigueData: [], formData: [] };
    }
    const fitness: number[] = [];
    const fatigue: number[] = [];
    const form: number[] = [];
    for (const day of wellnessData) {
      const ctl = day.ctl ?? day.ctlLoad ?? 0;
      const atl = day.atl ?? day.atlLoad ?? 0;
      fitness.push(ctl);
      fatigue.push(atl);
      form.push(ctl - atl);
    }
    return { fitnessData: fitness, fatigueData: fatigue, formData: form };
  }, [wellnessData]);

  // Get current values from insight data
  const tsbPoint = insight.supportingData?.dataPoints?.find((dp) => dp.label === 'TSB');
  const ctlPoint = insight.supportingData?.dataPoints?.find((dp) => dp.label === 'CTL');
  const atlPoint = insight.supportingData?.dataPoints?.find((dp) => dp.label === 'ATL');

  const tsbValue = typeof tsbPoint?.value === 'number' ? tsbPoint.value : 0;
  const ctlValue = typeof ctlPoint?.value === 'number' ? ctlPoint.value : 0;
  const atlValue = typeof atlPoint?.value === 'number' ? atlPoint.value : 0;
  const zone = getFormZone(tsbValue);
  const zoneColor = FORM_ZONE_COLORS[zone];
  const zoneLabel = FORM_ZONE_LABELS[zone];

  const handleViewFitness = () => {
    onClose();
    navigateTo('/fitness');
  };

  return (
    <View style={styles.container}>
      {/* TSB value + zone */}
      <View style={[styles.statCard, isDark && styles.statCardDark]}>
        <Text style={[styles.tsbValue, { color: zoneColor }]}>{tsbValue}</Text>
        <View style={[styles.zoneBadge, { backgroundColor: `${zoneColor}20` }]}>
          <View style={[styles.zoneDot, { backgroundColor: zoneColor }]} />
          <Text style={[styles.zoneLabel, { color: zoneColor }]}>{zoneLabel}</Text>
        </View>
      </View>

      {/* CTL / ATL row */}
      <View style={styles.metricsRow}>
        <View style={[styles.metricBox, isDark && styles.metricBoxDark]}>
          <Text style={[styles.metricLabel, isDark && styles.metricLabelDark]}>Fitness (CTL)</Text>
          <Text style={[styles.metricValue, isDark && styles.metricValueDark]}>{ctlValue}</Text>
        </View>
        <View style={[styles.metricBox, isDark && styles.metricBoxDark]}>
          <Text style={[styles.metricLabel, isDark && styles.metricLabelDark]}>Fatigue (ATL)</Text>
          <Text style={[styles.metricValue, isDark && styles.metricValueDark]}>{atlValue}</Text>
        </View>
      </View>

      {/* Sparkline chart */}
      {fitnessData.length > 0 ? (
        <View style={[styles.chartCard, isDark && styles.chartCardDark]}>
          <Text style={[styles.chartLabel, isDark && styles.chartLabelDark]}>30-day trend</Text>
          <SummaryCardSparkline
            fitnessData={fitnessData}
            fatigueData={fatigueData}
            formData={formData}
            width={CHART_WIDTH}
          />
        </View>
      ) : null}

      {/* View fitness link */}
      <Pressable style={[styles.navLink, isDark && styles.navLinkDark]} onPress={handleViewFitness}>
        <Text style={[styles.navLinkText, isDark && styles.navLinkTextDark]}>View fitness</Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={18}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  statCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.md,
    alignItems: 'center',
  },
  statCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  tsbValue: {
    fontSize: 36,
    fontWeight: '700',
  },
  zoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: spacing.xs,
    gap: 6,
  },
  zoneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  zoneLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricBox: {
    flex: 1,
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    alignItems: 'center',
  },
  metricBoxDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  metricLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  metricLabelDark: {
    color: darkColors.textSecondary,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metricValueDark: {
    color: darkColors.textPrimary,
  },
  chartCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
  },
  chartCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  chartLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  chartLabelDark: {
    color: darkColors.textSecondary,
  },
  navLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: opacity.overlay.subtle,
  },
  navLinkDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  navLinkText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  navLinkTextDark: {
    color: darkColors.textPrimary,
  },
});
