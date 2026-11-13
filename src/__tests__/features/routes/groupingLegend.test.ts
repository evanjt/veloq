import {
  groupingLayerPaint,
  groupingLegendRows,
  groupingPreviewLayers,
} from '@/features/routes/lib/groupingLegend';
import { paintPreview } from '@/features/routes/lib/groupingParams';
import { brand, mapLayerColors, mapPalette } from '@/theme';

const palette = mapPalette('light');

describe('groupingLegendRows', () => {
  it('counts every merging route, including those merging into the largest group', () => {
    const routes = ['a', 'b', 'c', 'd'].map((id) => ({ groupId: id, representativeId: id }));
    const diff = paintPreview(routes, [
      { key: 'k1', activityIds: ['a', 'b', 'x'] },
      { key: 'k2', activityIds: ['c', 'd'] },
    ] as never);
    const merging = groupingLegendRows(diff.mergedCount, palette).find((r) => r.kind === 'merging');
    expect(merging?.count).toBe(4);
  });

  vaultIt('gives each drawn layer its own row in the colour and opacity it paints', () => {
    const rows = groupingLegendRows(0, palette);
    expect(rows.map((r) => r.kind)).toEqual(['largest', 'merging', 'other', 'dropped']);
    const other = rows.find((r) => r.kind === 'other');
    const dropped = rows.find((r) => r.kind === 'dropped');
    expect(other?.colour).toBe(brand.blue600);
    expect(other?.opacity).toBe(groupingLayerPaint(palette).other.opacity);
    expect(dropped?.colour).toBe(mapLayerColors.casing);
    expect(dropped?.labelKey).toBe('settings.groupingLegendDropped');
  });

  vaultIt('lists the selected area as a dashed box, after the route layers', () => {
    const rows = groupingLegendRows(0, palette, true);
    expect(rows.map((r) => r.kind)).toEqual(['largest', 'merging', 'other', 'dropped', 'area']);
    const area = rows[rows.length - 1];
    expect(area?.dashed).toBe(true);
    expect(area?.labelKey).toBe('settings.previewAreaLayer');
    expect(groupingLegendRows(0, palette).some((r) => r.kind === 'area')).toBe(false);
  });

  vaultIt(
    'draws the area outline beneath every route layer, dashed like the section preview',
    () => {
      const layers = groupingPreviewLayers(palette);
      expect(layers[0]?.id).toBe('preview-area-line');
      expect(layers[0]?.source).toBe('preview-area');
      expect(layers[0]?.paint?.['line-dasharray']).toBeDefined();
    }
  );
});
