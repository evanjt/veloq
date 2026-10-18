import { groupingLayerPaint, groupingLegendRows } from '@/features/routes/lib/groupingLegend';
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

  it('gives each drawn layer its own row in the colour and opacity it paints', () => {
    const rows = groupingLegendRows(0, palette);
    expect(rows.map((r) => r.kind)).toEqual(['largest', 'merging', 'other', 'dropped']);
    const other = rows.find((r) => r.kind === 'other');
    const dropped = rows.find((r) => r.kind === 'dropped');
    expect(other?.colour).toBe(brand.blue600);
    expect(other?.opacity).toBe(groupingLayerPaint(palette).other.opacity);
    expect(dropped?.colour).toBe(mapLayerColors.casing);
    expect(dropped?.labelKey).toBe('settings.groupingLegendDropped');
  });
});
