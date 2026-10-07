import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Platform, Text as RNText } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, useMetricSystem } from '@/shared/app';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import type { Activity } from '@/types';
import { getActivityIcon, getActivityColor } from '@/shared/activity/activityUtils';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPower,
  formatRelativeDate,
  formatTemperature,
  formatTSS,
  formatCalories,
  formatPrDelta,
  formatPrImprovement,
} from '@/shared/format/format';
import {
  colors,
  darkColors,
  typography,
  spacing,
  layout,
  brand,
  ink,
  verdict,
  colorWithOpacity,
  mapTextShadow,
} from '@/theme';
import { CHART_CONFIG } from '@/constants';
import { type TerrainSnapshotWebViewRef, useMapPreferences } from '@/features/maps';
import { ActivityMapPreview } from './ActivityMapPreview';
import type { PreviewTrack } from '@/features/home';
import { ActivityCardContextMenu } from './ActivityCardContextMenu';
import { SkylineBar } from './SkylineBar';
import { StrengthActivityCard, type StrengthCardData } from '@/features/strength';
import type { ExtendedBodyPart } from 'react-native-body-highlighter';
import { useExerciseSets, useMuscleGroups } from '@/features/strength';
import { debug } from '@/shared/debug/debug';
import { rowIsUnchanged } from '@/shared/ui/rowMemo';
import { reportFeedDismissed } from '@/shared/native/feedSeen';
import { prefetchActivityDetailData } from '../hooks/useActivityDetailData';
import { pressable, pressRipple } from '@/shared/ui';
import { Card } from '@/shared/ui/Card';
import { freshLoginTimeline } from '@/shared/debug/freshLoginTimeline';

import { CARD_HEIGHT, CARD_MARGIN } from '@/features/activity/lib/cardLayout';

const log = debug.create('ActivityCard');

interface ActivityCardProps {
  activity: Activity;
  index?: number | undefined;
  /** Ref to the shared snapshot WebView for 3D terrain previews */
  snapshotRef?: React.RefObject<TerrainSnapshotWebViewRef | null> | undefined;
  /** Pre-fetched GPS track from startup data */
  startupTrack?: PreviewTrack | undefined;
  /** Whether snapshot WebView workers are ready */
  snapshotReady?: boolean | undefined;
  /** The activity arrived since the athlete last looked: draws the gold ring */
  isNew?: boolean | undefined;
  /** Called after a tap has told the engine to drop this card's ring */
  onNewDismissed?: (() => void) | undefined;
  /** Forces re-render when theme changes (enableFreeze suppresses useColorScheme updates) */
  colorScheme?: boolean | undefined;
  /** Section highlights for this activity (PRs, trends) from batch FFI query */
  sectionHighlights?:
    | {
        sectionName: string;
        isPr: boolean;
        trend: number; // -1=slower, 0=neutral, 1=faster vs preceding avg
        startIndex: number;
        endIndex: number;
      }[]
    | undefined;
  /** Route highlight for this activity (trend, PR) */
  routeHighlight?:
    | {
        routeName: string;
        isPr: boolean;
        trend: number; // -1=slower, 0=neutral, 1=faster
        timeDeltaSeconds?: number | null | undefined;
        prImprovementSeconds?: number | null | undefined;
      }
    | undefined;
}

// White text theme (used on any dark/satellite map, or dark theme + light map)
const WHITE_TEXT = {
  text: ink.white,
  textMuted: colorWithOpacity(ink.white, 0.85),
  dot: colorWithOpacity(ink.white, 0.5),
  divider: colorWithOpacity(ink.white, 0.15),
  secondaryText: colorWithOpacity(ink.white, 0.9),
  shadow: colorWithOpacity(ink.black, 0.8),
};

// Dark text theme (only for light theme + light map)
const DARK_TEXT = {
  text: colors.textPrimary,
  textMuted: colors.textSecondary,
  dot: colorWithOpacity(ink.black, 0.25),
  divider: colorWithOpacity(ink.black, 0.1),
  secondaryText: colors.textSecondary,
  shadow: colorWithOpacity(ink.white, 0.8),
};

