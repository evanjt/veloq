import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet, Dimensions } from 'react-native';
import { Text, IconButton, ActivityIndicator, Snackbar } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenSafeAreaView } from '@/components/ui';
import { logScreenRender } from '@/lib/debug/renderTimer';
import { useLocalSearchParams, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  useActivity,
  useActivityStreams,
  useActivityIntervals,
  useWellnessForDate,
  useTheme,
  useMetricSystem,
  useCacheDays,
  useGpxExport,
  useSectionOverlays,
  useSectionTimeStreams,
  useActivityRematch,
} from '@/hooks';
import { useCustomSections } from '@/hooks/routes/useCustomSections';
import { useRouteMatch } from '@/hooks/routes/useRouteMatch';
import { useSectionMatches, type SectionMatch } from '@/hooks/routes/useSectionMatches';
import {
  ActivityHeader,
  ActivityChartsSection,
  ActivityRoutesSection,
  ActivitySectionsSection,
} from '@/components';
import { useDebugStore } from '@/providers';
import { SwipeableTabs, type SwipeableTab } from '@/components/ui';
import type {
  SectionCreationResult,
  SectionCreationError,
} from '@/components/maps/ActivityMapView';
import type { CreationState } from '@/components/maps/SectionCreationOverlay';
import { convertLatLngTuples, decodePolyline } from '@/lib';
import { useExerciseSets } from '@/hooks/activities';
import { useAthlete } from '@/hooks';
import { ExerciseTable } from '@/components/activity/ExerciseTable';
import { MuscleGroupView } from '@/components/activity/MuscleGroupView';
import { ComponentErrorBoundary } from '@/components/ui';
import { colors, darkColors, spacing } from '@/theme';
import { ErrorStatePreset } from '@/components/ui';
import {
  setCameraOverride,
  getCameraOverride,
  deleteCameraOverride,
} from '@/lib/storage/terrainCameraOverrides';
import { invalidateTerrainPreview } from '@/lib/storage/terrainPreviewCache';
import type { TerrainCamera } from '@/lib/utils/cameraAngle';
import { calculateTerrainCamera } from '@/lib/utils/cameraAngle';
import { useMapPreferences } from '@/providers';
import type { MapStyleType } from '@/components/maps/mapStyles';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT = Math.round(SCREEN_HEIGHT * 0.42);

