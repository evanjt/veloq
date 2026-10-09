import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  Modal,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as ScreenOrientation from 'expo-screen-orientation';
import { CombinedPlot, type ChartMetricValue } from './CombinedPlot';
import { ChartTypeSelector } from './ChartTypeSelector';
import { HRZonesChart } from './HRZonesChart';
import { PowerZonesChart } from './PowerZonesChart';
import { IntervalsTable } from './IntervalsTable';
import { InsightfulStats } from './stats';
import {
  BodyNotDownloaded,
  Button,
  ComponentErrorBoundary,
  DeviceAttribution,
  IconButton,
  pressable,
  pressRipple,
} from '@/shared/ui';
import { DebugInfoPanel, DebugWarningBanner } from '@/features/routes';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
import { useFFITimer } from '@/shared/debug/useFFITimer';
import { measuresPower, isSwimmingActivity } from '@/shared/activity/activityUtils';
import type { HrZoneBand, ActivityFitnessImpact } from 'veloqrs';
import type { LatLng } from '@/shared/geo/polyline';
import type { EngineBodyStatus } from '@/shared/native/engineBodies';
import type { IntervalsOutcome } from '../hooks/useActivities';
import type { ActivityNewGround } from '../hooks/useActivitySectionHighlights';
import {
  getAvailableCharts,
  chartConfigsFor,
  CHART_CONFIGS,
} from '@/features/activity/lib/chartConfig';
import { formatDurationHuman } from '@/shared/format/format';
import { type ChartTypeId } from '@/features/activity/lib/chartConfig';
import type {
  ActivityDetail,
  ActivityStreams,
  ActivityInterval,
  ActivityType,
  WellnessData,
} from '@/types';
import {
  colors,
  controlHeight,
  darkColors,
  spacing,
  layout,
  opacity,
  shadows,
  slopToMinTapTarget,
  typography,
} from '@/theme';

/** The chart an activity opens on: power where the sport measures it, pace for a swim. */
function defaultChartFor(type: ActivityType): ChartTypeId {
  if (measuresPower(type)) return 'power';
  if (isSwimmingActivity(type)) return 'pace';
  return 'heartrate';
}

interface ActivityChartsSectionProps {
  activity: ActivityDetail;
  activityId: string;
  streams: ActivityStreams | undefined;
  streamsDownloaded?: boolean | undefined;
  streamsStatus?: EngineBodyStatus | undefined;
  onRetryStreams?: (() => void) | undefined;
  intervalsData: { icu_intervals: ActivityInterval[] } | undefined;
  /**
   * Why `intervalsData` is empty. An empty lap list is either a steady ride
   * with no laps or a body the sync has not reached, and only the second of
   * those is worth a line on screen.
   */
  intervalsOutcome?: IntervalsOutcome | undefined;
  /** The wait for the interval body, which offers a Retry once it ends without one. */
  intervalsStatus?: EngineBodyStatus | undefined;
  onRetryIntervals?: (() => void) | undefined;
  activityWellness: WellnessData | null | undefined;
  coordinates: LatLng[];
  isDark: boolean;
  isMetric: boolean;
  debugEnabled: boolean;
  gpxExporting: boolean;
  chartInteracting: boolean;
  engineSectionCount: number;
  customSectionCount: number;
  /** The max HR from the detail screen read, for the zones chart and the stat card */
  maxHR?: number | undefined;
  fitnessImpact?: ActivityFitnessImpact | null | undefined;
  /** Tile coverage against earlier activities, for the new ground stat */
  newGround?: ActivityNewGround | undefined;
  /** The engine-resolved zone bands and time in each, from the detail screen read */
  hrZones?: HrZoneBand[] | undefined;
  /** The screen's opening transition has ended, so the content below the top chart may mount */
  transitionSettled: boolean;
  onPointSelect: (index: number | null) => void;
  onInteractionChange: (isInteracting: boolean) => void;
  onExportGpx: () => void;
}