// Gradient + text combos driven by app theme x map style
const GRADIENT = {
  // Light theme + light map: white wash blends into light UI
  lightLight: {
    top: [
      colorWithOpacity(ink.white, 0.92),
      colorWithOpacity(ink.white, 0.5),
      'transparent',
    ] as const,
    bottom: [
      'transparent',
      colorWithOpacity(ink.white, 0.6),
      colorWithOpacity(ink.white, 0.95),
    ] as const,
    ...DARK_TEXT,
  },
  // Light theme + dark map: subtle scrim, map already provides contrast
  lightDark: {
    top: [
      colorWithOpacity(ink.black, 0.5),
      colorWithOpacity(ink.black, 0.2),
      'transparent',
    ] as const,
    bottom: [
      'transparent',
      colorWithOpacity(ink.black, 0.25),
      colorWithOpacity(ink.black, 0.55),
    ] as const,
    ...WHITE_TEXT,
  },
  // Dark theme + light map: strong dark scrim to blend into dark UI
  darkLight: {
    top: [
      colorWithOpacity(ink.black, 0.7),
      colorWithOpacity(ink.black, 0.3),
      'transparent',
    ] as const,
    bottom: [
      'transparent',
      colorWithOpacity(ink.black, 0.35),
      colorWithOpacity(ink.black, 0.72),
    ] as const,
    ...WHITE_TEXT,
  },
  // Dark theme + dark map: subtle scrim, everything already dark
  darkDark: {
    top: [
      colorWithOpacity(ink.black, 0.5),
      colorWithOpacity(ink.black, 0.2),
      'transparent',
    ] as const,
    bottom: [
      'transparent',
      colorWithOpacity(ink.black, 0.25),
      colorWithOpacity(ink.black, 0.6),
    ] as const,
    ...WHITE_TEXT,
  },
};

function getGradientTheme(isDark: boolean, mapStyle: string) {
  const isMapDark = mapStyle === 'dark' || mapStyle === 'satellite';
  if (isDark) return isMapDark ? GRADIENT.darkDark : GRADIENT.darkLight;
  return isMapDark ? GRADIENT.lightDark : GRADIENT.lightLight;
}

