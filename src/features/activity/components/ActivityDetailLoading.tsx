import React from 'react';

import { useMapPreferences } from '@/features/settings';
import { getTerrainPreviewUri, hasTerrainPreview } from '@/features/maps';
import { MapDetailSkeleton } from '@/shared/ui/MapDetailSkeleton';

interface ActivityDetailLoadingProps {
  activityId: string;
  onPreviewSettled?: () => void;
  animated?: boolean;
}

/**
 * The activity screen while its reads are pending, standing on the picture the feed card drew
 * when one is cached. The activity's type is not known yet, so the picture is looked up for the
 * default sport's style, the 3D render first and the flat one after, which are the two the feed
 * card could have drawn.
 */
export function ActivityDetailLoading({
  activityId,
  onPreviewSettled,
  animated,
}: ActivityDetailLoadingProps) {
  const { getStyleForActivity } = useMapPreferences();
  const style = getStyleForActivity('Ride', activityId);
  const is3D = [true, false].find((candidate) => hasTerrainPreview(activityId, style, candidate));
  const previewUri = is3D === undefined ? null : getTerrainPreviewUri(activityId, style, is3D);
  return (
    <MapDetailSkeleton
      kind="activity"
      previewUri={previewUri}
      onPreviewSettled={onPreviewSettled}
      animated={animated}
    />
  );
}
