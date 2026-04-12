import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  Animated,
  Platform,
  StyleSheet,
  Alert,
} from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SectionMatch as FfiSectionMatch } from 'veloqrs';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { RectButton } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { routeEngine, type SectionPerformanceResult } from 'veloqrs';
import { SectionInlinePlot, type InlineSectionData } from '@/components/activity/SectionInlinePlot';
import { DataRangeFooter } from '@/components/routes';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { getAllSectionDisplayNames } from '@/hooks/routes/useUnifiedSections';
import { castDirection, fromUnixSeconds } from '@/lib/utils/ffiConversions';
import type { SectionMatch } from '@/hooks/routes/useSectionMatches';
import type { Section, ActivityType, PerformanceDataPoint } from '@/types';
import { getSectionStyle, navigateTo, formatDistance, safeGetTime } from '@/lib';
import { colors, darkColors, spacing, shadows } from '@/theme';

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
  points.sort((a, b) => safeGetTime(a.date) - safeGetTime(b.date));
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

  // Filter scan results: exclude sections already in the matched list and already added
  const existingSectionIds = useMemo(
    () =>
      new Set(
        unifiedSections.map((s) => (s.type === 'engine' ? s.match.section.id : s.section.id))
      ),
    [unifiedSections]
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

  // Retry counter: retry up to 3 times when some sections fail to load
  const [plotRetry, setPlotRetry] = useState(0);
  const MAX_PLOT_RETRIES = 3;

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
      } catch (e) {
        if (__DEV__) console.warn(`[Sections] Failed to load performance for ${sectionId}:`, e);
      }
    }
    return map;
  }, [unifiedSections, activityType, plotRetry]);

  // Retry when some sections failed to load (not just when ALL failed)
  useEffect(() => {
    if (
      unifiedSections.length > 0 &&
      plotDataMap.size < unifiedSections.length &&
      plotRetry < MAX_PLOT_RETRIES
    ) {
      const delay = 500 * (plotRetry + 1); // 500ms, 1000ms, 1500ms
      const timer = setTimeout(() => setPlotRetry((r) => r + 1), delay);
      return () => clearTimeout(timer);
    }
  }, [unifiedSections.length, plotDataMap.size, plotRetry]);

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
  const handleSectionPress = useCallback(
    (sectionId: string) => {
      navigateTo(`/section/${sectionId}?activityId=${activityId}`);
    },
    [activityId]
  );

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
      const displayName =
        sectionDisplayNames[match.sectionId] || match.sectionName || match.sectionId.slice(0, 8);
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
              {formatDistance(match.distanceMeters, isMetric)} ·{' '}
              {t('sections.matchQuality', { quality })}
              {!match.sameDirection ? ` · ${t('sections.reverse')}` : ''}
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
    [isDark, isMetric, isScanning, handleRematch, sectionDisplayNames]
  );

  // Render footer for section list
  const renderSectionsListFooter = useCallback(() => {
    return (
      <>
        {/* Scan trigger: show "Scan for more sections" link when sections exist */}
        {unifiedSections.length > 0 && !hasScanned && (
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
    unifiedSections.length,
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
