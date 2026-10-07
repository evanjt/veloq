import React, { type ComponentProps } from 'react';
import { SectionMapView } from '../SectionMapView';
import { useMapHighlight, type MapHighlightStore } from '@/features/routes/lib/mapHighlight';

type MapProps = Omit<
  ComponentProps<typeof SectionMapView>,
  'highlightedActivityId' | 'highlightedLapPoints'
>;

interface HighlightedSectionMapProps extends MapProps {
  highlight: MapHighlightStore;
}

/**
 * The section map with the chart's scrubbed attempt drawn on it. It is the one
 * reader of the highlight on the screen, so a scrub index renders this and the
 * map under it, and nothing above.
 */
export function HighlightedSectionMap({ highlight, ...mapProps }: HighlightedSectionMapProps) {
  const { activityId, lapPoints } = useMapHighlight(highlight);
  return (
    <SectionMapView
      {...mapProps}
      highlightedActivityId={activityId}
      highlightedLapPoints={lapPoints}
    />
  );
}
