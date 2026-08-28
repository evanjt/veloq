/**
 * Section detail page.
 * Shows a frequently-traveled section with all activities that traverse it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StatusBar,
  TouchableOpacity,
  InteractionManager,
  Alert,
} from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useMergeSections } from '@/features/routes/hooks/useMergeSections';
import { useNearbySections } from '@/features/routes/hooks/useNearbySections';
import { useSectionActions } from '@/features/routes/hooks/useSectionActions';
import { useSectionChartData } from '@/features/routes/hooks/useSectionChartData';
import {
  useSectionTimeStreamSync,
  toPerformanceView,
  EMPTY_PERFORMANCE_VIEW,
} from '@/features/routes/hooks/useSectionPerformances';
import { RANGE_DAYS } from '@/features/routes/constants';
import {
  useSectionDetailData,
  useSectionDetailPerformance,
  NEARBY_RADIUS_METERS,
} from '@/features/routes/hooks/useSectionDetailData';
import { useSectionDataRefresh } from '@/features/routes/hooks/useSectionDataRefresh';
import { useSectionUIState } from '@/features/routes/hooks/useSectionUIState';
import { useSectionActivityData } from '@/features/routes/hooks/useSectionActivityData';
import { useSectionChartDataEnriched } from '@/features/routes/hooks/useSectionChartDataEnriched';
import { useSectionMapData } from '@/features/routes/hooks/useSectionMapData';
import { useGpxExport } from '@/features/settings/hooks/exportIndex';
import { useTheme } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { useSectionTrim } from '@/features/routes/hooks/useSectionTrim';
import { useSectionLedger } from '@/features/routes/hooks/useSectionLedger';
import {
  DataRangeFooter,
  DetailFallback,
  SectionTrimOverlay,
  SportTypeSelector,
} from '@/features/routes';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { useFFITimer } from '@/shared/debug/useFFITimer';
import { ScreenErrorBoundary } from '@/shared/ui';
import {
  SectionHeader,
  SectionActionRow,
  SectionContentArea,
  SectionHistoryPanel,
  SectionDebugPanel,
  MergeConfirmDialog,
  MergeCandidatesModal,
} from '@/features/routes/components/section';
import {
  MAP_HEIGHT_NORMAL,
  MAP_HEIGHT_EDIT,
} from '@/features/routes/components/section/SectionHeader';
import { styles } from '@/features/routes/components/section/SectionDetail.styles';
import { type MaterialIconName } from '@/features/activity/lib/activityUtils';
import { colors } from '@/theme';
import type { RoutePoint } from '@/types';

export default function SectionDetailScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('SectionDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { id, activityId: navActivityId } = useLocalSearchParams<{
    id: string;
    activityId?: string;
  }>();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Everything the screen can paint before its time streams land, in one call.
  const [sectionRefreshTick, setSectionRefreshTick] = useState(0);
  const bumpSectionRefresh = useCallback(() => setSectionRefreshTick((k) => k + 1), []);
  const { data: detail } = useSectionDetailData(id, sectionRefreshTick);

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays(detail?.activityCount);
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  // Nearby sections and merge candidates
  const { nearby } = useNearbySections(id, NEARBY_RADIUS_METERS, detail?.nearby);
  const {
    candidates: mergeCandidates,
    merge: mergeSections,
    isMerging,
  } = useMergeSections(id, detail?.mergeCandidates);

  const {
    highlightedActivityId,
    setHighlightedActivityId,
    highlightedActivityPoints,
    setHighlightedActivityPoints,
    isScrubbing,
    setIsScrubbing,
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

  // Defer map loading until after interactions complete for faster perceived load
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setMapReady(true);
    });
    return () => handle.cancel();
  }, [setMapReady]);

  // Custom section IDs start with "custom_" (e.g., "custom_1767268142052_qyfoos8")
  const isCustomId = id?.startsWith('custom_');

  const { section, sectionRefreshKey, handleTrimRefresh } = useSectionDataRefresh(
    id,
    detail?.section
  );

  // Trims, renames and exclusions invalidate the bundle as well as the hook's
  // own key, so both move together.
  const handleSectionRefresh = useCallback(() => {
    handleTrimRefresh();
    bumpSectionRefresh();
  }, [handleTrimRefresh, bumpSectionRefresh]);

  // Disabled state from section data
  const isSectionDisabled = !!(section?.disabled || section?.supersededBy);

  // The ledger: stored versions, the pin, and every change with its context.
  const ledger = useSectionLedger(id, sectionRefreshKey);
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  const shadowTrack = useMemo<[number, number][] | undefined>(() => {
    if (shownVersion == null) return undefined;
    return ledger.versionPolyline(shownVersion).map((p) => [p.lat, p.lng]);
  }, [shownVersion, ledger]);
  const handleRevert = useCallback(
    (version: number) => {
      Alert.alert(t('sectionHistory.revert'), t('sectionHistory.revertConfirm', { version }), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('sectionHistory.revert'),
          onPress: () => {
            if (ledger.revert(version)) {
              setShownVersion(null);
              handleSectionRefresh();
            }
          },
        },
      ]);
    },
    [ledger, handleSectionRefresh, t]
  );
  const handleUnpin = useCallback(() => {
    if (ledger.unpin()) handleSectionRefresh();
  }, [ledger, handleSectionRefresh]);

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
  } = useSectionTrim(section, handleSectionRefresh, detail?.hasOriginalBounds);

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
    excludedActivityIds,
    isRematching,
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
  } = useSectionActions({
    id,
    isCustomId: !!isCustomId,
    section,
    isSectionDisabled,
    onSectionRefresh: handleSectionRefresh,
    sectionRefreshKey,
    preComputedExcludedActivityIds: detail?.excludedActivityIds,
  });

  const handleActivitySelect = useCallback(
    (activityId: string | null, activityPoints?: RoutePoint[]) => {
      setHighlightedActivityId(activityId);
      setHighlightedActivityPoints(activityPoints);
    },
    [setHighlightedActivityId, setHighlightedActivityPoints]
  );

  const handleScrubChange = useCallback(
    (scrubbing: boolean) => {
      setIsScrubbing(scrubbing);
    },
    [setIsScrubbing]
  );

  const { allActivityTraces, sportTypeCounts, effectiveSportType, filteredActivities } =
    useSectionActivityData(
      section,
      selectedSportType,
      detail
        ? { activityMetrics: detail.activityMetrics, mapSignatures: detail.mapSignatures }
        : undefined
    );

  // Section times come from activity streams, so wait for the gap the bundle
  // reported to close before reading the records.
  const portionActivityIds = useMemo(() => {
    if (!section?.activityPortions) return [];
    return Array.from(new Set(section.activityPortions.map((p) => p.activityId)));
  }, [section?.activityPortions]);
  const { ready: streamsReady } = useSectionTimeStreamSync(
    portionActivityIds,
    detail?.missingTimeStreamIds
  );

  // Second call: everything that needs lap times.
  const performance = useSectionDetailPerformance(
    id,
    RANGE_DAYS[sectionTimeRange],
    effectiveSportType,
    streamsReady
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
    sectionTimeRange,
    sportFilter: effectiveSportType,
    preComputedChart: performance?.chartData ?? null,
  });

  const { calendarSummary, combinedChartData } = useSectionChartDataEnriched({
    id,
    section,
    chartData,
    showExcluded,
    excludedActivityIds,
    preComputedCalendarSummary: performance?.calendarSummary ?? null,
  });

  const traversalCount = sectionTimeRange === 'all' ? (section?.visitCount ?? 0) : chartData.length;

  const { nearbyPolylines, isRunning } = useSectionMapData(nearby, effectiveSportType, section);

  const computedForwardStats = forwardStats;
  const computedReverseStats = reverseStats;
  const computedBestForward = bestForwardRecord ?? null;
  const computedBestReverse = bestReverseRecord ?? null;

  if (!section) {
    return (
      <DetailFallback
        isDark={isDark}
        insetTop={insets.top}
        onBack={() => router.back()}
        loading={getRouteEngine() == null}
        notFoundMessage={t('sections.sectionNotFound')}
      />
    );
  }

  const activityColor = colors.primary;
  const iconName: MaterialIconName = 'road-variant';

  return (
    <ScreenErrorBoundary screenName="Section Detail">
      <View
        testID="section-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <StatusBar barStyle="light-content" />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero Map Section - expands when editing */}
          <SectionHeader
            section={section}
            insetTop={insets.top}
            mapHeight={isTrimming ? MAP_HEIGHT_EDIT : MAP_HEIGHT_NORMAL}
            activityColor={activityColor}
            iconName={iconName}
            activityCount={traversalCount}
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
            allActivityTraces={allActivityTraces}
            isScrubbing={isScrubbing}
            nearbyPolylines={nearbyPolylines}
            onNearbyPress={
              isTrimming ? undefined : (sectionId) => router.push(`/section/${sectionId}`)
            }
            onBack={() => router.back()}
            onStartEditing={handleStartEditing}
            onSaveName={handleSaveName}
            onCancelEdit={handleCancelEdit}
            onEditNameChange={setEditName}
          />

          {/* Action row - always visible below map, hidden during trim */}
          {!isTrimming && (
            <SectionActionRow
              isDark={isDark}
              isCustomId={!!isCustomId}
              isSectionDisabled={isSectionDisabled}
              isRematching={isRematching}
              section={section}
              startTrim={startTrim}
              handleDeleteSection={handleDeleteSection}
              handleToggleDisable={handleToggleDisable}
              handleRematchActivities={handleRematchActivities}
              handleAcceptSection={handleAcceptSection}
              pinnedVersion={ledger.pinnedVersion}
            />
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
              initiallyExpanded={!canResetBounds}
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

          {/* Sport type pills for cross-sport sections */}
          {!isTrimming && sportTypeCounts.length > 1 && (
            <SportTypeSelector
              options={sportTypeCounts.map(({ type, count }) => ({ type, count }))}
              selectedType={selectedSportType ?? section?.sportType}
              onSelect={(st) => {
                const isSelected =
                  selectedSportType === st || (!selectedSportType && st === section?.sportType);
                setSelectedSportType(isSelected && selectedSportType ? undefined : st);
              }}
              isDark={isDark}
            />
          )}

          {/* Content below hero - hidden during trim */}
          {!isTrimming && (
            <SectionContentArea
              isDark={isDark}
              section={section}
              isSectionDisabled={isSectionDisabled}
              mergeCandidates={mergeCandidates}
              combinedChartData={combinedChartData}
              forwardStats={computedForwardStats}
              reverseStats={computedReverseStats}
              bestForwardRecord={computedBestForward}
              bestReverseRecord={computedBestReverse}
              calendarSummary={calendarSummary}
              effectiveSportType={effectiveSportType}
              isRunning={isRunning}
              activityColor={activityColor}
              navActivityId={navActivityId}
              effectiveReferenceId={effectiveReferenceId}
              showExcluded={showExcluded}
              excludedActivityIds={excludedActivityIds}
              sectionTimeRange={sectionTimeRange}
              onActivitySelect={handleActivitySelect}
              onScrubChange={handleScrubChange}
              onExcludeActivity={handleExcludeActivity}
              onIncludeActivity={handleIncludeActivity}
              onSetAsReference={handleSetAsReference}
              onToggleShowExcluded={handleToggleShowExcluded}
              onTimeRangeChange={setSectionTimeRange}
              onToggleDisable={handleToggleDisable}
              onMergePress={() => {
                if (mergeCandidates.length === 1) {
                  setMergeTarget(mergeCandidates[0]);
                } else {
                  setShowMergePicker(true);
                }
              }}
            />
          )}

          {!isTrimming && (
            <SectionHistoryPanel
              isDark={isDark}
              history={ledger.history}
              versions={ledger.versions}
              pinnedVersion={ledger.pinnedVersion}
              shownVersion={shownVersion}
              onShowVersion={setShownVersion}
              onRevert={handleRevert}
              onUnpin={handleUnpin}
            />
          )}

          {!isTrimming && (
            <View style={styles.listFooterContainer}>
              {section?.polyline?.length > 0 && (
                <TouchableOpacity
                  testID="section-export-gpx"
                  style={[styles.exportGpxButton, isDark && styles.exportGpxButtonDark]}
                  onPress={() =>
                    exportGpx({
                      name: section.name || 'Section',
                      points: section.polyline.map((p: RoutePoint) => ({
                        latitude: p.lat,
                        longitude: p.lng,
                      })),
                      sport: section.sportType,
                    })
                  }
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
          primary={{
            id: section.id,
            name: section.name ?? section.id,
            sportType: section.sportType,
            visitCount: section.visitCount,
            distanceMeters: section.distanceMeters,
          }}
          secondary={{
            id: mergeTarget.sectionId,
            name: mergeTarget.name ?? mergeTarget.sectionId,
            sportType: mergeTarget.sportType,
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
          loading={isMerging}
        />
      )}
    </ScreenErrorBoundary>
  );
}
