import { apiClient, getAthleteId } from './client';
import { formatLocalDate, parseStreams, debug } from '@/lib';
import { useAuthStore, DEMO_ATHLETE_ID } from '@/providers/AuthStore';
import { mockIntervalsApi } from './mockIntervals';
import { API_DEFAULTS } from '@/lib/utils/constants';

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
  IntervalsDTO,
} from '@/types';

// Check if we're in demo mode
function isDemoMode(): boolean {
  const state = useAuthStore.getState();
  return state.isDemoMode || state.athleteId === DEMO_ATHLETE_ID;
}

export const intervalsApi = {
  async getAthlete(): Promise<Athlete> {
    if (isDemoMode()) return mockIntervalsApi.getAthlete();
    const athleteId = getAthleteId();
    const response = await apiClient.get(`/athlete/${athleteId}`);
    return response.data;
  },

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

  async getActivities(params?: {
    oldest?: string;
    newest?: string;
    /** Include additional fields for stats (eFTP, zone times, etc.) */
    includeStats?: boolean;
  }): Promise<Activity[]> {
    if (isDemoMode()) return mockIntervalsApi.getActivities(params);
    const athleteId = getAthleteId();

    // Default to last N days if no params provided
    const today = new Date();
    const defaultStart = new Date(today);
    defaultStart.setDate(defaultStart.getDate() - API_DEFAULTS.ACTIVITY_DAYS);

    // Base fields always included (most important for activity list)
    // Note: polyline is NOT returned by the API (would need streams endpoint)
    const baseFields = [
      'id',
      'name',
      'type',
      'start_date_local',
      'moving_time',
      'elapsed_time',
      'distance',
      'total_elevation_gain',
      'average_speed',
      'max_speed',
      'icu_average_hr',
      'icu_max_hr',
      'average_heartrate',
      'average_watts',
      'max_watts',
      'icu_average_watts',
      'average_cadence',
      'calories',
      'icu_training_load',
      'has_weather',
      'average_weather_temp',
      'icu_ftp',
      'stream_types',
      'locality',
      'country', // Location info
      'skyline_chart_bytes',
    ];

    // Stats fields for performance/stats page
    // Note: icu_zone_times = power zones, icu_hr_zone_times = HR zones, icu_pm_ftp_watts = eFTP
    const statsFields = [
      'icu_pm_ftp_watts',
      'icu_zone_times',
      'icu_hr_zone_times',
      'icu_power_zones',
      'icu_hr_zones',
    ];

    const fields = params?.includeStats
      ? [...baseFields, ...statsFields].join(',')
      : baseFields.join(',');

    const queryParams = {
      oldest: params?.oldest || formatLocalDate(defaultStart),
      newest: params?.newest || formatLocalDate(today),
      fields,
    };

    const response = await apiClient.get(`/athlete/${athleteId}/activities`, {
      params: queryParams,
    });
    return response.data;
  },

  async getActivity(id: string): Promise<ActivityDetail> {
    if (isDemoMode()) return mockIntervalsApi.getActivity(id);
    const response = await apiClient.get(`/activity/${id}`);
    return response.data;
  },

  /**
   * Get the oldest activity date for the athlete.
   * Used to determine the full timeline range for the date slider.
   *
   * Single API call fetching all activity dates with minimal fields (~68KB for 1366 activities).
   * intervals.icu returns newest-first, so the oldest is the last element.
   */
  async getOldestActivityDate(): Promise<string | null> {
    if (isDemoMode()) return mockIntervalsApi.getOldestActivityDate();
    const athleteId = getAthleteId();

    try {
      const response = await apiClient.get(`/athlete/${athleteId}/activities`, {
        params: {
          oldest: '2000-01-01',
          newest: formatLocalDate(new Date()),
          fields: 'id,start_date_local',
        },
      });

      const activities = response.data as Activity[];
      if (activities.length === 0) return null;

      // intervals.icu returns newest-first, so find the minimum date
      return activities.reduce(
        (oldest, a) => (a.start_date_local < oldest ? a.start_date_local : oldest),
        activities[0].start_date_local
      );
    } catch {
      return null;
    }
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

  async getWellness(params?: { oldest?: string; newest?: string }): Promise<WellnessData[]> {
    if (isDemoMode()) return mockIntervalsApi.getWellness(params);
    const athleteId = getAthleteId();

    // Default to last N days if no params provided
    const today = new Date();
    const defaultStart = new Date(today);
    defaultStart.setDate(defaultStart.getDate() - API_DEFAULTS.WELLNESS_DAYS);

    const queryParams = {
      oldest: params?.oldest || formatLocalDate(defaultStart),
      newest: params?.newest || formatLocalDate(today),
    };

    const response = await apiClient.get<WellnessData[]>(`/athlete/${athleteId}/wellness`, {
      params: queryParams,
    });
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
   * Get sport settings including zones
   */
  async getSportSettings(): Promise<SportSettings[]> {
    if (isDemoMode()) return mockIntervalsApi.getSportSettings();
    const athleteId = getAthleteId();
    const response = await apiClient.get<SportSettings[]>(`/athlete/${athleteId}/sport-settings`);
    return response.data;
  },

  /**
   * Get athlete profile with settings
   */
  async getAthleteProfile(): Promise<Athlete & { sport_settings?: SportSettings[] }> {
    if (isDemoMode()) return mockIntervalsApi.getAthleteProfile();
    const athleteId = getAthleteId();
    const response = await apiClient.get(`/athlete/${athleteId}`);
    return response.data;
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
};
