import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useMetricSystem } from '@/shared/app/useMetricSystem';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { composeAccessibilityLabel, Row, SheetHeader, sheetScrollProps } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { goBack } from '@/shared/app/navigation';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { sportMarkColour } from '@/shared/activity/sportCategories';
import {
  formatClockTime,
  formatDistance,
  formatDuration,
  formatLoad,
} from '@/shared/format/format';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import type { ActivityType } from '@/types';
import { NameText } from '@/shared/ui/NameText';
import { FitText } from '@/shared/ui/FitText';

/** The picker for a day with several activities, a sheet route answered with the chosen activity id. */

export interface DayActivitiesInput {
  activities: {
    id: string;
    name: string;
    type: ActivityType;
    load: number;
    startDateLocal: string;
    /** Seconds. */
    movingTime: number;
    /** Metres, zero for an activity that covers no ground. */
    distance: number;
  }[];
}

function DayActivitiesSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { input, resolve } = useSheetRequest<DayActivitiesInput, string>();

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title={t('fitness.selectActivity')}
        onCancel={() => goBack()}
        cancelTestID="day-activities-cancel"
      />
      <ScrollView contentContainerStyle={styles.list} {...sheetScrollProps}>
        {(input?.activities ?? []).map((activity) => {
          // The start time leads because it is what tells two rides of one name apart.
          const details = [
            formatClockTime(activity.startDateLocal),
            formatDuration(activity.movingTime),
            activity.distance > 0 ? formatDistance(activity.distance, isMetric) : null,
            activity.load > 0 ? `${t('metrics.trainingLoad')} ${formatLoad(activity.load)}` : null,
          ].filter((part): part is string => part !== null);
          return (
            <Row
              key={activity.id}
              testID={`day-activity-${activity.id}`}
              behaviour="navigate"
              accessibilityLabel={composeAccessibilityLabel(activity.name, ...details)}
              onPress={() => resolve(activity.id)}
            >
              <Icon
                name={getActivityIcon(activity.type)}
                size={iconSize.lg}
                color={sportMarkColour(activity.type, isDark)}
              />
              <View style={styles.info}>
                <NameText style={[styles.name, { color: textPrimary }]}>{activity.name}</NameText>
                <FitText style={[styles.details, { color: textSecondary }]}>
                  {details.join(' · ')}
                </FitText>
              </View>
            </Row>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default withScreenBoundary(DayActivitiesSheetContent, 'Day Activities');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  list: {
    paddingBottom: layout.screenPadding,
  },
  info: {
    flex: 1,
  },
  name: {
    ...typography.bodySmallBold,
  },
  details: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
});
