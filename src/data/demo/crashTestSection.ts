/**
 * Crash Test Section - Demo data for iOS MapLibre crash testing
 *
 * This section has intentionally invalid polyline data (single point)
 * that would crash iOS MapLibre if not properly validated.
 *
 * Error: -[__NSArrayM insertObject:atIndex:]: object cannot be nil
 * Location: MLRNMapView.m:207
 *
 * Used for:
 * 1. E2E testing to verify crash fix works
 * 2. Manual QA testing by users
 *
 * Navigate to: /section/crash-test-section
 */

import type { FrequentSection } from '@/types';
import { CRASH_TEST_ACTIVITY_ID } from './fixtures';

export const CRASH_TEST_SECTION_ID = 'crash-test-section';

/**
 * Section with SINGLE POINT polyline - triggers iOS crash if not validated
 * GeoJSON LineString requires minimum 2 coordinates
 */
export const crashTestSection: FrequentSection = {
  id: CRASH_TEST_SECTION_ID,
  sportType: 'Run',
  polyline: [{ lat: 45.0, lng: 7.0 }], // CRASH TRIGGER: Only 1 point
  activityIds: [CRASH_TEST_ACTIVITY_ID],
  activityPortions: [],
  routeIds: [],
  visitCount: 1,
  distanceMeters: 100,
  name: 'Crash Test Section (Single Point)',
};

/**
 * Section with EMPTY polyline - triggers iOS crash if not validated
 */
export const crashTestSectionEmpty: FrequentSection = {
  id: 'crash-test-section-empty',
  sportType: 'Ride',
  polyline: [], // CRASH TRIGGER: Empty array
  activityIds: ['demo_crash_test_2'],
  activityPortions: [],
  routeIds: [],
  visitCount: 1,
  distanceMeters: 0,
  name: 'Crash Test Section (Empty)',
};

/**
 * Section with ALL NaN coordinates - triggers iOS crash if not validated
 */
export const crashTestSectionNaN: FrequentSection = {
  id: 'crash-test-section-nan',
  sportType: 'Walk',
  polyline: [
    { lat: NaN, lng: NaN },
    { lat: NaN, lng: NaN },
  ], // CRASH TRIGGER: All NaN
  activityIds: ['demo_crash_test_3'],
  activityPortions: [],
  routeIds: [],
  visitCount: 1,
  distanceMeters: 50,
  name: 'Crash Test Section (NaN)',
};

/**
 * All crash test sections for iteration
 */
export const allCrashTestSections: FrequentSection[] = [
  crashTestSection,
  crashTestSectionEmpty,
  crashTestSectionNaN,
];

/**
 * Check if a section ID is a crash test section
 */
export function isCrashTestSectionId(id: string): boolean {
  return id.startsWith('crash-test-section');
}

/**
 * Get crash test section by ID
 */
export function getCrashTestSection(id: string): FrequentSection | null {
  return allCrashTestSections.find((s) => s.id === id) ?? null;
}
