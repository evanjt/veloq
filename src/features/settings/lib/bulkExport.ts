/**
 * Bulk export all activities as a .zip file containing GPX files + metadata JSON.
 *
 * Uses Rust FFI to stream GPS tracks directly from SQLite into a ZIP on disk.
 * Peak memory is ~1 track regardless of activity count. The write runs on a
 * Rust thread with a connection of its own, so this polls it rather than
 * waiting on it: a library takes seconds to write and the JS thread has frames
 * to render in the meantime.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { getEngine } from '@/shared/native/engine';
import { formatLocalDate } from '@/shared/format/format';
import { BulkExportFormat } from 'veloqrs';

export type BulkExportPhase = 'generating' | 'sharing';

export interface BulkExportProgress {
  phase: BulkExportPhase;
  current: number;
  total: number;
  sizeBytes: number;
}

export interface BulkExportResult {
  exported: number;
  skipped: number;
}

/** How often the running export is asked how far it has got. */
const POLL_INTERVAL_MS = 250;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the export and poll it to completion, reporting what has been written
 * on the way. Exported because it is the whole of the export's behaviour: the
 * share around it is one call to the OS.
 */
export async function runExport(
  format: BulkExportFormat,
  plainPath: string,
  onProgress?: (progress: BulkExportProgress) => void
): Promise<{ exported: number; skipped: number; totalBytes: number }> {
  const engine = getEngine();
  if (!engine) throw new Error('Route engine not available');

  engine.startBulkExport(format, plainPath);
  onProgress?.({ phase: 'generating', current: 0, total: 0, sizeBytes: 0 });

  for (;;) {
    const poll = engine.pollBulkExport();
    if (poll.state === 'complete') {
      return { exported: poll.exported, skipped: poll.skipped, totalBytes: poll.totalBytes };
    }
    // An export that never started, or one another caller collected, leaves
    // the slot idle. Waiting on it would spin forever.
    if (poll.state === 'idle') throw new Error('Export did not start');
    onProgress?.({
      phase: 'generating',
      current: poll.exported,
      total: poll.total,
      sizeBytes: 0,
    });
    await delay(POLL_INTERVAL_MS);
  }
}

async function shareAndClean(destUri: string, mimeType: string, uti: string): Promise<void> {
  const Sharing = await import('expo-sharing');
  await Sharing.shareAsync(destUri, { mimeType, UTI: uti });
  await FileSystem.deleteAsync(destUri, { idempotent: true });
}

/** Strip file:// for Rust, which expects a plain filesystem path. */
const plain = (uri: string) => (uri.startsWith('file://') ? uri.slice(7) : uri);

export async function bulkExportActivities(
  onProgress?: (progress: BulkExportProgress) => void
): Promise<BulkExportResult> {
  const dateStr = formatLocalDate(new Date());
  const destUri = `${FileSystem.cacheDirectory}veloq-activities-${dateStr}.zip`;

  const result = await runExport(BulkExportFormat.Gpx, plain(destUri), onProgress);

  onProgress?.({
    phase: 'sharing',
    current: result.exported,
    total: result.exported,
    sizeBytes: result.totalBytes,
  });
  await shareAndClean(destUri, 'application/zip', 'public.zip-archive');

  return { exported: result.exported, skipped: result.skipped };
}

export async function bulkExportActivitiesGeoJson(
  onProgress?: (progress: BulkExportProgress) => void
): Promise<BulkExportResult> {
  const dateStr = formatLocalDate(new Date());
  const destUri = `${FileSystem.cacheDirectory}veloq-activities-${dateStr}.geojson`;

  const result = await runExport(BulkExportFormat.GeoJson, plain(destUri), onProgress);

  onProgress?.({
    phase: 'sharing',
    current: result.exported,
    total: result.exported,
    sizeBytes: result.totalBytes,
  });
  await shareAndClean(destUri, 'application/geo+json', 'public.json');

  return { exported: result.exported, skipped: result.skipped };
}
