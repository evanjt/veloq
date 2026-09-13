/**
 * Route grouping preview: see what a grouping setting would do to the routes
 * you already have, before it is applied.
 *
 * The two knobs are pure local state and nothing is applied from here. Moving
 * one regroups the whole library in the engine, off the calling thread, and
 * repaints the lines the routes screen already draws: the most-ridden group
 * opaque, a pair this setting would merge in the merge colour, a route whose
 * ride falls out of every group faded.
 *
 * The column does not scroll. Tuning a knob you cannot see the map for defeats
 * the screen, so the map and the two rows share one fixed column.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, InteractionManager, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Straight from the module, not the app barrel: the barrel reaches the
// in-app purchase binding, which a screen that only needs the theme should not.
import { useTheme } from '@/shared/app/useTheme';
import { ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { getEngine } from '@/shared/native/engine';
import { GroupSort, SectionSort } from 'veloqrs';
import {
  GROUPING_DEFAULTS,
  GroupingParamPanel,
  GroupingPreviewMap,
  paintPreview,
  useRouteGroupingPreview,
  type GroupingParams,
  type GroupingRoute,
} from '@/features/routes';

/**
 * How many of today's routes are drawn. They arrive sorted by ride count
 * descending, so this is the athlete's most-ridden ground rather than an
 * arbitrary slice, and it bounds one blocking read at mount.
 */
const ROUTES_DRAWN = 60;

interface RouteRow extends GroupingRoute {
  representativeId: string;
}

function readRoutes(): RouteRow[] {
  const engine = getEngine();
  if (!engine?.getRoutesScreenData) return [];
  const data = engine.getRoutesScreenData({
    groupLimit: ROUTES_DRAWN,
    groupOffset: 0,
    sectionLimit: 0,
    sectionOffset: 0,
    minGroupActivityCount: 2,
    groupSort: GroupSort.Activities,
    groupSearch: '',
    sectionSort: SectionSort.Visits,
    sectionSearch: '',
    sectionFilters: {
      hideCustom: false,
      hideAuto: false,
      hideDisabled: false,
      hideUnaccepted: false,
    },
    sectionSportType: undefined,
    userLat: Number.NaN,
    userLng: Number.NaN,
  });
  return (data?.groups ?? []).map((g) => ({
    groupId: g.groupId,
    representativeId: g.representativeId,
    encodedPolyline: g.encodedPolyline,
    bounds: g.bounds,
  }));
}

export default function RouteGroupingPreviewScreen() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const bg = isDark ? darkColors.background : colors.background;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  const [params, setParams] = useState<GroupingParams>(GROUPING_DEFAULTS);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const client = useMemo(() => getEngine(), []);
  const { status, groups, refused, request } = useRouteGroupingPreview(client);

  // One blocking read, once. It is the routes screen's own read and costs a
  // few hundred milliseconds at library size, so it waits for the push
  // transition rather than stalling the frame it arrives on. The lines do not
  // change while the screen is open: what changes is which of them share a
  // group.
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => setRoutes(readRoutes()));
    return () => handle.cancel();
  }, []);

  // The knobs open on the default, so the first paint is the answer for it
  // rather than an empty map waiting for a drag.
  useEffect(() => {
    // An effect must return a cleanup or nothing. `request` answers with
    // whatever it answers with, and returning that makes React call it.
    request(params);
  }, [params, request]);

  const diff = useMemo(
    () => (groups === null ? null : paintPreview(routes, groups)),
    [routes, groups]
  );

  const onChange = useCallback((next: GroupingParams) => setParams(next), []);

  // A run that timed out has been cancelled and nothing is coming, so the row
  // has to say so: without its own branch the text stayed on "grouping" with
  // the spinner gone, which reads as a run that will never end. A cancel is a
  // knob that moved and the next run is already asked for, so that one keeps
  // the working text.
  const statusText = refused
    ? t('settings.groupingNothingToGroup')
    : status === 'error'
      ? t('settings.groupingFailed')
      : status === 'running' || diff === null
        ? t('settings.groupingRunning')
        : t('settings.groupingSummary', { count: diff.previewGroupCount });

  return (
    <ScreenSafeAreaView
      hasNativeHeader
      testID="route-grouping-preview-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <View style={[styles.column, { paddingBottom: insets.bottom + TAB_BAR_SAFE_PADDING }]}>
        <View style={styles.mapWrap}>
          <GroupingPreviewMap
            routes={routes}
            painted={diff?.routes ?? []}
            mapStyle={isDark ? 'dark' : 'light'}
          />
        </View>

        <View style={styles.statusRow}>
          {status === 'running' && <ActivityIndicator size="small" color={textSecondary} />}
          <Text
            style={[
              styles.statusText,
              { color: status === 'running' ? textSecondary : textPrimary },
            ]}
            testID="grouping-status"
          >
            {statusText}
          </Text>
        </View>

        {diff !== null && diff.droppedCount > 0 && (
          <Text style={[styles.note, { color: textSecondary }]} testID="grouping-dropped">
            {t('settings.groupingDropped', { count: diff.droppedCount })}
          </Text>
        )}

        <GroupingParamPanel params={params} onChange={onChange} />
      </View>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  column: { flex: 1, padding: spacing.md, gap: spacing.sm },
  mapWrap: { flex: 1, borderRadius: layout.borderRadius, overflow: 'hidden' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { ...typography.bodyMedium },
  note: { ...typography.caption },
});
