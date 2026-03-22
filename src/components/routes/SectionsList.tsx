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
import { useTheme, useCacheDays } from '@/hooks';
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
import { useDisabledSections } from '@/providers/DisabledSectionsStore';
import { useSupersededSections } from '@/providers/SupersededSectionsStore';
import { debug, navigateTo, getActivityIcon, getActivityColor } from '@/lib';
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
}

type HiddenFilters = {
  custom: boolean;
  auto: boolean;
  disabled: boolean;
};

type SortOption = 'visits' | 'distance' | 'name' | 'nearby';

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
          swipeableRefs.current.set(item.id, ref);
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

export function SectionsList({
  sportType,
  prefetchedData,
  batchSections,
  onLoadMore,
  hasMore = false,
  totalSectionCount,
  userLocation,
}: SectionsListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [hiddenFilters, setHiddenFilters] = useState<HiddenFilters>({
    custom: false,
    auto: false,
    disabled: true, // Hidden sections are hidden by default
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>(userLocation ? 'nearby' : 'visits');
  const [selectedSportFilter, setSelectedSportFilter] = useState<string | null>(null);
  const sortInitRef = useRef(false);

  // Switch to 'nearby' sort once location first becomes available
  React.useEffect(() => {
    if (userLocation && !sortInitRef.current) {
      sortInitRef.current = true;
      setSortOption('nearby');
    }
  }, [userLocation]);

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

  // Collect unique sport types across all sections for filter chips
  const availableSportTypes = useMemo(() => {
    const types = new Set<string>();
    for (const s of unifiedSections) {
      if (s.sportTypes) {
        for (const st of s.sportTypes) types.add(st);
      } else if (s.sportType) {
        types.add(s.sportType);
      }
    }
    return Array.from(types).sort();
  }, [unifiedSections]);

  const { createSection, removeSection } = useCustomSections();
  const disabledIds = useDisabledSections((s) => s.disabledIds);
  const { disable, enable } = useDisabledSections();

  // Compute true total counts for filter badges (independent of pagination)
  const supersededBy = useSupersededSections((s) => s.supersededBy);
  const supersededCount = useMemo(() => {
    let count = 0;
    for (const ids of Object.values(supersededBy)) {
      count += ids.length;
    }
    return count;
  }, [supersededBy]);

  const trueAutoCount =
    totalSectionCount != null
      ? Math.max(0, totalSectionCount - supersededCount - disabledIds.size)
      : autoCount;
  const trueDisabledCount = totalSectionCount != null ? disabledIds.size : disabledCount;

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
        const isAuto = section.sectionType === 'auto' && !disabledIds.has(section.id);
        const isDisabledAuto = section.sectionType === 'auto' && disabledIds.has(section.id);

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

        // Apply sport type filter
        if (selectedSportFilter) {
          const sectionSports = section.sportTypes ?? [section.sportType];
          if (!sectionSports.includes(selectedSportFilter)) {
            continue;
          }
        }

        regular.push(section);
      }
    }

    // Apply sort
    if (sortOption === 'distance') {
      regular.sort((a, b) => (b.distanceMeters ?? 0) - (a.distanceMeters ?? 0));
    } else if (sortOption === 'name') {
      regular.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    } else if (sortOption === 'nearby' && userLocation) {
      regular.sort((a, b) => {
        const distA = a.center ? haversineDistance(userLocation, a.center) : Infinity;
        const distB = b.center ? haversineDistance(userLocation, b.center) : Infinity;
        return distA - distB;
      });
    }
    // 'visits' is the default order from useUnifiedSections (visitCount DESC)

    return { regularSections: regular, potentialSections: potential };
  }, [unifiedSections, hiddenFilters, searchQuery, sortOption, selectedSportFilter, userLocation]);

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

  const sortOptions: SortOption[] = useMemo(() => {
    const opts: SortOption[] = ['visits', 'distance', 'name'];
    if (userLocation) opts.push('nearby');
    return opts;
  }, [userLocation]);

  const sortLabelKeys: Record<SortOption, string> = {
    visits: 'routes.sortMostVisited',
    distance: 'routes.sortDistance',
    name: 'routes.sortNameAZ',
    nearby: 'routes.sortNearby',
  };

  const handleCycleSort = useCallback(() => {
    setSortOption((current) => {
      const idx = sortOptions.indexOf(current);
      return sortOptions[(idx + 1) % sortOptions.length];
    });
  }, [sortOptions]);

  const renderHeader = () => (
    <View style={styles.header}>
      {/* Section type counts - clickable to hide/show types */}
      {(customCount > 0 || trueAutoCount > 0 || trueDisabledCount > 0) && (
        <View style={styles.sectionCounts}>
          {customCount > 0 && (
            <TouchableOpacity
              style={[
                styles.countBadge,
                styles.customBadge,
                hiddenFilters.custom && styles.countBadgeHidden,
              ]}
              onPress={() => handleFilterPress('custom')}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={hiddenFilters.custom ? 'eye-off' : 'account'}
                size={12}
                color={hiddenFilters.custom ? colors.textDisabled : colors.primary}
              />
              <Text
                style={[
                  styles.countText,
                  {
                    color: hiddenFilters.custom ? colors.textDisabled : colors.primary,
                  },
                  hiddenFilters.custom && styles.countTextHidden,
                ]}
              >
                {customCount} {t('routes.custom')}
              </Text>
            </TouchableOpacity>
          )}
          {trueAutoCount > 0 && (
            <TouchableOpacity
              style={[
                styles.countBadge,
                styles.autoBadge,
                hiddenFilters.auto && styles.countBadgeHidden,
              ]}
              onPress={() => handleFilterPress('auto')}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={hiddenFilters.auto ? 'eye-off' : 'auto-fix'}
                size={12}
                color={hiddenFilters.auto ? colors.textDisabled : colors.success}
              />
              <Text
                style={[
                  styles.countText,
                  {
                    color: hiddenFilters.auto ? colors.textDisabled : colors.success,
                  },
                  hiddenFilters.auto && styles.countTextHidden,
                ]}
              >
                {trueAutoCount} {t('routes.autoDetected')}
              </Text>
            </TouchableOpacity>
          )}
          {trueDisabledCount > 0 && (
            <TouchableOpacity
              style={[
                styles.countBadge,
                hiddenFilters.disabled ? styles.showHiddenBadge : styles.disabledBadge,
              ]}
              onPress={() => handleFilterPress('disabled')}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={hiddenFilters.disabled ? 'delete-restore' : 'delete-outline'}
                size={12}
                color={hiddenFilters.disabled ? colors.primary : colors.warning}
              />
              <Text
                style={[
                  styles.countText,
                  {
                    color: hiddenFilters.disabled ? colors.primary : colors.warning,
                  },
                ]}
              >
                {hiddenFilters.disabled
                  ? t('routes.showRemoved', { count: trueDisabledCount })
                  : `${trueDisabledCount} ${t('sections.removed')}`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Sort control */}
      {regularSections.length > 1 && (
        <TouchableOpacity
          style={[styles.sortControl, isDark && styles.sortControlDark]}
          onPress={handleCycleSort}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="sort"
            size={14}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.sortText, isDark && styles.sortTextDark]}>
            {t(sortLabelKeys[sortOption] as never)}
          </Text>
          <MaterialCommunityIcons
            name="chevron-down"
            size={14}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </TouchableOpacity>
      )}

      {/* Potential section suggestions */}
      {potentialSections.length > 0 && (
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
      )}
    </View>
  );

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
    async (item: UnifiedSection) => {
      const swipeable = swipeableRefs.current.get(item.id);
      swipeable?.close();

      if (disabledIds.has(item.id)) {
        await enable(item.id);
      } else {
        Alert.alert(t('sections.removeSection'), t('sections.removeSectionConfirm'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.remove'),
            style: 'destructive',
            onPress: () => disable(item.id),
          },
        ]);
      }
    },
    [disable, enable, t]
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
        isDisabled={disabledIds.has(item.id)}
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
      disabledIds,
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
        <View style={[styles.infoNotice, isDark && styles.infoNoticeDark]}>
          <MaterialCommunityIcons
            name="information-outline"
            size={14}
            color={isDark ? darkColors.textDisabled : colors.textDisabled}
          />
          <Text style={[styles.infoText, isDark && styles.infoTextDark]}>
            {t('routes.frequentSectionsInfo')}
          </Text>
        </View>
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
        {availableSportTypes.length > 1 && (
          <View style={styles.sportFilterRow}>
            {availableSportTypes.map((st) => {
              const isActive = selectedSportFilter === st;
              const sportColor = getActivityColor(st as any);
              return (
                <TouchableOpacity
                  key={st}
                  style={[
                    styles.sportFilterChip,
                    isDark && styles.sportFilterChipDark,
                    isActive && { backgroundColor: sportColor + '20', borderColor: sportColor },
                  ]}
                  onPress={() => setSelectedSportFilter(isActive ? null : st)}
                >
                  <MaterialCommunityIcons
                    name={getActivityIcon(st)}
                    size={14}
                    color={
                      isActive
                        ? sportColor
                        : isDark
                          ? darkColors.textSecondary
                          : colors.textSecondary
                    }
                  />
                  <Text
                    style={[
                      styles.sportFilterLabel,
                      isDark && styles.textMuted,
                      isActive && { color: sportColor },
                    ]}
                  >
                    {st}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <FlatList
        testID="sections-list"
        data={regularSections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        contentContainerStyle={regularSections.length === 0 ? styles.emptyList : styles.list}
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
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
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
  sportFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  sportFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
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
    marginTop: spacing.sm,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
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
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadius,
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
  sortControl: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginRight: spacing.md,
  },
  sortControlDark: {},
  sortText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  sortTextDark: {
    color: darkColors.textSecondary,
  },
  showAction: {
    backgroundColor: colors.success,
  },
  loadingMore: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
});
