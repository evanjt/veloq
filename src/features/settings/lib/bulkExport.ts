/**
 * Bulk export all activities as a .zip file containing GPX files + metadata JSON.
 *
 * Uses Rust FFI to stream GPS tracks directly from SQLite into a ZIP on disk.
 * Peak memory is ~1 track regardless of activity count. The write runs on a
 * Rust thread with a connection of its own and answers with a promise, so the
 * JS thread has frames to render in the meantime. What is still read on a
 * timer is the progress bar's own counters, which cost a mutex and two atomic
 * loads: an event per activity would park the writing thread on this one.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { withAwakeDeadline } from '@/shared/async/awakeDeadline';
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

/** How often the running export is asked how far it has got. */
const PROGRESS_INTERVAL_MS = 250;

/**
 * What a caller staring at a spinner waits before being told to come back.
 *
 * A whole-library export is minutes of work, so this is not how long the
 * export takes: the Rust worker has its own thread and connection and carries
 * on past it either way. It is how long a foreground wait is worth, and past
 * it the athlete is told the export is still running rather than that it
 * failed.
 */
const EXPORT_TIMEOUT_MS = 60_000;

/**
 * What a wait on the export ends with: the finished export, or a run still
 * going.
 *
 * A run still going is not a failure, and carries the write itself so the
 * screen can come back to it. A failed write throws.
 */
export type ExportOutcome =
  | { state: 'complete'; exported: number; skipped: number; totalBytes: number }
  | { state: 'running'; started: StartedExport };

/** What an export asked for now answers with. */
export type BulkExportOutcome =
  | { state: 'complete'; exported: number; skipped: number }
  | { state: 'still-running' }
  | { state: 'nothing-pending' };

/**
 * The file a lapsed export still owes the athlete, and the write behind it.
 *
 * Module state rather than storage, the same as the database export next door:
 * the write runs on a Rust thread in this process, so a file owed cannot
 * outlive the process making it.
 */
let pendingExport: {
  uri: string;
  mimeType: string;
  uti: string;
  work: Promise<ExportResult>;
  settled: () => boolean;
  result: () => ExportResult | null;
} | null = null;

/** What one finished export wrote. */
interface ExportResult {
  exported: number;
  skipped: number;
  totalBytes: number;
}

/**
 * Start the export and wait for it, reporting what has been written on the
 * way. Exported because it is the whole of the export's behaviour: the share
 * around it is one call to the OS.
 */
export async function runExport(
  format: BulkExportFormat,
  plainPath: string,
  onProgress?: (progress: BulkExportProgress) => void,
  timeoutMs: number = EXPORT_TIMEOUT_MS
): Promise<ExportOutcome> {
  const engine = getEngine();
  if (!engine) throw new Error('Route engine not available');

  const started = startExport(engine, format, plainPath);
  onProgress?.({ phase: 'generating', current: 0, total: 0, sizeBytes: 0 });

  const ticker = onProgress
    ? setInterval(() => {
        const progress = engine.bulkExportProgress();
        if (!progress.running) return;
        onProgress({
          phase: 'generating',
          current: progress.exported,
          total: progress.total,
          sizeBytes: 0,
        });
      }, PROGRESS_INTERVAL_MS)
    : null;

  try {
    const outcome = await withAwakeDeadline(started.work, timeoutMs);
    // A run still going is handed back rather than failed: it is still
    // writing, on its own thread, and the screen can come back to it.
    if (outcome.state === 'stillRunning') return { state: 'running', started };
    return { state: 'complete', ...outcome.value };
  } finally {
    if (ticker !== null) clearInterval(ticker);
  }
}

/** The export in flight, with what it has done readable without awaiting it. */
interface StartedExport {
  work: Promise<ExportResult>;
  settled: () => boolean;
  result: () => ExportResult | null;
}

function startExport(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  format: BulkExportFormat,
  plainPath: string
): StartedExport {
  let settled = false;
  let result: ExportResult | null = null;
  const work = engine.runBulkExport(format, plainPath).then(
    (written) => {
      settled = true;
      result = written;
      return written;
    },
    (err: unknown) => {
      settled = true;
      throw err;
    }
  );
  // Nothing has to be waiting when it ends: a screen that gave up reads
  // `settled` when it comes back.
  work.catch(() => {});
  return { work, settled: () => settled, result: () => result };
}

/** Strip file:// for Rust, which expects a plain filesystem path. */
const plain = (uri: string) => (uri.startsWith('file://') ? uri.slice(7) : uri);

export async function bulkExportActivities(
  onProgress?: (progress: BulkExportProgress) => void,
  timeoutMs?: number
): Promise<BulkExportOutcome> {
  const dateStr = formatLocalDate(new Date());
  const destUri = `${FileSystem.cacheDirectory}veloq-activities-${dateStr}.zip`;

  return finish(
    await runExport(BulkExportFormat.Gpx, plain(destUri), onProgress, timeoutMs),
    { uri: destUri, mimeType: 'application/zip', uti: 'public.zip-archive' },
    onProgress
  );
}

export async function bulkExportActivitiesGeoJson(
  onProgress?: (progress: BulkExportProgress) => void,
  timeoutMs?: number
): Promise<BulkExportOutcome> {
  const dateStr = formatLocalDate(new Date());
  const destUri = `${FileSystem.cacheDirectory}veloq-activities-${dateStr}.geojson`;

  return finish(
    await runExport(BulkExportFormat.GeoJson, plain(destUri), onProgress, timeoutMs),
    { uri: destUri, mimeType: 'application/geo+json', uti: 'public.json' },
    onProgress
  );
}

/**
 * Share the finished file, or remember the destination of one still being
 * written so the share can be offered on return.
 */
async function finish(
  outcome: ExportOutcome,
  destination: { uri: string; mimeType: string; uti: string },
  onProgress?: (progress: BulkExportProgress) => void
): Promise<BulkExportOutcome> {
  if (outcome.state === 'running') {
    // The destination and the write both have to survive the screen, or coming
    // back can only start a second export of the same library beside the one
    // still writing.
    pendingExport = { ...destination, ...outcome.started };
    return { state: 'still-running' };
  }

  pendingExport = null;
  onProgress?.({
    phase: 'sharing',
    current: outcome.exported,
    total: outcome.exported,
    sizeBytes: outcome.totalBytes,
  });
  await shareShareAndDelete(destination);

  return { state: 'complete', exported: outcome.exported, skipped: outcome.skipped };
}

async function shareShareAndDelete(destination: {
  uri: string;
  mimeType: string;
  uti: string;
}): Promise<void> {
  await shareExistingFile(destination.uri, destination.mimeType, destination.uti);
  await FileSystem.deleteAsync(destination.uri, { idempotent: true });
}

/**
 * Offer the file a lapsed export left behind, once its write has finished.
 *
 * Read when the export screen mounts. A write still going stays owed; a slot
 * that emptied without finishing owes nothing, because the file it was writing
 * is not there to share.
 */
export async function resumePendingBulkExport(): Promise<BulkExportOutcome> {
  const owed = pendingExport;
  if (!owed) return { state: 'nothing-pending' };

  if (!owed.settled()) return { state: 'still-running' };

  pendingExport = null;
  const written = owed.result();
  // A write that ended without a result failed, and the file it was writing is
  // not there to share.
  if (!written) return { state: 'nothing-pending' };

  await shareShareAndDelete(owed);
  return { state: 'complete', exported: written.exported, skipped: written.skipped };
}
