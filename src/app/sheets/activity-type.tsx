import React, { useMemo } from 'react';
import { Pressable, View, SectionList, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
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
import { ACTIVITY_CATEGORIES, useRecordingPreferences } from '@/features/recording';
import type { ActivityType } from '@/types';
import { pressable, pressRipple, SheetHeader } from '@/shared/ui';
import { tapBack } from '@/shared/app/navigation';

/**
 * The activity type picker, a sheet route opened with `openSheet` and answered
 * with the chosen `ActivityType`.
 *
 * Every caller gets the same list: the athlete's recent sports first, then every
 * type from `ACTIVITY_CATEGORIES` under its category. The current type is always
 * listed, under Other when no category holds it, so an activity can always see
 * its own sport. `mode` only chooses the title: `recording` before or during a
 * recording, `review` (default) for a completed or manual activity.
 */

export interface ActivityTypeSheetInput {
  selectedType: ActivityType;
  mode?: 'review' | 'recording';
}

type SectionKey = 'recent' | keyof typeof ACTIVITY_CATEGORIES;

interface TypeSection {
  key: SectionKey;
  data: ActivityType[];
}

/** The picker's sections, recent first when there are any, each type once per section. */
function activityTypeSections(
  selectedType: ActivityType | undefined,
  recent: readonly ActivityType[]
): TypeSection[] {
  const sections: TypeSection[] = [];
  if (recent.length > 0) sections.push({ key: 'recent', data: [...recent] });
  const listed = new Set<string>();
  for (const [key, types] of Object.entries(ACTIVITY_CATEGORIES)) {
    types.forEach((type) => listed.add(type));
    sections.push({ key: key as SectionKey, data: [...types] as ActivityType[] });
  }
  if (selectedType && !listed.has(selectedType)) {
    sections.find((section) => section.key === 'other')?.data.push(selectedType);
  }
  return sections;
}

function ActivityTypeSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { input, resolve } = useSheetRequest<ActivityTypeSheetInput, ActivityType>();
  const recent = useRecordingPreferences((state) => state.recentActivityTypes);
  const selectedType = input?.selectedType;
  const isRecording = input?.mode === 'recording';
  const sections = useMemo(
    () => activityTypeSections(selectedType, recent),
    [selectedType, recent]
  );
  // The list is bounded at about sixty rows, so it draws them all at once rather than letting
  // a row past the first screen, the selected one included, wait for a scroll to exist. A
  // section list counts a header and a footer per section beside its rows.
  const rowCount = sections.reduce((count, section) => count + section.data.length + 2, 0);

  const surface = isDark ? darkColors.surface : colors.surface;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const border = isDark ? darkColors.border : colors.border;

  const titleKey = isRecording ? 'recording.changeType' : 'recording.activityType';
  const titleFallback = isRecording ? 'Change Activity Type' : 'Activity Type';

  return (
    <View style={[styles.sheet, { backgroundColor: surface }]}>
      <SheetHeader
        title={t(titleKey, titleFallback)}
        onCancel={() => tapBack()}
        cancelTestID="activity-type-cancel"
        style={!isRecording && [styles.headerBordered, isDark && styles.headerBorderedDark]}
      />
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item}-${index}`}
        style={styles.list}
        stickySectionHeadersEnabled={false}
        initialNumToRender={rowCount}
        renderSectionHeader={({ section }) => (
          <Text
            testID={`activity-type-section-${section.key}`}
            style={[styles.sectionHeader, { color: textSecondary, backgroundColor: surface }]}
          >
            {section.key === 'recent'
              ? t('recording.recentTypes')
              : t(`recording.categories.${section.key}`)}
          </Text>
        )}
        renderItem={({ item, section }) => {
          const isSelected = item === selectedType;
          const rowKind = section.key === 'recent' ? 'recent' : 'option';
          return (
            <Pressable
              testID={`activity-type-${rowKind}-${item}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              style={pressable([
                styles.row,
                { borderBottomColor: border },
                isSelected && styles.rowSelected,
              ])}
              onPress={() => resolve(item)}
              android_ripple={pressRipple}
            >
              <MaterialCommunityIcons
                name={getActivityIcon(item)}
                size={22}
                color={getActivityInk(item, isDark)}
                style={styles.icon}
              />
              <Text style={[styles.label, { color: textPrimary }]}>
                {t(`activityTypes.${item}`, item)}
              </Text>
              {isSelected ? (
                <MaterialCommunityIcons name="check" size={20} color={brand.teal} />
              ) : null}
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
  sectionHeader: {
    ...typography.sectionHeader,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: layout.minTapTarget,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowSelected: {
    backgroundColor: colorWithOpacity(brand.teal, 0.08),
  },
  icon: {
    width: 28,
    textAlign: 'center',
  },
  label: {
    ...typography.body,
    flex: 1,
  },
});
