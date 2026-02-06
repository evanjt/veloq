import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Pressable, Platform, Share, useWindowDimensions } from 'react-native';
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
const NARROW_SCREEN_WIDTH = 380;

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
  const { width: screenWidth } = useWindowDimensions();
  const isNarrowScreen = screenWidth < NARROW_SCREEN_WIDTH;
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState({ x: 0, y: 0 });

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

  const activityColor = getActivityColor(activity.type);
  const iconName = getActivityIcon(activity.type);
  const location = formatLocation(activity);

  return (
    <Pressable
      testID={`activity-card-${activity.id}`}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <View style={[styles.card, isDark && styles.cardDark]}>
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

        {/* Secondary stats - adaptive layout for narrow screens */}
        <View
          style={[
            styles.secondaryStats,
            isDark && styles.secondaryStatsDark,
            isNarrowScreen && styles.secondaryStatsNarrow,
          ]}
        >
          {activity.icu_training_load && (
            <View style={[styles.secondaryStat, isNarrowScreen && styles.secondaryStatNarrow]}>
              <View
                style={[
                  styles.secondaryStatIcon,
                  ICON_BG_TSS,
                  isNarrowScreen && styles.secondaryStatIconNarrow,
                ]}
              >
                <MaterialCommunityIcons
                  name="fire"
                  size={isNarrowScreen ? 12 : 14}
                  color={colors.primary}
                />
              </View>
              {isNarrowScreen ? (
                <Text style={[styles.secondaryStatValueNarrow, isDark && styles.textLight]}>
                  {formatTSS(activity.icu_training_load)}
                </Text>
              ) : (
                <View>
                  <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                    {formatTSS(activity.icu_training_load)}
                  </Text>
                  <Text style={[styles.secondaryStatLabel, isDark && styles.statLabelDark]}>
                    {t('activity.tss')}
                  </Text>
                </View>
              )}
            </View>
          )}
          {(activity.average_heartrate || activity.icu_average_hr) && (
            <View style={[styles.secondaryStat, isNarrowScreen && styles.secondaryStatNarrow]}>
              <View
                style={[
                  styles.secondaryStatIcon,
                  ICON_BG_HR,
                  isNarrowScreen && styles.secondaryStatIconNarrow,
                ]}
              >
                <MaterialCommunityIcons
                  name="heart-pulse"
                  size={isNarrowScreen ? 12 : 14}
                  color={colors.error}
                />
              </View>
              {isNarrowScreen ? (
                <Text style={[styles.secondaryStatValueNarrow, isDark && styles.textLight]}>
                  {formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
                </Text>
              ) : (
                <View>
                  <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                    {formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
                  </Text>
                  <Text style={[styles.secondaryStatLabel, isDark && styles.statLabelDark]}>
                    {t('metrics.hr')}
                  </Text>
                </View>
              )}
            </View>
          )}
          {(activity.average_watts || activity.icu_average_watts) && (
            <View style={[styles.secondaryStat, isNarrowScreen && styles.secondaryStatNarrow]}>
              <View
                style={[
                  styles.secondaryStatIcon,
                  ICON_BG_POWER,
                  isNarrowScreen && styles.secondaryStatIconNarrow,
                ]}
              >
                <MaterialCommunityIcons
                  name="lightning-bolt"
                  size={isNarrowScreen ? 12 : 14}
                  color={colors.warning}
                />
              </View>
              {isNarrowScreen ? (
                <Text style={[styles.secondaryStatValueNarrow, isDark && styles.textLight]}>
                  {formatPower(activity.average_watts || activity.icu_average_watts!)}
                </Text>
              ) : (
                <View>
                  <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                    {formatPower(activity.average_watts || activity.icu_average_watts!)}
                  </Text>
                  <Text style={[styles.secondaryStatLabel, isDark && styles.statLabelDark]}>
                    {t('activity.pwr')}
                  </Text>
                </View>
              )}
            </View>
          )}
          {activity.calories && (
            <View style={[styles.secondaryStat, isNarrowScreen && styles.secondaryStatNarrow]}>
              <View
                style={[
                  styles.secondaryStatIcon,
                  ICON_BG_CALORIES,
                  isNarrowScreen && styles.secondaryStatIconNarrow,
                ]}
              >
                <MaterialCommunityIcons
                  name="food-apple"
                  size={isNarrowScreen ? 12 : 14}
                  color={colors.success}
                />
              </View>
              {isNarrowScreen ? (
                <Text style={[styles.secondaryStatValueNarrow, isDark && styles.textLight]}>
                  {formatCalories(activity.calories)}
                </Text>
              ) : (
                <View>
                  <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                    {formatCalories(activity.calories)}
                  </Text>
                  <Text style={[styles.secondaryStatLabel, isDark && styles.statLabelDark]}>
                    {t('activity.cal')}
                  </Text>
                </View>
              )}
            </View>
          )}
          {activity.has_weather && activity.average_weather_temp != null && (
            <View style={[styles.secondaryStat, isNarrowScreen && styles.secondaryStatNarrow]}>
              <View
                style={[
                  styles.secondaryStatIcon,
                  ICON_BG_WEATHER,
                  isNarrowScreen && styles.secondaryStatIconNarrow,
                ]}
              >
                <MaterialCommunityIcons
                  name="weather-partly-cloudy"
                  size={isNarrowScreen ? 12 : 14}
                  color={colors.info}
                />
              </View>
              {isNarrowScreen ? (
                <Text style={[styles.secondaryStatValueNarrow, isDark && styles.textLight]}>
                  {formatTemperature(activity.average_weather_temp, isMetric)}
                </Text>
              ) : (
                <View>
                  <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                    {formatTemperature(activity.average_weather_temp, isMetric)}
                  </Text>
                  <Text style={[styles.secondaryStatLabel, isDark && styles.statLabelDark]}>
                    {t('activity.temp')}
                  </Text>
                </View>
              )}
            </View>
          )}
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
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pressable: {
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.md,
  },
  pressed: {
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
  secondaryStats: {
    flexDirection: 'row',
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.md,
    gap: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: opacity.overlay.light,
  },
  secondaryStatsDark: {
    borderTopColor: opacity.overlayDark.medium,
  },
  // Narrow screen: reduced gaps, more compact
  secondaryStatsNarrow: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  secondaryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // Narrow screen: tighter spacing
  secondaryStatNarrow: {
    gap: spacing.xs,
  },
  secondaryStatIcon: {
    width: 28,
    height: 28,
    borderRadius: layout.borderRadiusSm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Narrow screen: smaller icons
  secondaryStatIconNarrow: {
    width: 22,
    height: 22,
  },
  secondaryStatValue: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  // Narrow screen: compact value without label
  secondaryStatValueNarrow: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  secondaryStatLabel: {
    fontSize: typography.pillLabel.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.3,
    marginTop: 1,
  },
  statLabelDark: {
    color: darkColors.textMuted,
  },
  menuContent: {
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  menuContentDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
});
