import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  useColorScheme,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
import * as WebBrowser from 'expo-web-browser';
import { colors, darkColors, opacity, typography, spacing, layout } from '@/theme';
import { formatDuration } from '@/lib';
import type { Activity, WellnessData } from '@/types';

// Explanations for each metric - educational, not interpretive
const METRIC_EXPLANATIONS: Record<string, string> = {
  'Training Load': 'Training Stress Score (TSS) quantifies training load based on duration and intensity relative to your threshold.',
  'Heart Rate': 'Average heart rate during the activity.',
  'Energy': 'Estimated energy expenditure from heart rate, power, and duration.',
  'Conditions': 'Temperature from weather data or your device sensor.',
  'Your Form': 'Your Form (TSB) on this day. This is a daily value based on your overall training, not specific to this activity. TSB = Fitness (CTL) minus Fatigue (ATL).',
  'Power': 'Average power output in watts.',
};

interface InsightfulStatsProps {
  activity: Activity;
  /** Wellness data for the activity date (for context) */
  wellness?: WellnessData | null;
  /** Recent activities for comparison */
  recentActivities?: Activity[];
}

interface StatDetail {
  title: string;
  value: string;
  icon: IconName;
  color: string;
  comparison?: {
    label: string;
    value: string;
    trend: 'up' | 'down' | 'same';
    isGood?: boolean;
  };
  context?: string;
  details?: { label: string; value: string }[];
  explanation?: string; // Educational text explaining what this metric means
}

