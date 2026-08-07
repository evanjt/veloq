import { apiClient, getAthleteId } from './client';
import { parseStreams } from '@/features/activity/lib/streams';
import { debug } from '@/shared/debug/debug';
import { formatLocalDate } from '@/shared/format/format';
import { useAuthStore, DEMO_ATHLETE_ID } from '@/shared/app/AuthStore';
import { mockIntervalsApi } from './mockIntervals';
import { API_DEFAULTS } from '@/shared/app/constants';

const log = debug.create('API');
import type {
  Activity,
  ActivityDetail,
  ActivityStreams,
  Athlete,
  AthleteSummary,
  WellnessData,
  PowerCurve,
  PaceCurve,
  SportSettings,
  ActivityMapData,
  RawStreamItem,
  CalendarEvent,
  IntervalsDTO,
  UploadResponse,
  ManualActivityData,
} from '@/types';

// Check if we're in demo mode
function isDemoMode(): boolean {
  const state = useAuthStore.getState();
  return state.isDemoMode || state.athleteId === DEMO_ATHLETE_ID;
}

export const intervalsApi = {
  async getActivity(id: string): Promise<ActivityDetail> {
    if (isDemoMode()) return mockIntervalsApi.getActivity(id);
    const response = await apiClient.get(`/activity/${id}`);
    return response.data;
  },

  async getActivityStreams(id: string, types?: string[]): Promise<ActivityStreams> {
    if (isDemoMode()) return mockIntervalsApi.getActivityStreams(id, types);
    // Note: intervals.icu requires .json suffix for streams endpoint
    const response = await apiClient.get<RawStreamItem[]>(`/activity/${id}/streams.json`, {
      params: types ? { types: types.join(',') } : undefined,
    });
    // Transform raw streams array into usable object format
    return parseStreams(response.data);
  },

  /**
   * Get activity map data (bounds and/or coordinates)
   * @param id - Activity ID
   * @param boundsOnly - If true, only returns bounds (faster, smaller response)
   */
  async getActivityMap(id: string, boundsOnly = false): Promise<ActivityMapData> {
    if (isDemoMode()) {
      const result = await mockIntervalsApi.getActivityMap(id, boundsOnly);
      if (!result) {
        return { bounds: null, latlngs: null, route: null, weather: null };
      }
      return result;
    }
    const response = await apiClient.get<ActivityMapData>(`/activity/${id}/map`, {
      params: boundsOnly ? { boundsOnly: true } : undefined,
    });
    return response.data;
  },

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
