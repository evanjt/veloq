/**
 * Mock API for demo mode
 *
 * Returns fixture data that matches the real Intervals.icu API response format.
 * This ensures demo mode behaves identically to real mode, and can be used
 * for end-to-end testing as well.
 */
import {
  fixtures,
  getActivity,
  getActivities,
  getActivityMap,
  getActivityStreams,
  getWellness,
} from '@/data/demo/fixtures';
import { demoPowerCurve, demoPaceCurve, demoSportSettings } from '@/data/demo';
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

// Simulate network delay for realistic UX
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mock implementation of the Intervals.icu API
 *
 * All methods return data in the same format as the real API,
 * making this suitable for both demo mode and testing.
 */
export const mockIntervalsApi = {
  /**
   * Get athlete profile
   */
  async getAthlete(): Promise<Athlete> {
    await delay(100);
    return fixtures.athlete as Athlete;
  },

  /**
   * Get current athlete (same as getAthlete for demo)
   */
  async getCurrentAthlete(): Promise<Athlete> {
    await delay(100);
    return fixtures.athlete as Athlete;
  },

  /**
   * Get activities with optional date filtering
   */
  async getActivities(params?: {
    oldest?: string;
    newest?: string;
    includeStats?: boolean;
  }): Promise<Activity[]> {
    await delay(200);
    const activities = getActivities({
      oldest: params?.oldest,
      newest: params?.newest,
    });
    return activities as Activity[];
  },

  /**
   * Get a single activity by ID
   */
  async getActivity(id: string): Promise<ActivityDetail> {
    await delay(150);
    const activity = getActivity(id);
    if (!activity) throw new Error('Activity not found');
    return activity as ActivityDetail;
  },

  /**
   * Get the oldest activity date
   */
  async getOldestActivityDate(): Promise<string | null> {
    await delay(50);
    const activities = fixtures.activities;
    if (activities.length === 0) return null;
    return activities[0].start_date_local;
  },

  /**
   * Get activity streams (time series data)
   */
  async getActivityStreams(id: string, _types?: string[]): Promise<ActivityStreams> {
    await delay(200);
    const streams = getActivityStreams(id);
    if (!streams) {
      // Return empty streams if activity not found
      return { time: [] };
    }
    return streams as ActivityStreams;
  },

  /**
   * Get wellness data with optional date filtering
   */
  async getWellness(params?: { oldest?: string; newest?: string }): Promise<WellnessData[]> {
    await delay(150);
    const wellness = getWellness({
      oldest: params?.oldest,
      newest: params?.newest,
    });
    return wellness as WellnessData[];
  },

  /**
   * Get power curve data
   */
  async getPowerCurve(_params?: { sport?: string; days?: number }): Promise<PowerCurve> {
    await delay(100);
    return demoPowerCurve;
  },

  /**
   * Get pace curve data
   */
  async getPaceCurve(_params?: {
    sport?: string;
    days?: number;
    gap?: boolean;
  }): Promise<PaceCurve> {
    await delay(100);
    return demoPaceCurve;
  },

  /**
   * Get sport settings (power zones, HR zones, etc.)
   */
  async getSportSettings(): Promise<SportSettings[]> {
    await delay(100);
    return demoSportSettings as SportSettings[];
  },

  /**
   * Get athlete profile with sport settings
   */
  async getAthleteProfile(): Promise<Athlete & { sport_settings?: SportSettings[] }> {
    await delay(100);
    return {
      ...(fixtures.athlete as Athlete),
      sport_settings: demoSportSettings as SportSettings[],
    };
  },

  /**
   * Get activity map data (GPS coordinates and bounds)
   */
  async getActivityMap(id: string, boundsOnly = false): Promise<ActivityMapData | null> {
    await delay(100);
    const map = getActivityMap(id, boundsOnly);
    return map as ActivityMapData | null;
  },
};

// ============================================================================
// Test utilities
// ============================================================================

/**
 * Get all fixture data for testing purposes
 */
export function getTestFixtures() {
  return fixtures;
}

/**
 * Reset fixtures (for test isolation)
 * Note: Since fixtures are generated at module load, this requires reimporting
 */
export function resetFixtures() {
  // Fixtures are stateless, no reset needed
  return true;
}
