import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/shared/app';
import { useTranslation } from 'react-i18next';
import {
  useDashboardPreferences,
  getMetricDefinition,
  HERO_METRICS,
  isHeroMetricId,
  type HeroMetricId,
  type MetricId,
} from '../stores/summaryCardPreferences';
import { useSummaryCardData, SummaryCard } from '@/features/home';
import {
  colors,
  darkColors,
  iconSize,
  layout,
  type Palette,
  spacing,
  themedStyles,
  typography,
  stroke,
  themePalette,
} from '@/theme';
import { Row, SwitchRow, ToggleButtonRow } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { RowDivider } from '@/shared/ui/RowGroup';
import { settingsStyles } from './settingsStyles';

const HERO_LABEL_KEYS = {
  fitness: 'metrics.fitness',
  form: 'metrics.form',
  hrv: 'metrics.hrv',
} as const satisfies Record<HeroMetricId, string>;

export function SummaryCardSection() {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const styles = themedStyles(makeStyles, isDark);
  const { t } = useTranslation();
  const { summaryCard, setSummaryCardPreferences } = useDashboardPreferences();
  const summaryCardData = useSummaryCardData();

  return (
    <>
      <View
        key={isDark ? 'dark' : 'light'}
        style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}
        testID="settings-summary-card"
      >
        <SwitchRow
          title={t('settings.showSummaryCard')}
          value={summaryCard.enabled}
          onValueChange={(value) => setSummaryCardPreferences({ enabled: value })}
          testID="settings-summary-card-enabled-toggle"
        />

        {/* Live Preview using actual SummaryCard with real data */}
        <View style={styles.summaryCardPreview}>
          <SummaryCard
            profileUrl={summaryCardData.profileUrl}
            onProfilePress={() => {}}
            heroMetric={summaryCardData.heroMetric}
            heroValue={summaryCardData.heroValue}
            heroLabel={summaryCardData.heroLabel}
            heroKeyColor={summaryCardData.heroKeyColor}
            heroZone={summaryCardData.heroZone}
            heroTrend={summaryCardData.heroTrend}
            heroAccessibilityLabel={summaryCardData.heroAccessibilityLabel}
            fitnessData={summaryCardData.fitnessData}
            fitnessDelta={summaryCardData.fitnessDelta}
            fitnessRiseDays={summaryCardData.fitnessRiseDays}
            fatigueData={summaryCardData.fatigueData}
            formData={summaryCardData.formData}
            hrvData={summaryCardData.hrvData}
            rhrData={summaryCardData.rhrData}
            hrvRead={summaryCardData.hrvRead}
            rhrRead={summaryCardData.rhrRead}
            showSparkline={summaryCardData.showSparkline}
            showSparklineLabels
            supportingMetrics={summaryCardData.supportingMetrics}
          />
        </View>

        {/* Hero Metric Picker - always visible */}
        <View style={styles.summaryCardContainer}>
          <SwitchRow
            inset="none"
            title={t('settings.showSparkline')}
            value={summaryCard.showSparkline}
            onValueChange={(value) => setSummaryCardPreferences({ showSparkline: value })}
            testID="settings-summary-card-sparkline-toggle"
          />
          <Text style={[styles.summaryCardLabel, isDark && settingsStyles.textLight]}>
            {t('settings.heroMetric')}
          </Text>
          <ToggleButtonRow
            value={summaryCard.heroMetric}
            onValueChange={(value) => {
              if (isHeroMetricId(value)) setSummaryCardPreferences({ heroMetric: value });
            }}
            options={HERO_METRICS.map((hero) => ({ value: hero, label: t(HERO_LABEL_KEYS[hero]) }))}
          />
        </View>

        {/* Supporting Metrics */}
        <RowDivider />
        <Row>
          <Icon name="tune-variant" size={iconSize.md} color={palette.actionPrimary} />
          <Text style={[styles.actionText, isDark && settingsStyles.textLight]}>
            {t('settings.supportingMetrics')}
          </Text>
        </Row>

        <View style={styles.summaryCardContainer}>
          <Text style={styles.summaryCardHint}>{t('settings.maxMetricsHint')}</Text>

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
                <SwitchRow
                  inset="none"
                  title={t(def.labelKey as never)}
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
                />
              </View>
            );
          })}
        </View>
      </View>
    </>
  );
}

const makeStyles = (palette: Palette) =>
  StyleSheet.create({
    summaryCardPreview: {
      marginHorizontal: -layout.screenPadding,
      paddingTop: spacing.sm,
    },
    summaryCardContainer: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.md,
    },
    summaryCardLabel: {
      ...typography.bodySmallBold,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
      color: colors.textPrimary,
    },
    actionText: {
      ...typography.body,
      flex: 1,
      color: colors.textPrimary,
    },
    summaryCardHint: {
      ...typography.caption,
      color: palette.textSecondary,
      marginBottom: spacing.sm,
    },
    summaryMetricRow: {
      borderBottomWidth: stroke.one,
      borderBottomColor: palette.border,
    },
    summaryMetricRowDark: {
      borderBottomColor: darkColors.border,
    },
  });
