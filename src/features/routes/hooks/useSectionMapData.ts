import { useMemo } from 'react';
import { getAllSectionDisplayNames } from '@/features/routes/hooks/useUnifiedSections';
import { isRunningActivity } from '@/features/activity/lib/activityUtils';
import type { ActivityType, FrequentSection } from '@/types';
import type { NearbySectionSummary } from 'veloqrs';

export function useSectionMapData(
  nearby: NearbySectionSummary[],
  effectiveSportType: string | undefined,
  section: FrequentSection | null
) {
  // Prepare nearby polylines for map overlay (includes metadata for preview popup)
  const nearbyPolylines = useMemo(() => {
    if (!nearby || nearby.length === 0) return undefined;
    const displayNames = getAllSectionDisplayNames();
    return nearby.map((n) => ({
      id: n.id,
      name: displayNames[n.id] || n.name,
      sportType: n.sportType,
      distanceMeters: n.distanceMeters,
      visitCount: n.visitCount,
      encodedPolyline: n.encodedPolyline,
    }));
  }, [nearby]);

  const isRunning = effectiveSportType
    ? isRunningActivity(effectiveSportType as ActivityType)
    : section
      ? isRunningActivity(section.sportType as ActivityType)
      : false;

  return { nearbyPolylines, isRunning };
}
