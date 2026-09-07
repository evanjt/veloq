/**
 * Bulk export all activities as a .zip file containing GPX files + metadata JSON.
 *
 * Uses Rust FFI to stream GPS tracks directly from SQLite into a ZIP on disk.
 * Peak memory is ~1 track regardless of activity count.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { getEngine } from '@/shared/native/engine';
import { formatLocalDate } from '@/shared/format/format';
import { shareExistingFile } from '@/features/settings/lib/shareFile';

export type BulkExportPhase = 'generating' | 'sharing';

export interface BulkExportProgress {
  phase: BulkExportPhase;
  sizeBytes: number;
}

export interface BulkExportResult {
  exported: number;
  skipped: number;
}

/**
 * Let the caller's last render reach the screen before the export freezes the
 * thread that would paint it. The write is one blocking FFI call, so a row
 * that announces itself in the same tick announces to nobody.
 */
function paint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function bulkExportActivities(
  onProgress?: (progress: BulkExportProgress) => void
): Promise<BulkExportResult> {
  const engine = getEngine();
  if (!engine) throw new Error('Route engine not available');

  const dateStr = formatLocalDate(new Date());
  const filename = `veloq-activities-${dateStr}.zip`;
  const destUri = `${FileSystem.cacheDirectory}${filename}`;

  // Strip file:// for Rust (expects plain filesystem path)
  const plainPath = destUri.startsWith('file://') ? destUri.slice(7) : destUri;

  onProgress?.({ phase: 'generating', sizeBytes: 0 });
  await paint();

  // Single FFI call - Rust streams all tracks into a ZIP on disk
  const result = engine.bulkExportGpx(plainPath);

  onProgress?.({ phase: 'sharing', sizeBytes: result.totalBytes });
  await shareExistingFile(destUri, 'application/zip', 'public.zip-archive');

  // Clean up temp file
  await FileSystem.deleteAsync(destUri, { idempotent: true });

  return { exported: result.exported, skipped: result.skipped };
}

export async function bulkExportActivitiesGeoJson(
  onProgress?: (progress: BulkExportProgress) => void
): Promise<BulkExportResult> {
  const engine = getEngine();
  if (!engine) throw new Error('Route engine not available');

  const dateStr = formatLocalDate(new Date());
  const filename = `veloq-activities-${dateStr}.geojson`;
  const destUri = `${FileSystem.cacheDirectory}${filename}`;
  const plainPath = destUri.startsWith('file://') ? destUri.slice(7) : destUri;

  onProgress?.({ phase: 'generating', sizeBytes: 0 });
  await paint();

  const result = engine.bulkExportGeoJson(plainPath);

  onProgress?.({ phase: 'sharing', sizeBytes: result.totalBytes });
  await shareExistingFile(destUri, 'application/geo+json', 'public.json');

  await FileSystem.deleteAsync(destUri, { idempotent: true });

  return { exported: result.exported, skipped: result.skipped };
}
