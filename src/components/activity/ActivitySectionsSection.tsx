import React, { useCallback, useMemo, useRef } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  Animated,
  Platform,
  StyleSheet,
  Alert,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { RectButton } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { routeEngine, type SectionPerformanceResult } from 'veloqrs';
import { SectionInlinePlot, type InlineSectionData } from '@/components/activity/SectionInlinePlot';
import { DataRangeFooter } from '@/components/routes';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { castDirection, fromUnixSeconds } from '@/lib/utils/ffiConversions';
import type { SectionMatch } from '@/hooks/routes/useSectionMatches';
import type { Section, ActivityType, PerformanceDataPoint } from '@/types';
import { getSectionStyle, navigateTo } from '@/lib';
import { colors, darkColors, spacing } from '@/theme';

type UnifiedSectionItem =
  | { type: 'engine'; match: SectionMatch; index: number }
  | { type: 'custom'; section: Section; index: number };

interface ActivitySectionsSectionProps {
  activityId: string;
  activityType: ActivityType;
  unifiedSections: UnifiedSectionItem[];
  coordinates: { latitude: number; longitude: number }[];
  streams: { time?: number[] } | undefined;
  isDark: boolean;
  isMetric: boolean;
  sectionCreationMode: boolean;
  cacheDays: number;
  highlightedSectionId: string | null;
  onHighlightedSectionIdChange: (id: string | null) => void;
  onSectionCreationModeChange: (mode: boolean) => void;
  getSectionBestTime: (sectionId: string) => number | undefined;
  removeSection: (sectionId: string) => Promise<void>;
}

/** Build chart data from section performance FFI result */
function buildChartData(
  result: SectionPerformanceResult,
  sportType: string
): (PerformanceDataPoint & { x: number })[] {
  const points: (PerformanceDataPoint & { x: number })[] = [];
  for (const record of result.records) {
    const date = fromUnixSeconds(record.activityDate);
    if (!date) continue;
    for (const lap of record.laps) {
      if (lap.pace <= 0) continue;
      points.push({
        x: 0,
        id: lap.id,
        activityId: record.activityId,
        speed: lap.pace,
        date,
        activityName: record.activityName,
        direction: castDirection(lap.direction),
        sectionTime: Math.round(lap.time),
        sectionDistance: lap.distance || record.sectionDistance,
      });
    }
  }
  points.sort((a, b) => a.date.getTime() - b.date.getTime());
  return points.map((p, i) => ({ ...p, x: i }));
}

