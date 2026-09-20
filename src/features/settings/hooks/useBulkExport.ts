import { useState, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  bulkExportActivities,
  bulkExportActivitiesGeoJson,
  resumePendingBulkExport,
  type BulkExportPhase,
} from '@/features/settings/lib/bulkExport';
import {
  BULK_EXPORT_FORMAT_NAME,
  type BulkExportKind,
} from '@/features/settings/lib/bulkExportFormat';
import { engineErrorKey, engineErrorTag } from '@/shared/native/engineError';

type ExportState = 'idle' | 'exporting' | 'done' | 'error';

/**
 * The two export pills, and what they say while an export runs.
 *
 * The wait is capped at a minute. An export still writing past it is not a
 * failure: the row says so, and the file is offered when the screen next
 * mounts, which is what `resumePendingBulkExport` reads.
 */
export function useBulkExport() {
  const [state, setState] = useState<ExportState>('idle');
  const [stillRunning, setStillRunning] = useState(false);
  const [phase, setPhase] = useState<BulkExportPhase>('generating');
  const [format, setFormat] = useState<BulkExportKind>('gpx');
  const [sizeBytes, setSizeBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  const doExport = useCallback(
    async (kind: BulkExportKind) => {
      if (state === 'exporting') return;
      setState('exporting');
      setFormat(kind);
      setPhase('generating');
      setSizeBytes(0);
      setError(null);
      setStillRunning(false);

      try {
        const exportFn = kind === 'geojson' ? bulkExportActivitiesGeoJson : bulkExportActivities;
        const result = await exportFn((progress) => {
          setPhase(progress.phase);
          setSizeBytes(progress.sizeBytes);
        });
        setState('done');
        if (result.state === 'still-running') {
          setStillRunning(true);
          return;
        }
        if (result.state === 'complete' && result.skipped > 0) {
          Alert.alert(
            t('export.bulkComplete'),
            t('export.bulkResult', {
              exported: result.exported,
              skipped: result.skipped,
              format: BULK_EXPORT_FORMAT_NAME[kind],
            })
          );
        }
      } catch (err) {
        setState('error');
        // An engine failure carries its variant, and its `message` is Rust's
        // own English. Naming the variant is the difference between "not open
        // yet" and "the database refused", which the athlete acts on
        // differently.
        const message = engineErrorTag(err)
          ? t(engineErrorKey(err, 'export.error'))
          : err instanceof Error
            ? err.message
            : t('export.error');
        setError(message);
        Alert.alert(t('common.error'), message);
      } finally {
        setTimeout(() => setState('idle'), 1000);
      }
    },
    [state, t]
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const outcome = await resumePendingBulkExport();
        if (!live) return;
        // Only the two outcomes about an owed file say anything. Reporting
        // `nothing-pending` as "not running" would land after an export
        // started since this mount and clear the row it just set.
        if (outcome.state === 'still-running') setStillRunning(true);
        else if (outcome.state === 'complete') setStillRunning(false);
      } catch {
        if (live) setStillRunning(false);
        Alert.alert(t('common.error'), t('export.error'));
      }
    })();
    return () => {
      live = false;
    };
  }, [t]);

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
    error,
  };
}
