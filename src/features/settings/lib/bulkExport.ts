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
import { shareExistingFile } from '@/features/settings/lib/shareFile';
import { BulkExportFormat } from 'veloqrs';

export type BulkExportPhase = 'generating' | 'sharing';

export interface BulkExportProgress {
  phase: BulkExportPhase;
  /** Activities written so far, and how many the export expects to visit. */
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

/**
 * An export that has not finished by here is stuck, not slow.
 *
 * A whole-library GPX export is minutes of work where the database copy next
 * door is a file copy, so this is longer than the backup's five minutes rather
 * than the same number by analogy: fifteen covers a library several times the
 * size of the one measured at roughly a second per hundred activities, and
 * still ends a spinner nobody can otherwise stop.
 */
const EXPORT_TIMEOUT_MS = 15 * 60 * 1000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the export and poll it to completion, reporting what has been written
 * on the way. Exported because it is the whole of the export's behaviour: the
 * share around it is one call to the OS.
 */
export async function runExport(
  format: BulkExportFormat,
  plainPath: string,
  onProgress?: (progress: BulkExportProgress) => void,
  timeoutMs: number = EXPORT_TIMEOUT_MS
): Promise<{ exported: number; skipped: number; totalBytes: number }> {
  const engine = getEngine();
  if (!engine) throw new Error('Route engine not available');

  engine.startBulkExport(format, plainPath);
  onProgress?.({ phase: 'generating', current: 0, total: 0, sizeBytes: 0 });

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const poll = engine.pollBulkExport();
    if (poll.state === 'complete') {
      return { exported: poll.exported, skipped: poll.skipped, totalBytes: poll.totalBytes };
    }
    // An export that never started, or one another caller collected, leaves
    // the slot idle. That is a different failure from one that is taking too
    // long, and the athlete's next move differs, so the two say so.
    if (poll.state === 'idle') throw new Error('Export did not start');
    onProgress?.({
      phase: 'generating',
      current: poll.exported,
      total: poll.total,
      sizeBytes: 0,
    });
    // A worker that neither finishes nor frees its slot would otherwise be
    // polled at 4 Hz for the life of the screen, behind a spinner that never
    // stops.
    if (Date.now() > deadline) throw new Error('Export did not finish in time');
    await delay(POLL_INTERVAL_MS);
  }
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
  await shareExistingFile(destUri, 'application/zip', 'public.zip-archive');
  await FileSystem.deleteAsync(destUri, { idempotent: true });

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
  await shareExistingFile(destUri, 'application/geo+json', 'public.json');
  await FileSystem.deleteAsync(destUri, { idempotent: true });

  return { exported: result.exported, skipped: result.skipped };
}