export default function ActivityDetailScreen() {
  // Performance timing
  const perfEndRef = useRef<(() => void) | null>(null);
  perfEndRef.current = logScreenRender('ActivityDetailScreen');
  useEffect(() => {
    perfEndRef.current?.();
  });

  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const debugEnabled = useDebugStore((s) => s.enabled);
  const insets = useSafeAreaInsets();

  const { data: activity, isLoading, error, refetch } = useActivity(id || '');
  const { data: streams } = useActivityStreams(id || '');
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  // Get the activity date for wellness lookup
  const activityDate = activity?.start_date_local?.split('T')[0];
  const { data: activityWellness } = useWellnessForDate(activityDate);

  // Tab state for swipeable tabs
  type TabType = 'charts' | 'exercises' | 'routes' | 'sections';
  const [activeTab, setActiveTab] = useState<TabType>('charts');

  // Fetch intervals data
  const { data: intervalsData } = useActivityIntervals(id || '');

  // Track the selected point index from charts for map highlight
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  // Track whether any chart is being interacted with to disable ScrollView
  const [chartInteracting, setChartInteracting] = useState(false);
  // Track whether 3D map mode is active
  const [is3DMapActive, setIs3DMapActive] = useState(false);

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
  const { createSection, removeSection, sections } = useCustomSections();
  // Highlighted section ID for map (when user long-presses a section row)
  const [highlightedSectionId, setHighlightedSectionId] = useState<string | null>(null);

  // Get cached date range from sync store
  const cacheDays = useCacheDays();

  // Get matched route for this activity
  const { routeGroup: matchedRoute, representativeActivityId } = useRouteMatch(id);
  const matchedRouteCount = matchedRoute ? 1 : 0;

  // Fetch representative activity streams for route overlay (only when on Routes tab)
  const { data: representativeStreams } = useActivityStreams(
    activeTab === 'routes' && representativeActivityId ? representativeActivityId : ''
  );

  // Convert representative activity latlng to coordinates for route overlay
  const routeOverlayCoordinates = useMemo(() => {
    if (activeTab !== 'routes' || !representativeStreams?.latlng) return null;
    return convertLatLngTuples(representativeStreams.latlng);
  }, [activeTab, representativeStreams]);

  // Get coordinates from streams or polyline
  const coordinates = useMemo(() => {
    if (streams?.latlng) {
      return convertLatLngTuples(streams.latlng);
    }
    if (activity?.polyline) {
      return decodePolyline(activity.polyline);
    }
    return [];
  }, [streams?.latlng, activity?.polyline]);

  const hasGpsData = coordinates.length > 0;
  const isStrength = activity?.type === 'WeightTraining';
  const { data: exerciseSets } = useExerciseSets(id || '', activity?.type ?? '');
  const { data: athlete } = useAthlete();
  const hasExercises = (exerciseSets?.length ?? 0) > 0;

  // Get auto-detected sections from engine that include this activity
  const { sections: engineSectionMatches, count: engineSectionCount } = useSectionMatches(id);

  // Scan for additional section matches
  const {
    matches: scanMatches,
    scan: scanForSections,
    rematch: rematchSection,
    isRematching,
  } = useActivityRematch();

  // Filter custom sections that match this activity
  const customMatchedSections = useMemo(() => {
    if (!id) return [];
    const engineSectionIds = new Set(engineSectionMatches.map((m) => m.section.id));
    return sections.filter(
      (section) =>
        !engineSectionIds.has(section.id) &&
        (section.sourceActivityId === id || section.activityIds?.includes(id))
    );
  }, [sections, id, engineSectionMatches]);

  // Total section count (auto-detected + custom, deduplicated)
  const totalSectionCount = engineSectionCount + customMatchedSections.length;

  // Unified section list for rendering
  type UnifiedSectionItem =
    | { type: 'engine'; match: SectionMatch; index: number }
    | {
        type: 'custom';
        section: (typeof customMatchedSections)[0];
        index: number;
      };

  const unifiedSections = useMemo((): UnifiedSectionItem[] => {
    const items: UnifiedSectionItem[] = [];
    engineSectionMatches.forEach((match, i) => {
      items.push({ type: 'engine', match, index: i });
    });
    customMatchedSections.forEach((section, i) => {
      items.push({
        type: 'custom',
        section,
        index: engineSectionMatches.length + i,
      });
    });
    return items;
  }, [engineSectionMatches, customMatchedSections]);

  // Section overlay computation (traces + map overlays)
  const { sectionOverlays } = useSectionOverlays(
    activeTab,
    id,
    engineSectionMatches,
    customMatchedSections,
    coordinates
  );

  // Time stream syncing + performance data for section best times
  const { getSectionBestTime } = useSectionTimeStreams(
    activeTab,
    engineSectionMatches,
    customMatchedSections
  );

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
    if (hasGpsData) {
      allTabs.push(
        {
          key: 'routes',
          label: t('activityDetail.tabs.route'),
          icon: 'map-marker-path',
        },
        {
          key: 'sections',
          label: t('activityDetail.tabs.sections'),
          icon: 'road-variant',
          count: totalSectionCount,
        }
      );
    }
    return allTabs;
  }, [t, isStrength, hasGpsData, matchedRouteCount, totalSectionCount]);

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
      setIs3DMapActive(is3D);
      if (activity?.id) {
        setActivityOverride(activity.id, { terrain3D: is3D });
        invalidateTerrainPreview(activity.id);
      }
    },
    [activity?.id, setActivityOverride]
  );

  // Handle map style changes -- persist as per-activity override
  const handleStyleChange = useCallback(
    (style: MapStyleType) => {
      if (activity?.id) {
        setActivityOverride(activity.id, { style });
        invalidateTerrainPreview(activity.id);
      }
    },
    [activity?.id, setActivityOverride]
  );

  // Save custom camera angle when user exits 3D mode
  const handleCameraCapture = useCallback(
    (camera: TerrainCamera) => {
      if (activity?.id) {
        setCameraOverride(activity.id, camera);
        setSnackbarVisible(true);
      }
    },
    [activity?.id]
  );

  // Undo camera override (revert to auto-calculated angle)
  const handleUndoCameraOverride = useCallback(() => {
    if (activity?.id) {
      deleteCameraOverride(activity.id);
    }
    setSnackbarVisible(false);
  }, [activity?.id]);

  // Restore saved 3D camera angle, or auto-calculate based on terrain mode
  const terrain3DMode = activity?.type ? getTerrain3DMode(activity.type, activity?.id) : 'off';

  const saved3DCamera = useMemo(() => {
    if (!activity?.id || terrain3DMode === 'off') return null;
    const override = getCameraOverride(activity.id);
    if (override) return override;
    if (coordinates.length >= 2) {
      const lngLatCoords: [number, number][] = coordinates.map((c) => [c.longitude, c.latitude]);
      const result = calculateTerrainCamera(lngLatCoords, streams?.altitude);
      if (terrain3DMode === 'smart' && !result.hasInterestingTerrain) return null;
      return result.camera;
    }
    return null;
  }, [activity?.id, terrain3DMode, coordinates, streams?.altitude]);

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
        let message = t('routes.sectionCreationFailed');
        let technicalDetails: string | undefined;

        if (error instanceof Error) {
          technicalDetails = error.message;

          if (error.message.includes('GPS track not found')) {
            message = t('routes.gpsTrackNotSynced');
          } else if (error.message.includes('Invalid indices')) {
            message = t('routes.invalidSectionRange');
          } else if (error.message.startsWith('Payload size exceeded')) {
            const parts = error.message.split('|');
            const reductionMeters = parseInt(parts[3], 10);

            if (reductionMeters > 0) {
              const reductionKm = Math.ceil(reductionMeters / 1000);
              const reductionDisplay =
                reductionKm > 1 ? `${reductionKm} km` : `${reductionMeters} m`;
              message = t('routes.sectionTooLargeWithHint', {
                reduction: reductionDisplay,
              });
            } else {
              message = t('routes.sectionTooLarge');
            }
          }
        }

        setSectionCreationState('error');
        setSectionCreationError({
          message,
          technicalDetails,
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

  // Handle section marker press on map — switch to sections tab
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

  if (isLoading) {
    return (
      <ScreenSafeAreaView
        testID="activity-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
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
        <View style={[styles.floatingHeader, { paddingTop: insets.top }]}>
          <IconButton
            icon="arrow-left"
            iconColor={colors.textOnDark}
            onPress={() => router.back()}
          />
        </View>
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
        <View
          style={[styles.noMapHeader, { paddingTop: insets.top }, isDark && styles.noMapHeaderDark]}
        >
          <IconButton
            icon="arrow-left"
            iconColor={isDark ? darkColors.textPrimary : colors.textPrimary}
            onPress={() => router.back()}
          />
          <View style={styles.noMapHeaderText}>
            <Text
              numberOfLines={1}
              style={[styles.noMapTitle, isDark && { color: darkColors.textPrimary }]}
            >
              {activity.name}
            </Text>
          </View>
          <View style={{ width: 48 }} />
        </View>
      )}

      {/* Strength Training hero — body diagrams with overlay (back button, name, date, duration) */}
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
          isMetric={isMetric}
          isDark={isDark}
          debugEnabled={debugEnabled}
          insetTop={insets.top}
          mapHeight={MAP_HEIGHT}
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
          sectionOverlays={sectionOverlays}
          highlightedSectionId={highlightedSectionId}
          onSectionMarkerPress={handleSectionMarkerPress}
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
      >
        {/* Tab 1: Charts */}
        <ActivityChartsSection
          activity={activity}
          activityId={id}
          streams={streams}
          intervalsData={intervalsData}
          activityWellness={activityWellness}
          coordinates={coordinates}
          isDark={isDark}
          isMetric={isMetric}
          debugEnabled={debugEnabled}
          gpxExporting={gpxExporting}
          chartInteracting={chartInteracting}
          engineSectionCount={engineSectionCount}
          customSectionCount={customMatchedSections.length}
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
            />
          </ScrollView>
        )}

        {/* Tab 3: Routes (only for GPS activities) */}
        {hasGpsData && (
          <ActivityRoutesSection
            activityId={activity.id}
            activityType={activity.type}
            hasMatchedRoute={!!matchedRoute}
            cacheDays={cacheDays}
            isDark={isDark}
          />
        )}

        {/* Tab 3: Sections (only for GPS activities) */}
        {hasGpsData && (
          <ActivitySectionsSection
            activityId={id}
            activityType={activity.type}
            unifiedSections={unifiedSections}
            coordinates={coordinates}
            streams={streams}
            isDark={isDark}
            isMetric={isMetric}
            sectionCreationMode={sectionCreationMode}
            cacheDays={cacheDays}
            highlightedSectionId={highlightedSectionId}
            onHighlightedSectionIdChange={setHighlightedSectionId}
            onSectionCreationModeChange={setSectionCreationMode}
            getSectionBestTime={getSectionBestTime}
            removeSection={removeSection}
            scanMatches={scanMatches}
            isScanning={isRematching}
            onScan={() => scanForSections(id)}
            onRematch={(sectionId) => rematchSection(id, sectionId)}
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
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    zIndex: 10,
  },
  exercisesTab: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  exercisesTabContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl + 80,
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
    fontSize: 18,
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
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  descriptionTextDark: {
    color: darkColors.textSecondary,
  },
});
