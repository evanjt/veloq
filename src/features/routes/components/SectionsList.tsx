/**
 * Sections list component.
 * Displays unified sections (auto-detected + custom + potential).
 *
 * Activity traces are pre-computed in Rust during section detection,
 * so no expensive on-the-fly computation is needed here.
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Animated,
  ActivityIndicator,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { RectButton } from 'react-native-gesture-handler';
import { useSectionRescan } from '@/features/routes/hooks/useSectionRescan';
import { useDetectionHold } from '@/features/routes/hooks/useDetectionHold';
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';
import { useTheme } from '@/shared/app';
import { useCacheDays } from '@/shared/app/useCacheDays';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { useSections } from '@/features/routes/hooks/useSections';
import { SportFilterMenu } from './SportFilterMenu';
import type { SectionHideFlags, SectionsSortOption } from '@/features/routes/lib/routesScreenQuery';
import { EmptyState } from '@/shared/ui';
import { RowSkeleton } from '@/features/routes/components/RowSkeleton';
import { SectionRow } from './SectionRow';
import { DataRangeFooter } from './DataRangeFooter';
import { SectionsListHeader } from './SectionsListHeader';
import { SectionsListFiltersBar } from './SectionsListFiltersBar';
import { useCustomSections } from '@/features/routes/hooks/useCustomSections';
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
import { type SectionWithPolyline } from 'veloqrs';
import { convertSectionWithPolylineToApp } from '@/shared/ffi/sectionConversions';
import { computeCenter, haversineDistance, type LatLngShort } from '@/shared/geo/distance';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';

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
  /** The sports the athlete has activities in, offered in the sport filter menu */
  sportOptions?: string[] | undefined;
  /** The sport the list is narrowed to, if any */
  sportType?: string | undefined;
  /** Called with the sport chosen, or undefined for all sports */
  onSportChange?: (next: string | undefined) => void;
  /** Which kinds the engine is hiding */
  hiddenFilters: SectionHideFlags;
  /** Called when a filter chip is pressed */
  onHiddenFiltersChange: (next: SectionHideFlags) => void;
  /** Auto sections awaiting review, over the catalogue rather than the page */
  unacceptedAutoCount: number;
  /** Auto sections already accepted, over the catalogue rather than the page */
  acceptedAutoCount: number;
  /** Custom sections over the catalogue rather than the page */
  customSectionCount: number;
  /** Retired auto sections over the catalogue rather than the page */
  retiredSectionCount: number;
  /** The page read failed: shown with a retry, never as an empty library */
  loadError?: Error | null | undefined;
  /** Reads the page again after a failure */
  onRetry?: (() => void) | undefined;
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
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable | null>>;
  t: (key: string) => string;
}

