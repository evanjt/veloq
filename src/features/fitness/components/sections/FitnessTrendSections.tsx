import React from 'react';
import { curveHeaderValue } from '@/features/fitness/lib/curveHeaderValue';
import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CollapsibleSection } from '@/shared/ui';
import { ZoneDistributionChart, FTPTrendChart, DecouplingChart } from '@/features/stats';
import { type DecouplingSource } from '@/features/activity';
import { useTheme } from '@/shared/app';
import {
  SPORT_TEXT_COLORS,
  SPORT_TEXT_COLORS_DARK,
  type PrimarySport,
} from '@/features/fitness/stores';
import { formatPaceCompact, paceUnitLabel } from '@/shared/format/format';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { PERIOD_LABEL_KEYS } from '@/shared/app/period';
import { colors, darkColors, spacing, layout, typography, opacity, verdictColor } from '@/theme';
import { trendIcon, trendVerdict, verdictRung, type TrendDirection } from '@/shared/format/trend';
import { type TimeRange } from '@/features/wellness';
import type { ZoneDistribution } from '@/types';
import type { FtpTrendView } from '../../lib/ftpTrendView';
import type { RangeCoverage } from 'veloqrs';

interface FitnessTrendSectionsProps {
  sportMode: PrimarySport;
  timeRange: TimeRange;
  powerZones: ZoneDistribution[] | undefined;
  hrZones: ZoneDistribution[] | undefined;
  /** Whether the period the zone charts are captioned with was downloaded. */
  zoneCoverage: RangeCoverage;
  loadingActivities: boolean;
  hasActivities: boolean;
  dominantZone: { name: string; percentage: number } | null;
  zonesExpanded: boolean;
  onZonesToggle: (expanded: boolean) => void;
  // eFTP trend (cycling)
  eftpTrend: FtpTrendView | undefined;
  ftpTrend: TrendDirection | null;
  trendsExpanded: boolean;
  onTrendsToggle: (expanded: boolean) => void;
  // Running thresholds
  thresholdPace: number | undefined;
  runLthr: number | undefined;
  // Decoupling (cycling), the stored value of the ride it names
  decouplingSource: DecouplingSource | null;
  efficiencyExpanded: boolean;
  onEfficiencyToggle: (expanded: boolean) => void;
}

