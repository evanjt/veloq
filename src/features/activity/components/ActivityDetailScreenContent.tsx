import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Platform,
  View,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type ViewInstance,
} from 'react-native';
import { Text } from 'react-native-paper';
import {
  BodyNotDownloaded,
  ScreenSafeAreaView,
  ComponentErrorBoundary,
  ErrorState,
  showNotice,
  useHeroMapHeight,
  Spinner,
} from '@/shared/ui';
import { logScreenRender } from '@/shared/debug/renderTimer';
import { toActivityType } from '@/types';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  useActivity,
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
import { useGpxExport, useDebugStore, useMapPreferences } from '@/features/settings';
import { useActivityMapChoices } from '../hooks/useActivityMapChoices';
import { routeOverlayLine } from '../lib/routeOverlayLine';
import { ActivitySummaryStrip } from './ActivitySummaryStrip';
import { PoolLengthsTable, showsPoolLengthsTab } from './PoolLengthsTable';
import { useTheme, useMetricSystem } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { waitEnded } from '@/shared/native/engineBodies';
import { SwipeableTabs, type SwipeableTab } from '@/shared/ui';
import {
  resolveTerrain3D,
  type CreationState,
  type SectionCreationError,
  type SectionCreationResult,
  submitSectionCreation,
  type TerrainCamera,
} from '@/features/maps';
import type { RouteGroup as NativeRouteGroup, Section as NativeSection } from 'veloqrs';
import { useExerciseSets, ExerciseTable, MuscleGroupView } from '@/features/strength';
import { useAthlete } from '@/shared/app/useAthlete';
import { colors, darkColors, spacing, typography, stroke } from '@/theme';
import { noHeroHeaderOptions, overMapHeaderOptions } from '@/shared/app/screenHeaders';
import { MapHeroStatusBar } from '@/shared/app/MapHeroStatusBar';
import { LARGE_TEXT_PINNED_FRACTION, useLargeText } from '@/shared/ui/useLargeText';

/** Stable empty list so the custom-sections hook keeps skipping its own read. */
const NO_CUSTOM_SECTIONS: NativeSection[] = [];
const NO_ROUTE_GROUPS: NativeRouteGroup[] = [];

export interface ActivityDetailScreenContentProps {
  /** The route's opening transition has ended, read by the route that mounted before this */
  transitionSettled: boolean;
}

