import React, { useCallback, useRef } from 'react';
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
import { SectionListItem } from '@/components/activity/SectionListItem';
import { DataRangeFooter } from '@/components/routes';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import type { SectionMatch } from '@/hooks/routes/useSectionMatches';
import type { Section } from '@/types';
import { formatDuration, formatPace, getSectionStyle, navigateTo } from '@/lib';
import { colors, darkColors, spacing, typography } from '@/theme';

type UnifiedSectionItem =
  | { type: 'engine'; match: SectionMatch; index: number }
  | { type: 'custom'; section: Section; index: number };

interface ActivitySectionsSectionProps {
  activityId: string;
  unifiedSections: UnifiedSectionItem[];
  coordinates: { latitude: number; longitude: number }[];
  streams: { time?: number[] } | undefined;
  isDark: boolean;
  isMetric: boolean;
  disabledSectionIds: Set<string>;
  sectionCreationMode: boolean;
  cacheDays: number;
  highlightedSectionId: string | null;
  onHighlightedSectionIdChange: (id: string | null) => void;
  onSectionCreationModeChange: (mode: boolean) => void;
  getSectionBestTime: (sectionId: string) => number | undefined;
  disableSection: (sectionId: string) => Promise<void>;
  enableSection: (sectionId: string) => Promise<void>;
  removeSection: (sectionId: string) => Promise<void>;
}

export const ActivitySectionsSection = React.memo(function ActivitySectionsSection({
  activityId,
  unifiedSections,
  coordinates,
  streams,
  isDark,
  isMetric,
  disabledSectionIds,
  sectionCreationMode,
  cacheDays,
  highlightedSectionId,
  onHighlightedSectionIdChange,
  onSectionCreationModeChange,
  getSectionBestTime,
  disableSection,
  enableSection,
  removeSection,
}: ActivitySectionsSectionProps) {
  const { t } = useTranslation();

  // Track open swipeable refs to close them when another opens
  const swipeableRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const openSwipeableRef = useRef<string | null>(null);

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
        await enableSection(sectionId);
      } else {
        await disableSection(sectionId);
      }
    },
    [disableSection, enableSection]
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

  // Helper to calculate section elapsed time from streams
  const getSectionTime = useCallback(
    (portion?: { startIndex?: number; endIndex?: number }): number | undefined => {
      if (!streams?.time || portion?.startIndex == null || portion?.endIndex == null) {
        return undefined;
      }
      const timeArray = streams.time;
      const start = Math.max(0, portion.startIndex);
      const end = Math.min(timeArray.length - 1, portion.endIndex);
      if (end <= start) return undefined;
      return timeArray[end] - timeArray[start];
    },
    [streams?.time]
  );

  const formatSectionPace = useCallback(
    (seconds: number, meters: number): string => {
      if (meters <= 0 || seconds <= 0) return '--';
      return formatPace(meters / seconds, isMetric);
    },
    [isMetric]
  );

  // Format time delta with +/- sign
  const formatTimeDelta = (
    currentTime: number,
    bestTime: number
  ): { text: string; isAhead: boolean } => {
    const delta = currentTime - bestTime;
    const absDelta = Math.abs(delta);
    const m = Math.floor(absDelta / 60);
    const s = Math.floor(absDelta % 60);
    const timeStr = m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
    if (delta <= 0) {
      return {
        text: delta === 0 ? t('routes.pr') : `-${timeStr}`,
        isAhead: true,
      };
    }
    return { text: `+${timeStr}`, isAhead: false };
  };

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

      let sectionTime: number | undefined;
      let distance: number;
      let visitCount: number;

      if (item.type === 'engine') {
        sectionTime = undefined;
        distance = item.match.distance;
        visitCount = item.match.section.visitCount;
      } else {
        const portionRecord = item.section.activityPortions?.find(
          (p: any) => p.activityId === activityId
        );
        const portionIndices =
          portionRecord ??
          (item.section.sourceActivityId === activityId ? item.section : undefined);
        sectionTime = getSectionTime(portionIndices);
        distance = item.section.distanceMeters;
        visitCount = item.section.activityIds?.length ?? item.section.visitCount;
      }

      const bestTime = getSectionBestTime(sectionId);
      const delta =
        sectionTime != null && bestTime != null ? formatTimeDelta(sectionTime, bestTime) : null;

      const isDisabled = disabledSectionIds.has(sectionId);

      return (
        <SectionListItem
          item={item}
          sectionId={sectionId}
          isCustom={isCustom}
          sectionType={sectionType}
          sectionName={sectionName}
          sectionTime={sectionTime}
          distance={distance}
          visitCount={visitCount}
          bestTime={bestTime}
          delta={delta}
          style={style}
          index={item.index}
          isHighlighted={highlightedSectionId === sectionId}
          isDark={isDark}
          isMetric={isMetric}
          onLongPress={handleSectionLongPress}
          onPress={handleSectionPress}
          onSwipeableOpen={handleSwipeableOpen}
          renderRightActions={(progress, dragX) =>
            renderSectionSwipeActions(sectionId, isCustom, isDisabled, progress, dragX)
          }
          swipeableRefs={swipeableRefs}
          formatSectionTime={formatDuration}
          formatSectionPace={formatSectionPace}
        />
      );
    },
    [
      highlightedSectionId,
      isDark,
      isMetric,
      disabledSectionIds,
      activityId,
      t,
      handleSectionLongPress,
      handleSectionPress,
      handleSwipeableOpen,
      renderSectionSwipeActions,
      getSectionTime,
      getSectionBestTime,
      formatTimeDelta,
      formatDuration,
      formatSectionPace,
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
    <View style={styles.tabScrollView} onTouchEnd={handleSectionsTouchEnd}>
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
        initialNumToRender={8}
        maxToRenderPerBatch={10}
        windowSize={5}
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
