import { useQuery } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import { useAuthStore } from '@/store';
import { useEffect } from 'react';

export function useAthlete() {
  const setAthlete = useAuthStore((state) => state.setAthlete);

  const query = useQuery({
    queryKey: ['athlete'],
    queryFn: () => intervalsApi.getAthlete(),
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });

  useEffect(() => {
    if (query.data) {
      setAthlete(query.data);
    }
  }, [query.data, setAthlete]);

  return query;
}
