/**
 * Section detail page.
 * Shows a frequently-traveled section with all activities that traverse it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Stack, useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useAfterNavigationTransition } from '@/shared/async/useAfterNavigationTransition';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { FLOW_SECTION_OPEN, completeFlowAfterFrame } from '@/shared/debug/flowTiming';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  useSectionActions,
  useRouteSettings,
  useSectionChartData,
  useSectionTimeStreamSync,
  toPerformanceRecord,
  toPerformanceView,
  EMPTY_PERFORMANCE_VIEW,
  RANGE_DAYS,
  useSectionDetailData,
  useSectionDetailPerformance,
  useSectionDataRefresh,
  useSectionUIState,
  useSectionMergeFlow,
  useSectionChartDataEnriched,
  useSectionTrim,
  useSectionLedger,
  hasPartialExclusion,
  DataRangeFooter,
  DetailFallback,
  isSportOffered,
  rescanRefusalKey,
  shouldShowSportChips,
  SectionTrimOverlay,
  SportTypeSelector,
  useRevealMapOnDraw,
  createMapHighlightStore,
  SectionHeader,
  sectionHeroName,
  SectionActionRow,
  SectionContentArea,
  forwardDirectionColour,
  sectionStreamsState,
  type SectionDeltaLine,
  SectionDebugPanel,
  SectionDetailLinks,
  sectionDetailStyles as styles,
} from '@/features/routes';
import { useGpxExport, useDebugStore } from '@/features/settings';
import { useTheme } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { overMapHeaderOptions } from '@/shared/app/screenHeaders';
import { MapHeroStatusBar, useHeroScrolledPast } from '@/shared/app/MapHeroStatusBar';
import { useReadRetry } from '@/shared/native/useEngineSubscription';
import { useFFITimer } from '@/shared/debug/useFFITimer';
import { Button, EmptyState, ErrorState, useHeroMapHeight, useBottomClearance } from '@/shared/ui';
import { type MaterialIconName } from '@/shared/activity/activityUtils';
import { colors, darkColors, iconSize, spacing, themePalette } from '@/theme';
import type { RoutePoint } from '@/types';
import type {
  FfiSectionChartPoint,
  FfiSectionCorrelation,
  FfiSectionSportCount,
  FfiAttemptHistograms,
  FfiSectionTrendCurves,
} from 'veloqrs';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { tapTo } from '@/shared/app/navigation';

/** Trimming needs room to place the handles, so the map grows past the hero fraction. */
const EDIT_MAP_FRACTION = 0.6;

const EMPTY_SPORT_COUNTS: FfiSectionSportCount[] = [];
const NO_CORRELATIONS: FfiSectionCorrelation[] = [];
const EMPTY_EXCLUDED_POINTS: FfiSectionChartPoint[] = [];

/** Until the lap times are read there is no trend to draw. */
const NO_TREND_CURVES: FfiSectionTrendCurves = {};
const NO_HISTOGRAMS: FfiAttemptHistograms = {};

