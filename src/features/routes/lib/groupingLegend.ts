import type { MapPalette } from '@/theme';
import type { MapLayerSpec } from '@/features/maps';
import { previewAreaLayerSpec } from './previewAreaOutline';

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
  | 'settings.groupingLegendDropped'
  | 'settings.previewAreaLayer';

export interface GroupingLegendRow {
  kind: GroupingLayerKind | 'area';
  colour: string;
  opacity: number;
  labelKey: LegendLabelKey;
  count?: number;
  /** The row keys a dashed box rather than a route line. */
  dashed?: boolean;
}

/**
 * One row per drawn layer; the merge count is every route that shares a group,
 * the largest included. The area's box is listed last, while one is drawn.
 */
export function groupingLegendRows(
  mergedCount: number,
  palette: MapPalette,
  hasArea = false
): GroupingLegendRow[] {
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
    ...(hasArea
      ? [
          {
            kind: 'area' as const,
            colour: palette.layer.casing,
            opacity: paint.largest.opacity,
            labelKey: 'settings.previewAreaLayer' as const,
            dashed: true,
          },
        ]
      : []),
  ];
}

/** The preview map's layers, bottom to top: the area's box, dropped, other, merging, then the largest group. */
export function groupingPreviewLayers(palette: MapPalette): MapLayerSpec[] {
  const paint = groupingLayerPaint(palette);
  const roundLine = { 'line-cap': 'round', 'line-join': 'round' };
  return [
    previewAreaLayerSpec(palette),
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
