import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useMetricSystem, useTheme } from '@/shared/app';
import { goBack, navigateTo } from '@/shared/app/navigation';
import { detailHref } from '@/shared/app/MapSheetCards';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import {
  composeAccessibilityLabel,
  IconButton,
  Row,
  SegmentedSwitch,
  SheetHeader,
  sheetScrollProps,
  type SegmentedSwitchOption,
} from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { NameText } from '@/shared/ui/NameText';
import { FitText } from '@/shared/ui/FitText';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { sportMarkColour } from '@/shared/activity/sportCategories';
import { formatDistance, formatDuration, formatEpochDayUtc } from '@/shared/format/format';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { toActivityType } from '@/types';
import { FfiUnderPointKind } from 'veloqrs';
import type { FfiActivitiesUnderPoint, FfiUnderPointGroup } from 'veloqrs';

/**
 * The list a tap on the heatmap opens, a sheet route opened with `openSheet` and
 * answered with the id of the activity chosen. Choosing a group does not answer
 * it: the group is handed to `onGroup` so the map draws its traces behind the
 * sheet, and `null` asks for none.
 *
 * A segment row above the list narrows it to the routes, the sections or the
 * activities alone. The narrowing is the sheet's own choice and is not kept
 * past it.
 */

export interface UnderPointInput {
  total: FfiActivitiesUnderPoint['total'];
  /** The most traces the map draws for one group. */
  traceCap: FfiActivitiesUnderPoint['traceCap'];
  groups: FfiUnderPointGroup[];
  /** Every listed activity once, newest first, as the engine orders them. */
  activities: FfiActivitiesUnderPoint['activities'];
  onGroup: (group: FfiUnderPointGroup | null) => void;
}

/** The rows the list shows: every group, only the routes, only the sections, or the activities alone. */
type KindFilter = 'all' | 'routes' | 'sections' | 'activities';

