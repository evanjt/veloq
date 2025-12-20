import React from 'react';
import { View, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Text, Surface } from 'react-native-paper';
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
  getActivityIcon,
  getActivityColor,
  isRunningActivity,
} from '@/lib';
import { colors, spacing, layout, typography } from '@/theme';
import { ActivityMapPreview } from './ActivityMapPreview';

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
  const showPace = isRunningActivity(activity.type);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.pressable,
        pressed && styles.pressed,
      ]}
    >
      <Surface
        style={[
          styles.card,
          isDark && styles.cardDark,
        ]}
        elevation={1}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.iconContainer, { backgroundColor: activityColor }]}>
            <MaterialCommunityIcons
              name={iconName as any}
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
            <Text style={styles.date}>
              {formatRelativeDate(activity.start_date_local)}
            </Text>
          </View>
        </View>

        {/* Map preview */}
        <ActivityMapPreview activity={activity} height={160} />

        {/* Stats */}
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, isDark && styles.textLight]}>
              {formatDistance(activity.distance)}
            </Text>
            <Text style={styles.statLabel}>Distance</Text>
          </View>

          <View style={styles.statDivider} />

          <View style={styles.statItem}>
            <Text style={[styles.statValue, isDark && styles.textLight]}>
              {formatDuration(activity.moving_time)}
            </Text>
            <Text style={styles.statLabel}>Time</Text>
          </View>

          <View style={styles.statDivider} />

          <View style={styles.statItem}>
            <Text style={[styles.statValue, isDark && styles.textLight]}>
              {formatElevation(activity.total_elevation_gain)}
            </Text>
            <Text style={styles.statLabel}>Elevation</Text>
          </View>
        </View>

        {/* Secondary stats */}
        <View style={styles.secondaryStats}>
          {(activity.average_heartrate || activity.icu_average_hr) && (
            <View style={styles.secondaryStat}>
              <MaterialCommunityIcons
                name="heart-pulse"
                size={14}
                color={colors.error}
              />
              <Text style={styles.secondaryStatText}>
                {formatHeartRate(activity.average_heartrate || activity.icu_average_hr!)}
              </Text>
            </View>
          )}
          {(activity.average_watts || activity.icu_average_watts) && (
            <View style={styles.secondaryStat}>
              <MaterialCommunityIcons
                name="lightning-bolt"
                size={14}
                color={colors.warning}
              />
              <Text style={styles.secondaryStatText}>
                {formatPower(activity.average_watts || activity.icu_average_watts!)}
              </Text>
            </View>
          )}
        </View>
      </Surface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginHorizontal: layout.screenPadding,
    marginBottom: layout.cardMargin,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.95,
  },
  card: {
    borderRadius: layout.borderRadius,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cardDark: {
    backgroundColor: '#1E1E1E',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: layout.cardPadding,
    paddingBottom: spacing.sm,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  activityName: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  textLight: {
    color: '#FFFFFF',
  },
  date: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  statsContainer: {
    flexDirection: 'row',
    paddingHorizontal: layout.cardPadding,
    paddingVertical: spacing.md,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    ...typography.statsValue,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.statsLabel,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.xs,
  },
  secondaryStats: {
    flexDirection: 'row',
    paddingHorizontal: layout.cardPadding,
    paddingBottom: layout.cardPadding,
    gap: spacing.md,
  },
  secondaryStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  secondaryStatText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
