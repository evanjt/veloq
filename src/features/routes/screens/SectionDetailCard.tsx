/**
 * A section's card in its map sheet: the name, the date line and one line of numbers at Peek,
 * then the performance panel under its sport and range row, the cards and the export below. The map the sheet sits over
 * draws the section, and reads what the card picks (the attempt, the sport on show, the line the
 * delta plot colours, the direction the chart is on) from the host's entry, so a scrub renders the
 * map and not the card. Editing the bounds is a tool on that map, which the card enters and the
 * map runs while the sheet is away.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, type ViewInstance } from 'react-native';
import { Text } from 'react-native-paper';
import { useFocusEffect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { FLOW_SECTION_OPEN, completeFlowAfterFrame } from '@/shared/debug/flowTiming';
import { DataRangeFooter, DetailFallback } from '../components';
import {
  SectionContentArea,
  SectionDebugPanel,
  SectionDetailLinks,
  SectionHeader,
  SectionOverflowMenu,
  SectionStatusLine,
  sectionDetailStyles as styles,
  sectionHeroName,
  sectionStreamsState,
} from '../components/section';
import { useRouteSettings } from '../stores/RouteSettingsStore';
import { useSectionActions } from '../hooks/useSectionActions';
import { useSectionChartData, useSectionChartDataEnriched } from '../hooks';
import { useSectionDetailData, useSectionDetailPerformance } from '../hooks/useSectionDetailData';
import { useSectionDataRefresh } from '../hooks/useSectionDataRefresh';
import { useSectionUIState } from '../hooks/useSectionUIState';
import { useSectionMergeFlow } from '../hooks/useSectionMergeFlow';
import { useSectionLedger } from '../hooks/useSectionLedger';
import {
  EMPTY_PERFORMANCE_VIEW,
  toPerformanceRecord,
  toPerformanceView,
  useSectionTimeStreamSync,
} from '../hooks/useSectionPerformances';
import { RANGE_DAYS } from '../constants';
import { hasPartialExclusion } from '../hooks/useSectionLaps';
import { isSportOffered, sportChipOptions } from '../lib/sectionSport';
import { rescanRefusalKey } from '../lib/rescanRefusal';
import { sectionActionChips } from '../lib/sectionActionChips';
import { sectionGradeStats } from '../lib/heroStats';
import { detailCardWriter } from '../lib/detailCardState';
import { useGpxExport, useDebugStore } from '@/features/settings';
import { useTheme } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { useMapSheetCardAddress, useMapSheetHostHeader } from '@/shared/app/MapSheetHost';
import { useOpenDetail } from '@/shared/app/MapSheetCards';
import { useMapSheetStop } from '@/shared/app/mapSheetStop';
import { overMapHeaderOptions } from '@/shared/app/screenHeaders';
import { useReadRetry } from '@/shared/native/useEngineSubscription';
import { useFFITimer } from '@/shared/debug/useFFITimer';
import { Button, EmptyState, ErrorState, HeroStatsRow, useBottomClearance } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { usePagerPageScrollProps } from '@/shared/ui/pagerPageScroll';
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

const EMPTY_SPORT_COUNTS: FfiSectionSportCount[] = [];
const NO_CORRELATIONS: FfiSectionCorrelation[] = [];
const EMPTY_EXCLUDED_POINTS: FfiSectionChartPoint[] = [];

/** Until the lap times are read there is no trend to draw. */
const NO_TREND_CURVES: FfiSectionTrendCurves = {};
const NO_HISTOGRAMS: FfiAttemptHistograms = {};

export interface SectionDetailCardProps {
  /** The section's id. */
  id: string;
  /** The activity the section was opened from, which the chart and the map key mark. */
  activityId?: string | undefined;
}

