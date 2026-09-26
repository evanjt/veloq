/**
 * Unified sections hook that combines:
 * - Auto-detected sections from Rust engine
 * - User-created custom sections from FileSystem storage
 */

import { useMemo } from 'react';
import { useCustomSections } from './useCustomSections';
import type { FrequentSection } from '@/types';
import { unifySections } from '@/features/routes/lib/unifySections';

// Re-export for backwards compatibility
export { generateSectionName } from '@/features/routes/lib/sectionNaming';

/** One reference, so a caller with no page does not re-unify every render. */
const EMPTY_SECTIONS: FrequentSection[] = [];

export interface UseSectionsOptions {
  /** Filter by sport type */
  sportType?: string;
  /** Include custom sections (default: true) */
  includeCustom?: boolean;
  /** Whether to run the hook (default: true). When false, returns empty defaults without FFI calls. */
  enabled?: boolean;
  /** Pre-loaded engine sections from batch FFI call. When provided, skips useSectionSummaries FFI calls. */
  preloadedEngineSections?: FrequentSection[];
}

export interface UseSectionsResult {
  /** All sections combined */
  sections: FrequentSection[];
  /** Total section count */
  count: number;
  /** Auto-detected section count */
  autoCount: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
}

/**
 * Hook for unified sections combining all section types.
 */
export function useSections(options: UseSectionsOptions = {}): UseSectionsResult {
  const { sportType, includeCustom = true, enabled = true, preloadedEngineSections } = options;

  // The engine rows are the caller's page and nothing else. There was a summary
  // read here for the frames before that page landed, but the page is read while
  // rendering now, so the gap it filled has closed. Disabled and superseded rows
  // come from the page too: the read is filtered, not narrowed.
  const engineSections = preloadedEngineSections ?? EMPTY_SECTIONS;

  // Load custom sections
  const {
    sections: customSections,
    isLoading: customLoading,
    error: customError,
  } = useCustomSections({ sportType, enabled });

  // Combine all sections. The engine row wins wherever it has the id, so a
  // custom section keeps its rank scores, class and elevation.
  // NOTE: Overlap calculation for auto vs custom sections is pre-computed and
  // stored in SupersededSectionsStore when custom sections are created.
  const unified = useMemo(
    () => unifySections({ engineSections, customSections, includeCustom }),
    [engineSections, customSections, includeCustom]
  );

  // Counts that key a filter chip come from the engine, over the catalogue. A
  // tally here only ever sees the page the caller preloaded.
  const autoCount = unified.filter(
    (s) => s.sectionType === 'auto' && !s.disabled && !s.supersededBy
  ).length;

  return {
    sections: unified,
    count: unified.length,
    autoCount,
    isLoading: customLoading,
    error: customError || null,
  };
}