export const ActivityChartsSection = React.memo(function ActivityChartsSection({
  activity,
  activityId,
  streams,
  streamsDownloaded = true,
  streamsStatus = 'idle',
  onRetryStreams,
  intervalsData,
  intervalsOutcome = 'loaded',
  intervalsStatus = 'idle',
  onRetryIntervals,
  activityWellness,
  coordinates,
  isDark,
  isMetric,
  debugEnabled,
  gpxExporting,
  chartInteracting,
  engineSectionCount,
  customSectionCount,
  maxHR,
  fitnessImpact,
  newGround,
  hrZones,
  transitionSettled,
  onPointSelect,
  onInteractionChange,
  onExportGpx,
}: ActivityChartsSectionProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { getPageMetrics } = useFFITimer();

  // Chart state
  const [selectedCharts, setSelectedCharts] = useState<ChartTypeId[]>([]);
  const [previewMetricId, setPreviewMetricId] = useState<ChartTypeId | null>(null);
  const [chartsInitialised, setChartsInitialised] = useState(false);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const [xAxisMode, setXAxisMode] = useState<'distance' | 'time'>('distance');
  const [chartMetrics, setChartMetrics] = useState<ChartMetricValue[]>([]);
  const [intervalsExpanded, setIntervalsExpanded] = useState(false);
  const [belowFoldMounted, setBelowFoldMounted] = useState(false);

  // The stat cards and everything under them sit below the first screen. They
  // mount a frame after the transition settles and after this tab's own first
  // commit, so neither the opening tap's frame nor a late-mounting tab carries them.
  React.useEffect(() => {
    if (belowFoldMounted || !transitionSettled) return undefined;
    const frame = requestAnimationFrame(() => setBelowFoldMounted(true));
    return () => cancelAnimationFrame(frame);
  }, [belowFoldMounted, transitionSettled]);

  // Get available chart types based on stream data
  const availableCharts = useMemo(() => {
    return getAvailableCharts(streams || {});
  }, [streams]);

  const effectiveChartConfigs = useMemo(
    () => (activity ? chartConfigsFor(activity.type) : CHART_CONFIGS),
    [activity]
  );

  // Determine effective x-axis mode and whether toggle is available
  const hasDistance = (streams?.distance?.length ?? 0) > 0;
  const hasTime = (streams?.time?.length ?? 0) > 0;
  const effectiveXAxisMode = !hasDistance ? 'time' : xAxisMode;
  const canToggleXAxis = hasDistance && hasTime;

  // Initialise with single default chart when data loads
  React.useEffect(() => {
    if (!chartsInitialised && availableCharts.length > 0 && activity) {
      const defaultChart = defaultChartFor(activity.type);
      const isDefaultAvailable = availableCharts.some((c) => c.id === defaultChart);
      const initialChart = isDefaultAvailable ? defaultChart : availableCharts[0].id;
      setSelectedCharts([initialChart]);
      setChartsInitialised(true);
    }
  }, [availableCharts, chartsInitialised, activity]);

  // Toggle a chart type on/off
  const handleChartToggle = useCallback((chartId: string) => {
    setSelectedCharts((prev) => {
      if (prev.includes(chartId as ChartTypeId)) {
        if (prev.length === 1) return prev;
        return prev.filter((cid) => cid !== chartId);
      }
      return [...prev, chartId as ChartTypeId];
    });
  }, []);

  // Toggle x-axis between distance and time
  const handleXAxisToggle = useCallback(() => {
    setXAxisMode((m) => (m === 'distance' ? 'time' : 'distance'));
  }, []);

  // Handle chart metrics updates
  const handleMetricsChange = useCallback((metrics: ChartMetricValue[]) => {
    setChartMetrics(metrics);
  }, []);

  // Open fullscreen chart with landscape orientation
  const openChartFullscreen = useCallback(async () => {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    setIsChartFullscreen(true);
  }, []);

  // Close fullscreen chart and restore portrait orientation
  const closeChartFullscreen = useCallback(async () => {
    setIsChartFullscreen(false);
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  }, []);

  // Zone summary for intervals bar
  const intervalZoneSummary = useMemo(() => {
    if (!intervalsData?.icu_intervals || !activity) return [];
    const zoneColors = measuresPower(activity.type) ? POWER_ZONE_COLORS : HR_ZONE_COLORS;

    type ChipInfo = {
      label: string;
      color: string;
      count: number;
      totalTime: number;
    };
    const chips: ChipInfo[] = [];
    const chipMap = new Map<string, number>();

    for (const interval of intervalsData.icu_intervals) {
      const isWork = interval.type === 'WORK';
      const isRecovery = interval.type === 'RECOVERY' || interval.type === 'REST';
      const isWarmup = interval.type === 'WARMUP';
      const isCooldown = interval.type === 'COOLDOWN';

      let label: string;
      let color: string;
      let key: string;

      if (isWork && interval.zone != null && interval.zone >= 1) {
        key = `Z${interval.zone}`;
        label = `Z${interval.zone}`;
        color = zoneColors[Math.min(interval.zone - 1, zoneColors.length - 1)];
      } else if (isWork) {
        key = 'WORK';
        label = 'W';
        color = colors.primary;
      } else if (isRecovery) {
        key = 'REC';
        label = 'Rec';
        color = colors.chartPaceCurve;
      } else if (isWarmup) {
        key = 'WU';
        label = 'WU';
        color = colors.chartBandWarmup;
      } else if (isCooldown) {
        key = 'CD';
        label = 'CD';
        color = colors.chartBandCooldown;
      } else {
        key = interval.type;
        label = interval.type.slice(0, 3);
        color = colors.chartBandNeutral;
      }

      // An interval with no moving time still counts as one, it just adds
      // nothing to the total.
      const movingTime = interval.moving_time ?? 0;
      const idx = chipMap.get(key);
      if (idx !== undefined) {
        chips[idx].count++;
        chips[idx].totalTime += movingTime;
      } else {
        chipMap.set(key, chips.length);
        chips.push({ label, color, count: 1, totalTime: movingTime });
      }
    }
    return chips;
  }, [intervalsData, activity]);

  // Each block is gated on the source it reads. Only the chart and the HR zones
  // need a stream; the intervals and the power zones are persisted columns, so
  // a streamless activity still has both.
  const hasIntervals = (intervalsData?.icu_intervals?.length ?? 0) > 0;
  const intervalsOwed = !hasIntervals && intervalsOutcome === 'pending';
  const hasPowerZones = (activity.icu_zone_times?.length ?? 0) > 0;

  return (
    <>
      <ScrollView
        testID="activity-charts-scrollview"
        style={styles.tabScrollView}
        contentContainerStyle={styles.tabScrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartInteracting}
      >
        {(!streamsDownloaded ||
          availableCharts.length > 0 ||
          hasIntervals ||
          intervalsOwed ||
          hasPowerZones) && (
          <View style={styles.chartSection}>
            {!streamsDownloaded && (
              <BodyNotDownloaded
                testID="streams-not-downloaded"
                style={[styles.chartCard, isDark && styles.cardDark]}
                message={t('statsScreen.curveNotDownloaded')}
                status={streamsStatus}
                onRetry={() => onRetryStreams?.()}
              />
            )}
            {availableCharts.length > 0 && (
              <View style={styles.chartControls}>
                <View style={styles.chartSelectorContainer}>
                  <ChartTypeSelector
                    available={availableCharts}
                    selected={selectedCharts}
                    onToggle={handleChartToggle}
                    onPreviewStart={(id) => setPreviewMetricId(id as ChartTypeId)}
                    onPreviewEnd={() => setPreviewMetricId(null)}
                    metricValues={chartMetrics}
                  />
                </View>
                <IconButton
                  style={styles.fullscreenButton}
                  onPress={openChartFullscreen}
                  accessibilityLabel={t('maps.openFullscreen')}
                >
                  <MaterialCommunityIcons
                    name="fullscreen"
                    size={16}
                    color={isDark ? colors.textOnDark : colors.textPrimary}
                  />
                </IconButton>
              </View>
            )}

            {/* Chart */}
            {streams && selectedCharts.length > 0 && (
              <View style={[styles.chartCard, isDark && styles.cardDark]}>
                <CombinedPlot
                  streams={streams}
                  elevationGain={activity.total_elevation_gain}
                  selectedCharts={selectedCharts}
                  chartConfigs={effectiveChartConfigs}
                  height={180}
                  onPointSelect={onPointSelect}
                  onInteractionChange={onInteractionChange}
                  previewMetricId={previewMetricId}
                  xAxisMode={effectiveXAxisMode}
                  onXAxisModeToggle={handleXAxisToggle}
                  canToggleXAxis={canToggleXAxis}
                  intervals={intervalsExpanded ? intervalsData?.icu_intervals : undefined}
                  activityType={activity.type}
                  onMetricsChange={handleMetricsChange}
                />
              </View>
            )}

            {/* Intervals zone bar. Its own source is `icu_intervals`, which is
                persisted whether or not the streams were ever fetched. */}
            {intervalsOwed && (
              <BodyNotDownloaded
                testID="intervals-not-downloaded"
                style={[styles.intervalsCard, isDark && styles.cardDark, styles.intervalsPending]}
                textStyle={[styles.intervalsTitle, isDark && styles.textSecondary]}
                message={t('activityDetail.intervalsNotDownloaded')}
                status={intervalsStatus}
                onRetry={() => onRetryIntervals?.()}
              />
            )}

            {hasIntervals && (
              <View
                testID="activity-interval-table"
                style={[styles.intervalsCard, isDark && styles.cardDark]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('activityDetail.tabs.intervals')}
                  accessibilityState={{ expanded: intervalsExpanded }}
                  style={pressable([styles.intervalsBar, isDark && styles.intervalsBarDark])}
                  android_ripple={pressRipple}
                  onPress={() => setIntervalsExpanded((v) => !v)}
                >
                  <View style={styles.intervalsBarLeft}>
                    <Text style={[styles.intervalsTitle, isDark && styles.textSecondary]}>
                      {t('activityDetail.tabs.intervals')}
                    </Text>
                    {intervalZoneSummary.map((z, i) => (
                      <View key={i} style={[styles.zoneChip, { backgroundColor: z.color + '25' }]}>
                        <View style={[styles.zoneDot, { backgroundColor: z.color }]} />
                        <Text style={[styles.zoneChipText, isDark && styles.zoneChipTextDark]}>
                          {z.label} x{z.count} {formatDurationHuman(z.totalTime)}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <MaterialCommunityIcons
                    name={intervalsExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={isDark ? darkColors.textSecondary : colors.textSecondary}
                  />
                </Pressable>
                {intervalsExpanded && intervalsData?.icu_intervals && (
                  <IntervalsTable
                    intervals={intervalsData.icu_intervals}
                    activityType={activity.type}
                    isMetric={isMetric}
                    isDark={isDark}
                  />
                )}
              </View>
            )}

            {/* HR Zones Chart */}
            {streams?.heartrate && streams.heartrate.length > 0 && (
              <View
                testID="activity-zone-chart"
                style={[styles.chartCard, isDark && styles.cardDark]}
              >
                <ComponentErrorBoundary componentName="HR Zones Chart">
                  <HRZonesChart hrZones={hrZones} maxHR={maxHR} movingTime={activity.moving_time} />
                </ComponentErrorBoundary>
              </View>
            )}

            {/* Power Zones Chart */}
            {hasPowerZones && (
              <View style={[styles.chartCard, isDark && styles.cardDark]}>
                <ComponentErrorBoundary componentName="Power Zones Chart">
                  <PowerZonesChart activity={activity} />
                </ComponentErrorBoundary>
              </View>
            )}
          </View>
        )}

        {belowFoldMounted && (
          <>
            {/* Insightful Stats */}
            <ComponentErrorBoundary componentName="Activity Stats">
              <InsightfulStats
                activity={activity}
                wellness={activityWellness}
                maxHR={maxHR}
                fitnessImpact={fitnessImpact}
                newGround={newGround}
              />
            </ComponentErrorBoundary>

            {/* Export GPX button */}
            {coordinates.length > 0 && (
              <Button
                testID="activity-export-gpx"
                style={styles.exportGpxButton}
                onPress={onExportGpx}
                loading={gpxExporting}
                label={t('export.gpx')}
                icon={
                  <MaterialCommunityIcons name="download" size={20} color={colors.textOnPrimary} />
                }
              />
            )}

            {/* Device attribution */}
            {activity.device_name && (
              <View style={styles.deviceAttributionContainer}>
                <DeviceAttribution deviceName={activity.device_name} />
              </View>
            )}

            {debugEnabled &&
              activity &&
              (() => {
                const pageMetrics = getPageMetrics();
                const ffiEntries =
                  pageMetrics.length > 0
                    ? pageMetrics.reduce<
                        Record<string, { calls: number; totalMs: number; maxMs: number }>
                      >((acc, m) => {
                        if (!acc[m.name]) acc[m.name] = { calls: 0, totalMs: 0, maxMs: 0 };
                        acc[m.name].calls++;
                        acc[m.name].totalMs += m.durationMs;
                        acc[m.name].maxMs = Math.max(acc[m.name].maxMs, m.durationMs);
                        return acc;
                      }, {})
                    : {};
                const warnings: {
                  level: 'warn' | 'error';
                  message: string;
                }[] = [];
                if (streams?.latlng && streams.latlng.length > 2000) {
                  warnings.push({
                    level: 'warn',
                    message: `Polyline points: ${streams.latlng.length}`,
                  });
                }
                for (const [name, m] of Object.entries(ffiEntries)) {
                  if (m.maxMs > 200) {
                    warnings.push({
                      level: 'error',
                      message: `${name}: ${m.maxMs.toFixed(0)}ms (max)`,
                    });
                  }
                }
                return (
                  <>
                    {warnings.length > 0 && <DebugWarningBanner warnings={warnings} />}
                    <DebugInfoPanel
                      isDark={isDark}
                      entries={[
                        {
                          label: 'Activity ID',
                          value: activityId?.slice(0, 24) ?? '-',
                        },
                        { label: 'Sport', value: activity.type ?? '-' },
                        {
                          label: 'GPS Points',
                          value: streams?.latlng ? String(streams.latlng.length) : '-',
                        },
                        {
                          label: 'HR Samples',
                          value: streams?.heartrate ? String(streams.heartrate.length) : '-',
                        },
                        {
                          label: 'Power Samples',
                          value: streams?.watts ? String(streams.watts.length) : '-',
                        },
                        {
                          label: 'Cadence Samples',
                          value: streams?.cadence ? String(streams.cadence.length) : '-',
                        },
                        {
                          label: 'Sections Matched',
                          value: String(engineSectionCount),
                        },
                        {
                          label: 'Custom Sections',
                          value: String(customSectionCount),
                        },
                        ...Object.entries(ffiEntries).map(([name, m]) => ({
                          label: name,
                          value: `${m.calls}x ${m.totalMs.toFixed(0)}ms`,
                        })),
                      ]}
                    />
                  </>
                );
              })()}
          </>
        )}
      </ScrollView>

      {/* Fullscreen Chart Modal - Landscape */}
      <Modal
        visible={isChartFullscreen}
        animationType="fade"
        statusBarTranslucent
        supportedOrientations={['landscape-left', 'landscape-right']}
        onRequestClose={closeChartFullscreen}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <StatusBar hidden />
          <View style={[styles.fullscreenContainer, isDark && styles.fullscreenContainerDark]}>
            {/* Close button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={pressable([
                styles.fullscreenCloseButton,
                { top: Math.max(insets.top, insets.left, 16) + 8 },
              ])}
              onPress={closeChartFullscreen}
              hitSlop={CLOSE_SLOP}
              android_ripple={pressRipple}
            >
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={isDark ? colors.textOnDark : colors.textPrimary}
              />
            </Pressable>

            {/* Chart type selector in fullscreen */}
            <View
              style={[
                styles.fullscreenControls,
                { paddingTop: Math.max(insets.top, insets.left, 16) + 8 },
              ]}
            >
              <ChartTypeSelector
                available={availableCharts}
                selected={selectedCharts}
                onToggle={handleChartToggle}
                onPreviewStart={(id) => setPreviewMetricId(id as ChartTypeId)}
                onPreviewEnd={() => setPreviewMetricId(null)}
                metricValues={chartMetrics}
              />
            </View>

            {/* Chart area */}
            {streams && selectedCharts.length > 0 && (
              <View style={styles.fullscreenChartWrapper}>
                <CombinedPlot
                  streams={streams}
                  elevationGain={activity.total_elevation_gain}
                  selectedCharts={selectedCharts}
                  chartConfigs={effectiveChartConfigs}
                  height={windowHeight - 100}
                  onPointSelect={onPointSelect}
                  onInteractionChange={onInteractionChange}
                  previewMetricId={previewMetricId}
                  xAxisMode={effectiveXAxisMode}
                  onXAxisModeToggle={handleXAxisToggle}
                  canToggleXAxis={canToggleXAxis}
                  intervals={intervalsExpanded ? intervalsData?.icu_intervals : undefined}
                  activityType={activity.type}
                  onMetricsChange={handleMetricsChange}
                />
              </View>
            )}
          </View>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
});

const BOTTOM_BAR_HEIGHT = 80;

const CLOSE_SLOP = slopToMinTapTarget(controlHeight.button, controlHeight.button);

const styles = StyleSheet.create({
  tabScrollView: {
    flex: 1,
  },
  tabScrollContent: {
    paddingBottom: spacing.xl + BOTTOM_BAR_HEIGHT,
  },
  chartSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  chartControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  chartSelectorContainer: {
    flex: 1,
    marginHorizontal: spacing.xs,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    ...shadows.card,
    minHeight: 180,
    overflow: 'hidden',
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  intervalsCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    marginBottom: spacing.sm,
    ...shadows.card,
    overflow: 'hidden',
  },
  intervalsPending: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xsPlus,
  },
  intervalsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xsPlus,
  },
  intervalsBarDark: {
    borderTopColor: darkColors.border,
  },
  intervalsBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flex: 1,
    gap: spacing.xs,
  },
  intervalsTitle: {
    fontSize: typography.label.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    marginRight: spacing.xxs,
  },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xsPlus,
    paddingVertical: spacing.xxs,
    borderRadius: layout.borderRadiusXs,
    gap: spacing.xs,
  },
  zoneDot: {
    width: 6,
    height: 6,
    borderRadius: layout.borderRadiusFull,
  },
  zoneChipText: {
    fontSize: typography.micro.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  zoneChipTextDark: {
    color: darkColors.textPrimary,
  },
  deviceAttributionContainer: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  fullscreenButton: {
    marginLeft: 'auto',
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  fullscreenContainerDark: {
    backgroundColor: darkColors.surface,
  },
  fullscreenCloseButton: {
    position: 'absolute',
    left: spacing.md,
    width: controlHeight.button,
    height: controlHeight.button,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: opacity.overlay.medium,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  fullscreenControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: spacing.xs,
  },
  fullscreenChartWrapper: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: spacing.md,
  },
  exportGpxButton: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.elevated,
  },
});
