/**
 * Mock API for demo mode
 *
 * Returns fixture data that matches the real Intervals.icu API response format.
 * This ensures demo mode behaves identically to real mode, and can be used
 * for end-to-end testing as well.
 */
import type {
  Activity,
  ActivityDetail,
  ActivityStreams,
  Athlete,
  AthleteSummary,
  WellnessData,
  PowerCurve,
  PaceCurve,
  SportSettings,
  ActivityMapData,
} from '@/types';

// Simulate network delay for realistic UX
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Lazy-loaded demo fixture cache (avoids ~400KB eager load for non-demo users)
let _fixtures: Awaited<typeof import('@/data/demo/fixtures')> | null = null;
let _curves: Awaited<typeof import('@/data/demo/curves')> | null = null;

async function loadFixtures() {
  if (!_fixtures) _fixtures = await import('@/data/demo/fixtures');
  return _fixtures;
}

async function loadCurves() {
  if (!_curves) _curves = await import('@/data/demo/curves');
  return _curves;
}

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
    const { fixtures } = await loadFixtures();
    return fixtures.athlete as Athlete;
  },

  /**
   * Get current athlete (same as getAthlete for demo)
   */
  async getCurrentAthlete(): Promise<Athlete> {
    await delay(100);
    const { fixtures } = await loadFixtures();
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
    const { getActivities } = await loadFixtures();
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
    const { getActivity } = await loadFixtures();
    const activity = getActivity(id);
    if (!activity) throw new Error('Activity not found');
    return activity as ActivityDetail;
  },

  /**
   * Get the oldest activity date
   */
  async getOldestActivityDate(): Promise<string | null> {
    await delay(50);
    const { fixtures } = await loadFixtures();
    const activities = fixtures.activities;
    if (activities.length === 0) return null;
    return activities[0].start_date_local;
  },

  /**
   * Get activity streams (time series data)
   */
  async getActivityStreams(id: string, _types?: string[]): Promise<ActivityStreams> {
    await delay(200);
    const { getActivityStreams } = await loadFixtures();
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
    const { getWellness } = await loadFixtures();
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
    const { demoPowerCurve } = await loadCurves();
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
    const { demoPaceCurve } = await loadCurves();
    return demoPaceCurve;
  },

  /**
   * Get sport settings (power zones, HR zones, etc.)
   */
  async getSportSettings(): Promise<SportSettings[]> {
    await delay(100);
    const { demoSportSettings } = await loadCurves();
    return demoSportSettings as SportSettings[];
  },

  /**
   * Get athlete profile with sport settings
   */
  async getAthleteProfile(): Promise<Athlete & { sport_settings?: SportSettings[] }> {
    await delay(100);
    const [{ fixtures }, { demoSportSettings }] = await Promise.all([loadFixtures(), loadCurves()]);
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
    const { getActivityMap } = await loadFixtures();
    const map = getActivityMap(id, boundsOnly);
    return map as ActivityMapData | null;
  },

  /**
   * Get athlete summary (weekly stats aggregated by calendar week)
   * Generates mock data from demo activities
   */
  async getAthleteSummary(params: { start: string; end: string }): Promise<AthleteSummary[]> {
    await delay(100);
    const { getActivities } = await loadFixtures();
    const activities = getActivities({
      oldest: params.start,
      newest: params.end,
    }) as Activity[];

    // Group activities by ISO week (Monday-Sunday)
    const weekMap = new Map<string, Activity[]>();
    for (const activity of activities) {
      const date = new Date(activity.start_date_local);
      const monday = getMonday(date);
      const weekKey = monday.toISOString().split('T')[0];
      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, []);
      }
      weekMap.get(weekKey)!.push(activity);
    }

    // Convert to AthleteSummary array
    const summaries: AthleteSummary[] = [];
    for (const [weekDate, weekActivities] of weekMap) {
      const totalTime = weekActivities.reduce((sum, a) => sum + (a.moving_time || 0), 0);
      const totalDistance = weekActivities.reduce((sum, a) => sum + (a.distance || 0), 0);
      const totalLoad = weekActivities.reduce((sum, a) => sum + (a.icu_training_load || 0), 0);
      const totalCalories = weekActivities.reduce((sum, a) => sum + (a.calories || 0), 0);
      const totalElevation = weekActivities.reduce(
        (sum, a) => sum + (a.total_elevation_gain || 0),
        0
      );

      summaries.push({
        date: weekDate,
        count: weekActivities.length,
        time: totalTime,
        moving_time: totalTime,
        elapsed_time: totalTime,
        calories: totalCalories,
        total_elevation_gain: totalElevation,
        training_load: totalLoad,
        srpe: 0,
        distance: totalDistance,
        eftp: null,
        eftpPerKg: null,
        athlete_id: 'demo',
        athlete_name: 'Demo User',
        fitness: 50,
        fatigue: 30,
        form: 20,
        rampRate: 0,
        weight: 70,
        timeInZones: [],
        timeInZonesTot: totalTime,
        byCategory: [],
        mostRecentWellnessId: weekDate,
      });
    }

    // Sort by date descending (newest first)
    return summaries.sort((a, b) => b.date.localeCompare(a.date));
  },
};

/**
 * Get Monday of the week for a given date (ISO week: Monday-Sunday)
 */
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ============================================================================
// Test utilities
// ============================================================================

/**
 * Get all fixture data for testing purposes
 */
export async function getTestFixtures() {
  const { fixtures } = await loadFixtures();
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
