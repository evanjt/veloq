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
    queryFn: () =>
      intervalsApi.getActivityStreams(id, [
        'latlng',
        'altitude',
        'fixed_altitude',
        'heartrate',
        'watts',
        'cadence',
        'distance',
        'time',
      ]),
    staleTime: Infinity, // Streams never change
    gcTime: 1000 * 60 * 60 * 24 * 30, // 30 days
    enabled: !!id,
  });
}
