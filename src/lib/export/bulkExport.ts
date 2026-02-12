/**
 * Bulk export all activities as a .zip file containing GPX files + metadata JSON.
 */

import JSZip from 'jszip';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { generateGpx } from './gpx';
import { shareFileBase64 } from './shareFile';

export type BulkExportPhase = 'generating' | 'compressing' | 'sharing';

export interface BulkExportProgress {
  phase: BulkExportPhase;
  current: number;
  total: number;
  /** Estimated uncompressed size in bytes so far */
  sizeBytes: number;
}

export interface BulkExportResult {
  exported: number;
  skipped: number;
}

export async function bulkExportActivities(
  onProgress?: (progress: BulkExportProgress) => void
): Promise<BulkExportResult> {
  const engine = getRouteEngine();
  if (!engine) throw new Error('Route engine not available');

  const activityIds = engine.getActivityIds();
  if (activityIds.length === 0) throw new Error('No activities to export');

  const metrics = engine.getActivityMetricsForIds(activityIds);
  const metricsMap = new Map(metrics.map((m) => [m.activityId, m]));

  const zip = new JSZip();
  let exported = 0;
  let skipped = 0;
  let sizeBytes = 0;

  // Metadata for all activities (including those without GPS)
  const activitiesJson: Array<{
    id: string;
    name: string;
    date: string;
    sport: string;
    distance: number;
    movingTime: number;
    hasGpx: boolean;
  }> = [];

  for (let i = 0; i < activityIds.length; i++) {
    const id = activityIds[i];
    const meta = metricsMap.get(id);
    const name = meta?.name || id;
    const sport = meta?.sportType || 'Unknown';
    const date = meta?.date ? new Date(Number(meta.date) * 1000).toISOString() : undefined;

    // Try to get GPS track
    const track = engine.getGpsTrack(id);
    const hasGpx = track.length > 0;

    activitiesJson.push({
      id,
      name,
      date: date || '',
      sport,
      distance: meta?.distance || 0,
      movingTime: meta?.movingTime || 0,
      hasGpx,
    });

    if (hasGpx) {
      const gpx = generateGpx({
        name,
        points: track.map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
        })),
        time: date,
        sport,
      });
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
      const datePrefix = date ? date.split('T')[0] : 'unknown';
      zip.file(`${datePrefix}_${safeName}.gpx`, gpx);
      sizeBytes += gpx.length;
      exported++;
    } else {
      skipped++;
    }

    onProgress?.({ phase: 'generating', current: i + 1, total: activityIds.length, sizeBytes });
  }

  // Add metadata summary
  const metaJson = JSON.stringify(activitiesJson, null, 2);
  zip.file('activities.json', metaJson);
  sizeBytes += metaJson.length;

  // Compress
  onProgress?.({ phase: 'compressing', current: exported, total: exported, sizeBytes });
  const base64 = await zip.generateAsync({ type: 'base64' });

  // Share
  onProgress?.({ phase: 'sharing', current: exported, total: exported, sizeBytes });
  const dateStr = new Date().toISOString().split('T')[0];
  await shareFileBase64({
    base64,
    filename: `veloq-activities-${dateStr}.zip`,
    mimeType: 'application/zip',
  });

  return { exported, skipped };
}
