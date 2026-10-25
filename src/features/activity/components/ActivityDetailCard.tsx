/**
 * An activity's card: in its map sheet the name, the date line and the distance, moving time and
 * climbing at Peek, the description under them, then the tab strip and its pages. The map the
 * sheet sits over draws the track, and reads what the card shares (the tab on show, the chart's
 * scrub point, the section a row highlights) from the host's entry.
 *
 * An activity with no track has no map to sit over, so the same card is drawn as a plain screen
 * instead (`variant="screen"`): the strength diagrams or the summary strip under the header, the
 * description, then the tabs.
 *
 * The strip stays above the pages at every stop and only a page scrolls, so a drag on a page
 * scrolls it and the sheet takes the drag once the page is at its top edge.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { ViewInstance } from 'react-native';
import type { RouteGroup as NativeRouteGroup, Section as NativeSection } from 'veloqrs';

import {
  BodyNotDownloaded,
  ComponentErrorBoundary,
  ErrorState,
  ExpandableText,
  Spinner,
  SwipeableTabs,
  type SwipeableTab,
} from '@/shared/ui';
import { usePagerPageScrollProps } from '@/shared/ui/pagerPageScroll';
import { LARGE_TEXT_PINNED_FRACTION, useLargeText } from '@/shared/ui/useLargeText';
import { useMetricSystem, useTheme } from '@/shared/app';
import { useAthlete } from '@/shared/app/useAthlete';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { useMapSheetCardAddress, useMapSheetHostHeader } from '@/shared/app/MapSheetHost';
import { useMapSheetStop } from '@/shared/app/mapSheetStop';
import { noHeroHeaderOptions, overMapHeaderOptions } from '@/shared/app/screenHeaders';
import { waitEnded } from '@/shared/native/engineBodies';
import { toActivityType } from '@/types';
import {
  useActivityRematch,
  useCustomSections,
  useRouteMatch,
  useRouteSettings,
  useSectionMatches,
} from '@/features/routes';
import { useWellnessForDate } from '@/features/wellness';
import { useDebugStore, useGpxExport } from '@/features/settings';
import { ExerciseTable, MuscleGroupView, useExerciseSets } from '@/features/strength';
import { colors, darkColors, spacing, stroke } from '@/theme';
import {
  useActivity,
  useActivityDetailStreams,
  useActivityIntervals,
  useActivitySectionHighlights,
} from '../hooks';
import { useActivityDetailData } from '../hooks/useActivityDetailData';
import { useRetryActivitySync } from '../hooks/useRetryActivitySync';
import { ActivitySyncFailureNotice } from './ActivitySyncFailure';
import { ActivityHeldBackNotice } from './ActivityHeldBack';
import { groupSectionEncounters } from '../lib/groupSectionEncounters';
import { activityHeroStats } from '../lib/activityHeroStats';
import {
  activityCardWriter,
  mountedActivityTab,
  useCardFocusSection,
  type ActivityTab,
} from '../lib/activityCardState';
import { ActivityChartsSection } from './ActivityChartsSection';
import { ActivityDetailReadFailed } from './ActivityDetailReadFailed';
import { ActivityRoutesSection } from './ActivityRoutesSection';
import { ActivitySectionsSection } from './ActivitySectionsSection';
import { ActivityPeek } from './ActivityPeek';
import { ActivitySummaryStrip } from './ActivitySummaryStrip';
import { PoolLengthsTable, showsPoolLengthsTab } from './PoolLengthsTable';

/** Stable empty list so the custom-sections hook keeps skipping its own read. */
const NO_CUSTOM_SECTIONS: NativeSection[] = [];
const NO_ROUTE_GROUPS: NativeRouteGroup[] = [];

export interface ActivityDetailCardProps {
  /** The activity's id. */
  id: string;
  /** The tab the card opens on, as a link names it. */
  tab?: string | undefined;
  /** In the map sheet, or a plain screen for an activity with no track. */
  variant?: 'sheet' | 'screen';
  /** The route's opening transition has ended, which the charts wait on before their heavy work. */
  transitionSettled?: boolean;
}

