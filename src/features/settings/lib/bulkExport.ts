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
import { exportFileUri } from '@/shared/storage/cacheFiles';
import { shareExistingFile } from '@/features/settings/lib/shareFile';
import { BulkExportFormat } from 'veloqrs';
import type { BulkExportKind } from '@/features/settings/lib/bulkExportFormat';

export type BulkExportPhase = 'generating' | 'sharing';

export interface BulkExportProgress {
  phase: BulkExportPhase;
  /** Activities visited so far, written or skipped, and how many the export will visit. */
  current: number;
  total: number;
  sizeBytes: number;
}

/** How often the running export is asked how far it has got. */
export const PROGRESS_INTERVAL_MS = 250;

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
  | ({ state: 'complete' } & ExportResult)
  | { state: 'running'; started: StartedExport };

/**
 * What an export skipped, by reason. They are kept apart because the athlete
 * acts on each differently: a trainer ride has nothing to export, a trimmed
 * ride is the privacy setting at work, and a failed one is worth a retry.
 */
export interface BulkExportSkips {
  noTrack: number;
  trimmed: number;
  failed: number;
}

/** What an export asked for now answers with. */
export type BulkExportOutcome =
  | ({ state: 'complete'; exported: number; kind: BulkExportKind } & BulkExportSkips)
  | { state: 'still-running' }
  | { state: 'nothing-pending' };

/**
 * The file a lapsed export still owes the athlete, and the write behind it.
 *
 * Module state rather than storage, the same as the database export next door:
 * the write runs on a Rust thread in this process, so a file owed cannot
 * outlive the process making it.
 */
let pendingExport: (Destination & StartedExport) | null = null;

/** Where an export writes, and what the share sheet is told it is. */
interface Destination {
  uri: string;
  mimeType: string;
  uti: string;
  kind: BulkExportKind;
}

