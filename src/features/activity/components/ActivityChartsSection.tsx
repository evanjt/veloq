import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  ScrollView,
  Platform,
  StyleSheet,
  type LayoutChangeEvent,
  type ViewInstance,
} from 'react-native';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';
import { Text } from 'react-native-paper';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  SafeAreaProvider,
  useSafeAreaFrame,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import * as ScreenOrientation from 'expo-screen-orientation';
import { ActivityStreams } from './ActivityStreams';
import { ChartTypeSelector } from './ChartTypeSelector';
import { ChartXAxisSwitch, type ChartXAxisMode } from './ChartXAxisSwitch';
import { HRZonesChart } from './HRZonesChart';
import { PowerZonesChart } from './PowerZonesChart';
import { IntervalsTable } from './IntervalsTable';
import { ActivityProvenanceLine } from './ActivityProvenance';
import { InsightfulStats } from './stats';
import {
  BodyNotDownloaded,
  Button,
  Card,
  CardHeader,
  ComponentErrorBoundary,
  DeviceAttribution,
  DisclosureChevron,
  IconButton,
  PressTarget,
  RowDivider,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { DebugInfoPanel, DebugWarningBanner } from '@/features/routes';
import { intervalChips } from '../lib/intervalChips';
import { useFFITimer } from '@/shared/debug/useFFITimer';
import { measuresPower, isSwimmingActivity } from '@/shared/activity/activityUtils';
import type {
  ActivityHeldBack,
  HrZoneBand,
  PowerZoneBand,
  ActivityFitnessImpact,
  ActivityRecord,
  ActivityProvenance,
  ActivitySummary,
  MaxHrSource,
} from 'veloqrs';
import type { LatLng } from '@/shared/geo/polyline';
import type { EngineBodyStatus } from '@/shared/native/engineBodies';
import type { IntervalsOutcome } from '../hooks/useActivities';
import type { ActivityNewGround } from '../hooks/useActivitySectionHighlights';
import {
  getAvailableCharts,
  chartConfigsFor,
  CHART_CONFIGS,
} from '@/features/activity/lib/chartConfig';
import { fullscreenPlotFrame } from '@/features/activity/lib/fullscreenPlotFrame';
import { fullscreenPlotOrientation } from '@/features/activity/lib/fullscreenPlotOrientation';
import { formatDurationHuman } from '@/shared/format/format';
import { type ChartTypeId } from '@/features/activity/lib/chartConfig';
import {
  toActivityType,
  type ActivityStreams as StreamsData,
  type ActivityInterval,
  type ActivityType,
  type WellnessData,
} from '@/types';
import {
  colorWithOpacity,
  colors,
  controlHeight,
  darkColors,
  iconSize,
  layers,
  layout,
  opacity,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';
import { ABSENT } from '@/shared/format/absent';
import { usePagerPageScrollProps } from '@/shared/ui/pagerPageScroll';

/** The chart an activity opens on: power where the sport measures it, pace for a swim. */
function defaultChartFor(type: ActivityType): ChartTypeId {
  if (measuresPower(type)) return 'power';
  if (isSwimmingActivity(type)) return 'pace';
  return 'heartrate';
}

interface ActivityChartsSectionProps {
  activity: ActivityRecord;
  activityId: string;
  streams: StreamsData | undefined;
  streamsDownloaded?: boolean | undefined;
  streamsStatus?: EngineBodyStatus | undefined;
  onRetryStreams?: (() => void) | undefined;
  intervalsData: ActivityInterval[] | undefined;
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
  /** Where `maxHR` came from, from the same read */
  maxHrSource?: MaxHrSource | undefined;
  fitnessImpact?: ActivityFitnessImpact | null | undefined;
  /** Tile coverage against earlier activities, for the new ground stat */
  newGround?: ActivityNewGround | undefined;
  /** The speed, times and cadence stored with the activity, from the detail screen read */
  summary?: ActivitySummary | undefined;
  /** The engine-resolved zone bands and time in each, from the detail screen read */
  hrZones?: HrZoneBand[] | undefined;
  /** The engine-resolved power zone bands in watts and time in each, from the detail screen read */
  powerZones?: PowerZoneBand[] | undefined;
  /** The intervals.icu id a web link may name, from the detail screen read */
  intervalsId?: string | null | undefined;
  provenance?: ActivityProvenance | null | undefined;
  /** The hold on the ride, from the detail screen read: its laps are not shared */
  heldBack?: ActivityHeldBack | null | undefined;
  /** The screen's opening transition has ended, so the content below the top chart may mount */
  transitionSettled: boolean;
  onPointSelect: (index: number | null) => void;
  onInteractionChange: (isInteracting: boolean) => void;
  /** Takes the export button, which the share sheet points at on iPad. */
  onExportGpx: (anchor: React.RefObject<ViewInstance | null>) => void;
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
  maxHrSource,
  fitnessImpact,
  newGround,
  summary,
  hrZones,
  powerZones,
  intervalsId,
  provenance,
  heldBack,
  transitionSettled,
  onPointSelect,
  onInteractionChange,
  onExportGpx,
}: ActivityChartsSectionProps) {
  const { t } = useTranslation();
  const pageScroll = usePagerPageScrollProps();
  const sport = toActivityType(activity.sportType);
  const { getPageMetrics } = useFFITimer();
  const exportAnchor = useRef<ViewInstance>(null);

  // Chart state
  const [selectedCharts, setSelectedCharts] = useState<ChartTypeId[]>([]);
  const [chartsInitialised, setChartsInitialised] = useState(false);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const [xAxisMode, setXAxisMode] = useState<ChartXAxisMode>('distance');
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

  const effectiveChartConfigs = useMemo(
    () => (activity ? chartConfigsFor(sport, summary?.cadenceUnit) : CHART_CONFIGS),
    [activity, sport, summary?.cadenceUnit]
  );

  // The streams this activity has data for, with speed or pace as its sport reads it.
  const availableCharts = useMemo(
    () => (activity ? getAvailableCharts(streams || {}, sport, effectiveChartConfigs) : []),
    [streams, activity, sport, effectiveChartConfigs]
  );

  // Determine effective x-axis mode and whether toggle is available
  const hasDistance = (streams?.distance?.length ?? 0) > 0;
  const hasTime = (streams?.time?.length ?? 0) > 0;
  const effectiveXAxisMode = !hasDistance ? 'time' : xAxisMode;
  const canToggleXAxis = hasDistance && hasTime;

  // Initialise with single default chart when data loads. Set during render
  // rather than in an effect, so the first frame with streams already carries it.
  if (!chartsInitialised && availableCharts.length > 0 && activity) {
    const defaultChart = defaultChartFor(sport);
    const isDefaultAvailable = availableCharts.some((c) => c.id === defaultChart);
    const initialChart = isDefaultAvailable ? defaultChart : availableCharts[0].id;
    setSelectedCharts([initialChart]);
    setChartsInitialised(true);
  }

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

  // A phone's landscape lock lives exactly as long as the full-screen view, so
  // closing it and unmounting the section with it open both hand the app back to
  // portrait. An iPad is not rotated for the plot and takes no lock either way.
  React.useEffect(() => {
    if (!isChartFullscreen) return undefined;
    const { lockOnOpen, lockOnClose } = PLOT_ORIENTATION;
    if (lockOnOpen !== null) void ScreenOrientation.lockAsync(lockOnOpen);
    return () => {
      if (lockOnClose !== null) void ScreenOrientation.lockAsync(lockOnClose);
    };
  }, [isChartFullscreen]);

  const openChartFullscreen = useCallback(() => setIsChartFullscreen(true), []);
  const closeChartFullscreen = useCallback(() => setIsChartFullscreen(false), []);

  // The key above the intervals table, one chip per zone or role in its band's fill, a
  // neutral chip with no dot for an interval that has no band.
  const intervalZoneSummary = useMemo(() => {
    if (!intervalsData || !activity) return [];
    const scale = measuresPower(sport) ? 'power' : 'hr';
    return intervalChips(intervalsData, scale, isDark, t);
  }, [intervalsData, activity, sport, isDark, t]);

  // Each block is gated on the source it reads. Only the chart needs a stream;
  // the intervals are a persisted column and both zone cards are the engine's
  // bands, which come from the activity body when no stream was fetched.
  const hasIntervals = (intervalsData?.length ?? 0) > 0;
  // A held ride's laps are not shared, so no download is owed for them.
  const intervalsHeld = !hasIntervals && heldBack != null;
  const intervalsOwed = !hasIntervals && !intervalsHeld && intervalsOutcome === 'pending';
  const hasHrZones = (hrZones?.length ?? 0) > 0;
  const hasPowerZones = (powerZones?.length ?? 0) > 0;
  const lanesShown = streams !== undefined && selectedCharts.length > 0;
  // Anything the card draws above the Intervals row, which a divider then separates it from.
  const chartAboveIntervals = !streamsDownloaded || availableCharts.length > 0 || lanesShown;
  const chartCardShown = chartAboveIntervals || hasIntervals || intervalsOwed || intervalsHeld;

  return (
    <>
      <ScrollView
        testID="activity-charts-scrollview"
        style={styles.tabScrollView}
        contentContainerStyle={styles.tabScrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!chartInteracting}
        {...pageScroll}
      >
        {!streamsDownloaded ||
        availableCharts.length > 0 ||
        hasIntervals ||
        intervalsOwed ||
        intervalsHeld ||
        hasHrZones ||
        hasPowerZones ? (
          <View style={styles.chartSection}>
            {/* One card holds the chart from its toggles down to the Intervals row. */}
            {chartCardShown ? (
              <View style={styles.cardFrame}>
                <Card variant="raised" padding="none" testID="activity-chart-card">
                  {availableCharts.length > 0 && (
                    <View style={styles.chartControls}>
                      <View style={styles.chartSelectorContainer}>
                        <ChartTypeSelector
                          available={availableCharts}
                          selected={selectedCharts}
                          onToggle={handleChartToggle}
                        />
                      </View>
                      <IconButton
                        style={styles.fullscreenButton}
                        onPress={openChartFullscreen}
                        accessibilityLabel={t('maps.openFullscreen')}
                      >
                        <Icon
                          name="fullscreen"
                          size={iconSize.sm}
                          color={isDark ? colors.textOnFill : colors.textPrimary}
                        />
                      </IconButton>
                    </View>
                  )}

                  {!streamsDownloaded ? (
                    <BodyNotDownloaded
                      testID="streams-not-downloaded"
                      style={styles.chartBody}
                      message={t('statsScreen.curveNotDownloaded')}
                      status={streamsStatus}
                      onRetry={() => onRetryStreams?.()}
                    />
                  ) : null}

                  {lanesShown && streams ? (
                    <>
                      {canToggleXAxis ? (
                        <ChartXAxisSwitch
                          value={effectiveXAxisMode}
                          onValueChange={setXAxisMode}
                          style={styles.chartHeader}
                        />
                      ) : null}
                      <View style={styles.streamsBody}>
                        <ActivityStreams
                          streams={streams}
                          elevationGain={activity.elevationGain}
                          selectedCharts={selectedCharts}
                          chartConfigs={effectiveChartConfigs}
                          onPointSelect={onPointSelect}
                          onInteractionChange={onInteractionChange}
                          xAxisMode={effectiveXAxisMode}
                          intervals={intervalsExpanded ? intervalsData : undefined}
                          activityType={sport}
                        />
                      </View>
                    </>
                  ) : null}

                  {/* The Intervals row. Its own source is the stored lap list, which is
                      persisted whether or not the streams were ever fetched. */}
                  {(intervalsOwed || intervalsHeld || hasIntervals) && chartAboveIntervals ? (
                    <RowDivider inset="none" />
                  ) : null}

                  {intervalsHeld ? (
                    <View style={styles.intervalsPending}>
                      <Text
                        testID="intervals-held-back"
                        style={[styles.intervalsMessage, isDark && styles.textSecondary]}
                      >
                        {t('activity.heldBack.title')}
                      </Text>
                    </View>
                  ) : null}

                  {intervalsOwed ? (
                    <BodyNotDownloaded
                      testID="intervals-not-downloaded"
                      style={styles.intervalsPending}
                      textStyle={[styles.intervalsMessage, isDark && styles.textSecondary]}
                      message={t('activityDetail.intervalsNotDownloaded')}
                      status={intervalsStatus}
                      onRetry={() => onRetryIntervals?.()}
                    />
                  ) : null}

                  {hasIntervals ? (
                    <View testID="activity-interval-table">
                      <PressTarget
                        accessibilityRole="button"
                        accessibilityLabel={t('activityDetail.tabs.intervals')}
                        accessibilityState={{ expanded: intervalsExpanded }}
                        style={styles.intervalsBar}
                        onPress={() => setIntervalsExpanded((v) => !v)}
                      >
                        <CardHeader
                          title={t('activityDetail.tabs.intervals')}
                          accessory={
                            <DisclosureChevron
                              expanded={intervalsExpanded}
                              size={iconSize.md}
                              color={isDark ? darkColors.textSecondary : colors.textSecondary}
                            />
                          }
                        />
                        {intervalZoneSummary.length > 0 && (
                          <View style={styles.intervalsChips}>
                            {intervalZoneSummary.map((z, i) => (
                              <View
                                key={i}
                                style={[
                                  styles.zoneChip,
                                  {
                                    backgroundColor:
                                      z.color != null
                                        ? colorWithOpacity(z.color, opacity.tint2)
                                        : isDark
                                          ? darkColors.fillNeutral
                                          : colors.fillNeutral,
                                  },
                                ]}
                              >
                                {z.color != null ? (
                                  <View style={[styles.zoneDot, { backgroundColor: z.color }]} />
                                ) : null}
                                <Text
                                  style={[styles.zoneChipText, isDark && styles.zoneChipTextDark]}
                                >
                                  {z.label} {t('units.times', { value: z.count })}{' '}
                                  {formatDurationHuman(z.totalTime)}
                                </Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </PressTarget>
                      {intervalsExpanded && intervalsData ? (
                        <IntervalsTable
                          intervals={intervalsData}
                          activityType={sport}
                          isMetric={isMetric}
                          isDark={isDark}
                        />
                      ) : null}
                    </View>
                  ) : null}
                </Card>
              </View>
            ) : null}

            {/* HR Zones Chart */}
            {hasHrZones ? (
              <View testID="activity-zone-chart" style={styles.cardFrame}>
                <Card variant="raised" padding="none">
                  <View style={styles.chartBody}>
                    <ComponentErrorBoundary part="hrZonesChart" debugName="HR Zones Chart">
                      <HRZonesChart
                        hrZones={hrZones}
                        maxHR={maxHR}
                        maxHrSource={maxHrSource}
                        movingTime={activity.movingTime}
                      />
                    </ComponentErrorBoundary>
                  </View>
                </Card>
              </View>
            ) : null}

            {/* Power Zones Chart */}
            {powerZones && hasPowerZones ? (
              <View style={styles.cardFrame}>
                <Card variant="raised" padding="none">
                  <View style={styles.chartBody}>
                    <ComponentErrorBoundary part="powerZonesChart" debugName="Power Zones Chart">
                      <PowerZonesChart
                        powerZones={powerZones}
                        ftp={activity.ftp}
                        movingTime={activity.movingTime}
                      />
                    </ComponentErrorBoundary>
                  </View>
                </Card>
              </View>
            ) : null}
          </View>
        ) : null}

        {belowFoldMounted ? (
          <>
            {/* Insightful Stats */}
            <ComponentErrorBoundary part="activityStats" debugName="Activity Stats">
              <InsightfulStats
                activity={activity}
                wellness={activityWellness}
                maxHR={maxHR}
                maxHrSource={maxHrSource}
                fitnessImpact={fitnessImpact}
                newGround={newGround}
                summary={summary}
                intervalsId={intervalsId}
                heldBack={heldBack}
              />
            </ComponentErrorBoundary>

            {/* Export GPX button */}
            {coordinates.length > 0 && (
              <Button
                ref={exportAnchor}
                testID="activity-export-gpx"
                variant="secondary"
                style={styles.exportGpxButton}
                onPress={() => onExportGpx(exportAnchor)}
                loading={gpxExporting}
                label={t('export.gpx')}
                icon={{ chrome: 'share' }}
              />
            )}

            {/* Device attribution */}
            {activity.deviceName ? (
              <View style={styles.deviceAttributionContainer}>
                <DeviceAttribution deviceName={activity.deviceName} />
              </View>
            ) : null}
            <ActivityProvenanceLine provenance={provenance} />

            {debugEnabled && activity
              ? (() => {
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
                  const gpsPoints = streams?.latlng ? streams.latlng.length / 2 : 0;
                  if (gpsPoints > 2000) {
                    warnings.push({
                      level: 'warn',
                      message: `Polyline points: ${gpsPoints}`,
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
                            value: activityId?.slice(0, 24) ?? ABSENT,
                          },
                          { label: 'Sport', value: activity.sportType ?? ABSENT },
                          {
                            label: 'GPS Points',
                            value: streams?.latlng ? String(gpsPoints) : ABSENT,
                          },
                          {
                            label: 'HR Samples',
                            value: streams?.heartrate ? String(streams.heartrate.length) : ABSENT,
                          },
                          {
                            label: 'Power Samples',
                            value: streams?.watts ? String(streams.watts.length) : ABSENT,
                          },
                          {
                            label: 'Cadence Samples',
                            value: streams?.cadence ? String(streams.cadence.length) : ABSENT,
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
                })()
              : null}
          </>
        ) : null}
      </ScrollView>

      {/* Fullscreen Chart Modal */}
      <FullWindowModal
        visible={isChartFullscreen}
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        supportedOrientations={PLOT_ORIENTATION.supportedOrientations}
        onRequestClose={closeChartFullscreen}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <FullscreenPlotLayout
              isDark={isDark}
              closeLabel={t('common.close')}
              onClose={closeChartFullscreen}
              controls={
                <View style={styles.fullscreenControlStack}>
                  <ChartTypeSelector
                    available={availableCharts}
                    selected={selectedCharts}
                    onToggle={handleChartToggle}
                    ground={isDark ? darkColors.surface : colors.surface}
                    centred
                  />
                  {canToggleXAxis ? (
                    <ChartXAxisSwitch
                      value={effectiveXAxisMode}
                      onValueChange={setXAxisMode}
                      style={styles.fullscreenXAxisSwitch}
                    />
                  ) : null}
                </View>
              }
              renderPlot={(plotHeight) =>
                streams && selectedCharts.length > 0 ? (
                  <ActivityStreams
                    streams={streams}
                    elevationGain={activity.elevationGain}
                    selectedCharts={selectedCharts}
                    chartConfigs={effectiveChartConfigs}
                    height={plotHeight}
                    onPointSelect={onPointSelect}
                    onInteractionChange={onInteractionChange}
                    xAxisMode={effectiveXAxisMode}
                    intervals={intervalsExpanded ? intervalsData : undefined}
                    activityType={sport}
                  />
                ) : null
              }
            />
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </FullWindowModal>
    </>
  );
});

/**
 * The full-screen plot's chrome and plot, laid out from the insets of the
 * full-screen window itself. Read here, under the Modal's own provider, they
 * belong to the Modal's window, which on Android is a separate dialog, and they
 * follow its rotation rather than the portrait screen behind it.
 */
function FullscreenPlotLayout({
  isDark,
  closeLabel,
  onClose,
  controls,
  renderPlot,
}: {
  isDark: boolean;
  closeLabel: string;
  onClose: () => void;
  controls: React.ReactNode;
  renderPlot: (plotHeight: number) => React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height: frameHeight } = useSafeAreaFrame();
  // The plot waits for the controls row to be measured: its height grows when
  // the chips wrap under a larger text size, and that height is the plot's.
  const [chromeHeight, setChromeHeight] = useState<number | null>(null);
  const frame = fullscreenPlotFrame(insets, frameHeight, chromeHeight ?? 0);
  const onControlsLayout = useCallback(
    (event: LayoutChangeEvent) => setChromeHeight(event.nativeEvent.layout.height),
    []
  );

  return (
    <View
      style={[
        styles.fullscreenContainer,
        isDark && styles.fullscreenContainerDark,
        {
          paddingTop: frame.padding.top,
          paddingRight: frame.padding.right,
          paddingBottom: frame.padding.bottom,
          paddingLeft: frame.padding.left,
        },
      ]}
    >
      <PressTarget
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
        style={[styles.fullscreenCloseButton, frame.closeButton]}
        onPress={onClose}
        hitSlop={CLOSE_SLOP}
      >
        <Icon
          name="close"
          size={iconSize.lg}
          color={isDark ? colors.textOnFill : colors.textPrimary}
        />
      </PressTarget>

      <View
        testID="fullscreen-chart-controls"
        style={styles.fullscreenControls}
        onLayout={onControlsLayout}
      >
        {controls}
      </View>

      {chromeHeight !== null && (
        // The lanes share the plot height down to a floor each, so many of
        // them in landscape scroll rather than clip.
        <ScrollView
          style={styles.fullscreenChartWrapper}
          contentContainerStyle={styles.fullscreenChartContent}
          showsVerticalScrollIndicator={false}
        >
          {renderPlot(frame.plotHeight)}
        </ScrollView>
      )}
    </View>
  );
}

const PLOT_ORIENTATION = fullscreenPlotOrientation({
  os: Platform.OS,
  isPad: Platform.OS === 'ios' && Platform.isPad,
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
    gap: spacing.xs,
    paddingStart: spacing.sm,
    paddingTop: spacing.xs,
  },
  chartSelectorContainer: {
    flex: 1,
  },
  cardFrame: {
    marginBottom: spacing.sm,
  },
  chartHeader: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  chartBody: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    minHeight: 180,
  },
  // The lanes set their own height, one lane height per selected stream.
  streamsBody: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  intervalsPending: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xsPlus,
  },
  // The card clips, so the bar is drawn at the tap target rather than reaching
  // it through slop.
  intervalsBar: {
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xsPlus,
    minHeight: layout.minTapTarget,
  },
  intervalsChips: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  intervalsMessage: {
    ...typography.badge,
    color: colors.textSecondary,
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
    ...typography.badge,
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
  },
  fullscreenContainerDark: {
    backgroundColor: darkColors.surface,
  },
  fullscreenCloseButton: {
    position: 'absolute',
    width: controlHeight.button,
    height: controlHeight.button,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: opacity.overlay.medium,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: layers.raised,
  },
  fullscreenControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: controlHeight.button,
    // Clears the close button on both sides, so the chips stay centred.
    paddingHorizontal: controlHeight.button + spacing.sm,
    paddingBottom: spacing.xs,
  },
  fullscreenControlStack: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  fullscreenXAxisSwitch: {
    alignSelf: 'stretch',
  },
  fullscreenChartWrapper: {
    flex: 1,
  },
  fullscreenChartContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  exportGpxButton: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
});
