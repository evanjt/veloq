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

  async getActivities(params?: {
    oldest?: string;
    newest?: string;
  }): Promise<Activity[]> {
    const athleteId = getAthleteId();

    // Default to last 30 days if no params provided
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const queryParams = {
      oldest: params?.oldest || formatLocalDate(thirtyDaysAgo),
      newest: params?.newest || formatLocalDate(today),
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
   * @param oldest - Start date (YYYY-MM-DD)
   * @param newest - End date (YYYY-MM-DD)
   */
  async getPowerCurve(params?: {
    sport?: string;
    oldest?: string;
    newest?: string;
  }): Promise<PowerCurve> {
    const athleteId = getAthleteId();

    // Default to this season (current year) if no dates
    const today = new Date();
    const yearStart = new Date(today.getFullYear(), 0, 1);

    const queryParams: Record<string, string> = {
      oldest: params?.oldest || formatLocalDate(yearStart),
      newest: params?.newest || formatLocalDate(today),
    };

    // Only add sport filter if explicitly provided (API may not support it)
    if (params?.sport) {
      queryParams.type = params.sport; // Try 'type' instead of 'sport'
    }

    const response = await apiClient.get<PowerCurve>(`/athlete/${athleteId}/power-curves`, {
      params: queryParams,
    });
    return response.data;
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
