import React from 'react';
import { curveHeaderValue } from '@/features/fitness/lib/curveHeaderValue';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { Card, CollapsibleSection, StatTile } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
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
import {
  colors,
  darkColors,
  iconSize,
  opacity,
  spacing,
  stroke,
  typography,
  verdictColor,
} from '@/theme';
import { trendIcon, trendVerdict, verdictRung, type TrendDirection } from '@/shared/format/trend';
import { type TimeRange } from '@/features/wellness';
import type { ZoneDistribution } from '@/types';
import type { FtpTrendView } from '../../lib/ftpTrendView';
import type { RangeCoverage } from 'veloqrs';
import { ABSENT } from '@/shared/format/absent';
import { formatPercent } from '@/shared/format';

/**
 * The content height each section declares to its collapsible, which its
 * placeholder takes too while the period's activities are read. Cycling
 * draws a power chart above the heart rate one.
 */
const ZONES_HEIGHT_CYCLING = 400;
const ZONES_HEIGHT = 200;
const TRENDS_HEIGHT = 220;
const DECOUPLING_HEIGHT = 160;

interface FitnessTrendSectionsProps {
  sportMode: PrimarySport;
  timeRange: TimeRange;
  powerZones: ZoneDistribution[] | undefined;
  hrZones: ZoneDistribution[] | undefined;
  /**
   * Whether the period the zone charts are captioned with was downloaded. The
   * decoupling ride is picked from the activities of the same period.
   */
  periodCoverage: RangeCoverage;
  dominantZone: { name: string; share: number } | null;
  zonesExpanded: boolean;
  onZonesToggle: (expanded: boolean) => void;
  // eFTP trend (cycling)
  eftpTrend: FtpTrendView | undefined;
  /** Whether the wellness the eFTP trend is read from was downloaded. */
  eftpCoverage: RangeCoverage;
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
  periodCoverage,
  dominantZone,
  zonesExpanded,
  onZonesToggle,
  eftpTrend,
  eftpCoverage,
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
  const zonesHeight = sportMode === 'Cycling' ? ZONES_HEIGHT_CYCLING : ZONES_HEIGHT;
  // A headline number is text, and the sport fills are 2.3:1 to 3.6:1 on the
  // light card. The text pair is the same hues at text grade.
  const sportText = isDark ? SPORT_TEXT_COLORS_DARK : SPORT_TEXT_COLORS;

  // The chart and the arrow read the engine's daily series, so the headline is that series'
  // latest estimate, never the FTP setting, and it is stated only when the series has one. A row that offers a figure its own chart calls
  // "no data" is worse than an empty row.
  const headerFtp = curveHeaderValue({
    value: eftpTrend?.latest,
    hasSeries: (eftpTrend?.series.length ?? 0) > 0,
  });

