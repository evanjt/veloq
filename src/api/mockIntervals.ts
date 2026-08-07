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
  PowerCurve,
  PaceCurve,
  ActivityMapData,
  CalendarEvent,
  IntervalsDTO,
} from '@/types';
import { getMonday, formatLocalDate } from '@/shared/format/format';

// Simulate network delay for realistic UX
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Lazy-loaded demo fixture cache (avoids ~400KB eager load for non-demo users)
let _fixtures: Awaited<typeof import('@/data/demo/fixtures')> | null = null;
let _curves: Awaited<typeof import('@/features/fitness/demo/curves')> | null = null;
let _calendarEvents: Awaited<typeof import('@/data/demo/calendarEvents')> | null = null;

async function loadFixtures() {
  if (!_fixtures) _fixtures = await import('@/data/demo/fixtures');
  return _fixtures;
}

async function loadCurves() {
  if (!_curves) _curves = await import('@/features/fitness/demo/curves');
  return _curves;
}

async function loadCalendarEvents() {
  if (!_calendarEvents) _calendarEvents = await import('@/data/demo/calendarEvents');
  return _calendarEvents;
}

/**
 * Mock implementation of the Intervals.icu API
 *
 * All methods return data in the same format as the real API,
 * making this suitable for both demo mode and testing.
 */
export const mockIntervalsApi = {
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
   * Get activity map data (GPS coordinates and bounds)
   */
  async getActivityMap(id: string, boundsOnly = false): Promise<ActivityMapData | null> {
    await delay(100);
    const { getActivityMap } = await loadFixtures();
    const map = getActivityMap(id, boundsOnly);
    return map as ActivityMapData | null;
  },
};
