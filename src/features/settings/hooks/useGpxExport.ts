import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { GpxFile } from 'veloqrs';
import {
  buildGpxFile,
  buildRouteFitFile,
  buildRouteGpxFile,
  buildSectionFitFile,
  buildSectionGpxFile,
} from '@/shared/native/gpxFile';
import { shareFile, shareFileBytes, type ShareAnchor } from '@/features/settings/lib/shareFile';
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

/** A route or section shared by id: the engine reads its line and names it. */
interface EngineExportParams {
  sport?: string | undefined;
  /** The control the export starts from, which the share sheet points at on iPad. */
  anchor?: ShareAnchor | undefined;
}

/** The message shown when an export cannot be written, by what it writes. */
type FailureKey = 'export.error' | 'export.fitError';

export function useGpxExport() {
  const [exporting, setExporting] = useState(false);
  const { t } = useTranslation();

  /**
   * Build the engine's file, then send it. Nothing is sent, and the athlete is
   * told why, when the engine builds nothing. A failure is reported, not thrown.
   */
  const share = useCallback(
    async <F extends { filename: string }>(
      build: () => F | null,
      send: (file: F) => Promise<void>,
      failure: FailureKey
    ) => {
      if (exporting) return;
      setExporting(true);
      try {
        const file = build();
        if (!file) {
          inform({ title: t('export.failedTitle'), message: t('export.gpxTrimmedAway') });
          return;
        }
        await send(file);
      } catch {
        inform({ title: t('export.failedTitle'), message: t(failure) });
      } finally {
        setExporting(false);
      }
    },
    [exporting, t]
  );

  const exportGpx = useCallback(
    ({ name, points, time, sport, anchor }: ExportParams) =>
      share(
        () => buildGpxFile(name, sport, time, points),
        (file: GpxFile) =>
          shareFile({ content: file.content, name: file.filename, kind: 'gpx', anchor }),
        'export.error'
      ),
    [share]
  );

  const exportRouteGpx = useCallback(
    (groupId: string, { sport, anchor }: EngineExportParams) =>
      share(
        () => buildRouteGpxFile(groupId, sport),
        (file) => shareFile({ content: file.content, name: file.filename, kind: 'gpx', anchor }),
        'export.error'
      ),
    [share]
  );

  const exportSectionGpx = useCallback(
    (sectionId: string, { sport, anchor }: EngineExportParams) =>
      share(
        () => buildSectionGpxFile(sectionId, sport),
        (file) => shareFile({ content: file.content, name: file.filename, kind: 'gpx', anchor }),
        'export.error'
      ),
    [share]
  );

  const exportRouteFit = useCallback(
    (groupId: string, { sport, anchor }: EngineExportParams) =>
      share(
        () => buildRouteFitFile(groupId, sport),
        (file) => shareFileBytes({ bytes: file.content, name: file.filename, kind: 'fit', anchor }),
        'export.fitError'
      ),
    [share]
  );

  const exportSectionFit = useCallback(
    (sectionId: string, { sport, anchor }: EngineExportParams) =>
      share(
        () => buildSectionFitFile(sectionId, sport),
        (file) => shareFileBytes({ bytes: file.content, name: file.filename, kind: 'fit', anchor }),
        'export.fitError'
      ),
    [share]
  );

  return {
    exportGpx,
    exportRouteGpx,
    exportSectionGpx,
    exportRouteFit,
    exportSectionFit,
    exporting,
  };
}
