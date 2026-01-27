/**
 * Sections list component.
 * Displays unified sections (auto-detected + custom + potential).
 *
 * Activity traces are pre-computed in Rust during section detection,
 * so no expensive on-the-fly computation is needed here.
 */

import React, { useCallback, useMemo, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Platform,
  TouchableOpacity,
  Alert,
  Animated,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { RectButton } from 'react-native-gesture-handler';
import { useTheme, useCacheDays } from '@/hooks';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, Href } from 'expo-router';
import { colors, darkColors, spacing, layout } from '@/theme';
import { useUnifiedSections } from '@/hooks/routes/useUnifiedSections';
import { useGroupSummaries } from '@/hooks/routes/useRouteEngine';
import { SectionRow } from './SectionRow';
import { PotentialSectionCard } from './PotentialSectionCard';
import { DataRangeFooter } from './DataRangeFooter';
import { useCustomSections } from '@/hooks/routes/useCustomSections';
import { useSectionDismissals } from '@/providers/SectionDismissalsStore';
import { useDisabledSections } from '@/providers/DisabledSectionsStore';
import { debug } from '@/lib';
import type { UnifiedSection, FrequentSection } from '@/types';

const log = debug.create('SectionsList');

interface SectionsListProps {
  /** Filter by sport type */
  sportType?: string;
}

type HiddenFilters = {
  custom: boolean;
  auto: boolean;
  disabled: boolean;
};