function SectionDetailScreenContent() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('SectionDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  useEffect(() => {
    completeFlowAfterFrame(FLOW_SECTION_OPEN);
  }, []);

  const { t } = useTranslation();
  const {
    id,
    activityId: navActivityId,
    previewVersion,
  } = useLocalSearchParams<{
    id: string;
    activityId?: string;
    previewVersion?: string;
  }>();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const bottomClearance = useBottomClearance();
  const mapHeight = useHeroMapHeight();
  const editMapHeight = useHeroMapHeight(EDIT_MAP_FRACTION);

  // Everything the screen can paint before its time streams land, in one call.
  const [sectionRefreshTick, setSectionRefreshTick] = useState(0);
  const [deltaLine, setDeltaLine] = useState<SectionDeltaLine | null>(null);
  const bumpSectionRefresh = useCallback(() => setSectionRefreshTick((k) => k + 1), []);
  const hasFocused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (hasFocused.current) bumpSectionRefresh();
      hasFocused.current = true;
    }, [bumpSectionRefresh])
  );
  const {
    data: detail,
    status: detailStatus,
    retirement,
    allActivityTraces,
  } = useSectionDetailData(id, sectionRefreshTick);

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays(detail?.activityCount);
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();
  const exportAnchor = useRef<View>(null);

  // Nearby sections and merge candidates
  const mergeCandidates = detail?.mergeCandidates ?? [];

  const {
    mapReady,
    setMapReady,
    sectionTimeRange,
    setSectionTimeRange,
    selectedSportType,
    setSelectedSportType,
  } = useSectionUIState();

  useAfterNavigationTransition(useCallback(() => setMapReady(true), [setMapReady]));

  const { section, sectionRefreshKey, handleTrimRefresh } = useSectionDataRefresh(detail?.section);
  const isCustomSection = section?.sectionType === 'custom';
  const startMerge = useSectionMergeFlow({ section, candidates: mergeCandidates });

  // Trims, renames and exclusions invalidate the bundle as well as the hook's
  // own key, so both move together.
  const handleSectionRefresh = useCallback(() => {
    handleTrimRefresh();
    bumpSectionRefresh();
  }, [handleTrimRefresh, bumpSectionRefresh]);

  // Disabled state from section data
  const isSectionDisabled = !!(section?.disabled || section?.supersededBy);

  // The ledger: stored versions, the pin, and every change with its context.
  // The bundle carries the ledger flat, the hook takes it as one value.
  const bundledLedger = useMemo(
    () =>
      detail
        ? {
            history: detail.history,
            geometryVersions: detail.geometryVersions,
            pinnedVersion: detail.pinnedVersion,
          }
        : undefined,
    [detail]
  );
  const ledger = useSectionLedger(id, bundledLedger);
  const previewNumber = Number(previewVersion);
  const shownVersion = previewVersion && Number.isInteger(previewNumber) ? previewNumber : null;
  const shadowTrack = useMemo<[number, number][] | undefined>(() => {
    if (shownVersion == null) return undefined;
    return ledger.versionPolyline(shownVersion).map((p) => [p.lat, p.lng]);
  }, [shownVersion, ledger]);

  const {
    isTrimming,
    isExpanded: isExpandMode,
    trimStart,
    trimEnd,
    isSaving: isTrimSaving,
    trimmedDistance,
    canReset: canResetBounds,
    effectivePointCount,
    sectionStartInWindow,
    sectionEndInWindow,
    expandContextPoints,
    startTrim,
    cancelTrim,
    confirmTrim,
    resetBounds,
    toggleExpand,
    setTrimStart,
    setTrimEnd,
  } = useSectionTrim(section, handleSectionRefresh, detail?.hasOriginalBounds ?? false);

  // Section CRUD actions (rename, delete, toggle disable, exclude/include,
  // reference activity, rematch) - extracted into a hook for clarity.
  const {
    customName,
    effectiveReferenceId,
    showExcluded,
    isRematching,
    isRematchHeld,
    rescanRefusal,
    handleSaveName,
    handleDeleteSection,
    handleSetAsReference,
    handleToggleDisable,
    handleExcludeActivity,
    handleIncludeActivity,
    handleToggleShowExcluded,
    handleRematchActivities,
    handleAcceptSection,
    handleUnflagLift,
  } = useSectionActions({
    id,
    isCustomId: isCustomSection,
    section,
    isSectionDisabled,
    onSectionRefresh: handleSectionRefresh,
    sectionRefreshKey,
    preComputedExcludedActivityIds: detail?.excludedActivityIds,
  });
  const refusalKey = rescanRefusalKey(rescanRefusal);

  const scrollRef = useRef<ScrollView>(null);
  // The chart's scrub renders the map without moving the page or screen root.
  const [highlight] = useState(createMapHighlightStore);
  useRevealMapOnDraw(scrollRef, shownVersion);

  // Section times come from activity streams, so wait for the gap the bundle
  // reported to close before reading the records.
  const portionActivityIds = useMemo(() => {
    if (!section?.activityPortions) return [];
    return Array.from(new Set(section.activityPortions.map((p) => p.activityId)));
  }, [section]);
  const streamSync = useSectionTimeStreamSync(portionActivityIds, detail?.missingTimeStreamIds);
  const streamsReady = streamSync.ready;
  const streams = sectionStreamsState(streamSync);

  // Second call: everything that needs lap times. With no chip picked, the
  // engine answers for the sport with the most outings and says which.
  const [performanceAttempt, retryPerformance] = useReadRetry();
  const { data: performance, error: performanceReadError } = useSectionDetailPerformance(
    id,
    RANGE_DAYS[sectionTimeRange],
    selectedSportType,
    streamsReady,
    performanceAttempt,
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
  const showSportChips = shouldShowSportChips(sportCounts);

  const { bestForwardRecord, bestReverseRecord, forwardStats, reverseStats } = useMemo(
    () => (performance ? toPerformanceView(performance.performances) : EMPTY_PERFORMANCE_VIEW),
    [performance]
  );

  const { chartData, firstActivityDate, lastActivityDate } = useSectionChartData({
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

  // The chart's own laps at every range, so the header and the chart under it
  // never count different things. Absent until the lap times are read.
  const traversalCount = performance ? chartData.length : undefined;

  // Every lap of the sport, the excluded ones flagged, for the lap list and
  // its undo.
  const lapRecords = useMemo(
    () => (performance ? performance.lapRecords.map(toPerformanceRecord) : []),
    [performance]
  );
  const partlyExcluded = useMemo(() => hasPartialExclusion(lapRecords), [lapRecords]);

  // An activity still missing its stream could hold a faster effort, so a best
  // read without it is shown as a best and never as the record.
  const recordsSettled = streamSync.outstanding === 0;
  const bestForwardIsRecord = recordsSettled && (performance?.bestForwardIsRecord ?? false);
  const bestReverseIsRecord = recordsSettled && (performance?.bestReverseIsRecord ?? false);

  const heroTitle = section ? sectionHeroName(section, customName) : undefined;

  // Past the hero the page runs under the header, which then takes the theme's surface.
  const { scrolledPastHero, onScroll: onHeroScroll } = useHeroScrolledPast(
    isTrimming ? editMapHeight : mapHeight
  );

  // A fallback state takes the opaque header, so the hero puts the transparent one back, named
  // after the section.
  const heroHeaderOptions = useMemo(
    () => overMapHeaderOptions({ title: heroTitle, isDark, scrolledPastHero }),
    [heroTitle, isDark, scrolledPastHero]
  );

  if (!section) {
    return (
      <DetailFallback
        isDark={isDark}
        status={detailStatus}
        onRetry={bumpSectionRefresh}
        notFoundMessage={t('sections.sectionNotFound')}
        retired={
          retirement
            ? {
                title: t(`sectionHistory.kind_${retirement.kind}` as never),
                linkLabel: retirement.into
                  ? t('sectionHistory.retiredInto', {
                      name: retirement.intoName ?? retirement.into,
                    })
                  : undefined,
                onOpenLink: retirement.into
                  ? () => router.replace(`/section/${retirement.into}`)
                  : undefined,
              }
            : undefined
        }
      />
    );
  }

  const activityColor = palette.primary;
  const iconName: MaterialIconName = 'road-variant';

  return (
    <>
      <View
        testID="section-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <Stack.Screen options={heroHeaderOptions} />
        <MapHeroStatusBar scrolledPastHero={scrolledPastHero} isDark={isDark} />
        <ScrollView
          ref={scrollRef}
          style={styles.scrollView}
          contentContainerStyle={{ paddingBottom: spacing.xl + bottomClearance }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={onHeroScroll}
          scrollEventThrottle={16}
        >
          {/* Hero Map Section - expands when editing */}
          <SectionHeader
            section={section}
            mapHeight={isTrimming ? editMapHeight : mapHeight}
            activityColor={activityColor}
            iconName={iconName}
            activityCount={traversalCount}
            scopeSport={effectiveSportType}
            sportsOffered={sportCounts.length}
            sportType={effectiveSportType}
            scopeRange={sectionTimeRange}
            mapReady={mapReady}
            isTrimming={isTrimming}
            isExpandMode={isExpandMode}
            trimStart={trimStart}
            trimEnd={trimEnd}
            expandContextPoints={expandContextPoints}
            customName={customName}
            shadowTrack={shadowTrack}
            highlight={highlight}
            deltaLine={deltaLine}
            allActivityTraces={allActivityTraces}
            onUnflagLift={isTrimming ? undefined : handleUnflagLift}
            onSaveName={handleSaveName}
            canNameFromPlaces={detail?.canNameFromPlaces ?? false}
          />

          {performanceReadError !== undefined ? (
            <ErrorState
              variant="inline"
              error={performanceReadError}
              onRetry={retryPerformance}
              testID="section-performance-failure"
              style={styles.readFailure}
            />
          ) : null}

          {/* Action row - always visible below map, hidden during trim */}
          {!isTrimming && (
            <SectionActionRow
              isDark={isDark}
              isSectionDisabled={isSectionDisabled}
              isRematching={isRematching}
              isRematchHeld={isRematchHeld}
              section={section}
              startTrim={startTrim}
              handleDeleteSection={handleDeleteSection}
              handleToggleDisable={handleToggleDisable}
              handleRematchActivities={handleRematchActivities}
              handleAcceptSection={handleAcceptSection}
              pinnedVersion={ledger.pinnedVersion}
              partlyExcluded={partlyExcluded}
            />
          )}
          {!isTrimming && refusalKey !== null && (
            <View style={styles.rescanRefusal} testID="rescan-refused">
              <MaterialCommunityIcons
                name="information-outline"
                size={iconSize.xs}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
              <Text style={[styles.rescanRefusalText, isDark && styles.rescanRefusalTextDark]}>
                {t(refusalKey)}
              </Text>
            </View>
          )}

          {/* Trim panel - replaces chart when trimming */}
          {isTrimming ? (
            <SectionTrimOverlay
              pointCount={effectivePointCount || section.polyline?.length || 0}
              startIndex={trimStart}
              endIndex={trimEnd}
              trimmedDistance={trimmedDistance}
              originalDistance={section.distanceMeters}
              isSaving={isTrimSaving}
              canReset={canResetBounds}
              isExpandMode={isExpandMode}
              sectionStartInWindow={sectionStartInWindow}
              sectionEndInWindow={sectionEndInWindow}
              onStartChange={setTrimStart}
              onEndChange={setTrimEnd}
              onConfirm={confirmTrim}
              onCancel={cancelTrim}
              onReset={resetBounds}
              onToggleExpand={toggleExpand}
            />
          ) : null}

          {/* Sport type pills */}
          {!isTrimming && showSportChips ? (
            <SportTypeSelector
              options={sportCounts.map(({ sportType, count }) => ({ type: sportType, count }))}
              selectedType={effectiveSportType}
              onSelect={(st) => {
                // Tapping the chip already picked hands the choice back to the
                // engine's default.
                setSelectedSportType(selectedSportType === st ? undefined : st);
              }}
            />
          ) : null}

          {/* Content below hero - hidden during trim */}
          {!isTrimming && (
            <SectionContentArea
              efficiencyTrend={performance?.efficiencyTrend}
              correlations={performance?.correlations ?? NO_CORRELATIONS}
              correlationFloor={performance?.correlationFloor ?? 0}
              isDark={isDark}
              isSectionDisabled={isSectionDisabled}
              mergeCandidates={mergeCandidates}
              combinedChartData={combinedChartData}
              firstActivityDate={firstActivityDate}
              lastActivityDate={lastActivityDate}
              trendCurves={performance?.trendCurves ?? NO_TREND_CURVES}
              histograms={performance?.histograms ?? NO_HISTOGRAMS}
              curves={performance?.curves}
              onDeltaLineChange={setDeltaLine}
              forwardStats={forwardStats}
              reverseStats={reverseStats}
              bestForwardRecord={bestForwardRecord}
              bestReverseRecord={bestReverseRecord}
              bestForwardIsRecord={bestForwardIsRecord}
              bestReverseIsRecord={bestReverseIsRecord}
              recordsSettled={recordsSettled}
              calendarSummary={calendarSummary}
              effectiveSportType={effectiveSportType}
              forwardColour={forwardDirectionColour(isDark)}
              navActivityId={navActivityId}
              effectiveReferenceId={effectiveReferenceId}
              showExcluded={showExcluded}
              hasExcluded={excludedPoints.length > 0}
              sectionTimeRange={sectionTimeRange}
              onActivitySelect={highlight.set}
              onExcludeActivity={handleExcludeActivity}
              onIncludeActivity={handleIncludeActivity}
              onSetAsReference={handleSetAsReference}
              onToggleShowExcluded={handleToggleShowExcluded}
              onTimeRangeChange={setSectionTimeRange}
              streams={streams}
              onToggleDisable={handleToggleDisable}
              onMergePress={startMerge}
            >
              <SectionDetailLinks
                hasLaps={lapRecords.some((record) => record.laps.length > 1)}
                historyCount={ledger.history.length}
                onOpenLaps={() =>
                  tapTo({
                    pathname: '/section/laps/[id]',
                    params: { id, range: sectionTimeRange, sport: effectiveSportType ?? '' },
                  })
                }
                onOpenHistory={() => tapTo(`/section/history/${id}`)}
              />
            </SectionContentArea>
          )}

          {!isTrimming && (
            <View style={styles.listFooterContainer}>
              {section?.polyline?.length > 0 && (
                <Button
                  ref={exportAnchor}
                  testID="section-export-gpx"
                  variant="secondary"
                  label={gpxExporting ? t('export.exporting') : t('export.gpx')}
                  loading={gpxExporting}
                  icon={{ chrome: 'share' }}
                  onPress={() =>
                    exportGpx({
                      name: section.name || 'Section',
                      points: section.polyline.map((p: RoutePoint) => ({
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
              )}
              <DataRangeFooter days={cacheDays} isDark={isDark} />
              {debugEnabled && section ? (
                <SectionDebugPanel
                  section={section}
                  pageMetrics={getPageMetrics()}
                  isDark={isDark}
                />
              ) : null}
            </View>
          )}
        </ScrollView>
      </View>
    </>
  );
}

const disabledStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', backgroundColor: colors.background },
  containerDark: { backgroundColor: darkColors.background },
});

/** Sections are stored while route matching is off, and none of them opens. */
function SectionDetailScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const matchingEnabled = useRouteSettings((s) => s.settings.enabled);
  if (matchingEnabled) return <SectionDetailScreenContent />;
  return (
    <View
      testID="section-detail-disabled"
      style={[disabledStyles.container, isDark && disabledStyles.containerDark]}
    >
      <EmptyState
        icon="map-marker-off-outline"
        title={t('insights.routesDisabledLine1')}
        description={t('insights.routesDisabledDescription')}
        actionLabel={t('insights.routesDisabledLine2')}
        onAction={() => useRouteSettings.getState().setEnabled(true)}
      />
    </View>
  );
}

export default withScreenBoundary(SectionDetailScreen, 'Section Detail');