const SectionListItem = memo(
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
    const renderRightActions = useCallback(
      (
        _progress: Animated.AnimatedInterpolation<number>,
        dragX: Animated.AnimatedInterpolation<number>
      ) => {
        const isCustom = item.sectionType === 'custom';

        const opacity = dragX.interpolate({
          inputRange: [-80, -40, 0],
          outputRange: [1, 0.8, 0],
          extrapolate: 'clamp',
        });

        if (isCustom) {
          return (
            <Animated.View style={[styles.swipeAction, styles.deleteAction, { opacity }]}>
              <RectButton style={styles.swipeActionButton} onPress={() => onDelete(item)}>
                <MaterialCommunityIcons name="delete" size={24} color={colors.textOnDark} />
                <Text style={styles.swipeActionText}>{t('common.delete')}</Text>
              </RectButton>
            </Animated.View>
          );
        }

        return (
          <Animated.View
            style={[
              styles.swipeAction,
              isDisabled ? styles.showAction : styles.deleteAction,
              { opacity },
            ]}
          >
            <RectButton style={styles.swipeActionButton} onPress={() => onToggleHide(item)}>
              <MaterialCommunityIcons
                name={isDisabled ? 'undo' : 'delete-outline'}
                size={24}
                color={colors.textOnDark}
              />
              <Text style={styles.swipeActionText}>
                {isDisabled ? t('common.restore') : t('common.remove')}
              </Text>
            </RectButton>
          </Animated.View>
        );
      },
      [item, isDisabled, onDelete, onToggleHide, t]
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
  unacceptedAutoCount,
  acceptedAutoCount,
  customSectionCount,
  retiredSectionCount,
  loadError,
  onRetry,
}: SectionsListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

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

  const { removeSection } = useCustomSections();
  const { rescan, isScanning, refusal: rescanRefusal } = useSectionRescan();
  const detectionHold = useDetectionHold();
  const elevationBackfill = useElevationBackfill();

  // Track open swipeable refs to close them when another opens
  const swipeableRefs = useRef<Map<string, Swipeable | null>>(new Map());
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
    Alert.alert(
      t('sections.acceptAllSections'),
      t('sections.acceptAllConfirm', { count: unacceptedAutoCount }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.confirm'),
          onPress: () => {
            // A failure is said as one, never as a count of none accepted.
            try {
              setAcceptAllResult(getEngine()?.acceptAllSections() ?? 0);
            } catch (error) {
              Alert.alert(t('alerts.error'), t(engineErrorKey(error, 'engine.failure.database')));
            }
          },
        },
      ]
    );
  }, [t, unacceptedAutoCount]);

  const renderEmpty = () => {
    if (loadError) {
      return (
        <EmptyState
          icon="alert-circle-outline"
          title={t('emptyState.error.title')}
          description={t('emptyState.error.description')}
          actionLabel={t('common.retry')}
          onAction={onRetry}
        />
      );
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

    if (totalCount === 0) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="road-variant"
            size={48}
            color={isDark ? darkColors.iconDisabled : colors.gray400}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            {t('routes.noFrequentSections')}
          </Text>
          <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
            {t('routes.sectionsDescription')}
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons
          name="filter-remove-outline"
          size={48}
          color={isDark ? darkColors.iconDisabled : colors.gray400}
        />
        <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
          {t('routes.noSectionsMatchFilter')}
        </Text>
        <Text style={[styles.emptySubtitle, isDark && styles.textMuted]}>
          {t('routes.adjustSportTypeFilter')}
        </Text>
      </View>
    );
  };

  const sortChips: {
    key: SectionsSortOption;
    label: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
  }[] = useMemo(
    () => [
      { key: 'nearby', label: t('routes.sortNearby' as never) as string, icon: 'crosshairs-gps' },
      {
        key: 'signature',
        label: t('routes.sortRelevance' as never) as string,
        icon: 'star-four-points-outline',
      },
      {
        key: 'visits',
        label: t('routes.sortMostVisited' as never) as string,
        icon: 'sort-numeric-descending',
      },
      {
        key: 'distance',
        label: t('routes.sortDistance' as never) as string,
        icon: 'map-marker-distance',
      },
      {
        key: 'name',
        label: t('routes.sortNameAZ' as never) as string,
        icon: 'sort-alphabetical-ascending',
      },
    ],
    [t]
  );

  const handleRescan = useCallback(() => {
    if (!isScanning) {
      rescan();
    }
  }, [isScanning, rescan]);

  const displaySectionCount = totalSectionCount ?? totalCount;

  // Close any open swipeable when another opens
  const handleSwipeableOpen = useCallback((id: string) => {
    if (openSwipeableRef.current && openSwipeableRef.current !== id) {
      const previousSwipeable = swipeableRefs.current.get(openSwipeableRef.current);
      previousSwipeable?.close();
    }
    openSwipeableRef.current = id;
  }, []);

  // Handle remove/restore action for auto sections
  const handleToggleHide = useCallback(
    (item: FrequentSection) => {
      const swipeable = swipeableRefs.current.get(item.id);
      swipeable?.close();

      if (item.disabled || item.supersededBy) {
        getEngine()?.enableSection(item.id);
      } else {
        Alert.alert(t('sections.removeSection'), t('sections.removeSectionConfirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.remove'),
            style: 'destructive',
            onPress: () => getEngine()?.disableSection(item.id),
          },
        ]);
      }
    },
    [t]
  );

  // Handle delete action for custom sections
  const handleDelete = useCallback(
    (item: FrequentSection) => {
      const swipeable = swipeableRefs.current.get(item.id);
      swipeable?.close();

      Alert.alert(
        t('sections.deleteSection'),
        t('sections.deleteSectionConfirm', { name: item.name || item.id }),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              try {
                await removeSection(item.id);
              } catch (error) {
                log.error('Failed to delete section:', error);
              }
            },
          },
        ]
      );
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
        {hasMore && (
          <View style={styles.loadingMore}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
        <TouchableOpacity
          testID="sections-retired-link"
          style={styles.retiredLink}
          onPress={() => router.push('/section-retired' as Href)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="history" size={16} color={colors.textSecondary} />
          <Text style={[styles.retiredLinkText, isDark && styles.textMuted]}>
            {t('sectionHistory.seeRetired')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="sections-named-corridors-link"
          style={styles.retiredLink}
          onPress={() => router.push('/named-corridors' as Href)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="tag-outline" size={16} color={colors.textSecondary} />
          <Text style={[styles.retiredLinkText, isDark && styles.textMuted]}>
            {t('namedCorridors.link')}
          </Text>
        </TouchableOpacity>
        <DataRangeFooter days={cacheDays} isDark={isDark} />
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
        {onSportChange && (sportOptions.length > 1 || sportType !== undefined) && (
          <SportFilterMenu
            options={sportOptions.map((type) => ({ type }))}
            selectedType={sportType}
            onSelect={onSportChange}
          />
        )}
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
      />
    </View>
  );
});

const LIST_EMPTY_VERTICAL_PADDING = spacing.xxl * 2;

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
  },
  flatList: {
    marginTop: 0,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  retiredLinkText: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding * 2,
    paddingVertical: LIST_EMPTY_VERTICAL_PADDING,
  },
  emptyTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: typography.bodySmall.fontSize,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacing.lg,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  disabledSection: {
    opacity: 0.6,
  },
  swipeableContent: {
    backgroundColor: colors.surface,
  },
  swipeableContentDark: {
    backgroundColor: darkColors.background,
  },
  swipeAction: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeActionButton: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swipeActionText: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
    color: colors.textOnDark,
  },
  deleteAction: {
    backgroundColor: colors.error,
  },
  showAction: {
    backgroundColor: colors.success,
  },
  loadingMore: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  skeletonList: {
    paddingTop: spacing.md,
  },
});