function SectionDetailCardContent({ id, activityId: navActivityId }: SectionDetailCardProps) {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('SectionDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const bottomClearance = useBottomClearance();
  const pageScroll = usePagerPageScrollProps();
  const { hostKey, index: cardIndex } = useMapSheetCardAddress('section', id);
  const card = useMemo(() => detailCardWriter(hostKey, cardIndex), [hostKey, cardIndex]);
  const { enterTool } = useMapSheetStop(hostKey);
  const openDetail = useOpenDetail();

  // Everything the card can paint before its time streams land, in one call.
  const [sectionRefreshTick, setSectionRefreshTick] = useState(0);
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
  const exportAnchor = useRef<ViewInstance>(null);

  // Nearby sections and merge candidates
  const mergeCandidates = detail?.mergeCandidates ?? [];

  const { sectionTimeRange, setSectionTimeRange, selectedSportType, setSelectedSportType } =
    useSectionUIState();

  const { section, sectionRefreshKey, handleTrimRefresh } = useSectionDataRefresh(detail?.section);
  const isCustomSection = section?.sectionType === 'custom';
  const startMerge = useSectionMergeFlow({ section, candidates: mergeCandidates });

  // Renames and exclusions invalidate the bundle as well as the hook's own key, so both move
  // together.
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
  // The open is timed to the frame that draws the visits, which the
  // performance read carries, not to the mount that shows the header alone.
  const visitsRead = performance != null;
  useEffect(() => {
    if (visitsRead) completeFlowAfterFrame(FLOW_SECTION_OPEN);
  }, [visitsRead]);
  const effectiveSportType = performance?.sportType ?? selectedSportType;
  const sportCounts = performance?.sportCounts ?? EMPTY_SPORT_COUNTS;
  const sportOptions = useMemo(() => sportChipOptions(sportCounts), [sportCounts]);

  // The sport on screen styles the map as well as the card.
  useEffect(() => {
    card.setSport(effectiveSportType);
  }, [card, effectiveSportType]);

  const { bestForwardRecord, bestReverseRecord, forwardStats, reverseStats } = useMemo(
    () => (performance ? toPerformanceView(performance.performances) : EMPTY_PERFORMANCE_VIEW),
    [performance]
  );

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

  // The bounds are edited on the map, so a section with no line to edit offers nothing to start.
  const canEditBounds = !!section?.polyline?.length;
  const startTrim = canEditBounds ? enterTool : undefined;

  // The header floats over the map the sheet leaves, named after the section. Its overflow menu
  // holds the section's actions, Edit bounds first.
  const sectionType = section?.sectionType;
  const headerOptions = useMemo(() => {
    const options = overMapHeaderOptions({ title: heroTitle, isDark });
    if (sectionType === undefined) return { ...options, headerRight: () => null };
    return {
      ...options,
      headerRight: () => (
        <SectionOverflowMenu
          sectionType={sectionType}
          isSectionDisabled={isSectionDisabled}
          isRematching={isRematching}
          isRematchHeld={isRematchHeld}
          onDelete={handleDeleteSection}
          onToggleDisable={handleToggleDisable}
          onRematch={handleRematchActivities}
          onEditBounds={startTrim}
          tint={options.headerTintColor}
        />
      ),
    };
  }, [
    heroTitle,
    isDark,
    sectionType,
    isSectionDisabled,
    isRematching,
    isRematchHeld,
    handleDeleteSection,
    handleToggleDisable,
    handleRematchActivities,
    startTrim,
  ]);
  useMapSheetHostHeader(headerOptions);

  if (!section) {
    return (
      <DetailFallback
        isDark={isDark}
        status={detailStatus}
        onRetry={bumpSectionRefresh}
        notFoundMessage={t('sections.sectionNotFound')}
        peek="section"
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

  const activityColor = palette.actionPrimary;
  const iconName: MaterialIconName = 'road-variant';
  const chips = sectionActionChips({
    sectionType: section.sectionType,
    isUserDefined: section.isUserDefined === true,
    pinnedVersion: ledger.pinnedVersion,
  });
  const grades = sectionGradeStats(section, t);
  const showsStatus = partlyExcluded || chips.pinned || chips.accept === 'accepted';
  const infoFooter =
    grades.length > 0 || showsStatus ? (
      <>
        {grades.length > 0 ? (
          <HeroStatsRow onSurface testID="section-detail-grades" stats={grades} />
        ) : null}
        <SectionStatusLine isDark={isDark} chips={chips} partlyExcluded={partlyExcluded} />
      </>
    ) : undefined;

  return (
    <View testID="section-detail-screen" style={styles.scrollView}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: spacing.xl + bottomClearance }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        {...pageScroll}
      >
        <SectionHeader
          section={section}
          activityColor={activityColor}
          iconName={iconName}
          activityCount={traversalCount}
          scopeSport={effectiveSportType}
          sportsOffered={sportCounts.length}
          scopeRange={sectionTimeRange}
          bestTimeSecs={bestTimeValue}
          firstDate={firstActivityDate}
          lastDate={lastActivityDate}
          customName={customName}
          onUnflagLift={handleUnflagLift}
          onSaveName={handleSaveName}
          onAccept={chips.accept === 'offer' ? handleAcceptSection : undefined}
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

        {refusalKey !== null && (
          <View style={styles.rescanRefusal} testID="rescan-refused">
            <Icon
              name="information-outline"
              size={iconSize.xs}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
            <Text style={[styles.rescanRefusalText, isDark && styles.rescanRefusalTextDark]}>
              {t(refusalKey)}
            </Text>
          </View>
        )}

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
          scatterFocus={performance?.scatterFocus}
          recordProgression={performance?.recordProgression}
          curves={performance?.curves}
          onDeltaLineChange={card.setDeltaLine}
          onShownDirectionChange={card.setShownDirection}
          forwardStats={forwardStats}
          reverseStats={reverseStats}
          bestForwardRecord={bestForwardRecord}
          bestReverseRecord={bestReverseRecord}
          bestForwardIsRecord={bestForwardIsRecord}
          bestReverseIsRecord={bestReverseIsRecord}
          recordsSettled={recordsSettled}
          calendarSummary={calendarSummary}
          effectiveSportType={effectiveSportType}
          navActivityId={navActivityId}
          effectiveReferenceId={effectiveReferenceId}
          showExcluded={showExcluded}
          excludedCount={excludedPoints.length}
          sectionTimeRange={sectionTimeRange}
          onActivitySelect={card.selectAttempt}
          onExcludeActivity={handleExcludeActivity}
          onIncludeActivity={handleIncludeActivity}
          onSetAsReference={handleSetAsReference}
          onToggleShowExcluded={handleToggleShowExcluded}
          onTimeRangeChange={setSectionTimeRange}
          streams={streams}
          sportOptions={sportOptions}
          onSelectSport={(st) => {
            // Tapping the chip already picked hands the choice back to the engine's default.
            setSelectedSportType(selectedSportType === st ? undefined : st);
          }}
          infoFooter={infoFooter}
          onToggleDisable={handleToggleDisable}
          onMergePress={startMerge}
        >
          <SectionDetailLinks
            hasLaps={lapRecords.some((record) => record.laps.length > 1)}
            historyCount={ledger.history.length}
            onOpenLaps={() =>
              openDetail({
                kind: 'section-laps',
                id,
                params: { range: sectionTimeRange, sport: effectiveSportType ?? '' },
              })
            }
            onOpenHistory={() => openDetail({ kind: 'section-history', id })}
          />
        </SectionContentArea>

        <View style={styles.listFooterContainer}>
          {section.polyline?.length > 0 && (
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
          {debugEnabled ? (
            <SectionDebugPanel section={section} pageMetrics={getPageMetrics()} isDark={isDark} />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const disabledStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
});

/** Sections are stored while route matching is off, and none of them opens. */
export function SectionDetailCard(props: SectionDetailCardProps) {
  const { t } = useTranslation();
  const matchingEnabled = useRouteSettings((s) => s.settings.enabled);
  if (matchingEnabled) return <SectionDetailCardContent {...props} />;
  return (
    <View testID="section-detail-disabled" style={disabledStyles.container}>
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