export function ActivityDetailScreenContent({
  transitionSettled,
}: ActivityDetailScreenContentProps) {
  // Performance timing
  const perfEnd = logScreenRender('ActivityDetailScreen');
  useEffect(() => {
    perfEnd();
  });

  const { t } = useTranslation();
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const debugEnabled = useDebugStore((s) => s.enabled);
  const mapHeight = useHeroMapHeight();
  const largeText = useLargeText();
  const { height: windowHeight } = useWindowDimensions();

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
  const { data: detail, error: detailError, refresh: refreshDetail } = useActivityDetailData(id);
  const detailReadFailed = !detail && detailError !== undefined;

  // Get the activity date for wellness lookup
  const activityDate = activity?.startDateLocal?.split('T')[0];
  const { data: activityWellness } = useWellnessForDate(activityDate);

  // Tab state for swipeable tabs
  type TabType = 'charts' | 'exercises' | 'lengths' | 'routes' | 'sections';
  const validTabs: TabType[] = ['charts', 'exercises', 'lengths', 'routes', 'sections'];
  const initialTab = validTabs.includes(tab as TabType) ? (tab as TabType) : 'charts';
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);

  // Fetch intervals data
  const {
    data: intervalsData,
    outcome: intervalsOutcome,
    bodyStatus: intervalsStatus,
    retryBody: retryIntervals,
  } = useActivityIntervals(id || '');

  // Track the selected point index from charts for map highlight
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null);
  // Track whether any chart is being interacted with to disable ScrollView
  const [chartInteracting, setChartInteracting] = useState(false);

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
  const { routeGroup: matchedRoute } = useRouteMatch(id, detail?.routeGroups ?? NO_ROUTE_GROUPS);

  // The route result the Routes page opens with, read from the highlight the feed card reads
  const activityIdsForHighlights = useMemo(() => (id ? [id] : []), [id]);
  const { routes: routeHighlightsMap, newGround: newGroundMap } = useActivitySectionHighlights(
    activityIdsForHighlights,
    detail?.highlights
  );
  const routeHighlight = id ? routeHighlightsMap.get(id) : undefined;
  const newGround = id ? newGroundMap.get(id) : undefined;

  const routeOverlayCoordinates = useMemo(
    () => routeOverlayLine(detail, activeTab),
    [activeTab, detail]
  );

  const hasGpsData = coordinates.length > 0;
  const pinnedScrollMaxHeight =
    windowHeight * LARGE_TEXT_PINNED_FRACTION - (hasGpsData ? mapHeight : 0);
  const isRouteMatchingOn = useRouteSettings((s) => s.settings.enabled);
  const isStrength = activity?.sportType === 'WeightTraining';
  const { data: exerciseSets } = useExerciseSets(id || '', activity?.sportType ?? '');
  const { data: athlete } = useAthlete();
  const hasExercises = (exerciseSets?.length ?? 0) > 0;
  const poolSwim = detail?.poolSwim ?? null;
  const hasLengths = showsPoolLengthsTab(poolSwim);

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
    if (hasLengths) {
      allTabs.push({
        key: 'lengths',
        label: t('activityDetail.tabs.lengths'),
        icon: 'swim',
      });
    }
    if (hasGpsData && isRouteMatchingOn) {
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
          count: sectionCardCount,
        }
      );
    }
    return allTabs;
  }, [t, isStrength, hasLengths, hasGpsData, isRouteMatchingOn, sectionCardCount]);

  // Handle chart point selection
  const handlePointSelect = useCallback((index: number | null) => {
    setHighlightIndex(index);
  }, []);

  // Handle chart interaction state changes
  const handleInteractionChange = useCallback((isInteracting: boolean) => {
    setChartInteracting(isInteracting);
  }, []);

  // Map preferences -- read terrain mode and save per-activity overrides
  const { getTerrain3DMode, getActivityCamera } = useMapPreferences();
  const { on3DModeChange, onStyleChange, onCameraCapture, undoCameraCapture } =
    useActivityMapChoices(activity?.id);

  // Save custom camera angle when user exits 3D mode. Undo puts the activity's 3D mode and
  // angle back to before it.
  const handleCameraCapture = useCallback(
    (camera: TerrainCamera) => {
      if (activity?.id) {
        onCameraCapture(camera);
        showNotice({
          message: t('activityDetail.feedPreviewUpdated'),
          action: { label: t('common.undo'), onPress: undoCameraCapture },
        });
      }
    },
    [activity?.id, onCameraCapture, undoCameraCapture, t]
  );

  // Restore saved 3D camera angle, or auto-calculate based on terrain mode
  const terrain3DMode = activity?.sportType
    ? getTerrain3DMode(toActivityType(activity.sportType), activity.id)
    : 'off';

  const saved3DCamera = useMemo(() => {
    if (!activity?.id || terrain3DMode === 'off') return null;
    const lngLatCoords: [number, number][] = coordinates.map((c) => [c.longitude, c.latitude]);
    const verdict = resolveTerrain3D({
      mode: terrain3DMode,
      coordinates: lngLatCoords,
      altitude: streams?.altitude,
      gain: activity.elevationGain,
      distance: activity.distance,
      override: getActivityCamera(activity.id) ?? null,
    });
    return verdict.show3D ? verdict.camera : null;
  }, [activity, terrain3DMode, coordinates, streams, getActivityCamera]);

  // Handle section creation completion
  const handleSectionCreated = useCallback(
    (result: SectionCreationResult) =>
      submitSectionCreation({
        result,
        activity,
        createSection,
        translate: (key) => t(key),
        setMode: setSectionCreationMode,
        setState: setSectionCreationState,
        setError: setSectionCreationError,
      }),
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

  // A section marker tap opens the Sections tab on that section's card
  const [focusSectionId, setFocusSectionId] = useState<string | null>(null);
  const handleSectionMarkerPress = useCallback((sectionId: string) => {
    setActiveTab('sections');
    setFocusSectionId(sectionId);
  }, []);
  const handleSectionFocusHandled = useCallback(() => setFocusSectionId(null), []);

  // Handle GPX export
  const handleExportGpx = useCallback(
    (anchor: React.RefObject<ViewInstance | null>) => {
      if (activity) {
        exportGpx({
          name: activity.name || 'Activity',
          points: coordinates,
          ...(activity.startDateLocal !== undefined && { time: activity.startDateLocal }),
          ...(activity.sportType !== undefined && { sport: activity.sportType }),
          anchor,
        });
      }
    },
    [activity, coordinates, exportGpx]
  );

  // Over the map, the strength diagrams, or the skeleton standing in for them, the header is
  // transparent and draws no title. Every other state takes the opaque header. Either way the
  // navigation item carries the name once it is known, for screen readers and for the next
  // screen's back control.
  const showsHero =
    isLoading || streamsLoading || (!error && !!activity && (hasGpsData || isStrength));
  const headerTitle = !error ? activity?.name : undefined;
  const headerOptions = useMemo(
    () =>
      showsHero
        ? overMapHeaderOptions({ title: headerTitle, isDark })
        : noHeroHeaderOptions({ title: headerTitle, isDark, os: Platform.OS }),
    [showsHero, headerTitle, isDark]
  );

  if (isLoading || streamsLoading) {
    return (
      <ScreenSafeAreaView
        testID="activity-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <Stack.Screen options={headerOptions} />
        <MapHeroStatusBar scrolledPastHero={false} isDark={isDark} />
        <ActivityDetailSkeleton activityId={id || ''} />
      </ScreenSafeAreaView>
    );
  }

  // A deep link or push can name an activity the library has never held. The
  // engine is downloading it, so the screen waits until the hook's deadline and
  // then retries the download. Offline or signed out, the engine starts no
  // download, so the screen says what will fix it rather than waiting. Only a
  // failed read of the stored row is a load failure, and its retry re-reads
  // that row.
  if (!error && !activity) {
    const timedOut = waitEnded(bodyStatus);
    const refusedWithFix = bodyStatus === 'offline' || bodyStatus === 'notConfigured';
    return (
      <ScreenSafeAreaView
        testID="activity-detail-screen"
        style={[styles.container, isDark && styles.containerDark]}
      >
        <Stack.Screen options={headerOptions} />
        <View style={styles.loadingContainer}>
          {timedOut ? (
            <ErrorState
              error={undefined}
              fallbackKey="activitySummary.unavailable"
              onRetry={retryBody}
            />
          ) : refusedWithFix ? (
            <BodyNotDownloaded
              testID="activity-detail-not-downloaded"
              style={styles.waiting}
              textStyle={{ color: isDark ? darkColors.textSecondary : colors.textSecondary }}
              message={t('activitySummary.notDownloaded')}
              status={bodyStatus}
              onRetry={retryBody}
            />
          ) : (
            <View testID="activity-detail-waiting" style={styles.waiting}>
              <Spinner size="large" label={t('activitySummary.downloading')} />
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
        <Stack.Screen options={headerOptions} />
        <View style={styles.loadingContainer}>
          <ErrorState
            error={error}
            fallbackKey="activityDetail.failedToLoad"
            onRetry={() => refetch()}
          />
        </View>
      </ScreenSafeAreaView>
    );
  }

  const strengthHero = (
    <>
      {/* Strength Training hero - body diagrams with overlay (back button, name, date, duration) */}
      {isStrength ? (
        <ComponentErrorBoundary part="muscleGroups" debugName="Muscle Groups">
          <MuscleGroupView
            activityId={id}
            activity={activity}
            hasExercises={hasExercises}
            isDark={isDark}
            athleteSex={athlete?.sex}
            exerciseSets={exerciseSets}
          />
        </ComponentErrorBoundary>
      ) : null}
    </>
  );

  const pinnedText = (
    <>
      {/* No map to carry the date and stats, so they sit under the header */}
      {!hasGpsData && !isStrength && (
        <ActivitySummaryStrip activity={activity} isMetric={isMetric} isDark={isDark} />
      )}

      {/* Activity description */}
      {activity.description ? (
        <View style={[styles.descriptionContainer, isDark && styles.descriptionContainerDark]}>
          <Text style={[styles.descriptionText, isDark && styles.descriptionTextDark]}>
            {activity.description}
          </Text>
        </View>
      ) : null}
    </>
  );

  return (
    <View
      testID="activity-detail-screen"
      style={[styles.container, isDark && styles.containerDark]}
    >
      <Stack.Screen options={headerOptions} />
      {showsHero ? <MapHeroStatusBar scrolledPastHero={false} isDark={isDark} /> : null}

      {largeText ? null : strengthHero}

      {/* Hero Map Section - hidden for non-GPS activities */}
      {hasGpsData ? (
        <ActivityHeader
          activity={activity}
          activityId={id}
          coordinates={coordinates}
          hasStoredTrack={detail?.hasGpsTrack ?? false}
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
          on3DModeChange={on3DModeChange}
          onStyleChange={onStyleChange}
          onCameraCapture={handleCameraCapture}
          initial3DCamera={saved3DCamera}
          activeTab={activeTab}
          routeOverlayCoordinates={routeOverlayCoordinates}
          sectionOverlays={isRouteMatchingOn ? sectionOverlays : null}
          sectionRowLabels={sectionRowLabelMap}
          highlightedSectionId={highlightedSectionId}
          onSectionMarkerPress={isRouteMatchingOn ? handleSectionMarkerPress : undefined}
        />
      ) : null}

      {/* Past the dense cap the text under the map grows past the window, so it scrolls in a
          bounded block and the tabs keep a region. The map stays out of it to keep its gestures. */}
      {largeText ? (
        <ScrollView
          testID="activity-detail-pinned-scroll"
          style={[styles.pinnedScroll, { maxHeight: pinnedScrollMaxHeight }]}
        >
          {strengthHero}
          {pinnedText}
        </ScrollView>
      ) : (
        pinnedText
      )}

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
          intervalsStatus={intervalsStatus}
          onRetryIntervals={retryIntervals}
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
          maxHrSource={detail?.maxHrSource}
          fitnessImpact={detail?.fitnessImpact}
          summary={detail?.summary}
          newGround={newGround}
          hrZones={detail?.hrZones}
          powerZones={detail?.powerZones}
          intervalsId={detail?.intervalsId}
          transitionSettled={transitionSettled}
          onPointSelect={handlePointSelect}
          onInteractionChange={handleInteractionChange}
          onExportGpx={handleExportGpx}
        />

        {/* Tab 2: Exercises (only for strength activities) */}
        {isStrength ? (
          <ScrollView
            style={styles.exercisesTab}
            contentContainerStyle={styles.exercisesTabContent}
          >
            <ExerciseTable
              activityId={id}
              activityType={toActivityType(activity.sportType)}
              isDark={isDark}
              athleteSex={athlete?.sex}
              exerciseGroups={detail?.exerciseGroups}
            />
          </ScrollView>
        ) : null}

        {/* Lengths (only for a pool swim with lengths, or one still owed its file) */}
        {hasLengths && poolSwim ? (
          <ScrollView
            style={styles.exercisesTab}
            contentContainerStyle={styles.exercisesTabContent}
          >
            <PoolLengthsTable poolSwim={poolSwim} />
          </ScrollView>
        ) : null}

        {/* Tab 3: Routes (only for GPS activities) */}
        {hasGpsData && detailReadFailed ? (
          <ActivityDetailReadFailed error={detailError} onRetry={refreshDetail} />
        ) : null}
        {hasGpsData && detailReadFailed ? (
          <ActivityDetailReadFailed error={detailError} onRetry={refreshDetail} />
        ) : null}
        {hasGpsData && !detailReadFailed ? (
          <ActivityRoutesSection
            activityId={activity.id}
            activityType={toActivityType(activity.sportType)}
            hasMatchedRoute={!!matchedRoute}
            routeImprovementSeconds={
              routeHighlight?.isPr ? (routeHighlight.prImprovementSeconds ?? null) : null
            }
            routeGapSeconds={routeHighlight?.timeDeltaSeconds ?? null}
            cacheDays={cacheDays}
            isDark={isDark}
          />
        ) : null}

        {/* Tab 3: Sections (only for GPS activities) */}
        {hasGpsData && !detailReadFailed ? (
          <ActivitySectionsSection
            activityId={id}
            sportType={toActivityType(activity.sportType)}
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
            focusSectionId={focusSectionId}
            onFocusHandled={handleSectionFocusHandled}
          />
        ) : null}
      </SwipeableTabs>
    </View>
  );
}

const BOTTOM_BAR_HEIGHT = 80;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfacePage,
  },
  containerDark: {
    backgroundColor: darkColors.surfacePage,
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
  pinnedScroll: {
    flexGrow: 0,
  },
  descriptionContainer: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: stroke.hairline,
    borderBottomColor: colors.border,
  },
  descriptionContainerDark: {
    backgroundColor: darkColors.surface,
    borderBottomColor: darkColors.border,
  },
  descriptionText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  descriptionTextDark: {
    color: darkColors.textSecondary,
  },
});
