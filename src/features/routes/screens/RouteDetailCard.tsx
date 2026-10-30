/**
 * A route's card in its map sheet: the name, the date line and one line of numbers at Peek, then
 * the charts under their sport and range row, the attempts and the export below. The map the sheet sits over draws the route, and
 * reads what the card picks (the attempt, the sport on show, the line the delta plot colours)
 * from the host's entry, so a scrub renders the map and not the card.
 */
import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, type ViewInstance } from 'react-native';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { useTranslation } from 'react-i18next';
import {
  DataRangeFooter,
  DetailFallback,
  RouteDetailDebugPanel,
  routeDetailScreenStyles as styles,
} from '../components';
import { SectionContentArea, sectionStreamsState } from '../components/section';
import { useRouteDetailData } from '../hooks/useRouteDetailData';
import { useRouteDetailPerformance } from '../hooks/useSectionDetailData';
import {
  useRouteReference,
  useExcludedActivities,
  useRouteRenaming,
  useSectionChartData,
  useSectionChartDataEnriched,
} from '../hooks';
import {
  EMPTY_PERFORMANCE_VIEW,
  toPerformanceView,
  useSectionTimeStreamSync,
} from '../hooks/useSectionPerformances';
import {
  buildFinalRouteGroup,
  buildRouteGroupBase,
  representativePointsOf,
} from '../lib/buildRouteGroup';
import { routeHeadline } from '../lib/routeHeadline';
import { detailDateLine, detailPeekStats } from '../lib/detailPeek';
import { detailCardWriter } from '../lib/detailCardState';
import { isSportOffered, sportCountFor, sportMenuOptions } from '../lib/sectionSport';
import { RANGE_DAYS, type SectionTimeRange } from '../constants';
import { toActivityType } from '../types';
import type { SectionDeltaLine } from '../lib/deltaLayout';
import { useGpxExport, useDebugStore } from '@/features/settings';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { useMapSheetCardAddress, useMapSheetHostHeader } from '@/shared/app/MapSheetHost';
import { MapSheetCardCloseSpace } from '@/shared/app/MapSheetCards';
import { overMapHeaderOptions } from '@/shared/app/screenHeaders';
import { Button, ErrorState, HeroNameRow, HeroStatsRow, useBottomClearance } from '@/shared/ui';
import { heroPeekStyles } from '@/shared/ui/DetailHero';
import { FitText } from '@/shared/ui/FitText';
import { usePagerPageScrollProps } from '@/shared/ui/pagerPageScroll';

import { useFFITimer } from '@/shared/debug/useFFITimer';
import { getActivityColor, getActivityIcon } from '@/shared/activity/activityUtils';
import type {
  FfiAttemptHistograms,
  FfiSectionChartPoint,
  FfiSectionCorrelation,
  FfiSectionSportCount,
  FfiSectionTrendCurves,
} from 'veloqrs';
import { colors, darkColors, spacing } from '@/theme';

const EMPTY_SPORT_COUNTS: FfiSectionSportCount[] = [];
const EMPTY_EXCLUDED_POINTS: FfiSectionChartPoint[] = [];
const NO_CORRELATIONS: FfiSectionCorrelation[] = [];
/** Until the attempt times are read there is no trend to draw. */
const NO_TREND_CURVES: FfiSectionTrendCurves = {};
const NO_HISTOGRAMS: FfiAttemptHistograms = {};
const NO_ACTIVITY_IDS: string[] = [];

/** A route opens on every attempt it has, whatever its age. */
const ROUTE_DEFAULT_RANGE: SectionTimeRange = 'all';

export interface RouteDetailCardProps {
  /** The route's group id. */
  id: string;
  /** The activity the route was opened from, which the chart and the map key mark. */
  activityId?: string | undefined;
}

