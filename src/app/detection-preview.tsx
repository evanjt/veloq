/**
 * Detection preview: test new section settings on one riding area before
 * applying them everywhere. The screen opens on the live catalogue for the
 * chosen area, so the map shows what the detector holds today. The five
 * sliders are local state, and releasing one runs a sandboxed detect against
 * that catalogue, superseding a run still going. The Preview button runs the
 * same detect on demand, for the first look at an area and for a retry after a
 * refusal. Only Keep writes the config and re-analyses the library.
 *
 * The column itself does not scroll. Tuning a slider you cannot see the map for
 * defeats the screen, so the map and the controls share one fixed column. That
 * is what the intro paragraph, the picker label and the standalone Preview
 * button cost, and why they are gone: once a run has produced a result, Preview
 * joins Discard and Keep in the one decision row. The slider card is the one
 * thing that scrolls, and only on a screen too short to give its five rows a
 * tap target each.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { hasStarted } from 'veloqrs';
import { useTheme } from '@/shared/app';
import {
  Button,
  ErrorState,
  ProgressBar,
  ScreenSafeAreaView,
  useBottomClearance,
} from '@/shared/ui';
import { colors, darkColors, layout, spacing, typography, themePalette } from '@/theme';
import {
  usePreviewDetect,
  getPhaseDisplayKey,
  useCutoverHeld,
  useDetectionHold,
  rescanRefusalKey,
  previewRefusalKey,
  previewNewNumber,
  isElevationHold,
  useSectionRescan,
  usePreviewCentres,
  usePreviewCurrentSections,
  PreviewCentrePicker,
  PreviewDiffStrip,
  PreviewMapView,
  PreviewRunCost,
  PreviewParamPanel,
  PreviewSectionPopover,
} from '@/features/routes';
import { getEngine, UNIFIED_CONFIG } from '@/shared/native/engine';
import { useEngineRead } from '@/shared/native/useEngineSubscription';
import { attemptEngineRead } from '@/shared/native/engineError';
import type { PreviewCentre, PreviewParams, PreviewSection } from 'veloqrs';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';
import { goBack, tapBack } from '@/shared/app/navigation';
import { confirmAction, inform } from '@/shared/ui/dialog';
import { FitText } from '@/shared/ui/FitText';

const PARAM_KEYS = [
  'proximityThreshold',
  'minSectionLength',
  'maxSectionLength',
  'minActivities',
  'divergenceThreshold',
] as const satisfies readonly (keyof PreviewParams)[];

function DetectionPreviewScreenContent() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const bottomClearance = useBottomClearance({ insetTaken: true });

  const client = useMemo(() => getEngine(), []);
  const {
    centres,
    labels,
    error: centresReadError,
    retry: retryCentres,
  } = usePreviewCentres(client);
  const { status, progress, result, refusal, lapsed, start, request, cancel, reset } =
    usePreviewDetect(client);
  const phaseKey = progress ? getPhaseDisplayKey(progress.phase) : null;
  // The preview is a settings sandbox: it loads a subset, runs the detector to
  // show what different settings produce, and touches no catalogue until Keep.
  // So the cutover hold that refuses every real detect does not reach it, and
  // what the screen owes is a notice rather than a door.
  const migrating = useCutoverHeld();
  const { forceRescan } = useSectionRescan();
  const refusalKey = previewRefusalKey(refusal, isElevationHold(useDetectionHold()));

  // A config change clears the processed set and the re-detect that follows is
  // asynchronous, so the sliders can show the new config while the live
  // catalogue is still the old one's cut. The diff then reports every section
  // that moved between the two configs once as gone and once as new, which
  // reads exactly like a detector regression. This is the count of activities
  // the live catalogue has never seen, which is that gap and also the milder
  // one of a few rides synced since the last detect. `null` is an engine that
  // is closed or whose count failed, and it says nothing rather than inventing
  // either state. A sync grows the gap and a detect closes it, so either
  // announcement re-reads.
  const readDetection = useEngineRead(['activities', 'sections', 'detectionApplied']);
  const awaitingDetection = useMemo(
    () =>
      attemptEngineRead(() => readDetection((engine) => engine.sectionDetectionAwaiting())).value ??
      null,
    [readDetection]
  );

  const [centre, setCentre] = useState<PreviewCentre | null>(null);
  const [params, setParams] = useState<PreviewParams>(() => {
    const config = client?.getSectionConfig();
    if (!config) return UNIFIED_CONFIG;
    return {
      proximityThreshold: config.proximityThreshold,
      minSectionLength: config.minSectionLength,
      maxSectionLength: config.maxSectionLength,
      minActivities: config.minActivities,
      divergenceThreshold: config.divergenceThreshold,
    };
  });
  const [selected, setSelected] = useState<PreviewSection | null>(null);
  const newNumber = useMemo(
    () => previewNewNumber(result?.sections ?? [], selected),
    [result, selected]
  );
  const [showCurrent, setShowCurrent] = useState(true);
  const [showProposed, setShowProposed] = useState(true);
  const [showRemoved, setShowRemoved] = useState(true);

  const bg = isDark ? darkColors.background : colors.background;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const surface = isDark ? darkColors.surface : colors.surface;
  const border = isDark ? darkColors.border : colors.border;
  const danger = isDark ? darkColors.error : colors.error;

  const selectedCentre = centre ?? centres[0] ?? null;
  const { sections: currentSections, failed: currentFailed } = usePreviewCurrentSections(
    client,
    selectedCentre
  );
  const running = status === 'running';
  // Keep commits the config the athlete saw the diff for, so it is offered only
  // while the sliders still read that config.
  const previewedConfig = result?.config ?? null;
  const slidersMatchResult =
    previewedConfig !== null && PARAM_KEYS.every((k) => params[k] === previewedConfig[k]);
  const keepEnabled = slidersMatchResult && !migrating;
  const previewIsNext = !!selectedCentre && !slidersMatchResult;
  // The engine reports a percentage for a bounded job, so draw it. Clamped
  // because a phase that finishes ahead of its own estimate can overshoot.
  const runPercent = Math.min(100, Math.max(0, Math.round(progress?.percent ?? 0)));
  const runLabel =
    progress?.phase === 'loading'
      ? t('settings.previewRunning', { count: progress.total })
      : phaseKey
        ? t(phaseKey)
        : (progress?.phase ?? t('settings.previewRun'));

  // A held diff is about one area, so moving to another drops it. The run
  // itself keeps its result across a re-run of the same area, which is why
  // nothing else clears it.
  const handleSelectCentre = useCallback(
    (next: PreviewCentre) => {
      if (next.binKey !== selectedCentre?.binKey) {
        reset();
        setSelected(null);
      }
      setCentre(next);
    },
    [selectedCentre, reset]
  );

  const handlePreview = useCallback(() => {
    if (!selectedCentre || running) return;
    setSelected(null);
    start(selectedCentre.lat, selectedCentre.lng, params);
  }, [selectedCentre, running, start, params]);

  // A settled value regenerates on its own. The sliders stay live during a
  // run, so a release mid-run supersedes it rather than waiting on it.
  const handleCommit = useCallback(
    (next: PreviewParams) => {
      if (!selectedCentre) return;
      setSelected(null);
      request(selectedCentre.lat, selectedCentre.lng, next);
    },
    [selectedCentre, request]
  );

  const handleKeep = useCallback(() => {
    confirmAction({
      title: t('settings.previewKeepTitle'),
      message: t('settings.previewKeepWarning'),
      confirmLabel: t('settings.previewKeep'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        const config = client?.getSectionConfig();
        if (!client || !config || migrating || !previewedConfig) return;
        client.setSectionConfig({ ...config, ...previewedConfig });
        // Through the rescan hook, not the client: the re-cut is global and
        // the athlete has to be able to see it run, and the hook is what
        // starts the poll every progress indicator reads.
        //
        // The engine refuses a re-cut while a detect runs or the elevation
        // backfill holds detection. The config above is already written and
        // the evidence cache already cleared, so closing here would report a
        // change that never ran. Stay, say why, and let Keep be pressed again.
        const outcome = forceRescan();
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
  }, [t, client, previewedConfig, forceRescan, migrating]);

  const handleDiscard = useCallback(() => {
    if (running) cancel();
    tapBack();
  }, [running, cancel]);

  // Leaving by any route cancels a run in flight. The Discard button did this
  // and the header back button did not, and neither did the swipe-back, so a
  // preview kept running against a screen nobody was looking at.
  const abandon = useRef<() => void>(() => {});
  useEffect(() => {
    abandon.current = () => {
      if (running) cancel();
    };
  }, [running, cancel]);
  useEffect(() => () => abandon.current(), []);

  return (
    <ScreenSafeAreaView
      testID="detection-preview-screen"
      style={[styles.container, { backgroundColor: bg }]}
    >
      <View style={styles.map} testID="preview-map">
        <PreviewMapView
          result={result}
          currentSections={currentSections}
          centre={selectedCentre}
          selectedId={selected?.id ?? null}
          showCurrent={showCurrent}
          showProposed={showProposed}
          showRemoved={showRemoved}
          onToggleCurrent={() => setShowCurrent((v) => !v)}
          onToggleProposed={() => setShowProposed((v) => !v)}
          onToggleRemoved={() => setShowRemoved((v) => !v)}
          onSelect={setSelected}
        />
        {selected ? (
          <View style={styles.popover} pointerEvents="box-none">
            <PreviewSectionPopover
              section={selected}
              newNumber={newNumber}
              onClose={() => setSelected(null)}
            />
          </View>
        ) : null}
      </View>

      <View
        style={[styles.panel, { paddingBottom: bottomClearance }]}
        testID="preview-control-panel"
      >
        {centresReadError !== undefined ? (
          <ErrorState
            variant="inline"
            error={centresReadError}
            onRetry={retryCentres}
            testID="preview-centres-failure"
          />
        ) : null}
        <View style={styles.pickerWrap}>
          <PreviewCentrePicker
            centres={centres}
            labels={labels}
            selectedBinKey={selectedCentre?.binKey ?? null}
            onSelect={handleSelectCentre}
          />
        </View>

        <PreviewParamPanel params={params} onChange={setParams} onCommit={handleCommit} />

        {result ? <PreviewDiffStrip counts={result.counts} /> : null}

        {result ? <PreviewRunCost pool={result.pool} elapsedMs={result.elapsedMs} /> : null}

        {running ? (
          <View>
            <View style={[styles.runBtn, { backgroundColor: surface, borderColor: border }]}>
              <ActivityIndicator size="small" color={textSecondary} />
              <FitText style={[styles.runText, { color: textSecondary }]}>{runLabel}</FitText>
            </View>
            <ProgressBar
              done={runPercent}
              total={100}
              label={runLabel}
              color={palette.primary}
              testID="preview-progress"
              fillTestID="preview-progress-fill"
            />
            {lapsed ? (
              <Text style={[styles.notice, { color: textSecondary }]} testID="preview-slow">
                {t('settings.runSlow')}
              </Text>
            ) : null}
          </View>
        ) : (
          // One row, so a result does not cost a second. Keep takes the accent
          // once there is something to keep, and Preview steps back to
          // secondary rather than competing with it.
          <View style={styles.actionRow}>
            {result ? (
              <Button
                variant="secondary"
                style={styles.actionBtn}
                onPress={handleDiscard}
                label={t('settings.previewDiscard')}
                testID="preview-discard-button"
              />
            ) : null}
            <Button
              variant={previewIsNext ? 'primary' : 'secondary'}
              style={styles.actionBtn}
              onPress={handlePreview}
              disabled={!selectedCentre}
              icon="magnify-scan"
              label={t('settings.previewRun')}
              testID="preview-run-button"
            />
            {result ? (
              <Button
                style={styles.actionBtn}
                onPress={handleKeep}
                disabled={!keepEnabled}
                label={t('settings.previewKeep')}
                testID="preview-keep-button"
              />
            ) : null}
          </View>
        )}

        {currentFailed ? (
          <Text style={[styles.notice, { color: danger }]} testID="preview-current-failed">
            {t('settings.previewCurrentFailed')}
          </Text>
        ) : null}
        {status === 'error' && (
          <Text style={[styles.notice, { color: danger }]}>{t('settings.previewFailed')}</Text>
        )}
        {status === 'pool_unusable' && (
          <Text style={[styles.notice, { color: danger }]} testID="preview-pool-unusable">
            {t('settings.previewPoolUnusable')}
          </Text>
        )}
        {refusalKey ? (
          <Text style={[styles.notice, { color: textSecondary }]} testID="preview-refusal">
            {t(refusalKey)}
          </Text>
        ) : null}
        {migrating ? (
          <Text style={[styles.notice, { color: textSecondary }]} testID="preview-migrating">
            {t('settings.previewMigrating')}
          </Text>
        ) : null}
        {migrating && result ? (
          <Text
            style={[styles.notice, { color: textSecondary }]}
            testID="preview-keep-after-upgrade"
          >
            {t('settings.previewKeepAfterUpgrade')}
          </Text>
        ) : null}
        {awaitingDetection !== null && awaitingDetection > 0 && (
          <Text style={[styles.notice, { color: textSecondary }]} testID="preview-stale-catalogue">
            {t('settings.previewStaleCatalogue', { count: awaitingDetection })}
          </Text>
        )}
      </View>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: {
    height: '30%',
  },
  popover: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  panel: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  pickerWrap: {
    marginHorizontal: -spacing.md,
  },
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadius,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
  },
  runText: {
    ...typography.body,
    fontWeight: '600',
  },
  notice: {
    ...typography.bodySmall,
    textAlign: 'center',
  },
});

export default withScreenBoundary(DetectionPreviewScreenContent, 'DetectionPreview');
