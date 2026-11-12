import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useMetricSystem, useTheme } from '@/shared/app';
import { goBack } from '@/shared/app/navigation';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { composeAccessibilityLabel, Row, SheetHeader, sheetScrollProps } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { NameText } from '@/shared/ui/NameText';
import { FitText } from '@/shared/ui/FitText';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { sportMarkColour } from '@/shared/activity/sportCategories';
import { formatDistance, formatDuration, formatEpochDayUtc } from '@/shared/format/format';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import type { ActivityType } from '@/types';
import type { FfiActivitiesUnderPoint, FfiUnderPointGroup } from 'veloqrs';

/**
 * The list a tap on the heatmap opens, a sheet route opened with `openSheet` and
 * answered with the id of the activity chosen. Choosing a group does not answer
 * it: the group is handed to `onGroup` so the map draws its traces behind the
 * sheet, and `null` asks for none.
 */

export interface UnderPointInput {
  total: FfiActivitiesUnderPoint['total'];
  /** The most traces the map draws for one group. */
  traceCap: FfiActivitiesUnderPoint['traceCap'];
  groups: FfiUnderPointGroup[];
  onGroup: (group: FfiUnderPointGroup | null) => void;
}

/** A group's identity in the list: its route, or the group of activities in none. */
function groupKey(group: FfiUnderPointGroup): string {
  return group.routeId ?? 'none';
}

function UnderPointSheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { input, resolve } = useSheetRequest<UnderPointInput, string>();

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  const groups = input?.groups ?? [];
  // Everything under the tap fits under the cap, so the first group is drawn at once.
  const initial = input && input.total <= input.traceCap ? input.groups[0] : undefined;
  const [chosen, setChosen] = useState<string | null>(initial ? groupKey(initial) : null);
  const group = groups.find((candidate) => groupKey(candidate) === chosen) ?? null;

  const onGroup = input?.onGroup;
  useEffect(() => {
    if (initial) onGroup?.(initial);
  }, [initial, onGroup]);

  const choose = (next: FfiUnderPointGroup) => {
    setChosen(groupKey(next));
    onGroup?.(next);
  };

  const label = (candidate: FfiUnderPointGroup): string => {
    if (candidate.name) return candidate.name;
    if (candidate.number !== undefined) {
      return t('maps.underPointRoute', { number: candidate.number });
    }
    return t('maps.underPointNoRoute');
  };

  const overCap = group !== null && input !== undefined && group.count > input.traceCap;

  return (
    <View style={styles.sheet} testID="under-point">
      <SheetHeader
        title={t('maps.activitiesCount', { count: input?.total ?? 0 })}
        onCancel={() => goBack()}
        cancelTestID="under-point-cancel"
      />
      <ScrollView {...sheetScrollProps}>
        {groups.map((candidate) => {
          const count = t('maps.activitiesCount', { count: candidate.count });
          const selected = groupKey(candidate) === chosen;
          return (
            <Row
              key={groupKey(candidate)}
              testID={`under-point-group-${groupKey(candidate)}`}
              behaviour="act"
              onPress={() => choose(candidate)}
              accessibilityLabel={composeAccessibilityLabel(label(candidate), count)}
              selected={selected}
            >
              <View style={styles.details}>
                <NameText style={[styles.name, { color: textPrimary }]}>
                  {label(candidate)}
                </NameText>
                <Text style={[styles.caption, { color: textSecondary }]}>{count}</Text>
              </View>
              {selected ? <Icon name="check" size={iconSize.md} color={textPrimary} /> : null}
            </Row>
          );
        })}
        {overCap && input ? (
          <Text testID="under-point-drawn" style={[styles.drawn, { color: textSecondary }]}>
            {t('maps.underPointDrawn', { drawn: input.traceCap, total: group.count })}
          </Text>
        ) : null}
        {(group?.activities ?? []).map((activity) => {
          const details = [
            formatEpochDayUtc(activity.date),
            formatDuration(activity.duration),
            activity.distance > 0 ? formatDistance(activity.distance, isMetric) : null,
          ].filter((part): part is string => part !== null);
          return (
            <Row
              key={activity.id}
              testID={`under-point-activity-${activity.id}`}
              behaviour="navigate"
              accessibilityLabel={composeAccessibilityLabel(activity.name, ...details)}
              onPress={() => resolve(activity.id)}
            >
              <Icon
                name={getActivityIcon(activity.sportType as ActivityType)}
                size={iconSize.lg}
                color={sportMarkColour(activity.sportType as ActivityType, isDark)}
              />
              <View style={styles.details}>
                <NameText style={[styles.name, { color: textPrimary }]}>{activity.name}</NameText>
                <FitText style={[styles.caption, { color: textSecondary }]}>
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

export default withScreenBoundary(UnderPointSheetContent, 'Under point');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    paddingBottom: spacing.md,
  },
  details: { flex: 1 },
  name: { ...typography.bodySmallBold },
  caption: { ...typography.caption, marginTop: spacing.xxs },
  drawn: { ...typography.caption, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
