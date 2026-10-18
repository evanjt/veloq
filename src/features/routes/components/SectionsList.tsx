/**
 * Sections list component.
 * Displays unified sections (auto-detected + custom + potential).
 *
 * Activity traces are pre-computed in Rust during section detection,
 * so no expensive on-the-fly computation is needed here.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSectionRescan } from '@/features/routes/hooks/useSectionRescan';
import { useDetectionHold } from '@/features/routes/hooks/useDetectionHold';
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';
import { useTheme } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { ScreenRefreshControl } from '@/shared/ui/ScreenRefreshControl';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, opacity, spacing } from '@/theme';
import { useSections } from '@/features/routes/hooks/useSections';
import { SportFilterChips } from './SportFilterChips';
import {
  hidesBeyondDefault,
  type SectionHideFlags,
  type SectionsSortOption,
} from '@/features/routes/lib/routesScreenQuery';
import { filterSummary } from '@/shared/format/filterSummary';
import { Button, EmptyState, ErrorState, ExplanationCard } from '@/shared/ui';
import { RowSkeleton } from '@/features/routes/components/RowSkeleton';
import { SectionRow } from './SectionRow';
import { SectionSwipeAction, sectionSwipeAction, sectionSwipeKind } from './SectionSwipeAction';
import { DataRangeFooter } from './DataRangeFooter';
import { sectionsExplanation } from '@/features/routes/lib/explanationCopy';
import { SectionsListHeader } from './SectionsListHeader';
import { CatalogueEmptyState } from './CatalogueEmptyState';
import { SectionsListFiltersBar } from './SectionsListFiltersBar';
import { useSectionCommands } from '@/features/routes/hooks/useCustomSections';
import { navigateTo } from '@/shared/app/navigation';
import {
  FLOW_ADD_ONE,
  FLOW_SECTION_OPEN,
  completeFlowAfterFrame,
  markFlow,
} from '@/shared/debug/flowTiming';
import { debug } from '@/shared/debug/debug';
import { getEngine } from '@/shared/native/engine';
import { engineErrorKey } from '@/shared/native/engineError';
import type { FrequentSection } from '@/types';
import { type FfiCatalogueEmptyReason, type SectionWithPolyline } from 'veloqrs';
import { convertSectionWithPolylineToApp } from '@/shared/ffi/sectionConversions';
import { computeCenter, haversineDistance, type LatLngShort } from '@/shared/geo/distance';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';
import { confirmAction, inform } from '@/shared/ui/dialog';
import { removeSectionWithUndo, restoreSection } from '@/features/routes/lib/sectionVisibility';
import type { AccessibleAction } from '@/shared/ui/accessibleActions';
import { useScrollToTopOnReselect } from '@/shared/ui/tabReselect';

const log = debug.create('SectionsList');

interface SectionsListProps {
  /** Pre-loaded engine sections with polylines from batch FFI call */
  batchSections?: SectionWithPolyline[] | undefined;
  /** Callback to load more sections (pagination) */
  onLoadMore?: (() => void) | undefined;
  /** Whether more sections are available to load */
  hasMore?: boolean | undefined;
  /** Total section count from engine (for accurate filter badge counts) */
  totalSectionCount?: number | undefined;
  /** Sections the search and filters leave, for the header beside the list. */
  shownSectionCount?: number | undefined;
  /** User's current location for "Nearby" sort */
  userLocation?: LatLngShort | null | undefined;
  /** Active sort option */
  sortOption: SectionsSortOption;
  /** Called when sort changes */
  onSortChange: (next: SectionsSortOption) => void;
  /** The search term the engine filtered on */
  searchQuery: string;
  /** Called when the search term changes */
  onSearchChange: (next: string) => void;
  /** The sports the athlete has activities in, offered as the sport chips */
  sportOptions?: string[] | undefined;
  /** The sport the list is narrowed to, if any */
  sportType?: string | undefined;
  /** Called with the sport chosen, or undefined for all sports */
  onSportChange?: (next: string | undefined) => void;
  /** Which kinds the engine is hiding */
  hiddenFilters: SectionHideFlags;
  /** Called when a filter chip is pressed */
  onHiddenFiltersChange: (next: SectionHideFlags) => void;
  /** Clears the search, the sport and the hide flags together, from a list they have emptied */
  onClearFilters?: (() => void) | undefined;
  /** Auto sections awaiting review, over the catalogue rather than the page */
  unacceptedAutoCount: number;
  /** Auto sections already accepted, over the catalogue rather than the page */
  acceptedAutoCount: number;
  /** Custom sections over the catalogue rather than the page */
  customSectionCount: number;
  /** Retired auto sections over the catalogue rather than the page */
  retiredSectionCount: number;
  /** The page read failed: shown with a retry, never as an empty library */
  loadError?: unknown;
  /** Reads the page again after a failure */
  onRetry?: (() => void) | undefined;
  /** Why the engine holds no section of any kind, or null while it holds one */
  emptyReason?: FfiCatalogueEmptyReason | null | undefined;
  /** Called when the athlete pulls the page down; without it the page offers no refresh */
  onRefresh?: (() => unknown) | undefined;
  /** A refresh or the sync it asked for is running */
  refreshing?: boolean | undefined;
}

