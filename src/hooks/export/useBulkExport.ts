import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  bulkExportActivities,
  bulkExportActivitiesGeoJson,
  type BulkExportPhase,
} from '@/lib/export/bulkExport';

type ExportState = 'idle' | 'exporting' | 'done' | 'error';

export function useBulkExport() {
  const [state, setState] = useState<ExportState>('idle');
  const [phase, setPhase] = useState<BulkExportPhase>('generating');
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  const doExport = useCallback(
    async (format: 'gpx' | 'geojson') => {
      if (state === 'exporting') return;
      setState('exporting');
      setPhase('generating');
      setCurrent(0);
      setTotal(0);
      setSizeBytes(0);
      setError(null);

      try {
        const exportFn = format === 'geojson' ? bulkExportActivitiesGeoJson : bulkExportActivities;
        const result = await exportFn((progress) => {
          setPhase(progress.phase);
          setCurrent(progress.current);
          setTotal(progress.total);
          setSizeBytes(progress.sizeBytes);
        });
        setState('done');
        if (result.skipped > 0) {
          Alert.alert(
            t('export.bulkComplete'),
            t('export.bulkResult', {
              exported: result.exported,
              skipped: result.skipped,
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
    phase,
    current,
    total,
    sizeBytes,
    error,
  };
}
