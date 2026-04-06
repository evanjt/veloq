/**
 * Bulk export all activities as a .zip file containing GPX files + metadata JSON.
 *
 * Uses Rust FFI to stream GPS tracks directly from SQLite into a ZIP on disk.
 * Peak memory is ~1 track regardless of activity count.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { getRouteEngine } from '@/lib/native/routeEngine';

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

export async function bulkExportActivities(
  onProgress?: (progress: BulkExportProgress) => void
): Promise<BulkExportResult> {
  const engine = getRouteEngine();
  if (!engine) throw new Error('Route engine not available');

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `veloq-activities-${dateStr}.zip`;
  const destUri = `${FileSystem.cacheDirectory}${filename}`;

  // Strip file:// for Rust (expects plain filesystem path)
  const plainPath = destUri.startsWith('file://') ? destUri.slice(7) : destUri;

  onProgress?.({ phase: 'generating', current: 0, total: 0, sizeBytes: 0 });

  // Single FFI call — Rust streams all tracks into a ZIP on disk
  const result = engine.bulkExportGpx(plainPath);

  onProgress?.({
    phase: 'generating',
    current: result.exported + result.skipped,
    total: result.exported + result.skipped,
    sizeBytes: result.totalBytes,
  });

  // Share the file
  onProgress?.({
    phase: 'sharing',
    current: result.exported,
    total: result.exported,
    sizeBytes: result.totalBytes,
  });
  const Sharing = await import('expo-sharing');
  await Sharing.shareAsync(destUri, {
    mimeType: 'application/zip',
    UTI: 'public.zip-archive',
  });

  // Clean up temp file
  await FileSystem.deleteAsync(destUri, { idempotent: true });

  return { exported: result.exported, skipped: result.skipped };
}

export async function bulkExportActivitiesGeoJson(
  onProgress?: (progress: BulkExportProgress) => void
): Promise<BulkExportResult> {
  const engine = getRouteEngine();
  if (!engine) throw new Error('Route engine not available');

  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `veloq-activities-${dateStr}.geojson`;
  const destUri = `${FileSystem.cacheDirectory}${filename}`;
  const plainPath = destUri.startsWith('file://') ? destUri.slice(7) : destUri;

  onProgress?.({ phase: 'generating', current: 0, total: 0, sizeBytes: 0 });

  const result = engine.bulkExportGeoJson(plainPath);

  onProgress?.({
    phase: 'sharing',
    current: result.exported,
    total: result.exported,
    sizeBytes: result.totalBytes,
  });
  const Sharing = await import('expo-sharing');
  await Sharing.shareAsync(destUri, {
    mimeType: 'application/geo+json',
    UTI: 'public.json',
  });

  await FileSystem.deleteAsync(destUri, { idempotent: true });

  return { exported: result.exported, skipped: result.skipped };
}
