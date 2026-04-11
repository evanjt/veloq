import React, { useState, useCallback, useRef } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Platform, Text as RNText } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, useMetricSystem } from '@/hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import type { Activity } from '@/types';
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
  getActivityIcon,
  getActivityColor,
} from '@/lib';
import { colors, darkColors, typography, spacing, shadows, brand, layout } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import { useMapPreferences } from '@/providers';
import { ActivityMapPreview } from './ActivityMapPreview';
import type { PreviewTrack } from '@/hooks/home/useStartupData';
import { ActivityCardContextMenu } from './ActivityCardContextMenu';
import { SkylineBar } from './SkylineBar';
import Body, { type ExtendedBodyPart } from 'react-native-body-highlighter';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useExerciseSets, useMuscleGroups } from '@/hooks/activities';
import type { TerrainSnapshotWebViewRef } from '@/components/maps/TerrainSnapshotWebView';

function formatLocation(activity: Activity): string | null {
  if (!activity.locality) return null;
  if (activity.country) {
    return `${activity.locality}, ${activity.country}`;
  }
  return activity.locality;
}

interface ActivityCardProps {
  activity: Activity;
  index?: number;
  /** Ref to the shared snapshot WebView for 3D terrain previews */
  snapshotRef?: React.RefObject<TerrainSnapshotWebViewRef | null>;
  /** Whether the feed screen is focused — defers snapshot requests when false */
  screenFocused?: boolean;
  /** Pre-fetched GPS track from startup data */
  startupTrack?: PreviewTrack;
  /** Whether snapshot WebView workers are ready */
  snapshotReady?: boolean;
  /** Forces re-render when theme changes (enableFreeze suppresses useColorScheme updates) */
  colorScheme?: boolean;
  /** Section highlights for this activity (PRs, trends) from batch FFI query */
  sectionHighlights?: Array<{
    sectionName: string;
    isPr: boolean;
    trend: number; // -1=slower, 0=neutral, 1=faster vs preceding avg
  }>;
  /** Route highlight for this activity (trend, PR) */
  routeHighlight?: {
    routeName: string;
    isPr: boolean;
    trend: number; // -1=slower, 0=neutral, 1=faster
  };
}

// White text theme (used on any dark/satellite map, or dark theme + light map)
const WHITE_TEXT = {
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.85)',
  dot: 'rgba(255,255,255,0.5)',
  divider: 'rgba(255,255,255,0.15)',
  secondaryText: 'rgba(255,255,255,0.9)',
  shadow: 'rgba(0,0,0,0.8)',
};

// Dark text theme (only for light theme + light map)
const DARK_TEXT = {
  text: colors.textPrimary,
  textMuted: colors.textSecondary,
  dot: 'rgba(0,0,0,0.25)',
  divider: 'rgba(0,0,0,0.1)',
  secondaryText: colors.textSecondary,
  shadow: 'transparent',
};