export const ActivityCard = React.memo(
  function ActivityCard({
    activity,
    index,
    snapshotRef,
    startupTrack,
    snapshotReady,
    sectionHighlights,
    routeHighlight,
    isNew,
    onNewDismissed,
  }: ActivityCardProps) {
    // Log actual function body execution (not useEffect which is deferred)
    if (__DEV__ && (index ?? 0) < 3) {
      log.log(`  🃏 ActivityCard[${index}] BODY executing (${activity.type})`);
    }
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const isMetric = useMetricSystem();
    const [menuVisible, setMenuVisible] = useState(false);
    const [isPressed, setIsPressed] = useState(false);
    const averageHeartRate = activity.average_heartrate;
    const averagePower = activity.icu_average_watts;
    useEffect(() => {
      freshLoginTimeline.mark('firstCard');
    }, []);
    // The ring is the only visual carrier of new, so the label says it too.
    const newLabel = isNew ? `${t('activity.newActivity')}, ` : '';
    const newRing = isNew ? (
      <View
        testID={`activity-card-${activity.id}-new-ring`}
        pointerEvents="none"
        style={[
          styles.newRing,
          { borderColor: isDark ? darkColors.chartGoldMark : colors.chartGoldMark },
        ]}
      />
    ) : null;
    const handlePressIn = useCallback(() => setIsPressed(true), []);
    const handlePressOut = useCallback(() => setIsPressed(false), []);

    // The detail bundle is read here rather than after the push animation, so
    // the screen paints with it on its first render.
    const openActivity = useCallback(
      (tab?: 'routes' | 'sections') => {
        prefetchActivityDetailData(activity.id);
        router.push(`/activity/${activity.id}${tab ? `?tab=${tab}` : ''}`);
      },
      [activity.id]
    );

    const activityId = activity.id;
    const handlePress = useCallback(() => {
      if (isNew) {
        reportFeedDismissed([activityId]);
        onNewDismissed?.();
      }
      openActivity();
    }, [isNew, activityId, onNewDismissed, openActivity]);

    const handleLongPress = useCallback(() => {
      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      setMenuVisible(true);
    }, []);

    const scrollRef = useRef<ScrollView>(null);
    const hasFlashed = useRef(false);

    const handleContentSizeChange = useCallback((_contentWidth: number, _contentHeight: number) => {
      if (!hasFlashed.current && scrollRef.current) {
        hasFlashed.current = true;
        setTimeout(() => scrollRef.current?.flashScrollIndicators(), 400);
      }
    }, []);

    const { getStyleForActivity } = useMapPreferences();
    const activityColor = getActivityColor(activity.type);
    const iconName = getActivityIcon(activity.type);
    const mapStyle = getStyleForActivity(activity.type, activity.id);
    const theme = getGradientTheme(isDark, mapStyle);
    const hasGpsData = activity.stream_types?.includes('latlng');

    const compactTextColor = isDark ? darkColors.textPrimary : colors.textPrimary;
    const compactMutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
    const compactDotColor = isDark
      ? colorWithOpacity(ink.white, 0.3)
      : colorWithOpacity(ink.black, 0.25);
    const compactDividerColor = isDark ? darkColors.border : colorWithOpacity(ink.black, 0.1);

    // Shared secondary stats row used by both compact and full card
    const secondaryStatsRow = (textColor: string) => (
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={handleContentSizeChange}
        testID={`activity-card-${activity.id}-secondary-stats`}
        style={styles.secondaryScroll}
      >
        <Pressable
          onPress={handlePress}
          style={pressable(styles.secondaryStats)}
          android_ripple={pressRipple}
        >
          {!!activity.icu_training_load && (
            <View
              style={styles.secondaryStat}
              accessibilityLabel={`${t('activity.stats.trainingLoad')}: ${formatTSS(activity.icu_training_load)}`}
            >
              <MaterialCommunityIcons name="fire" size={14} color={colors.primary} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatTSS(activity.icu_training_load)}
              </RNText>
            </View>
          )}
          {averageHeartRate ? (
            <View
              style={styles.secondaryStat}
              accessibilityLabel={`${t('activity.heartRate')}: ${formatHeartRate(averageHeartRate)} ${t('units.bpm')}`}
            >
              <MaterialCommunityIcons name="heart-pulse" size={14} color={colors.error} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatHeartRate(averageHeartRate)}
              </RNText>
            </View>
          ) : null}
          {averagePower ? (
            <View
              style={styles.secondaryStat}
              accessibilityLabel={`${t('activity.power')}: ${formatPower(averagePower)} ${t('units.watts')}`}
            >
              <MaterialCommunityIcons
                name="lightning-bolt"
                size={14}
                color={isDark ? darkColors.warningAmber : colors.warningAmber}
              />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatPower(averagePower)}
              </RNText>
            </View>
          ) : null}
          {!!activity.calories && (
            <View
              style={styles.secondaryStat}
              accessibilityLabel={`${t('activity.calories')}: ${formatCalories(activity.calories)} ${t('units.kcal')}`}
            >
              <MaterialCommunityIcons
                name="food-apple"
                size={14}
                color={isDark ? darkColors.successDeep : colors.successDeep}
              />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatCalories(activity.calories)}
              </RNText>
            </View>
          )}
          {activity.has_weather && activity.average_weather_temp != null && (
            <View
              style={styles.secondaryStat}
              accessibilityLabel={`${t('activity.stats.temperature')}: ${formatTemperature(activity.average_weather_temp, isMetric)}`}
            >
              <MaterialCommunityIcons name="weather-partly-cloudy" size={14} color={colors.info} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatTemperature(activity.average_weather_temp, isMetric)}
              </RNText>
            </View>
          )}
        </Pressable>
      </ScrollView>
    );

    // Context menu (shared between compact and full card)
    const contextMenu = (
      <ActivityCardContextMenu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        activity={activity}
      />
    );

    // Strength card: auto-fetch exercise data (like map previews for GPS activities)
    const isStrength = activity.type === 'WeightTraining';
    const { data: exerciseSets, session } = useExerciseSets(activity.id, activity.type);
    const hasExercises = (exerciseSets?.length ?? 0) > 0;
    const { data: muscleGroups, error: musclesError } = useMuscleGroups(activity.id, hasExercises);

    const strengthData = React.useMemo<StrengthCardData | null>(() => {
      if (!isStrength || !exerciseSets || exerciseSets.length === 0) return null;
      if (session.activeSetCount === 0) return null;
      return {
        muscles: (muscleGroups ?? []).map(
          (g): ExtendedBodyPart => ({
            slug: g.slug as NonNullable<ExtendedBodyPart['slug']>,
            intensity: g.intensity,
          })
        ),
        ...(musclesError ? { musclesError } : {}),
        exerciseCount: session.exerciseCount,
        setCount: session.activeSetCount,
        totalWeight: session.totalVolumeKg,
      };
    }, [isStrength, exerciseSets, session, muscleGroups, musclesError]);

    if (isStrength && strengthData) {
      return <StrengthActivityCard activity={activity} strengthData={strengthData} />;
    }

    // Compact card for activities without GPS data
    if (!hasGpsData) {
      return (
        <View style={styles.cardWrapper}>
          <Pressable
            testID={`activity-card-${activity.id}`}
            onPress={handlePress}
            onLongPress={handleLongPress}
            delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            accessibilityRole="button"
            accessibilityLabel={`${newLabel}${activity.name}, ${formatRelativeDate(activity.start_date_local)}, ${formatDistance(activity.distance, isMetric)}, ${formatDuration(activity.moving_time)}`}
            style={pressable(isPressed && styles.cardPressed)}
            android_ripple={pressRipple}
          >
            <Card variant="raised" padding="none" testID={`activity-card-${activity.id}-container`}>
              <View style={styles.compactContent}>
                {/* Header: icon + name/date stacked + no-map indicator */}
                <View style={styles.compactHeader}>
                  <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
                    <MaterialCommunityIcons name={iconName} size={14} color={colors.textOnDark} />
                  </View>
                  <View style={styles.compactTitleColumn}>
                    <View style={styles.compactNameRow}>
                      <RNText
                        style={[styles.compactName, { color: compactTextColor }]}
                        numberOfLines={1}
                      >
                        {activity.name}
                      </RNText>
                      <MaterialCommunityIcons
                        name="map-marker-off"
                        size={14}
                        color={activityColor}
                        style={styles.compactNoMapIcon}
                      />
                    </View>
                    <RNText
                      style={[styles.compactDateSubtitle, { color: compactMutedColor }]}
                      numberOfLines={1}
                    >
                      {formatRelativeDate(activity.start_date_local)}
                    </RNText>
                  </View>
                </View>

                {/* Primary stats */}
                <View style={styles.compactPrimaryRow}>
                  <View style={styles.primaryStats}>
                    {activity.distance > 0 && (
                      <>
                        <RNText
                          testID={`activity-card-${activity.id}-distance`}
                          style={[styles.compactStatValue, { color: compactTextColor }]}
                        >
                          {formatDistance(activity.distance, isMetric)}
                        </RNText>
                        <RNText style={[styles.statDot, { color: compactDotColor }]}>·</RNText>
                      </>
                    )}
                    <RNText
                      testID={`activity-card-${activity.id}-duration`}
                      style={[styles.compactStatValue, { color: compactTextColor }]}
                    >
                      {formatDuration(activity.moving_time)}
                    </RNText>
                    {activity.total_elevation_gain > 0 && (
                      <>
                        <RNText style={[styles.statDot, { color: compactDotColor }]}>·</RNText>
                        <RNText
                          testID={`activity-card-${activity.id}-elevation`}
                          style={[styles.compactStatValue, { color: compactTextColor }]}
                        >
                          {formatElevation(activity.total_elevation_gain, isMetric)}
                        </RNText>
                      </>
                    )}
                  </View>
                </View>

                {/* Skyline bar or divider */}
                {activity.skyline_chart_bytes ? (
                  <SkylineBar skylineBytes={activity.skyline_chart_bytes} isDark={isDark} />
                ) : (
                  <View style={[styles.dividerLine, { backgroundColor: compactDividerColor }]} />
                )}

                {/* Secondary stats */}
                {secondaryStatsRow(compactMutedColor)}
              </View>
              {newRing}
            </Card>
          </Pressable>
          {contextMenu}
        </View>
      );
    }

    return (
      <View style={styles.cardWrapper}>
        <View style={isPressed && styles.cardPressed}>
          <Card variant="raised" padding="none" testID={`activity-card-${activity.id}-container`}>
            <View style={styles.mapContainer}>
              <ActivityMapPreview
                activity={activity}
                height={240}
                index={index}
                snapshotRef={snapshotRef}
                snapshotReady={snapshotReady}
                startupTrack={startupTrack}
              />

              {/* Pressable overlay for tap/long-press */}
              <Pressable
                testID={`activity-card-${activity.id}`}
                onPress={handlePress}
                onLongPress={handleLongPress}
                delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                style={pressable(styles.pressableOverlay)}
                android_ripple={pressRipple}
                accessibilityRole="button"
                accessibilityLabel={`${newLabel}${activity.name}, ${formatRelativeDate(activity.start_date_local)}, ${formatDistance(activity.distance, isMetric)}, ${formatDuration(activity.moving_time)}`}
              />

              {/* Top gradient: sport icon + name/date stacked + route trend */}
              <LinearGradient
                colors={theme.top as [string, string, string]}
                style={styles.topOverlay}
                pointerEvents="box-none"
              >
                <View style={styles.overlayHeader} pointerEvents="box-none">
                  <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
                    <MaterialCommunityIcons name={iconName} size={14} color={colors.textOnDark} />
                  </View>
                  <View style={styles.overlayTitleColumn}>
                    <RNText
                      style={[
                        styles.overlayName,
                        { color: theme.text, textShadowColor: theme.shadow },
                      ]}
                      numberOfLines={1}
                    >
                      {activity.name}
                    </RNText>
                    <RNText
                      style={[
                        styles.overlayDateSubtitle,
                        { color: theme.textMuted, textShadowColor: theme.shadow },
                      ]}
                      numberOfLines={1}
                    >
                      {formatRelativeDate(activity.start_date_local)}
                    </RNText>
                  </View>
                  {routeHighlight &&
                    (routeHighlight.isPr ||
                      (routeHighlight.timeDeltaSeconds != null &&
                        routeHighlight.timeDeltaSeconds > 0)) && (
                      <Pressable
                        testID={`activity-card-${activity.id}-route-chip`}
                        onPress={() => openActivity('routes')}
                        hitSlop={8}
                        style={pressable([
                          styles.routeTrendBadge,
                          routeHighlight.isPr
                            ? isDark
                              ? styles.routeTrendBadgePrDark
                              : styles.routeTrendBadgePrLight
                            : styles.routeTrendBadgeDelta,
                        ])}
                        android_ripple={pressRipple}
                      >
                        {routeHighlight.isPr ? (
                          <>
                            <MaterialCommunityIcons
                              name="trophy"
                              size={PILL_ICON_SIZE}
                              color={colors.textOnPrimary}
                            />
                            {formatPrImprovement(routeHighlight.prImprovementSeconds) != null && (
                              <RNText
                                testID={`activity-card-${activity.id}-route-improvement`}
                                style={styles.routeTrendBadgeText}
                              >
                                {formatPrImprovement(routeHighlight.prImprovementSeconds)}
                              </RNText>
                            )}
                          </>
                        ) : routeHighlight.timeDeltaSeconds != null ? (
                          <RNText style={styles.routeTrendBadgeText}>
                            {formatPrDelta(routeHighlight.timeDeltaSeconds)}
                          </RNText>
                        ) : null}
                      </Pressable>
                    )}
                </View>
              </LinearGradient>

              {/* Bottom: all stats unified */}
              <View testID="activity-card-bottom" style={styles.bottomSection}>
                <LinearGradient
                  colors={theme.bottom as [string, string, string]}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                {/* Primary stats */}
                <Pressable
                  onPress={handlePress}
                  style={pressable(styles.primaryRow)}
                  android_ripple={pressRipple}
                >
                  <View style={styles.primaryStats}>
                    <RNText
                      testID={`activity-card-${activity.id}-distance`}
                      style={[
                        styles.primaryStatValue,
                        { color: theme.text, textShadowColor: theme.shadow },
                      ]}
                    >
                      {formatDistance(activity.distance, isMetric)}
                    </RNText>
                    <RNText style={[styles.statDot, { color: theme.dot }]}>·</RNText>
                    <RNText
                      testID={`activity-card-${activity.id}-duration`}
                      style={[
                        styles.primaryStatValue,
                        { color: theme.text, textShadowColor: theme.shadow },
                      ]}
                    >
                      {formatDuration(activity.moving_time)}
                    </RNText>
                    <RNText style={[styles.statDot, { color: theme.dot }]}>·</RNText>
                    <RNText
                      testID={`activity-card-${activity.id}-elevation`}
                      style={[
                        styles.primaryStatValue,
                        { color: theme.text, textShadowColor: theme.shadow },
                      ]}
                    >
                      {formatElevation(activity.total_elevation_gain, isMetric)}
                    </RNText>
                  </View>
                  {/* Right column: section trend indicators + PR counts. */}
                  {sectionHighlights && sectionHighlights.length > 0 ? (
                    <View style={styles.rightColumn}>
                      {sectionHighlights && sectionHighlights.length > 0 && (
                        <Pressable
                          testID={`activity-card-${activity.id}-section-chip`}
                          onPress={() => openActivity('sections')}
                          hitSlop={8}
                          style={pressable(styles.trendBadge)}
                          android_ripple={pressRipple}
                        >
                          {(() => {
                            const improving = sectionHighlights.filter(
                              (h) => h.trend === 1 && !h.isPr
                            ).length;
                            const declining = sectionHighlights.filter(
                              (h) => h.trend === -1 && !h.isPr
                            ).length;
                            const prCount = sectionHighlights.filter((h) => h.isPr).length;
                            return (
                              <>
                                {prCount > 0 && (
                                  <View
                                    testID={`activity-card-${activity.id}-pr-pill`}
                                    style={[
                                      styles.trendPill,
                                      isDark ? styles.prPillDark : styles.prPillLight,
                                    ]}
                                  >
                                    <MaterialCommunityIcons
                                      name="trophy"
                                      size={PILL_ICON_SIZE}
                                      color={colors.textOnPrimary}
                                    />
                                    <RNText
                                      style={[styles.trendCount, { color: colors.textOnPrimary }]}
                                    >
                                      {prCount}
                                    </RNText>
                                  </View>
                                )}
                                {improving > 0 && (
                                  <View
                                    testID={`activity-card-${activity.id}-improving-pill`}
                                    style={[
                                      styles.trendPill,
                                      isDark ? styles.improvingPillDark : styles.improvingPillLight,
                                    ]}
                                  >
                                    <MaterialCommunityIcons
                                      name="trending-up"
                                      size={PILL_ICON_SIZE}
                                      color={ink.white}
                                    />
                                    <RNText style={[styles.trendCount, { color: ink.white }]}>
                                      {improving}
                                    </RNText>
                                  </View>
                                )}
                                {declining > 0 && (
                                  <View
                                    testID={`activity-card-${activity.id}-declining-pill`}
                                    style={[
                                      styles.trendPill,
                                      isDark ? styles.decliningPillDark : styles.decliningPillLight,
                                    ]}
                                  >
                                    <MaterialCommunityIcons
                                      name="trending-down"
                                      size={PILL_ICON_SIZE}
                                      color={ink.white}
                                    />
                                    <RNText style={[styles.trendCount, { color: ink.white }]}>
                                      {declining}
                                    </RNText>
                                  </View>
                                )}
                              </>
                            );
                          })()}
                        </Pressable>
                      )}
                    </View>
                  ) : null}
                </Pressable>
                {activity.skyline_chart_bytes ? (
                  <SkylineBar skylineBytes={activity.skyline_chart_bytes} isDark={isDark} />
                ) : (
                  <View style={[styles.dividerLine, { backgroundColor: theme.divider }]} />
                )}
                {secondaryStatsRow(theme.secondaryText)}
              </View>
            </View>
            {newRing}
          </Card>
        </View>

        {/* Context menu for long press */}
        {contextMenu}
      </View>
    );
  },
  (prev, next) =>
    rowIsUnchanged(
      {
        record: prev.activity,
        extras: [
          prev.index,
          prev.startupTrack,
          prev.colorScheme,
          prev.snapshotReady,
          prev.sectionHighlights,
          prev.routeHighlight,
          prev.isNew,
        ],
      },
      {
        record: next.activity,
        extras: [
          next.index,
          next.startupTrack,
          next.colorScheme,
          next.snapshotReady,
          next.sectionHighlights,
          next.routeHighlight,
          next.isNew,
        ],
      }
    )
);

