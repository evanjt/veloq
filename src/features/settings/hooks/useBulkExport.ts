import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  bulkExportActivities,
  bulkExportActivitiesGeoJson,
  type BulkExportPhase,
} from '@/features/settings/lib/bulkExport';
import {
  BULK_EXPORT_FORMAT_NAME,
  type BulkExportKind,
} from '@/features/settings/lib/bulkExportFormat';

type ExportState = 'idle' | 'exporting' | 'done' | 'error';

export function useBulkExport() {
  const [state, setState] = useState<ExportState>('idle');
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

      try {
        const exportFn = kind === 'geojson' ? bulkExportActivitiesGeoJson : bulkExportActivities;
        const result = await exportFn((progress) => {
          setPhase(progress.phase);
          setSizeBytes(progress.sizeBytes);
        });
        setState('done');
        if (result.skipped > 0) {
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
        const message = err instanceof Error ? err.message : t('export.error');
        setError(message);
        Alert.alert(t('common.error'), message);
      } finally {
        setTimeout(() => setState('idle'), 1000);
      }
    },
    [state, t]
  );

  const exportAll = useCallback(() => doExport('gpx'), [doExport]);
  const exportAllGeoJson = useCallback(() => doExport('geojson'), [doExport]);

  return {
    exportAll,
    exportAllGeoJson,
    isExporting: state === 'exporting',
    format,
    phase,
    sizeBytes,
    error,
  };
}
