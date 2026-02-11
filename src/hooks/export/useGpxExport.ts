import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { generateGpx } from '@/lib/export/gpx';
import { shareFile } from '@/lib/export/shareFile';

interface GpxPoint {
  latitude: number;
  longitude: number;
  elevation?: number;
}

interface ExportParams {
  name: string;
  points: GpxPoint[];
  time?: string;
  sport?: string;
}

export function useGpxExport() {
  const [exporting, setExporting] = useState(false);
  const { t } = useTranslation();

  const exportGpx = useCallback(
    async ({ name, points, time, sport }: ExportParams) => {
      if (exporting) return;
      setExporting(true);
      try {
        const gpx = generateGpx({ name, points, time, sport });
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
        await shareFile({
          content: gpx,
          filename: `${safeName}.gpx`,
          mimeType: 'application/gpx+xml',
        });
      } catch {
        Alert.alert(t('common.error'), t('export.error'));
      } finally {
        setExporting(false);
      }
    },
    [exporting, t]
  );

  return { exportGpx, exporting };
}
