/**
 * Sections list component.
 * Displays unified sections (auto-detected + custom + potential).
 *
 * Activity traces are pre-computed in Rust during section detection,
 * so no expensive on-the-fly computation is needed here.
 */

import React, { memo, useCallback, useMemo, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Platform,
  TouchableOpacity,
  Alert,
  Animated,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { RectButton } from 'react-native-gesture-handler';
import { useTheme, useCacheDays, useSectionRescan } from '@/hooks';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing, layout } from '@/theme';
import { useUnifiedSections } from '@/hooks/routes/useUnifiedSections';
import { SectionRow } from './SectionRow';
import { PotentialSectionCard } from './PotentialSectionCard';
import { DataRangeFooter } from './DataRangeFooter';
import { useCustomSections } from '@/hooks/routes/useCustomSections';
import { useSectionDismissals } from '@/providers/SectionDismissalsStore';
import { debug, navigateTo } from '@/lib';
import { getRouteEngine } from '@/lib/native/routeEngine';
import type { UnifiedSection, FrequentSection } from '@/types';
import type { SectionWithPolyline } from 'veloqrs';
import { generateSectionName } from '@/hooks/routes/useUnifiedSections';
import { computeCenter, haversineDistance, type LatLng } from '@/lib/geo/distance';

const log = debug.create('SectionsList');

interface SectionsListProps {
  /** Filter by sport type */
  sportType?: string;
  /** Pre-fetched data from parent to avoid duplicate FFI calls */
  prefetchedData?: {
    sections: UnifiedSection[];
    count: number;
    autoCount: number;
    customCount: number;
    potentialCount: number;
    disabledCount: number;
    isLoading: boolean;
    error: Error | null;
  };
  /** Pre-loaded engine sections with polylines from batch FFI call */
  batchSections?: SectionWithPolyline[];
  /** Callback to load more sections (pagination) */
  onLoadMore?: () => void;
  /** Whether more sections are available to load */
  hasMore?: boolean;
  /** Total section count from engine (for accurate filter badge counts) */
  totalSectionCount?: number;
  /** User's current location for "Nearby" sort */
  userLocation?: LatLng | null;
  /** Active sort option */
  sortOption: SectionsSortOption;
  /** Called when sort changes */
  onSortChange: (next: SectionsSortOption) => void;
}

type HiddenFilters = {
  custom: boolean;
  auto: boolean;
  disabled: boolean;
};

export type SectionsSortOption = 'visits' | 'distance' | 'name' | 'nearby';

/**
 * Convert batch SectionWithPolyline to FrequentSection for useUnifiedSections.
 * Pre-populates polylines so SectionRow doesn't need per-row FFI calls.
 */
function batchSectionToFrequentSection(s: SectionWithPolyline): FrequentSection {
  // Convert flat coords [lat1, lng1, lat2, lng2, ...] to RoutePoint[]
  const polyline: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < s.polyline.length - 1; i += 2) {
    polyline.push({ lat: s.polyline[i], lng: s.polyline[i + 1] });
  }
  const center = s.bounds
    ? computeCenter({
        minLat: s.bounds.minLat,
        maxLat: s.bounds.maxLat,
        minLng: s.bounds.minLng,
        maxLng: s.bounds.maxLng,
      })
    : undefined;
  const section: FrequentSection = {
    id: s.id,
    sectionType: s.id.startsWith('custom_') ? 'custom' : 'auto',
    sportType: s.sportType,
    polyline,
    activityIds: [],
    routeIds: [],
    visitCount: s.visitCount,
    distanceMeters: s.distanceMeters,
    confidence: s.confidence,
    scale: s.scale ?? undefined,
    name: s.name ?? undefined,
    createdAt: new Date().toISOString(),
    sportTypes: 'sportTypes' in s ? (s as any).sportTypes : undefined,
    center,
  };
  // Generate display name using same logic as useFrequentSections
  if (!section.name) {
    section.name = generateSectionName(section);
  }
  return section;
}

interface SectionListItemProps {
  item: UnifiedSection;
  isDark: boolean;
  isDisabled: boolean;
  distanceFromUser?: number;
  onPress: (id: string) => void;
  onSwipeableOpen: (id: string) => void;
  onDelete: (item: UnifiedSection) => void;
  onToggleHide: (item: UnifiedSection) => void;
  swipeableRefs: React.MutableRefObject<Map<string, Swipeable | null>>;
  t: (key: string) => string;
}

