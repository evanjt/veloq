/**
 * Section matching algorithm for finding activities that traverse a custom section.
 *
 * Given a section polyline, scans activity GPS tracks to find those that pass through
 * the section. Returns match information including start/end indices and direction.
 */

import { getGpsTracks } from './storage/gpsStorage';
import type {
  CustomSection,
  CustomSectionMatch,
  RoutePoint,
} from '@/types';

/** Configuration for section matching */
export interface SectionMatchConfig {
  /** Maximum distance in meters between section and activity points */
  proximityThreshold: number;
  /** Minimum percentage of section that must be covered (0-1) */
  minCoverage: number;
}

/** Default matching configuration */
export const DEFAULT_MATCH_CONFIG: SectionMatchConfig = {
  proximityThreshold: 50, // 50m - matches the section detection config
  minCoverage: 0.8, // 80% of section must be covered
};

/**
 * Calculate distance between two GPS points using Haversine formula.
 * Returns distance in meters.
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Find the index of the nearest point in an activity track to a given point.
 */
function findNearestPointIndex(
  track: [number, number][],
  point: RoutePoint,
  startIdx = 0
): { index: number; distance: number } {
  let nearestIndex = startIdx;
  let nearestDistance = Infinity;

  for (let i = startIdx; i < track.length; i++) {
    const [lat, lng] = track[i];
    const distance = haversineDistance(point.lat, point.lng, lat, lng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }

  return { index: nearestIndex, distance: nearestDistance };
}

/**
 * Check if an activity track matches a section.
 * Returns match information or null if no match.
 */
function matchActivityToSection(
  activityId: string,
  track: [number, number][],
  section: CustomSection,
  config: SectionMatchConfig
): CustomSectionMatch | null {
  if (track.length < 2 || section.polyline.length < 2) {
    return null;
  }

  const sectionStart = section.polyline[0];
  const sectionEnd = section.polyline[section.polyline.length - 1];

  // Try matching in "same" direction first
  const sameMatch = tryMatchDirection(
    activityId,
    track,
    section,
    sectionStart,
    sectionEnd,
    'same',
    config
  );
  if (sameMatch) return sameMatch;

  // Try matching in "reverse" direction
  const reverseMatch = tryMatchDirection(
    activityId,
    track,
    section,
    sectionEnd,
    sectionStart,
    'reverse',
    config
  );
  if (reverseMatch) return reverseMatch;

  return null;
}

/**
 * Try to match a section in a specific direction.
 */
function tryMatchDirection(
  activityId: string,
  track: [number, number][],
  section: CustomSection,
  start: RoutePoint,
  end: RoutePoint,
  direction: 'same' | 'reverse',
  config: SectionMatchConfig
): CustomSectionMatch | null {
  // Find potential start points
  const startResult = findNearestPointIndex(track, start);
  if (startResult.distance > config.proximityThreshold) {
    return null;
  }

  // Find potential end points (only search after start)
  const endResult = findNearestPointIndex(track, end, startResult.index);
  if (endResult.distance > config.proximityThreshold) {
    return null;
  }

  // Validate that start comes before end
  if (endResult.index <= startResult.index) {
    return null;
  }

  // Calculate what portion of the section is covered
  const coverage = calculateCoverage(
    track,
    section.polyline,
    startResult.index,
    endResult.index,
    direction,
    config.proximityThreshold
  );

  if (coverage < config.minCoverage) {
    return null;
  }

  // Calculate distance of matched portion
  const distanceMeters = calculateTrackDistance(
    track,
    startResult.index,
    endResult.index
  );

  return {
    activityId,
    startIndex: startResult.index,
    endIndex: endResult.index,
    direction,
    distanceMeters,
  };
}

/**
 * Calculate what percentage of the section is covered by the activity track.
 */
function calculateCoverage(
  track: [number, number][],
  sectionPolyline: RoutePoint[],
  startIdx: number,
  endIdx: number,
  direction: 'same' | 'reverse',
  proximityThreshold: number
): number {
  // Sample points along the section
  const sampleCount = Math.min(20, sectionPolyline.length);
  const sampleStep = Math.max(1, Math.floor(sectionPolyline.length / sampleCount));

  let coveredPoints = 0;
  let totalPoints = 0;

  // Get the section polyline in the right order based on direction
  const orderedSection =
    direction === 'same' ? sectionPolyline : [...sectionPolyline].reverse();

  for (let i = 0; i < orderedSection.length; i += sampleStep) {
    const sectionPoint = orderedSection[i];
    totalPoints++;

    // Check if any track point is within proximity
    let isCovered = false;
    for (let j = startIdx; j <= endIdx; j++) {
      const [lat, lng] = track[j];
      const distance = haversineDistance(
        sectionPoint.lat,
        sectionPoint.lng,
        lat,
        lng
      );
      if (distance <= proximityThreshold) {
        isCovered = true;
        break;
      }
    }

    if (isCovered) {
      coveredPoints++;
    }
  }

  return totalPoints > 0 ? coveredPoints / totalPoints : 0;
}

/**
 * Calculate distance along a track between two indices.
 */
function calculateTrackDistance(
  track: [number, number][],
  startIdx: number,
  endIdx: number
): number {
  let totalDistance = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const [lat1, lng1] = track[i];
    const [lat2, lng2] = track[i + 1];
    totalDistance += haversineDistance(lat1, lng1, lat2, lng2);
  }
  return totalDistance;
}

/**
 * Match a custom section against all cached activity tracks.
 *
 * @param section - The custom section to match
 * @param activityIds - List of activity IDs to check (from cache)
 * @param config - Matching configuration (optional)
 * @returns Array of matches found
 */
export async function matchCustomSection(
  section: CustomSection,
  activityIds: string[],
  config: SectionMatchConfig = DEFAULT_MATCH_CONFIG
): Promise<CustomSectionMatch[]> {
  if (activityIds.length === 0 || section.polyline.length < 2) {
    return [];
  }

  // Load GPS tracks for all activities
  const tracks = await getGpsTracks(activityIds);
  const matches: CustomSectionMatch[] = [];

  // Match each activity
  for (const [activityId, track] of tracks) {
    // Skip the source activity - it's already a match by definition
    if (activityId === section.sourceActivityId) {
      // Add the source activity as a match
      matches.push({
        activityId,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        direction: 'same',
        distanceMeters: section.distanceMeters,
      });
      continue;
    }

    const match = matchActivityToSection(activityId, track, section, config);
    if (match) {
      matches.push(match);
    }
  }

  return matches;
}

/**
 * Match a single activity against a custom section.
 * Used when a new activity is synced.
 */
export async function matchActivityToCustomSection(
  section: CustomSection,
  activityId: string,
  config: SectionMatchConfig = DEFAULT_MATCH_CONFIG
): Promise<CustomSectionMatch | null> {
  if (section.polyline.length < 2) {
    return null;
  }

  // Skip if this is the source activity
  if (activityId === section.sourceActivityId) {
    return {
      activityId,
      startIndex: section.startIndex,
      endIndex: section.endIndex,
      direction: 'same',
      distanceMeters: section.distanceMeters,
    };
  }

  const tracks = await getGpsTracks([activityId]);
  const track = tracks.get(activityId);

  if (!track) {
    return null;
  }

  return matchActivityToSection(activityId, track, section, config);
}
