import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { buildGpxFile } from '@/shared/native/gpxFile';
import { shareFile, type ShareAnchor } from '@/features/settings/lib/shareFile';
import type { LatLng } from '@/shared/geo/polyline';
import { inform } from '@/shared/ui/dialog';

interface ExportParams {
  name: string;
  points: LatLng[];
  time?: string;
  sport?: string | undefined;
  /** The control the export starts from, which the share sheet points at on iPad. */
  anchor?: ShareAnchor | undefined;
}

export function useGpxExport() {
  const [exporting, setExporting] = useState(false);
  const { t } = useTranslation();

  const exportGpx = useCallback(
    async ({ name, points, time, sport, anchor }: ExportParams) => {
      if (exporting) return;
      setExporting(true);
      try {
        const file = buildGpxFile(name, sport, time, points);
        if (!file) {
          inform({ title: t('export.failedTitle'), message: t('export.gpxTrimmedAway') });
          return;
        }
        await shareFile({ content: file.content, name: file.filename, kind: 'gpx', anchor });
      } catch {
        inform({ title: t('export.failedTitle'), message: t('export.error') });
      } finally {
        setExporting(false);
      }
    },
    [exporting, t]
  );

  return { exportGpx, exporting };
}