export const ActivitySectionsSection = React.memo(function ActivitySectionsSection({
  activityId,
  activityType,
  unifiedSections,
  coordinates,
  isDark,
  isMetric,
  sectionCreationMode,
  cacheDays,
  highlightedSectionId,
  onHighlightedSectionIdChange,
  onSectionCreationModeChange,
  removeSection,
}: ActivitySectionsSectionProps) {
  const { t } = useTranslation();

  // Track open swipeable refs to close them when another opens
  const swipeableRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const openSwipeableRef = useRef<string | null>(null);

  // Batch-load performance data for all sections
  const plotDataMap = useMemo((): Map<string, InlineSectionData> => {
    const map = new Map<string, InlineSectionData>();
    const engine = getRouteEngine();
    if (!engine) return map;

    for (const item of unifiedSections) {
      const section = item.type === 'engine' ? item.match.section : item.section;
      const sectionId = section.id;
      const sectionSportType = (section as any).sportType || activityType;

      try {
        const result: SectionPerformanceResult = routeEngine.getSectionPerformances(sectionId);
        const chartData = buildChartData(result, sectionSportType);
        if (chartData.length === 0) continue;

        const bestFwd = result.bestForwardRecord;
        const bestRev = result.bestReverseRecord;

        map.set(sectionId, {
          chartData,
          bestForwardRecord: bestFwd
            ? {
                bestTime: bestFwd.bestTime,
                activityDate: fromUnixSeconds(bestFwd.activityDate) ?? new Date(),
              }
            : null,
          bestReverseRecord: bestRev
            ? {
                bestTime: bestRev.bestTime,
                activityDate: fromUnixSeconds(bestRev.activityDate) ?? new Date(),
              }
            : null,
          forwardStats: result.forwardStats
            ? {
                avgTime: result.forwardStats.avgTime ?? null,
                lastActivity: result.forwardStats.lastActivity
                  ? fromUnixSeconds(result.forwardStats.lastActivity)
                  : null,
                count: result.forwardStats.count,
              }
            : null,
          reverseStats: result.reverseStats
            ? {
                avgTime: result.reverseStats.avgTime ?? null,
                lastActivity: result.reverseStats.lastActivity
                  ? fromUnixSeconds(result.reverseStats.lastActivity)
                  : null,
                count: result.reverseStats.count,
              }
            : null,
          activityType: sectionSportType as ActivityType,
        });
      } catch {
        // Skip sections that fail to load
      }
    }
    return map;
  }, [unifiedSections, activityType]);

  // Close any open swipeable when another opens
  const handleSwipeableOpen = useCallback((sectionId: string) => {
    if (openSwipeableRef.current && openSwipeableRef.current !== sectionId) {
      const previousSwipeable = swipeableRefs.current.get(openSwipeableRef.current);
      previousSwipeable?.close();
    }
    openSwipeableRef.current = sectionId;
  }, []);

  // Handle disable/enable action for auto-detected sections
  const handleToggleDisable = useCallback(
    async (sectionId: string, isCurrentlyDisabled: boolean) => {
      const swipeable = swipeableRefs.current.get(sectionId);
      swipeable?.close();

      if (isCurrentlyDisabled) {
        getRouteEngine()?.enableSection(sectionId);
      } else {
        getRouteEngine()?.disableSection(sectionId);
      }
    },
    []
  );

  // Handle delete action for custom sections
  const handleDeleteSection = useCallback(
    (sectionId: string) => {
      const swipeable = swipeableRefs.current.get(sectionId);
      swipeable?.close();

      Alert.alert(t('sections.deleteSection'), t('sections.deleteSectionConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await removeSection(sectionId);
            } catch (error) {
              console.error('Failed to delete section:', error);
            }
          },
        },
      ]);
    },
    [removeSection, t]
  );

  // Handle section long press to highlight on map
  const handleSectionLongPress = useCallback(
    (sectionId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onHighlightedSectionIdChange(sectionId);
    },
    [onHighlightedSectionIdChange]
  );

  // Handle touch end to clear highlight
  const handleSectionsTouchEnd = useCallback(() => {
    onHighlightedSectionIdChange(null);
  }, [onHighlightedSectionIdChange]);

  // Handle section press navigation
  const handleSectionPress = useCallback((sectionId: string) => {
    navigateTo(`/section/${sectionId}`);
  }, []);

  // Render swipe actions for section cards
  const renderSectionSwipeActions = useCallback(
    (
      sectionId: string,
      isCustom: boolean,
      isDisabled: boolean,
      _progress: Animated.AnimatedInterpolation<number>,
      dragX: Animated.AnimatedInterpolation<number>
    ) => {
      const opacity = dragX.interpolate({
        inputRange: [-80, -40, 0],
        outputRange: [1, 0.8, 0],
        extrapolate: 'clamp',
      });

      if (isCustom) {
        return (
          <Animated.View style={[styles.swipeAction, styles.deleteSwipeAction, { opacity }]}>
            <RectButton
              style={styles.swipeActionButton}
              onPress={() => handleDeleteSection(sectionId)}
            >
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
            isDisabled ? styles.enableSwipeAction : styles.disableSwipeAction,
            { opacity },
          ]}
        >
          <RectButton
            style={styles.swipeActionButton}
            onPress={() => handleToggleDisable(sectionId, isDisabled)}
          >
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
    [handleDeleteSection, handleToggleDisable, t]
  );

  // FlatList key extractor
  const keyExtractor = useCallback((item: UnifiedSectionItem) => {
    return item.type === 'engine' ? item.match.section.id : item.section.id;
  }, []);

  // FlatList render item
  const renderSectionItem = useCallback(
    ({ item }: { item: UnifiedSectionItem }) => {
      const style = getSectionStyle(item.index);
      const sectionId = item.type === 'engine' ? item.match.section.id : item.section.id;
      const isCustom = item.type === 'custom';
      const sectionType = item.type === 'engine' ? item.match.section.sectionType : 'custom';
      const sectionName =
        item.type === 'engine'
          ? item.match.section.name || t('routes.autoDetected')
          : item.section.name || t('routes.custom');

      let distance: number;
      let visitCount: number;

      if (item.type === 'engine') {
        distance = item.match.distance;
        visitCount = item.match.section.visitCount;
      } else {
        distance = item.section.distanceMeters;
        visitCount = item.section.activityIds?.length ?? item.section.visitCount;
      }

      const isDisabled = false; // Rust filters disabled sections — only visible ones reach here

      return (
        <SectionInlinePlot
          sectionId={sectionId}
          sectionName={sectionName}
          sectionType={sectionType}
          distance={distance}
          visitCount={visitCount}
          index={item.index}
          style={style}
          isHighlighted={highlightedSectionId === sectionId}
          isDark={isDark}
          isMetric={isMetric}
          plotData={plotDataMap.get(sectionId)}
          onPress={handleSectionPress}
          onLongPress={handleSectionLongPress}
          onSwipeableOpen={handleSwipeableOpen}
          renderRightActions={(progress, dragX) =>
            renderSectionSwipeActions(sectionId, isCustom, isDisabled, progress, dragX)
          }
          swipeableRefs={swipeableRefs}
        />
      );
    },
    [
      highlightedSectionId,
      isDark,
      isMetric,
      t,
      plotDataMap,
      handleSectionLongPress,
      handleSectionPress,
      handleSwipeableOpen,
      renderSectionSwipeActions,
      swipeableRefs,
    ]
  );

  // Render empty state for section list
  const renderSectionsListEmpty = useCallback(() => {
    return (
      <View style={styles.emptyStateContainer}>
        <MaterialCommunityIcons
          name="road-variant"
          size={48}
          color={isDark ? darkColors.border : colors.divider}
        />
        <Text style={[styles.emptyStateTitle, isDark && styles.textLight]}>
          {t('activityDetail.noMatchedSections')}
        </Text>
        <Text style={[styles.emptyStateDescription, isDark && styles.textMuted]}>
          {t('activityDetail.noMatchedSectionsDescription')}
        </Text>
      </View>
    );
  }, [isDark, t]);

  // Render footer for section list
  const renderSectionsListFooter = useCallback(() => {
    return (
      <>
        {coordinates.length > 0 && !sectionCreationMode && (
          <TouchableOpacity
            style={[styles.createSectionButton, isDark && styles.createSectionButtonDark]}
            onPress={() => onSectionCreationModeChange(true)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="plus" size={20} color={colors.textOnPrimary} />
            <Text style={styles.createSectionButtonText}>{t('routes.createSection')}</Text>
          </TouchableOpacity>
        )}

        <DataRangeFooter days={cacheDays} isDark={isDark} />
      </>
    );
  }, [coordinates.length, sectionCreationMode, isDark, cacheDays, t, onSectionCreationModeChange]);

  return (
    <View
      style={styles.tabScrollView}
      onTouchEnd={handleSectionsTouchEnd}
      testID="activity-sections-list"
    >
      <FlatList
        data={unifiedSections}
        keyExtractor={keyExtractor}
        renderItem={renderSectionItem}
        ListEmptyComponent={renderSectionsListEmpty}
        ListFooterComponent={renderSectionsListFooter}
        contentContainerStyle={
          unifiedSections.length === 0 ? styles.tabScrollContentEmpty : styles.tabScrollContent
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        removeClippedSubviews={Platform.OS === 'ios'}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  tabScrollView: {
    flex: 1,
  },
  tabScrollContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
  tabScrollContentEmpty: {
    flexGrow: 1,
    paddingBottom: spacing.xl + TAB_BAR_SAFE_PADDING,
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    paddingHorizontal: spacing.lg,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  emptyStateDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  createSectionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  createSectionButtonDark: {
    backgroundColor: colors.primary,
  },
  createSectionButtonText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600',
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
  deleteSwipeAction: {
    backgroundColor: colors.error,
  },
  disableSwipeAction: {
    backgroundColor: colors.warning,
  },
  enableSwipeAction: {
    backgroundColor: colors.success,
  },
});