export function InsightfulStats({
  activity,
  wellness,
  recentActivities = [],
}: InsightfulStatsProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [selectedStat, setSelectedStat] = useState<StatDetail | null>(null);

  // Calculate averages from recent activities of same type
  const sameTypeActivities = recentActivities.filter(a => a.type === activity.type);
  const avgLoad = sameTypeActivities.length > 0
    ? sameTypeActivities.reduce((sum, a) => sum + (a.icu_training_load || 0), 0) / sameTypeActivities.length
    : null;
  const avgIntensity = sameTypeActivities.length > 0
    ? sameTypeActivities.reduce((sum, a) => sum + (a.icu_intensity || 0), 0) / sameTypeActivities.length
    : null;
  const avgHR = sameTypeActivities.length > 0
    ? sameTypeActivities.reduce((sum, a) => sum + (a.average_heartrate || a.icu_average_hr || 0), 0) / sameTypeActivities.length
    : null;

  // Build insightful stats
  const stats: StatDetail[] = [];

  // Training Load with context
  if (activity.icu_training_load && activity.icu_training_load > 0) {
    const load = activity.icu_training_load;
    const loadComparison = avgLoad && avgLoad > 0
      ? {
          label: 'vs your avg',
          value: `${load > avgLoad ? '+' : ''}${Math.round(((load - avgLoad) / avgLoad) * 100)}%`,
          trend: load > avgLoad ? 'up' as const : load < avgLoad ? 'down' as const : 'same' as const,
          isGood: undefined, // Load being higher isn't inherently good or bad
        }
      : undefined;

    // Determine intensity level for color
    const intensity = activity.icu_intensity || 0;
    const loadColor = intensity > 100 ? colors.error
      : intensity > 85 ? '#FF9800'
      : intensity > 70 ? colors.chartYellow
      : colors.success;

    stats.push({
      title: 'Training Load',
      value: `${Math.round(load)}`,
      icon: 'lightning-bolt',
      color: loadColor,
      comparison: loadComparison,
      context: `IF ${Math.round(intensity)}%`,
      explanation: METRIC_EXPLANATIONS['Training Load'],
      details: [
        { label: 'Intensity Factor', value: `${Math.round(activity.icu_intensity || 0)}%` },
        activity.trimp ? { label: 'TRIMP', value: `${Math.round(activity.trimp)}` } : null,
        activity.strain_score ? { label: 'Strain', value: `${Math.round(activity.strain_score)}` } : null,
        wellness?.ctl ? { label: 'Your Fitness (CTL)', value: `${Math.round(wellness.ctl)}` } : null,
        wellness?.atl ? { label: 'Your Fatigue (ATL)', value: `${Math.round(wellness.atl)}` } : null,
      ].filter(Boolean) as { label: string; value: string }[],
    });
  }

  // Heart Rate with % of max context
  const avgHRValue = activity.average_heartrate || activity.icu_average_hr;
  const maxHRValue = activity.max_heartrate || activity.icu_max_hr;
  if (avgHRValue) {
    // Get athlete max HR from zones if available
    const athleteMaxHR = activity.icu_hr_zones?.[activity.icu_hr_zones.length - 1] || 200;
    const hrPercent = Math.round((avgHRValue / athleteMaxHR) * 100);

    const hrComparison = avgHR && avgHR > 0
      ? {
          label: 'vs typical',
          value: `${avgHRValue > avgHR ? '+' : ''}${Math.round(avgHRValue - avgHR)} bpm`,
          trend: avgHRValue > avgHR ? 'up' as const : avgHRValue < avgHR ? 'down' as const : 'same' as const,
          isGood: avgHRValue < avgHR, // Lower HR for same effort = fitter
        }
      : undefined;

    stats.push({
      title: 'Heart Rate',
      value: `${Math.round(avgHRValue)}`,
      icon: 'heart-pulse',
      color: hrPercent > 90 ? colors.error : hrPercent > 80 ? '#FF9800' : '#E91E63',
      comparison: hrComparison,
      context: `${hrPercent}% of max HR`,
      explanation: METRIC_EXPLANATIONS['Heart Rate'],
      details: [
        { label: 'Average', value: `${Math.round(avgHRValue)} bpm` },
        maxHRValue ? { label: 'Peak', value: `${Math.round(maxHRValue)} bpm` } : null,
        { label: '% of Max HR', value: `${hrPercent}%` },
        activity.icu_hrr ? { label: 'HR Recovery', value: `${activity.icu_hrr.hrr} bpm drop` } : null,
        wellness?.restingHR ? { label: 'Resting HR today', value: `${wellness.restingHR} bpm` } : null,
        wellness?.hrv ? { label: 'HRV today', value: `${Math.round(wellness.hrv)} ms` } : null,
      ].filter(Boolean) as { label: string; value: string }[],
    });
  }

  // Calories
  if (activity.calories && activity.calories > 0) {
    const calPerHour = Math.round((activity.calories / activity.moving_time) * 3600);
    stats.push({
      title: 'Energy',
      value: `${Math.round(activity.calories)}`,
      icon: 'fire',
      color: '#FF9800',
      context: `${calPerHour} kcal/hr`,
      explanation: METRIC_EXPLANATIONS['Energy'],
      details: [
        { label: 'Calories burned', value: `${Math.round(activity.calories)} kcal` },
        { label: 'Duration', value: formatDuration(activity.moving_time) },
        { label: 'Burn rate', value: `${calPerHour} kcal/hr` },
      ],
    });
  }

  // Temperature/Conditions
  const temp = activity.average_weather_temp ?? activity.average_temp;
  if (temp != null) {
    const isHot = temp > 28;
    const isCold = temp < 10;
    // Build context from available weather data
    const conditionParts: string[] = [];
    if (activity.average_feels_like != null && Math.abs(activity.average_feels_like - temp) >= 2) {
      conditionParts.push(`Feels ${Math.round(activity.average_feels_like)}°`);
    }
    if (activity.average_wind_speed != null && activity.average_wind_speed > 2) {
      conditionParts.push(`${(activity.average_wind_speed * 3.6).toFixed(0)} km/h wind`);
    }
    const contextStr = conditionParts.length > 0 ? conditionParts.join(', ') : (activity.has_weather ? 'Weather data' : 'Device sensor');

    stats.push({
      title: 'Conditions',
      value: `${Math.round(temp)}°`,
      icon: activity.has_weather ? 'weather-partly-cloudy' : 'thermometer',
      color: isHot ? '#FF9800' : isCold ? colors.chartBlue : colors.success,
      context: contextStr,
      explanation: METRIC_EXPLANATIONS['Conditions'],
      details: [
        { label: 'Temperature', value: `${Math.round(temp)}°C` },
        activity.average_feels_like != null ? { label: 'Feels like', value: `${Math.round(activity.average_feels_like)}°C` } : null,
        activity.average_wind_speed != null ? { label: 'Wind', value: `${(activity.average_wind_speed * 3.6).toFixed(0)} km/h` } : null,
      ].filter(Boolean) as { label: string; value: string }[],
    });
  }

  // Form from wellness (TSB = CTL - ATL)
  if (wellness?.ctl != null && wellness?.atl != null) {
    const tsb = wellness.ctl - wellness.atl;
    const formColor = tsb > 5 ? colors.success
      : tsb > -10 ? colors.chartYellow
      : colors.error;

    stats.push({
      title: 'Your Form',
      value: `${tsb > 0 ? '+' : ''}${Math.round(tsb)}`,
      icon: 'account-heart',
      color: formColor,
      context: 'Daily value',
      explanation: METRIC_EXPLANATIONS['Your Form'],
      details: [
        { label: 'Form (TSB)', value: `${tsb > 0 ? '+' : ''}${Math.round(tsb)}` },
        { label: 'Fitness (CTL)', value: `${Math.round(wellness.ctl)}` },
        { label: 'Fatigue (ATL)', value: `${Math.round(wellness.atl)}` },
        wellness.hrv ? { label: 'HRV', value: `${Math.round(wellness.hrv)} ms` } : null,
        wellness.sleepScore ? { label: 'Sleep Score', value: `${wellness.sleepScore}%` } : null,
      ].filter(Boolean) as { label: string; value: string }[],
    });
  }

  // Power - Average watts (includes eFTP, decoupling, efficiency in details)
  const avgPower = activity.average_watts || activity.icu_average_watts;
  if (avgPower && avgPower > 0) {
    const eftp = activity.icu_pm_ftp_watts;
    stats.push({
      title: 'Power',
      value: `${Math.round(avgPower)}`,
      icon: 'lightning-bolt-circle',
      color: '#9C27B0',
      context: eftp ? `eFTP ${Math.round(eftp)}W` : (activity.max_watts ? `Max ${Math.round(activity.max_watts)}W` : undefined),
      explanation: METRIC_EXPLANATIONS['Power'],
      details: [
        { label: 'Average', value: `${Math.round(avgPower)}W` },
        activity.max_watts ? { label: 'Max', value: `${Math.round(activity.max_watts)}W` } : null,
        activity.icu_ftp ? { label: '% of FTP', value: `${Math.round((avgPower / activity.icu_ftp) * 100)}%` } : null,
        eftp ? { label: 'eFTP (estimated)', value: `${Math.round(eftp)}W` } : null,
        activity.icu_efficiency_factor ? { label: 'Efficiency Factor', value: activity.icu_efficiency_factor.toFixed(2) } : null,
        activity.decoupling != null ? { label: 'Decoupling', value: `${activity.decoupling.toFixed(1)}%` } : null,
      ].filter(Boolean) as { label: string; value: string }[],
    });
  }

  const handleLongPress = useCallback((stat: StatDetail) => {
    setSelectedStat(stat);
  }, []);

  const closeModal = useCallback(() => {
    setSelectedStat(null);
  }, []);

  // Open activity in intervals.icu website
  const openInIntervalsICU = useCallback(async () => {
    const url = `https://intervals.icu/activities/${activity.id}`;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // Fallback to Linking if WebBrowser fails
      Linking.openURL(url);
    }
  }, [activity.id]);

  if (stats.length === 0) return null;

  return (
    <View style={[styles.container, isDark && styles.containerDark]}>
      <View style={styles.headerRow}>
        <Text style={[styles.sectionTitle, isDark && styles.textLight]}>
          Activity Stats
        </Text>
        <TouchableOpacity
          style={styles.intervalsLink}
          onPress={openInIntervalsICU}
          activeOpacity={0.7}
        >
          <Text style={styles.intervalsLinkText}>View in intervals.icu</Text>
          <MaterialCommunityIcons name="open-in-new" size={14} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.statsGrid}>
        {stats.map((stat, index) => (
          <Pressable
            key={index}
            onLongPress={() => handleLongPress(stat)}
            onPress={() => handleLongPress(stat)}
            delayLongPress={300}
            style={({ pressed }) => [
              styles.statCard,
              isDark && styles.statCardDark,
              pressed && styles.statCardPressed,
            ]}
          >
            {/* Icon with colored background */}
            <View style={[styles.iconContainer, { backgroundColor: `${stat.color}20` }]}>
              <MaterialCommunityIcons
                name={stat.icon}
                size={16}
                color={stat.color}
              />
            </View>

            {/* Value and title */}
            <View style={styles.statContent}>
              <Text style={[styles.statValue, isDark && styles.textLight]}>
                {stat.value}
              </Text>
              <Text style={styles.statTitle}>{stat.title}</Text>
            </View>

            {/* Comparison badge or context */}
            {stat.comparison ? (
              <View style={[
                styles.comparisonBadge,
                stat.comparison.isGood === true && styles.comparisonGood,
                stat.comparison.isGood === false && styles.comparisonBad,
              ]}>
                <MaterialCommunityIcons
                  name={stat.comparison.trend === 'up' ? 'arrow-up' : stat.comparison.trend === 'down' ? 'arrow-down' : 'minus'}
                  size={10}
                  color={stat.comparison.isGood === true ? colors.success : stat.comparison.isGood === false ? colors.error : colors.textSecondary}
                />
                <Text style={[
                  styles.comparisonText,
                  stat.comparison.isGood === true && styles.comparisonTextGood,
                  stat.comparison.isGood === false && styles.comparisonTextBad,
                ]}>
                  {stat.comparison.value}
                </Text>
              </View>
            ) : stat.context ? (
              <Text style={styles.contextText} numberOfLines={1}>
                {stat.context}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>

      {/* Detail Modal */}
      <Modal
        visible={selectedStat !== null}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <Pressable style={styles.modalOverlay} onPress={closeModal}>
          <View style={[styles.modalContent, isDark && styles.modalContentDark]}>
            {selectedStat && (
              <>
                {/* Header */}
                <View style={styles.modalHeader}>
                  <View style={[styles.modalIconContainer, { backgroundColor: `${selectedStat.color}20` }]}>
                    <MaterialCommunityIcons
                      name={selectedStat.icon}
                      size={28}
                      color={selectedStat.color}
                    />
                  </View>
                  <View style={styles.modalHeaderText}>
                    <Text style={[styles.modalValue, isDark && styles.textLight]}>
                      {selectedStat.value}
                    </Text>
                    <Text style={[styles.modalTitle, isDark && styles.textLight]}>
                      {selectedStat.title}
                    </Text>
                  </View>
                </View>

                {/* Context */}
                {selectedStat.context && (
                  <View style={[styles.contextBanner, { backgroundColor: `${selectedStat.color}15` }]}>
                    <Text style={[styles.contextBannerText, { color: selectedStat.color }]}>
                      {selectedStat.context}
                    </Text>
                  </View>
                )}

                {/* Explanation - What does this mean? */}
                {selectedStat.explanation && (
                  <View style={styles.explanationBox}>
                    <View style={styles.explanationHeader}>
                      <MaterialCommunityIcons name="information-outline" size={16} color={colors.textSecondary} />
                      <Text style={styles.explanationTitle}>What is this?</Text>
                    </View>
                    <Text style={styles.explanationText}>{selectedStat.explanation}</Text>
                  </View>
                )}

                {/* Details */}
                {selectedStat.details && selectedStat.details.length > 0 && (
                  <View style={styles.detailsList}>
                    {selectedStat.details.map((detail, i) => (
                      <View key={i} style={styles.detailRow}>
                        <Text style={styles.detailLabel}>{detail.label}</Text>
                        <Text style={[styles.detailValue, isDark && styles.textLight]}>
                          {detail.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Comparison */}
                {selectedStat.comparison && (
                  <View style={styles.comparisonSection}>
                    <Text style={styles.comparisonLabel}>
                      {selectedStat.comparison.label}
                    </Text>
                    <View style={[
                      styles.comparisonLarge,
                      selectedStat.comparison.isGood === true && styles.comparisonGood,
                      selectedStat.comparison.isGood === false && styles.comparisonBad,
                    ]}>
                      <MaterialCommunityIcons
                        name={selectedStat.comparison.trend === 'up' ? 'trending-up' : selectedStat.comparison.trend === 'down' ? 'trending-down' : 'minus'}
                        size={18}
                        color={selectedStat.comparison.isGood === true ? colors.success : selectedStat.comparison.isGood === false ? colors.error : colors.textSecondary}
                      />
                      <Text style={[
                        styles.comparisonLargeText,
                        selectedStat.comparison.isGood === true && styles.comparisonTextGood,
                        selectedStat.comparison.isGood === false && styles.comparisonTextBad,
                      ]}>
                        {selectedStat.comparison.value}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Close hint */}
                <Text style={styles.closeHint}>Tap anywhere to close</Text>
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: spacing.md,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
  },
  containerDark: {
    backgroundColor: darkColors.surface,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  intervalsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  intervalsLinkText: {
    fontSize: typography.caption.fontSize,
    color: colors.primary,
    fontWeight: '500',
  },
  textLight: {
    color: colors.textOnDark,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    width: '31%', // 3 columns with gaps
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 10,
    position: 'relative',
  },
  statCardDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  statCardPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  statContent: {
    marginBottom: 2,
  },
  statValue: {
    fontSize: typography.metricValue.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statTitle: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },
  comparisonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: opacity.overlay.light,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: layout.borderRadiusSm,
    alignSelf: 'flex-start',
  },
  comparisonGood: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  comparisonBad: {
    backgroundColor: 'rgba(244, 67, 54, 0.15)',
  },
  comparisonText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  comparisonTextGood: {
    color: colors.success,
  },
  comparisonTextBad: {
    color: colors.error,
  },
  contextText: {
    fontSize: typography.micro.fontSize,
    color: colors.textSecondary,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 340,
  },
  modalContentDark: {
    backgroundColor: darkColors.surface,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  modalIconContainer: {
    width: 56,
    height: 56,
    borderRadius: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  modalHeaderText: {
    flex: 1,
  },
  modalValue: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalTitle: {
    fontSize: typography.body.fontSize,
    color: colors.textSecondary,
  },
  contextBanner: {
    padding: spacing.sm,
    borderRadius: 10,
    marginBottom: spacing.md,
  },
  contextBannerText: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    textAlign: 'center',
  },
  explanationBox: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  explanationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.xs,
  },
  explanationTitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  explanationText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  detailsList: {
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: opacity.overlay.light,
  },
  detailLabel: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
  },
  detailValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  comparisonSection: {
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  comparisonLabel: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  comparisonLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: opacity.overlay.light,
    paddingHorizontal: layout.borderRadius,
    paddingVertical: 6,
    borderRadius: layout.borderRadius,
  },
  comparisonLargeText: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  closeHint: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
    opacity: 0.6,
  },
});
