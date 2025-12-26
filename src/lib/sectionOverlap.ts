/**
 * Extract portions of GPS tracks that overlap with a section.
 *
 * Given a section's polyline and an activity's full GPS track,
 * this module finds the contiguous portions of the track that
 * pass through (near) the section.
 */

import type { RoutePoint } from '@/types';

/** Distance threshold for considering a point "on" the section (meters) */
const PROXIMITY_THRESHOLD_METERS = 50;

/** Minimum points to consider a valid overlap */
const MIN_OVERLAP_POINTS = 3;

/** Meters per degree of latitude (approximately constant) */
const METERS_PER_LAT_DEGREE = 111_319;

/**
 * Calculate haversine distance between two points in meters
 */
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Find minimum distance from a point to any point on the section polyline
 */
function minDistanceToSection(
  lat: number,
  lng: number,
  sectionPolyline: RoutePoint[]
): number {
  let minDist = Infinity;

  for (const point of sectionPolyline) {
    const dist = haversineDistance(lat, lng, point.lat, point.lng);
    if (dist < minDist) {
      minDist = dist;
    }
  }

  return minDist;
}

/**
 * Result of extracting section overlap from an activity
 */
export interface SectionOverlap {
  /** Activity ID */
  activityId: string;
  /** Points that overlap with the section */
  overlapPoints: [number, number][];
  /** Full track for context (dimmed display) */
  fullTrack: [number, number][];
  /** Start index in full track */
  startIndex: number;
  /** End index in full track */
  endIndex: number;
}

/**
 * Extract the portion of a GPS track that overlaps with a section.
 *
 * Uses proximity to the section polyline to determine overlap.
 * Returns the longest contiguous sequence of points near the section.
 *
 * @param activityId - Activity identifier
 * @param track - Full GPS track as [lat, lng][] pairs
 * @param sectionPolyline - Section's representative polyline
 * @param thresholdMeters - Distance threshold for overlap (default 50m)
 * @returns SectionOverlap or null if no significant overlap found
 */
export function extractSectionOverlap(
  activityId: string,
  track: [number, number][],
  sectionPolyline: RoutePoint[],
  thresholdMeters: number = PROXIMITY_THRESHOLD_METERS
): SectionOverlap | null {
  if (track.length < MIN_OVERLAP_POINTS || sectionPolyline.length < 2) {
    return null;
  }

  // Find contiguous sequences of points near the section
  const sequences: { start: number; end: number; points: [number, number][] }[] = [];
  let currentSequence: { start: number; points: [number, number][] } | null = null;

  for (let i = 0; i < track.length; i++) {
    const [lat, lng] = track[i];
    const dist = minDistanceToSection(lat, lng, sectionPolyline);

    if (dist <= thresholdMeters) {
      // Point is near section
      if (!currentSequence) {
        currentSequence = { start: i, points: [] };
      }
      currentSequence.points.push([lat, lng]);
    } else {
      // Point is far from section
      if (currentSequence && currentSequence.points.length >= MIN_OVERLAP_POINTS) {
        sequences.push({
          start: currentSequence.start,
          end: i - 1,
          points: currentSequence.points,
        });
      }
      currentSequence = null;
    }
  }

  // Don't forget last sequence
  if (currentSequence && currentSequence.points.length >= MIN_OVERLAP_POINTS) {
    sequences.push({
      start: currentSequence.start,
      end: track.length - 1,
      points: currentSequence.points,
    });
  }

  if (sequences.length === 0) {
    return null;
  }

  // Find the longest sequence (most likely the main traversal)
  const longest = sequences.reduce((a, b) =>
    b.points.length > a.points.length ? b : a
  );

  return {
    activityId,
    overlapPoints: longest.points,
    fullTrack: track,
    startIndex: longest.start,
    endIndex: longest.end,
  };
}

/**
 * Extract section overlaps for multiple activities.
 *
 * @param tracks - Map of activity ID to full GPS track
 * @param sectionPolyline - Section's representative polyline
 * @param thresholdMeters - Distance threshold for overlap
 * @returns Array of SectionOverlap results (only activities with valid overlaps)
 */
export function extractSectionOverlaps(
  tracks: Map<string, [number, number][]>,
  sectionPolyline: RoutePoint[],
  thresholdMeters: number = PROXIMITY_THRESHOLD_METERS
): SectionOverlap[] {
  const results: SectionOverlap[] = [];

  for (const [activityId, track] of tracks) {
    const overlap = extractSectionOverlap(
      activityId,
      track,
      sectionPolyline,
      thresholdMeters
    );
    if (overlap) {
      results.push(overlap);
    }
  }

  return results;
}

/**
 * Compute bounding box that includes section and all overlaps
 */
export function computeOverlapBounds(
  sectionPolyline: RoutePoint[],
  overlaps: SectionOverlap[]
): { ne: [number, number]; sw: [number, number] } | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  // Include section polyline
  for (const p of sectionPolyline) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }

  // Include overlap points
  for (const overlap of overlaps) {
    for (const [lat, lng] of overlap.overlapPoints) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  }

  if (!isFinite(minLat)) {
    return null;
  }

  // Add padding
  const latPad = (maxLat - minLat) * 0.15;
  const lngPad = (maxLng - minLng) * 0.15;

  return {
    ne: [maxLng + lngPad, maxLat + latPad],
    sw: [minLng - lngPad, minLat - latPad],
  };
}
