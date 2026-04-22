import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  Animated,
  Platform,
  StyleSheet,
  PanResponder,
  type LayoutChangeEvent,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SectionMatch as FfiSectionMatch, SectionEncounter } from 'veloqrs';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { RectButton } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { SectionInlinePlot } from '@/components/activity/SectionInlinePlot';
import { DataRangeFooter } from '@/components/routes';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { getAllSectionDisplayNames } from '@/hooks/routes/useUnifiedSections';
import { getSectionStyle, navigateTo, formatDistance } from '@/lib';
import { colors, darkColors, spacing, shadows } from '@/theme';

interface ActivitySectionsSectionProps {
  activityId: string;
  encounters: SectionEncounter[];
  coordinates: { latitude: number; longitude: number }[];
  isDark: boolean;
  isMetric: boolean;
  sectionCreationMode: boolean;
  cacheDays: number;
  highlightedSectionId: string | null;
  onHighlightedSectionIdChange: (id: string | null) => void;
  onSectionCreationModeChange: (mode: boolean) => void;
  removeSection: (sectionId: string) => Promise<void>;
  /** Scan results from useActivityRematch */
  scanMatches: FfiSectionMatch[];
  /** Whether a scan is in progress */
  isScanning: boolean;
  /** Whether section data is still loading from the engine */
  isSectionsLoading?: boolean;
  /** Trigger a scan for this activity */
  onScan: () => void;
  /** Force-match to a specific section */
  onRematch: (sectionId: string) => boolean;
}

