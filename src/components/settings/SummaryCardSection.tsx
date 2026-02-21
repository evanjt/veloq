import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, SegmentedButtons, Switch } from 'react-native-paper';
import { useTheme, useSummaryCardData } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDashboardPreferences, getMetricDefinition, type MetricId } from '@/providers';
import { SummaryCard } from '@/components/home';
import { colors, darkColors, spacing, layout } from '@/theme';

export function SummaryCardSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [showSummaryCardConfig, setShowSummaryCardConfig] = useState(false);

  const { summaryCard, setSummaryCardPreferences } = useDashboardPreferences();
  const summaryCardData = useSummaryCardData();

  return (
    <>
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('settings.summaryCard').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        {/* Live Preview using actual SummaryCard with real data */}
        <View style={styles.summaryCardPreview}>
          <SummaryCard
            profileUrl={summaryCardData.profileUrl}
            onProfilePress={() => {}}
            heroValue={summaryCardData.heroValue}
            heroLabel={summaryCardData.heroLabel}
            heroColor={summaryCardData.heroColor}
            heroZoneLabel={summaryCardData.heroZoneLabel}
            heroZoneColor={summaryCardData.heroZoneColor}
            heroTrend={summaryCardData.heroTrend}
            fitnessData={summaryCardData.fitnessData}
            formData={summaryCardData.formData}
            showSparkline={summaryCardData.showSparkline}
            showSparklineLabels
            supportingMetrics={summaryCardData.supportingMetrics}
          />
        </View>

        {/* Hero Metric Picker - always visible */}
        <View style={styles.summaryCardContainer}>
          <View style={styles.heroMetricHeader}>
            <Text style={[styles.summaryCardLabel, isDark && styles.textLight]}>
              {t('settings.heroMetric')}
            </Text>
            <View style={styles.sparklineToggleInline}>
              <Text style={[styles.sparklineToggleLabel, isDark && styles.textMuted]}>
                {t('settings.showSparkline')}
              </Text>
              <Switch
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
          <Text style={[styles.actionText, isDark && styles.textLight]}>
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
            <Text style={[styles.summaryCardHint, isDark && styles.textMuted]}>
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
                  <Text style={[styles.summaryMetricLabel, isDark && styles.textLight]}>
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
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
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
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sparklineToggleInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sparklineToggleLabel: {
    fontSize: 12,
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
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  summaryCardHint: {
    fontSize: 12,
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
    fontSize: 15,
    color: colors.textPrimary,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