/** Icon size shared by the route chip and the section pills. */
const PILL_ICON_SIZE = 13;

/** Shape shared by the route chip and the section pills. */
const pillShape = {
  borderRadius: layout.borderRadiusSm,
  paddingHorizontal: spacing.xsPlus,
  paddingVertical: spacing.xxs,
  borderWidth: 1,
} as const;

const styles = StyleSheet.create({
  cardWrapper: {
    marginHorizontal: CARD_MARGIN,
    marginBottom: CARD_MARGIN,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  newRing: {
    ...StyleSheet.absoluteFill,
    borderWidth: 2,
    borderRadius: layout.borderRadius,
    zIndex: 3,
  },
  mapContainer: {
    position: 'relative',
    height: CARD_HEIGHT,
  },
  pressableOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: spacing.smPlus,
    paddingHorizontal: spacing.smPlus,
    paddingBottom: spacing.lg,
    zIndex: 2,
  },
  overlayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTitleColumn: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  routeTrendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    marginLeft: spacing.sm,
    ...pillShape,
  },
  routeTrendBadgePrLight: {
    backgroundColor: brand.gold,
    borderColor: brand.goldDark,
  },
  routeTrendBadgePrDark: {
    backgroundColor: brand.gold,
    borderColor: brand.goldLight,
  },
  routeTrendBadgeDelta: {
    backgroundColor: colorWithOpacity(ink.black, 0.55),
    borderColor: colorWithOpacity(ink.white, 0.2),
  },
  routeTrendBadgeText: {
    ...typography.pillValue,
    color: ink.white,
  },
  overlayName: {
    ...typography.cardTitle,
    ...mapTextShadow,
  },
  overlayDateSubtitle: {
    ...typography.caption,
    fontWeight: '500',
    marginTop: spacing.xxs,
    ...mapTextShadow,
  },
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  primaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.smPlus,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxs,
  },
  rightColumn: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: spacing.xxs,
    marginLeft: spacing.sm,
    flexShrink: 1,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    ...pillShape,
  },
  // PR pill - solid gold, high contrast
  prPillLight: {
    backgroundColor: brand.gold,
    borderColor: brand.goldDark,
  },
  prPillDark: {
    backgroundColor: brand.gold,
    borderColor: brand.goldLight,
  },
  // Improving pill - solid green
  improvingPillLight: {
    backgroundColor: verdict.positive.light,
    borderColor: verdict.positive.dark,
  },
  improvingPillDark: {
    backgroundColor: verdict.positive.light,
    borderColor: verdict.positive.dark,
  },
  // Declining pill - the negative rung, the same verdict the section trend and
  // the insight card draw. It was disabled-grey, so the same decline read as
  // "off" here and as a judgement one card away. The light tone carries the
  // pill in both themes, the way the improving pill does:
  // the ladder's dark rungs are sized for text on a surface, not for white
  // text on a solid.
  decliningPillLight: {
    backgroundColor: verdict.negative.light,
    borderColor: verdict.negative.dark,
  },
  decliningPillDark: {
    backgroundColor: verdict.negative.light,
    borderColor: verdict.negative.dark,
  },
  trendCount: {
    ...typography.pillValue,
  },
  primaryStats: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  primaryStatValue: {
    ...typography.body,
    fontWeight: '700',
    ...mapTextShadow,
  },
  statDot: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '700',
    marginHorizontal: spacing.xsPlus,
  },
  dividerLine: {
    height: 1,
    marginHorizontal: spacing.smPlus,
  },
  secondaryScroll: {
    // The record button floats over the feed's bottom right; the row ends short of it.
    marginRight: layout.recordFabSize + spacing.xl,
    paddingTop: spacing.xxs,
    paddingBottom: spacing.sm,
  },
  secondaryStats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.smPlus,
    gap: spacing.smPlus,
  },
  secondaryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  secondaryStatValue: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  compactContent: {
    padding: spacing.smPlus,
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactTitleColumn: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  compactNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compactName: {
    flex: 1,
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  compactNoMapIcon: {
    marginLeft: spacing.xsPlus,
    opacity: 0.5,
  },
  compactDateSubtitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    marginTop: spacing.xxs,
  },
  compactPrimaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: spacing.xsPlus,
    paddingBottom: spacing.xxs,
  },
  compactStatValue: {
    fontSize: typography.body.fontSize,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
});
