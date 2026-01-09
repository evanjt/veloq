/**
 * @fileoverview Custom section synchronization utilities
 *
 * Handles syncing newly added activities against user-defined custom sections.
 * Custom sections are user-created route segments (e.g., "My favorite climb").
 *
 * When activities are synced to the route engine, this module checks if any
 * of the new activities match custom sections and updates the matches.
 */

import { loadCustomSections, saveSectionMatches, loadSectionMatches } from './customSections';
import { matchActivityToCustomSection } from '@/lib/sectionMatcher';
import type { CustomSectionMatch } from '@/types';

/**
 * Sync newly synced activities against existing custom sections.
 *
 * For each custom section, checks if any of the new activities match the section.
 * Matches are stored per section for pace comparison and personal bests.
 *
 * **Process:**
 * 1. Load all custom sections from storage
 * 2. For each section, load existing matches
 * 3. Check each new activity for matches (skip if already matched)
 * 4. Save updated match list if new matches found
 *
 * **Error Handling:**
 * - Non-blocking: Errors logged but don't throw
 * - Rationale: Custom sections are optional, sync failure shouldn't block main flow
 *
 * @param activityIds - Activity IDs to check against custom sections
 * @returns Promise that resolves when sync completes (silently fails on error)
 *
 * @example
 * ```ts
 * // Non-blocking fire-and-forget pattern
 * syncActivitiesWithCustomSections(activityIds).catch(() => {});
 * ```
 */
export async function syncActivitiesWithCustomSections(
  activityIds: string[]
): Promise<void> {
  if (activityIds.length === 0) return;

  try {
    // Load all custom sections
    const sections = await loadCustomSections();
    if (sections.length === 0) return;

    // For each section, check if any new activities match
    for (const section of sections) {
      // Load existing matches to avoid duplicates
      const existingMatches = await loadSectionMatches(section.id);
      const existingActivityIds = new Set(existingMatches.map((m) => m.activityId));

      // Check each new activity
      const newMatches: CustomSectionMatch[] = [];
      for (const activityId of activityIds) {
        // Skip if already matched
        if (existingActivityIds.has(activityId)) continue;

        const match = await matchActivityToCustomSection(section, activityId);
        if (match) {
          newMatches.push(match);
        }
      }

      // Save new matches if any were found
      if (newMatches.length > 0) {
        await saveSectionMatches(section.id, [...existingMatches, ...newMatches]);
      }
    }
  } catch (error) {
    // Log but don't throw - custom section sync is non-critical
    console.warn('Failed to sync custom sections:', error);
  }
}