// Gradient + text combos driven by app theme x map style
const GRADIENT = {
  // Light theme + light map: white wash blends into light UI
  lightLight: {
    top: ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.5)', 'transparent'] as const,
    bottom: ['transparent', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.95)'] as const,
    ...DARK_TEXT,
  },
  // Light theme + dark map: subtle scrim, map already provides contrast
  lightDark: {
    top: ['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.2)', 'transparent'] as const,
    bottom: ['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.55)'] as const,
    ...WHITE_TEXT,
  },
  // Dark theme + light map: strong dark scrim to blend into dark UI
  darkLight: {
    top: ['rgba(0,0,0,0.7)', 'rgba(0,0,0,0.3)', 'transparent'] as const,
    bottom: ['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.72)'] as const,
    ...WHITE_TEXT,
  },
  // Dark theme + dark map: subtle scrim, everything already dark
  darkDark: {
    top: ['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.2)', 'transparent'] as const,
    bottom: ['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.6)'] as const,
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
    screenFocused,
    startupTrack,
    snapshotReady,
    sectionHighlights,
    routeHighlight,
  }: ActivityCardProps) {
    // Log actual function body execution (not useEffect which is deferred)
    if (__DEV__ && (index ?? 0) < 3) {
      console.log(`  🃏 ActivityCard[${index}] BODY executing (${activity.type})`);
    }
    const { t } = useTranslation();
    const { isDark } = useTheme();
    const isMetric = useMetricSystem();
    const [menuVisible, setMenuVisible] = useState(false);
    const [isPressed, setIsPressed] = useState(false);
    const handlePressIn = useCallback(() => setIsPressed(true), []);
    const handlePressOut = useCallback(() => setIsPressed(false), []);

    const handlePress = () => {
      router.push(`/activity/${activity.id}`);
    };

    const handleLongPress = useCallback(() => {
      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      setMenuVisible(true);
    }, []);

    const scrollRef = useRef<ScrollView>(null);
    const hasFlashed = useRef(false);

    const handleContentSizeChange = useCallback((contentWidth: number, _contentHeight: number) => {
      if (!hasFlashed.current && scrollRef.current) {
        hasFlashed.current = true;
        setTimeout(() => scrollRef.current?.flashScrollIndicators(), 400);
      }
    }, []);

    const { getStyleForActivity } = useMapPreferences();
    const activityColor = getActivityColor(activity.type);
    const iconName = getActivityIcon(activity.type);
    const location = formatLocation(activity);
    const mapStyle = getStyleForActivity(activity.type, activity.id, activity.country);
    const theme = getGradientTheme(isDark, mapStyle);
    const hasGpsData = activity.stream_types?.includes('latlng');

    const compactTextColor = isDark ? darkColors.textPrimary : colors.textPrimary;
    const compactMutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
    const compactDotColor = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)';
    const compactDividerColor = isDark ? darkColors.border : 'rgba(0,0,0,0.1)';

    // Shared secondary stats row used by both compact and full card
    const secondaryStatsRow = (textColor: string) => (
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={handleContentSizeChange}
        style={styles.secondaryScroll}
      >
        <Pressable onPress={handlePress} style={styles.secondaryStats}>
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
          {!!(activity.average_heartrate || activity.icu_average_hr) && (
            <View
              style={styles.secondaryStat}
              accessibilityLabel={`${t('activity.heartRate')}: ${formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)} ${t('units.bpm')}`}
            >
              <MaterialCommunityIcons name="heart-pulse" size={14} color={colors.error} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
              </RNText>
            </View>
          )}
          {!!(activity.average_watts || activity.icu_average_watts) && (
            <View
              style={styles.secondaryStat}
              accessibilityLabel={`${t('activity.power')}: ${formatPower(activity.average_watts || activity.icu_average_watts!)} ${t('units.watts')}`}
            >
              <MaterialCommunityIcons name="lightning-bolt" size={14} color={colors.warning} />
              <RNText style={[styles.secondaryStatValue, { color: textColor }]}>
                {formatPower(activity.average_watts || activity.icu_average_watts!)}
              </RNText>
            </View>
          )}
          {!!activity.calories && (
            <View
              style={styles.secondaryStat}
              accessibilityLabel={`${t('activity.calories')}: ${formatCalories(activity.calories)} ${t('units.kcal')}`}
            >
              <MaterialCommunityIcons name="food-apple" size={14} color={colors.success} />
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
    const { data: exerciseSets } = useExerciseSets(activity.id, activity.type);
    const hasExercises = (exerciseSets?.length ?? 0) > 0;
    const { data: muscleGroups } = useMuscleGroups(activity.id, hasExercises);

    const strengthData = React.useMemo(() => {
      if (!isStrength || !exerciseSets || exerciseSets.length === 0) return null;
      const activeSets = exerciseSets.filter((s) => s.setType === 0);
      if (activeSets.length === 0) return null;
      const totalWeight = activeSets.reduce(
        (sum, s) => sum + (s.weightKg ?? 0) * (s.repetitions ?? 1),
        0
      );
      const exerciseNames = new Set(activeSets.map((s) => s.displayName));
      return {
        muscles: (muscleGroups ?? []).map(
          (g): ExtendedBodyPart => ({
            slug: g.slug as ExtendedBodyPart['slug'],
            intensity: g.intensity,
          })
        ),
        exerciseCount: exerciseNames.size,
        setCount: activeSets.length,
        totalWeight,
      };
    }, [isStrength, exerciseSets, muscleGroups]);

    if (isStrength && strengthData) {
      return (
        <View style={styles.cardWrapper}>
          <View style={[styles.card, isDark && styles.cardDark, isPressed && styles.cardPressed]}>
            <View style={[styles.strengthPanel, isDark && styles.strengthPanelDark]}>
              {/* Pressable overlay */}
              <Pressable
                testID={`activity-card-${activity.id}`}
                onPress={handlePress}
                onLongPress={handleLongPress}
                delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                style={styles.pressableOverlay}
                accessibilityRole="button"
                accessibilityLabel={`${activity.name}, ${formatRelativeDate(activity.start_date_local)}, ${formatDuration(activity.moving_time)}`}
              />

              {/* Top: icon + name + date */}
              <View style={styles.topOverlay} pointerEvents="none">
                <View style={styles.overlayHeader}>
                  <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
                    <MaterialCommunityIcons name={iconName} size={14} color={colors.textOnDark} />
                  </View>
                  <View style={styles.overlayTitleColumn}>
                    <RNText
                      style={[
                        styles.overlayName,
                        { color: compactTextColor, textShadowColor: 'transparent' },
                      ]}
                      numberOfLines={1}
                    >
                      {activity.name}
                    </RNText>
                    <RNText
                      style={[
                        styles.overlayDateSubtitle,
                        { color: compactMutedColor, textShadowColor: 'transparent' },
                      ]}
                    >
                      {formatRelativeDate(activity.start_date_local)}
                    </RNText>
                  </View>
                </View>
              </View>

              {/* Center: body diagrams + stats */}
              <View style={styles.strengthCenter}>
                <View style={styles.strengthBodies}>
                  <Body
                    data={strengthData.muscles}
                    gender="male"
                    side="front"
                    scale={0.38}
                    colors={[brand.orangeLight, brand.orange]}
                  />
                  <Body
                    data={strengthData.muscles}
                    gender="male"
                    side="back"
                    scale={0.38}
                    colors={[brand.orangeLight, brand.orange]}
                  />
                </View>
                <View style={styles.strengthStats}>
                  <View style={styles.strengthStatRow}>
                    <RNText style={[styles.strengthStatValue, { color: compactTextColor }]}>
                      {formatDuration(activity.moving_time)}
                    </RNText>
                    <RNText style={[styles.strengthStatLabel, { color: compactMutedColor }]}>
                      Duration
                    </RNText>
                  </View>
                  <View style={styles.strengthStatRow}>
                    <RNText style={[styles.strengthStatValue, { color: compactTextColor }]}>
                      {strengthData.exerciseCount} / {strengthData.setCount}
                    </RNText>
                    <RNText style={[styles.strengthStatLabel, { color: compactMutedColor }]}>
                      {t('activityDetail.exercises')} / Sets
                    </RNText>
                  </View>
                  {strengthData.totalWeight > 0 && (
                    <View style={styles.strengthStatRow}>
                      <RNText style={[styles.strengthStatValue, { color: compactTextColor }]}>
                        {isMetric
                          ? `${Math.round(strengthData.totalWeight)} kg`
                          : `${Math.round(strengthData.totalWeight * 2.20462)} lbs`}
                      </RNText>
                      <RNText style={[styles.strengthStatLabel, { color: compactMutedColor }]}>
                        Total
                      </RNText>
                    </View>
                  )}
                </View>
              </View>

              {/* Bottom: secondary stats only */}
              <View style={styles.strengthBottom}>
                {activity.skyline_chart_bytes ? (
                  <SkylineBar skylineBytes={activity.skyline_chart_bytes} isDark={isDark} />
                ) : (
                  <View style={[styles.dividerLine, { backgroundColor: compactDividerColor }]} />
                )}
                {secondaryStatsRow(compactMutedColor)}
              </View>
            </View>
          </View>
          {contextMenu}
        </View>
      );
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
            accessibilityLabel={`${activity.name}, ${formatRelativeDate(activity.start_date_local)}, ${formatDistance(activity.distance, isMetric)}, ${formatDuration(activity.moving_time)}`}
          >
            <View style={[styles.card, isDark && styles.cardDark, isPressed && styles.cardPressed]}>
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

                {/* Primary stats + location */}
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
                  {location && (
                    <RNText style={[styles.compactLocation, { color: compactMutedColor }]}>
                      {location}
                    </RNText>
                  )}
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
            </View>
          </Pressable>
          {contextMenu}
        </View>
      );
    }

    return (
      <View style={styles.cardWrapper}>
        <View style={[styles.card, isDark && styles.cardDark, isPressed && styles.cardPressed]}>
          <View style={styles.mapContainer}>
            <ActivityMapPreview
              activity={activity}
              height={240}
              index={index}
              snapshotRef={snapshotRef}
              screenFocused={screenFocused}
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
              style={styles.pressableOverlay}
              accessibilityRole="button"
              accessibilityLabel={`${activity.name}, ${formatRelativeDate(activity.start_date_local)}, ${formatDistance(activity.distance, isMetric)}, ${formatDuration(activity.moving_time)}`}
            />

            {/* Top gradient: sport icon + name/date stacked + route trend */}
            <LinearGradient
              colors={theme.top as [string, string, string]}
              style={styles.topOverlay}
              pointerEvents="none"
            >
              <View style={styles.overlayHeader}>
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
                {routeHighlight && routeHighlight.trend !== 0 && (
                  <MaterialCommunityIcons
                    name={routeHighlight.trend === 1 ? 'trending-up' : 'trending-down'}
                    size={22}
                    color={routeHighlight.trend === 1 ? '#66BB6A' : '#FFA726'}
                    style={styles.routeTrendIcon}
                  />
                )}
              </View>
            </LinearGradient>

            {/* Bottom: all stats unified */}
            <View style={styles.bottomSection}>
              <LinearGradient
                colors={theme.bottom as [string, string, string]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              {/* Primary stats + location */}
              <Pressable onPress={handlePress} style={styles.primaryRow}>
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
                {/* Section trend indicators + route PR trophy */}
                {sectionHighlights && sectionHighlights.length > 0 ? (
                  <View style={styles.trendBadge}>
                    {sectionHighlights.filter((h) => h.trend === 1).length > 0 && (
                      <View style={styles.trendItem}>
                        <MaterialCommunityIcons name="arrow-up-bold" size={12} color="#66BB6A" />
                        <RNText style={[styles.trendCount, { color: '#66BB6A' }]}>
                          {sectionHighlights.filter((h) => h.trend === 1).length}
                        </RNText>
                      </View>
                    )}
                    {sectionHighlights.filter((h) => h.trend === -1).length > 0 && (
                      <View style={styles.trendItem}>
                        <MaterialCommunityIcons name="arrow-down-bold" size={12} color="#FFA726" />
                        <RNText style={[styles.trendCount, { color: '#FFA726' }]}>
                          {sectionHighlights.filter((h) => h.trend === -1).length}
                        </RNText>
                      </View>
                    )}
                    {routeHighlight?.isPr && (
                      <MaterialCommunityIcons name="trophy" size={13} color="#FFD700" />
                    )}
                  </View>
                ) : location ? (
                  <RNText
                    style={[
                      styles.overlayLocation,
                      { color: theme.textMuted, textShadowColor: theme.shadow },
                    ]}
                  >
                    {location}
                  </RNText>
                ) : null}
              </Pressable>
              {activity.skyline_chart_bytes ? (
                <SkylineBar skylineBytes={activity.skyline_chart_bytes} isDark={isDark} />
              ) : (
                <View style={[styles.dividerLine, { backgroundColor: theme.divider }]} />
              )}
              {/* Secondary stats */}
              {secondaryStatsRow(theme.secondaryText)}
            </View>
          </View>
        </View>

        {/* Context menu for long press */}
        {contextMenu}
      </View>
    );
  },
  (prev, next) => {
    // Custom comparator: skip re-render when activity content hasn't changed.
    const equal =
      prev.activity.id === next.activity.id &&
      prev.activity.name === next.activity.name &&
      prev.index === next.index &&
      prev.screenFocused === next.screenFocused &&
      prev.startupTrack === next.startupTrack &&
      prev.colorScheme === next.colorScheme &&
      prev.snapshotReady === next.snapshotReady;
    if (__DEV__ && !equal && (prev.index ?? 0) < 3) {
      const diffs: string[] = [];
      if (prev.activity.id !== next.activity.id) diffs.push('id');
      if (prev.activity.name !== next.activity.name) diffs.push('name');
      if (prev.index !== next.index) diffs.push('index');
      if (prev.screenFocused !== next.screenFocused) diffs.push('screenFocused');
      if (prev.startupTrack !== next.startupTrack) diffs.push('startupTrack');
      if (prev.colorScheme !== next.colorScheme) diffs.push('colorScheme');
      if (prev.snapshotReady !== next.snapshotReady) diffs.push('snapshotReady');
      console.log(
        `    🔍 ActivityCard[${prev.index}] memo: re-render because: ${diffs.join(', ')}`
      );
    }
    return equal;
  }
);

const styles = StyleSheet.create({
  cardWrapper: {
    marginHorizontal: 12,
    marginBottom: 12,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  card: {
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadows.elevated,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
    borderWidth: 1,
    borderColor: darkColors.border,
    ...shadows.modal,
  },
  mapContainer: {
    position: 'relative',
    height: 240,
  },
  strengthPanel: {
    position: 'relative',
    height: 240,
    backgroundColor: colors.gray100,
  },
  strengthPanelDark: {
    backgroundColor: darkColors.backgroundAlt,
  },
  strengthCenter: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  strengthBodies: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  strengthStats: {
    gap: 10,
  },
  strengthStatRow: {},
  strengthStatValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  strengthStatLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  strengthBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  pressableOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 28,
    zIndex: 2,
  },
  overlayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayTitleColumn: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  routeTrendIcon: {
    marginLeft: spacing.sm,
  },
  overlayName: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
    letterSpacing: -0.3,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  overlayDateSubtitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    marginTop: 1,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    paddingHorizontal: 12,
    paddingTop: 20,
    paddingBottom: 2,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  trendCount: {
    fontSize: 12,
    fontWeight: '700',
  },
  primaryStats: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  primaryStatValue: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  statDot: {
    fontSize: 18,
    fontWeight: '700',
    marginHorizontal: 6,
  },
  overlayLocation: {
    fontSize: typography.caption.fontSize,
    marginLeft: spacing.sm,
    flexShrink: 1,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  dividerLine: {
    height: 1,
    marginHorizontal: 12,
  },
  secondaryScroll: {
    paddingTop: 2,
    paddingBottom: 8,
  },
  secondaryStats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 12,
  },
  secondaryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  secondaryStatValue: {
    fontSize: typography.caption.fontSize,
    fontWeight: '600',
  },
  compactContent: {
    padding: 12,
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
    marginLeft: 6,
    opacity: 0.5,
  },
  compactDateSubtitle: {
    fontSize: typography.caption.fontSize,
    fontWeight: '500',
    marginTop: 1,
  },
  compactPrimaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingBottom: 2,
  },
  compactStatValue: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  compactLocation: {
    fontSize: typography.caption.fontSize,
    marginLeft: spacing.sm,
    flexShrink: 1,
  },
});
