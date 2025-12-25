import { apiClient, getAthleteId } from './client';
import { formatLocalDate, parseStreams } from '@/lib';
import { rateLimiter, executeWithWorkerPool } from '@/lib/adaptiveRateLimiter';
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
   * @param days - Number of days to include (default 42 to match intervals.icu default)
   * @param gap - If true, return gradient adjusted pace data (running only)
   */
  async getPaceCurve(params?: {
    sport?: string;
    days?: number;
    gap?: boolean;
  }): Promise<PaceCurve> {
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
      { params: { type: sportType, curves: curvesParam, gap: useGap || undefined } }
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
    const csModel = curve?.paceModels?.find(m => m.type === 'CS');

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
   * Fetch activity map data with full GPS tracks using worker pool.
   *
   * This function adheres to the API rate limits stated here:
   * https://forum.intervals.icu/t/solved-guidance-on-api-rate-limits-for-bulk-activity-reloading/110818
   *
   * Uses a worker pool model where N workers constantly pull from a queue.
   * As soon as one request completes, that worker immediately starts the next.
   * This maximizes throughput - slow requests don't block others.
   *
   * Rate limits enforced:
   * - 30 req/s burst (hard limit)
   * - 132 req/10s sustained (sliding window)
   * - Automatic backoff and retry on 429 errors
   *
   * @param ids - Activity IDs to fetch
   * @param _concurrency - Ignored, uses adaptive rate limiter (starts at 20 workers)
   * @param onProgress - Callback for progress updates
   * @param abortSignal - Optional abort signal to cancel the operation
   */
  async getActivityMapBounds(
    ids: string[],
    _concurrency = 3,
    onProgress?: (completed: number, total: number) => void,
    abortSignal?: AbortSignal
  ): Promise<Map<string, ActivityMapData>> {
    // Reset rate limiter for fresh sync
    rateLimiter.reset();

    const startTime = Date.now();
    const workerCount = rateLimiter.getConcurrency();
    console.log(`🚀 [API] Starting worker pool: ${ids.length} activities, ${workerCount} workers`);

    // Use worker pool - each worker continuously processes items
    const indexedResults = await executeWithWorkerPool(
      ids,
      async (id: string) => {
        // Fetch FULL map data including GPS track (not boundsOnly)
        const data = await this.getActivityMap(id, false);
        return { id, data };
      },
      onProgress,
      abortSignal
    );

    // Convert indexed results to Map<id, data>
    const results = new Map<string, ActivityMapData>();
    for (const [_index, result] of indexedResults) {
      results.set(result.id, result.data);
    }

    const elapsed = Date.now() - startTime;
    const stats = rateLimiter.getStats();
    const reqPerSec = (stats.total / (elapsed / 1000)).toFixed(1);
    console.log(`✅ [API] Fetched ${results.size}/${ids.length} in ${elapsed}ms (${reqPerSec} req/s, ${stats.retries} retries, ${stats.rateLimits} rate limits)`);

    return results;
  },
};
