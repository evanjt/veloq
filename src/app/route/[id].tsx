import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { View, ScrollView, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { isEngineReady } from '@/shared/native/engine';
import {
  useRouteDetailData,
  useRouteDetailPerformance,
  DataRangeFooter,
  DetailFallback,
  PlaceNameButton,
  RouteDetailMap,
  SportTypeSelector,
  SectionContentArea,
  RouteDetailDebugPanel,
  routeDetailScreenStyles as styles,
  createMapHighlightStore,
  useRouteMapSignatures,
  useRouteReference,
  useExcludedActivities,
  useRouteRenaming,
  useSectionChartData,
  useSectionChartDataEnriched,
  useSectionMapData,
  useSectionTimeStreamSync,
  sectionStreamsState,
  buildRouteGroupBase,
  buildFinalRouteGroup,
  routeHeadline,
  heroStats,
  toActivityType,
  toPerformanceView,
  EMPTY_PERFORMANCE_VIEW,
  RANGE_DAYS,
  isSportOffered,
  shouldShowSportChips,
  type SectionDeltaLine,
  type SectionTimeRange,
} from '@/features/routes';
import { useGpxExport, useDebugStore } from '@/features/settings';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import {
  Button,
  DetailHero,
  EngineReadFailure,
  HeroNameRow,
  HeroStatsRow,
  useHeroMapHeight,
  useTabBarClearance,
} from '@/shared/ui';

import { useFFITimer } from '@/shared/debug/useFFITimer';
import { getActivityColor, getActivityIcon } from '@/shared/activity/activityUtils';
import { decodeCoords, PlaceNameKind } from 'veloqrs';
import type {
  FfiAttemptHistograms,
  FfiSectionChartPoint,
  FfiSectionCorrelation,
  FfiSectionSportCount,
  FfiSectionTrendCurves,
} from 'veloqrs';
import { colors, spacing } from '@/theme';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const EMPTY_SPORT_COUNTS: FfiSectionSportCount[] = [];
const EMPTY_EXCLUDED_POINTS: FfiSectionChartPoint[] = [];
const NO_CORRELATIONS: FfiSectionCorrelation[] = [];
/** Until the attempt times are read there is no trend to draw. */
const NO_TREND_CURVES: FfiSectionTrendCurves = {};
const NO_HISTOGRAMS: FfiAttemptHistograms = {};
const NO_ACTIVITY_IDS: string[] = [];

/** A route opens on every attempt it has, whatever its age. */
const ROUTE_DEFAULT_RANGE: SectionTimeRange = 'all';

function RouteDetailScreenContent() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('RouteDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { id, activityId: navActivityId } = useLocalSearchParams<{
    id: string;
    activityId?: string;
  }>();
  const { isDark } = useTheme();
  const tabBarClearance = useTabBarClearance();
  const isMetric = useMetricSystem();
  const insets = useSafeAreaInsets();
  const mapHeight = useHeroMapHeight();

  // One engine call covering the route, its ranking list, every attempt, the
  // representative polyline, names, exclusions and signatures.
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const refreshDetail = useCallback(() => setDetailRefreshKey((k) => k + 1), []);
  const { data: detail, status: detailStatus } = useRouteDetailData(
    id,
    navActivityId,
    detailRefreshKey
  );

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays(detail?.activityCount);
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  // The chart's scrub lives outside this component, so a new index renders the
  // map and not the screen. Nothing here reads it.
  const [highlight] = useState(createMapHighlightStore);

  const engineGroup = detail?.group;

  // The delta curves are drawn from the attempts' time streams, so the gap the
  // detail read reported is fetched while the chart draws from moving times.
  const streamSync = useSectionTimeStreamSync(
    engineGroup?.activityIds ?? NO_ACTIVITY_IDS,
    detail?.missingTimeStreamIds
  );
  // With none missing there is nothing to wait for, so the read is made once.
  const noneMissing = !detail?.missingTimeStreamIds.length;
  const streams = sectionStreamsState(noneMissing ? { ...streamSync, ready: true } : streamSync);
  // A curve is measured on every attempt's stream, so a wait that ended with
  // streams outstanding loads none: the plot waits for the retry that lands them.
  const streamsSettled = streams.status === 'ready';
  const [deltaLine, setDeltaLine] = useState<SectionDeltaLine | null>(null);

  // The attempt times for one sport and one range, in one read. With no pill
  // picked, the engine answers for the sport with the most attempts and says
  // which.
  const [routeTimeRange, setRouteTimeRange] = useState<SectionTimeRange>(ROUTE_DEFAULT_RANGE);
  const [selectedSportType, setSelectedSportType] = useState<string | undefined>(undefined);
  const { data: performance, error: performanceReadError } = useRouteDetailPerformance(
    id,
    RANGE_DAYS[routeTimeRange],
    selectedSportType,
    detailRefreshKey,
    streamsSettled
  );
  if (
    performance &&
    selectedSportType &&
    !isSportOffered(selectedSportType, performance.sportCounts)
  ) {
    setSelectedSportType(undefined);
  }
  const effectiveSportType = performance?.sportType ?? selectedSportType;
  const { isRunning } = useSectionMapData(effectiveSportType, null);
  const sportCounts = performance?.sportCounts ?? EMPTY_SPORT_COUNTS;
  const showSportChips = shouldShowSportChips(sportCounts);

  const { bestForwardRecord, bestReverseRecord, forwardStats, reverseStats } = useMemo(
    () => (performance ? toPerformanceView(performance.performances) : EMPTY_PERFORMANCE_VIEW),
    [performance]
  );
  const bestForwardIsRecord = performance?.bestForwardIsRecord ?? false;
  const bestReverseIsRecord = performance?.bestReverseIsRecord ?? false;

  // Representative route points, decoded from the bundle.
  const representativePoints = useMemo(() => {
    if (!detail?.encodedRepresentative) return null;
    const decoded = decodeCoords(detail.encodedRepresentative);
    if (decoded.length === 0) return null;
    return decoded.map((p) => ({ lat: p.latitude, lng: p.longitude }));
  }, [detail]);

  // Create a compatible routeGroup object with expected properties
  // Native RouteGroup uses groupId and customName.
  // Names are stored in Rust (user-set or auto-generated on creation/migration)
  const routeGroupBase = useMemo(() => buildRouteGroupBase(engineGroup), [engineGroup]);

  const { effectiveRepresentativeId, handleSetAsReference } = useRouteReference(
    id,
    engineGroup?.representativeId,
    t
  );

  const {
    isEditing,
    editName,
    setEditName,
    customName,
    nameInputRef,
    handleStartEditing,
    handleSaveName,
    handleCancelEdit,
  } = useRouteRenaming(id, routeGroupBase?.name, t, detail?.routeNames);

  // The representative's length and climbing describe the line on the map,
  // so the sport chip and the range do not move them.
  const routeStats = useMemo(() => routeHeadline(detail), [detail]);

  const { showExcluded, handleExcludeActivity, handleIncludeActivity, handleToggleShowExcluded } =
    useExcludedActivities(id, refreshDetail);

  const { chartData, bestTimeValue, firstActivityDate, lastActivityDate } = useSectionChartData({
    preComputedChart: performance?.chartData ?? null,
  });
  const excludedPoints = performance?.excludedPoints ?? EMPTY_EXCLUDED_POINTS;
  const { calendarSummary, combinedChartData } = useSectionChartDataEnriched({
    chartData,
    showExcluded,
    excludedPoints,
    preComputedCalendarSummary: performance?.calendarSummary ?? null,
    bestForwardRecord,
    bestReverseRecord,
  });

  // The chart's own attempts, so the hero and the chart under it never count
  // different things. Absent until the attempt times are read.
  const attemptCount = performance ? chartData.length : undefined;

  const signatures = useRouteMapSignatures(engineGroup, detail?.mapSignatures);

  // Final routeGroup with signature populated from representative points.
  const routeGroup = useMemo(
    () => buildFinalRouteGroup(routeGroupBase, representativePoints, routeStats.distance),
    [routeGroupBase, representativePoints, routeStats.distance]
  );

  if (!routeGroup) {
    return (
      <DetailFallback
        isDark={isDark}
        insetTop={insets.top}
        status={detailStatus}
        loading={!isEngineReady()}
        onRetry={refreshDetail}
        notFoundMessage={t('routeDetail.routeNotFound')}
      />
    );
  }

  const displayName = customName || routeGroup.name;

  // The sport on screen colours the icon and the map.
  const displayType = toActivityType(effectiveSportType);
  const activityColor = getActivityColor(displayType);
  const hasMapData = !!engineGroup?.activityIds.length;

  return (
    <View testID="route-detail-screen" style={[styles.container, isDark && styles.containerDark]}>
      <StatusBar barStyle="light-content" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: spacing.xl + tabBarClearance }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {performanceReadError !== undefined ? (
          <EngineReadFailure error={performanceReadError} testID="route-performance-failure" />
        ) : null}

        {/* Hero Map Section */}
        <DetailHero
          height={mapHeight}
          overlay={
            <>
              <HeroNameRow
                name={displayName}
                nameTestID="route-detail-name"
                icon={{
                  name: getActivityIcon(displayType),
                  color: activityColor,
                }}
                editable={{
                  isEditing,
                  editName,
                  inputRef: nameInputRef,
                  placeholder: t('routes.routeNamePlaceholder'),
                  testIDPrefix: 'route',
                  onStartEdit: handleStartEditing,
                  onSave: handleSaveName,
                  onCancel: handleCancelEdit,
                  onChange: setEditName,
                }}
                accessory={
                  detail?.canNameFromPlaces ? (
                    <PlaceNameButton
                      kind={PlaceNameKind.Route}
                      itemId={id}
                      testID="route-place-name-button"
                    />
                  ) : undefined
                }
              />
              <HeroStatsRow
                testID="route-detail-stats"
                stats={heroStats(
                  {
                    kind: 'route',
                    distanceMeters: routeStats.distance,
                    elevationGainMeters: routeStats.elevationGain,
                  },
                  {
                    count: attemptCount,
                    sport: effectiveSportType,
                    sportsOffered: sportCounts.length,
                    range: routeTimeRange,
                  },
                  t,
                  isMetric
                )}
              />
            </>
          }
        >
          <RouteDetailMap
            routeGroup={routeGroup}
            highlight={highlight}
            signatures={signatures}
            hasMapData={hasMapData}
            activityColor={activityColor}
            selectedSportType={effectiveSportType ? displayType : undefined}
            deltaLine={deltaLine}
          />
        </DetailHero>

        {showSportChips && (
          <SportTypeSelector
            options={sportCounts.map(({ sportType, count }) => ({ type: sportType, count }))}
            selectedType={effectiveSportType}
            onSelect={(st) => {
              // Tapping the pill already picked hands the choice back to the
              // engine's default.
              setSelectedSportType(selectedSportType === st ? undefined : st);
            }}
            isDark={isDark}
          />
        )}

        {!!engineGroup?.activityIds.length && (
          <SectionContentArea
            subject="route"
            efficiencyTrend={performance?.efficiencyTrend}
            isDark={isDark}
            correlations={performance?.correlations ?? NO_CORRELATIONS}
            correlationFloor={performance?.correlationFloor ?? 0}
            combinedChartData={combinedChartData}
            firstActivityDate={firstActivityDate}
            lastActivityDate={lastActivityDate}
            trendCurves={performance?.trendCurves ?? NO_TREND_CURVES}
            histograms={performance?.histograms ?? NO_HISTOGRAMS}
            curves={performance?.curves}
            onDeltaLineChange={setDeltaLine}
            streams={streams}
            forwardStats={forwardStats}
            reverseStats={reverseStats}
            bestForwardRecord={bestForwardRecord}
            bestReverseRecord={bestReverseRecord}
            bestForwardIsRecord={bestForwardIsRecord}
            bestReverseIsRecord={bestReverseIsRecord}
            calendarSummary={calendarSummary}
            effectiveSportType={effectiveSportType}
            isRunning={isRunning}
            activityColor={activityColor}
            navActivityId={navActivityId}
            effectiveReferenceId={effectiveRepresentativeId}
            showExcluded={showExcluded}
            hasExcluded={excludedPoints.length > 0}
            sectionTimeRange={routeTimeRange}
            onActivitySelect={highlight.set}
            onExcludeActivity={handleExcludeActivity}
            onIncludeActivity={handleIncludeActivity}
            onSetAsReference={handleSetAsReference}
            onToggleShowExcluded={handleToggleShowExcluded}
            onTimeRangeChange={setRouteTimeRange}
          />
        )}

        <View style={styles.listFooterContainer}>
          {representativePoints && representativePoints.length > 0 && (
            <Button
              testID="route-export-gpx"
              label={gpxExporting ? t('export.exporting') : t('export.gpx')}
              loading={gpxExporting}
              icon={
                <MaterialCommunityIcons name="download" size={20} color={colors.textOnPrimary} />
              }
              onPress={() =>
                exportGpx({
                  name: displayName,
                  points: representativePoints.map((p) => ({
                    latitude: p.lat,
                    longitude: p.lng,
                  })),
                  sport: effectiveSportType,
                })
              }
              disabled={gpxExporting}
              style={styles.exportGpxButton}
            />
          )}

          <DataRangeFooter days={cacheDays} isDark={isDark} />

          {debugEnabled && engineGroup && (
            <RouteDetailDebugPanel
              engineGroup={engineGroup}
              routeStats={routeStats}
              bestTime={bestTimeValue}
              pageMetrics={getPageMetrics()}
              isDark={isDark}
              isMetric={isMetric}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

export default withScreenBoundary(RouteDetailScreenContent, 'Route Detail');
