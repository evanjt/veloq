import { colors, brand, mapLayerColors } from '@/theme';

export type GroupingLayerKind = 'largest' | 'merging' | 'other' | 'dropped';

/** How a preview layer draws, shared by the map's line layers and the legend swatches. */
export const GROUPING_LAYER_PAINT: Record<
  GroupingLayerKind,
  { colour: string; opacity: number; width: number }
> = {
  dropped: { colour: mapLayerColors.casing, opacity: 0.5, width: 1.5 },
  other: { colour: brand.tealLight, opacity: 0.4, width: 2 },
  merging: { colour: colors.warning, opacity: 0.85, width: 3 },
  largest: { colour: brand.tealLight, opacity: 1, width: 4 },
};

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
export function groupingLegendRows(mergedCount: number): GroupingLegendRow[] {
  const row = (
    kind: GroupingLayerKind,
    labelKey: LegendLabelKey,
    count?: number
  ): GroupingLegendRow => ({
    kind,
    colour: GROUPING_LAYER_PAINT[kind].colour,
    opacity: GROUPING_LAYER_PAINT[kind].opacity,
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
