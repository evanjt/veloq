import { apiClient, getAthleteId } from './client';
import type { Activity, ActivityDetail, ActivityStreams, RawStreamItem, Athlete } from '@/types';

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
      oldest: params?.oldest || thirtyDaysAgo.toISOString().split('T')[0],
      newest: params?.newest || today.toISOString().split('T')[0],
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
};