export type { SectionsSortOption };

interface SectionListItemProps {
  index: number;
  item: FrequentSection;
  isDark: boolean;
  isDisabled: boolean;
  distanceFromUser?: number | undefined;
  onPress: (id: string) => void;
  onSwipeableOpen: (id: string) => void;
  onDelete: (item: FrequentSection) => void;
  onToggleHide: (item: FrequentSection) => void;
  swipeableRefs: React.MutableRefObject<Map<string, SwipeableMethods | null>>;
  t: (key: string) => string;
}

export const SectionListItem = memo(
  function SectionListItem({
    index,
    item,
    isDark,
    isDisabled,
    distanceFromUser,
    onPress,
    onSwipeableOpen,
    onDelete,
    onToggleHide,
    swipeableRefs,
    t,
  }: SectionListItemProps) {
    // The swipe button and the screen reader's action are one action, so the
    // label and the handler cannot drift apart.
    const swipeKind = sectionSwipeKind(item.sectionType, isDisabled);
    const rowAction = useMemo<AccessibleAction>(
      () =>
        sectionSwipeAction(swipeKind, t, () =>
          swipeKind === 'delete' ? onDelete(item) : onToggleHide(item)
        ),
      [swipeKind, item, onDelete, onToggleHide, t]
    );
    const rowActions = useMemo(() => [rowAction], [rowAction]);

    const renderRightActions = useCallback(
      (_progress: SharedValue<number>, drag: SharedValue<number>) => (
        <SectionSwipeAction kind={swipeKind} action={rowAction} drag={drag} />
      ),
      [swipeKind, rowAction]
    );

    return (
      <Swipeable
        ref={(ref) => {
          if (ref) {
            swipeableRefs.current.set(item.id, ref);
          } else {
            swipeableRefs.current.delete(item.id);
          }
        }}
        renderRightActions={renderRightActions}
        onSwipeableOpen={() => onSwipeableOpen(item.id)}
        overshootRight={false}
        friction={2}
      >
        <View
          testID={`section-row-${index}`}
          style={[
            styles.swipeableContent,
            isDark && styles.swipeableContentDark,
            isDisabled && styles.disabledSection,
          ]}
        >
          <SectionRow
            section={item}
            isDisabled={isDisabled}
            distanceFromUser={distanceFromUser}
            onPress={onPress}
            actions={rowActions}
          />
        </View>
      </Swipeable>
    );
  },
  (prev, next) =>
    rowIsUnchanged(
      {
        record: prev.item,
        extras: [prev.isDisabled, prev.isDark, prev.distanceFromUser],
      },
      {
        record: next.item,
        extras: [next.isDisabled, next.isDark, next.distanceFromUser],
      }
    )
);

