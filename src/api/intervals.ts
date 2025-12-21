import { apiClient, getAthleteId } from './client';
import { formatLocalDate } from '@/lib';
import type {
  Activity,
  ActivityDetail,
  ActivityStreams,
  RawStreamItem,
  Athlete,
  WellnessData,
  PowerCurve,
  PaceCurve,
  SportSettings,
  ActivityMapData,
} from '@/types';

// Transform raw API streams array into usable ActivityStreams object
function parseStreams(rawStreams: RawStreamItem[]): ActivityStreams {
  const streams: ActivityStreams = {};

  for (const stream of rawStreams) {
    switch (stream.type) {
      case 'latlng':
        // latlng uses data for lat, data2 for lng - combine into [lat, lng] tuples
        if (stream.data && stream.data2) {
          streams.latlng = stream.data.map((lat, i) => [lat, stream.data2![i]]);
        }
        break;
      case 'time':
        streams.time = stream.data;
        break;
      case 'altitude':
      case 'fixed_altitude':
        // Use fixed_altitude if available (corrected elevation), fallback to altitude
        if (!streams.altitude || stream.type === 'fixed_altitude') {
          streams.altitude = stream.data;
        }
        break;
      case 'heartrate':
        streams.heartrate = stream.data;
        break;
      case 'watts':
        streams.watts = stream.data;
        break;
      case 'cadence':
        streams.cadence = stream.data;
        break;
      case 'velocity_smooth':
        streams.velocity_smooth = stream.data;
        break;
      case 'distance':
        streams.distance = stream.data;
        break;
    }
  }

  return streams;
}

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
    const baseFields = [
      'id', 'name', 'type', 'start_date_local', 'moving_time', 'elapsed_time',
      'distance', 'total_elevation_gain', 'average_speed', 'max_speed',
      'icu_average_hr', 'icu_max_hr', 'average_heartrate', 'average_watts', 'max_watts', 'icu_average_watts',
      'average_cadence', 'calories', 'polyline', 'icu_training_load',
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
   * Get pace curve (best efforts) for running
   * @param sport - Sport type filter (e.g., 'Run')
   * @param oldest - Start date (YYYY-MM-DD)
   * @param newest - End date (YYYY-MM-DD)
   */
  async getPaceCurve(params?: {
    sport?: string;
    oldest?: string;
    newest?: string;
  }): Promise<PaceCurve> {
    const athleteId = getAthleteId();

    const today = new Date();
    const yearStart = new Date(today.getFullYear(), 0, 1);

    const queryParams = {
      oldest: params?.oldest || formatLocalDate(yearStart),
      newest: params?.newest || formatLocalDate(today),
      ...(params?.sport && { sport: params.sport }),
    };

    const response = await apiClient.get<PaceCurve>(`/athlete/${athleteId}/pace-curves.json`, {
      params: queryParams,
    });
    return response.data;
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
   * @see https://forum.intervals.icu/t/solved-guidance-on-api-rate-limits-for-bulk-activity-reloading/110818
   */
  async getActivityMapBounds(
    ids: string[],
    concurrency = 3,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, ActivityMapData>> {
    const results = new Map<string, ActivityMapData>();
    let completed = 0;

    // Process in batches
    for (let i = 0; i < ids.length; i += concurrency) {
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
      onProgress?.(completed, ids.length);
    }

    return results;
  },
};
