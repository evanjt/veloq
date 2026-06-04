import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  LayoutChangeEvent,
} from 'react-native';
import { Switch } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import { TimelineSlider } from '@/features/maps/components';
import { useActivityBoundsCache, useOldestActivityDate, useTheme } from '@/hooks';
import { formatLocalDate, formatFileSize } from '@/lib';
import { useSyncDateRange, useRouteSettings } from '@/providers';
import { DETECTION_PRESETS as PRESETS, getRouteEngine } from '@/shared/native/routeEngine';
import { HEATMAP_TILES_DIR, getHeatmapTilesCacheSize } from '@/features/maps/hooks/useHeatmapTiles';
import { settingsStyles } from './settingsStyles';
import { colors, darkColors, spacing, typography } from '@/theme';

const SNAP_TIMING = { duration: 200, easing: Easing.out(Easing.cubic) };
const THUMB_SIZE = 22;

function DetectionSlider({
  activeIndex,
  onSelect,
  isDark,
}: {
  activeIndex: number;
  onSelect: (index: number) => void;
  isDark: boolean;
}) {
  const { t } = useTranslation();
  const [trackWidth, setTrackWidth] = useState(0);
  const thumbX = useSharedValue(0);

  const snapPositions = useMemo(() => {
    if (trackWidth === 0) return [0, 0, 0];
    return PRESETS.map((_, i) => (i / (PRESETS.length - 1)) * (trackWidth - THUMB_SIZE));
  }, [trackWidth]);

  useEffect(() => {
    if (trackWidth > 0) {
      thumbX.value = withTiming(snapPositions[activeIndex], SNAP_TIMING);
    }
  }, [activeIndex, snapPositions, trackWidth, thumbX]);

  const snapToNearest = useCallback(
    (x: number) => {
      let closest = 0;
      let minDist = Infinity;
      for (let i = 0; i < snapPositions.length; i++) {
        const dist = Math.abs(x - snapPositions[i]);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      }
      if (closest !== activeIndex) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onSelect(closest);
    },
    [snapPositions, activeIndex, onSelect]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          'worklet';
          const startX = snapPositions[activeIndex];
          const newX = Math.max(0, Math.min(trackWidth - THUMB_SIZE, startX + e.translationX));
          thumbX.value = newX;
        })
        .onEnd(() => {
          'worklet';
          runOnJS(snapToNearest)(thumbX.value);
        }),
    [thumbX, snapPositions, activeIndex, trackWidth, snapToNearest]
  );

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: thumbX.value }],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: thumbX.value + THUMB_SIZE / 2,
  }));

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const handleLabelPress = useCallback(
    (index: number) => {
      if (index !== activeIndex) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onSelect(index);
    },
    [activeIndex, onSelect]
  );

  return (
    <View style={sliderStyles.container}>
      {/* Labels row */}
      <View style={sliderStyles.labelsRow}>
        {PRESETS.map((p, i) => {
          const label = p.key === 'default' ? t('settings.default') : t(`settings.${p.key}`);
          const align = i === 0 ? 'flex-start' : i === PRESETS.length - 1 ? 'flex-end' : 'center';
          return (
            <TouchableOpacity
              key={p.key}
              style={[sliderStyles.labelTouchable, { alignItems: align } as const]}
              onPress={() => handleLabelPress(i)}
            >
              <Text
                style={[
                  sliderStyles.label,
                  i === activeIndex && sliderStyles.labelActive,
                  i !== activeIndex && isDark && sliderStyles.labelDark,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Track + thumb */}
      <GestureDetector gesture={panGesture}>
        <View style={sliderStyles.trackContainer} onLayout={handleLayout}>
          <View style={[sliderStyles.track, isDark && sliderStyles.trackDark]} />
          <Animated.View style={[sliderStyles.fill, fillStyle]} />
          {/* Snap dots */}
          {trackWidth > 0 &&
            snapPositions.map((pos, i) => (
              <View
                key={i}
                style={[
                  sliderStyles.dot,
                  {
                    left: pos + THUMB_SIZE / 2 - 3,
                  },
                  i <= activeIndex && sliderStyles.dotActive,
                ]}
              />
            ))}
          <Animated.View style={[sliderStyles.thumb, thumbStyle]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const sliderStyles = StyleSheet.create({
  container: {
    marginTop: spacing.xs,
  },
  labelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  labelTouchable: {
    flex: 1,
  },
  label: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  labelActive: {
    fontWeight: '600',
    color: colors.primary,
  },
  labelDark: {
    color: darkColors.textSecondary,
  },
  trackContainer: {
    height: 28,
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    right: THUMB_SIZE / 2,
    height: 4,
    backgroundColor: '#E4E4E7',
    borderRadius: 2,
  },
  trackDark: {
    backgroundColor: '#3F3F46',
  },
  fill: {
    position: 'absolute',
    left: THUMB_SIZE / 2,
    height: 4,
    backgroundColor: colors.primary,
    borderRadius: 2,
    opacity: 0.4,
  },
  dot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
    top: 11,
  },
  dotActive: {
    backgroundColor: colors.primary,
    opacity: 0.6,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
});

export function SyncRangePanel() {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  // --- Heatmap toggle state ---
  const heatmapEnabled = useRouteSettings((s) => s.settings.heatmapEnabled);
  const setHeatmapEnabled = useRouteSettings((s) => s.setHeatmapEnabled);
  const [heatmapSize, setHeatmapSize] = useState(0);

  const refreshHeatmapSize = useCallback(() => {
    setHeatmapSize(getHeatmapTilesCacheSize());
  }, []);

  useEffect(() => {
    refreshHeatmapSize();
  }, [refreshHeatmapSize, heatmapEnabled]);

  const handleHeatmapToggle = useCallback(
    (enabled: boolean) => {
      setHeatmapEnabled(enabled);
      const engine = getRouteEngine();
      if (enabled) {
        engine?.enableHeatmapTiles();
      } else {
        engine?.clearHeatmapTiles(HEATMAP_TILES_DIR);
        const legacyDir = `${FileSystem.documentDirectory}heatmap-tiles/`;
        engine?.clearHeatmapTiles(legacyDir);
        engine?.disableHeatmapTiles();
      }
      refreshHeatmapSize();
    },
    [setHeatmapEnabled, refreshHeatmapSize]
  );

  // --- Data range state ---
  const { progress, cacheStats, syncDateRange } = useActivityBoundsCache();
  const { data: apiOldestDate } = useOldestActivityDate();

  const syncOldest = useSyncDateRange((s) => s.oldest);
  const isFetchingExtended = useSyncDateRange((s) => s.isFetchingExtended);
  const isGpsSyncing = useSyncDateRange((s) => s.isGpsSyncing);
  const gpsSyncProgress = useSyncDateRange((s) => s.gpsSyncProgress);
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);

  const cachedStartDate = useMemo(() => {
    if (isExpansionLocked) return new Date(syncOldest);
    if (cacheStats.oldestDate) {
      const cacheOldest = new Date(cacheStats.oldestDate);
      const syncStart = new Date(syncOldest);
      return cacheOldest < syncStart ? cacheOldest : syncStart;
    }
    return new Date(syncOldest);
  }, [cacheStats.oldestDate, syncOldest, isExpansionLocked]);

  const cachedEndDate = useMemo(() => new Date(), []);

  const isSyncing = progress.status === 'syncing' || isGpsSyncing || isFetchingExtended;

  const { minDateForSlider, maxDateForSlider } = useMemo(() => {
    const now = new Date();
    if (apiOldestDate) {
      return { minDateForSlider: new Date(apiOldestDate), maxDateForSlider: now };
    }
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return { minDateForSlider: d, maxDateForSlider: now };
  }, [apiOldestDate]);

  const handleRangeChange = useCallback(
    (start: Date, _end: Date) => {
      if (start < cachedStartDate) {
        syncDateRange(formatLocalDate(start), formatLocalDate(new Date()));
      }
    },
    [syncDateRange, cachedStartDate]
  );

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.localDataRange').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {/* Heatmap toggle */}
        <View style={settingsStyles.actionRow}>
          <MaterialCommunityIcons
            name="map-legend"
            size={22}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <View style={styles.toggleTextWrap}>
            <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
              {t('settings.heatmapGeneration', 'Heatmap')}
            </Text>
            <Text style={[styles.toggleHint, isDark && settingsStyles.textMuted]}>
              {heatmapEnabled && heatmapSize > 0
                ? t('settings.heatmapStorageUsed', {
                    defaultValue: 'Using {{size}} of device storage',
                    size: formatFileSize(heatmapSize),
                  })
                : t('settings.heatmapDescription', 'Uses device storage. Disable to save space.')}
            </Text>
          </View>
          <Switch
            value={heatmapEnabled}
            onValueChange={handleHeatmapToggle}
            color={colors.primary}
          />
        </View>

        <View style={[settingsStyles.fullDivider, isDark && settingsStyles.fullDividerDark]} />

        {/* Timeline slider */}
        <View style={styles.sliderWrap}>
          <TimelineSlider
            minDate={minDateForSlider}
            maxDate={maxDateForSlider}
            startDate={cachedStartDate}
            endDate={cachedEndDate}
            onRangeChange={handleRangeChange}
            isLoading={isSyncing}
            activityCount={cacheStats.totalActivities}
            cachedOldest={null}
            cachedNewest={null}
            isDark={isDark}
            showActivityFilter={false}
            showCachedRange={false}
            showLegend={false}
            showSyncBanner={false}
            fixedEnd
            expandOnly
          />
        </View>

        {/* GPS sync progress */}
        {isSyncing || isFetchingExtended ? (
          <View style={[styles.progressRow, isDark && styles.progressRowDark]}>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.max(gpsSyncProgress.percent, 2)}%` },
                ]}
              />
            </View>
            <Text style={[styles.progressText, isDark && styles.progressTextDark]}>
              {gpsSyncProgress.message ||
                (isFetchingExtended
                  ? t('cache.fetchingActivities', 'Fetching activities...')
                  : t('common.loading'))}
              {gpsSyncProgress.total > 0 &&
                ` (${gpsSyncProgress.completed}/${gpsSyncProgress.total})`}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  toggleTextWrap: {
    flex: 1,
  },
  toggleHint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sliderWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  progressRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(252, 76, 2, 0.06)',
  },
  progressRowDark: {
    backgroundColor: 'rgba(252, 76, 2, 0.1)',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  progressTextDark: {
    color: darkColors.textSecondary,
  },
  actionRowDisabled: {
    opacity: 0.5,
  },
  spinner: {
    width: 22,
    height: 22,
  },
  resultText: {
    fontSize: 12,
    color: colors.primary,
  },
  resultTextDark: {
    color: colors.primary,
  },
});