export function RouteDetailCard({ id, activityId: navActivityId }: RouteDetailCardProps) {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('RouteDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const bottomClearance = useBottomClearance();
  const pageScroll = usePagerPageScrollProps();
  const isMetric = useMetricSystem();
  const { hostKey, index: cardIndex } = useMapSheetCardAddress('route', id);
  const card = useMemo(() => detailCardWriter(hostKey, cardIndex), [hostKey, cardIndex]);

  // One engine call covering the route and its shown name, the representative
  // polyline, exclusions and signatures. Attempt times are a read of their own.
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const refreshDetail = useCallback(() => setDetailRefreshKey((k) => k + 1), []);
  const { data: detail, status: detailStatus } = useRouteDetailData(id, detailRefreshKey);

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays(detail?.activityCount);
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();
  const exportAnchor = useRef<ViewInstance>(null);

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
  // The line the delta plot colours is the map's to draw, so the card hands it over.
  const setDeltaLine = useCallback(
    (deltaLine: SectionDeltaLine | null) => card.setDeltaLine(deltaLine),
    [card]
  );

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
    streamsSettled,
    navActivityId
  );
  if (
    performance &&
    selectedSportType &&
    !isSportOffered(selectedSportType, performance.sportCounts)
  ) {
    setSelectedSportType(undefined);
  }
  const effectiveSportType = performance?.sportType ?? selectedSportType;
  const sportCounts = performance?.sportCounts ?? EMPTY_SPORT_COUNTS;
  const sportOptions = useMemo(() => sportMenuOptions(sportCounts), [sportCounts]);

  const { bestForwardRecord, bestReverseRecord, forwardStats, reverseStats } = useMemo(
    () => (performance ? toPerformanceView(performance.performances) : EMPTY_PERFORMANCE_VIEW),
    [performance]
  );
  const bestForwardIsRecord = performance?.bestForwardIsRecord ?? false;
  const bestReverseIsRecord = performance?.bestReverseIsRecord ?? false;

  // Representative route points, decoded from the bundle.
  const representativePoints = useMemo(() => representativePointsOf(detail), [detail]);

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
    handleChangeName,
    nameError,
    customName,
    nameInputRef,
    handleStartEditing,
    handleSaveName,
    handleCancelEdit,
  } = useRouteRenaming(id, engineGroup?.customName, t);

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

  // The count the sport dropdown shows for the sport on screen, so the hero and
  // the dropdown never count different things. Absent until the attempt times
  // are read.
  const attemptCount = performance
    ? (sportCountFor(sportCounts, effectiveSportType) ?? chartData.length)
    : undefined;

  // Final routeGroup with signature populated from representative points.
  const routeGroup = useMemo(
    () => buildFinalRouteGroup(routeGroupBase, representativePoints, routeStats.distance),
    [routeGroupBase, representativePoints, routeStats.distance]
  );

  const heroTitle = routeGroup ? customName || routeGroup.name : undefined;

  // The header floats over the map the sheet leaves, named after the route.
  const headerOptions = useMemo(
    () => overMapHeaderOptions({ title: heroTitle, isDark }),
    [heroTitle, isDark]
  );
  useMapSheetHostHeader(headerOptions);

  // The sport on screen colours and styles the map as well as the card.
  useEffect(() => {
    card.setSport(effectiveSportType);
  }, [card, effectiveSportType]);

  if (!routeGroup) {
    return (
      <DetailFallback
        isDark={isDark}
        status={detailStatus}
        onRetry={refreshDetail}
        notFoundMessage={t('routeDetail.routeNotFound')}
        peek="route"
      />
    );
  }

  const displayName = customName || routeGroup.name;

  // The sport on screen colours the icon and the map placeholder. Forward is drawn
  // in one colour of its own on every view of the page.
  const displayType = toActivityType(effectiveSportType);
  const activityColor = getActivityColor(displayType);

  const peekInput = {
    kind: 'route' as const,
    distanceMeters: routeStats.distance,
    scope: {
      count: attemptCount,
      sport: effectiveSportType,
      sportsOffered: sportCounts.length,
      range: routeTimeRange,
    },
    bestTimeSecs: bestTimeValue,
    firstDate: firstActivityDate,
    lastDate: lastActivityDate,
  };
  const dateLine = detailDateLine(peekInput, t);

  return (
    <View testID="route-detail-screen" style={styles.scrollView}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: spacing.xl + bottomClearance }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        {...pageScroll}
      >
        {/* Peek: what the lowest stop shows. */}
        <View testID="route-card-peek" style={heroPeekStyles.peek}>
          <HeroNameRow
            onSurface
            name={displayName}
            nameTestID="route-detail-name"
            accessory={<MapSheetCardCloseSpace />}
            icon={{
              name: getActivityIcon(displayType),
              color: activityColor,
            }}
            editable={{
              isEditing,
              editName,
              error: nameError,
              inputRef: nameInputRef,
              label: t('routes.routeNamePlaceholder'),
              testIDPrefix: 'route',
              onStartEdit: handleStartEditing,
              onSave: handleSaveName,
              onCancel: handleCancelEdit,
              onChange: handleChangeName,
            }}
          />
          {dateLine ? (
            <FitText
              testID="route-card-date-line"
              style={[
                heroPeekStyles.dateLine,
                peekStyles.dateLine,
                isDark && peekStyles.dateLineDark,
              ]}
            >
              {dateLine}
            </FitText>
          ) : null}
          <HeroStatsRow
            onSurface
            testID="route-detail-stats"
            stats={detailPeekStats(peekInput, t, isMetric)}
          />
        </View>

        {performanceReadError !== undefined ? (
          <ErrorState
            variant="inline"
            error={performanceReadError}
            onRetry={refreshDetail}
            testID="route-performance-failure"
            style={styles.readFailure}
          />
        ) : null}

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
            scatterFocus={performance?.scatterFocus}
            recordProgression={performance?.recordProgression}
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
            navActivityId={navActivityId}
            effectiveReferenceId={effectiveRepresentativeId}
            showExcluded={showExcluded}
            excludedCount={excludedPoints.length}
            sectionTimeRange={routeTimeRange}
            onActivitySelect={card.selectAttempt}
            onExcludeActivity={handleExcludeActivity}
            onIncludeActivity={handleIncludeActivity}
            onSetAsReference={handleSetAsReference}
            onToggleShowExcluded={handleToggleShowExcluded}
            onTimeRangeChange={setRouteTimeRange}
            sportOptions={sportOptions}
            onSelectSport={(st) => {
              // Tapping the pill already picked hands the choice back to the engine's default.
              setSelectedSportType(selectedSportType === st ? undefined : st);
            }}
          />
        )}

        <View style={styles.listFooterContainer}>
          {representativePoints && representativePoints.length > 0 ? (
            <Button
              ref={exportAnchor}
              testID="route-export-gpx"
              variant="secondary"
              label={gpxExporting ? t('export.exporting') : t('export.gpx')}
              loading={gpxExporting}
              icon={{ chrome: 'share' }}
              onPress={() =>
                exportGpx({
                  name: displayName,
                  points: representativePoints.map((p) => ({
                    latitude: p.lat,
                    longitude: p.lng,
                  })),
                  sport: effectiveSportType,
                  anchor: exportAnchor,
                })
              }
              disabled={gpxExporting}
              style={styles.exportGpxButton}
            />
          ) : null}

          <DataRangeFooter days={cacheDays} isDark={isDark} />

          {debugEnabled && engineGroup ? (
            <RouteDetailDebugPanel
              engineGroup={engineGroup}
              routeStats={routeStats}
              bestTime={bestTimeValue}
              pageMetrics={getPageMetrics()}
              isDark={isDark}
              isMetric={isMetric}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const peekStyles = StyleSheet.create({
  dateLine: {
    color: colors.textSecondary,
  },
  dateLineDark: {
    color: darkColors.textSecondary,
  },
});
