import React from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { pressable, pressRipple } from '@/shared/ui';
import { getActivityColor } from '@/shared/activity/activityUtils';
import { colors, darkColors, opacity, spacing, layout, typography } from '@/theme';
import type { ActivityType } from '@/types';

/** The picker for a day with several activities, a sheet route answered with the chosen activity id. */

export interface DayActivitiesInput {
  activities: { id: string; name: string; type: ActivityType; load: number }[];
}

// Simple emoji icons for activity types
const ACTIVITY_EMOJIS: Record<string, string> = {
  Ride: '🚴',
  Run: '🏃',
  Swim: '🏊',
  Walk: '🚶',
  Hike: '🥾',
  VirtualRide: '🚴',
  VirtualRun: '🏃',
  Workout: '💪',
  WeightTraining: '🏋️',
  Yoga: '🧘',
  Other: '❤️',
};

const getActivityEmoji = (type: ActivityType): string => ACTIVITY_EMOJIS[type] || '❤️';

function DayActivitiesSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { input, resolve } = useSheetRequest<DayActivitiesInput, string>();

  const surface = isDark ? darkColors.surface : colors.surface;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={[styles.sheet, { backgroundColor: surface }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: textPrimary }]}>
        {t('fitness.selectActivity')}
      </Text>
      <ScrollView>
        {(input?.activities ?? []).map((activity) => (
          <Pressable
            key={activity.id}
            testID={`day-activity-${activity.id}`}
            accessibilityRole="button"
            accessibilityLabel={activity.name}
            style={pressable([styles.row, isDark && styles.rowDark])}
            android_ripple={pressRipple}
            onPress={() => resolve(activity.id)}
          >
            <View style={[styles.icon, { backgroundColor: getActivityColor(activity.type) }]}>
              <Text style={styles.iconText}>{getActivityEmoji(activity.type)}</Text>
            </View>
            <View style={styles.info}>
              <Text style={[styles.name, { color: textPrimary }]} numberOfLines={1}>
                {activity.name}
              </Text>
              {activity.load > 0 && (
                <Text style={[styles.load, { color: textSecondary }]}>
                  {Math.round(activity.load)} {t('stats.tss')}
                </Text>
              )}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export default withScreenBoundary(DayActivitiesSheetContent, 'Day Activities');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    padding: layout.screenPadding,
  },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    marginBottom: spacing.xs,
    minHeight: layout.minTapTarget,
  },
  rowDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: layout.borderRadiusFull,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  iconText: {
    fontSize: typography.bodySmall.fontSize,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
  },
  load: {
    fontSize: typography.caption.fontSize,
    marginTop: spacing.xxs,
  },
});
