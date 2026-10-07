import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Text, Snackbar } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ScreenSafeAreaView,
  ComponentErrorBoundary,
  ErrorStatePreset,
  useHeroMapHeight,
  HERO_HEADER_HEIGHT,
} from '@/shared/ui';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  useActivity,
  useActivityStreams,
  useActivityIntervals,
  useActivityDetailStreams,
  groupSectionEncounters,
  sectionRowLabels,
  useSectionOverlays,
  useActivityDetailData,
  useActivitySectionHighlights,
  ActivityChartsSection,
  ActivityHeader,
  ActivityDetailSkeleton,
  ActivityDetailReadFailed,
  ActivityRoutesSection,
  ActivitySectionsSection,
} from '@/features/activity';
import {
  useActivityRematch,
  useCustomSections,
  useRouteMatch,
  useSectionMatches,
  useRouteSettings,
} from '@/features/routes';
import { useWellnessForDate } from '@/features/wellness';
import { useGpxExport, useDebugStore } from '@/features/settings';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { SwipeableTabs, type SwipeableTab } from '@/shared/ui';
import {
  resolveTerrain3D,
  type CreationState,
  deleteCameraOverride,
  getCameraOverride,
  type MapStyleType,
  type SectionCreationError,
  type SectionCreationResult,
  sectionCreationMessageKey,
  setCameraOverride,
  type TerrainCamera,
  useMapPreferences,
} from '@/features/maps';
import { convertLatLngTuples } from '@/shared/geo/polyline';
import { formatPrDelta, formatPrImprovement } from '@/shared/format/format';
import type { RouteGroup as NativeRouteGroup, Section as NativeSection } from 'veloqrs';
import { useExerciseSets, ExerciseTable, MuscleGroupView } from '@/features/strength';
import { useAthlete } from '@/shared/app/useAthlete';
import { colors, darkColors, spacing, typography } from '@/theme';
import { overMapHeaderTint } from '@/shared/app/screenHeaders';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

/** Stable empty list so the custom-sections hook keeps skipping its own read. */
const NO_CUSTOM_SECTIONS: NativeSection[] = [];
const NO_ROUTE_GROUPS: NativeRouteGroup[] = [];