  return (
    <>
      {/* Training Zones Section */}
      <View style={styles.frame}>
        <Card variant="flat" padding="none">
          <CollapsibleSection
            testID="fitness-section-zones"
            title={t('statsScreen.trainingZones')}
            icon="chart-bar"
            expanded={zonesExpanded}
            onToggle={onZonesToggle}
            estimatedHeight={zonesHeight}
            headerRight={
              dominantZone ? (
                <Text style={[styles.headerValue, { color: sportText[sportMode] }]}>
                  {dominantZone.name}: {dominantZone.share}%
                </Text>
              ) : null
            }
          >
            <View style={styles.collapsibleContent}>
              {sportMode === 'Cycling' && (
                <View style={styles.zoneSection}>
                  <ZoneDistributionChart
                    data={powerZones}
                    type="power"
                    periodLabel={t(PERIOD_LABEL_KEYS.short[timeRange] as never)}
                    coverage={periodCoverage}
                  />
                </View>
              )}
              <View style={sportMode === 'Cycling' ? styles.zoneSectionDivided : undefined}>
                <ZoneDistributionChart
                  data={hrZones}
                  type="hr"
                  periodLabel={t(PERIOD_LABEL_KEYS.short[timeRange] as never)}
                  coverage={periodCoverage}
                />
              </View>
            </View>
          </CollapsibleSection>
        </Card>
      </View>

      {/* Trends Section - eFTP/Threshold (Cycling only) */}
      {sportMode === 'Cycling' && (
        <View style={styles.frame}>
          <Card variant="flat" padding="none">
            <CollapsibleSection
              testID="fitness-section-trends"
              title={t('statsScreen.eFTPTrend')}
              icon="trending-up"
              expanded={trendsExpanded}
              onToggle={onTrendsToggle}
              estimatedHeight={TRENDS_HEIGHT}
              headerRight={
                headerFtp ? (
                  <View style={styles.headerValueRow}>
                    <Text style={[styles.headerValue, { color: sportText.Cycling }]}>
                      {headerFtp} {t('units.watts')}
                    </Text>
                    {ftpTrend ? (
                      <Icon
                        name={trendIcon('ftp', ftpTrend)}
                        size={iconSize.sm}
                        color={verdictColor(verdictRung(trendVerdict('ftp', ftpTrend)), isDark)}
                        style={styles.trendIcon}
                      />
                    ) : null}
                  </View>
                ) : null
              }
            >
              <View style={styles.collapsibleContent}>
                <FTPTrendChart
                  data={eftpTrend?.series}
                  change={eftpTrend?.change}
                  changePercent={eftpTrend?.changePercent}
                  lookbackDays={eftpTrend?.lookbackDays}
                  height={180}
                  coverage={eftpCoverage}
                />
              </View>
            </CollapsibleSection>
          </Card>
        </View>
      )}

      {/* Running Threshold Stats */}
      {sportMode === 'Running' && (
        <View style={styles.frame}>
          <Card variant="flat" padding="none">
            <CollapsibleSection
              testID="fitness-section-threshold"
              title={t('statsScreen.threshold')}
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
                    {t('statsScreen.thresholdInputsMissing')}
                  </Text>
                ) : (
                  <View style={styles.thresholdRow}>
                    <View style={styles.thresholdItem}>
                      <StatTile
                        testID="fitness-threshold-pace"
                        align="center"
                        label={t('statsScreen.criticalSpeed')}
                        value={
                          thresholdPace
                            ? `${formatPaceCompact(thresholdPace, isMetric)}${paceUnitLabel(isMetric)}`
                            : ABSENT
                        }
                        valueColor={sportText.Running}
                      />
                    </View>
                    {runLthr ? (
                      <>
                        <View style={styles.thresholdDivider} />
                        <View style={styles.thresholdItem}>
                          <StatTile
                            testID="fitness-threshold-hr"
                            align="center"
                            label={t('statsScreen.lthr')}
                            value={runLthr}
                            unit={t('units.bpm')}
                            valueColor={sportText.Running}
                          />
                        </View>
                      </>
                    ) : null}
                  </View>
                )}
              </View>
            </CollapsibleSection>
          </Card>
        </View>
      )}

      {/* Efficiency Section - Decoupling (Cycling only) */}
      {sportMode === 'Cycling' && (
        <View style={styles.frame}>
          <Card variant="flat" padding="none">
            <CollapsibleSection
              testID="fitness-section-efficiency"
              title={t('stats.aerobicDecoupling')}
              icon="heart-flash"
              expanded={efficiencyExpanded}
              onToggle={onEfficiencyToggle}
              estimatedHeight={DECOUPLING_HEIGHT}
              headerRight={
                // The open section's tile prints the figure, so the header carries it only
                // while the section is closed.
                decouplingSource && !efficiencyExpanded ? (
                  <Text style={[styles.headerValue, { color: sportText.Cycling }]}>
                    {formatPercent(decouplingSource.decoupling, 1)}
                  </Text>
                ) : null
              }
            >
              <View style={styles.collapsibleContent}>
                <DecouplingChart source={decouplingSource} height={120} coverage={periodCoverage} />
              </View>
            </CollapsibleSection>
          </Card>
        </View>
      )}
    </>
  );
});

const styles = StyleSheet.create({
  frame: {
    marginBottom: spacing.sm,
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
  zoneSection: {
    marginBottom: spacing.md,
  },
  zoneSectionDivided: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: stroke.hairline,
    borderTopColor: opacity.overlay.medium,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thresholdItem: {
    flex: 1,
  },
  thresholdEmpty: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  thresholdLabelDark: {
    color: darkColors.textSecondary,
  },
  thresholdDivider: {
    width: 1,
    height: 40,
    backgroundColor: opacity.overlay.medium,
    marginHorizontal: spacing.md,
  },
});
