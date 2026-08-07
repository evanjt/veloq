import { apiClient, getAthleteId } from './client';
import { useAuthStore, DEMO_ATHLETE_ID } from '@/shared/app/AuthStore';
import type { ManualActivityData, UploadResponse } from '@/types';

/**
 * The intervals.icu write surface.
 *
 * Every read moved into the Rust engine: it owns the transport, the rate
 * governor, retry and 401 classification, and it persists what it fetches so
 * screens read SQLite. What is left is the two writes, which still go through
 * axios because Rust's transport is GET-only.
 *
 * Demo mode has no upstream account, so a write is acknowledged locally rather
 * than sent. Reads need no such fork any more: demo seeds the same tables a
 * live sync fills.
 */
function isDemoMode(): boolean {
  const state = useAuthStore.getState();
  return state.isDemoMode || state.athleteId === DEMO_ATHLETE_ID;
}

export const intervalsApi = {
  /**
   * Upload a FIT/GPX/TCX file to create a new activity
   * Uses multipart/form-data for file upload
   */
  async uploadActivity(
    file: ArrayBuffer,
    filename: string,
    opts?: { name?: string; pairedEventId?: number }
  ): Promise<UploadResponse> {
    if (isDemoMode()) {
      return {
        id: `demo-${Date.now()}`,
        name: opts?.name || filename,
        type: 'Ride',
        start_date_local: new Date().toISOString(),
      };
    }
    const athleteId = getAthleteId();

    // Write binary to temp file (RN Blob doesn't support ArrayBuffer)
    const FileSystem = require('expo-file-system/legacy');
    const tempPath = `${FileSystem.cacheDirectory}${Date.now()}_${filename}`;
    const bytes = new Uint8Array(file);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    await FileSystem.writeAsStringAsync(tempPath, btoa(binary), {
      encoding: FileSystem.EncodingType.Base64,
    });

    const formData = new FormData();
    formData.append('file', {
      uri: tempPath,
      type: 'application/octet-stream',
      name: filename,
    } as any);
    if (opts?.name) formData.append('name', opts.name);
    if (opts?.pairedEventId) formData.append('paired_event_id', String(opts.pairedEventId));
    formData.append('device_name', 'Veloq');

    try {
      const response = await apiClient.post(`/athlete/${athleteId}/activities`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      return response.data;
    } finally {
      FileSystem.deleteAsync(tempPath, { idempotent: true }).catch(() => {});
    }
  },

  /**
   * Create a manual activity (no file upload)
   * For activities like WeightTraining, Yoga, etc.
   */
  async createManualActivity(data: ManualActivityData): Promise<UploadResponse> {
    if (isDemoMode()) {
      return {
        id: `demo-${Date.now()}`,
        name: data.name,
        type: data.type,
        start_date_local: data.start_date_local,
      };
    }
    const athleteId = getAthleteId();
    const response = await apiClient.post(`/athlete/${athleteId}/activities`, {
      ...data,
      trainer: data.trainer ?? false,
      commute: data.commute ?? false,
    });
    return response.data;
  },
};
