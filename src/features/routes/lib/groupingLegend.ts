import type { MapPalette } from '@/theme';
import type { MapLayerSpec } from '@/features/maps';

export type GroupingLayerKind = 'largest' | 'merging' | 'other' | 'dropped';

export type GroupingLayerPaint = Record<
  GroupingLayerKind,
  { colour: string; opacity: number; width: number }
>;

/** How a preview layer draws, shared by the map's line layers and the legend swatches. */
export function groupingLayerPaint({ layer }: MapPalette): GroupingLayerPaint {
  return {
    dropped: { colour: layer.casing, opacity: 0.5, width: 1.5 },
    other: { colour: layer.proposed, opacity: 0.4, width: 2 },
    merging: { colour: layer.merging, opacity: 0.85, width: 3 },
    largest: { colour: layer.proposed, opacity: 1, width: 4 },
  };
}

type LegendLabelKey =
  | 'settings.groupingLegendMostRidden'
  | 'settings.groupingMerged'
  | 'settings.groupingLegendOther'
  | 'settings.groupingLegendDropped';

export interface GroupingLegendRow {
  kind: GroupingLayerKind;
  colour: string;
  opacity: number;
  labelKey: LegendLabelKey;
  count?: number;
}

/** One row per drawn layer; the merge count is every route that shares a group, the largest included. */
export function groupingLegendRows(mergedCount: number, palette: MapPalette): GroupingLegendRow[] {
  const paint = groupingLayerPaint(palette);
  const row = (
    kind: GroupingLayerKind,
    labelKey: LegendLabelKey,
    count?: number
  ): GroupingLegendRow => ({
    kind,
    colour: paint[kind].colour,
    opacity: paint[kind].opacity,
    labelKey,
    ...(count === undefined ? {} : { count }),
  });
  return [
    row('largest', 'settings.groupingLegendMostRidden'),
    row('merging', 'settings.groupingMerged', mergedCount),
    row('other', 'settings.groupingLegendOther'),
    row('dropped', 'settings.groupingLegendDropped'),
  ];
}

/** The preview map's line layers, bottom to top: dropped, other, merging, then the largest group. */
export function groupingPreviewLayers(palette: MapPalette): MapLayerSpec[] {
  const paint = groupingLayerPaint(palette);
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
  return [
    {
      id: 'grouping-dropped-line',
      type: 'line',
      source: 'grouping-dropped',
      layout: roundLine,
      paint: {
        'line-color': paint.dropped.colour,
        'line-opacity': paint.dropped.opacity,
        'line-width': paint.dropped.width,
        'line-dasharray': [3, 3],
      },
    },
    {
      id: 'grouping-other-line',
      type: 'line',
      source: 'grouping-other',
      layout: roundLine,
      paint: {
        'line-color': paint.other.colour,
        'line-opacity': paint.other.opacity,
        'line-width': paint.other.width,
      },
    },
    {
      id: 'grouping-merging-line',
      type: 'line',
      source: 'grouping-merging',
      layout: roundLine,
      paint: {
        'line-color': paint.merging.colour,
        'line-opacity': paint.merging.opacity,
        'line-width': paint.merging.width,
      },
    },
    {
      id: 'grouping-largest-line',
      type: 'line',
      source: 'grouping-largest',
      layout: roundLine,
      paint: {
        'line-color': paint.largest.colour,
        'line-opacity': paint.largest.opacity,
        'line-width': paint.largest.width,
      },
    },
  ];
}
