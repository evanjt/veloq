import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CollapsibleSection } from '@/components/ui';
import { ZoneDistributionChart, FTPTrendChart, DecouplingChart } from '@/components/stats';
import { useTheme } from '@/hooks';
import { SPORT_COLORS, type PrimarySport } from '@/providers';
import { formatPaceCompact } from '@/lib';
import { TIME_RANGES } from '@/lib/utils/constants';
import { colors, darkColors, spacing, layout, typography, opacity } from '@/theme';
import type { TimeRange } from '@/hooks';
import type { ZoneDistribution, eFTPPoint, ActivityStreams } from '@/types';

interface FitnessTrendSectionsProps {
  sportMode: PrimarySport;
  timeRange: TimeRange;
  powerZones: ZoneDistribution[] | undefined;
  hrZones: ZoneDistribution[] | undefined;
  loadingActivities: boolean;
  hasActivities: boolean;
  dominantZone: { name: string; percentage: number } | null;
  zonesExpanded: boolean;
  onZonesToggle: (expanded: boolean) => void;
  // eFTP trend (cycling)
  eftpHistory: eFTPPoint[] | undefined;
  currentFTP: number | null | undefined;
  ftpTrend: 'up' | 'down' | 'stable' | null;
  trendsExpanded: boolean;
  onTrendsToggle: (expanded: boolean) => void;
  // Running thresholds
  thresholdPace: number | undefined;
  runLthr: number | undefined;
  runMaxHr: number | undefined;
  // Decoupling (cycling)
  decouplingStreams: ActivityStreams | undefined;
  decouplingValue: { value: number; isGood: boolean } | null;
  loadingStreams: boolean;
  efficiencyExpanded: boolean;
  onEfficiencyToggle: (expanded: boolean) => void;
}

export const FitnessTrendSections = React.memo(function FitnessTrendSections({
  sportMode,
  timeRange,
  powerZones,
  hrZones,
  loadingActivities,
  hasActivities,
  dominantZone,
  zonesExpanded,
  onZonesToggle,
  eftpHistory,
  currentFTP,
  ftpTrend,
  trendsExpanded,
  onTrendsToggle,
  thresholdPace,
  runLthr,
  decouplingStreams,
  decouplingValue,
  loadingStreams,
  efficiencyExpanded,
  onEfficiencyToggle,
}: FitnessTrendSectionsProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

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
              <Text style={[styles.headerValue, { color: SPORT_COLORS[sportMode] }]}>
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
                      periodLabel={TIME_RANGES.find((r) => r.id === timeRange)?.label || '3M'}
                    />
                  </View>
                )}
                <View style={sportMode === 'Cycling' ? styles.zoneSectionDivided : undefined}>
                  <ZoneDistributionChart
                    data={hrZones}
                    type="hr"
                    periodLabel={TIME_RANGES.find((r) => r.id === timeRange)?.label || '3M'}
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
              currentFTP ? (
                <View style={styles.headerValueRow}>
                  <Text style={[styles.headerValue, { color: SPORT_COLORS.Cycling }]}>
                    {currentFTP}w
                  </Text>
                  {ftpTrend && ftpTrend !== 'stable' && (
                    <MaterialCommunityIcons
                      name={ftpTrend === 'up' ? 'trending-up' : 'trending-down'}
                      size={16}
                      color={ftpTrend === 'up' ? colors.success : colors.error}
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
                  data={eftpHistory}
                  currentFTP={currentFTP ?? undefined}
                  height={180}
                />
              )}
            </View>
          </CollapsibleSection>
        </View>
      )}

      {/* Running Threshold Stats */}
      {sportMode === 'Running' && (thresholdPace || runLthr) && (
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
                <Text style={[styles.headerValue, { color: SPORT_COLORS.Running }]}>
                  {formatPaceCompact(thresholdPace)}/km
                </Text>
              ) : runLthr ? (
                <Text style={[styles.headerValue, { color: SPORT_COLORS.Running }]}>
                  {runLthr} bpm
                </Text>
              ) : null
            }
          >
            <View style={styles.collapsibleContent}>
              <View style={styles.thresholdRow}>
                <View style={styles.thresholdItem}>
                  <Text style={[styles.thresholdLabel, isDark && styles.thresholdLabelDark]}>
                    {t('statsScreen.pace')}
                  </Text>
                  <Text style={[styles.thresholdValue, { color: SPORT_COLORS.Running }]}>
                    {thresholdPace ? `${formatPaceCompact(thresholdPace)}/km` : '-'}
                  </Text>
                </View>
                {runLthr && (
                  <>
                    <View style={styles.thresholdDivider} />
                    <View style={styles.thresholdItem}>
                      <Text style={[styles.thresholdLabel, isDark && styles.thresholdLabelDark]}>
                        {t('statsScreen.heartRate')}
                      </Text>
                      <Text style={[styles.thresholdValue, { color: SPORT_COLORS.Running }]}>
                        {runLthr} bpm
                      </Text>
                    </View>
                  </>
                )}
              </View>
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
              decouplingValue ? (
                <Text
                  style={[
                    styles.headerValue,
                    {
                      color: decouplingValue.isGood ? colors.success : colors.warning,
                    },
                  ]}
                >
                  {Number.isFinite(decouplingValue.value)
                    ? `${decouplingValue.value.toFixed(1)}%`
                    : '-'}
                </Text>
              ) : null
            }
          >
            <View style={styles.collapsibleContent}>
              {loadingStreams && !decouplingStreams ? (
                <View style={styles.zoneLoadingContainer}>
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <DecouplingChart
                  power={decouplingStreams?.watts}
                  heartrate={decouplingStreams?.heartrate}
                  height={120}
                />
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
    marginLeft: 2,
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