export const ActivitySectionsSection = React.memo(function ActivitySectionsSection({
  activityId,
  encounters,
  coordinates,
  isDark,
  isMetric,
  sectionCreationMode,
  cacheDays,
  highlightedSectionId,
  onHighlightedSectionIdChange,
  onSectionCreationModeChange,
  removeSection,
  scanMatches,
  isScanning,
  isSectionsLoading,
  onScan,
  onRematch,
}: ActivitySectionsSectionProps) {
  const { t } = useTranslation();

  // Track open swipeable refs to close them when another opens
  const swipeableRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const openSwipeableRef = useRef<string | null>(null);

  // Track which scan matches have been successfully added
  const [addedSectionIds, setAddedSectionIds] = useState(new Set<string>());

  // Whether a scan has been performed
  const hasScanned = scanMatches.length > 0 || addedSectionIds.size > 0;

  // Filter scan results: exclude sections already in the encounter list and already added
  const existingSectionIds = useMemo(
    () => new Set(encounters.map((e) => e.sectionId)),
    [encounters]
  );

  const filteredScanMatches = useMemo(
    () =>
      scanMatches.filter(
        (m) => !existingSectionIds.has(m.sectionId) && !addedSectionIds.has(m.sectionId)
      ),
    [scanMatches, existingSectionIds, addedSectionIds]
  );

  const handleRematch = useCallback(
    (sectionId: string) => {
      const success = onRematch(sectionId);
      if (success) {
        setAddedSectionIds((prev) => new Set(prev).add(sectionId));
      }
    },
    [onRematch]
  );

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

  // ----- Drag-to-scrub state -----
  // After long-press on a row, pan-drag up/down moves the highlight through rows.
  // FlatList scroll is disabled while scrubbing, and auto-scrolls near the edges.
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  isScrubbingRef.current = isScrubbing;

  const flatListRef = useRef<FlatList<SectionEncounter> | null>(null);
  const listTopYRef = useRef(0); // page-Y of the list container's top edge
  const listHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const rowLayoutsRef = useRef<Map<string, { y: number; height: number }>>(new Map());
  const autoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoScrollDirectionRef = useRef<0 | 1 | -1>(0);

  const handleRowLayout = useCallback((sectionId: string, y: number, height: number) => {
    rowLayoutsRef.current.set(sectionId, { y, height });
  }, []);

  const handleListLayout = useCallback((e: LayoutChangeEvent) => {
    listHeightRef.current = e.nativeEvent.layout.height;
  }, []);

  const findSectionAtPageY = useCallback((pageY: number): string | null => {
    const relY = pageY - listTopYRef.current + scrollOffsetRef.current;
    let best: string | null = null;
    rowLayoutsRef.current.forEach((layout, id) => {
      if (relY >= layout.y && relY < layout.y + layout.height) {
        best = id;
      }
    });
    return best;
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollIntervalRef.current != null) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
    autoScrollDirectionRef.current = 0;
  }, []);

  const ensureAutoScroll = useCallback(
    (direction: 0 | 1 | -1, lastPageY: number) => {
      if (direction === 0) {
        stopAutoScroll();
        return;
      }
      if (autoScrollDirectionRef.current === direction) return;
      stopAutoScroll();
      autoScrollDirectionRef.current = direction;
      autoScrollIntervalRef.current = setInterval(() => {
        const delta = direction * 6; // slow, readable drift
        const next = Math.max(0, scrollOffsetRef.current + delta);
        scrollOffsetRef.current = next;
        flatListRef.current?.scrollToOffset({ offset: next, animated: false });
        const id = findSectionAtPageY(lastPageY);
        if (id) onHighlightedSectionIdChange(id);
      }, 16);
    },
    [findSectionAtPageY, onHighlightedSectionIdChange, stopAutoScroll]
  );

  const handleScrubMove = useCallback(
    (pageY: number) => {
      const id = findSectionAtPageY(pageY);
      if (id) onHighlightedSectionIdChange(id);
      const relY = pageY - listTopYRef.current;
      const edge = 70;
      if (relY < edge) ensureAutoScroll(-1, pageY);
      else if (relY > listHeightRef.current - edge) ensureAutoScroll(1, pageY);
      else ensureAutoScroll(0, pageY);
    },
    [ensureAutoScroll, findSectionAtPageY, onHighlightedSectionIdChange]
  );

  const handleScrubEnd = useCallback(() => {
    stopAutoScroll();
    setIsScrubbing(false);
    onHighlightedSectionIdChange(null);
  }, [onHighlightedSectionIdChange, stopAutoScroll]);

  useEffect(() => () => stopAutoScroll(), [stopAutoScroll]);

  // Pan responder captures move events once scrubbing has started (post long-press).
  // onStart returns false so normal taps / scroll work until long-press flips the flag.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: () => isScrubbingRef.current,
        onMoveShouldSetPanResponderCapture: () => isScrubbingRef.current,
        onPanResponderMove: (e) => {
          if (!isScrubbingRef.current) return;
          handleScrubMove(e.nativeEvent.pageY);
        },
        onPanResponderRelease: handleScrubEnd,
        onPanResponderTerminate: handleScrubEnd,
        onPanResponderTerminationRequest: () => false,
      }),
    [handleScrubEnd, handleScrubMove]
  );

  // Handle section long press to enter scrub mode — highlight on map, disable scroll.
  const handleSectionLongPress = useCallback(
    (sectionId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onHighlightedSectionIdChange(sectionId);
      setIsScrubbing(true);
    },
    [onHighlightedSectionIdChange]
  );

  // Handle touch end (fallback when pan responder wasn't captured) — clear highlight
  const handleSectionsTouchEnd = useCallback(() => {
    if (isScrubbingRef.current) return; // pan responder handles its own release
    onHighlightedSectionIdChange(null);
  }, [onHighlightedSectionIdChange]);

  const handleContainerLayout = useCallback((e: LayoutChangeEvent) => {
    // Capture the page-Y of the list wrapper so we can map pageY → row.
    e.currentTarget?.measureInWindow?.((_x: number, y: number) => {
      listTopYRef.current = y;
    });
  }, []);

  // Handle section press navigation
  const handleSectionPress = useCallback(
    (sectionId: string) => {
      navigateTo(`/section/${sectionId}?activityId=${activityId}`);
    },
    [activityId]
  );

  // Render swipe actions for section cards
  const renderSectionSwipeActions = useCallback(
    (
      item: SectionEncounter,
      _progress: Animated.AnimatedInterpolation<number>,
      dragX: Animated.AnimatedInterpolation<number>
    ) => {
      const opacity = dragX.interpolate({
        inputRange: [-80, -40, 0],
        outputRange: [1, 0.8, 0],
        extrapolate: 'clamp',
      });

      return (
        <Animated.View style={[styles.swipeAction, styles.disableSwipeAction, { opacity }]}>
          <RectButton
            style={styles.swipeActionButton}
            onPress={() => handleToggleDisable(item.sectionId, false)}
          >
            <MaterialCommunityIcons name="eye-off" size={24} color={colors.textOnDark} />
            <Text style={styles.swipeActionText}>{t('common.hide')}</Text>
          </RectButton>
        </Animated.View>
      );
    },
    [handleToggleDisable, t]
  );

  // FlatList key extractor
  const keyExtractor = useCallback(
    (item: SectionEncounter) => `${item.sectionId}-${item.direction}`,
    []
  );

  // FlatList render item
  const renderEncounterItem = useCallback(
    ({ item, index }: { item: SectionEncounter; index: number }) => {
      const style = getSectionStyle(index);
      return (
        <SectionInlinePlot
          encounter={item}
          activityId={activityId}
          index={index}
          style={style}
          isHighlighted={highlightedSectionId === item.sectionId}
          isDark={isDark}
          isMetric={isMetric}
          onPress={handleSectionPress}
          onLongPress={handleSectionLongPress}
          onSwipeableOpen={handleSwipeableOpen}
          onRowLayout={handleRowLayout}
          renderRightActions={(progress, dragX) => renderSectionSwipeActions(item, progress, dragX)}
          swipeableRefs={swipeableRefs}
        />
      );
    },
    [
      activityId,
      highlightedSectionId,
      isDark,
      isMetric,
      handleSectionLongPress,
      handleSectionPress,
      handleSwipeableOpen,
      handleRowLayout,
      renderSectionSwipeActions,
      swipeableRefs,
    ]
  );

  // Render empty state for section list
  const renderSectionsListEmpty = useCallback(() => {
    // Show loading spinner while engine subscription is being established
    if (isSectionsLoading) {
      return (
        <View style={styles.emptyStateContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }

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
        {!hasScanned && (
          <TouchableOpacity
            style={[styles.scanButton, isDark && styles.scanButtonDark]}
            onPress={onScan}
            activeOpacity={0.7}
            disabled={isScanning}
          >
            {isScanning ? (
              <ActivityIndicator size={18} color={colors.primary} />
            ) : (
              <MaterialCommunityIcons name="magnify" size={18} color={colors.primary} />
            )}
            <Text style={[styles.scanButtonText, isDark && styles.scanButtonTextDark]}>
              {t('sections.scanForMatches')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [isDark, t, hasScanned, isScanning, isSectionsLoading, onScan]);

  // Render a single scan match result row
  // Look up proper display names for scan results (same names shown in the app)
  const sectionDisplayNames = useMemo(() => getAllSectionDisplayNames(), [scanMatches]);

  const renderScanMatch = useCallback(
    (match: FfiSectionMatch) => {
      const quality = Math.round(match.matchQuality * 100);
      const baseName =
        sectionDisplayNames[match.sectionId] || match.sectionName || match.sectionId.slice(0, 8);
      const displayName = !match.sameDirection ? `${baseName} \u21A9` : baseName;
      const totalPoints = coordinates?.length ?? 0;
      const startPct =
        totalPoints > 0 ? Math.round((Number(match.startIndex) / totalPoints) * 100) : 0;
      return (
        <View
          key={`${match.sectionId}-${match.startIndex}`}
          style={[styles.scanMatchRow, isDark && styles.scanMatchRowDark]}
        >
          <TouchableOpacity
            style={styles.scanMatchInfo}
            onPress={() => navigateTo(`/section/${match.sectionId}?activityId=${activityId}`)}
            activeOpacity={0.7}
          >
            <Text
              numberOfLines={2}
              style={[styles.scanMatchName, isDark && { color: darkColors.textPrimary }]}
            >
              {displayName}
            </Text>
            <Text style={[styles.scanMatchMeta, isDark && { color: darkColors.textSecondary }]}>
              {formatDistance(match.distanceMeters, isMetric)}
              {startPct > 0 ? ` · ${t('sections.atPosition', { pct: startPct })}` : ''}
              {quality < 90 ? ` · ${t('sections.matchQuality', { quality })}` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addMatchButton}
            onPress={() => handleRematch(match.sectionId)}
            activeOpacity={0.7}
            disabled={isScanning}
          >
            <Text style={styles.addMatchButtonText}>{t('sections.addToSection')}</Text>
          </TouchableOpacity>
        </View>
      );
    },
    [isDark, isMetric, isScanning, handleRematch, sectionDisplayNames, coordinates]
  );

  // Render footer for section list
  const renderSectionsListFooter = useCallback(() => {
    return (
      <>
        {/* Scan trigger: show "Scan for more sections" link when sections exist */}
        {encounters.length > 0 && !hasScanned && (
          <TouchableOpacity
            style={styles.scanLink}
            onPress={onScan}
            activeOpacity={0.7}
            disabled={isScanning}
          >
            {isScanning ? (
              <ActivityIndicator size={14} color={colors.primary} />
            ) : (
              <MaterialCommunityIcons name="magnify" size={14} color={colors.primary} />
            )}
            <Text style={styles.scanLinkText}>{t('sections.scanForMore')}</Text>
          </TouchableOpacity>
        )}

        {/* Scanning indicator */}
        {isScanning && hasScanned && (
          <View style={styles.scanningContainer}>
            <ActivityIndicator size={20} color={colors.primary} />
            <Text style={[styles.scanningText, isDark && { color: darkColors.textSecondary }]}>
              {t('sections.scanning')}
            </Text>
          </View>
        )}

        {/* Scan results */}
        {hasScanned && !isScanning && filteredScanMatches.length > 0 && (
          <View style={styles.scanResultsContainer}>
            <Text style={[styles.scanResultsTitle, isDark && { color: darkColors.textPrimary }]}>
              {t('sections.nearbySectionsCount', { count: filteredScanMatches.length })}
            </Text>
            {filteredScanMatches.map(renderScanMatch)}
          </View>
        )}

        {/* Scan performed but no new results */}
        {hasScanned && !isScanning && filteredScanMatches.length === 0 && (
          <View style={styles.scanNoResults}>
            <Text style={[styles.scanNoResultsText, isDark && { color: darkColors.textSecondary }]}>
              {t('sections.noMatchesFound')}
            </Text>
          </View>
        )}

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
  }, [
    coordinates.length,
    sectionCreationMode,
    isDark,
    cacheDays,
    t,
    onSectionCreationModeChange,
    encounters.length,
    hasScanned,
    isScanning,
    filteredScanMatches,
    onScan,
    renderScanMatch,
  ]);

  return (
    <View
      style={styles.tabScrollView}
      onTouchEnd={handleSectionsTouchEnd}
      onLayout={handleContainerLayout}
      testID="activity-sections-list"
      {...panResponder.panHandlers}
    >
      <FlatList
        ref={flatListRef}
        data={encounters}
        keyExtractor={keyExtractor}
        renderItem={renderEncounterItem}
        ListEmptyComponent={renderSectionsListEmpty}
        ListFooterComponent={renderSectionsListFooter}
        contentContainerStyle={
          encounters.length === 0 ? styles.tabScrollContentEmpty : styles.tabScrollContent
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        removeClippedSubviews={Platform.OS === 'ios'}
        onLayout={handleListLayout}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        scrollEnabled={!isScrubbing}
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
    ...shadows.elevated,
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
  // Scan button (empty state)
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  scanButtonDark: {
    borderColor: colors.primary,
  },
  scanButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  scanButtonTextDark: {
    color: colors.primary,
  },
  // Scan link (footer, when sections exist)
  scanLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.md,
  },
  scanLinkText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
  // Scanning indicator
  scanningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  scanningText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  // Scan results
  scanResultsContainer: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  scanResultsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  scanMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  scanMatchRowDark: {
    backgroundColor: darkColors.surface,
  },
  scanMatchInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  scanMatchName: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  scanMatchMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  addMatchButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  addMatchButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  // No results
  scanNoResults: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  scanNoResultsText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
});
