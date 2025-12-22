import { apiClient, getAthleteId } from './client';
import { formatLocalDate, parseStreams } from '@/lib';
import type {
  Activity,
  ActivityDetail,
  ActivityStreams,
  Athlete,
  WellnessData,
  PowerCurve,
  PaceCurve,
  SportSettings,
  ActivityMapData,
  RawStreamItem,
} from '@/types';

export const intervalsApi = {
  async getAthlete(): Promise<Athlete> {
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
    const response = await apiClient.get('/athlete/me');
    return response.data;
  },

  async getActivities(params?: {
    oldest?: string;
    newest?: string;
    /** Include additional fields for stats (eFTP, zone times, etc.) */
    includeStats?: boolean;
  }): Promise<Activity[]> {
    const athleteId = getAthleteId();

    // Default to last 30 days if no params provided
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Base fields always included (most important for activity list)
    // Note: polyline is NOT returned by the API (would need streams endpoint)
    const baseFields = [
      'id', 'name', 'type', 'start_date_local', 'moving_time', 'elapsed_time',
      'distance', 'total_elevation_gain', 'average_speed', 'max_speed',
      'icu_average_hr', 'icu_max_hr', 'average_heartrate', 'average_watts', 'max_watts', 'icu_average_watts',
      'average_cadence', 'calories', 'icu_training_load',
      'has_weather', 'average_weather_temp', 'icu_ftp', 'stream_types',
      'locality', 'country', // Location info
    ];

    // Stats fields for performance/stats page
    // Note: icu_zone_times = power zones, icu_hr_zone_times = HR zones, icu_pm_ftp_watts = eFTP
    const statsFields = [
      'icu_pm_ftp_watts', 'icu_zone_times', 'icu_hr_zone_times', 'icu_power_zones', 'icu_hr_zones',
    ];

    const fields = params?.includeStats
      ? [...baseFields, ...statsFields].join(',')
      : baseFields.join(',');

    const queryParams = {
      oldest: params?.oldest || formatLocalDate(thirtyDaysAgo),
      newest: params?.newest || formatLocalDate(today),
      fields,
    };

    const response = await apiClient.get(`/athlete/${athleteId}/activities`, {
      params: queryParams,
    });
    return response.data;
  },

  async getActivity(id: string): Promise<ActivityDetail> {
    const response = await apiClient.get(`/activity/${id}`);
    return response.data;
  },

  /**
   * Get the oldest activity date for the athlete
   * Used to determine the full timeline range
   */
  async getOldestActivityDate(): Promise<string | null> {
    const athleteId = getAthleteId();
    // Query with a very old date to find the actual oldest activity
    const response = await apiClient.get(`/athlete/${athleteId}/activities`, {
      params: {
        oldest: '2000-01-01',
        newest: formatLocalDate(new Date()),
        fields: 'id,start_date_local',
      },
    });
    const activities = response.data as Activity[];
    if (activities.length === 0) return null;
    // Find the oldest activity date
    return activities.reduce((oldest, a) =>
      a.start_date_local < oldest ? a.start_date_local : oldest,
      activities[0].start_date_local
    );
  },

  async getActivityStreams(
    id: string,
    types?: string[]
  ): Promise<ActivityStreams> {
    // Note: intervals.icu requires .json suffix for streams endpoint
    const response = await apiClient.get<RawStreamItem[]>(`/activity/${id}/streams.json`, {
      params: types ? { types: types.join(',') } : undefined,
    });
    // Transform raw streams array into usable object format
    return parseStreams(response.data);
  },

  async getWellness(params?: {
    oldest?: string;
    newest?: string;
  }): Promise<WellnessData[]> {
    const athleteId = getAthleteId();

    // Default to last 90 days if no params provided
    const today = new Date();
    const ninetyDaysAgo = new Date(today);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const queryParams = {
      oldest: params?.oldest || formatLocalDate(ninetyDaysAgo),
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
  async getPowerCurve(params?: {
    sport?: string;
    days?: number;
  }): Promise<PowerCurve> {
    const athleteId = getAthleteId();
    const sportType = params?.sport || 'Ride';
    // Use curves parameter: 1y = 1 year, 90d = 90 days, etc.
    const curvesParam = params?.days ? `${params.days}d` : '1y';

    // Response format: { list: [{ secs: [], values: [], ... }], activities: {} }
    const response = await apiClient.get<{ list: Array<{ secs: number[]; values: number[] }> }>(
      `/athlete/${athleteId}/power-curves.json`,
      { params: { type: sportType, curves: curvesParam } }
    );

    // Extract first curve from list and convert to our format
    const curve = response.data?.list?.[0];

    // Return in expected format with watts (values renamed to watts for consistency)
    return {
      secs: curve?.secs || [],
      watts: curve?.values || [],
    } as PowerCurve;
  },

  /**
   * Get pace curve (best efforts) for running/swimming
   * @param sport - Sport type filter (e.g., 'Run', 'Swim')
   * @param days - Number of days to include (default 365)
   */
  async getPaceCurve(params?: {
    sport?: string;
    days?: number;
  }): Promise<PaceCurve> {
    const athleteId = getAthleteId();
    const sportType = params?.sport || 'Run';
    // Use curves parameter similar to power curves
    const curvesParam = params?.days ? `${params.days}d` : '1y';

    // API returns: distance[] (meters) and values[] (time in seconds to cover that distance)
    interface PaceCurveResponse {
      list: Array<{
        distance: number[];
        values: number[]; // seconds to cover each distance
        paceModels?: Array<{ type: string; criticalSpeed: number }>;
      }>;
    }

    const response = await apiClient.get<PaceCurveResponse>(
      `/athlete/${athleteId}/pace-curves.json`,
      { params: { type: sportType, curves: curvesParam } }
    );

    const curve = response.data?.list?.[0];
    const distances = curve?.distance || [];
    const times = curve?.values || []; // seconds

    // Convert distance/time pairs to pace (m/s) at each time duration
    // We want: secs[] (durations) and pace[] (m/s at that duration)
    const pace = distances.map((dist, i) => {
      const time = times[i];
      return time > 0 ? dist / time : 0; // pace in m/s
    });

    // Extract critical speed from pace models if available (for threshold pace)
    const criticalSpeed = curve?.paceModels?.find(m => m.type === 'CS')?.criticalSpeed;

    return {
      type: 'pace',
      sport: sportType,
      secs: times, // Use times as durations (secs)
      pace, // Calculated pace in m/s
      criticalSpeed, // Add critical speed for threshold pace
    } as PaceCurve;
  },

  /**
   * Get sport settings including zones
   */
  async getSportSettings(): Promise<SportSettings[]> {
    const athleteId = getAthleteId();
    const response = await apiClient.get<SportSettings[]>(`/athlete/${athleteId}/sport-settings`);
    return response.data;
  },

  /**
   * Get athlete profile with settings
   */
  async getAthleteProfile(): Promise<Athlete & { sport_settings?: SportSettings[] }> {
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
    const response = await apiClient.get<ActivityMapData>(`/activity/${id}/map`, {
      params: boundsOnly ? { boundsOnly: true } : undefined,
    });
    return response.data;
  },

  /**
   * Batch fetch activity map bounds (respects rate limiting)
   * @param ids - Activity IDs to fetch
   * @param concurrency - Number of parallel requests (default 3, per API rate limits)
   * @param onProgress - Callback for progress updates
   * @param abortSignal - Optional abort signal to cancel the operation
   * @see https://forum.intervals.icu/t/solved-guidance-on-api-rate-limits-for-bulk-activity-reloading/110818
   */
  async getActivityMapBounds(
    ids: string[],
    concurrency = 3,
    onProgress?: (completed: number, total: number) => void,
    abortSignal?: AbortSignal
  ): Promise<Map<string, ActivityMapData>> {
    const results = new Map<string, ActivityMapData>();
    let completed = 0;

    // Process in batches
    for (let i = 0; i < ids.length; i += concurrency) {
      // Check if aborted before starting new batch
      if (abortSignal?.aborted) {
        throw new DOMException('Sync cancelled', 'AbortError');
      }

      const batch = ids.slice(i, i + concurrency);
      const promises = batch.map(async (id) => {
        try {
          const data = await this.getActivityMap(id, true);
          results.set(id, data);
        } catch {
          // Skip failed requests
          console.warn(`Failed to fetch map for activity ${id}`);
        }
      });

      await Promise.all(promises);
      completed += batch.length;

      // Check again after batch completes
      if (abortSignal?.aborted) {
        throw new DOMException('Sync cancelled', 'AbortError');
      }

      onProgress?.(completed, ids.length);
    }

    return results;
  },
};
