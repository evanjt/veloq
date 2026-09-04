import { useMemo, useCallback, useState } from 'react';
import { getEngine } from '@/shared/native/engine';
import { decodeCoords } from 'veloqrs';
import { useSectionDetail } from '@/features/routes/hooks/useEngine';
import { convertNativeSectionToApp } from '@/features/routes/lib/sectionConversions';
import { generateSectionName } from '@/features/routes/lib/sectionNaming';
import type { Section as NativeSection } from 'veloqrs';
import type { FrequentSection } from '@/types';

/**
 * `preComputedSection` lets a caller that already read the section as part of
 * a screen bundle skip this hook's own FFI calls. The bundle is re-read on the
 * same refresh key, so the stale-data guard below is not needed for it.
 */
export function useSectionDataRefresh(id: string | undefined, preComputedSection?: NativeSection) {
  // Key to force section data refresh after reference change
  const [sectionRefreshKey, setSectionRefreshKey] = useState(0);
  const skipOwnFfiCall = preComputedSection !== undefined;

  // Use useSectionDetail for ALL sections (both auto and custom).
  // Rust get_section_by_id() handles both types via the unified sections table.
  const sectionIdWithRefresh = id ? `${id}#${sectionRefreshKey}` : null;
  const { section: rawEngineSection } = useSectionDetail(skipOwnFfiCall ? null : (id ?? null));

  const bundledSection = useMemo(() => {
    if (!preComputedSection) return null;
    const converted = convertNativeSectionToApp(preComputedSection);
    return { ...converted, name: converted.name || generateSectionName(converted) };
  }, [preComputedSection]);

  // Force re-computation when refresh key changes by including it in the memo
  const section = useMemo(() => {
    const _forceRefresh = sectionIdWithRefresh;
    if (skipOwnFfiCall) return bundledSection;
    if (!rawEngineSection) return null;

    // Re-fetch fresh data from engine when refresh key changes
    // IMPORTANT: Use ALL fresh data, not just polyline - activityIds may have changed
    if (sectionRefreshKey > 0) {
      const engine = getEngine();
      if (engine && id) {
        const fresh = engine.getSectionById(id);
        if (fresh && fresh.encodedPolyline && fresh.encodedPolyline.byteLength > 0) {
          const freshAny = fresh as unknown as Record<string, unknown>;
          const sectionType: 'auto' | 'custom' =
            typeof freshAny.sectionType === 'string' && freshAny.sectionType === 'custom'
              ? 'custom'
              : 'auto';
          const createdAt =
            typeof freshAny.createdAt === 'string' ? freshAny.createdAt : new Date().toISOString();
          return {
            ...fresh,
            sectionType,
            polyline: decodeCoords(fresh.encodedPolyline).map((p) => ({
              lat: p.latitude,
              lng: p.longitude,
            })),
            activityPortions: fresh.activityPortions?.map((p) => ({
              ...p,
              direction: (p.direction === 'reverse' ? 'reverse' : 'same') as 'same' | 'reverse',
            })),
            createdAt,
          } as FrequentSection;
        }
        // If fresh data is invalid/empty, keep using rawEngineSection to avoid map flicker
      }
    }
    return rawEngineSection;
  }, [
    rawEngineSection,
    sectionIdWithRefresh,
    sectionRefreshKey,
    id,
    skipOwnFfiCall,
    bundledSection,
  ]);

  // Section bounds trimming
  const handleTrimRefresh = useCallback(() => {
    setSectionRefreshKey((k) => k + 1);
  }, []);

  return { section, sectionRefreshKey, setSectionRefreshKey, handleTrimRefresh };
}
