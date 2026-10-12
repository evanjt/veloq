/**
 * One section's full record, read on demand. Maps, insights and the section
 * screens all show a section by id, so the read sits here rather than inside
 * any one of those features.
 */
import { useMemo } from 'react';
import type { FrequentSection } from '@/types';
import { convertNativeSectionToApp } from '@/shared/ffi/sectionConversions';
import { useEngineRead, useReadRetry } from './useEngineSubscription';

interface UseSectionDetailResult {
  /** Full section data (with polyline) or null if not found */
  section: FrequentSection | null;
  /** What the engine threw, when the read failed. Null with no error is not found. */
  error?: unknown;
  /** Reads the section again after a failure. */
  retry: () => void;
}

/**
 * Query-on-demand hook for a single section's full data.
 * Fetches from Rust/SQLite with LRU caching.
 * Converts GpsPoint format to RoutePoint format.
 */
export function useSectionDetail(sectionId: string | null): UseSectionDetailResult {
  const [attempt, retry] = useReadRetry();
  const readSections = useEngineRead(['sections'], [attempt]);

  return useMemo<UseSectionDetailResult>(() => {
    if (!sectionId) return { section: null, retry };

    const engine = readSections((open) => open);
    if (!engine) return { section: null, retry };

    try {
      const native = engine.getSectionById(sectionId);
      return { section: native ? convertNativeSectionToApp(native) : null, retry };
    } catch (error) {
      return { section: null, error, retry };
    }
  }, [sectionId, readSections, retry]);
}