const SectionListItem = memo(
  function SectionListItem({
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
  (prev, next) => {
    // Custom comparator: skip re-render if actual data hasn't changed
    if (prev.item !== next.item) {
      if (
        prev.item.id !== next.item.id ||
        prev.item.visitCount !== next.item.visitCount ||
        prev.item.distanceMeters !== next.item.distanceMeters ||
        prev.item.name !== next.item.name ||
        prev.item.sectionType !== next.item.sectionType
      )
        return false;
    }
    return (
      prev.isDisabled === next.isDisabled &&
      prev.isDark === next.isDark &&
      prev.distanceFromUser === next.distanceFromUser
    );
  }
);

export const SectionsList = memo(function SectionsList({
  sportType,
  prefetchedData,
  batchSections,
  onLoadMore,
  hasMore = false,
  totalSectionCount,
  userLocation,
  sortOption,
  onSortChange,
}: SectionsListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [hiddenFilters, setHiddenFilters] = useState<HiddenFilters>({
    custom: false,
    auto: false,
    disabled: true, // Hidden sections are hidden by default
  });
  const [searchQuery, setSearchQuery] = useState('');

  // Convert batch sections to FrequentSection[] for preloading into useUnifiedSections
  const preloadedEngineSections = useMemo(() => {
    if (!batchSections) return undefined;
    return batchSections.map(batchSectionToFrequentSection);
  }, [batchSections]);

  // Only call hook if data not pre-fetched from parent
  // When batch sections are available, skip engine FFI calls but keep custom/potential loading
  const hookData = useUnifiedSections({
    sportType,
    includeCustom: true,
    includePotentials: true,
    enabled: !prefetchedData,
    preloadedEngineSections,
  });

  // Use pre-fetched data if provided, otherwise use hook data
  const data = prefetchedData ?? hookData;
  const {
    sections: unifiedSections,
    count: totalCount,
    autoCount,
    customCount,
    potentialCount,
    disabledCount,
    isLoading,
  } = data;

  const { createSection, removeSection } = useCustomSections();
  const { rescan, isScanning } = useSectionRescan();

  const trueAutoCount = totalSectionCount != null ? totalSectionCount : autoCount;
  const trueDisabledCount = disabledCount;

  // Track open swipeable refs to close them when another opens
  const swipeableRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const openSwipeableRef = useRef<string | null>(null);

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();

  // Separate regular sections from potential sections, apply filter, search, and sort
  const { regularSections, potentialSections } = useMemo(() => {
    const regular: UnifiedSection[] = [];
    const potential: UnifiedSection[] = [];
    const query = searchQuery.toLowerCase();

    for (const section of unifiedSections) {
      if (section.sectionType === 'potential') {
        potential.push(section);
      } else {
        // Apply hide filters - hide if the filter is set for this type
        const isCustom = section.sectionType === 'custom';
        const isAuto = section.sectionType === 'auto' && !section.disabled && !section.supersededBy;
        const isDisabledAuto =
          section.sectionType === 'auto' && !!(section.disabled || section.supersededBy);

        if (
          (isCustom && hiddenFilters.custom) ||
          (isAuto && hiddenFilters.auto) ||
          (isDisabledAuto && hiddenFilters.disabled)
        ) {
          continue; // Skip (hide) this section
        }

        // Apply search filter
        if (query && !section.name?.toLowerCase().includes(query)) {
          continue;
        }

        regular.push(section);
      }
    }

    // Apply sort
    if (sortOption === 'visits') {
      regular.sort((a, b) => (b.visitCount ?? 0) - (a.visitCount ?? 0));
    } else if (sortOption === 'distance') {
      regular.sort((a, b) => (b.distanceMeters ?? 0) - (a.distanceMeters ?? 0));
    } else if (sortOption === 'name') {
      regular.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    }

    // Preserve native order for nearby sorting so pagination stays correct.

    return { regularSections: regular, potentialSections: potential };
  }, [unifiedSections, hiddenFilters, searchQuery, sortOption]); // userLocation excluded: nearby sorting is Rust-side

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
  const handleFilterPress = useCallback((filterType: keyof HiddenFilters) => {
    setHiddenFilters((current) => ({
      ...current,
      [filterType]: !current[filterType],
    }));
  }, []);

  const isReady = !isLoading;

  // Note: Activity traces are no longer pre-loaded to reduce memory usage
  // Polylines are now lazy-loaded via useSectionPolyline in SectionRow

  // Navigate to section detail page
  const handleSectionPress = useCallback((id: string) => {
    navigateTo(`/section/${id}`);
  }, []);

  // Handle promoting a potential section to a custom section
  const handlePromotePotential = useCallback(
    async (section: UnifiedSection) => {
      if (section.sectionType !== 'potential') return;
      log.log('Promoting potential section:', section.id);
      try {
        await createSection({
          startIndex: 0,
          endIndex: section.polyline.length - 1,
          sourceActivityId: section.activityIds[0] ?? 'unknown',
          sportType: section.sportType,
        });
      } catch (error) {
        log.error('Failed to promote section:', error);
      }
    },
    [createSection]
  );

  // Handle dismissing a potential section
  const dismiss = useSectionDismissals((s) => s.dismiss);
  const handleDismissPotential = useCallback(
    async (section: UnifiedSection) => {
      log.log('Dismissing potential section:', section.id);
      await dismiss(section.id);
    },
    [dismiss]
  );

  const renderEmpty = () => {
    if (!isReady) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons
            name="loading"
            size={48}
            color={isDark ? darkColors.iconDisabled : colors.gray400}
          />
          <Text style={[styles.emptyTitle, isDark && styles.textLight]}>
            {t('routes.loadingSections')}
          </Text>
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

  const sortChips: { key: SectionsSortOption; label: string; icon: string }[] = useMemo(
    () => [
      { key: 'nearby', label: t('routes.sortNearby' as never) as string, icon: 'crosshairs-gps' },
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

  const renderHeader = () => {
    if (potentialSections.length === 0) return null;
    return (
      <View style={styles.suggestionsContainer}>
        <Text style={[styles.suggestionsTitle, isDark && styles.textLight]}>
          {t('routes.suggestions' as never)}
        </Text>
        {potentialSections.slice(0, 3).map((section) => (
          <PotentialSectionCard
            key={section.id}
            section={section}
            onPromote={() => handlePromotePotential(section)}
            onDismiss={() => handleDismissPotential(section)}
          />
        ))}
      </View>
    );
  };

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
    (item: UnifiedSection) => {
      const swipeable = swipeableRefs.current.get(item.id);
      swipeable?.close();

      if (item.disabled || item.supersededBy) {
        getRouteEngine()?.enableSection(item.id);
      } else {
        Alert.alert(t('sections.removeSection'), t('sections.removeSectionConfirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.remove'),
            style: 'destructive',
            onPress: () => getRouteEngine()?.disableSection(item.id),
          },
        ]);
      }
    },
    [t]
  );

  // Handle delete action for custom sections
  const handleDelete = useCallback(
    (item: UnifiedSection) => {
      const swipeable = swipeableRefs.current.get(item.id);
      swipeable?.close();

      Alert.alert(t('sections.deleteSection'), t('sections.deleteSectionConfirm'), [
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
      ]);
    },
    [removeSection, t]
  );

  const renderItem = useCallback(
    ({ item }: { item: UnifiedSection }) => (
      <SectionListItem
        item={item}
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
        <DataRangeFooter days={cacheDays} isDark={isDark} />
      </View>
    );
  };

  return (
    <View style={styles.outerContainer}>
      {/* Search and sport filters — outside FlatList to prevent keyboard dismissal */}
      <View style={styles.header}>
        <View style={[styles.searchContainer, isDark && styles.searchContainerDark]}>
          <MaterialCommunityIcons
            name="magnify"
            size={18}
            color={isDark ? darkColors.textDisabled : colors.textDisabled}
          />
          <TextInput
            style={[styles.searchInput, isDark && styles.searchInputDark]}
            placeholder={t('routes.searchSections')}
            placeholderTextColor={isDark ? darkColors.textDisabled : colors.textDisabled}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
              <MaterialCommunityIcons
                name="close-circle"
                size={16}
                color={isDark ? darkColors.textDisabled : colors.textDisabled}
              />
            </TouchableOpacity>
          )}
        </View>
        {/* Count line */}
        <View style={styles.countRow}>
          <Text style={[styles.summaryText, isDark && styles.summaryTextDark]}>
            {displaySectionCount} {t('trainingScreen.sections')}
          </Text>
          <TouchableOpacity
            onPress={handleRescan}
            disabled={isScanning}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isScanning ? (
              <ActivityIndicator
                size={13}
                color={isDark ? darkColors.textDisabled : colors.textDisabled}
              />
            ) : (
              <MaterialCommunityIcons
                name="reload"
                size={14}
                color={isDark ? darkColors.textDisabled : colors.textDisabled}
              />
            )}
          </TouchableOpacity>
        </View>
        {/* Sort + filter chips */}
        <View style={styles.sortChipRow}>
          {regularSections.length > 1 &&
            sortChips.map((chip) => {
              const isActive = sortOption === chip.key;
              return (
                <TouchableOpacity
                  key={chip.key}
                  style={[
                    styles.sortChip,
                    isDark && styles.sortChipDark,
                    isActive && styles.sortChipActive,
                  ]}
                  onPress={() => onSortChange(chip.key)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name={chip.icon as any}
                    size={13}
                    color={
                      isActive
                        ? colors.primary
                        : isDark
                          ? darkColors.textSecondary
                          : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.sortChipLabel,
                      isDark && styles.textMuted,
                      isActive && styles.sortChipLabelActive,
                    ]}
                  >
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          {customCount > 0 && (
            <TouchableOpacity
              style={[
                styles.sortChip,
                isDark && styles.sortChipDark,
                !hiddenFilters.custom && styles.sortChipActive,
              ]}
              onPress={() => handleFilterPress('custom')}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="account"
                size={13}
                color={
                  !hiddenFilters.custom
                    ? colors.primary
                    : isDark
                      ? darkColors.textSecondary
                      : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.sortChipLabel,
                  isDark && styles.textMuted,
                  !hiddenFilters.custom && styles.sortChipLabelActive,
                ]}
              >
                {customCount} {t('routes.custom')}
              </Text>
            </TouchableOpacity>
          )}
          {trueDisabledCount > 0 && (
            <TouchableOpacity
              style={[
                styles.sortChip,
                isDark && styles.sortChipDark,
                !hiddenFilters.disabled && styles.sortChipActive,
              ]}
              onPress={() => handleFilterPress('disabled')}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={hiddenFilters.disabled ? 'eye-off' : 'eye'}
                size={13}
                color={
                  !hiddenFilters.disabled
                    ? colors.primary
                    : isDark
                      ? darkColors.textSecondary
                      : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.sortChipLabel,
                  isDark && styles.textMuted,
                  !hiddenFilters.disabled && styles.sortChipLabelActive,
                ]}
              >
                {trueDisabledCount} {t('sections.removed')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        testID="sections-list"
        style={styles.flatList}
        data={regularSections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={potentialSections.length > 0 ? renderHeader : null}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={regularSections.length === 0 ? styles.emptyList : styles.list}
        ListHeaderComponentStyle={{ margin: 0, padding: 0 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReached={hasMore ? onLoadMore : undefined}
        onEndReachedThreshold={0.5}
        removeClippedSubviews={Platform.OS === 'ios'}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={8}
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
  list: {
    paddingBottom: spacing.xxl,
  },
  emptyList: {
    flexGrow: 1,
  },
  header: {
    marginBottom: spacing.sm,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: layout.screenPadding * 2,
    paddingVertical: spacing.xxl * 2,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
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
  infoNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginHorizontal: spacing.md,
  },
  infoNoticeDark: {},
  infoText: {
    flex: 1,
    fontSize: 12,
    color: colors.textDisabled,
    lineHeight: 16,
  },
  infoTextDark: {
    color: darkColors.textDisabled,
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginTop: 2,
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  summaryTextDark: {
    color: darkColors.textPrimary,
  },
  sportFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: 2,
  },
  sportFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sportFilterChipDark: {
    borderColor: darkColors.border,
  },
  sportFilterLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  sectionCounts: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: 2,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: layout.borderRadius / 2,
  },
  customBadge: {
    backgroundColor: colors.primary + '20',
  },
  autoBadge: {
    backgroundColor: colors.success + '20',
  },
  disabledBadge: {
    backgroundColor: colors.warning + '20',
  },
  showHiddenBadge: {
    backgroundColor: colors.primary + '20',
  },
  countBadgeHidden: {
    backgroundColor: colors.gray200,
    opacity: 0.7,
  },
  countText: {
    fontSize: 12,
    fontWeight: '600',
  },
  countTextHidden: {
    textDecorationLine: 'line-through',
  },
  suggestionsContainer: {
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  suggestionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
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
    fontSize: 12,
    fontWeight: '600',
    color: colors.textOnDark,
  },
  deleteAction: {
    backgroundColor: colors.error,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 4 : 2,
    borderRadius: 10,
    backgroundColor: colors.gray100,
  },
  searchContainerDark: {
    backgroundColor: darkColors.surface,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchInputDark: {
    color: colors.textOnDark,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginTop: 2,
  },
  rescanButton: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sortChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: 2,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sortChipDark: {
    borderColor: darkColors.border,
  },
  sortChipActive: {
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary,
  },
  sortChipLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  sortChipLabelActive: {
    color: colors.primary,
  },
  showAction: {
    backgroundColor: colors.success,
  },
  loadingMore: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
});
