import React, { useState, useCallback, useRef } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Platform, Share } from 'react-native';
import { useTheme, useMetricSystem } from '@/hooks';
import { Text, Menu } from 'react-native-paper';
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
import { colors, darkColors, opacity, typography, spacing, layout, shadows } from '@/theme';
import { CHART_CONFIG } from '@/constants';
import { ActivityMapPreview } from './ActivityMapPreview';

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

// Breakpoint for narrow screens (icon-only mode for stats)

// Pre-computed icon background styles to avoid object creation on render
const ICON_BG_TSS = { backgroundColor: colors.primary + '20' };
const ICON_BG_HR = { backgroundColor: colors.error + '20' };
const ICON_BG_POWER = { backgroundColor: colors.warning + '20' };
const ICON_BG_CALORIES = { backgroundColor: colors.success + '20' };
const ICON_BG_WEATHER = { backgroundColor: colors.info + '20' };

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
      // iOS-style context menu on long press
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

  const activityColor = getActivityColor(activity.type);
  const iconName = getActivityIcon(activity.type);
  const location = formatLocation(activity);

  return (
    <View style={styles.cardWrapper}>
      <View style={[styles.card, isDark && styles.cardDark, isPressed && styles.cardPressed]}>
        {/* Pressable wraps only header + map so horizontal scroll on stats row works */}
        <Pressable
          testID={`activity-card-${activity.id}`}
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={CHART_CONFIG.LONG_PRESS_DURATION}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          {/* Colored accent bar at top - subtle opacity */}
          <View style={[styles.accentBar, { backgroundColor: activityColor + '80' }]} />

          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
              <MaterialCommunityIcons name={iconName} size={20} color={colors.textOnDark} />
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.activityName, isDark && styles.textLight]} numberOfLines={1}>
                {activity.name}
              </Text>
              <Text style={[styles.date, isDark && styles.dateDark]} numberOfLines={1}>
                {formatRelativeDate(activity.start_date_local)}
                {location && ` · ${location}`}
              </Text>
            </View>
          </View>

          {/* Map preview with stats overlay */}
          <View style={styles.mapContainer}>
            <ActivityMapPreview activity={activity} height={220} index={index} />
            {/* Stats overlay at bottom of map */}
            <View style={styles.statsOverlay}>
              <View style={styles.statPill}>
                <Text
                  testID={`activity-card-${activity.id}-distance`}
                  style={[styles.statValue, { color: activityColor }]}
                >
                  {formatDistance(activity.distance, isMetric)}
                </Text>
              </View>
              <View style={styles.statPill}>
                <Text testID={`activity-card-${activity.id}-duration`} style={styles.statValue}>
                  {formatDuration(activity.moving_time)}
                </Text>
              </View>
              <View style={styles.statPill}>
                <Text testID={`activity-card-${activity.id}-elevation`} style={styles.statValue}>
                  {formatElevation(activity.total_elevation_gain, isMetric)}
                </Text>
              </View>
            </View>
          </View>
        </Pressable>

        {/* Secondary stats - outside Pressable so horizontal scroll works */}
        <View style={[styles.secondaryStatsOuter, isDark && styles.secondaryStatsOuterDark]}>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={true}
            onContentSizeChange={handleContentSizeChange}
          >
            <Pressable
              onPress={handlePress}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              style={styles.secondaryStats}
            >
              {activity.icu_training_load && (
                <View style={styles.secondaryStat}>
                  <View style={[styles.secondaryStatIcon, ICON_BG_TSS]}>
                    <MaterialCommunityIcons name="fire" size={12} color={colors.primary} />
                  </View>
                  <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                    {formatTSS(activity.icu_training_load)}
                  </Text>
                </View>
              )}
              {(activity.average_heartrate || activity.icu_average_hr) && (
                <View style={styles.secondaryStat}>
                  <View style={[styles.secondaryStatIcon, ICON_BG_HR]}>
                    <MaterialCommunityIcons name="heart-pulse" size={12} color={colors.error} />
                  </View>
                  <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                    {formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
                  </Text>
                </View>
              )}
              {(activity.average_watts || activity.icu_average_watts) && (
                <View style={styles.secondaryStat}>
                  <View style={[styles.secondaryStatIcon, ICON_BG_POWER]}>
                    <MaterialCommunityIcons
                      name="lightning-bolt"
                      size={12}
                      color={colors.warning}
                    />
                  </View>
                  <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                    {formatPower(activity.average_watts || activity.icu_average_watts!)}
                  </Text>
                </View>
              )}
              {activity.calories && (
                <View style={styles.secondaryStat}>
                  <View style={[styles.secondaryStatIcon, ICON_BG_CALORIES]}>
                    <MaterialCommunityIcons name="food-apple" size={12} color={colors.success} />
                  </View>
                  <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                    {formatCalories(activity.calories)}
                  </Text>
                </View>
              )}
              {activity.has_weather && activity.average_weather_temp != null && (
                <View style={styles.secondaryStat}>
                  <View style={[styles.secondaryStatIcon, ICON_BG_WEATHER]}>
                    <MaterialCommunityIcons
                      name="weather-partly-cloudy"
                      size={12}
                      color={colors.info}
                    />
                  </View>
                  <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                    {formatTemperature(activity.average_weather_temp, isMetric)}
                  </Text>
                </View>
              )}
            </Pressable>
          </ScrollView>
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
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.md,
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  card: {
    borderRadius: spacing.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    // Platform-optimized shadows
    ...shadows.elevated,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
    // Dark mode: stronger shadow for contrast
    ...shadows.modal,
  },
  accentBar: {
    height: 2,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: layout.cardPadding,
    paddingBottom: spacing.sm,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: layout.borderRadius,
    justifyContent: 'center',
    alignItems: 'center',
    // Platform-optimized subtle shadow
    ...shadows.button,
  },
  headerText: {
    flex: 1,
    marginLeft: spacing.md,
  },
  activityName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  textLight: {
    color: colors.textOnDark,
  },
  date: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dateDark: {
    color: darkColors.textSecondary,
  },
  mapContainer: {
    position: 'relative',
  },
  statsOverlay: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statPill: {
    backgroundColor: opacity.overlay.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadiusSm,
  },
  statValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.textOnDark,
    letterSpacing: -0.3,
  },
  secondaryStatsOuter: {
    position: 'relative',
    borderTopWidth: 1,
    borderTopColor: opacity.overlay.light,
  },
  secondaryStatsOuterDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  secondaryStats: {
    flexDirection: 'row',
    paddingLeft: layout.cardPadding,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    gap: 12,
  },
  secondaryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  secondaryStatIcon: {
    width: 20,
    height: 20,
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryStatValue: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  menuContent: {
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  menuContentDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
});
