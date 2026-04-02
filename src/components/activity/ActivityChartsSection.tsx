import React, { useState, useCallback, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, Modal, StatusBar, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as ScreenOrientation from 'expo-screen-orientation';
import { CombinedPlot, type ChartMetricValue } from './CombinedPlot';
import { ChartTypeSelector } from './ChartTypeSelector';
import { HRZonesChart } from './HRZonesChart';
import { PowerZonesChart } from './PowerZonesChart';
import { IntervalsTable } from './IntervalsTable';
import { InsightfulStats } from './stats';
import { ComponentErrorBoundary, DeviceAttribution } from '@/components/ui';
import { DebugInfoPanel, DebugWarningBanner } from '@/components/routes';
import { POWER_ZONE_COLORS, HR_ZONE_COLORS } from '@/hooks';
import { useFFITimer } from '@/hooks/debug/useFFITimer';
import { formatDurationHuman, isCyclingActivity, getAvailableCharts, CHART_CONFIGS } from '@/lib';
import type { ChartTypeId } from '@/lib';
import type { ActivityDetail, ActivityStreams, ActivityInterval, WellnessData } from '@/types';
import { colors, darkColors, spacing, typography, layout, opacity } from '@/theme';
import { CHART_CONFIG } from '@/constants';

interface LatLng {
  latitude: number;
  longitude: number;
}

// Default chart by activity type
const DEFAULT_CHART: Record<string, ChartTypeId> = {
  Ride: 'power',
  VirtualRide: 'power',
  MountainBikeRide: 'power',
  GravelRide: 'power',
  EBikeRide: 'power',
  Run: 'heartrate',
  VirtualRun: 'heartrate',
  TrailRun: 'heartrate',
  Swim: 'pace',
  OpenWaterSwim: 'pace',
  Walk: 'heartrate',
  Hike: 'heartrate',
  Workout: 'heartrate',
  WeightTraining: 'heartrate',
  Yoga: 'heartrate',
  Rowing: 'power',
  Kayaking: 'heartrate',
  Canoeing: 'heartrate',
};

interface ActivityChartsSectionProps {
  activity: ActivityDetail;
  activityId: string;
  streams: ActivityStreams | undefined;
  intervalsData: { icu_intervals: ActivityInterval[] } | undefined;
  activityWellness: WellnessData | null | undefined;
  coordinates: LatLng[];
  isDark: boolean;
  isMetric: boolean;
  debugEnabled: boolean;
  gpxExporting: boolean;
  chartInteracting: boolean;
  engineSectionCount: number;
  customSectionCount: number;
  onPointSelect: (index: number | null) => void;
  onInteractionChange: (isInteracting: boolean) => void;
  onExportGpx: () => void;
}

export const ActivityChartsSection = React.memo(function ActivityChartsSection({
  activity,
  activityId,
  streams,
  intervalsData,
  activityWellness,
  coordinates,
  isDark,
  isMetric,
  debugEnabled,
  gpxExporting,
  chartInteracting,
  engineSectionCount,
  customSectionCount,
  onPointSelect,
  onInteractionChange,
  onExportGpx,
}: ActivityChartsSectionProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { getPageMetrics } = useFFITimer();

  // Chart state
  const [selectedCharts, setSelectedCharts] = useState<ChartTypeId[]>([]);
  const [previewMetricId, setPreviewMetricId] = useState<ChartTypeId | null>(null);
  const [chartsInitialized, setChartsInitialized] = useState(false);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const [xAxisMode, setXAxisMode] = useState<'distance' | 'time'>('distance');
  const [chartMetrics, setChartMetrics] = useState<ChartMetricValue[]>([]);
  const [intervalsExpanded, setIntervalsExpanded] = useState(false);

  // Get available chart types based on stream data
  const availableCharts = useMemo(() => {
    return getAvailableCharts(streams || {});
  }, [streams]);

  // Determine effective x-axis mode and whether toggle is available
  const hasDistance = (streams?.distance?.length ?? 0) > 0;
  const hasTime = (streams?.time?.length ?? 0) > 0;
  const effectiveXAxisMode = !hasDistance ? 'time' : xAxisMode;
  const canToggleXAxis = hasDistance && hasTime;

  // Initialize with single default chart when data loads
  React.useEffect(() => {
    if (!chartsInitialized && availableCharts.length > 0 && activity) {
      const defaultChart = DEFAULT_CHART[activity.type];
      const isDefaultAvailable = defaultChart && availableCharts.some((c) => c.id === defaultChart);
      const initialChart = isDefaultAvailable ? defaultChart : availableCharts[0].id;
      setSelectedCharts([initialChart]);
      setChartsInitialized(true);
    }
  }, [availableCharts, chartsInitialized, activity]);

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
    const isCycling = isCyclingActivity(activity.type);
    const zoneColors = isCycling ? POWER_ZONE_COLORS : HR_ZONE_COLORS;

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
        color = '#4CAF50';
      } else if (isWarmup) {
        key = 'WU';
        label = 'WU';
        color = '#22C55E';
      } else if (isCooldown) {
        key = 'CD';
        label = 'CD';
        color = '#8B5CF6';
      } else {
        key = interval.type;
        label = interval.type.slice(0, 3);
        color = '#808080';
      }

      if (chipMap.has(key)) {
        const idx = chipMap.get(key)!;
        chips[idx].count++;
        chips[idx].totalTime += interval.moving_time;
      } else {
        chipMap.set(key, chips.length);
        chips.push({ label, color, count: 1, totalTime: interval.moving_time });
      }
    }
    return chips;
  }, [intervalsData, activity]);

  return (
    <>
      <ScrollView
        testID="activity-charts-scrollview"
        style={styles.tabScrollView}
        contentContainerStyle={styles.tabScrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartInteracting}
      >
        {availableCharts.length > 0 && (
          <View style={styles.chartSection}>
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
              <TouchableOpacity
                style={[styles.fullscreenButton, isDark && styles.expandButtonDark]}
                onPress={openChartFullscreen}
                activeOpacity={0.7}
                accessibilityLabel="Fullscreen chart"
                accessibilityRole="button"
              >
                <MaterialCommunityIcons
                  name="fullscreen"
                  size={16}
                  color={isDark ? colors.textOnDark : colors.textPrimary}
                />
              </TouchableOpacity>
            </View>

            {/* Chart */}
            {streams && selectedCharts.length > 0 && (
              <View style={[styles.chartCard, isDark && styles.cardDark]}>
                <CombinedPlot
                  streams={streams}
                  selectedCharts={selectedCharts}
                  chartConfigs={CHART_CONFIGS}
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

                {/* Intervals zone bar */}
                {intervalsData?.icu_intervals && intervalsData.icu_intervals.length > 0 && (
                  <View testID="activity-interval-table">
                    <>
                      <TouchableOpacity
                        style={[styles.intervalsBar, isDark && styles.intervalsBarDark]}
                        onPress={() => setIntervalsExpanded((v) => !v)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.intervalsBarLeft}>
                          <Text style={[styles.intervalsTitle, isDark && styles.textMuted]}>
                            {t('activityDetail.tabs.intervals')}
                          </Text>
                          {intervalZoneSummary.map((z, i) => (
                            <View
                              key={i}
                              style={[styles.zoneChip, { backgroundColor: z.color + '25' }]}
                            >
                              <View style={[styles.zoneDot, { backgroundColor: z.color }]} />
                              <Text style={[styles.zoneChipText, { color: z.color }]}>
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
                      </TouchableOpacity>
                      {intervalsExpanded && (
                        <IntervalsTable
                          intervals={intervalsData.icu_intervals}
                          activityType={activity.type}
                          isMetric={isMetric}
                          isDark={isDark}
                        />
                      )}
                    </>
                  </View>
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
                  <HRZonesChart
                    streams={streams}
                    activityType={activity.type}
                    activity={activity}
                  />
                </ComponentErrorBoundary>
              </View>
            )}

            {/* Power Zones Chart */}
            {activity.icu_zone_times && activity.icu_zone_times.length > 0 && (
              <View style={[styles.chartCard, isDark && styles.cardDark]}>
                <ComponentErrorBoundary componentName="Power Zones Chart">
                  <PowerZonesChart activity={activity} />
                </ComponentErrorBoundary>
              </View>
            )}
          </View>
        )}

        {/* Insightful Stats */}
        <ComponentErrorBoundary componentName="Activity Stats">
          <InsightfulStats activity={activity} wellness={activityWellness} />
        </ComponentErrorBoundary>

        {/* Export GPX button */}
        {coordinates.length > 0 && (
          <TouchableOpacity
            testID="activity-export-gpx"
            style={[styles.exportGpxButton, isDark && styles.exportGpxButtonDark]}
            onPress={onExportGpx}
            disabled={gpxExporting}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={gpxExporting ? 'progress-download' : 'download'}
              size={20}
              color={colors.textOnPrimary}
            />
            <Text style={styles.exportGpxButtonText}>
              {gpxExporting ? t('export.exporting') : t('export.gpx')}
            </Text>
          </TouchableOpacity>
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
            const warnings: Array<{
              level: 'warn' | 'error';
              message: string;
            }> = [];
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
            <TouchableOpacity
              style={[
                styles.fullscreenCloseButton,
                { top: Math.max(insets.top, insets.left, 16) + 8 },
              ]}
              onPress={closeChartFullscreen}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="close"
                size={24}
                color={isDark ? colors.textOnDark : colors.textPrimary}
              />
            </TouchableOpacity>

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
                  selectedCharts={selectedCharts}
                  chartConfigs={CHART_CONFIGS}
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

const styles = StyleSheet.create({
  tabScrollView: {
    flex: 1,
  },
  tabScrollContent: {
    paddingBottom: spacing.xl + 80,
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
  expandButtonDark: {
    backgroundColor: opacity.overlayDark.heavy,
  },
  chartCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.cardPadding,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: spacing.sm,
    elevation: 2,
    minHeight: 180,
    overflow: 'hidden',
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  intervalsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  intervalsBarDark: {
    borderTopColor: darkColors.border,
  },
  intervalsBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flex: 1,
    gap: 4,
  },
  intervalsTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginRight: 2,
  },
  zoneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
  },
  zoneDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  zoneChipText: {
    fontSize: 10,
    fontWeight: '600',
  },
  deviceAttributionContainer: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  fullscreenButton: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadius,
    backgroundColor: opacity.overlay.light,
    justifyContent: 'center',
    alignItems: 'center',
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
    width: 44,
    height: 44,
    borderRadius: 22,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  exportGpxButtonDark: {
    backgroundColor: colors.primary,
  },
  exportGpxButtonText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
});