export const FitnessTrendSections = React.memo(function FitnessTrendSections({
  sportMode,
  timeRange,
  powerZones,
  hrZones,
  zoneCoverage,
  loadingActivities,
  hasActivities,
  dominantZone,
  zonesExpanded,
  onZonesToggle,
  eftpTrend,
  ftpTrend,
  trendsExpanded,
  onTrendsToggle,
  thresholdPace,
  runLthr,
  decouplingSource,
  efficiencyExpanded,
  onEfficiencyToggle,
}: FitnessTrendSectionsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  // A headline number is text, and the sport fills are 2.3:1 to 3.6:1 on the
  // light card. The text pair is the same hues at text grade.
  const sportText = isDark ? SPORT_TEXT_COLORS_DARK : SPORT_TEXT_COLORS;

  // The chart and the arrow read the engine's daily series, so the headline is that series'
  // latest estimate, never the FTP setting, and it is stated only when the series has one. A row that offers a figure its own chart calls
  // "no data" is worse than an empty row.
  const headerFtp = curveHeaderValue({
    value: eftpTrend?.latest,
    hasSeries: (eftpTrend?.series.length ?? 0) > 0,
    isLoading: loadingActivities && !hasActivities,
  });

  return (
    <>
      {/* Training Zones Section */}
      <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
        <CollapsibleSection
          testID="fitness-section-zones"
          title={t('statsScreen.trainingZones')}
          icon="chart-bar"
          expanded={zonesExpanded}
          onToggle={onZonesToggle}
          estimatedHeight={sportMode === 'Cycling' ? 400 : 200}
          headerRight={
            dominantZone ? (
              <Text style={[styles.headerValue, { color: sportText[sportMode] }]}>
                {dominantZone.name}: {dominantZone.percentage}%
              </Text>
            ) : null
          }
        >
          <View style={styles.collapsibleContent}>
            {loadingActivities && !hasActivities ? (
              <View style={styles.zoneLoadingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <>
                {sportMode === 'Cycling' && (
                  <View style={styles.zoneSection}>
                    <ZoneDistributionChart
                      data={powerZones}
                      type="power"
                      periodLabel={t(PERIOD_LABEL_KEYS.short[timeRange] as never)}
                      coverage={zoneCoverage}
                    />
                  </View>
                )}
                <View style={sportMode === 'Cycling' ? styles.zoneSectionDivided : undefined}>
                  <ZoneDistributionChart
                    data={hrZones}
                    type="hr"
                    periodLabel={t(PERIOD_LABEL_KEYS.short[timeRange] as never)}
                    coverage={zoneCoverage}
                  />
                </View>
              </>
            )}
          </View>
        </CollapsibleSection>
      </View>

      {/* Trends Section - eFTP/Threshold (Cycling only) */}
      {sportMode === 'Cycling' && (
        <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
          <CollapsibleSection
            testID="fitness-section-trends"
            title={t('statsScreen.eFTPTrend')}
            icon="trending-up"
            expanded={trendsExpanded}
            onToggle={onTrendsToggle}
            estimatedHeight={220}
            headerRight={
              headerFtp ? (
                <View style={styles.headerValueRow}>
                  <Text style={[styles.headerValue, { color: sportText.Cycling }]}>
                    {headerFtp} {t('units.watts')}
                  </Text>
                  {ftpTrend && (
                    <MaterialCommunityIcons
                      name={trendIcon('ftp', ftpTrend)}
                      size={16}
                      color={verdictColor(verdictRung(trendVerdict('ftp', ftpTrend)), isDark)}
                      style={styles.trendIcon}
                    />
                  )}
                </View>
              ) : null
            }
          >
            <View style={styles.collapsibleContent}>
              {loadingActivities && !hasActivities ? (
                <View style={styles.zoneLoadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <FTPTrendChart
                  data={eftpTrend?.series}
                  change={eftpTrend?.change}
                  changePercent={eftpTrend?.changePercent}
                  height={180}
                />
              )}
            </View>
          </CollapsibleSection>
        </View>
      )}

      {/* Running Threshold Stats */}
      {sportMode === 'Running' && (
        <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
          <CollapsibleSection
            testID="fitness-section-threshold"
            title={t('statsScreen.lactateThreshold')}
            icon="heart-pulse"
            expanded={trendsExpanded}
            onToggle={onTrendsToggle}
            estimatedHeight={100}
            headerRight={
              thresholdPace ? (
                <Text style={[styles.headerValue, { color: sportText.Running }]}>
                  {formatPaceCompact(thresholdPace, isMetric)}
                  {paceUnitLabel(isMetric)}
                </Text>
              ) : runLthr ? (
                <Text style={[styles.headerValue, { color: sportText.Running }]}>
                  {runLthr} {t('units.bpm')}
                </Text>
              ) : null
            }
          >
            <View style={styles.collapsibleContent}>
              {!thresholdPace && !runLthr ? (
                <Text
                  testID="fitness-threshold-empty"
                  style={[styles.thresholdEmpty, isDark && styles.thresholdLabelDark]}
                >
                  {t('statsScreen.notEnoughRuns')}
                </Text>
              ) : (
                <View style={styles.thresholdRow}>
                  <View style={styles.thresholdItem}>
                    <Text style={[styles.thresholdLabel, isDark && styles.thresholdLabelDark]}>
                      {t('statsScreen.pace')}
                    </Text>
                    <Text style={[styles.thresholdValue, { color: sportText.Running }]}>
                      {thresholdPace
                        ? `${formatPaceCompact(thresholdPace, isMetric)}${paceUnitLabel(isMetric)}`
                        : '-'}
                    </Text>
                  </View>
                  {runLthr && (
                    <>
                      <View style={styles.thresholdDivider} />
                      <View style={styles.thresholdItem}>
                        <Text style={[styles.thresholdLabel, isDark && styles.thresholdLabelDark]}>
                          {t('statsScreen.heartRate')}
                        </Text>
                        <Text style={[styles.thresholdValue, { color: sportText.Running }]}>
                          {runLthr} {t('units.bpm')}
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          </CollapsibleSection>
        </View>
      )}

      {/* Efficiency Section - Decoupling (Cycling only) */}
      {sportMode === 'Cycling' && (
        <View style={[styles.collapsibleCard, isDark && styles.collapsibleCardDark]}>
          <CollapsibleSection
            testID="fitness-section-efficiency"
            title={t('statsScreen.decoupling')}
            icon="heart-flash"
            expanded={efficiencyExpanded}
            onToggle={onEfficiencyToggle}
            estimatedHeight={160}
            headerRight={
              decouplingSource ? (
                <Text style={[styles.headerValue, { color: sportText.Cycling }]}>
                  {decouplingSource.decoupling.toFixed(1)}%
                </Text>
              ) : null
            }
          >
            <View style={styles.collapsibleContent}>
              {loadingActivities && !decouplingSource ? (
                <View style={styles.zoneLoadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <DecouplingChart source={decouplingSource} height={120} />
              )}
            </View>
          </CollapsibleSection>
        </View>
      )}
    </>
  );
});

const styles = StyleSheet.create({
  collapsibleCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  collapsibleCardDark: {
    backgroundColor: darkColors.surface,
  },
  collapsibleContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  headerValue: {
    ...typography.bodyBold,
    marginRight: spacing.sm,
  },
  headerValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendIcon: {
    marginLeft: spacing.xxs,
    marginRight: spacing.sm,
  },
  zoneLoadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneSection: {
    marginBottom: spacing.md,
  },
  zoneSectionDivided: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: opacity.overlay.medium,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thresholdItem: {
    flex: 1,
    alignItems: 'center',
  },
  thresholdLabel: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  thresholdEmpty: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  thresholdLabelDark: {
    color: darkColors.textSecondary,
  },
  thresholdValue: {
    fontSize: typography.statsValue.fontSize,
    fontWeight: '700',
  },
  thresholdDivider: {
    width: 1,
    height: 40,
    backgroundColor: opacity.overlay.medium,
    marginHorizontal: spacing.md,
  },
});