function ActivityDetailScreenContent() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('ActivityDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const debugEnabled = useDebugStore((s) => s.enabled);
  const insets = useSafeAreaInsets();
  const mapHeight = useHeroMapHeight();

  // The first commit answers the tap with the skeleton, which needs none of the
  // reads below. They start once it has committed, so their render work and
  // their synchronous engine reads are not ahead of the first frame.
  const [afterFirstCommit, setAfterFirstCommit] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAfterFirstCommit(true);
  }, []);

  const {
    data: activity,
    isLoading,
    error,
    refetch,
    bodyStatus,
    retryBody,
  } = useActivity(id || '');
  const {
    data: streams,
    isLoading: streamsLoading,
    isDownloaded: streamsDownloaded,
    bodyStatus: streamsStatus,
    retryBody: retryStreams,
    coordinates,
  } = useActivityDetailStreams(id || '');
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  // One engine call covering route match, section matches, encounters,
  // highlights, overlays and engine counts. The card reads it at press time,
  // so this takes what is already there and only reads when it is not.
  const {
    data: detail,
    error: detailError,
    refresh: refreshDetail,
  } = useActivityDetailData(id, afterFirstCommit);
  const detailReadFailed = !detail && detailError !== undefined;

  // Get the activity date for wellness lookup
  const activityDate = activity?.start_date_local?.split('T')[0];
  const { data: activityWellness } = useWellnessForDate(
    afterFirstCommit ? activityDate : undefined
  );

  // Tab state for swipeable tabs
  type TabType = 'charts' | 'exercises' | 'routes' | 'sections';
  const validTabs: TabType[] = ['charts', 'exercises', 'routes', 'sections'];
  const initialTab = validTabs.includes(tab as TabType) ? (tab as TabType) : 'charts';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  // Fetch intervals data
  const { data: intervalsData, outcome: intervalsOutcome } = useActivityIntervals(
    afterFirstCommit ? id || '' : ''
  );

  // Track the selected point index from charts for map highlight
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  // Track whether any chart is being interacted with to disable ScrollView
  const [chartInteracting, setChartInteracting] = useState(false);

  // Snackbar for 3D camera override feedback
  const [snackbarVisible, setSnackbarVisible] = useState(false);

  // Section creation mode
  const [sectionCreationMode, setSectionCreationMode] = useState(false);
  const [sectionCreationState, setSectionCreationState] = useState<CreationState | undefined>(
    undefined
  );
  const [sectionCreationError, setSectionCreationError] = useState<SectionCreationError | null>(
    null
  );
  // The batch owns the custom sections here, empty until it lands, so the hook
  // never opens a read of its own on this screen.
  const { createSection, removeSection, sections } = useCustomSections({
    preComputedSections: detail?.customSections ?? NO_CUSTOM_SECTIONS,
  });
  // Highlighted section ID for map (when user long-presses a section row)
  const [highlightedSectionId, setHighlightedSectionId] = useState<string | null>(null);

  // Get cached date range from sync store
  const cacheDays = useCacheDays(detail?.activityCount);

  // Get matched route for this activity
  const { routeGroup: matchedRoute, representativeActivityId } = useRouteMatch(
    id,
    detail?.routeGroups ?? NO_ROUTE_GROUPS
  );

  // Route PR delta for the Routes tab badge (negative = ahead of PR)
  const activityIdsForHighlights = useMemo(() => (id ? [id] : []), [id]);
  const { routes: routeHighlightsMap } = useActivitySectionHighlights(
    activityIdsForHighlights,
    detail?.highlights
  );
  const routeHighlight = id ? routeHighlightsMap.get(id) : undefined;

  // Fetch representative activity streams for route overlay (only when on Routes tab)
  const { data: representativeStreams } = useActivityStreams(
    activeTab === 'routes' && representativeActivityId ? representativeActivityId : ''
  );

  // Convert representative activity latlng to coordinates for route overlay
  const routeOverlayCoordinates = useMemo(() => {
    if (activeTab !== 'routes' || !representativeStreams?.latlng) return null;
    return convertLatLngTuples(representativeStreams.latlng);
  }, [activeTab, representativeStreams]);

  const hasGpsData = coordinates.length > 0;
  const isRouteMatchingOn = useRouteSettings((s) => s.settings.enabled);
  const isStrength = activity?.type === 'WeightTraining';
  const { data: exerciseSets } = useExerciseSets(id || '', activity?.type ?? '');
  const { data: athlete } = useAthlete();
  const hasExercises = (exerciseSets?.length ?? 0) > 0;

  // Memoised so a chart scrub, which re-renders this screen per touch move,
  // hands the hooks the same bundle wrapper rather than a fresh literal.
  const preComputedMatches = useMemo(
    () => ({
      sections: detail?.matchedSections ?? [],
      sectionCount: detail?.sectionCount ?? 0,
    }),
    [detail]
  );
  const preComputedOverlays = useMemo(
    () => ({
      sectionTraces: detail?.sectionTraces ?? {},
      prSectionIds: detail?.prSectionIds ?? new Set<string>(),
    }),
    [detail]
  );

  // Get auto-detected sections from engine that include this activity
  const { sections: engineSectionMatches, count: engineSectionCount } = useSectionMatches(
    id,
    preComputedMatches
  );

  // Scan for additional section matches
  const {
    matches: scanMatches,
    hasScanned,
    scan: scanForSections,
    rematch: rematchSection,
  } = useActivityRematch();

  // Stable, so the sections tab's memo holds. As inline literals they were a
  // new function per render of this screen, which a scrub re-renders per index.
  const handleScan = useCallback(() => scanForSections(id), [scanForSections, id]);
  const handleRematch = useCallback(
    (sectionId: string) => rematchSection(id, sectionId),
    [rematchSection, id]
  );

  // Section encounters for the sections tab (one entry per section+direction)
  const encountersRaw = detail?.encounters ?? [];

  // The bundle already carries exactly these: the custom sections naming this
  // activity that the engine's matches do not, filtered where the catalogue
  // lives rather than after it has crossed the FFI.
  const customMatchedSections = sections;

  // Section overlay computation (traces + map overlays)
  const { sectionOverlays } = useSectionOverlays(
    id,
    engineSectionMatches,
    customMatchedSections,
    coordinates,
    preComputedOverlays,
    encountersRaw
  );

  // The engine returns encounters ordered by where each starts along this
  // activity's track, so the numbered rows follow it from start to finish.
  const encounters = encountersRaw;

  // The Sections tab counts cards, and a section crossed both ways is one card.
  const sectionGroups = useMemo(() => groupSectionEncounters(encounters), [encounters]);
  const sectionCardCount = sectionGroups.length;
  const sectionRowLabelMap = useMemo(() => sectionRowLabels(sectionGroups), [sectionGroups]);

  // Tabs configuration
  const tabs = useMemo<SwipeableTab[]>(() => {
    const allTabs: SwipeableTab[] = [
      {
        key: 'charts',
        label: t('activityDetail.tabs.charts'),
        icon: 'chart-line',
      },
    ];
    if (isStrength) {
      allTabs.push({
        key: 'exercises',
        label: t('activityDetail.tabs.exercises'),
        icon: 'dumbbell',
      });
    }
    if (hasGpsData && isRouteMatchingOn) {
      const routeBadge: {
        badgeText?: string;
        badgeTone?: NonNullable<SwipeableTab['badgeTone']>;
      } = {};
      if (routeHighlight) {
        if (routeHighlight.isPr) {
          const improvement = formatPrImprovement(routeHighlight.prImprovementSeconds);
          routeBadge.badgeText = improvement ? `PR ${improvement}` : 'PR';
          routeBadge.badgeTone = 'pr';
        } else if (routeHighlight.timeDeltaSeconds != null && routeHighlight.timeDeltaSeconds > 0) {
          routeBadge.badgeText = formatPrDelta(routeHighlight.timeDeltaSeconds);
          routeBadge.badgeTone = 'negative';
        }
      }
      allTabs.push(
        {
          key: 'routes',
          label: t('activityDetail.tabs.route'),
          icon: 'map-marker-path',
          ...routeBadge,
        },
        {
          key: 'sections',
          label: t('activityDetail.tabs.sections'),
          icon: 'road-variant',
          count: sectionCardCount,
        }
      );
    }
    return allTabs;
  }, [t, isStrength, hasGpsData, isRouteMatchingOn, sectionCardCount, routeHighlight]);

  // Handle chart point selection
  const handlePointSelect = useCallback((index: number | null) => {
    setHighlightIndex(index);
  }, []);

  // Handle chart interaction state changes
  const handleInteractionChange = useCallback((isInteracting: boolean) => {
    setChartInteracting(isInteracting);
  }, []);

  // Map preferences -- read terrain mode and save per-activity overrides
  const { getTerrain3DMode, setActivityOverride } = useMapPreferences();

  // Handle 3D map mode changes -- persist as per-activity override
  const handle3DModeChange = useCallback(
    (is3D: boolean) => {
      if (activity?.id) {
        setActivityOverride(activity.id, { terrain3D: is3D });
      }
    },
    [activity, setActivityOverride]
  );

  // Handle map style changes -- persist as per-activity override
  const handleStyleChange = useCallback(
    (style: MapStyleType) => {
      if (activity?.id) {
        setActivityOverride(activity.id, { style });
      }
    },
    [activity, setActivityOverride]
  );

  // Save custom camera angle when user exits 3D mode
  const handleCameraCapture = useCallback(
    (camera: TerrainCamera) => {
      if (activity?.id) {
        setCameraOverride(activity.id, camera);
        setSnackbarVisible(true);
      }
    },
    [activity]
  );

  // Undo camera override (revert to auto-calculated angle)
  const handleUndoCameraOverride = useCallback(() => {
    if (activity?.id) {
      deleteCameraOverride(activity.id);
    }
    setSnackbarVisible(false);
  }, [activity]);

  // Restore saved 3D camera angle, or auto-calculate based on terrain mode
  const terrain3DMode = activity?.type ? getTerrain3DMode(activity.type, activity?.id) : 'off';

  const saved3DCamera = useMemo(() => {
    if (!activity?.id || terrain3DMode === 'off') return null;
    const lngLatCoords: [number, number][] = coordinates.map((c) => [c.longitude, c.latitude]);
    const verdict = resolveTerrain3D({
      mode: terrain3DMode,
      coordinates: lngLatCoords,
      altitude: streams?.altitude,
      gain: activity.total_elevation_gain,
      distance: activity.distance,
      override: getCameraOverride(activity.id) ?? null,
    });
    return verdict.show3D ? verdict.camera : null;
  }, [activity, terrain3DMode, coordinates, streams]);

  // Handle section creation completion
  const handleSectionCreated = useCallback(
    async (result: SectionCreationResult) => {
      if (!activity) return;

      setSectionCreationState('creating');
      setSectionCreationError(null);

      try {
        await createSection({
          startIndex: result.startIndex,
          endIndex: result.endIndex,
          sourceActivityId: activity.id,
          sportType: activity.type,
        });

        setSectionCreationMode(false);
        setSectionCreationState(undefined);
      } catch (error) {
        setSectionCreationState('error');
        setSectionCreationError({
          message: t(sectionCreationMessageKey(error)),
          technicalDetails: error instanceof Error ? error.message : undefined,
          activityId: activity.id,
          indices: { start: result.startIndex, end: result.endIndex },
        });
      }
    },
    [activity, createSection, t]
  );

  // Handle section creation cancellation
  const handleSectionCreationCancelled = useCallback(() => {
    setSectionCreationMode(false);
    setSectionCreationState(undefined);
    setSectionCreationError(null);
  }, []);

  // Handle dismissing error to retry
  const handleSectionCreationErrorDismiss = useCallback(() => {
    setSectionCreationState(undefined);
    setSectionCreationError(null);
  }, []);

  // Handle section marker press on map - switch to sections tab
  const handleSectionMarkerPress = useCallback((_sectionId: string) => {
    setActiveTab('sections');
  }, []);

  // Handle GPX export
  const handleExportGpx = useCallback(() => {
    if (activity) {
      exportGpx({
        name: activity.name || 'Activity',
        points: coordinates,
        time: activity.start_date_local,
        sport: activity.type,
      });
    }
  }, [activity, coordinates, exportGpx]);

  if (isLoading || streamsLoading) {
    return (
      <ScreenSafeAreaView
        testID="activity-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <ActivityDetailSkeleton activityId={id || ''} />
      </ScreenSafeAreaView>
    );
  }

  // A deep link or push can name an activity the library has never held. The
  // engine is downloading it, so the screen waits until the hook's deadline and
  // then retries the download. Only a failed read of the stored row is a load
  // failure, and its retry re-reads that row.
  if (!error && !activity) {
    const timedOut = bodyStatus === 'timedOut' || bodyStatus === 'refused';
    return (
      <ScreenSafeAreaView
        testID="activity-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <Stack.Screen
          options={{ headerTintColor: overMapHeaderTint({ overHero: false, isDark }) }}
        />
        <View style={{ height: insets.top + HERO_HEADER_HEIGHT }} />
        <View style={styles.loadingContainer}>
          {timedOut ? (
            <ErrorStatePreset message={t('activitySummary.unavailable')} onRetry={retryBody} />
          ) : (
            <View testID="activity-detail-waiting" style={styles.waiting}>
              <ActivityIndicator
                size="large"
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
              />
              <Text style={{ color: isDark ? darkColors.textSecondary : colors.textSecondary }}>
                {t('activitySummary.downloading')}
              </Text>
            </View>
          )}
        </View>
      </ScreenSafeAreaView>
    );
  }

  if (error || !activity) {
    return (
      <ScreenSafeAreaView
        testID="activity-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <Stack.Screen
          options={{ headerTintColor: overMapHeaderTint({ overHero: false, isDark }) }}
        />
        <View style={{ height: insets.top + HERO_HEADER_HEIGHT }} />
        <View style={styles.loadingContainer}>
          <ErrorStatePreset message={t('activityDetail.failedToLoad')} onRetry={() => refetch()} />
        </View>
      </ScreenSafeAreaView>
    );
  }

  return (
    <View
      testID="activity-detail-screen"
      style={[styles.container, isDark && styles.containerDark]}
    >
      {/* Simple header for non-GPS, non-strength activities */}
      {!hasGpsData && !isStrength && (
        <>
          <Stack.Screen
            options={{ headerTintColor: overMapHeaderTint({ overHero: false, isDark }) }}
          />
          <View
            style={[
              styles.noMapHeader,
              { paddingTop: insets.top + HERO_HEADER_HEIGHT },
              isDark && styles.noMapHeaderDark,
            ]}
          >
            <View style={styles.noMapHeaderText}>
              <Text
                numberOfLines={1}
                style={[styles.noMapTitle, isDark && { color: darkColors.textPrimary }]}
              >
                {activity.name}
              </Text>
            </View>
          </View>
        </>
      )}

      {/* Strength Training hero - body diagrams with overlay (back button, name, date, duration) */}
      {isStrength && (
        <ComponentErrorBoundary componentName="Muscle Groups">
          <MuscleGroupView
            activityId={id}
            activity={activity}
            hasExercises={hasExercises}
            isDark={isDark}
            athleteSex={athlete?.sex}
            exerciseSets={exerciseSets}
          />
        </ComponentErrorBoundary>
      )}

      {/* Hero Map Section - hidden for non-GPS activities */}
      {hasGpsData && (
        <ActivityHeader
          activity={activity}
          activityId={id}
          coordinates={coordinates}
          streams={streams}
          isMetric={isMetric}
          debugEnabled={debugEnabled}
          mapHeight={mapHeight}
          highlightIndex={highlightIndex}
          sectionCreationMode={sectionCreationMode}
          sectionCreationState={sectionCreationState}
          sectionCreationError={sectionCreationError}
          onSectionCreated={handleSectionCreated}
          onCreationCancelled={handleSectionCreationCancelled}
          onCreationErrorDismiss={handleSectionCreationErrorDismiss}
          on3DModeChange={handle3DModeChange}
          onStyleChange={handleStyleChange}
          onCameraCapture={handleCameraCapture}
          initial3DCamera={saved3DCamera}
          activeTab={activeTab}
          routeOverlayCoordinates={routeOverlayCoordinates}
          sectionOverlays={isRouteMatchingOn ? sectionOverlays : null}
          sectionRowLabels={sectionRowLabelMap}
          highlightedSectionId={highlightedSectionId}
          onSectionMarkerPress={isRouteMatchingOn ? handleSectionMarkerPress : undefined}
        />
      )}

      {/* Activity description */}
      {activity.description ? (
        <View style={[styles.descriptionContainer, isDark && styles.descriptionContainerDark]}>
          <Text
            numberOfLines={3}
            style={[styles.descriptionText, isDark && styles.descriptionTextDark]}
          >
            {activity.description}
          </Text>
        </View>
      ) : null}

      {/* Swipeable Tabs: Charts, Routes, Sections */}
      <SwipeableTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as TabType)}
        isDark={isDark}
        lazy
      >
        {/* Tab 1: Charts */}
        <ActivityChartsSection
          activity={activity}
          activityId={id}
          streams={streams}
          streamsDownloaded={streamsDownloaded}
          streamsStatus={streamsStatus}
          onRetryStreams={retryStreams}
          intervalsData={intervalsData}
          intervalsOutcome={intervalsOutcome}
          activityWellness={activityWellness}
          coordinates={coordinates}
          isDark={isDark}
          isMetric={isMetric}
          debugEnabled={debugEnabled}
          gpxExporting={gpxExporting}
          chartInteracting={chartInteracting}
          engineSectionCount={engineSectionCount}
          customSectionCount={customMatchedSections.length}
          maxHR={detail?.maxHR}
          fitnessImpact={detail?.fitnessImpact}
          hrZones={detail?.hrZones}
          onPointSelect={handlePointSelect}
          onInteractionChange={handleInteractionChange}
          onExportGpx={handleExportGpx}
        />

        {/* Tab 2: Exercises (only for strength activities) */}
        {isStrength && (
          <ScrollView
            style={styles.exercisesTab}
            contentContainerStyle={styles.exercisesTabContent}
          >
            <ExerciseTable
              activityId={id}
              activityType={activity.type}
              isDark={isDark}
              athleteSex={athlete?.sex}
              exerciseGroups={detail?.exerciseGroups}
            />
          </ScrollView>
        )}

        {/* Tab 3: Routes (only for GPS activities) */}
        {hasGpsData && detailReadFailed && (
          <ActivityDetailReadFailed error={detailError} onRetry={refreshDetail} />
        )}
        {hasGpsData && detailReadFailed && (
          <ActivityDetailReadFailed error={detailError} onRetry={refreshDetail} />
        )}
        {hasGpsData && !detailReadFailed && (
          <ActivityRoutesSection
            activityId={activity.id}
            activityType={activity.type}
            hasMatchedRoute={!!matchedRoute}
            cacheDays={cacheDays}
            isDark={isDark}
          />
        )}

        {/* Tab 3: Sections (only for GPS activities) */}
        {hasGpsData && !detailReadFailed && (
          <ActivitySectionsSection
            activityId={id}
            sportType={activity.type}
            encounters={encounters}
            ledgerChanges={detail?.ledgerChanges}
            coordinates={coordinates}
            isDark={isDark}
            isMetric={isMetric}
            sectionCreationMode={sectionCreationMode}
            cacheDays={cacheDays}
            highlightedSectionId={highlightedSectionId}
            onHighlightedSectionIdChange={setHighlightedSectionId}
            onSectionCreationModeChange={setSectionCreationMode}
            removeSection={removeSection}
            scanMatches={scanMatches}
            hasScanned={hasScanned}
            onScan={handleScan}
            onRematch={handleRematch}
          />
        )}
      </SwipeableTabs>

      {/* Snackbar: 3D camera override saved */}
      <Snackbar
        visible={snackbarVisible}
        onDismiss={() => setSnackbarVisible(false)}
        duration={4000}
        action={{ label: t('common.undo'), onPress: handleUndoCameraOverride }}
      >
        {t('activityDetail.feedPreviewUpdated')}
      </Snackbar>
    </View>
  );
}

const BOTTOM_BAR_HEIGHT = 80;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waiting: {
    alignItems: 'center',
    gap: spacing.md,
  },
  exercisesTab: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  exercisesTabContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl + BOTTOM_BAR_HEIGHT,
  },
  noMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.background,
  },
  noMapHeaderDark: {
    backgroundColor: darkColors.background,
  },
  noMapHeaderText: {
    flex: 1,
    alignItems: 'center',
  },
  noMapTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  descriptionContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  descriptionContainerDark: {
    backgroundColor: darkColors.surface,
    borderBottomColor: darkColors.border,
  },
  descriptionText: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  descriptionTextDark: {
    color: darkColors.textSecondary,
  },
});

export default withScreenBoundary(ActivityDetailScreenContent, 'ActivityDetail');
