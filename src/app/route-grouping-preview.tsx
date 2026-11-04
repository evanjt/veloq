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
 * It opens on a riding area, the same ranked areas the section preview offers.
 * The grouping runs over the whole library and every route is read once; the
 * area decides which of them are drawn, framed and counted, so an athlete with
 * rides on several continents never opens on the world. A change that lands
 * only in other areas is said so, with a chip for each area it touches.
 *
 * The map fills the screen and the controls sit in the bottom sheet over it:
 * the summary and Keep and Discard always, the two sliders when it is open.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useAfterNavigationTransition } from '@/shared/async/useAfterNavigationTransition';
// Straight from the module, not the app barrel: the barrel reaches the
// in-app purchase binding, which a screen that only needs the theme should not.
import { useTheme } from '@/shared/app/useTheme';
import {
  ButtonRow,
  ErrorState,
  ScreenSafeAreaView,
  ToggleButton,
  useBottomClearance,
  Spinner,
} from '@/shared/ui';
import { colors, darkColors, spacing, typography } from '@/theme';
import { getEngine } from '@/shared/native/engine';
import { attemptEngineRead } from '@/shared/native/engineError';
import {
  GroupSort,
  SectionSort,
  hasStarted,
  type PreviewCentre,
  previewClient,
  routeGroupingPreview,
  routes,
} from 'veloqrs';
import {
  groupingParamsOf,
  GroupingParamPanel,
  GroupingPreviewMap,
  PreviewCentrePicker,
  PreviewSheet,
  paintPreview,
  scopeGroupingDiff,
  rescanRefusalKey,
  useRouteGroupingPreview,
  useSectionRescan,
  usePreviewCentres,
  type GroupingParams,
  type GroupingPreviewDiff,
  type GroupingRoute,
} from '@/features/routes';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { goBack } from '@/shared/app/navigation';
import { confirmAction, inform } from '@/shared/ui/dialog';

/**
 * The most routes one read returns. The preview judges every route against the
 * regrouped library, so the read is not narrowed to the area on screen.
 */
const ROUTES_READ = 5000;

interface RouteRow extends GroupingRoute {
  representativeId: string;
}

/** The routes drawn, or what the read threw, so a failure is not an empty library. */
interface RoutesRead {
  routes: RouteRow[];
  error: unknown;
}

const NO_ROUTES: RoutesRead = { routes: [], error: undefined };

const NO_DIFF: GroupingPreviewDiff = {
  routes: [],
  previewGroupCount: 0,
  droppedCount: 0,
  mergedCount: 0,
  splitCount: 0,
};

