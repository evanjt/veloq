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
 * It opens on a riding area, the same ranked areas the section preview offers,
 * and draws the routes nearest it. The grouping still runs over the whole
 * library; the area decides only which of its routes are drawn and framed, so
 * an athlete with rides on several continents never opens on the world.
 *
 * The column does not scroll. Tuning a knob you cannot see the map for defeats
 * the screen, so the map and the two rows share one fixed column.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAfterNavigationTransition } from '@/shared/async/useAfterNavigationTransition';
// Straight from the module, not the app barrel: the barrel reaches the
// in-app purchase binding, which a screen that only needs the theme should not.
import { useTheme } from '@/shared/app/useTheme';
import { Button, ErrorState, ScreenSafeAreaView, useBottomClearance } from '@/shared/ui';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { getEngine } from '@/shared/native/engine';
import { attemptEngineRead } from '@/shared/native/engineError';
import { GroupSort, SectionSort, hasStarted, type PreviewCentre } from 'veloqrs';
import {
  groupingParamsOf,
  GroupingParamPanel,
  GroupingPreviewMap,
  PreviewCentrePicker,
  paintPreview,
  rescanRefusalKey,
  useRouteGroupingPreview,
  useSectionRescan,
  usePreviewCentres,
  type GroupingParams,
  type GroupingRoute,
} from '@/features/routes';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { goBack, tapBack } from '@/shared/app/navigation';
import { confirmAction, inform } from '@/shared/ui/dialog';

/**
 * How many of today's routes are drawn. They arrive nearest the selected area
 * first, or by ride count when the library has no area yet, and the cap bounds
 * one blocking read per area.
 */
const ROUTES_DRAWN = 60;

interface RouteRow extends GroupingRoute {
  representativeId: string;
}

/** The routes drawn, or what the read threw, so a failure is not an empty library. */
interface RoutesRead {
  routes: RouteRow[];
  error: unknown;
}

const NO_ROUTES: RoutesRead = { routes: [], error: undefined };

function readRoutes(centre: PreviewCentre | null): RoutesRead {
  const engine = getEngine();
  if (!engine?.getRoutesScreenData) return NO_ROUTES;
  const read = attemptEngineRead(() =>
    engine.getRoutesScreenData({
      groupLimit: ROUTES_DRAWN,
      groupOffset: 0,
      sectionLimit: 0,
      sectionOffset: 0,
      minGroupActivityCount: 2,
      groupSort: centre ? GroupSort.Nearby : GroupSort.Activities,
      groupSearch: '',
      sectionSort: SectionSort.Visits,
      sectionSearch: '',
      sectionFilters: {
        hideCustom: false,
        hideAuto: false,
        hideDisabled: false,
        hideUnaccepted: false,
      },
      userLat: centre?.lat ?? Number.NaN,
      userLng: centre?.lng ?? Number.NaN,
    })
  );
  if (!read.ok) return { routes: [], error: read.error };
  return {
    routes: (read.value?.groups ?? []).map((g) => ({
      groupId: g.groupId,
      representativeId: g.representativeId,
      encodedPolyline: g.encodedPolyline,
      bounds: g.bounds,
    })),
    error: undefined,
  };
}

function RouteGroupingPreviewScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const bottomClearance = useBottomClearance({ insetTaken: true });
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
  const [routesRead, setRoutesRead] = useState<RoutesRead>(NO_ROUTES);
  const routes = routesRead.routes;
  const { status, groups, refused, request } = useRouteGroupingPreview(client);
  const { centres, labels, error: centresError, retry: retryCentres } = usePreviewCentres(client);
  const [centre, setCentre] = useState<PreviewCentre | null>(null);
  const selectedCentre = centre ?? centres[0] ?? null;

  // The routes screen's blocking read waits for the push transition.
  // The lines stay fixed while grouping changes on this screen, and are read
  // again only when another area is chosen. The mount read takes the area
  // through a ref so a chip tap does not re-arm the transition wait.
  const centreRef = useRef(selectedCentre);
  useEffect(() => {
    centreRef.current = selectedCentre;
  }, [selectedCentre]);
  const rereadRoutes = useCallback(() => setRoutesRead(readRoutes(centreRef.current)), []);
  useAfterNavigationTransition(rereadRoutes);

  const handleSelectCentre = useCallback(
    (next: PreviewCentre) => {
      if (next.binKey === selectedCentre?.binKey) return;
      setCentre(next);
      setRoutesRead(readRoutes(next));
    },
    [selectedCentre]
  );

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
  // never rewrites the value already held, and never while the routes read has
  // failed, since the preview then judged the setting against nothing.
  const routesFailed = routesRead.error !== undefined;
  const changed =
    params.minMatchPercentage !== applied.minMatchPercentage ||
    params.endpointThreshold !== applied.endpointThreshold;

  const handleKeep = useCallback(() => {
    confirmAction({
      title: t('settings.groupingKeepTitle'),
      message: t('settings.groupingKeepWarning'),
      confirmLabel: t('settings.previewKeep'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        if (!client) return;
        client.setMatchStrictness(params.minMatchPercentage, params.endpointThreshold);
        // Through the rescan hook so the athlete sees the regroup run. The
        // setting is already written when the engine refuses, so stay and
        // say why rather than report a change that has not run.
        const outcome = rescan();
        if (!hasStarted(outcome)) {
          const reasonKey = rescanRefusalKey(outcome);
          const saved = t('settings.previewKeepRefused');
          inform({
            title: t('settings.previewKeepRefusedTitle'),
            message: reasonKey
              ? t('common.sentencePair', { first: saved, second: t(reasonKey) })
              : saved,
          });
          return;
        }
        goBack();
      },
    });
  }, [t, client, params, rescan]);

  const handleDiscard = useCallback(() => tapBack(), []);

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
      <View style={[styles.column, { paddingBottom: bottomClearance }]}>
        <View style={styles.mapWrap}>
          <GroupingPreviewMap
            routes={routes}
            centre={selectedCentre}
            painted={diff?.routes ?? []}
            mergedCount={diff?.mergedCount ?? 0}
            mapStyle={isDark ? 'dark' : 'light'}
          />
        </View>

        {centresError !== undefined && (
          <ErrorState
            variant="inline"
            error={centresError}
            onRetry={retryCentres}
            testID="grouping-centres-failed"
          />
        )}

        {routesFailed ? (
          <ErrorState
            variant="inline"
            error={routesRead.error}
            onRetry={rereadRoutes}
            testID="grouping-routes-failed"
          />
        ) : null}

        {centres.length > 0 && (
          <View style={styles.pickerWrap}>
            <PreviewCentrePicker
              centres={centres}
              labels={labels}
              selectedBinKey={selectedCentre?.binKey ?? null}
              onSelect={handleSelectCentre}
            />
          </View>
        )}

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

        {changed && !routesFailed ? (
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
        ) : null}
      </View>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  column: { flex: 1, padding: spacing.md, gap: spacing.sm },
  mapWrap: { flex: 1, borderRadius: layout.borderRadius, overflow: 'hidden' },
  pickerWrap: { marginHorizontal: -spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { ...typography.bodyMedium },
  note: { ...typography.caption },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});

export default withScreenBoundary(RouteGroupingPreviewScreenContent, 'RouteGroupingPreview');
