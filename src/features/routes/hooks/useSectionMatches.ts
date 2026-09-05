/**
 * Hook for getting sections that an activity belongs to.
 * Used to display matched sections in the activity detail view.
 *
 * OPTIMIZED: Uses getSectionsForActivity() FFI function with junction table
 * for O(1) lookup instead of loading all sections (~250-570ms → ~10-20ms).
 */

import { useMemo } from 'react';
import { generateSectionName } from '@/features/routes/lib/sectionNaming';
import { convertNativeSectionToApp } from '@/features/routes/lib/sectionConversions';
import type { Section as NativeSection } from 'veloqrs';
import type { FrequentSection } from '@/types';

/**
 * Runtime type guard for FrequentSection from engine.
 * Validates essential properties to prevent crashes from malformed engine data.
 */
function isValidSection(value: unknown): value is FrequentSection {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.visitCount === 'number' &&
    Array.isArray(obj.activityIds) &&
    typeof obj.distanceMeters === 'number'
  );
}

export interface SectionMatch {
  /** The section */
  section: FrequentSection;
  /** Direction: 'same' or 'reverse' */
  direction: 'same' | 'reverse';
  /** Section distance in meters */
  distance: number;
}

export interface UseSectionMatchesResult {
  /** Sections this activity belongs to */
  sections: SectionMatch[];
  /** Total number of sections */
  count: number;
  /** Whether data is ready */
  isReady: boolean;
  /** Whether engine data is still loading (engine not available or not yet subscribed) */
  isLoading: boolean;
  /** Whether the engine subscription timed out (engine never became available) */
  timedOut: boolean;
}

/** Section matches a caller already read, so this hook can skip its own reads. */
export interface PreComputedSectionMatches {
  sections: NativeSection[];
  sectionCount: number;
}

/**
 * Get all sections that contain a given activity.
 *
 * OPTIMIZED: Uses junction table lookup instead of loading all sections.
 * Previous: ~250-570ms (load ALL sections, filter in JS)
 * Now: ~10-20ms (query only sections for this activity)
 */
export function useSectionMatches(
  activityId: string | undefined,
  bundle: PreComputedSectionMatches
): UseSectionMatchesResult {
  const sectionCount = bundle.sectionCount;
  const isReady = sectionCount > 0;
  const isLoading = false;

  // Rust already filters out disabled/superseded sections in getSectionsForActivity
  const sections = useMemo(() => {
    if (!activityId) {
      return [];
    }

    const nativeSections: NativeSection[] = bundle.sections;

    const matches: SectionMatch[] = [];

    for (const native of nativeSections) {
      try {
        // Convert to app format
        const converted = convertNativeSectionToApp(native);
        const section = {
          ...converted,
          name: generateSectionName(converted),
        };

        // Validate section structure to prevent crashes from malformed engine data
        if (!isValidSection(section)) {
          continue;
        }

        matches.push({
          section,
          direction: 'same',
          distance: section.distanceMeters,
        });
      } catch {
        continue;
      }
    }

    // Tier 3.4: Rust now returns sections deduped by section_id and
    // sorted by visit count desc, so the TS-side passes are gone.
    return matches;
    // Keyed on the bundle's own array, so a re-render that changes nothing
    // does not decode every matched polyline again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, bundle.sections]);

  return {
    sections,
    count: sections.length,
    isReady,
    isLoading,
    timedOut: false,
  };
}
