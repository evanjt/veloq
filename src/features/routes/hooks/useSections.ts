/**
 * Unified sections hook that combines:
 * - Auto-detected sections from Rust engine
 * - User-created custom sections from FileSystem storage
 */

import { useMemo } from 'react';
import { useCustomSections } from './useCustomSections';
import { useEngineSubscription } from './useEngine';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection } from '@/types';
import { convertSectionSummaryToApp } from '@/features/routes/lib/sectionConversions';
import { unifySections } from '@/features/routes/lib/unifySections';

// Re-export for backwards compatibility
export { generateSectionName } from '@/features/routes/lib/sectionNaming';

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
  /** Custom section count */
  customCount: number;
  /** Potential section count */
  /** Disabled section count */
  disabledCount: number;
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

  // Load ALL engine sections including disabled/superseded (for sections list restore UI).
  // This uses getAllSectionsIncludingHidden() so disabled sections appear at the bottom.
  const skipEngineFetch = !!preloadedEngineSections;
  const sectionsTrigger = useEngineSubscription(['sections']);
  const hookEngineSections = useMemo(() => {
    if (!enabled || skipEngineFetch) return [];
    const engine = getEngine();
    if (!engine) return [];
    return engine.getAllSectionsIncludingHidden(sportType).map(convertSectionSummaryToApp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, skipEngineFetch, sportType, sectionsTrigger]);
  const engineSections = preloadedEngineSections ?? hookEngineSections;

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

  // Compute counts (disabled/superseded are hidden from counts)
  const autoCount = unified.filter(
    (s) => s.sectionType === 'auto' && !s.disabled && !s.supersededBy
  ).length;
  const customCount = unified.filter((s) => s.sectionType === 'custom').length;
  const disabledCount = unified.filter((s) => !!(s.disabled || s.supersededBy)).length;

  return {
    sections: unified,
    count: unified.length,
    autoCount,
    customCount,
    disabledCount,
    isLoading: customLoading,
    error: customError || null,
  };
}
