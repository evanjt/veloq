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
  /**
   * Get the current authenticated athlete using /athlete/me
   * This endpoint works with just the API key (no athlete ID needed)
   * Used during login to discover the athlete ID
   */
  async getCurrentAthlete(): Promise<Athlete> {
    if (isDemoMode()) return mockIntervalsApi.getCurrentAthlete();
    const response = await apiClient.get('/athlete/me');
    return response.data;
  },

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

  async getActivityIntervals(id: string): Promise<IntervalsDTO> {
    if (isDemoMode()) return mockIntervalsApi.getActivityIntervals(id);
    const response = await apiClient.get(`/activity/${id}/intervals`);
    return response.data;
  },

  /**
   * Get power curve (best efforts) for the athlete
   * @param sport - Sport type filter (e.g., 'Ride', 'Run')
   * @param days - Number of days to include (default 365)
   */
  async getPowerCurve(params?: { sport?: string; days?: number }): Promise<PowerCurve> {
    if (isDemoMode()) return mockIntervalsApi.getPowerCurve(params);
    const athleteId = getAthleteId();
    const sportType = params?.sport || 'Ride';
    // Use curves parameter: 1y = 1 year, 90d = 90 days, etc.
    const curvesParam = params?.days ? `${params.days}d` : '1y';

    // Response format: { list: [{ secs: [], values: [], ... }], activities: {} }
    const response = await apiClient.get<{
      list: Array<{ secs: number[]; values: number[]; activity_id?: string[] }>;
    }>(`/athlete/${athleteId}/power-curves.json`, {
      params: { type: sportType, curves: curvesParam },
    });

    // Extract first curve from list and convert to our format
    const curve = response.data?.list?.[0];

    // Return in expected format with watts (values renamed to watts for consistency)
    return {
      secs: curve?.secs || [],
      watts: curve?.values || [],
      activity_ids: curve?.activity_id,
    } as PowerCurve;
  },

  /**
   * Get pace curve (best efforts) for running/swimming
   * @param sport - Sport type filter (e.g., 'Run', 'Swim')
   * @param days - Number of days to include (default 42 to match intervals.icu default)
   * @param gap - If true, return gradient adjusted pace data (running only)
   */
  async getPaceCurve(params?: {
    sport?: string;
    days?: number;
    gap?: boolean;
  }): Promise<PaceCurve> {
    if (isDemoMode()) return mockIntervalsApi.getPaceCurve(params);
    const athleteId = getAthleteId();
    const sportType = params?.sport || 'Run';
    // Use curves parameter - default to 42 days to match intervals.icu default
    const curvesParam = params?.days ? `${params.days}d` : '42d';
    // GAP (gradient adjusted pace) is only available for running
    const useGap = params?.gap && sportType === 'Run';

    // API returns: distance[] (meters), values[] (seconds), paceModels[], and date range
    interface PaceCurveResponse {
      list: Array<{
        distance: number[];
        values: number[]; // seconds to cover each distance (or GAP-adjusted seconds if gap=true)
        activity_id?: string[];
        start_date_local?: string;
        end_date_local?: string;
        days?: number;
        paceModels?: Array<{
          type: string;
          criticalSpeed?: number;
          dPrime?: number;
          r2?: number;
        }>;
      }>;
    }

    const response = await apiClient.get<PaceCurveResponse>(
      `/athlete/${athleteId}/pace-curves.json`,
      {
        params: {
          type: sportType,
          curves: curvesParam,
          gap: useGap || undefined,
        },
      }
    );

    const curve = response.data?.list?.[0];
    const distances = curve?.distance || [];
    const times = curve?.values || []; // seconds to cover each distance

    // Calculate pace (m/s) at each distance
    const pace = distances.map((dist, i) => {
      const time = times[i];
      return time > 0 ? dist / time : 0; // pace in m/s
    });

    // Extract critical speed model data
    const csModel = curve?.paceModels?.find((m) => m.type === 'CS');

    return {
      type: 'pace',
      sport: sportType,
      distances,
      times,
      pace,
      activity_ids: curve?.activity_id,
      criticalSpeed: csModel?.criticalSpeed,
      dPrime: csModel?.dPrime,
      r2: csModel?.r2,
      startDate: curve?.start_date_local,
      endDate: curve?.end_date_local,
      days: curve?.days,
    };
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
   * Get athlete summary (weekly stats) for a date range
   * Returns aggregated stats per calendar week (Monday-Sunday) - matches intervals.icu display
   * @param start - Start date (ISO format: YYYY-MM-DD)
   * @param end - End date (ISO format: YYYY-MM-DD)
   */
  async getAthleteSummary(params: { start: string; end: string }): Promise<AthleteSummary[]> {
    if (isDemoMode()) return mockIntervalsApi.getAthleteSummary(params);
    const athleteId = getAthleteId();
    const response = await apiClient.get<AthleteSummary[]>(
      `/athlete/${athleteId}/athlete-summary`,
      {
        params: {
          start: params.start,
          end: params.end,
        },
      }
    );
    log.log('getAthleteSummary', {
      start: params.start,
      end: params.end,
      weeks: response.data.length,
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

  /**
   * Update an existing activity (name, description, etc.)
   */
  async updateActivity(
    id: string,
    updates: { name?: string; description?: string; type?: string }
  ): Promise<Activity> {
    if (isDemoMode()) return {} as Activity;
    const response = await apiClient.put(`/activity/${id}`, updates);
    return response.data;
  },

  /**
   * Get calendar events (planned workouts, notes, targets) for a date range
   * Uses CALENDAR:READ scope (already authorized)
   * @param oldest - Start date (ISO format: YYYY-MM-DD)
   * @param newest - End date (ISO format: YYYY-MM-DD)
   * @param category - Filter by category (WORKOUT, NOTE, TARGET, SEASON, RACE)
   */
  async getCalendarEvents(params: {
    oldest: string;
    newest: string;
    category?: string;
  }): Promise<CalendarEvent[]> {
    if (isDemoMode()) return mockIntervalsApi.getCalendarEvents(params);
    const athleteId = getAthleteId();
    const response = await apiClient.get<CalendarEvent[]>(`/athlete/${athleteId}/events`, {
      params: { ...params, resolve: true },
    });
    return response.data;
  },
};