export const SectionsList = memo(function SectionsList({
  batchSections,
  onLoadMore,
  hasMore = false,
  totalSectionCount,
  shownSectionCount,
  userLocation,
  sortOption,
  onSortChange,
  searchQuery,
  onSearchChange,
  sportOptions = [],
  sportType,
  onSportChange,
  hiddenFilters,
  onHiddenFiltersChange,
  onClearFilters,
  unacceptedAutoCount,
  acceptedAutoCount,
  customSectionCount,
  retiredSectionCount,
  loadError,
  onRetry,
  emptyReason = null,
  onRefresh,
  refreshing = false,
}: SectionsListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const listRef = useRef<FlatList<FrequentSection>>(null);
  useScrollToTopOnReselect('/insights', listRef);

  // The list record already carries its polyline, so a row needs no call of
  // its own. The centre is the list's proximity sort, the screen's and not
  // the record's.
  const preloadedEngineSections = useMemo(() => {
    if (!batchSections) return undefined;
    return batchSections.map((record) => {
      const section = convertSectionWithPolylineToApp(record);
      section.center = record.bounds
        ? computeCenter({
            minLat: record.bounds.minLat,
            maxLat: record.bounds.maxLat,
            minLng: record.bounds.minLng,
            maxLng: record.bounds.maxLng,
          })
        : undefined;
      return section;
    });
  }, [batchSections]);

  const {
    sections: unifiedSections,
    count: totalCount,
    isLoading,
  } = useSections({ preloadedEngineSections });

  const { removeSection } = useSectionCommands();
  const { rescan, isScanning, refusal: rescanRefusal } = useSectionRescan();
  const detectionHold = useDetectionHold();
  const elevationBackfill = useElevationBackfill();

  // Track open swipeable refs to close them when another opens
  const swipeableRefs = useRef<Map<string, SwipeableMethods | null>>(new Map());
  const openSwipeableRef = useRef<string | null>(null);

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();

  // The engine ordered, searched, filtered and counted the catalogue before it
  // paged it, so the rows arrive ready to render and the two review counts come
  // with them. Doing any of it again here would read one page and call it the
  // library.
  const regularSections = unifiedSections;

  // Pre-compute distance from user for each section (used for display on every row)
  const distanceMap = useMemo(() => {
    if (!userLocation) return null;
    const map = new Map<string, number>();
    for (const s of regularSections) {
      if (s.center) {
        map.set(s.id, haversineDistance(userLocation, s.center));
      }
    }
    return map;
  }, [regularSections, userLocation]);

  // Toggle filter - pressing hides/shows that type
  const handleFilterPress = useCallback(
    (filterType: keyof SectionHideFlags) => {
      onHiddenFiltersChange({ ...hiddenFilters, [filterType]: !hiddenFilters[filterType] });
    },
    [hiddenFilters, onHiddenFiltersChange]
  );

  const isReady = !isLoading;

  useEffect(() => {
    if (isReady) completeFlowAfterFrame(FLOW_ADD_ONE);
  }, [isReady, unifiedSections]);

  // Note: Activity traces are no longer pre-loaded to reduce memory usage
  // Each row draws the polyline its page carries

  // Navigate to section detail page
  const handleSectionPress = useCallback((id: string) => {
    markFlow(FLOW_SECTION_OPEN);
    navigateTo(`/section/${id}`);
  }, []);

  // Handle accepting all auto sections
  const [acceptAllResult, setAcceptAllResult] = useState<number | null>(null);
  useEffect(() => {
    if (acceptAllResult === null) return undefined;
    const timer = setTimeout(() => setAcceptAllResult(null), 3000);
    return () => clearTimeout(timer);
  }, [acceptAllResult]);
  const handleAcceptAll = useCallback(() => {
    confirmAction({
      title: t('sections.acceptAllSections'),
      message: t('sections.acceptAllConfirm', { count: unacceptedAutoCount }),
      confirmLabel: t('sections.acceptAllSections'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        // A failure is said as one, never as a count of none accepted.
        try {
          setAcceptAllResult(getEngine()?.acceptAllSections() ?? 0);
        } catch (error) {
          inform({
            title: t('sections.acceptAllFailedTitle'),
            message: t(engineErrorKey(error, 'engine.failure.database')),
          });
        }
      },
    });
  }, [t, unacceptedAutoCount]);

  // The catalogue's own count, not the page's: a page the filters emptied is
  // not a library with no sections.
  const catalogueCount = totalSectionCount ?? totalCount;
  const filtered =
    searchQuery.trim().length > 0 || sportType !== undefined || hidesBeyondDefault(hiddenFilters);

  const renderEmpty = () => {
    if (loadError && onRetry) {
      return <ErrorState error={loadError} onRetry={onRetry} testID="sections-load-failure" />;
    }

    if (!isReady) {
      return (
        <View style={styles.skeletonList}>
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </View>
      );
    }

    if (emptyReason) {
      return <CatalogueEmptyState reason={emptyReason} kind="sections" />;
    }

    if (filtered) {
      const named = filterSummary(
        t,
        searchQuery,
        sportType === undefined ? [] : [t(`activityTypes.${sportType}` as never, sportType)]
      );
      return (
        <EmptyState
          icon="filter-remove-outline"
          title={
            named
              ? t('routes.noSectionsFor', { filters: named })
              : t('routes.noSectionsMatchFilter')
          }
          actionLabel={t('common.clearFilters')}
          onAction={onClearFilters}
          actionTestID="sections-clear-filters"
        />
      );
    }

    // Every section the catalogue holds is one the default hides, the retired ones.
    return <EmptyState icon="filter-remove-outline" title={t('routes.noSectionsMatchFilter')} />;
  };

  const sortChips: { key: SectionsSortOption; label: string }[] = useMemo(
    () => [
      { key: 'nearby', label: t('routes.sortNearby' as never) as string },
      { key: 'signature', label: t('routes.sortRelevance' as never) as string },
      { key: 'visits', label: t('routes.sortMostVisited' as never) as string },
      { key: 'distance', label: t('routes.sortDistance' as never) as string },
      { key: 'name', label: t('routes.sortNameAZ' as never) as string },
    ],
    [t]
  );

  const handleRescan = useCallback(() => {
    if (!isScanning) {
      rescan();
    }
  }, [isScanning, rescan]);

  const displaySectionCount = catalogueCount;

  // Close any open swipeable when another opens
  const handleSwipeableOpen = useCallback((id: string) => {
    if (openSwipeableRef.current && openSwipeableRef.current !== id) {
      const previousSwipeable = swipeableRefs.current.get(openSwipeableRef.current);
      previousSwipeable?.close();
    }
    openSwipeableRef.current = id;
  }, []);

  // Remove or restore an auto section. Removal keeps it, so it runs at once with Undo.
  const handleToggleHide = useCallback(
    (item: FrequentSection) => {
      const swipeable = swipeableRefs.current.get(item.id);
      swipeable?.close();

      if (item.disabled || item.supersededBy) {
        restoreSection(item.id, t);
      } else {
        removeSectionWithUndo(item.id, t);
      }
    },
    [t]
  );

  // Handle delete action for custom sections
  const handleDelete = useCallback(
    (item: FrequentSection) => {
      const swipeable = swipeableRefs.current.get(item.id);
      swipeable?.close();

      confirmAction({
        title: t('sections.deleteSection'),
        message: t('sections.deleteSectionConfirm', { name: item.name || item.id }),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: true,
        onConfirm: async () => {
          try {
            await removeSection(item.id);
          } catch (error) {
            log.error('Failed to delete section:', error);
            inform({ title: t('sections.deleteFailedTitle'), message: t('sections.deleteFailed') });
          }
        },
      });
    },
    [removeSection, t]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: FrequentSection; index: number }) => (
      <SectionListItem
        item={item}
        index={index}
        isDark={isDark}
        isDisabled={!!(item.disabled || item.supersededBy)}
        distanceFromUser={distanceMap?.get(item.id)}
        onPress={handleSectionPress}
        onSwipeableOpen={handleSwipeableOpen}
        onDelete={handleDelete}
        onToggleHide={handleToggleHide}
        swipeableRefs={swipeableRefs}
        t={t as unknown as (key: string) => string}
      />
    ),
    [
      isDark,
      distanceMap,
      handleSectionPress,
      handleSwipeableOpen,
      handleDelete,
      handleToggleHide,
      t,
    ]
  );

  const renderFooter = () => {
    if (regularSections.length === 0) return null;
    return (
      <View>
        {hasMore ? <RowSkeleton /> : null}
        <Button
          testID="sections-retired-link"
          variant="ghost"
          style={styles.retiredLink}
          onPress={() => navigateTo('/section-retired')}
          icon="history"
          label={t('sectionHistory.seeRetired')}
        />
        <Button
          testID="sections-named-corridors-link"
          variant="ghost"
          style={styles.retiredLink}
          onPress={() => navigateTo('/named-corridors')}
          icon="tag-outline"
          label={t('namedCorridors.link')}
        />
        <DataRangeFooter days={cacheDays} isDark={isDark} />
        <View style={styles.explanation}>
          <ExplanationCard {...sectionsExplanation(t)} testID="sections-explanation" />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.outerContainer}>
      <View style={styles.header}>
        <SectionsListHeader
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          displaySectionCount={displaySectionCount}
          shownSectionCount={shownSectionCount ?? displaySectionCount}
          unacceptedAutoCount={unacceptedAutoCount}
          acceptAllResult={acceptAllResult}
          isScanning={isScanning}
          detectionHold={detectionHold}
          rescanRefusal={rescanRefusal}
          elevationBackfill={elevationBackfill}
          onAcceptAll={handleAcceptAll}
          onRescan={handleRescan}
        />
        {onSportChange && (sportOptions.length > 1 || sportType !== undefined) ? (
          <SportFilterChips
            options={sportOptions}
            selectedType={sportType}
            onSelect={onSportChange}
          />
        ) : null}
        <SectionsListFiltersBar
          regularSectionsCount={regularSections.length}
          sortOption={sortOption}
          onSortChange={onSortChange}
          sortChips={sortChips}
          customCount={customSectionCount}
          hiddenFilters={hiddenFilters}
          onFilterPress={handleFilterPress}
          trueDisabledCount={retiredSectionCount}
          unacceptedAutoCount={unacceptedAutoCount}
          acceptedAutoCount={acceptedAutoCount}
        />
      </View>

      <FlatList
        ref={listRef}
        testID={regularSections.length > 0 ? 'sections-list' : 'sections-list-empty'}
        style={styles.flatList}
        data={regularSections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={regularSections.length === 0 ? styles.emptyList : styles.list}
        ListHeaderComponentStyle={{ margin: 0, padding: 0 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReached={hasMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.5}
        removeClippedSubviews
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={8}
        refreshControl={
          onRefresh ? (
            <ScreenRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          ) : undefined
        }
      />
    </View>
  );
});

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
  },
  flatList: {
    marginTop: 0,
  },
  explanation: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  list: {
    paddingBottom: spacing.xxl,
  },
  emptyList: {
    flexGrow: 1,
  },
  header: {
    marginBottom: 0,
  },
  retiredLink: {
    alignSelf: 'center',
    marginVertical: spacing.xs,
  },
  disabledSection: {
    opacity: opacity.dim,
  },
  swipeableContent: {
    backgroundColor: colors.surface,
  },
  swipeableContentDark: {
    backgroundColor: darkColors.surfacePage,
  },
  skeletonList: {
    paddingTop: spacing.md,
  },
});
