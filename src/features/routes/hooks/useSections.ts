/**
 * Unified sections hook that combines:
 * - The engine's rows for the page the caller read, custom sections included
 */

import { useMemo } from 'react';
import type { FrequentSection } from '@/types';
import { unifySections } from '@/features/routes/lib/unifySections';

// Re-export for backwards compatibility

/** One reference, so a caller with no page does not re-unify every render. */
const EMPTY_SECTIONS: FrequentSection[] = [];

export interface UseSectionsOptions {
  /** Pre-loaded engine sections from batch FFI call. When provided, skips useSectionSummaries FFI calls. */
  preloadedEngineSections?: FrequentSection[] | undefined;
}

export interface UseSectionsResult {
  /** All sections combined */
  sections: FrequentSection[];
  /** Total section count */
  count: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
}

/**
 * Hook for unified sections combining all section types.
 */
export function useSections(options: UseSectionsOptions = {}): UseSectionsResult {
  const { preloadedEngineSections } = options;

  // The engine rows are the caller's page and nothing else. There was a summary
  // read here for the frames before that page landed, but the page is read while
  // rendering now, so the gap it filled has closed. Disabled and superseded rows
  // come from the page too: the read is filtered, not narrowed.
  const engineSections = preloadedEngineSections ?? EMPTY_SECTIONS;

  // The engine holds every custom section, so the page already carries the ones
  // the query asked for and a custom store read would only add the ones it left out.
  const unified = useMemo(() => unifySections({ engineSections }), [engineSections]);

  return {
    sections: unified,
    count: unified.length,
    isLoading: false,
    error: null,
  };
}
