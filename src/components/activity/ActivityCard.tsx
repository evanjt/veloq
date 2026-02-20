import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  Platform,
  Share,
  Text as RNText,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, useMetricSystem } from '@/hooks';
import { Menu } from 'react-native-paper';
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
import { colors, darkColors, typography, spacing, shadows } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import { useMapPreferences } from '@/providers';
import { ActivityMapPreview } from './ActivityMapPreview';
import { SkylineBar } from './SkylineBar';

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
  shadow: 'rgba(255,255,255,0.9)',
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

export const ActivityCard = React.memo(function ActivityCard({
  activity,
  index,
}: ActivityCardProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState({ x: 0, y: 0 });
  const [isPressed, setIsPressed] = useState(false);
  const handlePressIn = useCallback(() => setIsPressed(true), []);
  const handlePressOut = useCallback(() => setIsPressed(false), []);

  const handlePress = () => {
    router.push(`/activity/${activity.id}`);
  };

  const handleLongPress = useCallback(
    (event: { nativeEvent: { pageX: number; pageY: number } }) => {
      if (Platform.OS === 'ios') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      setMenuAnchor({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
      setMenuVisible(true);
    },
    []
  );

  const handleShare = useCallback(async () => {
    setMenuVisible(false);
    const url = `https://intervals.icu/activities/${activity.id}`;
    try {
      await Share.share({
        message: Platform.OS === 'ios' ? activity.name : `${activity.name}\n${url}`,
        url: Platform.OS === 'ios' ? url : undefined,
        title: activity.name,
      });
    } catch {
      // User cancelled or error
    }
  }, [activity.id, activity.name]);

  const handleViewDetails = useCallback(() => {
    setMenuVisible(false);
    router.push(`/activity/${activity.id}`);
  }, [activity.id]);

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
  const mapStyle = getStyleForActivity(activity.type);
  const theme = getGradientTheme(isDark, mapStyle);

  return (
    <View style={styles.cardWrapper}>
      <View style={[styles.card, isDark && styles.cardDark, isPressed && styles.cardPressed]}>
        <View style={styles.mapContainer}>
          <ActivityMapPreview activity={activity} height={240} index={index} />

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

          {/* Top gradient: sport icon + name + date */}
          <LinearGradient
            colors={theme.top as [string, string, string]}
            style={styles.topOverlay}
            pointerEvents="none"
          >
            <View style={styles.overlayHeader}>
              <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
                <MaterialCommunityIcons name={iconName} size={14} color={colors.textOnDark} />
              </View>
              <RNText
                style={[styles.overlayName, { color: theme.text, textShadowColor: theme.shadow }]}
                numberOfLines={1}
              >
                {activity.name}
              </RNText>
              <RNText
                style={[
                  styles.overlayDate,
                  { color: theme.textMuted, textShadowColor: theme.shadow },
                ]}
                numberOfLines={1}
              >
                {formatRelativeDate(activity.start_date_local)}
              </RNText>
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
              {location && (
                <RNText
                  style={[
                    styles.overlayLocation,
                    { color: theme.textMuted, textShadowColor: theme.shadow },
                  ]}
                >
                  {location}
                </RNText>
              )}
            </Pressable>
            {activity.skyline_chart_bytes ? (
              <SkylineBar skylineBytes={activity.skyline_chart_bytes} isDark={isDark} />
            ) : (
              <View style={[styles.dividerLine, { backgroundColor: theme.divider }]} />
            )}
            {/* Secondary stats */}
            <ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              onContentSizeChange={handleContentSizeChange}
              style={styles.secondaryScroll}
            >
              <Pressable onPress={handlePress} style={styles.secondaryStats}>
                {activity.icu_training_load && (
                  <View
                    style={styles.secondaryStat}
                    accessibilityLabel={`${t('activity.stats.trainingLoad')}: ${formatTSS(activity.icu_training_load)}`}
                  >
                    <MaterialCommunityIcons name="fire" size={14} color={colors.primary} />
                    <RNText style={[styles.secondaryStatValue, { color: theme.secondaryText }]}>
                      {formatTSS(activity.icu_training_load)}
                    </RNText>
                  </View>
                )}
                {(activity.average_heartrate || activity.icu_average_hr) && (
                  <View
                    style={styles.secondaryStat}
                    accessibilityLabel={`${t('activity.heartRate')}: ${formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)} ${t('units.bpm')}`}
                  >
                    <MaterialCommunityIcons name="heart-pulse" size={14} color={colors.error} />
                    <RNText style={[styles.secondaryStatValue, { color: theme.secondaryText }]}>
                      {formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
                    </RNText>
                  </View>
                )}
                {(activity.average_watts || activity.icu_average_watts) && (
                  <View
                    style={styles.secondaryStat}
                    accessibilityLabel={`${t('activity.power')}: ${formatPower(activity.average_watts || activity.icu_average_watts!)} ${t('units.watts')}`}
                  >
                    <MaterialCommunityIcons
                      name="lightning-bolt"
                      size={14}
                      color={colors.warning}
                    />
                    <RNText style={[styles.secondaryStatValue, { color: theme.secondaryText }]}>
                      {formatPower(activity.average_watts || activity.icu_average_watts!)}
                    </RNText>
                  </View>
                )}
                {activity.calories && (
                  <View
                    style={styles.secondaryStat}
                    accessibilityLabel={`${t('activity.calories')}: ${formatCalories(activity.calories)} ${t('units.kcal')}`}
                  >
                    <MaterialCommunityIcons name="food-apple" size={14} color={colors.success} />
                    <RNText style={[styles.secondaryStatValue, { color: theme.secondaryText }]}>
                      {formatCalories(activity.calories)}
                    </RNText>
                  </View>
                )}
                {activity.has_weather && activity.average_weather_temp != null && (
                  <View
                    style={styles.secondaryStat}
                    accessibilityLabel={`${t('activity.stats.temperature')}: ${formatTemperature(activity.average_weather_temp, isMetric)}`}
                  >
                    <MaterialCommunityIcons
                      name="weather-partly-cloudy"
                      size={14}
                      color={colors.info}
                    />
                    <RNText style={[styles.secondaryStatValue, { color: theme.secondaryText }]}>
                      {formatTemperature(activity.average_weather_temp, isMetric)}
                    </RNText>
                  </View>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </View>

      {/* Context menu for long press */}
      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchor={menuAnchor}
        contentStyle={[styles.menuContent, isDark && styles.menuContentDark]}
      >
        <Menu.Item onPress={handleShare} title={t('activity.share')} leadingIcon="share-variant" />
        <Menu.Item
          onPress={handleViewDetails}
          title={t('activity.viewDetails')}
          leadingIcon="information-outline"
        />
      </Menu>
    </View>
  );
});

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
    borderRadius: 12,
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
  overlayName: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
    marginLeft: spacing.sm,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  overlayDate: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    marginLeft: spacing.sm,
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
  menuContent: {
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  menuContentDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
});
