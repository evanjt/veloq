import { useMemo } from 'react';
import { useSectionDisplayNames } from '@/features/routes/hooks/useSectionDisplayNames';
import { isPaceSport } from '@/features/activity/lib/activityUtils';
import type { ActivityType, FrequentSection } from '@/types';
import type { NearbySectionSummary } from 'veloqrs';

export function useSectionMapData(
  nearby: NearbySectionSummary[],
  effectiveSportType: string | undefined,
  section: FrequentSection | null
) {
  const displayNames = useSectionDisplayNames();

  // Prepare nearby polylines for map overlay (includes metadata for preview popup)
  const nearbyPolylines = useMemo(() => {
    if (!nearby || nearby.length === 0) return undefined;
    return nearby.map((n) => ({
      id: n.id,
      name: displayNames[n.id] || n.name,
      sportType: n.sportType,
      distanceMeters: n.distanceMeters,
      visitCount: n.visitCount,
      encodedPolyline: n.encodedPolyline,
    }));
  }, [nearby, displayNames]);

  const isRunning = effectiveSportType
    ? isPaceSport(effectiveSportType as ActivityType)
    : section
      ? isPaceSport(section.sportType as ActivityType)
      : false;

  return { nearbyPolylines, isRunning };
}
