/**
 * Route grouping preview: see what a grouping setting would do to the routes
 * you already have, before it is applied.
 *
 * The two knobs are local state until Keep, which asks first and then writes
 * both values and starts the regroup. Discard writes nothing. Moving
 * one regroups the whole library in the engine, off the calling thread, and
 * repaints the lines the routes screen already draws: the most-ridden group
 * opaque, a pair this setting would merge in the merge colour, a route whose
 * ride falls out of every group faded.
 *
 * The column does not scroll. Tuning a knob you cannot see the map for defeats
 * the screen, so the map and the two rows share one fixed column.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAfterNavigationTransition } from '@/shared/async/useAfterNavigationTransition';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Straight from the module, not the app barrel: the barrel reaches the
// in-app purchase binding, which a screen that only needs the theme should not.
import { useTheme } from '@/shared/app/useTheme';
import { Button, ScreenSafeAreaView, TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { getEngine } from '@/shared/native/engine';
import { GroupSort, SectionSort, hasStarted } from 'veloqrs';
import {
  groupingParamsOf,
  GroupingParamPanel,
  GroupingPreviewMap,
  paintPreview,
  rescanRefusalKey,
  useRouteGroupingPreview,
  useSectionRescan,
  type GroupingParams,
  type GroupingRoute,
} from '@/features/routes';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

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
  let data: ReturnType<typeof engine.getRoutesScreenData>;
  try {
    data = engine.getRoutesScreenData({
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
      userLat: Number.NaN,
      userLng: Number.NaN,
    });
  } catch {
    return [];
  }
  return (data?.groups ?? []).map((g) => ({
    groupId: g.groupId,
    representativeId: g.representativeId,
    encodedPolyline: g.encodedPolyline,
    bounds: g.bounds,
  }));
}

function RouteGroupingPreviewScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const bg = isDark ? darkColors.background : colors.background;
  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  const client = useMemo(() => getEngine(), []);
  // Open on the strictness the grouper is running at, not on the default: the
  // panel used to claim a value nobody had applied.
  const [params, setParams] = useState<GroupingParams>(() =>
    groupingParamsOf(client?.getMatchStrictness())
  );
  const [applied] = useState<GroupingParams>(params);
  const { rescan } = useSectionRescan();
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const { status, groups, refused, request } = useRouteGroupingPreview(client);

  // The routes screen's blocking read waits for the push transition.
  // The lines stay fixed while grouping changes on this screen.
  useAfterNavigationTransition(useCallback(() => setRoutes(readRoutes()), []));

  // The knobs open on what is applied, so the first paint is the answer for
  // that rather than an empty map waiting for a drag.
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

  // Offered only once a knob differs from what the grouper runs at, so a Keep
  // never rewrites the value already held.
  const changed =
    params.minMatchPercentage !== applied.minMatchPercentage ||
    params.endpointThreshold !== applied.endpointThreshold;

  const handleKeep = useCallback(() => {
    Alert.alert(t('settings.groupingKeepTitle'), t('settings.groupingKeepWarning'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.confirm'),
        onPress: () => {
          if (!client) return;
          client.setMatchStrictness(params.minMatchPercentage, params.endpointThreshold);
          // Through the rescan hook so the athlete sees the regroup run. The
          // setting is already written when the engine refuses, so stay and
          // say why rather than report a change that has not run.
          const outcome = rescan();
          if (!hasStarted(outcome)) {
            const reasonKey = rescanRefusalKey(outcome);
            const saved = t('settings.previewKeepRefused');
            Alert.alert(
              t('settings.previewKeepRefusedTitle'),
              reasonKey ? `${saved} ${t(reasonKey)}` : saved
            );
            return;
          }
          router.back();
        },
      },
    ]);
  }, [t, client, params, rescan]);

  const handleDiscard = useCallback(() => router.back(), []);

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
            mergedCount={diff?.mergedCount ?? 0}
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

        {changed && (
          <View style={styles.actionRow}>
            <Button
              label={t('settings.previewDiscard')}
              variant="secondary"
              onPress={handleDiscard}
              testID="grouping-discard-button"
              style={styles.action}
            />
            <Button
              label={t('settings.previewKeep')}
              onPress={handleKeep}
              testID="grouping-keep-button"
              style={styles.action}
            />
          </View>
        )}
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
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});

export default withScreenBoundary(RouteGroupingPreviewScreenContent, 'RouteGroupingPreview');
