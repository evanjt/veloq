import { useState, useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  bulkExportActivities,
  bulkExportActivitiesGeoJson,
  hasPendingBulkExport,
  pendingBulkExportKind,
  pendingBulkExportSettled,
  PROGRESS_INTERVAL_MS,
  readBulkExportProgress,
  resumePendingBulkExport,
  type BulkExportOutcome,
  type BulkExportPhase,
  type BulkExportProgress,
} from '@/features/settings/lib/bulkExport';
import {
  BULK_EXPORT_FORMAT_NAME,
  type BulkExportKind,
} from '@/features/settings/lib/bulkExportFormat';
import { engineErrorKey, engineErrorTag } from '@/shared/native/engineError';

type ExportState = 'idle' | 'exporting' | 'done' | 'error';

type Completed = Extract<BulkExportOutcome, { state: 'complete' }>;

/**
 * An engine failure carries its variant, and its `message` is Rust's own
 * English. Naming the variant is the difference between "not open yet" and
 * "the database refused", which the athlete acts on differently.
 */
function failureMessage(err: unknown, t: TFunction): string {
  if (engineErrorTag(err)) return t(engineErrorKey(err, 'export.error'));
  return err instanceof Error ? err.message : t('export.error');
}

/** One line per reason that skipped something, so a trimmed ride is never called GPS-less. */
function completionMessage(outcome: Completed, t: TFunction): string | null {
  const skipped = [
    outcome.noTrack > 0 && t('export.bulkSkippedNoTrack', { count: outcome.noTrack }),
    outcome.trimmed > 0 && t('export.bulkSkippedTrimmed', { count: outcome.trimmed }),
    outcome.failed > 0 && t('export.bulkSkippedFailed', { count: outcome.failed }),
  ].filter((line): line is string => typeof line === 'string');
  if (skipped.length === 0) return null;
  const exported = t('export.bulkExported', {
    count: outcome.exported,
    format: BULK_EXPORT_FORMAT_NAME[outcome.kind],
  });
  return [exported, ...skipped].join('\n');
}

/**
 * The two export pills, and what they say while an export runs.
 *
 * The wait is capped at a minute. An export still writing past it is not a
 * failure: the row says so, and the hook keeps waiting on the write while the
 * screen is mounted. A screen that was left and comes back picks the same run up
 * on mount. Whichever is there when the write ends takes it, once.
 */
export function useBulkExport() {
  const [state, setState] = useState<ExportState>('idle');
  const [stillRunning, setStillRunning] = useState(false);
  const [phase, setPhase] = useState<BulkExportPhase>('generating');
  const [format, setFormat] = useState<BulkExportKind>('gpx');
  const [sizeBytes, setSizeBytes] = useState(0);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  // A second tap inside one render reads the same `state`, so the guard is a ref.
  const running = useRef(false);
  const live = useRef(true);
  // One wait on the owed run per screen, however many taps ask for it, so a
  // second waiter cannot clear the row while the first is sharing.
  const waiting = useRef(false);
  // The owed run leaves the slot as its share opens, which is not the run ending.
  const sharing = useRef(false);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reportComplete = useCallback(
    (outcome: Completed) => {
      if (live.current) setStillRunning(false);
      const message = completionMessage(outcome, t);
      if (message) Alert.alert(t('export.bulkComplete'), message);
    },
    [t]
  );

  const reportFailure = useCallback(
    (err: unknown) => {
      // Rust refusing a second run is the first one still going, not a failure.
      if (engineErrorTag(err) === 'Busy') {
        if (live.current) setStillRunning(true);
        return;
      }
      const message = failureMessage(err, t);
      if (live.current) {
        setStillRunning(false);
        setState('error');
        setError(message);
      }
      Alert.alert(t('common.error'), message);
    },
    [t]
  );

  const onProgress = useCallback((progress: BulkExportProgress) => {
    sharing.current = progress.phase === 'sharing';
    if (!live.current) return;
    setPhase(progress.phase);
    setSizeBytes(progress.sizeBytes);
    setCurrent(progress.current);
    setTotal(progress.total);
  }, []);

  const resume = useCallback(
    async function take(waited = false): Promise<void> {
      try {
        const outcome = await resumePendingBulkExport(onProgress);
        if (outcome.state === 'complete') reportComplete(outcome);
        else if (outcome.state === 'still-running' && live.current) {
          setStillRunning(true);
          // Wait on the write while mounted. A screen that was left does not
          // take the file: the one that comes back does, on mount.
          if (!waiting.current) {
            waiting.current = true;
            void pendingBulkExportSettled().then(() => {
              waiting.current = false;
              return live.current ? take(true) : undefined;
            });
          }
        } else if (waited && live.current) {
          // The run this screen waited on ended and another reader, the
          // screen that started it, took it and reported it.
          setStillRunning(false);
        }
        // `nothing-pending` on mount says nothing about a run: reporting it
        // as not running would land after an export started since this mount
        // and clear its row.
      } catch (err) {
        reportFailure(err);
      } finally {
        sharing.current = false;
      }
    },
    [onProgress, reportComplete, reportFailure]
  );

  const doExport = useCallback(
    async (kind: BulkExportKind) => {
      if (running.current) return;
      // A lapsed run still holds the export slot. The tap is answered with that
      // run, not with Rust's refusal of a second one.
      if (hasPendingBulkExport()) {
        await resume();
        return;
      }
      running.current = true;
      setState('exporting');
      setFormat(kind);
      setPhase('generating');
      setSizeBytes(0);
      setCurrent(0);
      setTotal(0);
      setError(null);
      setStillRunning(false);

      try {
        const exportFn = kind === 'geojson' ? bulkExportActivitiesGeoJson : bulkExportActivities;
        const result = await exportFn(onProgress);
        if (live.current) setState('done');
        if (result.state === 'still-running') {
          if (live.current) setStillRunning(true);
          // Not awaited: the tap is not held for the rest of the run.
          void resume();
        } else if (result.state === 'complete') reportComplete(result);
      } catch (err) {
        reportFailure(err);
      } finally {
        running.current = false;
        setTimeout(() => {
          if (live.current) setState('idle');
        }, 1000);
      }
    },
    [onProgress, resume, reportComplete, reportFailure]
  );

  // The worker runs on past the foreground wait, so the count does too, on the
  // screen that stayed and on one that came back.
  useEffect(() => {
    if (!stillRunning) return undefined;
    const kind = pendingBulkExportKind();
    if (kind) setFormat(kind);
    setPhase('generating');
    const tick = () => {
      const progress = readBulkExportProgress();
      // A refusal from a run this process never started, one left over from a
      // reload, has nothing to wait on but the worker itself.
      if (!progress && !hasPendingBulkExport() && !sharing.current) setStillRunning(false);
      if (!progress) return;
      setCurrent(progress.current);
      setTotal(progress.total);
    };
    tick();
    const ticker = setInterval(tick, PROGRESS_INTERVAL_MS);
    return () => clearInterval(ticker);
  }, [stillRunning]);

  useEffect(() => {
    void resume();
  }, [resume]);

  const exportAll = useCallback(() => doExport('gpx'), [doExport]);
  const exportAllGeoJson = useCallback(() => doExport('geojson'), [doExport]);

  return {
    exportAll,
    exportAllGeoJson,
    isExporting: state === 'exporting',
    stillRunning,
    format,
    phase,
    sizeBytes,
    current,
    total,
    error,
  };
}
