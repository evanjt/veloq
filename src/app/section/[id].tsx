/**
 * Section detail page.
 * Shows a frequently-traveled section with all activities that traverse it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StatusBar, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, router } from 'expo-router';
import { useAfterNavigationTransition } from '@/shared/async/useAfterNavigationTransition';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { FLOW_SECTION_OPEN, completeFlowAfterFrame } from '@/shared/debug/flowTiming';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import {
  useMergeSections,
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
  useSectionActivityData,
  useSectionChartDataEnriched,
  useSectionMapData,
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
  SectionHeader,
  SectionActionRow,
  SectionContentArea,
  type SectionStreamsState,
  type SectionDeltaLine,
  SectionDebugPanel,
  SectionDetailLinks,
  MergeConfirmDialog,
  MergeCandidatesModal,
  sectionDetailStyles as styles,
} from '@/features/routes';
import { useGpxExport, useDebugStore } from '@/features/settings';
import { useTheme } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { isEngineReady } from '@/shared/native/engine';
import { useFFITimer } from '@/shared/debug/useFFITimer';
import { Button, EngineReadFailure, useHeroMapHeight } from '@/shared/ui';
import { type MaterialIconName } from '@/shared/activity/activityUtils';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { RoutePoint } from '@/types';
import type {
  FfiSectionChartPoint,
  FfiSectionCorrelation,
  FfiSectionSportCount,
  FfiAttemptHistograms,
  FfiSectionTrendCurves,
} from 'veloqrs';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

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
  const insets = useSafeAreaInsets();
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
  } = useSectionDetailData(id, sectionRefreshTick);

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays(detail?.activityCount);
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  // Nearby sections and merge candidates
  const mergeCandidates = detail?.mergeCandidates ?? [];
  const { merge: mergeSections, previewDropped } = useMergeSections();

  const {
    highlightedActivityId,
    setHighlightedActivityId,
    highlightedActivityPoints,
    setHighlightedActivityPoints,
    mapReady,
    setMapReady,
    mergeTarget,
    setMergeTarget,
    showMergePicker,
    setShowMergePicker,
    sectionTimeRange,
    setSectionTimeRange,
    selectedSportType,
    setSelectedSportType,
  } = useSectionUIState();

  useAfterNavigationTransition(useCallback(() => setMapReady(true), [setMapReady]));

  const { section, sectionRefreshKey, handleTrimRefresh } = useSectionDataRefresh(detail?.section);
  const isCustomSection = section?.sectionType === 'custom';

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
  const ledger = useSectionLedger(id, sectionRefreshKey, bundledLedger);
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
    isEditing,
    editName,
    customName,
    nameInputRef,
    setEditName,
    effectiveReferenceId,
    showExcluded,
    isRematching,
    isRematchHeld,
    rescanRefusal,
    handleStartEditing,
    handleSaveName,
    handleCancelEdit,
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
  useRevealMapOnDraw(scrollRef, highlightedActivityId);
  useRevealMapOnDraw(scrollRef, shownVersion);

  const handleActivitySelect = useCallback(
    (activityId: string | null, activityPoints?: RoutePoint[]) => {
      setHighlightedActivityId(activityId);
      setHighlightedActivityPoints(activityPoints);
    },
    [setHighlightedActivityId, setHighlightedActivityPoints]
  );

  // Memoised so a rename keystroke, which re-renders this screen, hands the
  // hook the same bundle wrapper rather than a fresh literal.
  const preComputedActivityData = useMemo(
    () => ({
      activityMetrics: detail?.activityMetrics ?? [],
      mapSignatures: detail?.mapSignatures ?? [],
    }),
    [detail]
  );

  // Section times come from activity streams, so wait for the gap the bundle
  // reported to close before reading the records.
  const portionActivityIds = useMemo(() => {
    if (!section?.activityPortions) return [];
    return Array.from(new Set(section.activityPortions.map((p) => p.activityId)));
  }, [section]);
  const {
    ready: streamsReady,
    error: streamsError,
    refetch: refetchStreams,
  } = useSectionTimeStreamSync(portionActivityIds, detail?.missingTimeStreamIds);

  const streams: SectionStreamsState = streamsError
    ? { status: 'failed', error: streamsError, onRetry: refetchStreams }
    : !streamsReady
      ? { status: 'loading', onRetry: refetchStreams }
      : { status: 'ready', onRetry: refetchStreams };

  // Second call: everything that needs lap times. With no chip picked, the
  // engine answers for the sport with the most outings and says which.
  const { data: performance, error: performanceReadError } = useSectionDetailPerformance(
    id,
    RANGE_DAYS[sectionTimeRange],
    selectedSportType,
    streamsReady
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

  const { allActivityTraces, filteredActivities } = useSectionActivityData(
    section,
    effectiveSportType,
    preComputedActivityData
  );

  const {
    records: performanceRecords,
    bestForwardRecord,
    bestReverseRecord,
    forwardStats,
    reverseStats,
  } = useMemo(
    () => (performance ? toPerformanceView(performance.performances) : EMPTY_PERFORMANCE_VIEW),
    [performance]
  );

  const { chartData } = useSectionChartData({
    section,
    performanceRecords,
    sectionActivitiesUnsorted: filteredActivities,
    sectionWithTraces: null,
    preComputedChart: performance?.chartData ?? null,
  });

  const excludedPoints = performance?.excludedPoints ?? EMPTY_EXCLUDED_POINTS;
  const { calendarSummary, combinedChartData } = useSectionChartDataEnriched({
    chartData,
    showExcluded,
    excludedPoints,
    preComputedCalendarSummary: performance?.calendarSummary ?? null,
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

  const { isRunning } = useSectionMapData(effectiveSportType, section);

  const computedForwardStats = forwardStats;
  const computedReverseStats = reverseStats;
  const computedBestForward = bestForwardRecord ?? null;
  const computedBestReverse = bestReverseRecord ?? null;
  const bestForwardIsRecord = performance?.bestForwardIsRecord ?? false;
  const bestReverseIsRecord = performance?.bestReverseIsRecord ?? false;

  if (!section) {
    return (
      <DetailFallback
        isDark={isDark}
        insetTop={insets.top}
        status={detailStatus}
        loading={!isEngineReady()}
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

  const activityColor = colors.primary;
  const iconName: MaterialIconName = 'road-variant';

  return (
    <>
      <View
        testID="section-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <StatusBar barStyle="light-content" />
        <ScrollView
          ref={scrollRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {performanceReadError !== undefined ? (
            <EngineReadFailure error={performanceReadError} testID="section-performance-failure" />
          ) : null}

          {/* Hero Map Section - expands when editing */}
          <SectionHeader
            section={section}
            insetTop={insets.top}
            mapHeight={isTrimming ? editMapHeight : mapHeight}
            activityColor={activityColor}
            iconName={iconName}
            activityCount={traversalCount}
            scopeSport={showSportChips ? effectiveSportType : undefined}
            sportType={effectiveSportType}
            scopeRange={sectionTimeRange}
            mapReady={mapReady}
            isTrimming={isTrimming}
            isExpandMode={isExpandMode}
            trimStart={trimStart}
            trimEnd={trimEnd}
            expandContextPoints={expandContextPoints}
            isEditing={isEditing}
            editName={editName}
            customName={customName}
            nameInputRef={nameInputRef}
            shadowTrack={shadowTrack}
            highlightedActivityId={highlightedActivityId}
            highlightedLapPoints={highlightedActivityPoints}
            deltaLine={deltaLine}
            allActivityTraces={allActivityTraces}
            onUnflagLift={isTrimming ? undefined : handleUnflagLift}
            onStartEditing={handleStartEditing}
            onSaveName={handleSaveName}
            onCancelEdit={handleCancelEdit}
            onEditNameChange={setEditName}
          />

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
                size={13}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
              <Text style={[styles.rescanRefusalText, isDark && styles.rescanRefusalTextDark]}>
                {t(refusalKey)}
              </Text>
            </View>
          )}

          {/* Trim panel - replaces chart when trimming */}
          {isTrimming && (
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
          )}

          {/* Sport type pills */}
          {!isTrimming && showSportChips && (
            <SportTypeSelector
              options={sportCounts.map(({ sportType, count }) => ({ type: sportType, count }))}
              selectedType={effectiveSportType}
              onSelect={(st) => {
                // Tapping the chip already picked hands the choice back to the
                // engine's default.
                setSelectedSportType(selectedSportType === st ? undefined : st);
              }}
              isDark={isDark}
            />
          )}

          {/* Content below hero - hidden during trim */}
          {!isTrimming && (
            <SectionContentArea
              efficiencyTrend={detail ? (detail.efficiencyTrend ?? null) : undefined}
              correlations={performance?.correlations ?? NO_CORRELATIONS}
              correlationFloor={performance?.correlationFloor ?? 0}
              isDark={isDark}
              section={section}
              isSectionDisabled={isSectionDisabled}
              mergeCandidates={mergeCandidates}
              combinedChartData={combinedChartData}
              trendCurves={performance?.trendCurves ?? NO_TREND_CURVES}
              histograms={performance?.histograms ?? NO_HISTOGRAMS}
              curves={performance?.curves}
              onDeltaLineChange={setDeltaLine}
              forwardStats={computedForwardStats}
              reverseStats={computedReverseStats}
              bestForwardRecord={computedBestForward}
              bestReverseRecord={computedBestReverse}
              bestForwardIsRecord={bestForwardIsRecord}
              bestReverseIsRecord={bestReverseIsRecord}
              calendarSummary={calendarSummary}
              effectiveSportType={effectiveSportType}
              isRunning={isRunning}
              activityColor={activityColor}
              navActivityId={navActivityId}
              effectiveReferenceId={effectiveReferenceId}
              showExcluded={showExcluded}
              hasExcluded={excludedPoints.length > 0}
              sectionTimeRange={sectionTimeRange}
              onActivitySelect={handleActivitySelect}
              onExcludeActivity={handleExcludeActivity}
              onIncludeActivity={handleIncludeActivity}
              onSetAsReference={handleSetAsReference}
              onToggleShowExcluded={handleToggleShowExcluded}
              onTimeRangeChange={setSectionTimeRange}
              streams={streams}
              onToggleDisable={handleToggleDisable}
              onMergePress={() => {
                if (mergeCandidates.length === 1) {
                  setMergeTarget(mergeCandidates[0]);
                } else {
                  setShowMergePicker(true);
                }
              }}
            >
              <SectionDetailLinks
                hasLaps={lapRecords.some((record) => record.laps.length > 1)}
                historyCount={ledger.history.length}
                onOpenLaps={() =>
                  router.push({
                    pathname: '/section/laps/[id]',
                    params: { id, range: sectionTimeRange, sport: effectiveSportType ?? '' },
                  })
                }
                onOpenHistory={() => router.push(`/section/history/${id}`)}
              />
            </SectionContentArea>
          )}

          {!isTrimming && (
            <View style={styles.listFooterContainer}>
              {section?.polyline?.length > 0 && (
                <Button
                  testID="section-export-gpx"
                  label={gpxExporting ? t('export.exporting') : t('export.gpx')}
                  loading={gpxExporting}
                  icon={
                    <MaterialCommunityIcons
                      name="download"
                      size={20}
                      color={colors.textOnPrimary}
                    />
                  }
                  onPress={() =>
                    exportGpx({
                      name: section.name || 'Section',
                      points: section.polyline.map((p: RoutePoint) => ({
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
              {debugEnabled && section && (
                <SectionDebugPanel
                  section={section}
                  pageMetrics={getPageMetrics()}
                  isDark={isDark}
                />
              )}
            </View>
          )}
        </ScrollView>
      </View>
      <MergeCandidatesModal
        visible={showMergePicker}
        candidates={mergeCandidates}
        onSelect={(candidate) => {
          setShowMergePicker(false);
          setMergeTarget(candidate);
        }}
        onCancel={() => setShowMergePicker(false)}
      />
      {mergeTarget && section && (
        <MergeConfirmDialog
          visible={!!mergeTarget}
          previewDropped={previewDropped}
          primary={{
            id: section.id,
            name: section.name ?? section.id,
            sportTypes: section.sportTypes,
            visitCount: section.visitCount,
            distanceMeters: section.distanceMeters,
          }}
          secondary={{
            id: mergeTarget.sectionId,
            name: mergeTarget.name ?? mergeTarget.sectionId,
            sportTypes: mergeTarget.sportTypes,
            visitCount: mergeTarget.visitCount,
            distanceMeters: mergeTarget.distanceMeters,
          }}
          onConfirm={(primaryId, secondaryId) => {
            const result = mergeSections(primaryId, secondaryId);
            setMergeTarget(null);
            if (result && result !== id) {
              router.replace(`/section/${result}`);
            }
          }}
          onCancel={() => setMergeTarget(null)}
        />
      )}
    </>
  );
}

const disabledStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  containerDark: { backgroundColor: darkColors.background },
  title: { fontSize: typography.body.fontSize, color: colors.textSecondary },
  link: { fontSize: typography.label.fontSize, color: colors.linkTeal, fontWeight: '500' },
  linkDark: { color: darkColors.linkTeal },
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
      <Text style={disabledStyles.title}>
        {t('insights.routesDisabledLine1', 'Routes & Sections disabled')}
      </Text>
      <Text
        style={[disabledStyles.link, isDark && disabledStyles.linkDark]}
        onPress={() => useRouteSettings.getState().setEnabled(true)}
      >
        {t('insights.routesDisabledLine2', 'Tap to enable')}
      </Text>
    </View>
  );
}

export default withScreenBoundary(SectionDetailScreen, 'Section Detail');
