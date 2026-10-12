import React, { useMemo } from 'react';
import { Pressable, View, FlatList, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { Stack } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import {
  colors,
  darkColors,
  spacing,
  layout,
  typography,
  brand,
  colorWithOpacity,
  ink,
} from '@/theme';
import { getActivityIcon, getActivityInk } from '@/shared/activity/activityUtils';
import { ACTIVITY_CATEGORIES } from '@/features/recording';
import type { ActivityType } from '@/types';
import { pressable, pressRipple, SheetHeader } from '@/shared/ui';
import { tapBack } from '@/shared/app/navigation';

/**
 * The activity type picker, a sheet route opened with `openSheet` and answered
 * with the chosen `ActivityType`. `mode` switches the two kinds of caller:
 *
 * - `review` (default): a curated 20-type popular set, no per-item border,
 *   neutral selected-row highlight, and no swipe to dismiss, so only Cancel or
 *   system back leaves it. Used when reviewing a completed or manual activity.
 * - `recording`: every activity type from `ACTIVITY_CATEGORIES`, a hairline
 *   border per row and a teal-tinted selected row. Used to choose a sport
 *   before or during a recording.
 */

export interface ActivityTypeSheetInput {
  selectedType: ActivityType;
  mode?: 'review' | 'recording';
}

// Curated set shown on the review screen - ordered by popularity.
const REVIEW_ACTIVITY_TYPES: ActivityType[] = [
  'Ride',
  'Run',
  'VirtualRide',
  'Walk',
  'Hike',
  'Swim',
  'MountainBikeRide',
  'GravelRide',
  'TrailRun',
  'WeightTraining',
  'Yoga',
  'Rowing',
  'NordicSki',
  'AlpineSki',
  'Workout',
  'EBikeRide',
  'OpenWaterSwim',
  'Treadmill',
  'VirtualRun',
  'Other',
];

function flattenCategories(): ActivityType[] {
  const types: ActivityType[] = [];
  for (const group of Object.values(ACTIVITY_CATEGORIES)) {
    for (const type of group) {
      types.push(type as ActivityType);
    }
  }
  return types;
}

function ActivityTypeSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { input, resolve } = useSheetRequest<ActivityTypeSheetInput, ActivityType>();
  const selectedType = input?.selectedType;
  const isRecording = input?.mode === 'recording';
  const types = useMemo(
    () => (isRecording ? flattenCategories() : REVIEW_ACTIVITY_TYPES),
    [isRecording]
  );

  const surface = isDark ? darkColors.surface : colors.surface;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const border = isDark ? darkColors.border : colors.border;

  const selectedRowStyle = isRecording
    ? styles.rowSelectedRecording
    : {
        backgroundColor: isDark
          ? colorWithOpacity(ink.white, 0.08)
          : colorWithOpacity(ink.black, 0.04),
      };

  const titleKey = isRecording ? 'recording.changeType' : 'recording.activityType';
  const titleFallback = isRecording ? 'Change Activity Type' : 'Activity Type';

  return (
    <View style={[styles.sheet, { backgroundColor: surface }]}>
      <Stack.Screen options={{ gestureEnabled: isRecording }} />
      <SheetHeader
        title={t(titleKey, titleFallback)}
        onCancel={() => tapBack()}
        cancelTestID="activity-type-cancel"
        style={!isRecording && [styles.headerBordered, isDark && styles.headerBorderedDark]}
      />
      <FlatList
        data={types}
        keyExtractor={(item) => item}
        style={isRecording ? styles.list : undefined}
        renderItem={({ item }) => {
          const isSelected = item === selectedType;
          return (
            <Pressable
              testID={`activity-type-option-${item}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              style={pressable([
                styles.row,
                isRecording && {
                  borderBottomColor: border,
                  ...styles.rowBordered,
                },
                isSelected && selectedRowStyle,
              ])}
              onPress={() => resolve(item)}
              android_ripple={pressRipple}
            >
              <MaterialCommunityIcons
                name={getActivityIcon(item)}
                size={22}
                color={getActivityInk(item, isDark)}
                style={isRecording ? styles.iconRecording : undefined}
              />
              <Text style={[styles.label, { color: textPrimary }]}>
                {t(`activityTypes.${item}`, item)}
              </Text>
              {isSelected && (
                <MaterialCommunityIcons
                  name="check"
                  size={isRecording ? 18 : 20}
                  color={brand.teal}
                />
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

export default withScreenBoundary(ActivityTypeSheetContent, 'Activity Type');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    paddingBottom: spacing.xl,
  },
  headerBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colorWithOpacity(ink.black, 0.2),
  },
  headerBorderedDark: {
    borderBottomColor: darkColors.border,
  },
  list: {
    paddingHorizontal: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: layout.minTapTarget,
  },
  rowBordered: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
  },
  rowSelectedRecording: {
    backgroundColor: colorWithOpacity(brand.teal, 0.08),
  },
  iconRecording: {
    marginRight: spacing.sm,
    width: 28,
    textAlign: 'center',
  },
  label: {
    ...typography.body,
    flex: 1,
  },
});
