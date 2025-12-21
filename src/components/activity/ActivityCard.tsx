import React from 'react';
import { View, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Activity } from '@/types';
import {
  formatDistance,
  formatDuration,
  formatElevation,
  formatHeartRate,
  formatPower,
  formatRelativeDate,
  formatTSS,
  formatCalories,
  getActivityIcon,
  getActivityColor,
} from '@/lib';
import { colors, spacing, layout } from '@/theme';
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
}

export function ActivityCard({ activity }: ActivityCardProps) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const handlePress = () => {
    router.push(`/activity/${activity.id}`);
  };

  const activityColor = getActivityColor(activity.type);
  const iconName = getActivityIcon(activity.type);
  const location = formatLocation(activity);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.pressable,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.card, isDark && styles.cardDark]}>
        {/* Colored accent bar at top - subtle opacity */}
        <View style={[styles.accentBar, { backgroundColor: activityColor + '80' }]} />

        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
            <MaterialCommunityIcons
              name={iconName}
              size={20}
              color="#FFFFFF"
            />
          </View>
          <View style={styles.headerText}>
            <Text
              style={[styles.activityName, isDark && styles.textLight]}
              numberOfLines={1}
            >
              {activity.name}
            </Text>
            <Text style={[styles.date, isDark && styles.dateDark]} numberOfLines={1}>
              {formatRelativeDate(activity.start_date_local)}
              {location && ` · ${location}`}
            </Text>
          </View>
        </View>

        {/* Map preview */}
        <ActivityMapPreview activity={activity} height={160} />

        {/* Stats with colored primary value */}
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: activityColor }]}>
              {formatDistance(activity.distance)}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>DISTANCE</Text>
          </View>

          <View style={[styles.statDivider, isDark && styles.statDividerDark]} />

          <View style={styles.statItem}>
            <Text style={[styles.statValue, isDark && styles.textLight]}>
              {formatDuration(activity.moving_time)}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>TIME</Text>
          </View>

          <View style={[styles.statDivider, isDark && styles.statDividerDark]} />

          <View style={styles.statItem}>
            <Text style={[styles.statValue, isDark && styles.textLight]}>
              {formatElevation(activity.total_elevation_gain)}
            </Text>
            <Text style={[styles.statLabel, isDark && styles.statLabelDark]}>ELEVATION</Text>
          </View>
        </View>

        {/* Secondary stats with better styling */}
        <View style={[styles.secondaryStats, isDark && styles.secondaryStatsDark]}>
          {activity.icu_training_load && (
            <View style={styles.secondaryStat}>
              <View style={[styles.secondaryStatIcon, { backgroundColor: colors.primary + '20' }]}>
                <MaterialCommunityIcons
                  name="fire"
                  size={14}
                  color={colors.primary}
                />
              </View>
              <View>
                <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                  {formatTSS(activity.icu_training_load)}
                </Text>
                <Text style={[styles.secondaryStatLabel, isDark && styles.statLabelDark]}>TSS</Text>
              </View>
            </View>
          )}
          {(activity.average_heartrate || activity.icu_average_hr) && (
            <View style={styles.secondaryStat}>
              <View style={[styles.secondaryStatIcon, { backgroundColor: colors.error + '20' }]}>
                <MaterialCommunityIcons
                  name="heart-pulse"
                  size={14}
                  color={colors.error}
                />
              </View>
              <View>
                <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                  {formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
                </Text>
                <Text style={[styles.secondaryStatLabel, isDark && styles.statLabelDark]}>HR</Text>
              </View>
            </View>
          )}
          {(activity.average_watts || activity.icu_average_watts) && (
            <View style={styles.secondaryStat}>
              <View style={[styles.secondaryStatIcon, { backgroundColor: colors.warning + '20' }]}>
                <MaterialCommunityIcons
                  name="lightning-bolt"
                  size={14}
                  color={colors.warning}
                />
              </View>
              <View>
                <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                  {formatPower(activity.average_watts || activity.icu_average_watts!)}
                </Text>
                <Text style={[styles.secondaryStatLabel, isDark && styles.statLabelDark]}>PWR</Text>
              </View>
            </View>
          )}
          {activity.calories && (
            <View style={styles.secondaryStat}>
              <View style={[styles.secondaryStatIcon, { backgroundColor: colors.success + '20' }]}>
                <MaterialCommunityIcons
                  name="food-apple"
                  size={14}
                  color={colors.success}
                />
              </View>
              <View>
                <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                  {formatCalories(activity.calories)}
                </Text>
                <Text style={[styles.secondaryStatLabel, isDark && styles.statLabelDark]}>CAL</Text>
              </View>
            </View>
          )}
          {activity.has_weather && activity.average_weather_temp != null && (
            <View style={styles.secondaryStat}>
              <View style={[styles.secondaryStatIcon, { backgroundColor: '#03A9F4' + '20' }]}>
                <MaterialCommunityIcons
                  name="weather-partly-cloudy"
                  size={14}
                  color="#03A9F4"
                />
              </View>
              <View>
                <Text style={[styles.secondaryStatValue, isDark && styles.textLight]}>
                  {Math.round(activity.average_weather_temp)}°C
                </Text>
                <Text style={[styles.secondaryStatLabel, isDark && styles.statLabelDark]}>TEMP</Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

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
    borderRadius: 16,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    // Better shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardDark: {
    backgroundColor: '#1A1A1A',
    shadowOpacity: 0.3,
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
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    // Subtle shadow on icon
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
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
    color: '#FFFFFF',
  },
  date: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dateDark: {
    color: '#888',
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.02)',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  statLabelDark: {
    color: '#777',
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginVertical: spacing.xs,
  },
  statDividerDark: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  secondaryStats: {
    flexDirection: 'row',
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.md,
    gap: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  secondaryStatsDark: {
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  secondaryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  secondaryStatIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryStatValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  secondaryStatLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textSecondary,
    letterSpacing: 0.3,
    marginTop: 1,
  },
});