/** A group's identity in the list: its route or section, or the group of activities in no route. */
function groupKey(group: FfiUnderPointGroup): string {
  if (group.id === undefined) return 'none';
  return `${group.kind === FfiUnderPointKind.Section ? 'section' : 'route'}-${group.id}`;
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
  const [filter, setFilter] = useState<KindFilter>('all');

  const routeCount = groups.filter(
    (candidate) => candidate.kind === FfiUnderPointKind.Route
  ).length;
  const sectionCount = groups.filter(
    (candidate) => candidate.kind === FfiUnderPointKind.Section
  ).length;
  const looseCount = groups.filter(
    (candidate) => candidate.kind === FfiUnderPointKind.NoRoute
  ).length;
  // A row narrows nothing when the tap holds one kind of group, so it is drawn when two are present.
  const kindsPresent = [routeCount, sectionCount, looseCount].filter((count) => count > 0).length;
  const showFilter = kindsPresent >= 2;
  const total = input?.total ?? 0;
  const filterOptions: SegmentedSwitchOption<KindFilter>[] = [
    { value: 'all', label: t('maps.underPointFilterAll'), count: total },
    ...(routeCount > 0
      ? [{ value: 'routes' as const, label: t('maps.layerRoutes'), count: routeCount }]
      : []),
    ...(sectionCount > 0
      ? [{ value: 'sections' as const, label: t('maps.layerSections'), count: sectionCount }]
      : []),
    { value: 'activities', label: t('maps.layerActivities'), count: total },
  ];
  const shownGroups = groups.filter((candidate) => {
    if (filter === 'routes') return candidate.kind === FfiUnderPointKind.Route;
    if (filter === 'sections') return candidate.kind === FfiUnderPointKind.Section;
    return filter === 'all';
  });
  // A filter that hides the chosen group keeps its traces drawn, and lists none of its activities.
  const chosenShown = group !== null && shownGroups.includes(group);
  const listed =
    filter === 'activities' ? (input?.activities ?? []) : chosenShown ? group.activities : [];

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
    if (candidate.kind === FfiUnderPointKind.Section) return t('sectionHistory.pairUnnamed');
    if (candidate.number !== undefined) {
      return t('maps.underPointRoute', { number: candidate.number });
    }
    return t('maps.underPointNoRoute');
  };

  /** The page a route or section group opens, none for the activities in no route. */
  const openPage = (candidate: FfiUnderPointGroup) => {
    if (candidate.id === undefined) return;
    const kind = candidate.kind === FfiUnderPointKind.Section ? 'section' : 'route';
    onGroup?.(null);
    goBack();
    navigateTo(detailHref({ kind, id: candidate.id }));
  };

  /** A group's length, passes, best time and last date, the parts it has. */
  const groupDetails = (candidate: FfiUnderPointGroup): string[] => {
    if (candidate.id === undefined) return [];
    const passes =
      candidate.kind === FfiUnderPointKind.Section
        ? t('sections.traversalsCount', { count: candidate.passes })
        : t('routes.activitiesCount', { count: candidate.passes });
    return [
      candidate.distanceM > 0 ? formatDistance(candidate.distanceM, isMetric) : null,
      passes,
      candidate.kind === FfiUnderPointKind.Route && candidate.bestTime !== undefined
        ? t('routes.prTime', { time: formatDuration(candidate.bestTime) })
        : null,
      candidate.lastDate !== undefined ? formatEpochDayUtc(candidate.lastDate) : null,
    ].filter((part): part is string => part !== null);
  };

  const overCap = chosenShown && input !== undefined && group.count > input.traceCap;

  return (
    <View style={styles.sheet} testID="under-point">
      <SheetHeader
        title={t('maps.activitiesCount', { count: input?.total ?? 0 })}
        onCancel={() => goBack()}
        cancelTestID="under-point-cancel"
      />
      {showFilter ? (
        <SegmentedSwitch<KindFilter>
          value={filter}
          options={filterOptions}
          onChange={setFilter}
          testID="under-point-filter"
          style={styles.filter}
        />
      ) : null}
      <ScrollView {...sheetScrollProps}>
        {shownGroups.map((candidate) => {
          const count = t('maps.underPointCount', { count: candidate.count });
          const details = [...groupDetails(candidate), count];
          const selected = groupKey(candidate) === chosen;
          const page =
            candidate.id === undefined
              ? null
              : t(
                  candidate.kind === FfiUnderPointKind.Section
                    ? 'maps.underPointOpenSection'
                    : 'maps.underPointOpenRoute',
                  { name: label(candidate) }
                );
          const sport = candidate.sportTypes[0]
            ? toActivityType(candidate.sportTypes[0])
            : undefined;
          return (
            <Row
              key={groupKey(candidate)}
              testID={`under-point-group-${groupKey(candidate)}`}
              behaviour="act"
              onPress={() => choose(candidate)}
              accessibilityLabel={composeAccessibilityLabel(label(candidate), ...details)}
              selected={selected}
              accessory={
                page ? (
                  <IconButton
                    compact
                    variant="secondary"
                    accessibilityLabel={page}
                    onPress={() => openPage(candidate)}
                    testID={`under-point-open-${groupKey(candidate)}`}
                  >
                    <IconButton.Glyph name="arrow-right" size={iconSize.sm} />
                  </IconButton>
                ) : undefined
              }
            >
              {sport ? (
                <Icon
                  name={getActivityIcon(sport)}
                  size={iconSize.lg}
                  color={sportMarkColour(sport, isDark)}
                />
              ) : null}
              <View style={styles.details}>
                <NameText style={[styles.name, { color: textPrimary }]}>
                  {label(candidate)}
                </NameText>
                <FitText style={[styles.caption, { color: textSecondary }]}>
                  {details.join(' · ')}
                </FitText>
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
        {listed.map((activity) => {
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
                name={getActivityIcon(toActivityType(activity.sportType))}
                size={iconSize.lg}
                color={sportMarkColour(toActivityType(activity.sportType), isDark)}
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
  filter: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  details: { flex: 1 },
  name: { ...typography.bodySmallBold },
  caption: { ...typography.caption, marginTop: spacing.xxs },
  drawn: { ...typography.caption, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
