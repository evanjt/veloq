import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, SegmentedButtons, Switch } from 'react-native-paper';
import { useTheme, useSummaryCardData } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDashboardPreferences, getMetricDefinition, type MetricId } from '@/providers';
import { SummaryCard } from '@/components/home';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

export function SummaryCardSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [showSummaryCardConfig, setShowSummaryCardConfig] = useState(false);

  const { summaryCard, setSummaryCardPreferences } = useDashboardPreferences();
  const summaryCardData = useSummaryCardData();

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.summaryCard').toUpperCase()}
      </Text>
      <View
        key={isDark ? 'dark' : 'light'}
        style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}
        testID="settings-summary-card"
      >
        {/* Live Preview using actual SummaryCard with real data */}
        <View style={styles.summaryCardPreview}>
          <SummaryCard
            profileUrl={summaryCardData.profileUrl}
            onProfilePress={() => {}}
            heroMetric={summaryCardData.heroMetric}
            heroValue={summaryCardData.heroValue}
            heroLabel={summaryCardData.heroLabel}
            heroColor={summaryCardData.heroColor}
            heroZoneLabel={summaryCardData.heroZoneLabel}
            heroZoneColor={summaryCardData.heroZoneColor}
            heroTrend={summaryCardData.heroTrend}
            fitnessData={summaryCardData.fitnessData}
            fatigueData={summaryCardData.fatigueData}
            formData={summaryCardData.formData}
            hrvData={summaryCardData.hrvData}
            rhrData={summaryCardData.rhrData}
            showSparkline={summaryCardData.showSparkline}
            showSparklineLabels
            supportingMetrics={summaryCardData.supportingMetrics}
          />
        </View>

        {/* Hero Metric Picker - always visible */}
        <View style={styles.summaryCardContainer}>
          <View style={styles.heroMetricHeader}>
            <Text style={[styles.summaryCardLabel, isDark && settingsStyles.textLight]}>
              {t('settings.heroMetric')}
            </Text>
            <View style={styles.sparklineToggleInline}>
              <Text style={[styles.sparklineToggleLabel, isDark && settingsStyles.textMuted]}>
                {t('settings.showSparkline')}
              </Text>
              <Switch
                testID="settings-summary-card-sparkline-toggle"
                value={summaryCard.showSparkline}
                onValueChange={(value) => setSummaryCardPreferences({ showSparkline: value })}
                color={colors.primary}
              />
            </View>
          </View>
          <SegmentedButtons
            value={summaryCard.heroMetric}
            onValueChange={(value) => setSummaryCardPreferences({ heroMetric: value as MetricId })}
            buttons={[
              { value: 'fitness', label: t('metrics.fitness') },
              { value: 'hrv', label: t('metrics.hrv') },
            ]}
            style={styles.summaryCardPicker}
          />
        </View>

        {/* Supporting Metrics - collapsible */}
        <TouchableOpacity
          style={[styles.actionRow, styles.actionRowBorder]}
          onPress={() => setShowSummaryCardConfig(!showSummaryCardConfig)}
        >
          <MaterialCommunityIcons name="tune-variant" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && settingsStyles.textLight]}>
            {t('settings.supportingMetrics')}
          </Text>
          <MaterialCommunityIcons
            name={showSummaryCardConfig ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>

        {showSummaryCardConfig && (
          <View style={styles.summaryCardContainer}>
            <Text style={[styles.summaryCardHint, isDark && settingsStyles.textMuted]}>
              {t('settings.maxMetricsHint')}
            </Text>

            {(
              [
                'fitness',
                'ftp',
                'weekHours',
                'weekCount',
                'form',
                'hrv',
                'rhr',
                'weight',
                'thresholdPace',
                'css',
              ] as MetricId[]
            ).map((metricId) => {
              const isEnabled = summaryCard.supportingMetrics.includes(metricId);
              const maxReached = summaryCard.supportingMetrics.length >= 4;
              const def = getMetricDefinition(metricId);
              if (!def) return null;

              return (
                <View
                  key={metricId}
                  style={[styles.summaryMetricRow, isDark && styles.summaryMetricRowDark]}
                >
                  <Text style={[styles.summaryMetricLabel, isDark && settingsStyles.textLight]}>
                    {t(def.labelKey as never)}
                  </Text>
                  <Switch
                    value={isEnabled}
                    disabled={!isEnabled && maxReached}
                    onValueChange={(enabled) => {
                      const current = summaryCard.supportingMetrics;
                      if (enabled && current.length < 4) {
                        setSummaryCardPreferences({
                          supportingMetrics: [...current, metricId],
                        });
                      } else if (!enabled) {
                        setSummaryCardPreferences({
                          supportingMetrics: current.filter((id) => id !== metricId),
                        });
                      }
                    }}
                    color={colors.primary}
                  />
                </View>
              );
            })}
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  summaryCardPreview: {
    marginHorizontal: -layout.screenPadding,
    paddingTop: spacing.sm,
  },
  summaryCardContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  heroMetricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  summaryCardLabel: {
    ...typography.bodySmall,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sparklineToggleInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sparklineToggleLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  summaryCardPicker: {
    // Handled by React Native Paper
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionText: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
  },
  summaryCardHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  summaryMetricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryMetricRowDark: {
    borderBottomColor: darkColors.border,
  },
  summaryMetricLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
