/**
 * Mock API for demo mode
 * Returns static demo data instead of making real API calls
 */
import {
  demoAthlete,
  demoActivities,
  demoWellness,
  demoPowerCurve,
  demoPaceCurve,
  demoSportSettings,
} from '@/data/demo';
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
} from '@/types';

// Helper to filter by date range
function filterByDateRange<T extends { id?: string; start_date_local?: string }>(
  items: T[],
  oldest?: string,
  newest?: string
): T[] {
  return items.filter((item) => {
    const dateStr = item.start_date_local || item.id;
    if (!dateStr) return true;
    const date = new Date(dateStr);
    if (oldest && date < new Date(oldest)) return false;
    if (newest && date > new Date(newest)) return false;
    return true;
  });
}

// Simulate network delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const mockIntervalsApi = {
  async getAthlete(): Promise<Athlete> {
    await delay(100);
    return demoAthlete;
  },

  async getCurrentAthlete(): Promise<Athlete> {
    await delay(100);
    return demoAthlete;
  },

  async getActivities(params?: {
    oldest?: string;
    newest?: string;
    includeStats?: boolean;
  }): Promise<Activity[]> {
    await delay(200);
    return filterByDateRange(demoActivities, params?.oldest, params?.newest);
  },

  async getActivity(id: string): Promise<ActivityDetail> {
    await delay(150);
    const activity = demoActivities.find((a) => a.id === id);
    if (!activity) throw new Error('Activity not found');
    return activity as ActivityDetail;
  },

  async getOldestActivityDate(): Promise<string | null> {
    await delay(50);
    if (demoActivities.length === 0) return null;
    return demoActivities[0].start_date_local;
  },

  async getActivityStreams(id: string, types?: string[]): Promise<ActivityStreams> {
    await delay(200);
    // Generate fake stream data for demo
    const activity = demoActivities.find((a) => a.id === id);
    const points = activity?.moving_time ? Math.floor(activity.moving_time / 5) : 100;

    // Generate realistic-looking data
    const time = Array.from({ length: points }, (_, i) => i * 5);
    const heartrate = time.map((_, i) => {
      const base = activity?.icu_average_hr || 140;
      const warmup = Math.min(i / 20, 1);
      return Math.round(base * 0.7 + base * 0.3 * warmup + (Math.random() * 10 - 5));
    });
    const watts = activity?.icu_average_watts
      ? time.map(() => {
          const base = activity.icu_average_watts || 180;
          return Math.round(base + (Math.random() * 40 - 20));
        })
      : undefined;
    const altitude = time.map((_, i) => {
      return 100 + Math.sin(i / 20) * 50 + Math.random() * 10;
    });
    // Simple lat/lng around a central point (demo location) as [lat, lng] tuples
    const latlng: [number, number][] = time.map((_, i) => [
      -33.8688 + Math.sin(i / 30) * 0.01,
      151.2093 + Math.cos(i / 30) * 0.01,
    ]);

    return {
      time,
      heartrate,
      watts,
      altitude,
      latlng,
    };
  },

  async getWellness(params?: {
    oldest?: string;
    newest?: string;
  }): Promise<WellnessData[]> {
    await delay(150);
    return filterByDateRange(demoWellness, params?.oldest, params?.newest);
  },

  async getPowerCurve(params?: {
    sport?: string;
    days?: number;
  }): Promise<PowerCurve> {
    await delay(100);
    return demoPowerCurve;
  },

  async getPaceCurve(params?: {
    sport?: string;
    days?: number;
    gap?: boolean;
  }): Promise<PaceCurve> {
    await delay(100);
    return demoPaceCurve;
  },

  async getSportSettings(): Promise<SportSettings[]> {
    await delay(100);
    return demoSportSettings as SportSettings[];
  },

  async getAthleteProfile(): Promise<Athlete & { sport_settings?: SportSettings[] }> {
    await delay(100);
    return {
      ...demoAthlete,
      sport_settings: demoSportSettings as SportSettings[],
    };
  },

  async getActivityMap(id: string, boundsOnly = false): Promise<ActivityMapData> {
    await delay(100);
    // Return bounds centered on Sydney for demo: [[minLat, minLng], [maxLat, maxLng]]
    const bounds: [[number, number], [number, number]] = [
      [-33.88, 151.20],
      [-33.86, 151.22],
    ];
    const latlngs: [number, number][] = boundsOnly
      ? []
      : [
          [-33.8688, 151.2093],
          [-33.87, 151.21],
          [-33.868, 151.211],
          [-33.867, 151.21],
          [-33.8688, 151.2093],
        ];
    return {
      bounds,
      latlngs: boundsOnly ? null : latlngs,
      route: null,
      weather: null,
    };
  },
};