function readRoutes(): RoutesRead {
  const read = attemptEngineRead(() =>
    routes.getRoutesScreenData({
      groupLimit: ROUTES_READ,
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
  const bg = isDark ? darkColors.surfacePage : colors.surfacePage;
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
  const allRoutes = routesRead.routes;
  const { status, groups, spreads, refused, request } =
    useRouteGroupingPreview(routeGroupingPreview);
  const {
    centres,
    labels,
    error: centresError,
    retry: retryCentres,
  } = usePreviewCentres(previewClient);
  const [centre, setCentre] = useState<PreviewCentre | null>(null);
  const selectedCentre = centre ?? centres[0] ?? null;

  // The routes screen's blocking read waits for the push transition. Every
  // route is read once: choosing another area changes which of them are drawn
  // and counted, and reads nothing.
  const rereadRoutes = useCallback(() => setRoutesRead(readRoutes()), []);
  useAfterNavigationTransition(rereadRoutes);

  // The knobs open on what is applied, so the first paint is the answer for
  // that rather than an empty map waiting for a drag.
  useEffect(() => {
    // An effect must return a cleanup or nothing. `request` answers with
    // whatever it answers with, and returning that makes React call it.
    request(params);
  }, [params, request]);

  const diff = useMemo(
    () => (groups === null ? null : paintPreview(allRoutes, groups, spreads)),
    [allRoutes, groups, spreads]
  );
  // Before the first answer the scope is judged against an empty diff, so the
  // area's routes draw as themselves rather than waiting on the grouping.
  const scoped = useMemo(
    () => scopeGroupingDiff(allRoutes, diff ?? NO_DIFF, centres, selectedCentre?.binKey ?? null),
    [allRoutes, diff, centres, selectedCentre]
  );
  const areaRoutes = useMemo(
    () => allRoutes.filter((r) => scoped.inAreaRouteIds.has(r.groupId)),
    [allRoutes, scoped]
  );
  const areaPaint = useMemo(
    () => (diff ? diff.routes.filter((p) => scoped.inAreaRouteIds.has(p.groupId)) : []),
    [diff, scoped]
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

  const handleDiscard = useCallback(() => goBack(), []);

  // A run that timed out has been cancelled and nothing is coming, so the row
  // has to say so: without its own branch the text stayed on "grouping" with
  // the spinner gone, which reads as a run that will never end. A cancel is a
  // knob that moved and the next run is already asked for, so that one keeps
  // the working text. The count is the library's; the area's own verdict is
  // the line above it.
  const statusText = refused
    ? t('settings.groupingNothingToGroup')
    : status === 'error'
      ? t('settings.groupingFailed')
      : status === 'running' || diff === null
        ? t('settings.groupingRunning')
        : t('settings.groupingSummary', { count: diff.previewGroupCount });

  const answered = diff !== null;
  const areaUnchanged =
    scoped.inArea.mergedCount === 0 &&
    scoped.inArea.droppedCount === 0 &&
    scoped.inArea.splitCount === 0;

  const picker = (
    <View style={styles.pickerWrap}>
      <PreviewCentrePicker
        centres={centres}
        labels={labels}
        selectedBinKey={selectedCentre?.binKey ?? null}
        onSelect={setCentre}
        countBy="routes"
      />
    </View>
  );

  const summary = (
    <>
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

      {answered && status !== 'running' && centres.length > 0 ? (
        <View style={styles.areaLines}>
          {areaUnchanged ? (
            <Text
              style={[styles.areaLine, { color: textPrimary }]}
              testID="grouping-area-unchanged"
            >
              {t('settings.groupingAreaUnchanged')}
            </Text>
          ) : null}
          {scoped.inArea.mergedCount > 0 ? (
            <Text style={[styles.areaLine, { color: textPrimary }]} testID="grouping-area-merged">
              {t('settings.groupingMerged', { count: scoped.inArea.mergedCount })}
            </Text>
          ) : null}
          {scoped.inArea.droppedCount > 0 ? (
            <Text style={[styles.areaLine, { color: textSecondary }]} testID="grouping-dropped">
              {t('settings.groupingDropped', { count: scoped.inArea.droppedCount })}
            </Text>
          ) : null}
          {scoped.inArea.splitCount > 0 ? (
            <Text style={[styles.areaLine, { color: textPrimary }]} testID="grouping-area-split">
              {t('settings.groupingSplit', { count: scoped.inArea.splitCount })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {scoped.elsewhere.length > 0 ? (
        <View style={styles.elsewhere} testID="grouping-elsewhere">
          <Text style={[styles.note, { color: textSecondary }]}>
            {t('settings.groupingElsewhere')}
          </Text>
          <View style={styles.chips}>
            {scoped.elsewhere.map((change) => {
              const target = centres.find((c) => c.binKey === change.binKey);
              const index = centres.findIndex((c) => c.binKey === change.binKey);
              if (!target) return null;
              return (
                <ToggleButton
                  key={change.binKey}
                  label={
                    target.name ??
                    t('settings.previewAreaFallback', {
                      letter: labels[index]?.fallbackLetter ?? '',
                    })
                  }
                  count={change.mergedCount + change.droppedCount + change.splitCount}
                  selected={false}
                  onPress={() => setCentre(target)}
                  testID={`grouping-elsewhere-${change.binKey}`}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.statusRow}>
        {status === 'running' && <Spinner label={statusText} />}
        <Text
          style={[styles.statusText, { color: status === 'running' ? textSecondary : textPrimary }]}
          testID="grouping-status"
        >
          {statusText}
        </Text>
      </View>

      {changed && !routesFailed ? (
        <ButtonRow
          actions={[
            {
              label: t('settings.previewDiscard'),
              variant: 'secondary',
              onPress: handleDiscard,
              testID: 'grouping-discard-button',
            },
            {
              label: t('settings.previewKeep'),
              onPress: handleKeep,
              testID: 'grouping-keep-button',
            },
          ]}
        />
      ) : null}
    </>
  );

  return (
    <ScreenSafeAreaView
      testID="route-grouping-preview-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <View style={StyleSheet.absoluteFill}>
        <GroupingPreviewMap
          routes={areaRoutes}
          centre={selectedCentre}
          painted={areaPaint}
          mergedCount={scoped.inArea.mergedCount}
          mapStyle={isDark ? 'dark' : 'light'}
        />
      </View>
      <View style={styles.overlay} pointerEvents="box-none">
        {centres.length > 0 && picker}
        <PreviewSheet
          summary={summary}
          bottomInset={bottomClearance}
          handleLabel={t('settings.previewRouteGrouping')}
          testID="grouping-control-panel"
        >
          <GroupingParamPanel params={params} onChange={onChange} />
        </PreviewSheet>
      </View>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  pickerWrap: { marginBottom: spacing.sm },
  areaLines: { gap: spacing.xxs },
  areaLine: { ...typography.bodyMedium },
  elsewhere: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statusText: { ...typography.bodySmall },
  note: { ...typography.caption },
});

export default withScreenBoundary(RouteGroupingPreviewScreenContent, 'RouteGroupingPreview');
