import { useQuery } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import type { Activity } from '@/types';

export function useActivities() {
  return useQuery<Activity[]>({
    queryKey: ['activities'],
    queryFn: () => intervalsApi.getActivities(),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days
  });
}

export function useActivity(id: string) {
  return useQuery({
    queryKey: ['activity', id],
    queryFn: () => intervalsApi.getActivity(id),
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24 * 30, // 30 days
    enabled: !!id,
  });
}

export function useActivityStreams(id: string) {
  return useQuery({
    // v2: fixed parsing of latlng data (data + data2)
    queryKey: ['activity-streams-v2', id],
    queryFn: async () => {
      console.log('Fetching streams for activity:', id);
      try {
        // Explicitly request latlng and other useful streams
        const streams = await intervalsApi.getActivityStreams(id, [
          'latlng',
          'altitude',
          'fixed_altitude',
          'heartrate',
          'watts',
          'cadence',
          'distance',
          'time',
        ]);
        console.log('Streams fetched successfully, keys:', Object.keys(streams || {}));
        console.log('Has latlng:', !!streams.latlng, 'count:', streams.latlng?.length || 0);
        if (streams.latlng && streams.latlng.length > 0) {
          console.log('First latlng:', streams.latlng[0]);
        }
        return streams;
      } catch (error) {
        console.error('Failed to fetch streams:', error);
        throw error;
      }
    },
    staleTime: Infinity, // Streams never change
    gcTime: 1000 * 60 * 60 * 24 * 30, // 30 days
    enabled: !!id,
  });
}
