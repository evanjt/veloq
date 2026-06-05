/**
 * Section detail page.
 * Shows a frequently-traveled section with all activities that traverse it.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { View, ScrollView, StatusBar, TouchableOpacity, InteractionManager } from 'react-native';
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
import { useSectionPerformances } from '@/features/routes/hooks/useSectionPerformances';
import { useSectionDataRefresh } from '@/features/routes/hooks/useSectionDataRefresh';
import { useSectionUIState } from '@/features/routes/hooks/useSectionUIState';
import { useSectionActivityData } from '@/features/routes/hooks/useSectionActivityData';
import { useSectionChartDataEnriched } from '@/features/routes/hooks/useSectionChartDataEnriched';
import { useSectionMapData } from '@/features/routes/hooks/useSectionMapData';
import { useGpxExport } from '@/features/settings/hooks/exportIndex';
import { useTheme } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { useSectionTrim } from '@/features/routes/hooks/useSectionTrim';
import { DataRangeFooter, SectionTrimOverlay } from '@/features/routes';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { useFFITimer } from '@/shared/debug/useFFITimer';
import { ScreenErrorBoundary } from '@/shared/ui';
import {
  SectionHeader,
  SectionActionRow,
  SectionContentArea,
  SectionDebugPanel,
  MergeConfirmDialog,
  MergeCandidatesModal,
} from '@/features/routes/components/section';
import {
  MAP_HEIGHT_NORMAL,
  MAP_HEIGHT_EDIT,
} from '@/features/routes/components/section/SectionHeader';
import { styles } from '@/features/routes/components/section/SectionDetail.styles';
import {
  getActivityIcon,
  getActivityColor,
  type MaterialIconName,
} from '@/features/activity/lib/activityUtils';
import { colors, darkColors } from '@/theme';
import type { ActivityType, RoutePoint } from '@/types';

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

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();
  const debugEnabled = useDebugStore((s) => s.enabled);
  const { getPageMetrics } = useFFITimer();
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  // Nearby sections and merge candidates
  const { nearby } = useNearbySections(id);
  const { candidates: mergeCandidates, merge: mergeSections, isMerging } = useMergeSections(id);

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

  const { section, sectionRefreshKey, handleTrimRefresh } = useSectionDataRefresh(id);

  // Disabled state from section data
  const isSectionDisabled = !!(section?.disabled || section?.supersededBy);

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
  } = useSectionTrim(section, handleTrimRefresh);

  // Section CRUD actions (rename, delete, toggle disable, exclude/include,
  // reference activity, rematch) — extracted into a hook for clarity.
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
    onSectionRefresh: handleTrimRefresh,
    sectionRefreshKey,
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
    useSectionActivityData(section, selectedSportType);

  // Fetch actual section performance times from activity streams
  // This loads in the background - we show estimated times first, then update when ready
  const {
    records: performanceRecords,
    bestForwardRecord,
    bestReverseRecord,
    forwardStats,
    reverseStats,
  } = useSectionPerformances(section, effectiveSportType);

  const { chartData } = useSectionChartData({
    section,
    performanceRecords,
    sectionActivitiesUnsorted: filteredActivities,
    sectionWithTraces: null,
    sectionTimeRange,
    sportFilter: effectiveSportType,
  });

  const { calendarSummary, combinedChartData } = useSectionChartDataEnriched({
    id,
    section,
    chartData,
    showExcluded,
    excludedActivityIds,
  });

  const activityCount = sectionTimeRange === 'all' ? (section?.visitCount ?? 0) : chartData.length;

  const { nearbyPolylines, isRunning } = useSectionMapData(nearby, effectiveSportType, section);

  const computedForwardStats = forwardStats;
  const computedReverseStats = reverseStats;
  const computedBestForward = bestForwardRecord ?? null;
  const computedBestReverse = bestReverseRecord ?? null;

  if (!section) {
    return (
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={24}
              color={isDark ? colors.textOnDark : colors.textPrimary}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="map-marker-question-outline"
            size={48}
            color={isDark ? darkColors.border : colors.divider}
          />
          <Text style={[styles.emptyText, isDark && styles.textLight]}>
            {t('sections.sectionNotFound')}
          </Text>
        </View>
      </View>
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
          {/* Hero Map Section — expands when editing */}
          <SectionHeader
            section={section}
            isDark={isDark}
            insetTop={insets.top}
            mapHeight={isTrimming ? MAP_HEIGHT_EDIT : MAP_HEIGHT_NORMAL}
            activityColor={activityColor}
            iconName={iconName}
            activityCount={activityCount}
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
            shadowTrack={undefined}
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

          {/* Action row — always visible below map, hidden during trim */}
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
            />
          )}

          {/* Trim panel — replaces chart when trimming */}
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
            <View style={styles.sportTypePills}>
              {sportTypeCounts.map(({ type: st, count }) => {
                const isSelected =
                  selectedSportType === st || (!selectedSportType && st === section?.sportType);
                const sportColor = getActivityColor(st as ActivityType);
                return (
                  <TouchableOpacity
                    key={st}
                    onPress={() =>
                      setSelectedSportType(isSelected && selectedSportType ? undefined : st)
                    }
                    style={[
                      styles.sportPill,
                      isSelected && { backgroundColor: sportColor + '20', borderColor: sportColor },
                      isDark && styles.sportPillDark,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={getActivityIcon(st as ActivityType)}
                      size={14}
                      color={
                        isSelected
                          ? sportColor
                          : isDark
                            ? darkColors.textSecondary
                            : colors.textSecondary
                      }
                    />
                    <Text
                      style={[
                        styles.sportPillText,
                        isSelected && { color: sportColor },
                        isDark && styles.sportPillTextDark,
                      ]}
                    >
                      {t(`activityTypes.${st}`, st)} {count}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Content below hero — hidden during trim */}
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
