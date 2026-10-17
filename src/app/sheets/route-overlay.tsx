import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View, StyleSheet, FlatList } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme, useMetricSystem } from '@/shared/app';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { formatDistance } from '@/shared/format/format';
import { ABSENT, absentLabel } from '@/shared/format/absent';
// The light entry keeps the routes map components out of the recording module
// graph.
import { useRouteGroups } from '@/features/routes/light';
import { useRecordingStore } from '@/features/recording';
import { brand, colors, darkColors, iconSize, layout, spacing, typography, stroke } from '@/theme';
import type { ActivityType } from '@/types';
import { engineErrorKey } from '@/shared/native/engineError';
import { EmptyState, pressable, pressRipple, SheetHeader } from '@/shared/ui';
import { tapBack } from '@/shared/app/navigation';

/**
 * The saved-route picker for the live recording map, a sheet route opened with `openSheet` and
 * answered with a route group id, or null for "no route". Lists route groups for the current
 * sport, ordered by their overlap with the track recorded so far.
 */

export interface RouteOverlaySheetInput {
  activityType: ActivityType;
  selectedRouteId: string | null;
}

const NO_OVERLAPS: Record<string, number> = {};

function RouteOverlaySheetContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isMetric = useMetricSystem();
  const { input, resolve } = useSheetRequest<RouteOverlaySheetInput, string | null>();
  const selectedRouteId = input?.selectedRouteId ?? null;
  const {
    groups,
    error: groupsError,
    measureLiveOverlap,
  } = useRouteGroups({
    ...(input ? { type: input.activityType } : {}),
    minActivities: 2,
    sortBy: 'count',
  });
  const distanceBucket = useRecordingStore((state) =>
    Math.floor((state.streams.distance.at(-1) ?? 0) / 300)
  );
  const [result, setResult] = useState<{ bucket: number; scores: Record<string, number> }>({
    bucket: -1,
    scores: {},
  });
  const requestId = useRef(0);
  const groupIds = useMemo(() => groups.map((group) => group.id), [groups]);

  useEffect(() => {
    const id = ++requestId.current;
    if (distanceBucket > 0 && groupIds.length > 0) {
      const coordinates = useRecordingStore.getState().streams.latlng.flat();
      measureLiveOverlap(groupIds, coordinates).then(
        (results) => {
          if (id === requestId.current) {
            setResult({
              bucket: distanceBucket,
              scores: Object.fromEntries(results.map((row) => [row.groupId, row.percentage])),
            });
          }
        },
        () => {
          if (id === requestId.current) setResult({ bucket: distanceBucket, scores: {} });
        }
      );
    }
    return () => {
      requestId.current += 1;
    };
  }, [distanceBucket, groupIds, measureLiveOverlap]);

  const overlaps = result.bucket === distanceBucket ? result.scores : NO_OVERLAPS;

  const sortedGroups = useMemo(() => {
    if (distanceBucket === 0 || Object.keys(overlaps).length === 0) return groups;
    return [...groups].sort(
      (a, b) => (overlaps[b.id] ?? 0) - (overlaps[a.id] ?? 0) || b.activityCount - a.activityCount
    );
  }, [groups, distanceBucket, overlaps]);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const accentText = isDark ? darkColors.linkTeal : colors.linkTeal;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;

  return (
    <View style={[styles.sheet, { backgroundColor: surface }]}>
      <SheetHeader
        title={t('recording.routeOverlay.title', 'Follow a route')}
        onCancel={() => tapBack()}
        cancelTestID="route-overlay-cancel"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: selectedRouteId == null }}
        testID="route-overlay-none"
        style={pressable([styles.row, { borderBottomColor: border }])}
        android_ripple={pressRipple}
        onPress={() => resolve(null)}
      >
        <MaterialCommunityIcons
          name="close-circle-outline"
          size={iconSize.md}
          color={selectedRouteId == null ? brand.teal : textSecondary}
        />
        <Text
          style={[styles.rowTitle, { color: selectedRouteId == null ? accentText : textPrimary }]}
        >
          {t('recording.routeOverlay.none', 'No route')}
        </Text>
      </Pressable>

      {groupsError !== undefined ? (
        <Text testID="route-groups-failure" style={[styles.failureLine, { color: textSecondary }]}>
          {t(engineErrorKey(groupsError, 'engine.failure.database'))}
        </Text>
      ) : groups.length === 0 ? (
        <EmptyState
          variant="inline"
          title={t('recording.routeOverlay.empty', 'No saved routes for this sport yet.')}
        />
      ) : (
        <FlatList
          testID="route-overlay-list"
          data={sortedGroups}
          keyExtractor={(g) => g.id}
          style={styles.list}
          renderItem={({ item }) => {
            const isSelected = item.id === selectedRouteId;
            // Only a measured overlap is a figure; before the first measurement, after a
            // failed one, or for a route the measurement left out, there is none to print.
            const overlap = overlaps[item.id];
            const meta = [
              ...(item.distance != null ? [formatDistance(item.distance, isMetric)] : []),
              t('recording.routeOverlay.activities', { count: item.activityCount }),
              overlap != null && Number.isFinite(overlap)
                ? `${Math.round(overlap)}% ${t('sections.overlapLabel')}`
                : ABSENT,
            ].join(' · ');
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                testID={`route-overlay-option-${item.id}`}
                style={pressable([styles.row, { borderBottomColor: border }])}
                android_ripple={pressRipple}
                onPress={() => resolve(item.id)}
              >
                <MaterialCommunityIcons
                  name="map-marker-path"
                  size={iconSize.md}
                  color={isSelected ? brand.teal : textSecondary}
                />
                <View style={styles.rowBody}>
                  <Text
                    style={[styles.rowTitle, { color: isSelected ? accentText : textPrimary }]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text
                    style={[styles.rowMeta, { color: textSecondary }]}
                    accessibilityLabel={absentLabel(meta, t)}
                  >
                    {meta}
                  </Text>
                </View>
                {isSelected ? (
                  <MaterialCommunityIcons name="check" size={iconSize.md} color={brand.teal} />
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

export default withScreenBoundary(RouteOverlaySheetContent, 'Route overlay');

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    paddingBottom: spacing.lg,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: stroke.hairline,
    minHeight: layout.minTapTarget,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: typography.caption.fontSize,
    marginTop: spacing.xxs,
  },
  failureLine: {
    ...typography.bodySmall,
    fontStyle: 'italic',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
});
