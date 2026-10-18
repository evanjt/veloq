import React, { useMemo } from 'react';
import { View, SectionList, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import {
  colors,
  colorWithOpacity,
  darkColors,
  iconSize,
  ink,
  layout,
  spacing,
  typography,
  stroke,
  themePalette,
  opacity,
} from '@/theme';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { useRecordingPreferences } from '@/features/recording';
import {
  SPORT_FAMILY_LABELS,
  SPORT_FAMILY_MEMBERS,
  type SportFamily,
  sportMarkColour,
} from '@/shared/activity/sportCategories';
import type { ActivityType } from '@/types';
import { SheetHeader, PressTarget } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { goBack } from '@/shared/app/navigation';

/**
 * The activity type picker, a sheet route opened with `openSheet` and answered
 * with the chosen `ActivityType`.
 *
 * Every caller gets the same list: the athlete's recent sports first, then every
 * type under its sport family, as the engine files it. The current type is always
 * listed, under Other when no family holds it, so an activity can always see
 * its own sport. `mode` only chooses the title: `recording` before or during a
 * recording, `review` (default) for a completed or manual activity.
 */

export interface ActivityTypeSheetInput {
  selectedType: ActivityType;
  mode?: 'review' | 'recording';
}

type SectionKey = 'recent' | SportFamily;

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
  for (const [key, types] of Object.entries(SPORT_FAMILY_MEMBERS)) {
    types.forEach((type) => listed.add(type));
    sections.push({ key: key as SportFamily, data: [...types] as ActivityType[] });
  }
  if (selectedType && !listed.has(selectedType)) {
    sections.find((section) => section.key === 'Other')?.data.push(selectedType);
  }
  return sections;
}

function ActivityTypeSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
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

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const border = isDark ? darkColors.border : colors.border;

  const titleKey = isRecording ? 'recording.changeType' : 'recording.activityType';
  const titleFallback = isRecording ? 'Change activity type' : 'Activity type';

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title={t(titleKey, titleFallback)}
        onCancel={() => goBack()}
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
            style={[styles.sectionHeader, { color: textSecondary }]}
          >
            {section.key === 'recent'
              ? t('recording.recentTypes')
              : t(SPORT_FAMILY_LABELS[section.key])}
          </Text>
        )}
        renderItem={({ item, section }) => {
          const isSelected = item === selectedType;
          const rowKind = section.key === 'recent' ? 'recent' : 'option';
          return (
            <PressTarget
              testID={`activity-type-${rowKind}-${item}`}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              style={[
                styles.row,
                { borderBottomColor: border },
                isSelected && {
                  backgroundColor: colorWithOpacity(palette.actionPrimary, opacity.tint1),
                },
              ]}
              onPress={() => resolve(item)}
            >
              <Icon
                name={getActivityIcon(item)}
                size={iconSize.lg}
                color={sportMarkColour(item, isDark)}
                style={styles.icon}
              />
              <Text style={[styles.label, { color: textPrimary }]}>
                {t(`activityTypes.${item}`, item)}
              </Text>
              {isSelected ? (
                <Icon name="check" size={iconSize.md} color={palette.actionPrimary} />
              ) : null}
            </PressTarget>
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
    borderBottomWidth: stroke.hairline,
    borderBottomColor: colorWithOpacity(ink.black, opacity.tint3),
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
    borderBottomWidth: stroke.hairline,
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