export function SectionsList({ sportType }: SectionsListProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [hiddenFilters, setHiddenFilters] = useState<HiddenFilters>({
    custom: false,
    auto: false,
    disabled: true, // Hidden sections are hidden by default
  });

  const {
    sections: unifiedSections,
    count: totalCount,
    autoCount,
    customCount,
    potentialCount,
    disabledCount,
    isLoading,
  } = useUnifiedSections({
    sportType,
    includeCustom: true,
    includePotentials: true,
  });

  const { createSection, removeSection } = useCustomSections();
  const { disable, enable } = useDisabledSections();

  // Track open swipeable refs to close them when another opens
  const swipeableRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const openSwipeableRef = useRef<string | null>(null);

  // Get cached date range from sync store (consolidated calculation)
  const cacheDays = useCacheDays();

  // Get route group summaries to compute routeIds for custom sections
  // Uses lightweight query-on-demand pattern (no memory bloat)
  const { summaries: routeGroups } = useGroupSummaries({ minActivities: 1 });

  // Note: useFocusEffect refresh removed - hooks now subscribe to engine events
  // and automatically refresh when data changes (e.g., after renaming)

  // Create a mapping from activity ID to route group IDs
  // Note: Group summaries don't include activityIds, so this mapping is empty
  // TODO: If routeIds are needed for custom sections, fetch group details on-demand
  const activityToRouteIds = useMemo(() => {
    // Group summaries don't include activity IDs to save memory
    // Return empty map - routeIds for custom sections will be computed elsewhere if needed
    return new Map<string, string[]>();
  }, []);

  // Separate regular sections from potential sections and apply filter
  const { regularSections, potentialSections } = useMemo(() => {
    const regular: UnifiedSection[] = [];
    const potential: UnifiedSection[] = [];

    for (const section of unifiedSections) {
      if (section.source === 'potential') {
        potential.push(section);
      } else {
        // Apply hide filters - hide if the filter is set for this type
        const isCustom = section.source === 'custom';
        const isAuto = section.source === 'auto' && !section.isDisabled;
        const isDisabledAuto = section.source === 'auto' && section.isDisabled;

        if (
          (isCustom && hiddenFilters.custom) ||
          (isAuto && hiddenFilters.auto) ||
          (isDisabledAuto && hiddenFilters.disabled)
        ) {
          continue; // Skip (hide) this section
        }
        regular.push(section);
      }
    }

    return { regularSections: regular, potentialSections: potential };
  }, [unifiedSections, hiddenFilters]);

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
  const handleSectionPress = useCallback((section: UnifiedSection) => {
    log.log('Section pressed:', section.id);
    router.push(`/section/${section.id}` as Href);
  }, []);

  // Handle promoting a potential section to a custom section
  const handlePromotePotential = useCallback(
    async (section: UnifiedSection) => {
      if (!section.potentialData) return;
      log.log('Promoting potential section:', section.id);
      try {
        await createSection({
          polyline: section.polyline,
          startIndex: 0,
          endIndex: section.polyline.length - 1,
          sourceActivityId: section.potentialData.activityIds[0] ?? 'unknown',
          sportType: section.sportType,
          distanceMeters: section.distanceMeters,
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

  const renderHeader = () => (
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

      {/* Section type counts - clickable to hide/show types */}
      {(customCount > 0 || autoCount > 0 || disabledCount > 0) && (
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
                  { color: hiddenFilters.custom ? colors.textDisabled : colors.primary },
                  hiddenFilters.custom && styles.countTextHidden,
                ]}
              >
                {customCount} {t('routes.custom')}
              </Text>
            </TouchableOpacity>
          )}
          {autoCount > 0 && (
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
                  { color: hiddenFilters.auto ? colors.textDisabled : colors.success },
                  hiddenFilters.auto && styles.countTextHidden,
                ]}
              >
                {autoCount} {t('routes.autoDetected')}
              </Text>
            </TouchableOpacity>
          )}
          {disabledCount > 0 && (
            <TouchableOpacity
              style={[
                styles.countBadge,
                hiddenFilters.disabled ? styles.showHiddenBadge : styles.disabledBadge,
              ]}
              onPress={() => handleFilterPress('disabled')}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={hiddenFilters.disabled ? 'eye' : 'eye-off'}
                size={12}
                color={hiddenFilters.disabled ? colors.primary : colors.warning}
              />
              <Text
                style={[
                  styles.countText,
                  { color: hiddenFilters.disabled ? colors.primary : colors.warning },
                ]}
              >
                {hiddenFilters.disabled
                  ? t('routes.showHidden', { count: disabledCount })
                  : `${disabledCount} ${t('sections.disabled')}`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
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
              section={section.potentialData!}
              onPromote={() => handlePromotePotential(section)}
              onDismiss={() => handleDismissPotential(section)}
            />
          ))}
        </View>
      )}
    </View>
  );

  // Convert UnifiedSection to FrequentSection-like object for SectionRow
  const toFrequentSection = useCallback(
    (section: UnifiedSection): FrequentSection => {
      // If we have engineData, use it directly
      if (section.engineData) {
        return section.engineData;
      }
      // Otherwise, construct a compatible object (for custom sections)
      // Include source activity if not already in matches
      const matchActivityIds = section.customData?.matches.map((m) => m.activityId) ?? [];
      const sourceActivityId = section.customData?.sourceActivityId;
      const activityIds =
        sourceActivityId && !matchActivityIds.includes(sourceActivityId)
          ? [sourceActivityId, ...matchActivityIds]
          : matchActivityIds;

      // Compute routeIds by finding which routes contain this section's activities
      const routeIdSet = new Set<string>();
      for (const activityId of activityIds) {
        const routes = activityToRouteIds.get(activityId);
        if (routes) {
          for (const routeId of routes) {
            routeIdSet.add(routeId);
          }
        }
      }

      return {
        id: section.id,
        sportType: section.sportType,
        polyline: section.polyline,
        activityIds,
        routeIds: Array.from(routeIdSet),
        visitCount: activityIds.length,
        distanceMeters: section.distanceMeters,
        name: section.name,
      };
    },
    [activityToRouteIds]
  );

  // Close any open swipeable when another opens
  const handleSwipeableOpen = useCallback((id: string) => {
    if (openSwipeableRef.current && openSwipeableRef.current !== id) {
      const previousSwipeable = swipeableRefs.current.get(openSwipeableRef.current);
      previousSwipeable?.close();
    }
    openSwipeableRef.current = id;
  }, []);

  // Handle hide/show action for auto sections
  const handleToggleHide = useCallback(
    async (item: UnifiedSection) => {
      const swipeable = swipeableRefs.current.get(item.id);
      swipeable?.close();

      if (item.isDisabled) {
        await enable(item.id);
      } else {
        await disable(item.id);
      }
    },
    [disable, enable]
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

  // Render swipe actions (right side)
  const renderRightActions = useCallback(
    (
      item: UnifiedSection,
      _progress: Animated.AnimatedInterpolation<number>,
      dragX: Animated.AnimatedInterpolation<number>
    ) => {
      const isCustom = item.source === 'custom';
      const isDisabled = item.isDisabled;

      // Animate opacity based on drag distance
      const opacity = dragX.interpolate({
        inputRange: [-80, -40, 0],
        outputRange: [1, 0.8, 0],
        extrapolate: 'clamp',
      });

      if (isCustom) {
        // Delete action for custom sections
        return (
          <Animated.View style={[styles.swipeAction, styles.deleteAction, { opacity }]}>
            <RectButton style={styles.swipeActionButton} onPress={() => handleDelete(item)}>
              <MaterialCommunityIcons name="delete" size={24} color={colors.textOnDark} />
              <Text style={styles.swipeActionText}>{t('common.delete')}</Text>
            </RectButton>
          </Animated.View>
        );
      }

      // Hide/Show action for auto sections
      return (
        <Animated.View
          style={[
            styles.swipeAction,
            isDisabled ? styles.showAction : styles.hideAction,
            { opacity },
          ]}
        >
          <RectButton style={styles.swipeActionButton} onPress={() => handleToggleHide(item)}>
            <MaterialCommunityIcons
              name={isDisabled ? 'eye' : 'eye-off'}
              size={24}
              color={colors.textOnDark}
            />
            <Text style={styles.swipeActionText}>
              {isDisabled ? t('common.show') : t('common.hide')}
            </Text>
          </RectButton>
        </Animated.View>
      );
    },
    [handleDelete, handleToggleHide, t]
  );

  const renderItem = useCallback(
    ({ item }: { item: UnifiedSection }) => {
      const frequentSection = toFrequentSection(item);
      return (
        <Swipeable
          ref={(ref) => {
            swipeableRefs.current.set(item.id, ref);
          }}
          renderRightActions={(progress, dragX) => renderRightActions(item, progress, dragX)}
          onSwipeableOpen={() => handleSwipeableOpen(item.id)}
          overshootRight={false}
          friction={2}
        >
          <View
            style={[
              styles.swipeableContent,
              isDark && styles.swipeableContentDark,
              item.isDisabled && styles.disabledSection,
            ]}
          >
            <SectionRow section={frequentSection} onPress={() => handleSectionPress(item)} />
            {/* Show source badge for custom sections */}
            {item.source === 'custom' && (
              <View style={styles.sourceBadge}>
                <Text style={styles.sourceBadgeText}>{t('routes.custom')}</Text>
              </View>
            )}
            {/* Show disabled badge */}
            {item.isDisabled && (
              <View style={styles.disabledIndicator}>
                <MaterialCommunityIcons name="eye-off" size={12} color={colors.warning} />
                <Text style={styles.disabledIndicatorText}>{t('sections.disabled')}</Text>
              </View>
            )}
          </View>
        </Swipeable>
      );
    },
    [handleSectionPress, handleSwipeableOpen, renderRightActions, toFrequentSection, t]
  );

  const renderFooter = () => {
    if (regularSections.length === 0) return null;
    return <DataRangeFooter days={cacheDays} isDark={isDark} />;
  };

  return (
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
      // Performance optimizations
      removeClippedSubviews={Platform.OS === 'ios'}
      maxToRenderPerBatch={10}
      windowSize={5}
      initialNumToRender={8}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  emptyList: {
    flexGrow: 1,
    paddingTop: spacing.md,
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
  sourceBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.md + spacing.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textOnDark,
  },
  disabledSection: {
    opacity: 0.6,
  },
  disabledIndicator: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.md + spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.warning + '30',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
  },
  disabledIndicatorText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.warning,
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
  hideAction: {
    backgroundColor: colors.warning,
  },
  showAction: {
    backgroundColor: colors.success,
  },
});