/** What one finished export wrote. */
interface ExportResult extends BulkExportSkips {
  exported: number;
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
  timeoutMs: number = EXPORT_TIMEOUT_MS,
  onStarted?: (started: StartedExport) => void
): Promise<ExportOutcome> {
  const engine = getEngine();
  if (!engine) throw new Error('Route engine not available');

  const started = startExport(engine, format, plainPath);
  onStarted?.(started);
  onProgress?.({ phase: 'generating', current: 0, total: 0, sizeBytes: 0 });

  const ticker = onProgress
    ? setInterval(() => {
        const progress = engine.bulkExportProgress();
        if (!progress.running) return;
        onProgress({
          phase: 'generating',
          current: progress.visited,
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
  /** What the write failed with, kept so a screen that gave up can still say so. */
  failure: () => unknown;
}

function startExport(
  engine: NonNullable<ReturnType<typeof getEngine>>,
  format: BulkExportFormat,
  plainPath: string
): StartedExport {
  let settled = false;
  let result: ExportResult | null = null;
  let failure: unknown = null;
  const work = engine.runBulkExport(format, plainPath).then(
    (written) => {
      settled = true;
      result = written;
      return written;
    },
    (err: unknown) => {
      settled = true;
      failure = err;
      throw err;
    }
  );
  // Nothing has to be waiting when it ends: a screen that gave up reads
  // `settled` when it comes back.
  work.catch(() => {});
  return { work, settled: () => settled, result: () => result, failure: () => failure };
}

/** Strip file:// for Rust, which expects a plain filesystem path. */
const plain = (uri: string) => (uri.startsWith('file://') ? uri.slice(7) : uri);

export async function bulkExportActivities(
  onProgress?: (progress: BulkExportProgress) => void,
  timeoutMs?: number
): Promise<BulkExportOutcome> {
  const destUri = await exportFileUri(`veloq-activities-${formatLocalDate(new Date())}.zip`);
  return exportTo(
    BulkExportFormat.Gpx,
    { uri: destUri, mimeType: 'application/zip', uti: 'public.zip-archive', kind: 'gpx' },
    onProgress,
    timeoutMs
  );
}

export async function bulkExportActivitiesGeoJson(
  onProgress?: (progress: BulkExportProgress) => void,
  timeoutMs?: number
): Promise<BulkExportOutcome> {
  const destUri = await exportFileUri(`veloq-activities-${formatLocalDate(new Date())}.geojson`);
  return exportTo(
    BulkExportFormat.GeoJson,
    { uri: destUri, mimeType: 'application/geo+json', uti: 'public.json', kind: 'geojson' },
    onProgress,
    timeoutMs
  );
}

async function exportTo(
  format: BulkExportFormat,
  destination: Destination,
  onProgress?: (progress: BulkExportProgress) => void,
  timeoutMs?: number
): Promise<BulkExportOutcome> {
  // A run already going holds Rust's export slot, so a second start would only
  // be refused. The tap is answered with that run instead.
  if (pendingExport) return resumePendingBulkExport(onProgress);

  // The run is recorded as it starts rather than when the wait lapses, so a
  // screen that comes back inside the first minute sees it too.
  let slot: (Destination & StartedExport) | null = null;
  let outcome: ExportOutcome;
  try {
    outcome = await runExport(format, plain(destination.uri), onProgress, timeoutMs, (started) => {
      slot = { ...destination, ...started };
      pendingExport = slot;
    });
  } catch (err) {
    // Whichever reader takes the slot first reports the run. Another screen
    // that took it has already said it failed.
    if (slot && pendingExport !== slot) return { state: 'nothing-pending' };
    if (slot) pendingExport = null;
    throw err;
  }
  if (outcome.state === 'running') return { state: 'still-running' };
  if (pendingExport !== slot) return { state: 'nothing-pending' };
  pendingExport = null;
  return finish(outcome, destination, onProgress);
}

/** Share the finished file, saying so while the share sheet is up. */
async function finish(
  written: ExportResult,
  destination: Destination,
  onProgress?: (progress: BulkExportProgress) => void
): Promise<BulkExportOutcome> {
  onProgress?.({
    phase: 'sharing',
    current: written.exported,
    total: written.exported,
    sizeBytes: written.totalBytes,
  });
  await shareAndDelete(destination);

  return completed(written, destination.kind);
}

function completed(written: ExportResult, kind: BulkExportKind): BulkExportOutcome {
  const { exported, noTrack, trimmed, failed } = written;
  return { state: 'complete', exported, noTrack, trimmed, failed, kind };
}

async function shareAndDelete(destination: Destination): Promise<void> {
  await shareExistingFile(destination.uri, destination.mimeType, destination.uti);
  await FileSystem.deleteAsync(destination.uri, { idempotent: true });
}

/**
 * How far the running export has got, or null with none running. Read on the
 * same timer after the foreground wait lapses, since the worker runs on.
 */
export function readBulkExportProgress(): { current: number; total: number } | null {
  const progress = getEngine()?.bulkExportProgress();
  if (!progress?.running) return null;
  return { current: progress.visited, total: progress.total };
}

/** The format a lapsed export is writing, for a screen that comes back to it. */
export function pendingBulkExportKind(): BulkExportKind | null {
  return pendingExport?.kind ?? null;
}

/** Whether a lapsed export still owes the athlete a file. */
export function hasPendingBulkExport(): boolean {
  return pendingExport !== null;
}

/**
 * Release a lapsed export when the library it was reading is wiped. Its file
 * and counts belong to the athlete who left, so nothing is offered to the next.
 */
export function forgetPendingBulkExport(): void {
  pendingExport = null;
}

/**
 * Settles when the lapsed write ends, either way, or at once when none is
 * owed. It never rejects and claims nothing: the caller that is still there
 * afterwards takes the file with `resumePendingBulkExport`, so a screen that
 * was left cannot share it a second time beside the one that came back.
 */
export function pendingBulkExportSettled(): Promise<void> {
  const owed = pendingExport;
  if (!owed) return Promise.resolve();
  return owed.work.then(
    () => undefined,
    () => undefined
  );
}

/**
 * Offer the file a lapsed export left behind, once its write has finished.
 *
 * Read when the export screen mounts and when a write the screen is waiting on
 * ends. A write still going stays owed. One that ended is taken from the slot
 * before anything else, so only the first reader shares it or reports it.
 * A write that failed throws what Rust said, the same as a failure inside the
 * first wait, because the file it was writing is not there to share.
 */
export async function resumePendingBulkExport(
  onProgress?: (progress: BulkExportProgress) => void
): Promise<BulkExportOutcome> {
  const owed = pendingExport;
  if (!owed) return { state: 'nothing-pending' };

  if (!owed.settled()) return { state: 'still-running' };

  pendingExport = null;
  const written = owed.result();
  if (!written) throw owed.failure();

  return finish(written, owed, onProgress);
}