export function ActivityDetailCard({
  id,
  tab,
  variant = 'sheet',
  transitionSettled = true,
}: ActivityDetailCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const debugEnabled = useDebugStore((s) => s.enabled);
  const largeText = useLargeText();
  const { height: windowHeight } = useWindowDimensions();
  const inSheet = variant === 'sheet';
  const { hostKey, index: cardIndex } = useMapSheetCardAddress('activity', id);
  const card = useMemo(() => activityCardWriter(hostKey, cardIndex), [hostKey, cardIndex]);

  const { data: activity, isLoading, error, refetch, bodyStatus, retryBody } = useActivity(id);
  const {
    data: streams,
    isLoading: streamsLoading,
    isDownloaded: streamsDownloaded,
    bodyStatus: streamsStatus,
    retryBody: retryStreams,
    coordinates,
  } = useActivityDetailStreams(id);
  const { exportGpx, exporting: gpxExporting } = useGpxExport();

  // One engine call covering route match, section matches, encounters,
  // highlights, overlays and engine counts.
  const { data: detail, error: detailError, refresh: refreshDetail } = useActivityDetailData(id);
  const { retry: retrySync } = useRetryActivitySync(id, refreshDetail);
  const detailReadFailed = !detail && detailError !== undefined;

  const activityDate = activity?.startDateLocal?.split('T')[0];
  const { data: activityWellness } = useWellnessForDate(activityDate);

  // The tab is the card's own, and the map reads it from the card's state, which outlives a
  // presentation of the sheet and so gives the tab back when a stop move mounts the card again.
  const [activeTab, setActiveTab] = useState<ActivityTab>(() =>
    mountedActivityTab(hostKey, cardIndex, tab)
  );
  useEffect(() => {
    card.setActiveTab(activeTab);
  }, [card, activeTab]);

  const {
    data: intervalsData,
    outcome: intervalsOutcome,
    bodyStatus: intervalsStatus,
    retryBody: retryIntervals,
  } = useActivityIntervals(id);

  // A chart scrub is the map's to draw, so the card hands the point over.
  const handlePointSelect = useCallback(
    (index: number | null) => card.setHighlightIndex(index),
    [card]
  );
  // Whether a chart is being scrubbed, which holds the page's scroll still.
  const [chartInteracting, setChartInteracting] = useState(false);

  // Drawing a section is a tool on the map, which the stop store runs.
  const { toolActive: sectionCreationMode, enterTool, leaveTool } = useMapSheetStop(hostKey);
  const handleSectionCreationModeChange = useCallback(
    (mode: boolean) => (mode ? enterTool() : leaveTool()),
    [enterTool, leaveTool]
  );

  // The batch owns the custom sections here, empty until it lands, so the hook
  // never opens a read of its own on this screen.
  const { removeSection, sections: customMatchedSections } = useCustomSections({
    preComputedSections: detail?.customSections ?? NO_CUSTOM_SECTIONS,
  });

  // The section a long press holds highlighted, which the map draws over the rest.
  const [highlightedSectionId, setHighlightedSectionId] = useState<string | null>(null);
  useEffect(() => {
    card.setHighlightedSectionId(highlightedSectionId);
  }, [card, highlightedSectionId]);

  const cacheDays = useCacheDays(detail?.activityCount);
  const { routeGroup: matchedRoute } = useRouteMatch(id, detail?.routeGroups ?? NO_ROUTE_GROUPS);

  // The route result the Routes page opens with, read from the highlight the feed card reads
  const activityIdsForHighlights = useMemo(() => (id ? [id] : []), [id]);
  const { routes: routeHighlightsMap, newGround: newGroundMap } = useActivitySectionHighlights(
    activityIdsForHighlights,
    detail?.highlights
  );
  const routeHighlight = id ? routeHighlightsMap.get(id) : undefined;
  const newGround = id ? newGroundMap.get(id) : undefined;

  const hasGpsData = coordinates.length > 0;
  const isRouteMatchingOn = useRouteSettings((s) => s.settings.enabled);
  const isStrength = activity?.sportType === 'WeightTraining';
  const { data: exerciseSets } = useExerciseSets(id, activity?.sportType ?? '');
  const { data: athlete } = useAthlete();
  const hasExercises = (exerciseSets?.length ?? 0) > 0;
  const poolSwim = detail?.poolSwim ?? null;
  const hasLengths = showsPoolLengthsTab(poolSwim);

  // Memoised so a re-render hands the hook the same bundle wrapper.
  const preComputedMatches = useMemo(
    () => ({
      sections: detail?.matchedSections ?? [],
      sectionCount: detail?.sectionCount ?? 0,
    }),
    [detail]
  );
  const { count: engineSectionCount } = useSectionMatches(id, preComputedMatches);

  const {
    matches: scanMatches,
    hasScanned,
    scan: scanForSections,
    rematch: rematchSection,
  } = useActivityRematch();
  const handleScan = useCallback(() => scanForSections(id), [scanForSections, id]);
  const handleRematch = useCallback(
    (sectionId: string) => rematchSection(id, sectionId),
    [rematchSection, id]
  );

  // The engine returns encounters ordered by where each starts along this
  // activity's track, so the numbered rows follow it from start to finish.
  const encounters = useMemo(() => detail?.encounters ?? [], [detail]);
  // The Sections tab counts cards, and a section crossed both ways is one card.
  const sectionCardCount = useMemo(() => groupSectionEncounters(encounters), [encounters]).length;

  const tabs = useMemo<SwipeableTab[]>(() => {
    const allTabs: SwipeableTab[] = [
      { key: 'charts', label: t('activityDetail.tabs.charts'), icon: 'chart-line' },
    ];
    if (isStrength) {
      allTabs.push({
        key: 'exercises',
        label: t('activityDetail.tabs.exercises'),
        icon: 'dumbbell',
      });
    }
    if (hasLengths) {
      allTabs.push({ key: 'lengths', label: t('activityDetail.tabs.lengths'), icon: 'swim' });
    }
    if (hasGpsData && isRouteMatchingOn) {
      allTabs.push(
        { key: 'routes', label: t('activityDetail.tabs.route'), icon: 'map-marker-path' },
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

  // A marker tap on the map opens the Sections tab on that section's row.
  const focusSectionId = useCardFocusSection(hostKey, cardIndex);
  const [focusTaken, setFocusTaken] = useState<string | null>(null);
  if (focusSectionId !== focusTaken) {
    setFocusTaken(focusSectionId);
    if (focusSectionId) setActiveTab('sections');
  }
  const handleSectionFocusHandled = useCallback(() => card.sectionShown(), [card]);

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

  // In the sheet the header floats over the map and draws no title. On the plain screen it is
  // the opaque header over the strength diagrams, or the opaque one. Either way the navigation
  // item carries the name once it is known, for screen readers and for the next screen's back.
  const overDiagrams = !error && !!activity && isStrength && !hasGpsData;
  const headerTitle = !error ? activity?.name : undefined;
  const headerOptions = useMemo(
    () =>
      inSheet || overDiagrams || isLoading || streamsLoading
        ? overMapHeaderOptions({ title: headerTitle, isDark })
        : noHeroHeaderOptions({ title: headerTitle, isDark, os: Platform.OS }),
    [inSheet, overDiagrams, isLoading, streamsLoading, headerTitle, isDark]
  );
  useMapSheetHostHeader(headerOptions);

  const pageScroll = usePagerPageScrollProps();
  // The sheet draws its own ground; the plain screen paints the page's.
  const ground = inSheet ? null : isDark ? styles.pageDark : styles.page;
  const secondaryText = { color: isDark ? darkColors.textSecondary : colors.textSecondary };

  if (isLoading || streamsLoading) {
    return (
      <View testID="activity-detail-screen" style={[styles.fill, styles.centred, ground]}>
        <Spinner size="large" label={t('activitySummary.downloading')} />
      </View>
    );
  }

  // A deep link or push can name an activity the library has never held. The
  // engine is downloading it, so the card waits until the hook's deadline and
  // then retries the download. Offline or signed out, the engine starts no
  // download, so the card says what will fix it rather than waiting. Only a
  // failed read of the stored row is a load failure, and its retry re-reads
  // that row.
  if (!error && !activity) {
    const timedOut = waitEnded(bodyStatus);
    const refusedWithFix = bodyStatus === 'offline' || bodyStatus === 'notConfigured';
    return (
      <View testID="activity-detail-screen" style={[styles.fill, styles.centred, ground]}>
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
            textStyle={secondaryText}
            message={t('activitySummary.notDownloaded')}
            status={bodyStatus}
            onRetry={retryBody}
          />
        ) : (
          <View testID="activity-detail-waiting" style={styles.waiting}>
            <Spinner size="large" label={t('activitySummary.downloading')} />
            <Text style={secondaryText}>{t('activitySummary.downloading')}</Text>
          </View>
        )}
      </View>
    );
  }

  if (error || !activity) {
    return (
      <View testID="activity-detail-screen" style={[styles.fill, styles.centred, ground]}>
        <ErrorState
          error={error}
          fallbackKey="activityDetail.failedToLoad"
          onRetry={() => refetch()}
        />
      </View>
    );
  }

  const activityType = toActivityType(activity.sportType);

  const strengthHero =
    !inSheet && isStrength ? (
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
    ) : null;

  const peek = inSheet ? (
    <ActivityPeek
      activityId={id}
      name={activity.name ?? ''}
      activityType={activityType}
      startDateLocal={activity.startDateLocal}
      stats={activityHeroStats(activity, isMetric, t)}
      debugEnabled={debugEnabled}
    />
  ) : null;

  const pinnedText = (
    <>
      {peek}
      {/* With no map to carry the date and stats, they sit under the header */}
      {!inSheet && !isStrength && (
        <ActivitySummaryStrip activity={activity} isMetric={isMetric} isDark={isDark} />
      )}
      {detail?.heldBack ? (
        <ActivityHeldBackNotice activityId={id} heldBack={detail.heldBack} />
      ) : null}
      {detail?.syncFailure ? (
        <ActivitySyncFailureNotice
          activityId={id}
          failure={detail.syncFailure}
          onRetry={retrySync}
        />
      ) : null}
      {activity.description ? (
        <View
          style={[
            styles.descriptionContainer,
            !inSheet && styles.descriptionOnScreen,
            !inSheet && isDark && styles.descriptionOnScreenDark,
          ]}
        >
          <ExpandableText text={activity.description} testID="activity-description" />
        </View>
      ) : null}
    </>
  );

  return (
    <View testID="activity-detail-screen" style={[styles.fill, ground]}>
      {largeText ? null : strengthHero}

      {/* Past the dense cap the text above the tabs grows past the window, so it scrolls in a
          bounded block and the tabs keep a region. */}
      {largeText ? (
        <ScrollView
          testID="activity-detail-pinned-scroll"
          style={[styles.pinnedScroll, { maxHeight: windowHeight * LARGE_TEXT_PINNED_FRACTION }]}
        >
          {strengthHero}
          {pinnedText}
        </ScrollView>
      ) : (
        pinnedText
      )}

      <SwipeableTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(key) => setActiveTab(key as ActivityTab)}
        isDark={isDark}
        lazy
      >
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
          provenance={detail?.provenance}
          heldBack={detail?.heldBack}
          transitionSettled={transitionSettled}
          onPointSelect={handlePointSelect}
          onInteractionChange={setChartInteracting}
          onExportGpx={handleExportGpx}
        />

        {isStrength ? (
          <ScrollView
            style={styles.exercisesTab}
            contentContainerStyle={styles.exercisesTabContent}
            {...pageScroll}
          >
            <ExerciseTable
              activityId={id}
              activityType={activityType}
              isDark={isDark}
              athleteSex={athlete?.sex}
              exerciseGroups={detail?.exerciseGroups}
            />
          </ScrollView>
        ) : null}

        {hasLengths && poolSwim ? (
          <ScrollView
            style={styles.exercisesTab}
            contentContainerStyle={styles.exercisesTabContent}
            {...pageScroll}
          >
            <PoolLengthsTable poolSwim={poolSwim} />
          </ScrollView>
        ) : null}

        {hasGpsData && detailReadFailed ? (
          <ActivityDetailReadFailed error={detailError} onRetry={refreshDetail} />
        ) : null}
        {hasGpsData && detailReadFailed ? (
          <ActivityDetailReadFailed error={detailError} onRetry={refreshDetail} />
        ) : null}
        {hasGpsData && !detailReadFailed ? (
          <ActivityRoutesSection
            activityId={activity.id}
            activityType={activityType}
            hasMatchedRoute={!!matchedRoute}
            routeImprovementSeconds={
              routeHighlight?.isPr ? (routeHighlight.prImprovementSeconds ?? null) : null
            }
            routeGapSeconds={routeHighlight?.timeDeltaSeconds ?? null}
            cacheDays={cacheDays}
            isDark={isDark}
          />
        ) : null}

        {hasGpsData && !detailReadFailed ? (
          <ActivitySectionsSection
            activityId={id}
            sportType={activityType}
            encounters={encounters}
            ledgerChanges={detail?.ledgerChanges}
            coordinates={coordinates}
            isDark={isDark}
            isMetric={isMetric}
            sectionCreationMode={sectionCreationMode}
            cacheDays={cacheDays}
            highlightedSectionId={highlightedSectionId}
            onHighlightedSectionIdChange={setHighlightedSectionId}
            onSectionCreationModeChange={handleSectionCreationModeChange}
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
  fill: {
    flex: 1,
  },
  page: {
    backgroundColor: colors.surfacePage,
  },
  pageDark: {
    backgroundColor: darkColors.surfacePage,
  },
  centred: {
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
  },
  descriptionOnScreen: {
    backgroundColor: colors.surface,
    borderBottomWidth: stroke.hairline,
    borderBottomColor: colors.border,
  },
  descriptionOnScreenDark: {
    backgroundColor: darkColors.surface,
    borderBottomColor: darkColors.border,
  },
});
